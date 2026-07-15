/**
 * Eşleştirme yük/dayanıklılık testi: yüzlerce eş zamanlı sürücü + yüzlerce eş
 * zamanlı yolculuk talebi altında smart_matching.service.ts'in gerçek koduna
 * (gerçek Redis Lua kilitleri, gerçek Socket.io, gerçek accept_ride_with_fee
 * atomikliği) karşı davranışını ölçer.
 *
 * Varsayılan olarak ATLANIR (npm test bunu çalıştırmaz — yüzlerce ölçek CI'da
 * her push'ta koşturmak için çok pahalı/yavaş). Elle çalıştırmak için:
 *
 *   npm run test:load-matching                              # 260 sürücü × 200 yolculuk
 *   LOAD_DRIVERS=500 LOAD_CUSTOMERS=400 npm run test:load-matching
 *   LOAD_DRIVERS=200 LOAD_CUSTOMERS=200 npm run test:load-matching  # 1:1 arz=talep, düşük başarı beklenir
 *
 * Kapsam sınırı (ride_matching_socket_flow.test.ts ile aynı gerekçe): her
 * yolculuğun aday kuyruğu Google Distance Matrix'e gitmeden doğrudan Redis'e
 * yazılıyor — startSmartMatching()'in "yakın sürücü bul" aşaması dışarıda
 * (harici, ücretli API bağımlılığı). sendRequestToNextDriver()'dan itibaren
 * her şey GERÇEK kod. Kuyruk tükenip "ikinci dalga" araması tetiklenirse
 * (retrySearchOnce) o gerçek find_nearby_drivers RPC'sini kullanır — tüm test
 * sürücüleri/yolculukları aynı sabit koordinatta olduğu için bu da çalışır.
 *
 * Bu testin sürücü davranışı bir kısayol içeriyor: aday kuyrukları test
 * başında STATİK olarak (gerçek arama yerine rastgele örneklemeyle) kurulur,
 * bu yüzden aynı sürücü teorik olarak birden fazla yolculuğun kuyruğunda
 * olabilir. Prod'da find_nearby_drivers zaten is_available=false olan
 * sürücüleri hariç tutar; burada bunu sürücü-tarafı simülasyonuyla taklit
 * ediyoruz: bir sürücü zaten bir yolculuğu kabul ettiyse sonraki tekliflere
 * otomatik ret yanıtı verir (busyMap) — bu gerçek bir çift-kabul değil, testin
 * kısayolunun zararsız bir yan etkisi.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import type { StartedRedisContainer } from '@testcontainers/redis';
import { startPostgrestStack, type PostgrestStack } from '../support/postgrest_stack';
import { startTestRedis, waitForRedisReady } from '../support/redis';
import { setDummyAppEnv } from '../support/env';

const RUN = process.env.RUN_MATCHING_LOAD_TEST === '1';

// Sürücü sayısı müşteriden kasıtlı olarak biraz fazla (gerçek bir platformda arz
// talebi tam eşitlemez). LOAD_DRIVERS=LOAD_CUSTOMERS ile bilerek arz=talep (1:1,
// sıfır boşluk) senaryosu da test edilebilir — bu durumda başarı oranı büyük
// ölçüde düşer (200/200 denemesinde %68) ÇÜNKÜ 200 sürücünün her biri testte
// yalnızca BİR yolculuk kabul edebiliyor (kabul sonrası hep meşgul kalıyor) ve
// bazı yolculuklar adayları tükenip gerçekten sürücü bulamıyor — bu, eşleştirme
// kodunda bir hata değil, simülasyonun arz/talep oranının matematiksel sonucu.
const DRIVER_COUNT = Number(process.env.LOAD_DRIVERS ?? 260);
const CUSTOMER_COUNT = Number(process.env.LOAD_CUSTOMERS ?? 200);
const CANDIDATES_PER_RIDE = Math.min(15, DRIVER_COUNT);
const OFFER_WAVE_SIZE = 3;
const DRIVER_RESPONSE_TIMEOUT_SECONDS = 5;
const SETTLE_MAX_WAIT_MS = 150_000;
const SETTLE_POLL_MS = 1_000;

const KIRIKKALE_LAT = 39.8468;
const KIRIKKALE_LNG = 33.515;

// Sürücü karar dağılımı: ilk teklife 0.5 kabul, 0.3 ret, 0.2 yanıtsız (timeout).
const ACCEPT_PROB = 0.5;
const REJECT_PROB = 0.3;

function sampleWithoutReplacement<T>(pool: T[], n: number): T[] {
  const copy = pool.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

describe.skipIf(!RUN)(
  `eşleştirme yük testi: ${DRIVER_COUNT} sürücü × ${CUSTOMER_COUNT} yolculuk`,
  () => {
    let stack: PostgrestStack;
    let redisContainer: StartedRedisContainer;
    let httpServer: http.Server;
    let baseUrl: string;

    let sendRequestToNextDriver: typeof import('../../src/services/smart_matching.service').sendRequestToNextDriver;
    let clearSmartMatchingQueue: typeof import('../../src/services/smart_matching.service').clearSmartMatchingQueue;
    let REDIS_KEYS: typeof import('../../src/services/smart_matching.service').REDIS_KEYS;
    let redis: typeof import('../../src/config/redis').redis;
    let generateAccessToken: typeof import('../../src/utils/jwt').generateAccessToken;
    let updatePlatformSettings: typeof import('../../src/services/platform_settings.service').updatePlatformSettings;

    beforeAll(async () => {
      [stack, redisContainer] = await Promise.all([startPostgrestStack(), startTestRedis()]);

      setDummyAppEnv({
        SUPABASE_URL: stack.postgrest.supabaseUrl,
        SUPABASE_SERVICE_ROLE_KEY: stack.postgrest.serviceRoleKey,
        SUPABASE_ANON_KEY: stack.postgrest.anonKey,
        REDIS_HOST: redisContainer.getHost(),
        REDIS_PORT: String(redisContainer.getPort()),
        DRIVER_RESPONSE_TIMEOUT_SECONDS: String(DRIVER_RESPONSE_TIMEOUT_SECONDS),
      });

      const smartMatching = await import('../../src/services/smart_matching.service');
      const redisConfig = await import('../../src/config/redis');
      const jwtUtils = await import('../../src/utils/jwt');
      const socketManager = await import('../../src/sockets/socket.manager');
      const settings = await import('../../src/services/platform_settings.service');

      sendRequestToNextDriver = smartMatching.sendRequestToNextDriver;
      clearSmartMatchingQueue = smartMatching.clearSmartMatchingQueue;
      REDIS_KEYS = smartMatching.REDIS_KEYS;
      redis = redisConfig.redis;
      generateAccessToken = jwtUtils.generateAccessToken;
      updatePlatformSettings = settings.updatePlatformSettings;

      await waitForRedisReady(redis);
      await updatePlatformSettings({ matchingOfferWaveSize: OFFER_WAVE_SIZE });

      httpServer = http.createServer();
      socketManager.initSocketManager(httpServer);
      await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
      const port = (httpServer.address() as AddressInfo).port;
      baseUrl = `http://127.0.0.1:${port}`;
    }, 180_000);

    afterAll(async () => {
      await updatePlatformSettings({ matchingOfferWaveSize: 1 }).catch(() => undefined);
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      await redis.quit();
      await redisContainer.stop();
      await stack.stop();
    });

    async function bulkInsertUsers(ids: string[], phones: string[], role: 'customer' | 'driver') {
      await stack.pool.query(
        `INSERT INTO users (id, phone, full_name, password_hash, role)
         SELECT id, phone, 'Yük Testi', 'hash', $3
         FROM UNNEST($1::uuid[], $2::text[]) AS t(id, phone)`,
        [ids, phones, role],
      );
    }

    async function bulkInsertDrivers(ids: string[], plates: string[]) {
      await stack.pool.query(
        `INSERT INTO drivers (id, vehicle_plate, vehicle_model, vehicle_color, is_online, is_available, balance, current_location)
         SELECT id, plate, 'Test Model', 'Beyaz', true, true, 1000,
                ST_SetSRID(ST_MakePoint(${KIRIKKALE_LNG}, ${KIRIKKALE_LAT}), 4326)::GEOGRAPHY
         FROM UNNEST($1::uuid[], $2::text[]) AS t(id, plate)`,
        [ids, plates],
      );
    }

    async function bulkInsertRides(ids: string[], customerIds: string[]) {
      await stack.pool.query(
        `INSERT INTO rides (id, customer_id, pickup_location, dropoff_location, pickup_address, dropoff_address, estimated_price, status)
         SELECT id, customer_id,
                ST_SetSRID(ST_MakePoint(${KIRIKKALE_LNG}, ${KIRIKKALE_LAT}), 4326)::GEOGRAPHY,
                ST_SetSRID(ST_MakePoint(${KIRIKKALE_LNG}, ${KIRIKKALE_LAT}), 4326)::GEOGRAPHY,
                'Yük testi biniş', 'Yük testi varış', 100, 'searching'
         FROM UNNEST($1::uuid[], $2::uuid[]) AS t(id, customer_id)`,
        [ids, customerIds],
      );
    }

    function connectDriverSocket(driverId: string): Promise<ClientSocket> {
      const token = generateAccessToken({ userId: driverId, role: 'driver', sessionVersion: 0 });
      const socket = ioClient(baseUrl, { auth: { token }, transports: ['websocket'], forceNew: true });
      return new Promise((resolve, reject) => {
        socket.once('connect', () => resolve(socket));
        socket.once('connect_error', reject);
      });
    }

    function goOnlineAndWaitConfirmed(socket: ClientSocket): Promise<void> {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('driver:online_confirmed gelmedi')), 15_000);
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

    it(
      'yüzlerce eş zamanlı yolculuk, sağlıklı bir başarı oranıyla ve yarış durumu/Redis sızıntısı olmadan çözülür',
      async () => {
        const overallStart = Date.now();

        // ── Kurulum: sürücüler + müşteriler + "searching" yolculuklar (toplu insert) ──
        const driverIds: string[] = Array.from({ length: DRIVER_COUNT }, () => randomUUID());
        const driverPhones = driverIds.map((_, i) => `+9060000${String(i).padStart(6, '0')}`);
        const driverPlates = driverIds.map((_, i) => `71 LOAD ${String(i).padStart(4, '0')}`);

        const customerIds: string[] = Array.from({ length: CUSTOMER_COUNT }, () => randomUUID());
        const customerPhones = customerIds.map((_, i) => `+9050000${String(i).padStart(6, '0')}`);

        const rideIds: string[] = customerIds.map(() => randomUUID());

        await bulkInsertUsers(driverIds, driverPhones, 'driver');
        await bulkInsertDrivers(driverIds, driverPlates);
        await bulkInsertUsers(customerIds, customerPhones, 'customer');
        await bulkInsertRides(rideIds, customerIds);

        console.log(
          `[LoadTest] Kurulum tamam (${Date.now() - overallStart}ms): ${DRIVER_COUNT} sürücü, ${CUSTOMER_COUNT} yolculuk.`,
        );

        // ── Sürücü socket'lerini bağla + çevrimiçi yap ──
        const connectStart = Date.now();
        const driverSockets = new Map<string, ClientSocket>();
        const busyMap = new Map<string, boolean>();
        const offersReceived: { driverId: string; rideId: string }[] = [];

        await Promise.all(
          driverIds.map(async (driverId) => {
            const socket = await connectDriverSocket(driverId);
            driverSockets.set(driverId, socket);
            busyMap.set(driverId, false);

            socket.on('ride:new_request', (payload: { rideId: string }) => {
              offersReceived.push({ driverId, rideId: payload.rideId });
              if (busyMap.get(driverId)) {
                // Bu testin kısayolunun (statik aday kuyruğu) zararsız yan etkisi —
                // gerçek find_nearby_drivers zaten meşgul sürücüyü hiç aday yapmazdı.
                socket.emit('ride:reject', { rideId: payload.rideId });
                return;
              }
              const roll = Math.random();
              if (roll < ACCEPT_PROB) {
                busyMap.set(driverId, true);
                socket.emit('ride:accept', { rideId: payload.rideId });
              } else if (roll < ACCEPT_PROB + REJECT_PROB) {
                socket.emit('ride:reject', { rideId: payload.rideId });
              }
              // else: kasıtlı yanıtsız — sunucu timeout ile ilerletir.
            });

            await goOnlineAndWaitConfirmed(socket);
          }),
        );

        console.log(`[LoadTest] ${DRIVER_COUNT} sürücü çevrimiçi (${Date.now() - connectStart}ms).`);

        // ── Her yolculuk için aday kuyruğunu Redis'e yaz + eşleştirmeyi hep birlikte başlat ──
        const sentAt = new Map<string, number>();
        const dispatchStart = Date.now();

        await Promise.all(
          rideIds.map(async (rideId, idx) => {
            const candidates = sampleWithoutReplacement(driverIds, CANDIDATES_PER_RIDE);
            await redis.rpush(REDIS_KEYS.matchingQueue(rideId), ...candidates);
            sentAt.set(rideId, Date.now());
            await sendRequestToNextDriver(rideId, customerIds[idx], KIRIKKALE_LAT, KIRIKKALE_LNG);
          }),
        );

        console.log(`[LoadTest] ${CUSTOMER_COUNT} yolculuk eşzamanlı olarak dispatch edildi (${Date.now() - dispatchStart}ms).`);

        // ── Tüm yolculuklar 'searching' dışına çıkana kadar bekle (accepted/cancelled) ──
        const resolved = new Map<string, { status: string; accepted_at: string | null }>();
        const pending = new Set(rideIds);
        const pollStart = Date.now();

        while (pending.size > 0 && Date.now() - pollStart < SETTLE_MAX_WAIT_MS) {
          const { rows } = await stack.pool.query<{ id: string; status: string; accepted_at: string | null }>(
            `SELECT id, status, accepted_at FROM rides WHERE id = ANY($1) AND status IN ('accepted', 'cancelled')`,
            [Array.from(pending)],
          );
          for (const row of rows) {
            resolved.set(row.id, { status: row.status, accepted_at: row.accepted_at });
            pending.delete(row.id);
          }
          if (pending.size > 0) await sleep(SETTLE_POLL_MS);
        }

        const settleMs = Date.now() - pollStart;
        console.log(
          `[LoadTest] Çözüldü: ${resolved.size}/${rideIds.length} (${settleMs}ms), çözülmeyen: ${pending.size}.`,
        );

        // Redis temizliğinin arkadan yetişmesi için küçük bir tampon.
        await sleep(2_000);

        // ── Metrikler ──
        const accepted = [...resolved.entries()].filter(([, r]) => r.status === 'accepted');
        const cancelled = [...resolved.entries()].filter(([, r]) => r.status === 'cancelled');

        const latenciesMs = accepted
          .map(([rideId, r]) => {
            if (!r.accepted_at) return null;
            const start = sentAt.get(rideId);
            if (!start) return null;
            return new Date(r.accepted_at).getTime() - start;
          })
          .filter((v): v is number => v !== null && v >= 0)
          .sort((a, b) => a - b);

        const successRate = resolved.size > 0 ? accepted.length / rideIds.length : 0;

        console.log('─'.repeat(60));
        console.log('[LoadTest] SONUÇ RAPORU');
        console.log(`  Toplam yolculuk        : ${rideIds.length}`);
        console.log(`  Kabul edildi            : ${accepted.length} (%${(successRate * 100).toFixed(1)})`);
        console.log(`  Sürücü bulunamadı       : ${cancelled.length}`);
        console.log(`  Çözülmeyen (timeout)    : ${pending.size}`);
        console.log(`  Alınan toplam teklif    : ${offersReceived.length}`);
        console.log(
          `  Eşleşme süresi (ms) avg/p50/p95/max: ${
            latenciesMs.length > 0
              ? [
                  Math.round(latenciesMs.reduce((a, b) => a + b, 0) / latenciesMs.length),
                  percentile(latenciesMs, 0.5),
                  percentile(latenciesMs, 0.95),
                  latenciesMs[latenciesMs.length - 1],
                ].join(' / ')
              : 'n/a'
          }`,
        );
        console.log(`  Toplam duvar saati      : ${Date.now() - overallStart}ms`);
        console.log('─'.repeat(60));

        for (const socket of driverSockets.values()) socket.disconnect();
        // Sunucu tarafı disconnect handler'ları (driver.handler.ts) asenkron Redis
        // temizliği yapıyor — afterAll'daki redis.quit() bunlardan önce çalışırsa
        // "Connection is closed" hatası fırlatıyorlardı. Tamamlanmalarına izin ver.
        await sleep(1_000);

        // ── Doğrulamalar ──

        // 1) Sistem yük altında ilerlemeye devam etti — hiçbir yolculuk sonsuza kadar takılı kalmadı.
        expect(pending.size, 'ayrılan sürede çözülmeyen yolculuk kalmamalı').toBe(0);

        // 2) Başarı oranı; sürücü:yolculuk oranına ve rastgele kabul/ret dağılımına
        //    bağlı olduğu için (bkz. DRIVER_COUNT yorumu) kesin bir hedefi yok — burada
        //    yalnızca sistemin toptan bozulmadığını (örn. dalga doldurma mantığı kırılıp
        //    hiçbir teklifin gitmemesi) yakalayacak gevşek bir taban değer kontrol ediliyor.
        expect(successRate, 'eşleşme başarı oranı toptan bir bozulmaya işaret edecek kadar düşük').toBeGreaterThan(0.3);

        // 3) Yarış durumu kontrolü: hiçbir yolculuk için birden fazla accept_fee ledger satırı yok
        //    (accept_ride_with_fee'nin atomikliği — çift kesinti/çift kabul olmadı).
        const acceptedRideIds = accepted.map(([rideId]) => rideId);
        if (acceptedRideIds.length > 0) {
          const { rows: dupCharges } = await stack.pool.query(
            `SELECT ride_id, COUNT(*) AS n FROM wallet_transactions
             WHERE type = 'accept_fee' AND ride_id = ANY($1)
             GROUP BY ride_id HAVING COUNT(*) <> 1`,
            [acceptedRideIds],
          );
          expect(dupCharges, 'bir yolculukta birden fazla/sıfır accept_fee ledger kaydı bulundu').toHaveLength(0);

          // 4) Hiçbir sürücü aynı anda birden fazla kabul edilmiş yolculukla sonuçlanmadı.
          const { rows: dupDrivers } = await stack.pool.query(
            `SELECT driver_id, COUNT(*) AS n FROM rides
             WHERE status = 'accepted' AND driver_id = ANY($1)
             GROUP BY driver_id HAVING COUNT(*) > 1`,
            [driverIds],
          );
          expect(dupDrivers, 'bir sürücü birden fazla kabul edilmiş yolculukla eşleşti').toHaveLength(0);
        }

        // 5) Redis temizliği: çözülen HER yolculuk için eşleştirme anahtarları silinmiş olmalı.
        const leftoverKeys: string[] = [];
        for (const rideId of rideIds) {
          const keys = [
            REDIS_KEYS.matchingQueue(rideId),
            REDIS_KEYS.pending(rideId),
            REDIS_KEYS.matchingCtx(rideId),
            REDIS_KEYS.rejected(rideId),
            REDIS_KEYS.matchingQueuedTotal(rideId),
            REDIS_KEYS.matchingAskedCount(rideId),
            REDIS_KEYS.retrySearchUsed(rideId),
          ];
          const exists = await Promise.all(keys.map((k) => redis.exists(k)));
          exists.forEach((e, i) => {
            if (e) leftoverKeys.push(keys[i]);
          });
        }
        console.log(`[LoadTest] Redis sızıntı taraması: ${leftoverKeys.length} artık anahtar.`);
        expect(leftoverKeys, `çözülmüş yolculuklardan artan Redis anahtarları: ${leftoverKeys.join(', ')}`).toHaveLength(0);

        // 6) Sürücü tekliflerinin kilidi de temizlenmiş olmalı (bizim yolculuklarımızdan).
        const leftoverDriverLocks: string[] = [];
        for (const driverId of driverIds) {
          const key = REDIS_KEYS.driverActiveOffer(driverId);
          const val = await redis.get(key);
          if (val && rideIds.includes(val)) leftoverDriverLocks.push(`${key}=${val}`);
        }
        expect(leftoverDriverLocks, `temizlenmemiş sürücü teklif kilitleri: ${leftoverDriverLocks.join(', ')}`).toHaveLength(0);

        await Promise.all(rideIds.map((rideId) => clearSmartMatchingQueue(rideId, false).catch(() => undefined)));
      },
      300_000,
    );
  },
);
