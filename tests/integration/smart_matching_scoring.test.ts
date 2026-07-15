/**
 * scoreAndRankDrivers'ın süre (ETA) bandı + skor sıralaması.
 *
 * 15 Tem 2026: önceden ham metreyle sıralanıyordu ve skor yalnızca iki sürücü 1 metreden
 * az farklıysa devreye giriyordu (pratikte hemen hiç gerçekleşmiyordu) — DISTANCE_BAND_M
 * (400m) genişliğinde bantlanacak şekilde düzeltildi.
 *
 * Aynı gün, ikinci bir düzeltme: bantlama ve skorun "mesafe" bileşeni artık METRE değil
 * SÜRE (duration_s, saniye) üzerinden çalışıyor — Google Distance Matrix zaten süreyi de
 * döndürüyor; trafik/tek yön yollarda "en yakın metre" yanıltıcı olabiliyordu (400m ama
 * 8dk süren sürücü, 600m ama 3dk süren sürücünün önüne geçebiliyordu). `distance_m` hâlâ
 * nesnede duruyor (gösterim/log için) ama sıralamayı etkilemiyor.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { StartedRedisContainer } from '@testcontainers/redis';
import { startTestRedis, waitForRedisReady } from '../support/redis';
import { setDummyAppEnv } from '../support/env';

describe('smart_matching: scoreAndRankDrivers (süre bandı + skor)', () => {
  let container: StartedRedisContainer;
  let redis: import('ioredis').Redis;
  let scoreAndRankDrivers: typeof import('../../src/services/smart_matching.service').scoreAndRankDrivers;
  let REDIS_KEYS: typeof import('../../src/services/smart_matching.service').REDIS_KEYS;

  beforeAll(async () => {
    container = await startTestRedis();
    setDummyAppEnv({
      REDIS_HOST: container.getHost(),
      REDIS_PORT: String(container.getPort()),
    });

    const smartMatching = await import('../../src/services/smart_matching.service');
    const redisConfig = await import('../../src/config/redis');
    redis = redisConfig.redis;
    scoreAndRankDrivers = smartMatching.scoreAndRankDrivers;
    REDIS_KEYS = smartMatching.REDIS_KEYS;

    await waitForRedisReady(redis);
  }, 120_000);

  afterAll(async () => {
    await redis.quit();
    await container.stop();
  });

  async function seedStats(
    driverId: string,
    stats: { dailyRides: number; acceptanceRate: number },
  ): Promise<void> {
    await redis.setex(REDIS_KEYS.driverStats(driverId), 300, JSON.stringify(stats));
  }

  it('aynı süre bandında en iyi profil kazanır, daha kısa sürede olsa bile en kötü profil kaybeder', async () => {
    const worseButFaster = randomUUID();
    const betterButSlower = randomUUID();

    // İkisi de aynı bantta (DURATION_BAND_S=90 → ikisi de band 0)
    await seedStats(worseButFaster, { dailyRides: 20, acceptanceRate: 0.4 });
    await seedStats(betterButSlower, { dailyRides: 0, acceptanceRate: 0.98 });

    const ranked = await scoreAndRankDrivers(
      [
        { id: worseButFaster, lat: 0, lng: 0, rating: 3.0, rating_count: 50, distance_m: 500, duration_s: 30 },
        { id: betterButSlower, lat: 0, lng: 0, rating: 5.0, rating_count: 100, distance_m: 400, duration_s: 70 },
      ],
      new Set(),
    );

    expect(ranked.map((d) => d.id)).toEqual([betterButSlower, worseButFaster]);
  });

  it('farklı süre bandındaysa en iyi profil bile daha kısa süreli olanı geçemez', async () => {
    const near = randomUUID();
    const farWithBestProfile = randomUUID();

    // near: band 0 (30sn), farWithBestProfile: band 1 (150sn) — farklı bant
    await seedStats(near, { dailyRides: 20, acceptanceRate: 0.4 });
    await seedStats(farWithBestProfile, { dailyRides: 0, acceptanceRate: 1.0 });

    const ranked = await scoreAndRankDrivers(
      [
        { id: near, lat: 0, lng: 0, rating: 3.0, rating_count: 50, distance_m: 100, duration_s: 30 },
        { id: farWithBestProfile, lat: 0, lng: 0, rating: 5.0, rating_count: 100, distance_m: 5000, duration_s: 150 },
      ],
      new Set(),
    );

    expect(ranked.map((d) => d.id)).toEqual([near, farWithBestProfile]);
  });

  it('metre yerine süre belirleyicidir: metre olarak daha uzak ama trafikte daha hızlı sürücü kazanır', async () => {
    const closeMetersSlowTraffic = randomUUID();
    const farMetersFastRoad = randomUUID();

    // Aynı istatistikler — yalnızca mesafe/süre farkı sıralamayı belirlemeli.
    await seedStats(closeMetersSlowTraffic, { dailyRides: 5, acceptanceRate: 0.8 });
    await seedStats(farMetersFastRoad, { dailyRides: 5, acceptanceRate: 0.8 });

    const ranked = await scoreAndRankDrivers(
      [
        // 400m ama trafikte 8dk (480sn) sürüyor
        { id: closeMetersSlowTraffic, lat: 0, lng: 0, rating: 4.5, rating_count: 10, distance_m: 400, duration_s: 480 },
        // 600m ama ana yoldan 3dk (180sn) sürüyor — metre olarak daha uzak, süre olarak daha kısa
        { id: farMetersFastRoad, lat: 0, lng: 0, rating: 4.5, rating_count: 10, distance_m: 600, duration_s: 180 },
      ],
      new Set(),
    );

    expect(ranked.map((d) => d.id)).toEqual([farMetersFastRoad, closeMetersSlowTraffic]);
  });

  it('reddeden sürücüleri (rejectedIds) sonuçtan tamamen çıkarır', async () => {
    const kept = randomUUID();
    const rejected = randomUUID();
    await seedStats(kept, { dailyRides: 5, acceptanceRate: 0.8 });
    await seedStats(rejected, { dailyRides: 5, acceptanceRate: 0.8 });

    const ranked = await scoreAndRankDrivers(
      [
        { id: kept, lat: 0, lng: 0, rating: 4.5, rating_count: 10, distance_m: 200, duration_s: 40 },
        { id: rejected, lat: 0, lng: 0, rating: 4.5, rating_count: 10, distance_m: 200, duration_s: 40 },
      ],
      new Set([rejected]),
    );

    expect(ranked.map((d) => d.id)).toEqual([kept]);
  });
});
