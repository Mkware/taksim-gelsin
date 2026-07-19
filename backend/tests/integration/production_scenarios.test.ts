/**
 * Üretim öncesi kapsamlı senaryo paketi — günlük işleyişte karşılaşılacak akışların
 * tamamı GERÇEK yığında (Postgres+PostGIS + PostgREST + Redis + Socket.io) sürülür:
 *
 *   1. Tam yolculuk yaşam döngüsü (istek → eşleşme → kabul → varış → PIN → başlat → bitir)
 *      + canlı konum yayını müşteriye ulaşıyor mu
 *   2. Favori sürücü çağırma — teklif önce favoriye gider
 *   3. Favori sürücü uygun değilse normal aramaya düşüş
 *   4. Çift kabul yarışı (paralel dalga) — tek kazanan, kaybedene kesinti yok
 *   5. Son saniye kabulü — pencere dolmadan hemen önce kabul geçerli
 *   6. Geç kabul — süre dolduktan sonra kabul reddedilir, kesinti yapılmaz
 *   7. Müşteri aramada iptal eder — bekleyen sürücünün çağrısı geri çekilir
 *   8. Kabul sonrası müşteri iptali — sürücüye ride:cancelled ulaşır
 *   9. GPS/socket kopması (yolculuk ortasında) — grace içinde reconnect,
 *      snapshot restore + konum yayını devam eder
 *  10. Müşteri reconnect — snapshot'ta PIN + sürücü bilgisi geri gelir
 *  11. Disconnect grace (12 sn) dolunca: DB çevrimdışı + bekleyen teklif sıradakine devir
 *  12. Hiç sürücü yokken ride:no_driver_found + DB'de iptal
 *  13. Bakiye engelleri: yetersiz bakiyeyle çevrimiçi olamama; kabul ücretini
 *      karşılamayan bakiyeyle kabul reddi (kesinti yok)
 *
 * Eşleştirme akışının sıralı timeout/ret/dalga doldurma detayları
 * ride_matching_socket_flow.test.ts'te ayrıca kapsanıyor — burada tekrarlanmaz.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { startPostgrestStack, type PostgrestStack } from '../support/postgrest_stack';
import { startTestRedis, waitForRedisReady } from '../support/redis';
import { setDummyAppEnv } from '../support/env';
import { insertCustomer, insertDriver, insertSearchingRide } from '../support/fixtures';
import type { StartedRedisContainer } from '@testcontainers/redis';

/** Kırıkkale merkez — fixtures ile aynı koordinat (find_nearby_drivers menzili içinde) */
const PICKUP = { lat: 39.8468, lng: 33.515 };
const DROPOFF = { lat: 39.84, lng: 33.52 };

describe('üretim senaryoları: günlük işleyişin uçtan uca doğrulanması', () => {
  let stack: PostgrestStack;
  let redisContainer: StartedRedisContainer;
  let httpServer: http.Server;
  let baseUrl: string;

  let smartMatching: typeof import('../../src/services/smart_matching.service');
  let settings: typeof import('../../src/services/platform_settings.service');
  let redis: typeof import('../../src/config/redis').redis;
  let generateAccessToken: typeof import('../../src/utils/jwt').generateAccessToken;

  const openSockets: ClientSocket[] = [];

  beforeAll(async () => {
    [stack, redisContainer] = await Promise.all([startPostgrestStack(), startTestRedis()]);

    setDummyAppEnv({
      SUPABASE_URL: stack.postgrest.supabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: stack.postgrest.serviceRoleKey,
      SUPABASE_ANON_KEY: stack.postgrest.anonKey,
      REDIS_HOST: redisContainer.getHost(),
      REDIS_PORT: String(redisContainer.getPort()),
      DRIVER_RESPONSE_TIMEOUT_SECONDS: '5',
    });

    // Backend loglarını dosyaya da yaz (vitest geçen testlerin konsol çıktısını
    // gizlediği için) — yalnızca SCENARIO_LOG_FILE verilmişse (yerel inceleme).
    if (process.env.SCENARIO_LOG_FILE) {
      const winston = (await import('winston')).default;
      const { logger } = await import('../../src/utils/logger');
      logger.add(new winston.transports.File({ filename: process.env.SCENARIO_LOG_FILE }));
    }

    smartMatching = await import('../../src/services/smart_matching.service');
    settings = await import('../../src/services/platform_settings.service');
    redis = (await import('../../src/config/redis')).redis;
    generateAccessToken = (await import('../../src/utils/jwt')).generateAccessToken;
    const socketManager = await import('../../src/sockets/socket.manager');

    await waitForRedisReady(redis);

    httpServer = http.createServer();
    socketManager.initSocketManager(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  }, 180_000);

  // Her test tamamen izole başlar: önceki testin sürücüleri (DB'de çevrimiçi kalmış
  // ama socket'i ölü) gerçek find_nearby_drivers aramasına takılıp sahte timeout
  // zincirleri yaratmasın diye hepsi çevrimdışına çekilir; Redis'teki socket/teklif/
  // kuyruk artıkları da silinir.
  beforeEach(async () => {
    await redis.flushdb();
    await stack.pool.query('UPDATE drivers SET is_online = false, is_available = false');
  });

  afterAll(async () => {
    for (const s of openSockets) {
      try { s.disconnect(); } catch { /* */ }
    }
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await redis.quit();
    await redisContainer.stop();
    await stack.stop();
  });

  // ── Yardımcılar ────────────────────────────────────────────────────────────

  function connectSocket(userId: string, role: 'customer' | 'driver'): Promise<ClientSocket> {
    const token = generateAccessToken({ userId, role, sessionVersion: 0 });
    const socket = ioClient(baseUrl, {
      auth: { token },
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });
    openSockets.push(socket);
    return new Promise((resolve, reject) => {
      socket.once('connect', () => resolve(socket));
      socket.once('connect_error', reject);
    });
  }

  function goOnline(socket: ClientSocket): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('driver:online_confirmed gelmedi')), 10_000);
      socket.once('driver:online_confirmed', () => { clearTimeout(timer); resolve(); });
      socket.once('driver:online_blocked', (p: unknown) => {
        clearTimeout(timer);
        reject(new Error(`driver:online_blocked: ${JSON.stringify(p)}`));
      });
      socket.emit('driver:go_online', {});
    });
  }

  /** Belirtilen event'i bekler; timeout'ta hangi event'in beklendiğini söyleyen hata fırlatır. */
  function waitForEvent<T = Record<string, unknown>>(
    socket: ClientSocket,
    event: string,
    timeoutMs = 10_000,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`'${event}' ${timeoutMs} ms içinde gelmedi`)),
        timeoutMs,
      );
      socket.once(event, (payload: T) => { clearTimeout(timer); resolve(payload); });
    });
  }

  function emitRideRequest(
    customerSocket: ClientSocket,
    opts: { preferredDriverId?: string } = {},
  ): void {
    customerSocket.emit('ride:request', {
      pickup: PICKUP,
      dropoff: DROPOFF,
      pickupAddress: 'Test biniş adresi',
      dropoffAddress: 'Test varış adresi',
      distanceKm: 1.2,
      estimatedPrice: 100,
      ...opts,
    });
  }

  async function dbRide(rideId: string): Promise<{
    status: string; driver_id: string | null; final_price: number | null;
    pickup_verification_code: string | null; pickup_code_verified: boolean;
  }> {
    const { rows } = await stack.pool.query(
      `SELECT status, driver_id, final_price, pickup_verification_code, pickup_code_verified
       FROM rides WHERE id = $1`,
      [rideId],
    );
    return rows[0];
  }

  async function dbDriverBalance(driverId: string): Promise<number> {
    const { rows } = await stack.pool.query('SELECT balance FROM drivers WHERE id = $1', [driverId]);
    return Number(rows[0].balance);
  }

  async function dbDriverOnline(driverId: string): Promise<boolean> {
    const { rows } = await stack.pool.query('SELECT is_online FROM drivers WHERE id = $1', [driverId]);
    return Boolean(rows[0].is_online);
  }

  /** Test sonu temizliği: dalga timer'ları sonraki testlere sızmasın. */
  async function cleanupRide(rideId: string): Promise<void> {
    await smartMatching.clearSmartMatchingQueue(rideId, false);
  }

  // ── 1. Tam yolculuk yaşam döngüsü ─────────────────────────────────────────

  it('tam yaşam döngüsü: istek → eşleşme → kabul → konum yayını → varış → yanlış PIN reddi → doğru PIN → başlat → tamamla', async () => {
    const customerId = await insertCustomer(stack.pool);
    const driverId = await insertDriver(stack.pool, { balance: 50 });

    const customerSocket = await connectSocket(customerId, 'customer');
    const driverSocket = await connectSocket(driverId, 'driver');
    await goOnline(driverSocket);

    const searching = waitForEvent<{ rideId: string }>(customerSocket, 'ride:searching');
    const offer = waitForEvent<{ rideId: string; targetDriverId: string }>(driverSocket, 'ride:new_request');
    const progress = waitForEvent<{ driversQueued: number }>(customerSocket, 'ride:matching_progress');

    emitRideRequest(customerSocket);

    const { rideId } = await searching;
    expect(rideId).toBeTruthy();

    const offerMsg = await offer;
    expect(offerMsg.rideId).toBe(rideId);
    expect(offerMsg.targetDriverId).toBe(driverId);

    const progressMsg = await progress;
    expect(progressMsg.driversQueued).toBeGreaterThanOrEqual(1);

    // Kabul → müşteriye ride:accepted (PIN dahil), sürücüye reveal_location
    const accepted = waitForEvent<{ rideId: string; verificationCode: string }>(customerSocket, 'ride:accepted');
    const reveal = waitForEvent<{ rideId: string; pickup: { lat: number } }>(driverSocket, 'ride:reveal_location');
    driverSocket.emit('ride:accept', { rideId });

    const acceptedMsg = await accepted;
    expect(acceptedMsg.rideId).toBe(rideId);
    expect(acceptedMsg.verificationCode).toMatch(/^\d{4}$/);
    await reveal;

    let ride = await dbRide(rideId);
    expect(ride.status).toBe('accepted');
    expect(ride.driver_id).toBe(driverId);

    // Kabul ücreti kesildi mi? (100 TL × %7 = 7 T Coin)
    const balanceAfterAccept = await dbDriverBalance(driverId);
    expect(balanceAfterAccept).toBeLessThan(50);

    // Canlı konum: sürücü konum gönderir → müşteri yayını alır
    const locationBroadcast = waitForEvent<{ driverId: string; lat: number; lng: number }>(
      customerSocket, 'driver:location:broadcast',
    );
    driverSocket.emit('driver:location:update', { lat: 39.845, lng: 33.514, bearing: 90 });
    const loc = await locationBroadcast;
    expect(loc.driverId).toBe(driverId);
    expect(loc.lat).toBeCloseTo(39.845, 3);

    // Varış
    const arrived = waitForEvent<{ rideId: string }>(customerSocket, 'ride:driver_arrived');
    driverSocket.emit('ride:arrived', { rideId });
    await arrived;
    ride = await dbRide(rideId);
    expect(ride.status).toBe('arriving');

    // PIN doğrulanmadan başlatma reddedilmeli
    const startRejected = waitForEvent<{ message: string }>(driverSocket, 'ride:start_rejected');
    driverSocket.emit('ride:start', { rideId });
    await startRejected;

    // Yanlış PIN → ok:false
    const correctPin = ride.pickup_verification_code!;
    const wrongPin = correctPin === '0000' ? '1111' : '0000';
    const wrongResult = waitForEvent<{ ok: boolean }>(driverSocket, 'ride:pickup_code_result');
    driverSocket.emit('ride:verify_pickup_code', { rideId, code: wrongPin });
    expect((await wrongResult).ok).toBe(false);

    // Doğru PIN (müşterinin ride:accepted'ta aldığı kodla aynı olmalı) → ok:true
    expect(acceptedMsg.verificationCode).toBe(correctPin);
    const okResult = waitForEvent<{ ok: boolean }>(driverSocket, 'ride:pickup_code_result');
    driverSocket.emit('ride:verify_pickup_code', { rideId, code: correctPin });
    expect((await okResult).ok).toBe(true);

    // Başlat
    const started = waitForEvent<{ rideId: string }>(customerSocket, 'ride:started');
    driverSocket.emit('ride:start', { rideId });
    await started;
    expect((await dbRide(rideId)).status).toBe('in_progress');

    // Tamamla
    const completed = waitForEvent<{ rideId: string; finalPrice: number }>(customerSocket, 'ride:completed');
    driverSocket.emit('ride:complete', { rideId, finalPrice: 150 });
    const completedMsg = await completed;
    expect(completedMsg.finalPrice).toBe(150);

    ride = await dbRide(rideId);
    expect(ride.status).toBe('completed');
    expect(Number(ride.final_price)).toBe(150);

    await cleanupRide(rideId);
    driverSocket.emit('driver:go_offline', {});
    customerSocket.disconnect();
  }, 40_000);

  // ── 2. Favori sürücü çağırma ──────────────────────────────────────────────

  it('favori sürücü: preferredDriverId verilince teklif normal sıralamayı atlayıp önce favoriye gider', async () => {
    const customerId = await insertCustomer(stack.pool);
    const normalDriverId = await insertDriver(stack.pool, { balance: 50 });
    const favoriteDriverId = await insertDriver(stack.pool, { balance: 50 });

    const customerSocket = await connectSocket(customerId, 'customer');
    const normalSocket = await connectSocket(normalDriverId, 'driver');
    const favoriteSocket = await connectSocket(favoriteDriverId, 'driver');
    await Promise.all([goOnline(normalSocket), goOnline(favoriteSocket)]);

    let normalGotOffer = false;
    normalSocket.on('ride:new_request', () => { normalGotOffer = true; });

    const favoriteOffer = waitForEvent<{ rideId: string; targetDriverId: string }>(
      favoriteSocket, 'ride:new_request',
    );
    const searching = waitForEvent<{ rideId: string }>(customerSocket, 'ride:searching');

    emitRideRequest(customerSocket, { preferredDriverId: favoriteDriverId });

    const { rideId } = await searching;
    const offerMsg = await favoriteOffer;
    expect(offerMsg.targetDriverId).toBe(favoriteDriverId);
    // Favori akışında kuyruğa YALNIZCA favori girer — diğer sürücüye teklif gitmemeli
    expect(normalGotOffer).toBe(false);

    // Favori kabul eder → normal akış devam ediyor
    const accepted = waitForEvent<{ rideId: string }>(customerSocket, 'ride:accepted');
    favoriteSocket.emit('ride:accept', { rideId });
    await accepted;
    expect((await dbRide(rideId)).driver_id).toBe(favoriteDriverId);

    await cleanupRide(rideId);
    normalSocket.emit('driver:go_offline', {});
    // favori sürücünün aktif yolculuğu var — go_offline yerine yolculuğu iptal edip kapat
    const cancelled = waitForEvent<{ rideId: string }>(customerSocket, 'ride:cancelled');
    customerSocket.emit('ride:cancel', { rideId, reason: 'test temizliği' });
    await cancelled;
    favoriteSocket.emit('driver:go_offline', {});
    customerSocket.disconnect();
  }, 30_000);

  // ── 3. Favori uygun değil → normal aramaya düşüş ──────────────────────────

  it('favori sürücü çevrimdışıysa istek normal yakınlık aramasına düşer ve diğer sürücü teklifi alır', async () => {
    const customerId = await insertCustomer(stack.pool);
    const onlineDriverId = await insertDriver(stack.pool, { balance: 50 });
    // Favori: DB'de var ama socket'i yok (uygulaması kapalı) — canlı socket kontrolünden geçemez
    const offlineFavoriteId = await insertDriver(stack.pool, { balance: 50 });
    await stack.pool.query('UPDATE drivers SET is_online = false, is_available = false WHERE id = $1', [offlineFavoriteId]);

    const customerSocket = await connectSocket(customerId, 'customer');
    const onlineSocket = await connectSocket(onlineDriverId, 'driver');
    await goOnline(onlineSocket);

    const offer = waitForEvent<{ rideId: string; targetDriverId: string }>(onlineSocket, 'ride:new_request');
    const searching = waitForEvent<{ rideId: string }>(customerSocket, 'ride:searching');

    emitRideRequest(customerSocket, { preferredDriverId: offlineFavoriteId });

    const { rideId } = await searching;
    const offerMsg = await offer;
    expect(offerMsg.rideId).toBe(rideId);
    expect(offerMsg.targetDriverId).toBe(onlineDriverId);

    await cleanupRide(rideId);
    const cancelled = waitForEvent<{ rideId: string }>(customerSocket, 'ride:cancelled');
    customerSocket.emit('ride:cancel', { rideId, reason: 'test temizliği' });
    await cancelled;
    onlineSocket.emit('driver:go_offline', {});
    customerSocket.disconnect();
  }, 30_000);

  // ── 4. Çift kabul yarışı ──────────────────────────────────────────────────

  it('çift kabul yarışı (dalga 2): iki sürücü AYNI ANDA kabul eder — tek kazanan, kaybedene kesinti yok', async () => {
    await settings.updatePlatformSettings({ matchingOfferWaveSize: 2 });
    const customerId = await insertCustomer(stack.pool);
    const driver1Id = await insertDriver(stack.pool, { balance: 50 });
    const driver2Id = await insertDriver(stack.pool, { balance: 50 });
    const rideId = await insertSearchingRide(stack.pool, customerId, { estimatedPrice: 100 });

    const driver1Socket = await connectSocket(driver1Id, 'driver');
    const driver2Socket = await connectSocket(driver2Id, 'driver');

    try {
      await Promise.all([goOnline(driver1Socket), goOnline(driver2Socket)]);
      await redis.rpush(smartMatching.REDIS_KEYS.matchingQueue(rideId), driver1Id, driver2Id);

      const offer1 = waitForEvent(driver1Socket, 'ride:new_request');
      const offer2 = waitForEvent(driver2Socket, 'ride:new_request');
      await smartMatching.sendRequestToNextDriver(rideId, customerId, PICKUP.lat, PICKUP.lng);
      await Promise.all([offer1, offer2]);

      // Her iki sürücü de kabulü AYNI event loop turunda gönderir
      const d1Fail = waitForEvent<{ reason: string }>(driver1Socket, 'ride:accept_failed', 15_000).catch(() => null);
      const d2Fail = waitForEvent<{ reason: string }>(driver2Socket, 'ride:accept_failed', 15_000).catch(() => null);
      driver1Socket.emit('ride:accept', { rideId });
      driver2Socket.emit('ride:accept', { rideId });

      // DB'de tam olarak BİR kazanan olana dek bekle
      let winner: string | null = null;
      for (let i = 0; i < 50; i++) {
        const r = await dbRide(rideId);
        if (r.status === 'accepted' && r.driver_id) { winner = r.driver_id; break; }
        await new Promise((res) => setTimeout(res, 200));
      }
      expect(winner).toBeTruthy();
      expect([driver1Id, driver2Id]).toContain(winner);

      const loserId = winner === driver1Id ? driver2Id : driver1Id;
      const loserFailPromise = winner === driver1Id ? d2Fail : d1Fail;

      // Kaybeden accept_failed almalı ve bakiyesinden kesinti YAPILMAMALI
      const loserFail = await loserFailPromise;
      expect(loserFail).not.toBeNull();
      expect(await dbDriverBalance(loserId)).toBe(50);
      // Kazanandan kesinti yapıldı (100 × %7 = 7)
      expect(await dbDriverBalance(winner!)).toBeLessThan(50);
    } finally {
      await cleanupRide(rideId);
      await settings.updatePlatformSettings({ matchingOfferWaveSize: 1 });
      driver1Socket.disconnect();
      driver2Socket.disconnect();
    }
  }, 40_000);

  // ── 5 & 6. Son saniye kabulü / geç kabul ─────────────────────────────────

  it('son saniye kabulü: 5 sn pencerenin ~4. saniyesinde gelen kabul geçerli sayılır', async () => {
    const customerId = await insertCustomer(stack.pool);
    const driverId = await insertDriver(stack.pool, { balance: 50 });
    const rideId = await insertSearchingRide(stack.pool, customerId, { estimatedPrice: 100 });

    const driverSocket = await connectSocket(driverId, 'driver');
    await goOnline(driverSocket);
    await redis.rpush(smartMatching.REDIS_KEYS.matchingQueue(rideId), driverId);

    const offer = waitForEvent(driverSocket, 'ride:new_request');
    await smartMatching.sendRequestToNextDriver(rideId, customerId, PICKUP.lat, PICKUP.lng);
    await offer;

    // Pencere 5 sn — 4 sn bekleyip son anda kabul et
    await new Promise((res) => setTimeout(res, 4_000));
    const reveal = waitForEvent(driverSocket, 'ride:reveal_location');
    driverSocket.emit('ride:accept', { rideId });
    await reveal;

    const ride = await dbRide(rideId);
    expect(ride.status).toBe('accepted');
    expect(ride.driver_id).toBe(driverId);

    await cleanupRide(rideId);
    driverSocket.disconnect();
  }, 30_000);

  it('geç kabul: süre dolup teklif sıradaki sürücüye geçtikten SONRA gelen kabul reddedilir, kesinti yapılmaz', async () => {
    const customerId = await insertCustomer(stack.pool);
    const slowDriverId = await insertDriver(stack.pool, { balance: 50 });
    const nextDriverId = await insertDriver(stack.pool, { balance: 50 });
    const rideId = await insertSearchingRide(stack.pool, customerId, { estimatedPrice: 100 });

    const slowSocket = await connectSocket(slowDriverId, 'driver');
    const nextSocket = await connectSocket(nextDriverId, 'driver');
    await Promise.all([goOnline(slowSocket), goOnline(nextSocket)]);
    await redis.rpush(smartMatching.REDIS_KEYS.matchingQueue(rideId), slowDriverId, nextDriverId);

    const offerSlow = waitForEvent(slowSocket, 'ride:new_request');
    const offerNext = waitForEvent(nextSocket, 'ride:new_request', 15_000);
    await smartMatching.sendRequestToNextDriver(rideId, customerId, PICKUP.lat, PICKUP.lng);
    await offerSlow;

    // slowDriver yanıt vermez → timeout → teklif nextDriver'a geçer
    await offerNext;

    // ŞİMDİ slowDriver (süresi dolmuş) kabul etmeye çalışır
    const failMsg = waitForEvent<{ reason: string }>(slowSocket, 'ride:accept_failed');
    slowSocket.emit('ride:accept', { rideId });
    const fail = await failMsg;
    expect(fail.reason).toBe('TIMEOUT');

    // Kesinti yapılmadı, yolculuk hâlâ nextDriver'ın kabul edebileceği durumda
    expect(await dbDriverBalance(slowDriverId)).toBe(50);
    const ride = await dbRide(rideId);
    expect(ride.status).toBe('searching');
    expect(ride.driver_id).toBeNull();

    await cleanupRide(rideId);
    slowSocket.disconnect();
    nextSocket.disconnect();
  }, 30_000);

  // ── 7 & 8. İptal senaryoları ──────────────────────────────────────────────

  it('müşteri aramada iptal eder: bekleyen sürücüye ride:request_cancelled gider, DB cancelled olur', async () => {
    const customerId = await insertCustomer(stack.pool);
    const driverId = await insertDriver(stack.pool, { balance: 50 });

    const customerSocket = await connectSocket(customerId, 'customer');
    const driverSocket = await connectSocket(driverId, 'driver');
    await goOnline(driverSocket);

    const searching = waitForEvent<{ rideId: string }>(customerSocket, 'ride:searching');
    const offer = waitForEvent(driverSocket, 'ride:new_request');
    emitRideRequest(customerSocket);
    const { rideId } = await searching;
    await offer;

    const driverCancelled = waitForEvent<{ rideId: string }>(driverSocket, 'ride:request_cancelled');
    const customerCancelled = waitForEvent<{ rideId: string }>(customerSocket, 'ride:cancelled');
    customerSocket.emit('ride:cancel', { rideId, reason: 'Vazgeçtim' });

    expect((await driverCancelled).rideId).toBe(rideId);
    await customerCancelled;
    expect((await dbRide(rideId)).status).toBe('cancelled');

    // Sürücünün teklif kilidi temizlendi — yeni çağrı alabilir
    const lock = await redis.get(`driver:pending_offer:${driverId}`);
    expect(lock).toBeNull();

    await cleanupRide(rideId);
    driverSocket.emit('driver:go_offline', {});
    customerSocket.disconnect();
  }, 30_000);

  it('kabul sonrası müşteri iptali: sürücüye ride:cancelled ulaşır, sürücü tekrar müsait olur', async () => {
    const customerId = await insertCustomer(stack.pool);
    const driverId = await insertDriver(stack.pool, { balance: 50 });

    const customerSocket = await connectSocket(customerId, 'customer');
    const driverSocket = await connectSocket(driverId, 'driver');
    await goOnline(driverSocket);

    const searching = waitForEvent<{ rideId: string }>(customerSocket, 'ride:searching');
    const offer = waitForEvent(driverSocket, 'ride:new_request');
    emitRideRequest(customerSocket);
    const { rideId } = await searching;
    await offer;

    const accepted = waitForEvent(customerSocket, 'ride:accepted');
    driverSocket.emit('ride:accept', { rideId });
    await accepted;

    const driverCancelled = waitForEvent<{ rideId: string; cancelledBy: string }>(driverSocket, 'ride:cancelled');
    customerSocket.emit('ride:cancel', { rideId, reason: 'Planım değişti' });
    const cancelMsg = await driverCancelled;
    expect(cancelMsg.rideId).toBe(rideId);
    expect(cancelMsg.cancelledBy).toBe('customer');
    expect((await dbRide(rideId)).status).toBe('cancelled');

    await cleanupRide(rideId);
    driverSocket.emit('driver:go_offline', {});
    customerSocket.disconnect();
  }, 30_000);

  // ── 9 & 10. Reconnect senaryoları ─────────────────────────────────────────

  it('GPS/socket kopması (yolculuk ortasında): sürücü yeniden bağlanır → snapshot restore + konum yayını devam eder + DB çevrimiçi kalır', async () => {
    const customerId = await insertCustomer(stack.pool);
    const driverId = await insertDriver(stack.pool, { balance: 50 });

    const customerSocket = await connectSocket(customerId, 'customer');
    let driverSocket = await connectSocket(driverId, 'driver');
    await goOnline(driverSocket);

    const searching = waitForEvent<{ rideId: string }>(customerSocket, 'ride:searching');
    const offer = waitForEvent(driverSocket, 'ride:new_request');
    emitRideRequest(customerSocket);
    const { rideId } = await searching;
    await offer;

    const accepted = waitForEvent(customerSocket, 'ride:accepted');
    driverSocket.emit('ride:accept', { rideId });
    await accepted;

    // GPS/ağ kesintisi: sürücü socket'i kopar
    driverSocket.disconnect();
    await new Promise((res) => setTimeout(res, 1_000));

    // Grace penceresi (12 sn) içinde yeniden bağlanır — tracking.handler snapshot göndermeli
    driverSocket = await connectSocket(driverId, 'driver');
    const snapshot = await waitForEvent<{
      ride: { id: string; status: string; pickupVerificationCode: string | null };
      customer: { id: string } | null;
    }>(driverSocket, 'ride:snapshot');
    expect(snapshot.ride.id).toBe(rideId);
    expect(snapshot.ride.status).toBe('accepted');
    // Sürücü snapshot'ında PIN OLMAMALI (yalnızca müşteri görür)
    expect(snapshot.ride.pickupVerificationCode).toBeNull();
    expect(snapshot.customer?.id).toBe(customerId);

    // Aktif yolculuk var → grace dolsa bile DB çevrimiçi kalır; reconnect sonrası
    // konum yayını müşteriye kesintisiz devam eder
    const locationBroadcast = waitForEvent<{ driverId: string }>(customerSocket, 'driver:location:broadcast');
    driverSocket.emit('driver:location:update', { lat: 39.846, lng: 33.516, bearing: 45 });
    expect((await locationBroadcast).driverId).toBe(driverId);
    expect(await dbDriverOnline(driverId)).toBe(true);

    await cleanupRide(rideId);
    const cancelled = waitForEvent(customerSocket, 'ride:cancelled');
    customerSocket.emit('ride:cancel', { rideId, reason: 'test temizliği' });
    await cancelled;
    driverSocket.disconnect();
    customerSocket.disconnect();
  }, 40_000);

  it('müşteri reconnect: yeniden bağlanınca snapshot ile PIN + sürücü bilgisi + son konum geri gelir', async () => {
    const customerId = await insertCustomer(stack.pool);
    const driverId = await insertDriver(stack.pool, { balance: 50 });

    let customerSocket = await connectSocket(customerId, 'customer');
    const driverSocket = await connectSocket(driverId, 'driver');
    await goOnline(driverSocket);

    const searching = waitForEvent<{ rideId: string }>(customerSocket, 'ride:searching');
    const offer = waitForEvent(driverSocket, 'ride:new_request');
    emitRideRequest(customerSocket);
    const { rideId } = await searching;
    await offer;

    const accepted = waitForEvent<{ verificationCode: string }>(customerSocket, 'ride:accepted');
    driverSocket.emit('ride:accept', { rideId });
    const pin = (await accepted).verificationCode;

    // Sürücü konum günceller (Redis'e yazılır — snapshot'ta geri gelmeli)
    driverSocket.emit('driver:location:update', { lat: 39.8452, lng: 33.5148, bearing: 10 });
    await new Promise((res) => setTimeout(res, 500));

    // Müşteri uygulaması kapanıp açılır
    customerSocket.disconnect();
    customerSocket = await connectSocket(customerId, 'customer');

    const snapshot = await waitForEvent<{
      ride: { id: string; status: string; pickupVerificationCode: string | null };
      driver: { id: string; lat?: number; lng?: number } | null;
    }>(customerSocket, 'ride:snapshot');
    expect(snapshot.ride.id).toBe(rideId);
    // Müşteri snapshot'ında PIN geri gelmeli (UI tekrar gösterebilsin)
    expect(snapshot.ride.pickupVerificationCode).toBe(pin);
    expect(snapshot.driver?.id).toBe(driverId);

    await cleanupRide(rideId);
    const cancelled = waitForEvent(customerSocket, 'ride:cancelled');
    customerSocket.emit('ride:cancel', { rideId, reason: 'test temizliği' });
    await cancelled;
    driverSocket.disconnect();
    customerSocket.disconnect();
  }, 40_000);

  // ── 11. Disconnect grace dolması ──────────────────────────────────────────

  it('disconnect grace (12 sn) dolunca: aktif yolculuğu olmayan sürücü DB\'de çevrimdışı yapılır ve bekleyen teklifi sıradaki sürücüye devredilir', async () => {
    const customerId = await insertCustomer(stack.pool);
    const vanishingDriverId = await insertDriver(stack.pool, { balance: 50 });
    const backupDriverId = await insertDriver(stack.pool, { balance: 50 });
    const rideId = await insertSearchingRide(stack.pool, customerId, { estimatedPrice: 100 });

    const vanishingSocket = await connectSocket(vanishingDriverId, 'driver');
    const backupSocket = await connectSocket(backupDriverId, 'driver');
    await Promise.all([goOnline(vanishingSocket), goOnline(backupSocket)]);
    await redis.rpush(smartMatching.REDIS_KEYS.matchingQueue(rideId), vanishingDriverId, backupDriverId);

    const offer = waitForEvent(vanishingSocket, 'ride:new_request');
    const backupOffer = waitForEvent<{ targetDriverId: string }>(backupSocket, 'ride:new_request', 25_000);
    await smartMatching.sendRequestToNextDriver(rideId, customerId, PICKUP.lat, PICKUP.lng);
    await offer;

    // Teklif elindeyken uygulama çöker / ağ tamamen gider — reconnect YOK
    // (disconnect handler'ı driver:socket eşlemesini anında siler ve 12 sn'lik
    // gecikmeli çevrimdışı timer'ını kurar)
    vanishingSocket.disconnect();

    // Teklif ya sunucu içi 5 sn timeout ile ya da 12 sn grace sonunda
    // handleDriverOfflineAbandon ile backup'a geçmeli
    const backupMsg = await backupOffer;
    expect(backupMsg.targetDriverId).toBe(backupDriverId);

    // Grace süresi (12 sn) + tampon dolunca DB çevrimdışı olmalı
    let offline = false;
    for (let i = 0; i < 30; i++) {
      if (!(await dbDriverOnline(vanishingDriverId))) { offline = true; break; }
      await new Promise((res) => setTimeout(res, 1_000));
    }
    expect(offline).toBe(true);

    await cleanupRide(rideId);
    backupSocket.emit('driver:go_offline', {});
  }, 45_000);

  // ── 12. Hiç sürücü yok ────────────────────────────────────────────────────

  it('çevrimiçi sürücü yokken: müşteriye ride:no_driver_found gider ve yolculuk DB\'de iptal edilir', async () => {
    const customerId = await insertCustomer(stack.pool);
    const customerSocket = await connectSocket(customerId, 'customer');

    const searching = waitForEvent<{ rideId: string }>(customerSocket, 'ride:searching');
    const noDriver = waitForEvent<{ rideId: string }>(customerSocket, 'ride:no_driver_found', 20_000);

    emitRideRequest(customerSocket);
    const { rideId } = await searching;
    await noDriver;

    const ride = await dbRide(rideId);
    expect(ride.status).toBe('cancelled');

    customerSocket.disconnect();
  }, 30_000);

  // ── 13. Bakiye engelleri ──────────────────────────────────────────────────

  it('bakiye engelleri: 0 bakiyeyle çevrimiçi olunamaz; kabul ücretini karşılamayan bakiyeyle kabul reddedilir ve kesinti yapılmaz', async () => {
    // (a) 0 bakiye → driver:online_blocked (min 20 T Coin)
    const brokeDriverId = await insertDriver(stack.pool, { balance: 0 });
    const brokeSocket = await connectSocket(brokeDriverId, 'driver');
    const blocked = waitForEvent<{ reason: string; minBalance: number }>(brokeSocket, 'driver:online_blocked');
    brokeSocket.emit('driver:go_online', {});
    const blockedMsg = await blocked;
    expect(blockedMsg.reason).toBe('INSUFFICIENT_BALANCE');
    brokeSocket.disconnect();

    // (b) Çevrimiçi olabilecek ama kabul ücretini (1000 × %7 = 70) karşılayamayacak bakiye (25)
    const customerId = await insertCustomer(stack.pool);
    const poorDriverId = await insertDriver(stack.pool, { balance: 25 });
    const rideId = await insertSearchingRide(stack.pool, customerId, { estimatedPrice: 1000 });

    const poorSocket = await connectSocket(poorDriverId, 'driver');
    await goOnline(poorSocket);
    await redis.rpush(smartMatching.REDIS_KEYS.matchingQueue(rideId), poorDriverId);

    const offer = waitForEvent(poorSocket, 'ride:new_request');
    await smartMatching.sendRequestToNextDriver(rideId, customerId, PICKUP.lat, PICKUP.lng);
    await offer;

    const failMsg = waitForEvent<{ reason: string }>(poorSocket, 'ride:accept_failed');
    poorSocket.emit('ride:accept', { rideId });
    const fail = await failMsg;
    expect(fail.reason).toBe('INSUFFICIENT_BALANCE');

    // Kesinti yapılmadı, yolculuk hâlâ searching
    expect(await dbDriverBalance(poorDriverId)).toBe(25);
    expect((await dbRide(rideId)).status).toBe('searching');

    await cleanupRide(rideId);
    poorSocket.disconnect();
  }, 30_000);
});
