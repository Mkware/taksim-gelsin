/**
 * smart_matching.service.ts'nin ACQUIRE_NEXT_DRIVER_LUA script'i — kuyruktan
 * pop + canlı-socket kontrolü + teklif kilidi (NX) + pending/deadline/ZSET
 * yazımını TEK atomik Redis işleminde yapıyor. Önceki (Lua'sız) sürüm bu
 * adımları ayrı komutlarda yapıyordu ve arada bir sürücü kaybolabiliyordu ya
 * da iki paralel çağrı aynı sürücüye teklif gönderebiliyordu (bkz. dosyadaki
 * yorum). Bu test gerçek Redis'e (testcontainers) karşı script'in bu
 * garantiyi koruduğunu doğruluyor.
 *
 * NOT: smart_matching.service.ts src/config/env.ts'i transitive import ediyor;
 * o da process.env'i Zod ile doğrulayıp geçersizse process.exit(1) yapıyor.
 * Bu yüzden modül dinamik olarak, gerekli env değişkenleri (bkz. tests/support/env.ts)
 * ve gerçek Redis container'ının host/port'u set edildikten SONRA import ediliyor.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Redis as RedisClient } from 'ioredis';
import type { StartedRedisContainer } from '@testcontainers/redis';
import { startTestRedis, waitForRedisReady } from '../support/redis';
import { setDummyAppEnv } from '../support/env';

describe('smart_matching: acquireNextDriver (ACQUIRE_NEXT_DRIVER_LUA)', () => {
  let container: StartedRedisContainer;
  let redis: RedisClient;
  let acquireNextDriver: typeof import('../../src/services/smart_matching.service').acquireNextDriver;
  let REDIS_KEYS: typeof import('../../src/services/smart_matching.service').REDIS_KEYS;
  let DRIVER_SOCKET_KEY: string;
  let DRIVER_PENDING_OFFER_PREFIX: string;
  let OFFER_DEADLINES_ZSET: string;

  beforeAll(async () => {
    container = await startTestRedis();
    setDummyAppEnv({
      REDIS_HOST: container.getHost(),
      REDIS_PORT: String(container.getPort()),
    });

    const smartMatching = await import('../../src/services/smart_matching.service');
    const redisConfig = await import('../../src/config/redis');
    redis = redisConfig.redis;
    acquireNextDriver = smartMatching.acquireNextDriver;
    REDIS_KEYS = smartMatching.REDIS_KEYS;
    DRIVER_SOCKET_KEY = smartMatching.DRIVER_SOCKET_KEY;
    DRIVER_PENDING_OFFER_PREFIX = smartMatching.DRIVER_PENDING_OFFER_PREFIX;
    OFFER_DEADLINES_ZSET = smartMatching.OFFER_DEADLINES_ZSET;

    await waitForRedisReady(redis);
  }, 120_000);

  afterAll(async () => {
    await redis.quit();
    await container.stop();
  });

  async function markDriverOnline(driverId: string): Promise<void> {
    await redis.set(`${DRIVER_SOCKET_KEY}${driverId}`, `socket:${driverId}`);
  }

  it('kuyruktaki ilk çevrimiçi sürücüyü devralır ve pending SET/deadline/ZSET yazar', async () => {
    const rideId = randomUUID();
    const driverId = randomUUID();
    await markDriverOnline(driverId);
    await redis.rpush(REDIS_KEYS.matchingQueue(rideId), driverId);

    const acquired = await acquireNextDriver(rideId, 30, Date.now() + 30_000, Date.now() + 30_000);

    expect(acquired).toBe(driverId);

    // pending artık SET (paralel teklif dalgası) — üyelik kontrolü
    const isPending = await redis.sismember(REDIS_KEYS.pending(rideId), driverId);
    expect(isPending).toBe(1);

    const offerLock = await redis.get(`${DRIVER_PENDING_OFFER_PREFIX}${driverId}`);
    expect(offerLock).toBe(rideId);

    const deadline = await redis.get(`ride:driver_response_deadline:${rideId}:${driverId}`);
    expect(deadline).not.toBeNull();

    const zsetScore = await redis.zscore(OFFER_DEADLINES_ZSET, `${rideId}::${driverId}`);
    expect(zsetScore).not.toBeNull();
  });

  it('paralel dalga: art arda iki devralma iki farklı sürücüyü AYNI pending SET\'inde tutar', async () => {
    const rideId = randomUUID();
    const driverA = randomUUID();
    const driverB = randomUUID();
    await markDriverOnline(driverA);
    await markDriverOnline(driverB);
    await redis.rpush(REDIS_KEYS.matchingQueue(rideId), driverA, driverB);

    const first = await acquireNextDriver(rideId, 30, Date.now() + 30_000, Date.now() + 30_000);
    const second = await acquireNextDriver(rideId, 30, Date.now() + 30_000, Date.now() + 30_000);

    expect(first).toBe(driverA);
    expect(second).toBe(driverB);

    const pendingMembers = await redis.smembers(REDIS_KEYS.pending(rideId));
    expect(new Set(pendingMembers)).toEqual(new Set([driverA, driverB]));

    // Her teklifin kendi deadline anahtarı ve ZSET üyesi var
    expect(await redis.get(`ride:driver_response_deadline:${rideId}:${driverA}`)).not.toBeNull();
    expect(await redis.get(`ride:driver_response_deadline:${rideId}:${driverB}`)).not.toBeNull();
    expect(await redis.zscore(OFFER_DEADLINES_ZSET, `${rideId}::${driverA}`)).not.toBeNull();
    expect(await redis.zscore(OFFER_DEADLINES_ZSET, `${rideId}::${driverB}`)).not.toBeNull();
  });

  it('eski deploy\'dan kalan STRING pending anahtarını SET\'e çevirip üstüne ekler', async () => {
    const rideId = randomUUID();
    const legacyDriver = randomUUID();
    const newDriver = randomUUID();
    await markDriverOnline(newDriver);
    // Eski format: pending düz string
    await redis.set(REDIS_KEYS.pending(rideId), legacyDriver);
    await redis.rpush(REDIS_KEYS.matchingQueue(rideId), newDriver);

    const acquired = await acquireNextDriver(rideId, 30, Date.now() + 30_000, Date.now() + 30_000);
    expect(acquired).toBe(newDriver);

    expect(await redis.type(REDIS_KEYS.pending(rideId))).toBe('set');
    const members = await redis.smembers(REDIS_KEYS.pending(rideId));
    expect(new Set(members)).toEqual(new Set([legacyDriver, newDriver]));
  });

  it('socket kaydı olmayan (çevrimdışı) sürücüleri atlar, kuyrukta gerçekten çevrimiçi olanı bulur', async () => {
    const rideId = randomUUID();
    const offlineDriver = randomUUID();
    const onlineDriver = randomUUID();
    // offlineDriver'a kasıtlı olarak socket kaydı YOK.
    await markDriverOnline(onlineDriver);
    await redis.rpush(REDIS_KEYS.matchingQueue(rideId), offlineDriver, onlineDriver);

    const acquired = await acquireNextDriver(rideId, 30, Date.now() + 30_000, Date.now() + 30_000);

    expect(acquired).toBe(onlineDriver);
  });

  it('zaten aktif teklifi olan (kilitli) sürücüyü atlar', async () => {
    const rideId = randomUUID();
    const busyDriver = randomUUID();
    const freeDriver = randomUUID();
    await markDriverOnline(busyDriver);
    await markDriverOnline(freeDriver);
    // busyDriver başka bir ride için zaten kilitli
    await redis.set(`${DRIVER_PENDING_OFFER_PREFIX}${busyDriver}`, 'baska-ride-id');
    await redis.rpush(REDIS_KEYS.matchingQueue(rideId), busyDriver, freeDriver);

    const acquired = await acquireNextDriver(rideId, 30, Date.now() + 30_000, Date.now() + 30_000);

    expect(acquired).toBe(freeDriver);
  });

  it('kuyrukta uygun sürücü kalmazsa null döner', async () => {
    const rideId = randomUUID();
    // Kuyruk hiç yok / boş.
    const acquired = await acquireNextDriver(rideId, 30, Date.now() + 30_000, Date.now() + 30_000);
    expect(acquired).toBeNull();
  });

  it('eşzamanlı çağrılar aynı sürücüyü iki kez devretmez (atomiklik)', async () => {
    const rideId = randomUUID();
    const driverA = randomUUID();
    const driverB = randomUUID();
    await markDriverOnline(driverA);
    await markDriverOnline(driverB);
    await redis.rpush(REDIS_KEYS.matchingQueue(rideId), driverA, driverB);

    const [first, second] = await Promise.all([
      acquireNextDriver(rideId, 30, Date.now() + 30_000, Date.now() + 30_000),
      acquireNextDriver(rideId, 30, Date.now() + 30_000, Date.now() + 30_000),
    ]);

    const winners = [first, second].filter((x): x is string => x !== null);
    expect(winners).toHaveLength(2);
    expect(new Set(winners).size).toBe(2); // ikisi de farklı sürücü, çakışma yok
    expect(new Set(winners)).toEqual(new Set([driverA, driverB]));
  });
});
