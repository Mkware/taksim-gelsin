/**
 * smart_matching.service.ts
 *
 * Profesyonel Sürücü Seçim Algoritması
 *
 * Mevcut sisteme DROP-IN replacement olarak tasarlanmıştır.
 * Mevcut matching.service.ts'deki startMatching() fonksiyonunu
 * bu servis ile değiştirmeniz yeterlidir.
 *
 * SKORLAMA AĞIRLIKLARI (skor hesaplaması için):
 *   %30 → Mesafe, %25 günlük yolculuk, %25 rating, %20 kabul oranı
 *
 * KUYRUK SIRASI: Önce gerçek zamanlı çevrimiçi/müsait + başka çağrı kilidi yok.
 * Ardından sıralama — önce en yakın (mesafe m); mesafe neredeyse eşitse skor.
 *
 * PARALEL TEKLİF DALGASI (matchingOfferWaveSize, admin `platform_settings`):
 *   Aynı anda en fazla N sürücüde açık teklif tutulur (1 = klasik sıralı davranış).
 *   `ride:pending:{rideId}` bir Redis SET'tir; biri reddedince/süresi dolunca dalga
 *   kuyruktan anında doldurulur. Gerçek kazanan her zaman DB'deki atomik
 *   `accept_ride_with_fee` (searching→accepted, ilk gelen kazanır) — eşzamanlı
 *   kabullerde kaybeden sürücüden kesinti yapılmaz. Kabulde dalganın kalanına
 *   `accepted_by_other` iptali gider.
 *
 * SIRALAMA: metre değil SÜRE (ETA). Google Distance Matrix zaten süreyi de döndürüyor;
 *   trafik/tek yön gibi durumlarda "en yakın metre" yanıltıcı olabiliyordu (400m ama
 *   8dk süren sürücü, 600m ama 3dk süren sürücünün önüne geçebiliyordu). Artık bantlama
 *   ve skorun "mesafe" bileşeni saniye (duration_s) üzerinden hesaplanıyor.
 *
 * İKİNCİ DALGA ARAMASI: Kuyruk tükenip hiç açık teklif kalmayınca (bir kez, ride başına)
 *   "sürücü bulunamadı" demeden önce yeniden aday araması yapılır — o ana kadar geçen
 *   sürede yeni çevrimiçi olan veya başka çağrıdan boşalan sürücüler değerlendirilebilsin.
 *   Bu ikinci arama da boş dönerse yolculuk normal şekilde iptal edilir.
 *
 * CEZA SİSTEMİ:
 *   - Yanıt süresi dolunca timeout → kabul_oranı düşer (kalıcı etki) — süre admin `platform_settings`.
 *   - Timeout cezası Redis'te TTL ile tutulur (geçici bant dışı)
 *   - N art arda timeout → bant dışı (N ve süre admin `platform_settings`: matchingTimeoutBanThreshold/Seconds)
 */

import { redis } from '../config/redis';
import { supabaseAdmin } from '../config/supabase';
import { getSocketManager } from '../sockets/socket.manager';
import {
  getDriverResponseTimeoutMs,
  getPlatformSettings,
  computeRideAcceptFeeTcoin,
} from './platform_settings.service';
import { notificationService } from './notification.service';
import { notifyRideCancelledByFcm } from './push_notification.service';
import { drivingMetersAndSecondsDriverToPickup } from './driving_distance.service';
import { logger } from '../utils/logger';
import { haversineDistance, estimateArrivalTime } from '../utils/distance';
import { decodeEwkbPoint } from '../utils/geo';
import {
  driverOfferRedisTtlSecondsFromMs,
  redisDriverResponseDeadlineKey,
  redisDriverResponseDeadlinePrefix,
} from './matching_timeouts';

// ─── Sabitler ────────────────────────────────────────────────────────────────

/** Dalga > 1 iken kuyruk kapasitesi — her dalga için ~3 tur aday bulunsun.
 *  maxDriversPerRide admin `platform_settings.matchingMaxDriversPerRide`'dan gelir. */
function queueCapForWave(waveSize: number, maxDriversPerRide: number): number {
  return Math.max(maxDriversPerRide, waveSize * 3);
}
/** Skorun (puan/kabul oranı/adalet) fiilen devreye girmesi için süre (ETA) bandı genişliği (sn).
 *  Bu bant içindeki sürücüler arasında en kısa süre değil, en iyi skor kazanır.
 *  ~400m'lik önceki mesafe bandına şehir içi trafikte kabaca denk düşen süre. */
const DURATION_BAND_S            = 90;
/** Ağ gecikmesi / son saniye kabul için sunucu timeout’u admin süresinden biraz uzun tutulur (UI deadline aynı). */
const DRIVER_RESPONSE_END_GRACE_MS = 400;
const QUEUE_TTL_S                = 300;

/** driver.handler ile aynı — canlı socket eşlemesi (hayalet çevrimiçi filtre) */
export const DRIVER_SOCKET_KEY = 'driver:socket:';
/** Sürücü başına aktif teklif kilidi prefix'i (Lua içinde de kullanılır). */
export const DRIVER_PENDING_OFFER_PREFIX = 'driver:pending_offer:';

// Ağırlıklar (toplam = 1.0)
const WEIGHTS = {
  distance      : 0.30,
  dailyRides    : 0.25,
  rating        : 0.25,
  acceptanceRate: 0.20,
} as const;

// ─── Redis Anahtar Şablonları ─────────────────────────────────────────────────

/** Testlerde kuyruk/kilit durumunu doğrudan Redis'te kurmak/okumak için dışa açık. */
export const REDIS_KEYS = {
  matchingQueue    : (rideId: string) => `ride:matching:${rideId}`,
  matchingQueuedTotal: (rideId: string) => `ride:matching:queued_total:${rideId}`,
  matchingAskedCount : (rideId: string) => `ride:matching:asked:${rideId}`,
  matchingCtx      : (rideId: string) => `ride:matching:ctx:${rideId}`,       // sweeper bağlamı (customer + pickup)
  rejected         : (rideId: string) => `ride:rejected:${rideId}`,
  /** SET — dalgadaki açık teklif sahibi sürücüler (eski deploy'un STRING'i Lua'da SET'e çevrilir). */
  pending          : (rideId: string) => `ride:pending:${rideId}`,
  driverActiveOffer: (driverId: string) => `${DRIVER_PENDING_OFFER_PREFIX}${driverId}`,
  driverStats      : (driverId: string) => `driver:stats:${driverId}`,       // günlük istatistik
  driverPenalty    : (driverId: string) => `driver:penalty:${driverId}`,     // bant dışı flag
  timeoutStreak    : (driverId: string) => `driver:timeout_streak:${driverId}`, // art arda timeout sayısı
  /** Kuyruk tükendiğinde "ikinci dalga" yeniden aramasının ride başına yalnızca BİR KEZ
   *  çalıştığını garanti eden bayrak (SET NX). */
  retrySearchUsed  : (rideId: string) => `ride:matching:retry_used:${rideId}`,
} as const;

/**
 * Dayanıklı teklif son tarihleri (deploy/restart'a dirençli).
 *
 * In-memory `setTimeout` süreç yeniden başlayınca kaybolur; bu yüzden her aktif
 * teklifin bitiş zamanı (epoch ms) bu sorted set'te score olarak tutulur. `sweepExpiredOffers`
 * süresi dolan teklifleri Redis'ten okuyup atomik claim ile sıradaki sürücüye ilerletir.
 * Böylece in-memory timer kaybolsa bile eşleştirme saniyeler içinde devam eder.
 */
export const OFFER_DEADLINES_ZSET = 'ride:offer:deadlines';
const offerMember = (rideId: string, driverId: string): string => `${rideId}::${driverId}`;
const parseOfferMember = (member: string): { rideId: string; driverId: string } | null => {
  const idx = member.indexOf('::');
  if (idx <= 0) return null;
  return { rideId: member.slice(0, idx), driverId: member.slice(idx + 2) };
};

interface MatchingContext {
  customerId: string;
  pickupLat: number;
  pickupLng: number;
}

// ─── Tip Tanımları ────────────────────────────────────────────────────────────

export interface NearbyDriver {
  id          : string;
  lat         : number;
  lng         : number;
  rating      : number;       // 1.0 – 5.0
  rating_count: number;
  distance_m  : number;       // pickup'a mesafe (metre) — yalnızca gösterim/log, sıralama duration_s kullanır
  duration_s  : number;       // pickup'a araçla süre (saniye) — bantlama ve skor bunu kullanır
}

/** RPC çıktısı — henüz yol mesafesi eklenmemiş aday */
interface ParsedNearbyDriver {
  id          : string;
  lat         : number;
  lng         : number;
  rating      : number;
  rating_count: number;
}

type ParsedWithAir = ParsedNearbyDriver & { air_m: number };

interface DriverStats {
  dailyRides    : number;   // bugün tamamlanan yolculuk
  acceptanceRate: number;   // 0.0 – 1.0  (örn: 0.85 = %85)
}

interface ScoredDriver extends NearbyDriver {
  stats       : DriverStats;
  score       : number;           // 0 – 100 arası normalize skor
  scoreBreakdown: {               // debug / gözlemlenebilirlik için
    eta           : number;       // süre (ETA) bileşeni — eskiden "distance" (metre)
    dailyRides    : number;
    rating        : number;
    acceptanceRate: number;
  };
}

// ─── Yardımcı: Normalizasyon ──────────────────────────────────────────────────

/**
 * Bir değer dizisini 0–1 arasına normalize eder.
 * direction: 'asc'  → küçük değer yüksek skor (mesafe, günlük yolculuk)
 *            'desc' → büyük değer yüksek skor (rating, kabul oranı)
 */
function normalize(value: number, min: number, max: number, direction: 'asc' | 'desc'): number {
  if (max === min) return 1; // tek eleman varsa herkese tam puan
  const ratio = (value - min) / (max - min);
  return direction === 'asc' ? 1 - ratio : ratio;
}

// ─── Sürücü İstatistiklerini Yükle ───────────────────────────────────────────

async function loadDriverStats(driverId: string): Promise<DriverStats> {
  // Önce Redis cache'e bak (TTL gece yarısı sıfırlanır)
  const cached = await redis.get(REDIS_KEYS.driverStats(driverId));
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as DriverStats;
      if (Number.isFinite(parsed.dailyRides) && Number.isFinite(parsed.acceptanceRate)) {
        return parsed;
      }
    } catch (e) {
      // Bozuk cache → temizle ve DB'den yeniden yükle (eşleştirme bu yüzden patlamasın)
      logger.warn(`[SmartMatching] driver stats cache bozuk, yeniden yükleniyor ${driverId}:`, e);
      await redis.del(REDIS_KEYS.driverStats(driverId));
    }
  }

  // Cache miss → DB'den çek
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { data, error } = await supabaseAdmin
    .from('rides')
    .select('id', { count: 'exact' })
    .eq('driver_id', driverId)
    .eq('status', 'completed')
    .gte('completed_at', today.toISOString());

  if (error) {
    logger.warn(`[SmartMatching] Driver stats fetch error: ${driverId}`, error);
    return { dailyRides: 0, acceptanceRate: 0.8 }; // güvenli varsayılan
  }

  // Kabul oranı: son 30 yolculuk isteğindeki kabul / toplam istek
  const { data: recentRequests } = await supabaseAdmin
    .from('driver_request_log')        // ⚠️ Bu tabloyu oluşturmanız gerekiyor (aşağıda migration var)
    .select('accepted')
    .eq('driver_id', driverId)
    .order('created_at', { ascending: false })
    .limit(30);

  const totalRequests = recentRequests?.length ?? 0;
  const acceptedCount = recentRequests?.filter(r => r.accepted).length ?? 0;
  const acceptanceRate = totalRequests > 0 ? acceptedCount / totalRequests : 0.8;

  const stats: DriverStats = {
    dailyRides    : data?.length ?? 0,
    acceptanceRate,
  };

  // 5 dk cache (sık değişen veri)
  await redis.setex(REDIS_KEYS.driverStats(driverId), 300, JSON.stringify(stats));

  return stats;
}

// ─── Bekleyen Teklif (Dalga) Yardımcıları ────────────────────────────────────

/**
 * Dalgadaki açık teklif sahibi sürücüler. `ride:pending` artık SET; eski deploy'dan
 * kalan STRING değeri de okunur (WRONGTYPE → GET fallback) — geçiş sırasında kırılmaz.
 */
export async function getPendingOfferDrivers(rideId: string): Promise<string[]> {
  const key = REDIS_KEYS.pending(rideId);
  try {
    return await redis.smembers(key);
  } catch {
    const legacy = await redis.get(key).catch(() => null);
    return legacy ? [legacy] : [];
  }
}

/** Sürücünün bu ride için hâlâ açık (geçerli) teklifi var mı? ride:accept ön kontrolü. */
export async function isDriverPendingOfferFor(rideId: string, driverId: string): Promise<boolean> {
  const key = REDIS_KEYS.pending(rideId);
  try {
    return (await redis.sismember(key, driverId)) === 1;
  } catch {
    const legacy = await redis.get(key).catch(() => null);
    return legacy === driverId;
  }
}

// ─── Bant Dışı Kontrolü ───────────────────────────────────────────────────────

async function isDriverBannedTemporarily(driverId: string): Promise<boolean> {
  const penalty = await redis.get(REDIS_KEYS.driverPenalty(driverId));
  return penalty !== null;
}

/**
 * RPC anında dönen liste ile DB / Redis yarışını giderir:
 * - DB'de hâlâ is_online + is_available olmayanları çıkarır
 * - Başka bir yolculuk için aktif `pending_offer` kilidi olanları çıkarır (bu ride değilse)
 * - Redis'te `driver:socket:{id}` yoksa çıkarır (DB online ama uygulama bağlı değil)
 *
 * Generic: Google Distance Matrix çağrısından ÖNCE (ham RPC adaylarına, henüz sürüş
 * mesafesi hesaplanmamışken) veya sonra çağrılabilsin diye yalnızca `id` alanına
 * bağımlı — `distance_m` gerektirmiyor.
 */
async function filterCandidatesForRide<T extends { id: string }>(
  drivers: T[],
  rideId: string,
): Promise<T[]> {
  if (drivers.length === 0) return [];

  const ids = [...new Set(drivers.map((d) => d.id))];

  // Bu ride'ın kabul ücreti — yetersiz bakiyeli sürücüye boş teklif gitmesin.
  let requiredBalance = 0;
  try {
    const { data: rideRow } = await supabaseAdmin
      .from('rides')
      .select('estimated_price')
      .eq('id', rideId)
      .maybeSingle();
    requiredBalance = computeRideAcceptFeeTcoin(
      Number((rideRow as { estimated_price?: number } | null)?.estimated_price ?? 0),
    );
  } catch (e) {
    logger.warn(`[SmartMatching] kabul ücreti hesaplanamadı ride=${rideId}, bakiye filtresi atlandı:`, e);
    requiredBalance = 0;
  }

  const { data: rows, error } = await supabaseAdmin
    .from('drivers')
    .select('id, balance')
    .in('id', ids)
    .eq('is_online', true)
    .eq('is_available', true);

  if (error) {
    logger.warn('[SmartMatching] filterCandidates DB error:', error);
    return drivers;
  }

  // Online + müsait + kabul ücretini karşılayacak bakiyesi olanlar.
  const allowed = new Set(
    (rows ?? [])
      .filter((r) => Number((r as { balance?: number }).balance ?? 0) >= requiredBalance)
      .map((r) => r.id as string),
  );

  const lockChecks = await Promise.all(
    drivers.map(async (d): Promise<
      | { d: T; keep: true }
      | { d: T; keep: false; reason: 'db' | 'lock' | 'socket'; otherRide?: string }
    > => {
      if (!allowed.has(d.id)) {
        return { d, keep: false, reason: 'db' };
      }
      const socketId = await redis.get(`${DRIVER_SOCKET_KEY}${d.id}`);
      if (!socketId) {
        return { d, keep: false, reason: 'socket' };
      }
      const lockedRide = await redis.get(REDIS_KEYS.driverActiveOffer(d.id));
      if (lockedRide && lockedRide !== rideId) {
        return { d, keep: false, reason: 'lock', otherRide: lockedRide };
      }
      return { d, keep: true };
    }),
  );

  const out: T[] = [];
  for (const c of lockChecks) {
    if (c.keep) {
      out.push(c.d);
      continue;
    }
    if (c.reason === 'db') {
      logger.info(`[SmartMatching] Candidate ${c.d.id} skipped — online/müsait değil veya kabul ücreti için yetersiz bakiye`);
    } else if (c.reason === 'socket') {
      logger.info(`[SmartMatching] Candidate ${c.d.id} skipped — no live socket (ghost online)`);
    } else {
      logger.info(
        `[SmartMatching] Candidate ${c.d.id} skipped — pending offer for other ride ${c.otherRide}`,
      );
    }
  }

  return out;
}

// ─── Timeout Ceza Uygula ──────────────────────────────────────────────────────

async function applyTimeoutPenalty(driverId: string): Promise<void> {
  const settings = getPlatformSettings();

  // Art arda timeout sayacını artır
  const streakKey = REDIS_KEYS.timeoutStreak(driverId);
  const streak    = await redis.incr(streakKey);
  await redis.expire(streakKey, settings.matchingTimeoutBanSeconds);

  logger.info(`[SmartMatching] Timeout streak for driver ${driverId}: ${streak}`);

  if (streak >= settings.matchingTimeoutBanThreshold) {
    // N art arda timeout → bant dışı (N ve süre admin `platform_settings`)
    await redis.setex(REDIS_KEYS.driverPenalty(driverId), settings.matchingTimeoutBanSeconds, '1');
    await redis.del(streakKey);
    logger.warn(`[SmartMatching] Driver ${driverId} temporarily banned for ${settings.matchingTimeoutBanSeconds}s`);
  }

  // Kabul oranını DB'ye düşür (kalıcı etki)
  await supabaseAdmin.rpc('record_driver_request', {
    p_driver_id: driverId,
    p_accepted : false,
    p_reason   : 'timeout',
  });

  // Stats cache'i geçersiz kıl
  await redis.del(REDIS_KEYS.driverStats(driverId));
}

// ─── Ret Kaydı Uygula ─────────────────────────────────────────────────────────

async function applyRejectionRecord(driverId: string): Promise<void> {
  // Reddetme kabul oranını düşürür ama bant dışı yapmaz
  await supabaseAdmin.rpc('record_driver_request', {
    p_driver_id: driverId,
    p_accepted : false,
    p_reason   : 'rejected',
  });

  // Streak'i sıfırla (aktif ret = cevap verdi)
  await redis.del(REDIS_KEYS.timeoutStreak(driverId));

  // Stats cache'i geçersiz kıl
  await redis.del(REDIS_KEYS.driverStats(driverId));
}

// ─── Kabul Kaydı ──────────────────────────────────────────────────────────────

async function applyAcceptanceRecord(driverId: string): Promise<void> {
  await supabaseAdmin.rpc('record_driver_request', {
    p_driver_id: driverId,
    p_accepted : true,
    p_reason   : 'accepted',
  });
  await redis.del(REDIS_KEYS.timeoutStreak(driverId));
  await redis.del(REDIS_KEYS.driverStats(driverId));
}

// ─── ANA SKORLAMA FONKSİYONU ──────────────────────────────────────────────────

/** Testler için dışa açık — mesafe bandı + skor sıralamasının davranışını doğrudan doğrulamak için. */
export async function scoreAndRankDrivers(
  drivers     : NearbyDriver[],
  rejectedIds : Set<string>,
): Promise<ScoredDriver[]> {

  // Bant dışı ve ret listesi filtrele
  const eligible: NearbyDriver[] = [];
  for (const d of drivers) {
    if (rejectedIds.has(d.id)) continue;
    if (await isDriverBannedTemporarily(d.id)) {
      logger.info(`[SmartMatching] Driver ${d.id} skipped (temporary ban)`);
      continue;
    }
    eligible.push(d);
  }

  if (eligible.length === 0) return [];

  // İstatistikleri paralel yükle
  const statsArray = await Promise.all(eligible.map(d => loadDriverStats(d.id)));

  // Normalize için min/max hesapla
  const durations    = eligible.map(d => d.duration_s);
  const dailyRides   = statsArray.map(s => s.dailyRides);
  const ratings      = eligible.map(d => d.rating);
  const acceptRates  = statsArray.map(s => s.acceptanceRate);

  const minDur   = Math.min(...durations),    maxDur   = Math.max(...durations);
  const minRides = Math.min(...dailyRides),   maxRides = Math.max(...dailyRides);
  const minRate  = Math.min(...ratings),      maxRate  = Math.max(...ratings);
  const minAcc   = Math.min(...acceptRates),  maxAcc   = Math.max(...acceptRates);

  const scored: ScoredDriver[] = eligible.map((driver, i) => {
    const stats = statsArray[i];

    const breakdown = {
      // ETA: az süre → yüksek skor (asc). Metre değil süre — trafik/tek yön yanıltmasın.
      eta           : normalize(driver.duration_s,       minDur,   maxDur,   'asc'),
      // Günlük yolculuk: az yolculuk → yüksek skor (asc) — adalet
      dailyRides    : normalize(stats.dailyRides,        minRides, maxRides, 'asc'),
      // Rating: yüksek puan → yüksek skor (desc)
      rating        : normalize(driver.rating,           minRate,  maxRate,  'desc'),
      // Kabul oranı: yüksek oran → yüksek skor (desc)
      acceptanceRate: normalize(stats.acceptanceRate,    minAcc,   maxAcc,   'desc'),
    };

    const score = (
      breakdown.eta             * WEIGHTS.distance       +
      breakdown.dailyRides     * WEIGHTS.dailyRides     +
      breakdown.rating         * WEIGHTS.rating         +
      breakdown.acceptanceRate * WEIGHTS.acceptanceRate
    ) * 100; // 0–100 arası

    return { ...driver, stats, score, scoreBreakdown: breakdown };
  });

  // Süre (ETA) bandına göre sırala (DURATION_BAND_S genişliğinde), bant içinde skor belirleyici.
  // Önceden ham metreyle sıralanıyordu; trafik/tek yön yollarda "en yakın metre" yanıltıcı
  // olabiliyordu (400m ama 8dk süren sürücü, 600m ama 3dk süren sürücünün önüne geçebiliyordu).
  // Bant genişse "en kısa süre önce" sezgisi korunur; aynı banttaki adaylar arasında ise
  // en iyi profil öne çıkar.
  scored.sort((a, b) => {
    const bandA = Math.floor(a.duration_s / DURATION_BAND_S);
    const bandB = Math.floor(b.duration_s / DURATION_BAND_S);
    if (bandA !== bandB) {
      return bandA - bandB;
    }
    const byScore = b.score - a.score;
    if (Math.abs(byScore) > 1e-6) {
      return byScore;
    }
    return a.duration_s - b.duration_s;
  });

  logger.info('[SmartMatching] Driver ranking:', scored.map(d => ({
    id           : d.id,
    score        : d.score.toFixed(1),
    distance_m   : d.distance_m,
    duration_s   : d.duration_s,
    dailyRides   : d.stats.dailyRides,
    rating       : d.rating,
    acceptanceRate: (d.stats.acceptanceRate * 100).toFixed(0) + '%',
  })));

  return scored;
}

// ─── Müşteri: arama ilerlemesi (bekleme hissi azaltma) ───────────────────────

async function notifyCustomerMatchingProgress(
  rideId: string,
  customerId: string,
): Promise<void> {
  const settings = getPlatformSettings();
  const timeoutSec = settings.driverResponseTimeoutSeconds;
  const waveSize = Math.max(1, settings.matchingOfferWaveSize);
  const [queuedTotalRaw, askedRaw, queueLen, pendingDrivers] = await Promise.all([
    redis.get(REDIS_KEYS.matchingQueuedTotal(rideId)),
    redis.get(REDIS_KEYS.matchingAskedCount(rideId)),
    redis.llen(REDIS_KEYS.matchingQueue(rideId)),
    getPendingOfferDrivers(rideId),
  ]);

  const driversQueued = Math.max(0, Number(queuedTotalRaw) || 0);
  const driversAsked = Math.max(0, Number(askedRaw) || 0);
  const driversRemainingInQueue = Math.max(0, Number(queueLen) || 0);

  // Dalgadaki en geç biten teklifin kalan süresi (teklif başına deadline).
  let currentOfferSecondsLeft: number | undefined;
  if (pendingDrivers.length > 0) {
    const deadlineRaws = await Promise.all(
      pendingDrivers.map((d) => redis.get(redisDriverResponseDeadlineKey(rideId, d))),
    );
    const deadlines = deadlineRaws.map((v) => Number(v)).filter((v) => Number.isFinite(v));
    currentOfferSecondsLeft =
      deadlines.length > 0
        ? Math.max(0, Math.ceil((Math.max(...deadlines) - Date.now()) / 1000))
        : timeoutSec;
  }

  const currentLeft = currentOfferSecondsLeft ?? 0;
  // Dalga N ise kuyruk N'erli tüketilir — bekleme üst sınırı buna göre daralır.
  const maxWaitSeconds = currentLeft + Math.ceil(driversRemainingInQueue / waveSize) * timeoutSec;

  try {
    const io = getSocketManager();
    io.to(`customer:${customerId}`).emit('ride:matching_progress', {
      rideId,
      driversQueued,
      driversAsked,
      driversRemainingInQueue,
      maxWaitSeconds,
      ...(currentOfferSecondsLeft != null ? { currentOfferSecondsLeft } : {}),
      driverResponseTimeoutSeconds: timeoutSec,
    });
  } catch (e) {
    logger.warn(`[SmartMatching] matching_progress emit hata ride=${rideId}:`, e);
  }
}

// ─── ANA EŞLEŞTİRME FONKSİYONU ───────────────────────────────────────────────

/**
 * Yakındaki sürücüleri arar, filtreler, skorlar ve kuyruğa ekler.
 * Hem ilk aramada (`startSmartMatching`) hem kuyruk tükenince tek seferlik "ikinci dalga"
 * yeniden aramasında (bkz. `retrySearchOnce` / `_fillOfferWaveInner`) kullanılır — ikinci
 * çağrıda `ride:rejected:{rideId}` seti zaten dolu olduğundan daha önce reddeden sürücülere
 * tekrar teklif gitmez.
 *
 * @returns kuyruğa eklenen sürücü sayısı (0 = hiç aday bulunamadı/uygun değil).
 */
async function searchAndEnqueueDrivers(
  rideId    : string,
  pickupLat : number,
  pickupLng : number,
): Promise<number> {
  const settings = getPlatformSettings();

  // 1. Yakındaki sürücüleri bul
  const { data: nearbyRaw, error } = await supabaseAdmin.rpc('find_nearby_drivers', {
    lat           : pickupLat,
    lng           : pickupLng,
    radius_meters : settings.matchingSearchRadiusM,
    max_results   : 20, // havada ön seçim + Matrix ile daraltılır
  });

  if (error || !nearbyRaw?.length) {
    logger.warn(`[SmartMatching] No nearby drivers for ride ${rideId}`);
    return 0;
  }

  // PostGIS / RPC ile kuş uçumu çemberinden ham adaylar
  const parsed: ParsedNearbyDriver[] = nearbyRaw.map((d: Record<string, unknown>) => {
    const id = String(d.id ?? d.driver_id ?? '');
    const lat = Number(d.lat ?? d.lat_out ?? 0);
    const lng = Number(d.lng ?? d.lng_out ?? 0);
    return {
      id,
      lat,
      lng,
      rating      : Number(d.rating ?? 5.0),
      rating_count: Number(d.rating_count ?? 0),
    };
  });

  // Online/müsait/bakiye/canlı-socket/kilit filtresi EN BAŞTA — Google Distance Matrix'e
  // (ücretli) yalnızca gerçekten teklif gönderilebilecek adaylar gönderilsin. Önceden bu
  // filtre Matrix çağrısından SONRA yapılıyordu; elenecek adaylar için de Matrix'e ödeme
  // yapılmış oluyordu.
  const parsedEligible = await filterCandidatesForRide(parsed, rideId);
  if (parsedEligible.length === 0) {
    logger.warn(`[SmartMatching] No eligible drivers after DB/Redis filter for ride ${rideId}`);
    return 0;
  }

  // Önce kuş uçumuna göre sırala — Google Matrix yalnızca en yakın N adaya (maliyet ↓, performans ↑)
  const withAir: ParsedWithAir[] = parsedEligible.map((p) => ({
    ...p,
    air_m: haversineDistance(pickupLat, pickupLng, p.lat, p.lng) * 1000,
  }));
  withAir.sort((a, b) => a.air_m - b.air_m);
  const preselected = withAir.slice(0, settings.matchingRoadMatrixMaxDrivers);

  const driving = await drivingMetersAndSecondsDriverToPickup(
    pickupLat,
    pickupLng,
    preselected.map((p) => ({ lat: p.lat, lng: p.lng })),
  );

  const nearby: NearbyDriver[] = preselected.map((p, i) => {
    const airM = haversineDistance(pickupLat, pickupLng, p.lat, p.lng) * 1000;
    return {
      id: p.id,
      lat: p.lat,
      lng: p.lng,
      rating: p.rating,
      rating_count: p.rating_count,
      distance_m: driving[i]?.meters ?? airM,
      duration_s: driving[i]?.seconds ?? Math.round(estimateArrivalTime(
        { lat: pickupLat, lng: pickupLng },
        { lat: p.lat, lng: p.lng },
      ) * 60),
    };
  });

  // 2. Reddeden sürücüleri Redis'ten yükle (ikinci dalgada da geçerli — önceki ret tekrar sorulmaz)
  const rejectedRaw = await redis.smembers(REDIS_KEYS.rejected(rideId));
  const rejectedIds = new Set(rejectedRaw);

  // 3. Skor hesapla ve sırala (süre bandı + skor — bkz. scoreAndRankDrivers)
  const ranked = await scoreAndRankDrivers(nearby, rejectedIds);
  if (ranked.length === 0) return 0;

  // 4. En iyi adayları Redis LIST olarak yaz (LPOP = atomik sıra) — dalga boyutuna göre kapasite
  const queue = ranked
    .slice(0, queueCapForWave(settings.matchingOfferWaveSize, settings.matchingMaxDriversPerRide))
    .map(d => d.id);
  if (queue.length === 0) return 0;

  const qKey = REDIS_KEYS.matchingQueue(rideId);
  await redis.rpush(qKey, ...queue);
  await redis.expire(qKey, QUEUE_TTL_S);
  await redis.incrby(REDIS_KEYS.matchingQueuedTotal(rideId), queue.length);
  await redis.expire(REDIS_KEYS.matchingQueuedTotal(rideId), QUEUE_TTL_S);

  return queue.length;
}

/**
 * İkinci dalga araması: kuyruk tükenip hiç açık teklif kalmadığında, ride başına yalnızca
 * BİR KEZ çalışacak şekilde `retrySearchUsed` bayrağıyla korunur (SET NX — eşzamanlı
 * çağrılar birbirini tekrar tetiklemez). `_fillOfferWaveInner` çağırır.
 *
 * @returns yeni kuyruğa eklenen sürücü sayısı (0 = ya zaten bir kez denenmiş, ya da
 *          ikinci arama da aday bulamadı).
 */
async function retrySearchOnce(
  rideId    : string,
  pickupLat : number,
  pickupLng : number,
): Promise<number> {
  const firstAttempt = await redis.set(REDIS_KEYS.retrySearchUsed(rideId), '1', 'EX', QUEUE_TTL_S, 'NX');
  if (!firstAttempt) return 0; // bu ride için ikinci dalga zaten denendi

  logger.info(`[SmartMatching] Kuyruk tükendi — ikinci (son) arama denemesi ride=${rideId}`);
  const count = await searchAndEnqueueDrivers(rideId, pickupLat, pickupLng);
  if (count > 0) {
    logger.info(`[SmartMatching] İkinci arama ${count} yeni aday buldu ride=${rideId}`);
  } else {
    logger.info(`[SmartMatching] İkinci arama da aday bulamadı ride=${rideId}`);
  }
  return count;
}

export async function startSmartMatching(
  rideId     : string,
  pickupLat  : number,
  pickupLng  : number,
  customerId : string,
): Promise<void> {

  logger.info(`[SmartMatching] Starting for ride ${rideId}`);

  // Sweeper bağlamı (customer + pickup) — restart sonrası bu sayede ilerlenebilir.
  await saveMatchingContext(rideId, { customerId, pickupLat, pickupLng });

  await redis.del(REDIS_KEYS.matchingQueue(rideId));
  const queuedCount = await searchAndEnqueueDrivers(rideId, pickupLat, pickupLng);
  if (queuedCount === 0) {
    await handleNoDriversAvailable(rideId, customerId);
    return;
  }

  await redis.del(REDIS_KEYS.matchingAskedCount(rideId));
  await notifyCustomerMatchingProgress(rideId, customerId);

  // İlk sürücüye gönder
  await sendRequestToNextDriver(rideId, customerId, pickupLat, pickupLng);
}

/**
 * Eski STRING+JSON kuyruğunu LIST'e migrate eder (yalnızca deploy geçişi artığı için).
 * startSmartMatching her zaman LIST üretir; bu yalnızca eski sürümden kalan ride'lar içindir.
 */
async function ensureListQueue(rideId: string): Promise<void> {
  const key = REDIS_KEYS.matchingQueue(rideId);
  const t = await redis.type(key);
  if (t === 'string') {
    const raw = await redis.get(key);
    await redis.del(key);
    if (raw) {
      try {
        const arr = JSON.parse(raw) as unknown;
        if (Array.isArray(arr) && arr.length > 0) {
          await redis.rpush(key, ...arr.map((x) => String(x)));
          await redis.expire(key, QUEUE_TTL_S);
        }
      } catch {
        // bozuk eski kuyruk — boş bırak (handleNoDriversAvailable devreye girer)
      }
    }
  }
}

/**
 * Atomik sürücü devralma — pop + canlı socket kontrolü + offer kilidi (NX) + pending +
 * UI deadline + dayanıklı ZSET son tarihi TEK Lua script'inde yapılır.
 *
 * Önceki kod LPOP ile SET NX'i ayrı komutlarda çalıştırıyordu; arada NX başarısız olunca
 * sürücü kuyruktan düşer ve geri eklenmezdi (havuz erimesi) ya da iki paralel akış aynı
 * sürücüye teklif gönderebilirdi. Bu Lua o yarışları tamamen ortadan kaldırır.
 *
 * @returns atanan driverId, veya kuyrukta uygun sürücü kalmadıysa null.
 */
const ACQUIRE_NEXT_DRIVER_LUA = `
  local queueKey = KEYS[1]
  local pendingKey = KEYS[2]
  local zsetKey = KEYS[3]
  local socketPrefix = ARGV[1]
  local offerPrefix = ARGV[2]
  local rideId = ARGV[3]
  local ttl = tonumber(ARGV[4])
  local uiDeadlineMs = ARGV[5]
  local queueTtl = tonumber(ARGV[6])
  local sweepScoreMs = tonumber(ARGV[7])
  local deadlinePrefix = ARGV[8]
  if redis.call('TYPE', pendingKey).ok == 'string' then
    local old = redis.call('GET', pendingKey)
    redis.call('DEL', pendingKey)
    if old then
      redis.call('SADD', pendingKey, old)
    end
  end
  while true do
    local driverId = redis.call('LPOP', queueKey)
    if not driverId then
      return false
    end
    local hasSocket = redis.call('GET', socketPrefix .. driverId)
    if hasSocket then
      local locked = redis.call('SET', offerPrefix .. driverId, rideId, 'EX', ttl, 'NX')
      if locked then
        redis.call('SADD', pendingKey, driverId)
        redis.call('EXPIRE', pendingKey, ttl)
        redis.call('SET', deadlinePrefix .. driverId, uiDeadlineMs, 'EX', ttl)
        redis.call('ZADD', zsetKey, sweepScoreMs, rideId .. '::' .. driverId)
        if redis.call('LLEN', queueKey) > 0 then
          redis.call('EXPIRE', queueKey, queueTtl)
        end
        return driverId
      end
    end
  end
`;

/** Testler için dışa açık — ACQUIRE_NEXT_DRIVER_LUA'nın atomiklik garantilerini doğrudan doğrulamak için. */
export async function acquireNextDriver(
  rideId: string,
  ttlSeconds: number,
  uiDeadlineMs: number,
  sweepScoreMs: number,
): Promise<string | null> {
  await ensureListQueue(rideId);
  try {
    const res = (await redis.eval(
      ACQUIRE_NEXT_DRIVER_LUA,
      3,
      REDIS_KEYS.matchingQueue(rideId),
      REDIS_KEYS.pending(rideId),
      OFFER_DEADLINES_ZSET,
      DRIVER_SOCKET_KEY,
      DRIVER_PENDING_OFFER_PREFIX,
      rideId,
      String(ttlSeconds),
      String(uiDeadlineMs),
      String(QUEUE_TTL_S),
      String(sweepScoreMs),
      redisDriverResponseDeadlinePrefix(rideId),
    )) as string | number | null;
    if (!res || res === '' || res === 0) return null;
    return String(res);
  } catch (e) {
    logger.error(`[SmartMatching] acquireNextDriver Lua hatası ride=${rideId}:`, e);
    return null;
  }
}

/** Teklif gönderilemediğinde (offline/çevrimdışı) yalnızca BU sürücünün kilitlerini serbest bırak
 *  — dalgadaki diğer açık teklifler etkilenmez. */
async function releaseOffer(rideId: string, driverId: string): Promise<void> {
  await Promise.all([
    redis.srem(REDIS_KEYS.pending(rideId), driverId).catch(() => 0),
    redis.del(REDIS_KEYS.driverActiveOffer(driverId)),
    redis.del(redisDriverResponseDeadlineKey(rideId, driverId)),
    redis.zrem(OFFER_DEADLINES_ZSET, offerMember(rideId, driverId)),
  ]);
}

// ─── Eşleştirme Bağlamı (sweeper için kalıcı customer + pickup) ───────────────

async function saveMatchingContext(rideId: string, ctx: MatchingContext): Promise<void> {
  try {
    await redis.setex(REDIS_KEYS.matchingCtx(rideId), QUEUE_TTL_S, JSON.stringify(ctx));
  } catch (e) {
    logger.warn(`[SmartMatching] matching ctx yazılamadı ride=${rideId}:`, e);
  }
}

async function loadMatchingContext(rideId: string): Promise<MatchingContext | null> {
  const raw = await redis.get(REDIS_KEYS.matchingCtx(rideId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as MatchingContext;
    if (
      typeof parsed.customerId === 'string' &&
      Number.isFinite(parsed.pickupLat) &&
      Number.isFinite(parsed.pickupLng)
    ) {
      return parsed;
    }
  } catch {
    // bozuk cache — DB fallback kullanılır
  }
  return null;
}

/** Redis bağlamı yoksa (örn. restart sonrası TTL düştü) DB'den çöz — yalnızca hâlâ searching ise. */
async function fetchContextFromDb(rideId: string): Promise<MatchingContext | null> {
  try {
    const { data } = await supabaseAdmin
      .from('rides')
      .select('customer_id, pickup_location, status')
      .eq('id', rideId)
      .maybeSingle();
    if (!data) return null;
    if ((data.status as string | undefined) !== 'searching') return null;
    const pt = decodeEwkbPoint((data as { pickup_location?: unknown }).pickup_location);
    if (!pt) return null;
    return { customerId: String(data.customer_id), pickupLat: pt.lat, pickupLng: pt.lng };
  } catch (e) {
    logger.warn(`[SmartMatching] fetchContextFromDb hata ride=${rideId}:`, e);
    return null;
  }
}

// ─── Atomik Pending Devralma (Lua) ────────────────────────────────────────────

/**
 * Sürücü hâlâ pending SET'inde ise: yalnızca ONUN teklif anahtarlarını sil ve "1" döndür.
 * Aksi halde "0" döndür ve hiçbir şeye dokunma. Dalgadaki diğer açık teklifler korunur.
 *
 * Bu sayede timeout callback'i ile ride:accept / ret yarışı kazansa bile aynı teklifi
 * yalnızca bir akış işler — çift ceza / çift ilerleme / çift wallet hareketi olmaz.
 */
const CLAIM_TIMEOUT_LUA = `
  local pendingKey = KEYS[1]
  if redis.call('TYPE', pendingKey).ok == 'string' then
    local old = redis.call('GET', pendingKey)
    redis.call('DEL', pendingKey)
    if old then
      redis.call('SADD', pendingKey, old)
    end
  end
  if redis.call('SREM', pendingKey, ARGV[1]) == 1 then
    redis.call('DEL', KEYS[2])
    redis.call('DEL', KEYS[3])
    redis.call('ZREM', KEYS[4], ARGV[2])
    return 1
  end
  return 0
`;

async function claimTimeoutSlot(
  rideId: string,
  driverId: string,
): Promise<boolean> {
  try {
    const res = (await redis.eval(
      CLAIM_TIMEOUT_LUA,
      4,
      REDIS_KEYS.pending(rideId),
      REDIS_KEYS.driverActiveOffer(driverId),
      redisDriverResponseDeadlineKey(rideId, driverId),
      OFFER_DEADLINES_ZSET,
      driverId,
      offerMember(rideId, driverId),
    )) as number | string;
    return Number(res) === 1;
  } catch (e) {
    logger.warn('[SmartMatching] claimTimeoutSlot Lua hatası:', e);
    // Lua kullanılamazsa eski yola dön — SREM tek başına da atomik claim'dir.
    let removed = 0;
    try {
      removed = await redis.srem(REDIS_KEYS.pending(rideId), driverId);
    } catch {
      // eski STRING format artığı
      const legacy = await redis.get(REDIS_KEYS.pending(rideId)).catch(() => null);
      if (legacy !== driverId) return false;
      await redis.del(REDIS_KEYS.pending(rideId));
      removed = 1;
    }
    if (removed !== 1) return false;
    await Promise.all([
      redis.del(REDIS_KEYS.driverActiveOffer(driverId)),
      redis.del(redisDriverResponseDeadlineKey(rideId, driverId)),
      redis.zrem(OFFER_DEADLINES_ZSET, offerMember(rideId, driverId)),
    ]);
    return true;
  }
}

// ─── Eşleştirme Dağıtık Lock ──────────────────────────────────────────────────

const MATCHING_LOCK_TTL_S = 15;
const matchingLockKey = (rideId: string) => `ride:matching:lock:${rideId}`;
/** Lock başka bir akışta tutuluyorsa kısa aralıklarla yeniden dene (sessiz drop = takılma riski). */
const LOCK_MAX_ATTEMPTS = 25;
const LOCK_RETRY_DELAY_MS = 150;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * sendRequestToNextDriver'ın eş zamanlı çağrılmasını serileştirir.
 * Aynı ride için iki paralel çağrı (timeout + rejection) aynı sürücüye çift offer göndermesin.
 *
 * ÖNEMLİ: Lock alınamazsa SESSİZCE return ETMEZ — kısa aralıklarla yeniden dener. Aksi halde
 * gerçekten gerekli olan "sıradaki sürücüye geç" ilerlemesi düşebilir ve yolculuk searching'de
 * takılırdı. Çağıran taraf zaten claimTimeoutSlot ile tek kazanan olduğundan, retry çift offer
 * üretmez; yalnızca tek gerçek ilerlemenin çalışmasını garanti eder.
 */
async function withMatchingLock(rideId: string, fn: () => Promise<void>): Promise<void> {
  const lockKey = matchingLockKey(rideId);
  for (let attempt = 1; attempt <= LOCK_MAX_ATTEMPTS; attempt++) {
    const acquired = await redis.set(lockKey, '1', 'EX', MATCHING_LOCK_TTL_S, 'NX');
    if (acquired) {
      try {
        await fn();
      } finally {
        await redis.del(lockKey);
      }
      return;
    }
    if (attempt < LOCK_MAX_ATTEMPTS) {
      await sleep(LOCK_RETRY_DELAY_MS);
    }
  }
  // Buraya gelinmesi olağan dışı; sweeper bir sonraki turda yine de kurtarır.
  logger.warn(
    `[SmartMatching] matching lock ${LOCK_MAX_ATTEMPTS} denemede alınamadı ride=${rideId} — sweeper kurtarmaya bırakıldı`,
  );
}

// ─── Sıradaki Sürücüye Gönder ─────────────────────────────────────────────────

/** Testler için dışa açık — dalgayı (waveSize kadar açık teklif) doldurup timeout zincirini tetiklemek için.
 *  Adı geriye dönük: dalga 1 iken birebir "sıradaki sürücüye gönder" davranışıdır. */
export async function sendRequestToNextDriver(
  rideId    : string,
  customerId: string,
  pickupLat : number,
  pickupLng : number,
): Promise<void> {
  return withMatchingLock(rideId, () => _fillOfferWaveInner(rideId, customerId, pickupLat, pickupLng));
}

/**
 * Dalgayı doldur: açık teklif sayısı `matchingOfferWaveSize`e ulaşana kadar kuyruktan
 * sürücü devral ve teklif gönder. Kuyruk tükendiğinde:
 *   - hâlâ açık teklif varsa HİÇBİR ŞEY yapma (kabul/timeout sonucu beklenir;
 *     erken iptal edilirse dalgadaki sürücünün geç kabulü boşa giderdi),
 *   - hiç açık teklif kalmadıysa gerçekten sürücü yok → yolculuğu kapat.
 */
async function _fillOfferWaveInner(
  rideId    : string,
  customerId: string,
  pickupLat : number,
  pickupLng : number,
): Promise<void> {

  const driverTimeoutMs = getDriverResponseTimeoutMs();
  const serverTimeoutMs = driverTimeoutMs + DRIVER_RESPONSE_END_GRACE_MS;
  const offerLockTtlSeconds = driverOfferRedisTtlSecondsFromMs(serverTimeoutMs);
  const waveSize = Math.max(1, getPlatformSettings().matchingOfferWaveSize);

  // Bağlamı (customer + pickup) tazele; sweeper restart sonrası buradan ilerler.
  await saveMatchingContext(rideId, { customerId, pickupLat, pickupLng });

  let progressChanged = false;
  while (true) {
    const outstanding = (await getPendingOfferDrivers(rideId)).length;
    if (outstanding >= waveSize) break; // dalga dolu — açık teklifler yanıt bekliyor

    // UI deadline = admin yanıt süresi; sweeper deadline'ı tampon kadar sonra
    // (in-memory timer önce ateşlensin, sweeper yalnızca timer kaybolursa devreye girsin).
    const uiDeadlineMs = Date.now() + driverTimeoutMs;
    const sweepScoreMs = Date.now() + serverTimeoutMs;

    // Atomik devralma: pop + socket kontrolü + offer kilidi + pending SET + deadline + ZSET.
    const driverId = await acquireNextDriver(rideId, offerLockTtlSeconds, uiDeadlineMs, sweepScoreMs);
    if (!driverId) {
      if (outstanding === 0) {
        // Kuyruk tükendi ve hiç açık teklif kalmadı — vazgeçmeden önce BİR KEZ (ride başına)
        // yeniden ara. O ana kadar geçen sürede yeni çevrimiçi olan veya başka çağrıdan
        // boşalan sürücüler bu ikinci aramada değerlendirilebilir.
        const requeued = await retrySearchOnce(rideId, pickupLat, pickupLng);
        if (requeued > 0) {
          continue; // yeni kuyruk dolduruldu — döngü devam edip devralmayı dener
        }
        await handleNoDriversAvailable(rideId, customerId);
        return;
      }
      break; // kuyruk bitti ama dalgada açık teklif var — sonucu bekle
    }

    // Yarış / stale kuyruk: DB artık çevrimdışıysa bildirim gitmez; kilitleri bırakıp sıradakine geç.
    const delivered = await notificationService.sendRideRequest(driverId, rideId);
    if (!delivered) {
      logger.info(
        `[SmartMatching] İstek gönderilemedi (çevrimdışı / müsait değil), kilit temizleniyor: ${driverId} ride=${rideId}`,
      );
      await releaseOffer(rideId, driverId);
      continue;
    }

    logger.info(
      `[SmartMatching] Request sent to driver ${driverId} for ride ${rideId} (dalga ${outstanding + 1}/${waveSize})`,
    );
    progressChanged = true;

    await redis.incr(REDIS_KEYS.matchingAskedCount(rideId));
    await redis.expire(REDIS_KEYS.matchingAskedCount(rideId), QUEUE_TTL_S);

    // Hızlı yol: in-memory timer süre dolunca ilerletir. Süreç restart olursa bu timer
    // kaybolur AMA ZSET son tarihi Redis'te kalır ve sweeper kurtarır.
    scheduleOfferTimeout(rideId, driverId, customerId, pickupLat, pickupLng, serverTimeoutMs);
  }

  if (progressChanged) {
    await notifyCustomerMatchingProgress(rideId, customerId);
  }
}

// ─── Teklif Timeout: in-memory hızlı yol + sweeper paylaşımlı işleme ───────────

function offerTimeoutHandleKey(rideId: string, driverId: string): string {
  return `timeout:${rideId}:${driverId}`;
}

function scheduleOfferTimeout(
  rideId    : string,
  driverId  : string,
  customerId: string,
  pickupLat : number,
  pickupLng : number,
  serverTimeoutMs: number,
): void {
  const timeoutHandle = setTimeout(() => {
    void handleOfferTimeout(rideId, driverId, customerId, pickupLat, pickupLng);
  }, serverTimeoutMs);
  (global as unknown as Record<string, ReturnType<typeof setTimeout>>)[
    offerTimeoutHandleKey(rideId, driverId)
  ] = timeoutHandle;
}

/**
 * Bir teklifin süresi dolunca: atomik claim (kabul/iptal/diğer akışla yarışta tek kazanan),
 * ceza ve sıradaki sürücüye ilerleme. Hem in-memory timer hem sweeper bunu çağırır;
 * claim sayesinde aynı teklif yalnızca bir kez ilerletilir.
 */
async function handleOfferTimeout(
  rideId    : string,
  driverId  : string,
  customerId: string,
  pickupLat : number,
  pickupLng : number,
): Promise<void> {
  try {
    const claimed = await claimTimeoutSlot(rideId, driverId);
    if (!claimed) {
      logger.info(
        `[SmartMatching] Timeout claim kaybedildi (kabul/iptal/diğer akış kazandı) ride=${rideId} driver=${driverId}`,
      );
      return;
    }

    logger.warn(`[SmartMatching] Driver ${driverId} timed out for ride ${rideId}`);

    try {
      await applyTimeoutPenalty(driverId);
    } catch (penaltyErr) {
      logger.warn(`[SmartMatching] applyTimeoutPenalty hata ${driverId}:`, penaltyErr);
    }

    await notifyCustomerMatchingProgress(rideId, customerId);
    await sendRequestToNextDriver(rideId, customerId, pickupLat, pickupLng);
  } catch (timerErr) {
    logger.error(`[SmartMatching] offer timeout işleme hata ride=${rideId} driver=${driverId}:`, timerErr);
  }
}

// ─── Dayanıklı Teklif Sweeper (deploy/restart kurtarması) ─────────────────────

let offerSweeperHandle: NodeJS.Timeout | null = null;
const OFFER_SWEEP_INTERVAL_MS = 2000;
const OFFER_SWEEP_BATCH = 50;

/**
 * Süresi dolmuş tüm teklifleri Redis ZSET'inden okuyup atomik olarak sıradaki sürücüye
 * ilerletir. In-memory timer'lar süreç restart'ında kaybolsa bile bu döngü eşleştirmeyi
 * birkaç saniye içinde devam ettirir — yolculuk artık "searching"de takılmaz.
 */
export async function sweepExpiredOffersOnce(): Promise<number> {
  let members: string[] = [];
  try {
    members = await redis.zrangebyscore(OFFER_DEADLINES_ZSET, 0, Date.now(), 'LIMIT', 0, OFFER_SWEEP_BATCH);
  } catch (e) {
    logger.error('[SmartMatching][sweeper] zrangebyscore hata:', e);
    return 0;
  }
  if (members.length === 0) return 0;

  let handled = 0;
  for (const member of members) {
    try {
      const parsed = parseOfferMember(member);
      if (!parsed) {
        await redis.zrem(OFFER_DEADLINES_ZSET, member);
        continue;
      }
      const { rideId, driverId } = parsed;

      const claimed = await claimTimeoutSlot(rideId, driverId);
      if (!claimed) {
        // Başka akış (in-memory timer / kabul / iptal) zaten ele aldı.
        await redis.zrem(OFFER_DEADLINES_ZSET, member);
        continue;
      }

      handled++;
      logger.warn(`[SmartMatching][sweeper] Süresi dolan teklif kurtarıldı ride=${rideId} driver=${driverId}`);

      try {
        await applyTimeoutPenalty(driverId);
      } catch (penaltyErr) {
        logger.warn(`[SmartMatching][sweeper] applyTimeoutPenalty hata ${driverId}:`, penaltyErr);
      }

      const ctx = (await loadMatchingContext(rideId)) ?? (await fetchContextFromDb(rideId));
      if (!ctx) {
        logger.warn(
          `[SmartMatching][sweeper] ride=${rideId} bağlam çözülemedi (artık searching değil olabilir) — atlanıyor`,
        );
        continue;
      }

      await notifyCustomerMatchingProgress(rideId, ctx.customerId);
      await sendRequestToNextDriver(rideId, ctx.customerId, ctx.pickupLat, ctx.pickupLng);
    } catch (e) {
      logger.error(`[SmartMatching][sweeper] üye işleme hata member=${member}:`, e);
    }
  }
  return handled;
}

export function initOfferSweeper(): void {
  if (offerSweeperHandle) return;
  offerSweeperHandle = setInterval(() => {
    void sweepExpiredOffersOnce();
  }, OFFER_SWEEP_INTERVAL_MS);
  logger.info(`[SmartMatching] dayanıklı teklif sweeper aktif (her ${OFFER_SWEEP_INTERVAL_MS} ms)`);
}

export function stopOfferSweeper(): void {
  if (offerSweeperHandle) {
    clearInterval(offerSweeperHandle);
    offerSweeperHandle = null;
    logger.info('[SmartMatching] teklif sweeper durduruldu.');
  }
}

// ─── Ret İşleme ───────────────────────────────────────────────────────────────

export async function handleSmartRejection(
  rideId    : string,
  driverId  : string,
  customerId: string,
  pickupLat : number,
  pickupLng : number,
): Promise<void> {
  logger.info(`[SmartMatching] Driver ${driverId} rejected ride ${rideId}`);

  // Timeout'u iptal et (callback zaten kuyrukta olabilir; Lua claim koruması son hattır)
  clearTimeout(
    (global as unknown as Record<string, ReturnType<typeof setTimeout>>)[
      offerTimeoutHandleKey(rideId, driverId)
    ],
  );

  // Reddedenler setine ekle (yeniden teklif gitmesin)
  await redis.sadd(REDIS_KEYS.rejected(rideId), driverId);
  await redis.expire(REDIS_KEYS.rejected(rideId), QUEUE_TTL_S);

  // Atomik olarak pending slot'unu devral — başka bir akış (timeout/kabul) henüz
  // ele almadıysa "1" gelir ve aynı anda tüm anahtarları siler.
  const claimed = await claimTimeoutSlot(rideId, driverId);
  if (!claimed) {
    // Claim kaybedildi → bu teklifi başka bir akış (timeout/kabul) zaten işledi.
    // ÇİFT CEZA ve ÇİFT İLERLEME olmasın diye burada applyRejectionRecord / sendRequestToNextDriver ÇAĞIRMA.
    logger.info(
      `[SmartMatching] Ret claim kaybedildi (timeout/kabul önceden işledi) ride=${rideId} driver=${driverId} — ilerleme atlanıyor`,
    );
    return;
  }

  // Ret kaydı (kabul oranını düşürür) — yalnızca claim kazanıldıysa
  try {
    await applyRejectionRecord(driverId);
  } catch (e) {
    logger.warn(`[SmartMatching] applyRejectionRecord hata ${driverId}:`, e);
  }

  await notifyCustomerMatchingProgress(rideId, customerId);
  // Sıradakine geç — withMatchingLock zaten paralel çağrıları serileştirir
  await sendRequestToNextDriver(rideId, customerId, pickupLat, pickupLng);
}

// ─── Sürücü Offline/Disconnect: Bekleyen Teklifi Terk Et ──────────────────────

/**
 * Sürücü çevrimdışı olur / socket koparsa, o sürücüye gönderilmiş bekleyen teklif varsa
 * ZSET deadline'ını beklemeden hemen sıradaki sürücüye geç. Aksi halde müşteri, çevrimdışı
 * bir sürücünün yanıt süresi dolana kadar boşuna beklerdi.
 *
 * Ceza UYGULANMAZ — çevrimdışı olmak (özellikle ağ kopması) bir "ret" değildir.
 */
export async function handleDriverOfflineAbandon(driverId: string): Promise<void> {
  let rideId: string | null = null;
  try {
    rideId = await redis.get(REDIS_KEYS.driverActiveOffer(driverId));
  } catch (e) {
    logger.warn(`[SmartMatching] offline-abandon offer okuma hata ${driverId}:`, e);
    return;
  }
  if (!rideId) return;

  // Bu sürücü hâlâ bu ride'ın pending'i mi? Atomik claim ile devral.
  const claimed = await claimTimeoutSlot(rideId, driverId);
  if (!claimed) {
    // Pending değil (kabul/iptal/başka akış); kalan offer kilidini güvenle temizle.
    await redis.del(REDIS_KEYS.driverActiveOffer(driverId));
    return;
  }

  clearTimeout(
    (global as unknown as Record<string, ReturnType<typeof setTimeout>>)[
      offerTimeoutHandleKey(rideId, driverId)
    ],
  );

  logger.warn(
    `[SmartMatching] Sürücü offline/disconnect — bekleyen teklif terk edildi, sıradakine geçiliyor ride=${rideId} driver=${driverId}`,
  );

  const ctx = (await loadMatchingContext(rideId)) ?? (await fetchContextFromDb(rideId));
  if (!ctx) {
    logger.warn(`[SmartMatching] offline-abandon bağlam çözülemedi ride=${rideId} — atlanıyor`);
    return;
  }
  await notifyCustomerMatchingProgress(rideId, ctx.customerId);
  await sendRequestToNextDriver(rideId, ctx.customerId, ctx.pickupLat, ctx.pickupLng);
}

// ─── Kabul İşleme ─────────────────────────────────────────────────────────────

export async function handleSmartAcceptance(rideId: string, driverId: string): Promise<void> {
  // Timeout'u hemen iptal et ki yarış durumu oluşmasın
  clearTimeout(
    (global as unknown as Record<string, ReturnType<typeof setTimeout>>)[
      offerTimeoutHandleKey(rideId, driverId)
    ],
  );

  try {
    await applyAcceptanceRecord(driverId);
  } catch (e) {
    logger.warn(`[SmartMatching] applyAcceptanceRecord hata ${driverId}:`, e);
  }

  // Atomik olarak pending'i temizle — timeout callback'i fırlamış olsa da
  // "pending == driverId" görmeyecek ve sıradakine offer göndermeyecek.
  await claimTimeoutSlot(rideId, driverId);
}

// ─── Sürücü Bulunamadı ────────────────────────────────────────────────────────

async function handleNoDriversAvailable(rideId: string, customerId: string): Promise<void> {
  logger.warn(`[SmartMatching] No drivers available for ride ${rideId}`);
  await redis.del(REDIS_KEYS.matchingQueuedTotal(rideId));
  await redis.del(REDIS_KEYS.matchingAskedCount(rideId));
  await notifyCustomerMatchingProgress(rideId, customerId);

  // Yalnızca hâlâ "searching" + atanmış sürücü yokken iptal et.
  // rideService.updateRideStatus(müşteri cancelled) accepted→cancelled izin verir;
  // timeout ile geç kabul yarışında yanlışlıkla kabulü silip T Coin iadesi tetiklenmesin.
  const nowIso = new Date().toISOString();
  const { data: cancelledRow, error: cancelErr } = await supabaseAdmin
    .from('rides')
    .update({
      status: 'cancelled',
      cancelled_at: nowIso,
      cancel_reason: 'Yakında müsait sürücü bulunamadı.',
    })
    .eq('id', rideId)
    .eq('customer_id', customerId)
    .eq('status', 'searching')
    .is('driver_id', null)
    .select('id')
    .maybeSingle();

  if (cancelErr) {
    logger.warn(
      `[SmartMatching] searching→cancelled (no_driver) atomik güncelleme hata ride=${rideId}:`,
      cancelErr.message,
    );
    await clearSmartMatchingQueue(rideId, false);
    return;
  }

  if (!cancelledRow) {
    const { data: cur } = await supabaseAdmin
      .from('rides')
      .select('status')
      .eq('id', rideId)
      .maybeSingle();
    logger.info(
      `[SmartMatching] handleNoDrivers atlandı — yolculuk artık searching değil (status=${cur?.status ?? 'bilinmiyor'}) ride=${rideId}`,
    );
    await clearSmartMatchingQueue(rideId, false);
    return;
  }

  logger.info(`Yolculuk güncellendi: ${rideId}, searching → cancelled (müsait sürücü yok)`);
  await notifyCustomerMatchingProgress(rideId, customerId);
  await clearSmartMatchingQueue(rideId, true, 'no_driver');
  const io = getSocketManager();
  io.to(`customer:${customerId}`).emit('ride:no_driver_found', { rideId });
  void notifyRideCancelledByFcm({
    rideId,
    customerId,
    scenario: 'system',
    systemBody: 'Yakında müsait sürücü bulunamadı; talep kapatıldı.',
  }).catch((e: unknown) => logger.warn('[FCM] no_driver push:', e));
}

// ─── Kuyruk Temizle (İptal) ───────────────────────────────────────────────────

/** Redis eşleştirme anahtarlarını siler. [notifyPendingDrivers]: dalgadaki `ride:pending`
 *  sürücülerine `ride:request_cancelled` gider. Başarılı kabul sonrası kazanan sürücüyü
 *  [excludeDriverId] ile hariç tut — dalganın kalanına "başka sürücü kabul etti" giderken
 *  kazanana yanlış iptal gitmez. */
export async function clearSmartMatchingQueue(
  rideId             : string,
  notifyPendingDrivers: boolean,
  cancelReason:
    | 'customer_cancelled'
    | 'no_driver'
    | 'accepted_by_other' = 'customer_cancelled',
  excludeDriverId?: string,
): Promise<void> {
  const pendingDriverIds = await getPendingOfferDrivers(rideId);

  for (const pendingDriverId of pendingDriverIds) {
    clearTimeout(
      (global as unknown as Record<string, ReturnType<typeof setTimeout>>)[
        offerTimeoutHandleKey(rideId, pendingDriverId)
      ],
    );
    await Promise.all([
      redis.del(REDIS_KEYS.driverActiveOffer(pendingDriverId)),
      redis.del(redisDriverResponseDeadlineKey(rideId, pendingDriverId)),
      redis.zrem(OFFER_DEADLINES_ZSET, offerMember(rideId, pendingDriverId)),
    ]);

    if (notifyPendingDrivers && pendingDriverId !== excludeDriverId) {
      const io = getSocketManager();
      const message =
        cancelReason === 'no_driver'
          ? 'Bu çağrı için müsait sürücü bulunamadı; istek kapatıldı.'
          : cancelReason === 'accepted_by_other'
            ? 'Bu çağrı başka bir sürücü tarafından kabul edildi.'
            : 'Müşteri aramayı iptal etti.';
      io.to(`driver:${pendingDriverId}`).emit('ride:request_cancelled', {
        rideId,
        reason: cancelReason,
        message,
      });
    }
  }

  await Promise.all([
    redis.del(REDIS_KEYS.matchingQueue(rideId)),
    redis.del(REDIS_KEYS.matchingQueuedTotal(rideId)),
    redis.del(REDIS_KEYS.matchingAskedCount(rideId)),
    redis.del(REDIS_KEYS.matchingCtx(rideId)),
    redis.del(REDIS_KEYS.rejected(rideId)),
    redis.del(REDIS_KEYS.pending(rideId)),
    redis.del(REDIS_KEYS.retrySearchUsed(rideId)),
  ]);
}
