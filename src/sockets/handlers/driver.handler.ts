/**
 * Sürücü Socket Event Handler'ları
 * Online/offline durumu ve konum güncelleme işlemleri.
 *
 * Dinlenen event'ler:
 *   driver:go_online        → Sürücü çevrimiçi olur
 *   driver:go_offline       → Sürücü çevrimdışı olur
 *   driver:location:update  → Sürücü konumunu günceller (sürekli)
 */

import { Socket } from 'socket.io';
import { supabaseAdmin } from '../../config/supabase';
import { redis } from '../../config/redis';
import { logger } from '../../utils/logger';
import { getPlatformSettings } from '../../services/platform_settings.service';
import {
  fetchDriverBalance,
  canDriverTurnOnline,
} from '../../services/driver_online_policy.service';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
  DriverGoOnlinePayload,
  DriverGoOfflinePayload,
  DriverLocationUpdatePayload,
} from '../../types/socket.types';
import type { TypedSocketServer } from '../socket.manager';
import { notificationService } from '../../services/notification.service';
import { handleDriverOfflineAbandon } from '../../services/smart_matching.service';

// Tip güvenli socket
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

// Redis'te sürücü socket eşlemesi için key prefix
const DRIVER_SOCKET_KEY = 'driver:socket:';
/** Smart matching — bekleyen çağrı teklifi (userId → rideId) */
const DRIVER_PENDING_OFFER_KEY = 'driver:pending_offer:';
// Redis'te sürücü konum cache'i için key prefix
const DRIVER_LOCATION_KEY = 'driver:location:';
// Sürücünün atanmış aktif yolculuk ID'si (her konum güncellemesinde DB sorgusu yapmamak için)
const DRIVER_ACTIVE_RIDE_KEY = 'driver:active_ride:';
// Aktif yolculuk cache TTL (sn) — stale kalırsa kısa sürede DB ile resenkronize olur
const ACTIVE_RIDE_TTL_SEC = 600;
// Yolculuğun müşteri ID cache'i — konum yayını için her tikte DB'ye gitmemek amacıyla.
// Kısa TTL: yolculuk durumu DB'den en geç bu aralıkta yeniden doğrulanır
// (tamamlanma/iptal zaten driver:active_ride anahtarını siler; bu yalnızca emniyet).
const RIDE_CUSTOMER_KEY = 'ride:customer:';
const RIDE_CUSTOMER_TTL_SEC = 60;
// Hayalet sürücü önleme için kalp atışı (heartbeat) key prefix'i
export const DRIVER_HEARTBEAT_KEY = 'driver:heartbeat:';
// Heartbeat TTL (sn) — 3 dakika
const DRIVER_HEARTBEAT_TTL_SEC = 180;

/**
 * Disconnect sonrası çevrimdışına çekmeden önce beklenen süre.
 * JWT yenilemesinde istemci socket'i koparıp yeni token'la ~1 sn içinde yeniden
 * bağlanır (providers.dart onAccessTokenRefreshed → socket.connect). Anında
 * çevrimdışı yapmak bu kısacık pencerede sürücüyü DB'de offline gösteriyor ve
 * bekleyen teklifi başka sürücüye devrediyordu. Bekleme süresi içinde yeni bir
 * go_online gelirse (socket eşlemesi yeniden yazılır) temizlik tamamen atlanır.
 * Süreç restart'ında timer kaybolursa driver_cleanup cron'u hayaleti yakalar.
 */
const DRIVER_DISCONNECT_GRACE_MS = 12_000;
/** Sürücü başına bekleyen çevrimdışı timer'ı — yeni disconnect/go_online eskisini iptal eder. */
const pendingOfflineTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Bekleme süresi dolunca çalışır: sürücü hâlâ bağlı değilse DB + Redis temizliği yapar.
 * Bu sürede yeni bir go_online geldiyse (socket eşlemesi yeniden yazılmıştır) hiçbir şey yapmaz.
 */
async function finalizeDriverOffline(userId: string): Promise<void> {
  // Bekleme süresi içinde yeniden çevrimiçi olduysa: temizlik iptal.
  const liveSocketId = await redis.get(`${DRIVER_SOCKET_KEY}${userId}`);
  if (liveSocketId) {
    logger.debug(`🔌 Gecikmeli çevrimdışı atlandı (yeniden bağlandı): ${userId} [${liveSocketId}]`);
    return;
  }

  const hasActiveRide = await driverHasInFlightAssignedRide(userId);
  if (hasActiveRide) {
    logger.info(`🔌 Sürücü socket koptu (aktif yolculuk var — DB çevrimiçi korunur): ${userId}`);
    return;
  }

  const { error: offErr } = await supabaseAdmin
    .from('drivers')
    .update({ is_online: false, is_available: false })
    .eq('id', userId);

  if (offErr) {
    logger.warn(`driver:disconnect çevrimdışı DB hata [${userId}]:`, offErr);
  }

  await Promise.all([
    redis.del(`${DRIVER_LOCATION_KEY}${userId}`),
    redis.del(`${DRIVER_ACTIVE_RIDE_KEY}${userId}`),
    redis.del(`${DRIVER_HEARTBEAT_KEY}${userId}`),
  ]);

  // Bekleyen teklif varsa sıradaki sürücüye geç (ghost beklemesi olmasın)
  void handleDriverOfflineAbandon(userId).catch((e) =>
    logger.warn(`driver:disconnect bekleyen teklif devri hatası [${userId}]:`, e),
  );

  logger.info(`🔌 Sürücü socket koptu → çevrimdışı yapıldı (mesai yok): ${userId}`);
}

/** Atanmış ve süren yolculuk — sadece bu durumda disconnect'te DB çevrimiçi korunur */
async function driverHasInFlightAssignedRide(driverId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('rides')
    .select('id')
    .eq('driver_id', driverId)
    .in('status', ['accepted', 'arriving', 'in_progress'])
    .limit(1)
    .maybeSingle();
  return Boolean(data?.id);
}

/** Redis cache düz UUID veya eski JSON — DB sorgusu her zaman UUID string */
function normalizeActiveRideIdFromRedis(raw: string | null): string | null {
  if (raw == null) return null;
  const s = raw.trim();
  if (!s) return null;
  if (s.startsWith('{')) {
    try {
      const j = JSON.parse(s) as { rideId?: unknown };
      const id = j.rideId != null ? String(j.rideId).trim() : '';
      return id || null;
    } catch {
      return null;
    }
  }
  return s;
}

/**
 * Sürücü event handler'larını socket'e bağlar
 */
export function registerDriverHandlers(socket: TypedSocket, io: TypedSocketServer): void {
  const userId = socket.data.userId;
  const role = socket.data.role;

  // Sadece sürücü rolü bu event'leri kullanabilir
  if (role !== 'driver') return;

  /**
   * Konum güncelleme sunucu tarafı throttle'ı (DDoS / hatalı client koruması).
   * Her event ağır işlem (Redis + PostGIS RPC + DB sorgu + broadcast) tetiklediğinden,
   * sürücü başına en fazla ~1/sn işlenir. Bu socket'e özel closure değişkeni.
   */
  let lastLocationUpdateMs = 0;
  const MIN_LOCATION_UPDATE_INTERVAL_MS = 1000;

  /**
   * driver:go_online — Sürücü çevrimiçi olur
   * 1. Veritabanında is_online = true, is_available = true
   * 2. Redis'e socket ID eşlemesi kaydet
   * 3. Sürücüyü 'drivers' room'una ekle
   */
  socket.on('driver:go_online', async (_payload: DriverGoOnlinePayload) => {
    try {
      // Bekleyen gecikmeli çevrimdışı temizliği varsa iptal et (reconnect başarılı).
      const pendingOffline = pendingOfflineTimers.get(userId);
      if (pendingOffline) {
        clearTimeout(pendingOffline);
        pendingOfflineTimers.delete(userId);
      }

      const bal = await fetchDriverBalance(userId);
      if (!canDriverTurnOnline(bal)) {
        const minB = getPlatformSettings().minDriverOnlineBalanceTcoin;
        socket.emit('driver:online_blocked', {
          reason: 'INSUFFICIENT_BALANCE',
          minBalance: minB,
          balance: bal,
          message: `Çevrimiçi olmak için en az ${minB} T Coin gerekir. Mevcut: ${bal.toFixed(0)} T.`,
        });
        return;
      }

      // DB'de sürücü durumunu güncelle — hata olursa sessiz kalmasın
      const { error: dbErr } = await supabaseAdmin
        .from('drivers')
        .update({ is_online: true, is_available: true })
        .eq('id', userId);

      if (dbErr) {
        logger.error(`driver:go_online DB hata [${userId}]:`, dbErr);
        socket.emit('driver:online_blocked', {
          reason: 'SERVER_ERROR',
          minBalance: getPlatformSettings().minDriverOnlineBalanceTcoin,
          balance: bal,
          message: 'Sunucu hatası — birazdan tekrar dene.',
        });
        return;
      }

      // Redis'e sürücü-socket eşlemesi ve heartbeat kaydet (hızlı erişim için)
      // Redis erişilemezse de DB tutarlı kalır; ride dağıtımı bir sonraki
      // konum güncellemesinde yeniden eşlenir.
      try {
        await Promise.all([
          redis.set(`${DRIVER_SOCKET_KEY}${userId}`, socket.id, 'EX', 86400),
          redis.set(`${DRIVER_HEARTBEAT_KEY}${userId}`, Date.now().toString(), 'EX', DRIVER_HEARTBEAT_TTL_SEC),
        ]);
      } catch (redisErr) {
        logger.warn(`driver:go_online Redis yazımı başarısız [${userId}]:`, redisErr);
      }

      // Sürücüyü 'drivers' odasına ekle (toplu bildirimler için)
      socket.join('drivers');
      // Kendi kişisel odasına da ekle (bireysel bildirimler için)
      socket.join(`driver:${userId}`);

      logger.info(`🟢 Sürücü çevrimiçi: ${userId} [${socket.id}]`);

      // Sunucu onayı — istemci ilk tıklamada bunu görmediği sürece UI'ı
      // optimistic açmaz; onay gelince güvenle "çevrimiçi" sayar.
      socket.emit('driver:online_confirmed', {
        isOnline: true,
        at: Date.now(),
        balanceTcoin: bal,
      });

      // Push ile uyarlanmış çağrı: arka plandan dönünce bekleyen teklifi tekrar gönder
      try {
        const pendingRideId = await redis.get(`${DRIVER_PENDING_OFFER_KEY}${userId}`);
        if (pendingRideId) {
          await notificationService.sendRideRequest(userId, pendingRideId);
          logger.info(`🔁 Bekleyen çağrı tekrar iletildi: ${userId} → ${pendingRideId}`);
        }
      } catch (resendErr) {
        logger.warn(`driver:go_online bekleyen çağrı yeniden gönderim hatası [${userId}]:`, resendErr);
      }
    } catch (error) {
      logger.error(`driver:go_online hatası [${userId}]:`, error);
      try {
        socket.emit('driver:online_blocked', {
          reason: 'SERVER_ERROR',
          minBalance: getPlatformSettings().minDriverOnlineBalanceTcoin,
          balance: 0,
          message: 'Çevrimiçi yapılamadı, lütfen tekrar deneyin.',
        });
      } catch {
        // emit de başarısızsa sessiz geç
      }
    }
  });

  /**
   * driver:go_offline — Sürücü çevrimdışı olur
   * 1. Veritabanında is_online = false, is_available = false
   * 2. Redis'ten socket eşlemesi ve konum cache'ini sil
   * 3. Socket room'larından çıkar
   */
  socket.on('driver:go_offline', async (_payload: DriverGoOfflinePayload) => {
    try {
      // Bilinçli çevrimdışı — bekleyen gecikmeli temizlik varsa gereksiz, iptal et.
      const pendingOffline = pendingOfflineTimers.get(userId);
      if (pendingOffline) {
        clearTimeout(pendingOffline);
        pendingOfflineTimers.delete(userId);
      }

      await supabaseAdmin
        .from('drivers')
        .update({ is_online: false, is_available: false })
        .eq('id', userId);

      // Redis'ten sürücü verilerini temizle (aktif yolculuk cache dahil)
      await Promise.all([
        redis.del(`${DRIVER_SOCKET_KEY}${userId}`),
        redis.del(`${DRIVER_LOCATION_KEY}${userId}`),
        redis.del(`${DRIVER_ACTIVE_RIDE_KEY}${userId}`),
        redis.del(`${DRIVER_HEARTBEAT_KEY}${userId}`),
      ]);

      // Room'lardan çıkar
      socket.leave('drivers');
      socket.leave(`driver:${userId}`);

      // Bekleyen bir teklif varsa hemen sıradaki sürücüye geç (müşteri boşuna beklemesin)
      void handleDriverOfflineAbandon(userId).catch((e) =>
        logger.warn(`driver:go_offline bekleyen teklif devri hatası [${userId}]:`, e),
      );

      logger.info(`🔴 Sürücü çevrimdışı: ${userId} [${socket.id}]`);
    } catch (error) {
      logger.error(`driver:go_offline hatası [${userId}]:`, error);
    }
  });

  /**
   * driver:location:update — Sürücü konumunu günceller
   * Flutter tarafından her 5 saniyede bir gönderilir.
   * 1. Girdi doğrulaması (güvenlik: aşırı/yanlış payload DB'ye yazılmasın)
   * 2. Redis cache'e anlık konumu yaz (hızlı erişim)
   * 3. PostGIS fonksiyonu ile DB'yi güncelle + geçmişe kaydet (paralel)
   * 4. Müşteri odasına yayın — aktif yolculuk ID'si Redis cache'inden okunur;
   *    stale ise DB'den doğrulanıp tekrar cache'lenir (her çağrıda DB yükü yok).
   */
  socket.on('driver:location:update', async (payload: DriverLocationUpdatePayload) => {
    try {
      // Sunucu tarafı throttle — burst/spam güncellemeler DB/RPC yükü yaratmasın
      const nowMs = Date.now();
      if (nowMs - lastLocationUpdateMs < MIN_LOCATION_UPDATE_INTERVAL_MS) {
        return;
      }
      lastLocationUpdateMs = nowMs;

      const lat = Number(payload?.lat);
      const lng = Number(payload?.lng);
      const bearing = Number(payload?.bearing ?? 0);

      if (
        !Number.isFinite(lat) || !Number.isFinite(lng) ||
        lat < -90 || lat > 90 || lng < -180 || lng > 180
      ) {
        return; // geçersiz koordinat — sessizce düş
      }
      const safeBearing = Number.isFinite(bearing) ? Math.max(0, Math.min(360, bearing)) : 0;

      // Redis cache'e anlık konumu JSON olarak yaz (TTL: 5 dakika)
      const locationData = JSON.stringify({ lat, lng, bearing: safeBearing, updatedAt: Date.now() });

      // Konum cache, DB güncellemesi ve Heartbeat'i paralelleştir
      const [, rpcRes, rawActiveRide] = await Promise.all([
        redis.set(`${DRIVER_LOCATION_KEY}${userId}`, locationData, 'EX', 300),
        supabaseAdmin.rpc('update_driver_location', {
          p_driver_id: userId,
          p_lat: lat,
          p_lng: lng,
          p_bearing: safeBearing,
        }),
        redis.get(`${DRIVER_ACTIVE_RIDE_KEY}${userId}`),
        redis.set(`${DRIVER_HEARTBEAT_KEY}${userId}`, Date.now().toString(), 'EX', DRIVER_HEARTBEAT_TTL_SEC),
      ]);

      const activeRideIdCached = normalizeActiveRideIdFromRedis(rawActiveRide);

      if (rpcRes.error) {
        logger.debug(`update_driver_location RPC hata [${userId}]:`, rpcRes.error);
      }

      // Müşteri için yayın
      let customerId: string | null = null;
      if (activeRideIdCached) {
        // Önce Redis'teki müşteri cache'ine bak — sıcak yolda DB'ye hiç gitme
        const cachedCustomer = await redis.get(`${RIDE_CUSTOMER_KEY}${activeRideIdCached}`);
        if (cachedCustomer) {
          customerId = cachedCustomer;
        } else {
          // Cache miss — DB'den doğrula (durum kontrolü dahil) ve kısa TTL ile cache'le
          const { data: ride } = await supabaseAdmin
            .from('rides')
            .select('customer_id, status')
            .eq('id', activeRideIdCached)
            .maybeSingle();

          if (ride && ['accepted', 'arriving', 'in_progress'].includes(ride.status)) {
            customerId = ride.customer_id;
            await redis.set(
              `${RIDE_CUSTOMER_KEY}${activeRideIdCached}`,
              ride.customer_id,
              'EX',
              RIDE_CUSTOMER_TTL_SEC
            );
          } else {
            // Cache bayat — temizle
            await redis.del(`${DRIVER_ACTIVE_RIDE_KEY}${userId}`);
          }
        }
      }

      if (!customerId) {
        // Cache boş veya bayat — DB'den bul ve cache'le
        const { data: activeRide } = await supabaseAdmin
          .from('rides')
          .select('id, customer_id')
          .eq('driver_id', userId)
          .in('status', ['accepted', 'arriving', 'in_progress'])
          .maybeSingle();

        if (activeRide?.id) {
          await Promise.all([
            redis.set(
              `${DRIVER_ACTIVE_RIDE_KEY}${userId}`,
              activeRide.id,
              'EX',
              ACTIVE_RIDE_TTL_SEC
            ),
            redis.set(
              `${RIDE_CUSTOMER_KEY}${activeRide.id}`,
              activeRide.customer_id,
              'EX',
              RIDE_CUSTOMER_TTL_SEC
            ),
          ]);
          customerId = activeRide.customer_id;
        }
      }

      if (customerId) {
        io.to(`customer:${customerId}`).emit('driver:location:broadcast', {
          driverId: userId,
          lat,
          lng,
          bearing: safeBearing,
        });
      }
    } catch (error) {
      logger.debug(`driver:location:update hatası [${userId}]:`, error);
    }
  });

  /**
   * Socket koptuğunda:
   * - Aktif yolculuk (accepted/arriving/in_progress) varsa DB çevrimiçi kalır (sürücü yolda).
   * - Yoksa uygulama kill / ağ kopması = mesai kabul etmiyor → DB + Redis çevrimdışı
   *   (aksi halde DB'de hayalet çevrimiçi kalır, eşleştirme + FCM ceza üretirdi).
   */
  socket.on('disconnect', async () => {
    try {
      // Aynı kullanıcının yeni bağlantısıyla değiştirildiyse (reconnect/tek aktif bağlantı):
      // çevrimdışı yapma — yeni socket oturumu devraldı.
      if (socket.data.replaced) {
        logger.debug(`🔌 Sürücü disconnect yok sayıldı (yeni bağlantı devraldı): ${userId} [${socket.id}]`);
        return;
      }

      const storedSocketId = await redis.get(`${DRIVER_SOCKET_KEY}${userId}`);

      if (storedSocketId && storedSocketId !== socket.id) {
        logger.debug(
          `🔌 Sürücü disconnect yok sayıldı (kayıtlı başka soket): ${userId} bu=${socket.id} kayıtlı=${storedSocketId}`,
        );
        return;
      }

      // Socket eşlemesi hemen silinir — eşleştirme bekleme süresi boyunca da
      // ölü sokete teklif göndermesin (canlı-socket filtresi bu anahtara bakar).
      if (storedSocketId === socket.id) {
        await redis.del(`${DRIVER_SOCKET_KEY}${userId}`);
      }

      // DB çevrimdışı + temizlik BEKLETİLİR: token yenileme reconnect'i (~1 sn)
      // bu pencerede go_online gönderir ve temizlik tamamen atlanır.
      const prev = pendingOfflineTimers.get(userId);
      if (prev) clearTimeout(prev);
      const timer = setTimeout(() => {
        pendingOfflineTimers.delete(userId);
        void finalizeDriverOffline(userId).catch((e) =>
          logger.error(`Sürücü gecikmeli çevrimdışı hatası [${userId}]:`, e),
        );
      }, DRIVER_DISCONNECT_GRACE_MS);
      pendingOfflineTimers.set(userId, timer);
      logger.debug(
        `🔌 Sürücü socket koptu — ${DRIVER_DISCONNECT_GRACE_MS / 1000} sn yeniden bağlanma bekleniyor: ${userId}`,
      );
    } catch (error) {
      logger.error(`Sürücü disconnect hatası [${userId}]:`, error);
    }
  });
}
