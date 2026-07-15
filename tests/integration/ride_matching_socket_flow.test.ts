/**
 * Uçtan uca "istek → teklif → timeout → sıradaki sürücü" akışı — gerçek
 * Socket.io sunucusu + socket.io-client bağlantıları + gerçek Postgres
 * (PostgREST üzerinden, supabaseAdmin ile) + gerçek Redis'e karşı.
 *
 * Kapsam sınırı: smart_matching.service.ts'in sendRequestToNextDriver()'dan
 * başlıyoruz (aday sürücü kuyruğunu Redis'e biz elle yazıyoruz) — startSmartMatching()'in
 * "yakın sürücü bul + Google Distance Matrix ile sırala" aşaması bu testin
 * kapsamı dışında (harici API bağımlılığı; bkz. docs/KOD_ANALIZI_VE_YOL_HARITASI_2026-07-12.md).
 * sendRequestToNextDriver()'dan itibaren her şey GERÇEK kod: driver.handler.ts'in
 * driver:go_online'ı, socketAuthMiddleware, acquireNextDriver'ın Lua'sı,
 * notificationService, ve zamanlayıcı tabanlı handleOfferTimeout zinciri.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { startPostgrestStack, type PostgrestStack } from '../support/postgrest_stack';
import { startTestRedis, waitForRedisReady } from '../support/redis';
import { setDummyAppEnv } from '../support/env';
import { insertCustomer, insertDriver, insertSearchingRide } from '../support/fixtures';
import type { StartedRedisContainer } from '@testcontainers/redis';

describe('eşleştirme akışı: teklif → yanıtsızlık → sıradaki sürücüye geçiş (gerçek socket)', () => {
  let stack: PostgrestStack;
  let redisContainer: StartedRedisContainer;
  let httpServer: http.Server;
  let baseUrl: string;

  let sendRequestToNextDriver: typeof import('../../src/services/smart_matching.service').sendRequestToNextDriver;
  let clearSmartMatchingQueue: typeof import('../../src/services/smart_matching.service').clearSmartMatchingQueue;
  let REDIS_KEYS: typeof import('../../src/services/smart_matching.service').REDIS_KEYS;
  let redis: typeof import('../../src/config/redis').redis;
  let generateAccessToken: typeof import('../../src/utils/jwt').generateAccessToken;

  beforeAll(async () => {
    [stack, redisContainer] = await Promise.all([startPostgrestStack(), startTestRedis()]);

    setDummyAppEnv({
      SUPABASE_URL: stack.postgrest.supabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: stack.postgrest.serviceRoleKey,
      SUPABASE_ANON_KEY: stack.postgrest.anonKey,
      REDIS_HOST: redisContainer.getHost(),
      REDIS_PORT: String(redisContainer.getPort()),
      // Sürücü yanıt penceresi min 5sn'ye clamp'leniyor (platform_settings.service.ts) —
      // testin gerçek zamanlayıcıyı beklemesi için en kısa değer.
      DRIVER_RESPONSE_TIMEOUT_SECONDS: '5',
    });

    const smartMatching = await import('../../src/services/smart_matching.service');
    const redisConfig = await import('../../src/config/redis');
    const jwtUtils = await import('../../src/utils/jwt');
    const socketManager = await import('../../src/sockets/socket.manager');

    sendRequestToNextDriver = smartMatching.sendRequestToNextDriver;
    clearSmartMatchingQueue = smartMatching.clearSmartMatchingQueue;
    REDIS_KEYS = smartMatching.REDIS_KEYS;
    redis = redisConfig.redis;
    generateAccessToken = jwtUtils.generateAccessToken;

    await waitForRedisReady(redis);

    httpServer = http.createServer();
    socketManager.initSocketManager(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const port = (httpServer.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;
  }, 180_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await redis.quit();
    await redisContainer.stop();
    await stack.stop();
  });

  function connectDriverSocket(driverId: string): Promise<ClientSocket> {
    const token = generateAccessToken({ userId: driverId, role: 'driver', sessionVersion: 0 });
    const socket = ioClient(baseUrl, {
      auth: { token },
      transports: ['websocket'],
      forceNew: true,
    });
    return new Promise((resolve, reject) => {
      socket.once('connect', () => resolve(socket));
      socket.once('connect_error', reject);
    });
  }

  function goOnlineAndWaitConfirmed(socket: ClientSocket): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('driver:online_confirmed gelmedi')), 10_000);
      socket.once('driver:online_confirmed', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once('driver:online_blocked', (payload: unknown) => {
        clearTimeout(timer);
        reject(new Error(`driver:online_blocked: ${JSON.stringify(payload)}`));
      });
      socket.emit('driver:go_online', {});
    });
  }

  it('birinci sürücü yanıt vermezse teklif otomatik olarak ikinci sürücüye geçer', async () => {
    const customerId = await insertCustomer(stack.pool);
    const driver1Id = await insertDriver(stack.pool, { balance: 50 });
    const driver2Id = await insertDriver(stack.pool, { balance: 50 });
    const rideId = await insertSearchingRide(stack.pool, customerId, { estimatedPrice: 120 });

    const driver1Socket = await connectDriverSocket(driver1Id);
    const driver2Socket = await connectDriverSocket(driver2Id);
    await Promise.all([
      goOnlineAndWaitConfirmed(driver1Socket),
      goOnlineAndWaitConfirmed(driver2Socket),
    ]);

    // Aday kuyruğu: startSmartMatching'in "yakın sürücü bul" aşaması bu testin
    // kapsamı dışında — kuyruğu doğrudan Redis LIST olarak kuruyoruz.
    await redis.rpush(REDIS_KEYS.matchingQueue(rideId), driver1Id, driver2Id);

    const offer1 = new Promise<{ rideId: string; targetDriverId: string }>((resolve) => {
      driver1Socket.once('ride:new_request', resolve);
    });
    const offer2 = new Promise<{ rideId: string; targetDriverId: string }>((resolve) => {
      driver2Socket.once('ride:new_request', resolve);
    });

    await sendRequestToNextDriver(rideId, customerId, 39.8468, 33.515);

    const firstOffer = await offer1;
    expect(firstOffer.rideId).toBe(rideId);
    expect(firstOffer.targetDriverId).toBe(driver1Id);

    // driver1 kasıtlı olarak yanıt vermiyor — sunucu içi setTimeout (5sn + tampon)
    // dolunca otomatik olarak driver2'ye geçmeli.
    const secondOffer = await offer2;
    expect(secondOffer.rideId).toBe(rideId);
    expect(secondOffer.targetDriverId).toBe(driver2Id);

    // driver2'nin teklifi test bitince de açık kalır (in-memory timeout ~5.4sn sonra
    // ateşlenir) — temizlemezsek bu timer sonraki testler çalışırken tetiklenip
    // (gerçek find_nearby_drivers ile) başka testin sürücülerini bulup çapraz kirlilik
    // yaratabilir. Testler arası izolasyon için açıkça temizliyoruz.
    await clearSmartMatchingQueue(rideId, false);

    driver1Socket.disconnect();
    driver2Socket.disconnect();
  }, 20_000);

  it('paralel dalga (2): teklif iki sürücüye AYNI ANDA gider; ilk kabul eden kazanır, diğerine accepted_by_other iptali gider', async () => {
    const settings = await import('../../src/services/platform_settings.service');
    // Dalga boyutunu 2'ye çek (platform_settings tablosu migration'larla mevcut) —
    // test sonunda 1'e geri alınır ki dosyadaki diğer testler sıralı davranışta kalsın.
    await settings.updatePlatformSettings({ matchingOfferWaveSize: 2 });

    const customerId = await insertCustomer(stack.pool);
    const driver1Id = await insertDriver(stack.pool, { balance: 50 });
    const driver2Id = await insertDriver(stack.pool, { balance: 50 });
    const rideId = await insertSearchingRide(stack.pool, customerId, { estimatedPrice: 120 });

    const driver1Socket = await connectDriverSocket(driver1Id);
    const driver2Socket = await connectDriverSocket(driver2Id);

    try {
      await Promise.all([
        goOnlineAndWaitConfirmed(driver1Socket),
        goOnlineAndWaitConfirmed(driver2Socket),
      ]);

      await redis.rpush(REDIS_KEYS.matchingQueue(rideId), driver1Id, driver2Id);

      const offer1 = new Promise<{ rideId: string; targetDriverId: string }>((resolve) => {
        driver1Socket.once('ride:new_request', resolve);
      });
      const offer2 = new Promise<{ rideId: string; targetDriverId: string }>((resolve) => {
        driver2Socket.once('ride:new_request', resolve);
      });

      await sendRequestToNextDriver(rideId, customerId, 39.8468, 33.515);

      // İKİ teklif de tek doldurma turunda gelmeli — timeout beklenmeden (sıralı akışta
      // ikinci teklif ancak ~5sn sonra gelirdi; burada ikisi de anında).
      const [firstOffer, secondOffer] = await Promise.all([offer1, offer2]);
      expect(firstOffer.rideId).toBe(rideId);
      expect(secondOffer.rideId).toBe(rideId);

      // driver2'nin teklifi, driver1 kabul edince accepted_by_other ile kapanmalı.
      const cancelledOnDriver2 = new Promise<{ rideId: string; reason: string }>((resolve) => {
        driver2Socket.once('ride:request_cancelled', resolve);
      });
      const revealOnDriver1 = new Promise<{ rideId: string }>((resolve) => {
        driver1Socket.once('ride:reveal_location', resolve);
      });

      driver1Socket.emit('ride:accept', { rideId });

      const cancelMsg = await cancelledOnDriver2;
      expect(cancelMsg.rideId).toBe(rideId);
      expect(cancelMsg.reason).toBe('accepted_by_other');

      await revealOnDriver1; // kabul akışı sürücü tarafında tamamlandı

      // DB'de kazanan driver1; atomik accept_ride_with_fee tek kabul garantiler.
      const { rows } = await stack.pool.query(
        'SELECT status, driver_id FROM rides WHERE id = $1',
        [rideId],
      );
      expect(rows[0].status).toBe('accepted');
      expect(rows[0].driver_id).toBe(driver1Id);

      // Kaybeden sürücünün teklif kilidi temizlendi — yeni çağrı alabilir.
      const driver2Lock = await redis.get(`driver:pending_offer:${driver2Id}`);
      expect(driver2Lock).toBeNull();
    } finally {
      driver1Socket.disconnect();
      driver2Socket.disconnect();
      await settings.updatePlatformSettings({ matchingOfferWaveSize: 1 });
    }
  }, 30_000);

  it('paralel dalga (2): bir sürücü reddedince dalga kuyruktaki sıradaki sürücüyle ANINDA doldurulur', async () => {
    const settings = await import('../../src/services/platform_settings.service');
    await settings.updatePlatformSettings({ matchingOfferWaveSize: 2 });

    const customerId = await insertCustomer(stack.pool);
    const driver1Id = await insertDriver(stack.pool, { balance: 50 });
    const driver2Id = await insertDriver(stack.pool, { balance: 50 });
    const driver3Id = await insertDriver(stack.pool, { balance: 50 });
    const rideId = await insertSearchingRide(stack.pool, customerId, { estimatedPrice: 120 });

    const driver1Socket = await connectDriverSocket(driver1Id);
    const driver2Socket = await connectDriverSocket(driver2Id);
    const driver3Socket = await connectDriverSocket(driver3Id);

    try {
      await Promise.all([
        goOnlineAndWaitConfirmed(driver1Socket),
        goOnlineAndWaitConfirmed(driver2Socket),
        goOnlineAndWaitConfirmed(driver3Socket),
      ]);

      await redis.rpush(REDIS_KEYS.matchingQueue(rideId), driver1Id, driver2Id, driver3Id);

      const offer1 = new Promise<{ rideId: string }>((resolve) => {
        driver1Socket.once('ride:new_request', resolve);
      });
      const offer2 = new Promise<{ rideId: string }>((resolve) => {
        driver2Socket.once('ride:new_request', resolve);
      });
      const offer3 = new Promise<{ rideId: string; targetDriverId: string }>((resolve) => {
        driver3Socket.once('ride:new_request', resolve);
      });

      await sendRequestToNextDriver(rideId, customerId, 39.8468, 33.515);
      await Promise.all([offer1, offer2]); // dalga: driver1 + driver2

      // driver1 reddeder → boşalan slot timeout BEKLENMEDEN driver3 ile dolmalı.
      driver1Socket.emit('ride:reject', { rideId });

      const thirdOffer = await offer3;
      expect(thirdOffer.rideId).toBe(rideId);
      expect(thirdOffer.targetDriverId).toBe(driver3Id);

      // driver2'nin teklifi hâlâ açık (ret dalganın kalanını etkilemez).
      const driver2Lock = await redis.get(`driver:pending_offer:${driver2Id}`);
      expect(driver2Lock).toBe(rideId);

      // driver2 ve driver3'ün teklifleri test bitince de açık kalır — temizlemezsek
      // in-memory timeout'ları sonraki testler sırasında ateşlenip (gerçek
      // find_nearby_drivers ile) çapraz kirliliğe yol açabilir.
      await clearSmartMatchingQueue(rideId, false);
    } finally {
      driver1Socket.disconnect();
      driver2Socket.disconnect();
      driver3Socket.disconnect();
      await settings.updatePlatformSettings({ matchingOfferWaveSize: 1 });
    }
  }, 30_000);

  it('ikinci dalga araması: kuyruk tükenip vazgeçmeden önce YENİDEN arar ve o sırada çevrimiçi olan sürücüyü bulur', async () => {
    const customerId = await insertCustomer(stack.pool);
    const driver1Id = await insertDriver(stack.pool, { balance: 50 });
    const rideId = await insertSearchingRide(stack.pool, customerId, { estimatedPrice: 120 });

    const driver1Socket = await connectDriverSocket(driver1Id);
    await goOnlineAndWaitConfirmed(driver1Socket);

    // İlk "arama" bu testin kapsamı dışında — kuyruğa yalnızca driver1'i koyuyoruz,
    // driver2 henüz DB'de/çevrimiçi bile değil (gerçek find_nearby_drivers onu bulamazdı).
    await redis.rpush(REDIS_KEYS.matchingQueue(rideId), driver1Id);

    const offer1 = new Promise<{ rideId: string; targetDriverId: string }>((resolve) => {
      driver1Socket.once('ride:new_request', resolve);
    });

    await sendRequestToNextDriver(rideId, customerId, 39.8468, 33.515);
    await offer1;

    // driver1'in 5sn+tampon yanıt penceresi dolmadan ÖNCE driver2 sisteme girip
    // çevrimiçi olur — retrySearchOnce'ın GERÇEK find_nearby_drivers RPC'siyle
    // onu yakalayabildiğini doğruluyoruz (kuyruğa elle eklenmedi).
    const driver2Id = await insertDriver(stack.pool, { balance: 50 });
    const driver2Socket = await connectDriverSocket(driver2Id);
    await goOnlineAndWaitConfirmed(driver2Socket);

    const offerToDriver2 = new Promise<{ rideId: string; targetDriverId: string }>((resolve) => {
      driver2Socket.once('ride:new_request', resolve);
    });

    // driver1 kasıtlı yanıt vermiyor — timeout sonrası kuyruk boşalınca ikinci dalga
    // araması tetiklenmeli ve gerçek RPC ile driver2'yi bulup teklif göndermeli.
    const secondWaveOffer = await offerToDriver2;
    expect(secondWaveOffer.rideId).toBe(rideId);
    expect(secondWaveOffer.targetDriverId).toBe(driver2Id);

    await clearSmartMatchingQueue(rideId, false);
    driver1Socket.disconnect();
    driver2Socket.disconnect();
  }, 20_000);
});
