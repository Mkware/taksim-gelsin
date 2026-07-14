/**
 * scoreAndRankDrivers'ın mesafe bandı + skor sıralaması — 15 Tem 2026'da
 * düzeltilen davranış: önceden ham metreyle sıralanıyordu ve skor yalnızca
 * iki sürücü 1 metreden az farklıysa devreye giriyordu (pratikte hemen hiç
 * gerçekleşmiyordu). Artık DISTANCE_BAND_M (400m) genişliğinde bantlanıyor;
 * aynı bant içinde en iyi profil (puan/kabul oranı/adalet) kazanıyor, farklı
 * bantta ise hâlâ en yakın kazanıyor.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { StartedRedisContainer } from '@testcontainers/redis';
import { startTestRedis, waitForRedisReady } from '../support/redis';
import { setDummyAppEnv } from '../support/env';

describe('smart_matching: scoreAndRankDrivers (mesafe bandı + skor)', () => {
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

  it('aynı mesafe bandında en iyi profil kazanır, daha yakın olsa bile en kötü profil kaybeder', async () => {
    const worseButCloser = randomUUID();
    const betterButFarther = randomUUID();

    // İkisi de aynı bantta (DISTANCE_BAND_M=400 → ikisi de band 0)
    await seedStats(worseButCloser, { dailyRides: 20, acceptanceRate: 0.4 });
    await seedStats(betterButFarther, { dailyRides: 0, acceptanceRate: 0.98 });

    const ranked = await scoreAndRankDrivers(
      [
        { id: worseButCloser, lat: 0, lng: 0, rating: 3.0, rating_count: 50, distance_m: 100 },
        { id: betterButFarther, lat: 0, lng: 0, rating: 5.0, rating_count: 100, distance_m: 300 },
      ],
      new Set(),
    );

    expect(ranked.map((d) => d.id)).toEqual([betterButFarther, worseButCloser]);
  });

  it('farklı mesafe bandındaysa en iyi profil bile daha yakın olanı geçemez', async () => {
    const near = randomUUID();
    const farWithBestProfile = randomUUID();

    // near: band 0 (100m), farWithBestProfile: band 1 (500m) — farklı bant
    await seedStats(near, { dailyRides: 20, acceptanceRate: 0.4 });
    await seedStats(farWithBestProfile, { dailyRides: 0, acceptanceRate: 1.0 });

    const ranked = await scoreAndRankDrivers(
      [
        { id: near, lat: 0, lng: 0, rating: 3.0, rating_count: 50, distance_m: 100 },
        { id: farWithBestProfile, lat: 0, lng: 0, rating: 5.0, rating_count: 100, distance_m: 500 },
      ],
      new Set(),
    );

    expect(ranked.map((d) => d.id)).toEqual([near, farWithBestProfile]);
  });

  it('reddeden sürücüleri (rejectedIds) sonuçtan tamamen çıkarır', async () => {
    const kept = randomUUID();
    const rejected = randomUUID();
    await seedStats(kept, { dailyRides: 5, acceptanceRate: 0.8 });
    await seedStats(rejected, { dailyRides: 5, acceptanceRate: 0.8 });

    const ranked = await scoreAndRankDrivers(
      [
        { id: kept, lat: 0, lng: 0, rating: 4.5, rating_count: 10, distance_m: 200 },
        { id: rejected, lat: 0, lng: 0, rating: 4.5, rating_count: 10, distance_m: 200 },
      ],
      new Set([rejected]),
    );

    expect(ranked.map((d) => d.id)).toEqual([kept]);
  });
});
