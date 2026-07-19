/**
 * Ride Servis Katmanı
 * Yolculuk CRUD işlemleri, durum geçişleri ve veritabanı sorguları.
 * Controller bu servisi çağırır.
 */

import { supabaseAdmin } from '../../config/supabase';
import { logger } from '../../utils/logger';
import { AppError } from '../../middleware/error.middleware';
import { computeRideAcceptFeeTcoin } from '../../services/platform_settings.service';
import * as walletService from '../../services/wallet.service';
import { calculatePrice } from './pricing.service';
import { calculateDistance, Coordinates } from '../../utils/distance';
import { decodeEwkbPoint } from '../../utils/geo';
import type { CreateRideInput } from './ride.schema';
import type { RideStatus } from '../../types';

// Yolculuk oluşturma sonuç tipi
interface CreateRideResult {
  id: string;
  customer_id: string;
  pickup_address: string;
  dropoff_address: string;
  distance_km: number;
  estimated_price: number;
  status: RideStatus;
  requested_at: string;
}

// Yolculuk detay tipi (join'li sorgu sonucu)
interface RideDetail {
  id: string;
  customer_id: string;
  driver_id: string | null;
  pickup_address: string;
  dropoff_address: string;
  distance_km: number | null;
  estimated_price: number;
  final_price: number | null;
  status: RideStatus;
  requested_at: string;
  accepted_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  platform_fee?: number | null;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  dropoff_lat?: number | null;
  dropoff_lng?: number | null;
  pickup_verification_code?: string | null;
  pickup_code_verified?: boolean;
}

// Aktif yolculuk snapshot'ı — uygulama reconnect olduğunda tam durumu döndürür
export interface ActiveRideSnapshot extends RideDetail {
  driver?: {
    id: string;
    full_name: string;
    phone: string;
    rating: number;
    vehicle_plate: string;
    vehicle_model: string;
    vehicle_color: string;
    lat?: number;
    lng?: number;
    bearing?: number;
  } | null;
  customer?: {
    id: string;
    full_name: string;
    phone: string;
    rating: number;
  } | null;
}

/** 1000–9999 arası 4 haneli PIN (önde sıfır olabilir: %04d) */
export function generatePickupVerificationCode(): string {
  const n = Math.floor(1000 + Math.random() * 9000);
  return String(n).padStart(4, '0');
}

/**
 * Yeni yolculuk oluşturur
 * 1. Biniş-iniş arası mesafeyi Haversine ile hesapla
 * 2. Tahmini ücreti hesapla
 * 3. Rides tablosuna kayıt ekle (status: searching)
 * 4. PostGIS POINT olarak koordinatları kaydet
 */
export async function createRide(
  customerId: string,
  input: CreateRideInput
): Promise<CreateRideResult> {
  const { pickup, dropoff, pickup_address, dropoff_address } = input;

  // Müşterinin aktif yolculuğu var mı? (aynı anda tek yolculuk)
  // maybeSingle: 0 satırda error dönmez; birden fazla aktif (veri tutarsızlığı) varsa en güncel kayıt.
  const { data: activeRide, error: activeErr } = await supabaseAdmin
    .from('rides')
    .select('id, status')
    .eq('customer_id', customerId)
    .in('status', ['searching', 'accepted', 'arriving', 'in_progress'])
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (activeErr) {
    logger.error('Aktif yolculuk kontrolü hatası:', activeErr);
    throw new AppError('Yolculuk oluşturulamadı, lütfen tekrar deneyin.', 500);
  }

  if (activeRide) {
    throw new AppError(
      `Zaten aktif bir yolculuğunuz var (Durum: ${activeRide.status}). Önce mevcut yolculuğu tamamlayın veya iptal edin.`,
      409
    );
  }

  // Biniş ve iniş noktası arasındaki mesafeyi hesapla (km)
  const from: Coordinates = { lat: pickup.lat, lng: pickup.lng };
  const to: Coordinates = { lat: dropoff.lat, lng: dropoff.lng };
  const haversineKm = calculateDistance(from, to);

  // Yolcu tarafı rota km (Directions) ile sunucu düz çizgi km genelde farklı; tek kaynak olarak
  // müşterinin gönderdiği mesafe makul sınırlar içindeyse onu kullan (sürücü/yolcu tutarı eşitlenir).
  let distanceKm = haversineKm;
  const clientKm = input.distance_km;
  if (clientKm != null && Number.isFinite(clientKm) && clientKm > 0 && clientKm <= 2000) {
    const minOk = haversineKm <= 0.05 ? 0 : haversineKm * 0.9;
    const maxOk = haversineKm <= 0.05 ? 2 : Math.max(haversineKm * 5, haversineKm + 0.2);
    if (clientKm >= minOk && clientKm <= maxOk) {
      distanceKm = Math.round(clientKm * 1000) / 1000;
    } else {
      logger.warn(
        `distance_km istemci=${clientKm} haversine=${haversineKm.toFixed(4)} — sunucu mesafesi kullanılıyor`,
      );
    }
  }

  // Tahmini ücret hesapla
  const estimatedPrice = calculatePrice(distanceKm);

  // PostGIS POINT formatında koordinatları oluştur
  // ST_MakePoint(lng, lat) — PostGIS sıralaması: boylam, enlem
  const pickupPoint = `SRID=4326;POINT(${pickup.lng} ${pickup.lat})`;
  const dropoffPoint = `SRID=4326;POINT(${dropoff.lng} ${dropoff.lat})`;

  // Yolculuğu veritabanına kaydet
  const { data: ride, error } = await supabaseAdmin
    .from('rides')
    .insert({
      customer_id: customerId,
      pickup_location: pickupPoint,
      dropoff_location: dropoffPoint,
      pickup_address,
      dropoff_address,
      distance_km: distanceKm,
      estimated_price: estimatedPrice,
      status: 'searching' as const,
    })
    .select('id, customer_id, pickup_address, dropoff_address, distance_km, estimated_price, status, requested_at')
    .single();

  if (error || !ride) {
    // Partial unique index (uniq_customer_active_ride) ihlali = eşzamanlı çift istek
    if (error && (error.code === '23505' || /uniq_customer_active_ride/i.test(error.message ?? ''))) {
      throw new AppError(
        'Zaten aktif bir yolculuğunuz var. Önce mevcut yolculuğu tamamlayın veya iptal edin.',
        409,
      );
    }
    logger.error('Yolculuk oluşturma hatası:', error);
    throw new AppError('Yolculuk oluşturulamadı.', 500);
  }

  logger.info(`Yeni yolculuk oluşturuldu: ${ride.id}, Mesafe: ${distanceKm} km, Ücret: ${estimatedPrice} TL`);

  return ride as CreateRideResult;
}

/**
 * Müşterinin şu an "searching" durumundaki yolculuğunun id'si (iptal / eşleşme senkronu için)
 */
export async function findSearchingRideIdForCustomer(customerId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('rides')
    .select('id')
    .eq('customer_id', customerId)
    .eq('status', 'searching')
    .maybeSingle();

  if (error) {
    logger.warn('findSearchingRideIdForCustomer:', error);
    return null;
  }
  return data?.id ?? null;
}

/**
 * Müşterinin iptal edilebilir aktif yolculuğu (en güncel kayıt).
 * ride:cancel'da yanlış/geçersiz rideId geldiğinde veya yalnızca searching aranırken kaçırılan accepted vb. durumlar için.
 */
export async function findActiveRideIdForCustomer(customerId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('rides')
    .select('id')
    .eq('customer_id', customerId)
    .in('status', ['searching', 'accepted', 'arriving', 'in_progress'])
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    logger.warn('findActiveRideIdForCustomer:', error);
    return null;
  }
  return data?.id ?? null;
}

/**
 * Aktif yolculuğun yalnızca id + status'ünü hızlıca döndürür (tek index lookup).
 * Reconnect'te socket'i ride room'una HEMEN katmak için kullanılır — tam snapshot
 * sorgusunu beklerken aradaki olayların (cancelled/completed) kaçma penceresini daraltır.
 */
export async function getActiveRideBrief(
  userId: string,
  role: 'customer' | 'driver',
): Promise<{ id: string; status: RideStatus } | null> {
  const filterField = role === 'customer' ? 'customer_id' : 'driver_id';
  const { data, error } = await supabaseAdmin
    .from('rides')
    .select('id, status')
    .eq(filterField, userId)
    .in('status', ['searching', 'accepted', 'arriving', 'in_progress'])
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return { id: data.id as string, status: data.status as RideStatus };
}

/**
 * Yolculuk detayını getirir
 * Sadece yolculuğa dahil olan kullanıcılar (müşteri veya sürücü) erişebilir
 */
export async function getRideById(rideId: string, userId: string): Promise<RideDetail> {
  const { data: ride, error } = await supabaseAdmin
    .from('rides')
    .select(`
      id, customer_id, driver_id,
      pickup_address, dropoff_address,
      distance_km, estimated_price, final_price,
      status, requested_at, accepted_at,
      started_at, completed_at, cancelled_at, cancel_reason
    `)
    .eq('id', rideId)
    .single();

  if (error || !ride) {
    throw new AppError('Yolculuk bulunamadı.', 404);
  }

  // Yetki kontrolü: Sadece müşteri veya atanmış sürücü erişebilir
  if (ride.customer_id !== userId && ride.driver_id !== userId) {
    throw new AppError('Bu yolculuğa erişim yetkiniz yok.', 403);
  }

  return ride as RideDetail;
}

/**
 * Sohbet filtresi için: yolculuğun henüz doğrulanmamış biniş PIN'i (varsa).
 * Doğrulanmışsa veya hiç üretilmemişse null — artık gizlenecek bir şey kalmaz.
 */
export async function getUnverifiedPickupCode(rideId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('rides')
    .select('pickup_verification_code, pickup_code_verified')
    .eq('id', rideId)
    .maybeSingle();

  if (!data || data.pickup_code_verified) return null;
  const code = (data.pickup_verification_code as string | null)?.trim();
  return code && code.length === 4 ? code : null;
}

/**
 * Kullanıcının yolculuk geçmişini listeler (sayfalı)
 */
export async function listRides(
  userId: string,
  role: 'customer' | 'driver',
  page: number = 1,
  limit: number = 10,
  statusFilter?: RideStatus
): Promise<{ items: RideDetail[]; total: number; page: number; limit: number; totalPages: number }> {
  const safePage = Math.max(1, Math.floor(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Math.floor(limit) || 10));
  const offset = (safePage - 1) * safeLimit;

  // Kullanıcı rolüne göre filtre alanını belirle
  const filterField = role === 'customer' ? 'customer_id' : 'driver_id';

  let query = supabaseAdmin
    .from('rides')
    .select(`
      id, customer_id, driver_id,
      pickup_address, dropoff_address,
      distance_km, estimated_price, final_price,
      status, requested_at, accepted_at,
      started_at, completed_at, cancelled_at, cancel_reason
    `, { count: 'exact' })
    .eq(filterField, userId)
    .order('requested_at', { ascending: false })
    .range(offset, offset + safeLimit - 1);

  // İsteğe bağlı durum filtresi
  if (statusFilter) {
    query = query.eq('status', statusFilter);
  }

  const { data, error, count } = await query;

  if (error) {
    logger.error('Yolculuk listesi hatası:', error);
    throw new AppError('Yolculuk listesi alınamadı.', 500);
  }

  const total = count || 0;

  return {
    items: (data || []) as RideDetail[],
    total,
    page: safePage,
    limit: safeLimit,
    totalPages: Math.ceil(total / safeLimit),
  };
}

/**
 * Yolculuk durumunu günceller
 * Durum geçiş kuralları + YETKİ kontrolü:
 *   searching → accepted (yalnızca sürücü; atomic, ilk gelen kazanır)
 *   accepted → arriving (atanan sürücü)
 *   arriving → in_progress (atanan sürücü)
 *   in_progress → completed (atanan sürücü)
 *   searching/accepted/arriving → cancelled (müşteri ya da atanan sürücü)
 *
 * GÜVENLİK: İstek sahibinin (userId) bu yolculuktaki rolüne göre yalnızca
 * yetkili geçişlere izin verilir. Aksi hâlde 403.
 */
export async function updateRideStatus(
  rideId: string,
  newStatus: RideStatus,
  userId: string,
  extras?: {
    driverId?: string;
    finalPrice?: number;
    cancelReason?: string;
    /** Kabul anında kesilen sabit platform ücreti (T Coin / balance birimi) */
    platformFee?: number;
  }
): Promise<RideDetail> {
  // Özel yol: searching → accepted, tek atomic update ile "ilk gelen kazanır"
  // (Bu sayede iki sürücü eşzamanlı kabul ederse ikinciye PGRST116/geçersiz geçiş hatası gider.)
  if (newStatus === 'accepted') {
    const acceptDriverId = extras?.driverId ?? userId;
    if (acceptDriverId !== userId) {
      throw new AppError('Yalnızca kendi adınıza kabul edebilirsiniz.', 403);
    }

    const pickupPin = generatePickupVerificationCode();

    const platformFee = extras?.platformFee ?? 0;

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('rides')
      .update({
        status: 'accepted',
        driver_id: acceptDriverId,
        accepted_at: new Date().toISOString(),
        pickup_verification_code: pickupPin,
        pickup_code_verified: false,
        platform_fee: platformFee,
      })
      .eq('id', rideId)
      .eq('status', 'searching')
      .is('driver_id', null)
      .select(`
        id, customer_id, driver_id,
        pickup_address, dropoff_address,
        distance_km, estimated_price, final_price,
        status, requested_at, accepted_at,
        started_at, completed_at, cancelled_at, cancel_reason,
        pickup_verification_code, pickup_code_verified
      `)
      .maybeSingle();

    if (updateError) {
      logger.error('Atomic accept hatası:', updateError);
      throw new AppError('Yolculuk kabul edilemedi.', 500);
    }

    if (!updated) {
      // Yolculuk hâlâ searching değil (ör. başka sürücü önce kabul etti veya müşteri iptal etti)
      throw new AppError('Yolculuk artık kabul edilebilir durumda değil.', 409);
    }

    // Sürücüyü meşgul yap (paralel olarak, yolculuk cevabını geciktirmesin)
    supabaseAdmin
      .from('drivers')
      .update({ is_available: false })
      .eq('id', acceptDriverId)
      .then(({ error }) => {
        if (error) logger.warn(`Sürücü meşgul işaretlenemedi [${acceptDriverId}]:`, error);
      });

    logger.info(`Yolculuk güncellendi: ${rideId}, searching → accepted (driver=${acceptDriverId})`);
    return updated as RideDetail;
  }

  // Diğer durum geçişleri — mevcut yolculuğu çek ve yetki + geçiş kontrolleri yap
  const { data: ride, error: fetchError } = await supabaseAdmin
    .from('rides')
    .select(
      'id, customer_id, driver_id, status, estimated_price, pickup_code_verified, platform_fee',
    )
    .eq('id', rideId)
    .single();

  if (fetchError || !ride) {
    throw new AppError('Yolculuk bulunamadı.', 404);
  }

  // ============================================================
  // YETKİ KONTROLÜ — yalnızca yolculuğa dahil olanlar değişiklik yapabilir
  // ============================================================
  const isCustomer = ride.customer_id === userId;
  const isAssignedDriver = ride.driver_id === userId;
  if (!isCustomer && !isAssignedDriver) {
    throw new AppError('Bu yolculuk üzerinde işlem yetkiniz yok.', 403);
  }

  // Durum-özel yetki matrisi
  // - iptal: her iki taraf yapabilir (searching/accepted/arriving aşamasında)
  // - arriving / in_progress / completed: yalnızca atanan sürücü
  const driverOnly: RideStatus[] = ['arriving', 'in_progress', 'completed'];
  if (driverOnly.includes(newStatus) && !isAssignedDriver) {
    throw new AppError('Bu durum değişikliği yalnızca atanan sürücü tarafından yapılabilir.', 403);
  }

  const validTransitions: Record<string, RideStatus[]> = {
    searching: ['accepted', 'cancelled'],
    accepted: ['arriving', 'cancelled'],
    arriving: ['in_progress', 'cancelled'],
    // Yolculuk başladıktan sonra müşteri iptali kapatılır (sürücü / ücret tutarsızlığı önlenir).
    in_progress: ['completed', 'cancelled'],
    completed: [],
    cancelled: [],
  };

  if (newStatus === 'cancelled' && ride.status === 'in_progress' && isCustomer) {
    throw new AppError(
      'Yolculuk başladıktan sonra iptal yalnızca sürücü tarafından yapılabilir. Destek ile iletişime geçin.',
      403,
    );
  }

  const allowed = validTransitions[ride.status] || [];
  if (!allowed.includes(newStatus)) {
    throw new AppError(
      `Geçersiz durum geçişi: '${ride.status}' → '${newStatus}'. İzin verilen: ${allowed.join(', ') || 'yok'}`,
      400
    );
  }

  // Biniş kodu doğrulanmadan yolculuk başlatılamaz (arriving → in_progress)
  if (newStatus === 'in_progress' && ride.status === 'arriving') {
    const verified = (ride as { pickup_code_verified?: boolean }).pickup_code_verified;
    if (!verified) {
      throw new AppError(
        'Yolculuğu başlatmak için önce yolcunun 4 haneli biniş kodunu doğrulayın.',
        403
      );
    }
  }

  // Güncelleme verisi
  const updateData: Record<string, unknown> = { status: newStatus };
  switch (newStatus) {
    case 'in_progress':
      updateData.started_at = new Date().toISOString();
      break;
    case 'completed':
      updateData.completed_at = new Date().toISOString();
      updateData.final_price = extras?.finalPrice ?? ride.estimated_price;
      break;
    case 'cancelled':
      updateData.cancelled_at = new Date().toISOString();
      updateData.cancel_reason = extras?.cancelReason || 'Belirtilmedi.';
      break;
    // arriving tek yönlü geçiş; ek alan yok
  }

  // Atomic koşullu update — durum beklenenle eşleşmiyorsa güncelleme başarısız (yarış koşulu koruması)
  const { data: updated, error: updateError } = await supabaseAdmin
    .from('rides')
    .update(updateData)
    .eq('id', rideId)
    .eq('status', ride.status)
    .select(`
      id, customer_id, driver_id,
      pickup_address, dropoff_address,
      distance_km, estimated_price, final_price, platform_fee,
      status, requested_at, accepted_at,
      started_at, completed_at, cancelled_at, cancel_reason
    `)
    .maybeSingle();

  if (updateError) {
    logger.error('Yolculuk güncelleme hatası:', updateError);
    throw new AppError('Yolculuk durumu güncellenemedi.', 500);
  }
  if (!updated) {
    // Durum araya giren bir update ile değişmiş
    throw new AppError('Yolculuk durumu bu sırada değişti. Lütfen yenileyin.', 409);
  }

  // Yolcu iptal → T Coin iade (accepted / arriving); in_progress iptali müşteriye kapalıdır.
  if (newStatus === 'cancelled' && isCustomer && ride.driver_id) {
    if (ride.status === 'accepted' || ride.status === 'arriving') {
      const pf = Number((ride as { platform_fee?: number | null }).platform_fee ?? 0);
      const refundAmount =
        pf > 0 ? pf : computeRideAcceptFeeTcoin(Number(ride.estimated_price ?? 0));
      // Idempotent: aynı ride'ın iptal iadesi tekrar tetiklense bile tek kredi.
      const ok = await walletService.refundRideAcceptFeeIdempotent(
        ride.driver_id,
        rideId,
        refundAmount,
        `refund:cancel:${rideId}`,
        'customer cancel refund',
      );
      if (ok) {
        logger.info(
          `[Wallet] Yolcu iptal (${ride.status}) — kabul ücreti iade: driver=${ride.driver_id} amount=${refundAmount} T Coin ride=${rideId}`,
        );
      } else {
        logger.error(
          `[Wallet] Yolcu iptal iade BAŞARISIZ — manuel müdahale: driver=${ride.driver_id} amount=${refundAmount} ride=${rideId}`,
        );
        logger.error(
          `[Wallet] ${JSON.stringify({
            type: 'WALLET_RECONCILE_NEEDED',
            op: 'refundAfterCustomerCancel',
            driverId: ride.driver_id,
            amountTcoin: refundAmount,
            rideId,
            at: new Date().toISOString(),
          })}`,
        );
      }
    }
  }

  // Tamamlama veya iptal durumunda sürücüyü müsait yap (async, yanıtı bekletmeden)
  if ((newStatus === 'completed' || newStatus === 'cancelled') && ride.driver_id) {
    supabaseAdmin
      .from('drivers')
      .update({ is_available: true })
      .eq('id', ride.driver_id)
      .then(({ error }) => {
        if (error) logger.warn(`Sürücü müsait işaretlenemedi [${ride.driver_id}]:`, error);
      });
  }

  logger.info(`Yolculuk güncellendi: ${rideId}, ${ride.status} → ${newStatus}`);
  return updated as RideDetail;
}

/**
 * Müşterinin/sürücünün aktif yolculuğunu getirir (koordinatlar dahil).
 * Mobil uygulama açıldığında / reconnect olunca devam eden yolculuğu restore etmek için kullanılır.
 *
 * Not: pickup/dropoff PostGIS GEOGRAPHY sütunları olduğundan Supabase REST
 * bunları EWKB hex olarak döner. `decodeEwkbPoint` ile {lat, lng}'e çeviririz.
 */
export async function getActiveRide(
  userId: string,
  role: 'customer' | 'driver'
): Promise<ActiveRideSnapshot | null> {
  const filterField = role === 'customer' ? 'customer_id' : 'driver_id';

  const { data, error } = await supabaseAdmin
    .from('rides')
    .select(`
      id, customer_id, driver_id,
      pickup_location, dropoff_location,
      pickup_address, dropoff_address,
      distance_km, estimated_price, final_price,
      status, requested_at, accepted_at,
      started_at, completed_at, cancelled_at, cancel_reason,
      pickup_verification_code, pickup_code_verified
    `)
    .eq(filterField, userId)
    .in('status', ['searching', 'accepted', 'arriving', 'in_progress'])
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  const raw = data as unknown as RideDetail & {
    pickup_location?: unknown;
    dropoff_location?: unknown;
  };

  const pickup = decodeEwkbPoint(raw.pickup_location);
  const dropoff = decodeEwkbPoint(raw.dropoff_location);

  const rawPin = raw as RideDetail;

  const snapshot: ActiveRideSnapshot = {
    id: raw.id,
    customer_id: raw.customer_id,
    driver_id: raw.driver_id,
    pickup_address: raw.pickup_address,
    dropoff_address: raw.dropoff_address,
    distance_km: raw.distance_km,
    estimated_price: raw.estimated_price,
    final_price: raw.final_price,
    status: raw.status,
    requested_at: raw.requested_at,
    accepted_at: raw.accepted_at,
    started_at: raw.started_at,
    completed_at: raw.completed_at,
    cancelled_at: raw.cancelled_at,
    cancel_reason: raw.cancel_reason,
    pickup_lat: pickup?.lat ?? null,
    pickup_lng: pickup?.lng ?? null,
    dropoff_lat: dropoff?.lat ?? null,
    dropoff_lng: dropoff?.lng ?? null,
    pickup_verification_code: rawPin.pickup_verification_code ?? null,
    pickup_code_verified: Boolean(rawPin.pickup_code_verified),
  };

  // Müşteri tarafı: sürücü atanmışsa tam bilgisini (araç + konum) iliştir
  if (role === 'customer' && raw.driver_id) {
    try {
      // Sürücü araç bilgisi
      const { data: driverRow, error: driverErr } = await supabaseAdmin
        .from('drivers')
        .select('id, vehicle_plate, vehicle_model, vehicle_color')
        .eq('id', raw.driver_id)
        .maybeSingle();

      if (driverErr) {
        logger.error('getActiveRide: drivers sorgu hatası:', driverErr.message);
      }

      // Kullanıcı profil bilgisi (ayrı sorgu — join hataları önlenir)
      const { data: userRow, error: userErr } = await supabaseAdmin
        .from('users')
        .select('full_name, phone, rating')
        .eq('id', raw.driver_id)
        .maybeSingle();

      if (userErr) {
        logger.error('getActiveRide: users sorgu hatası:', userErr.message);
      }

      if (driverRow || userRow) {
        let lat: number | undefined;
        let lng: number | undefined;
        let bearing: number | undefined;
        try {
          const { redis } = await import('../../config/redis');
          const locStr = await redis.get(`driver:location:${raw.driver_id}`);
          if (locStr) {
            const loc = JSON.parse(locStr);
            lat = typeof loc.lat === 'number' ? loc.lat : undefined;
            lng = typeof loc.lng === 'number' ? loc.lng : undefined;
            bearing = typeof loc.bearing === 'number' ? loc.bearing : undefined;
          }
        } catch {
          // Redis hatası kritik değil
        }

        snapshot.driver = {
          id: raw.driver_id,
          full_name: userRow?.full_name ?? '',
          phone: userRow?.phone ?? '',
          rating: Number(userRow?.rating ?? 0),
          vehicle_plate: (driverRow as any)?.vehicle_plate ?? '',
          vehicle_model: (driverRow as any)?.vehicle_model ?? '',
          vehicle_color: (driverRow as any)?.vehicle_color ?? '',
          lat,
          lng,
          bearing,
        };
      } else {
        logger.warn(`getActiveRide: sürücü bulunamadı driver_id=${raw.driver_id}`);
      }
    } catch (e) {
      logger.error('Aktif yolculuk için sürücü bilgisi alınamadı:', e);
    }
  }

  // Sürücü tarafı: müşterinin kısa bilgisini iliştir
  if (role === 'driver') {
    try {
      const { data: userRow } = await supabaseAdmin
        .from('users')
        .select('id, full_name, phone, rating')
        .eq('id', raw.customer_id)
        .maybeSingle();
      if (userRow) {
        snapshot.customer = {
          id: userRow.id,
          full_name: userRow.full_name,
          phone: userRow.phone,
          rating: Number(userRow.rating ?? 0),
        };
      }
    } catch (e) {
      logger.error('Aktif yolculuk için müşteri bilgisi alınamadı:', e);
    }
  }

  // Rol bazlı alan süzme: PIN yalnız müşteride; doğrulama bayrağı yalnız sürücüde
  if (role === 'driver') {
    snapshot.pickup_verification_code = null;
  } else {
    delete (snapshot as { pickup_code_verified?: boolean }).pickup_code_verified;
  }

  return snapshot;
}

type VerifyPickupCodeFail = { ok: false; reason: string };
type VerifyPickupCodeOk = { ok: true };

/**
 * Atanan sürücünün yolcudan aldığı PIN'i doğrular; başarılıysa varış navigasyonu serbest kalır.
 */
export async function verifyPickupCode(
  rideId: string,
  driverId: string,
  rawCode: string
): Promise<VerifyPickupCodeOk | VerifyPickupCodeFail> {
  const code = rawCode.replace(/\D/g, '').slice(0, 4);
  if (code.length !== 4) {
    return { ok: false, reason: 'Kod 4 haneli olmalı.' };
  }

  const { data: ride, error } = await supabaseAdmin
    .from('rides')
    .select('driver_id, pickup_verification_code, pickup_code_verified, status')
    .eq('id', rideId)
    .maybeSingle();

  if (error || !ride) {
    return { ok: false, reason: 'Yolculuk bulunamadı.' };
  }
  if (ride.driver_id !== driverId) {
    return { ok: false, reason: 'Bu yolculuğun sürücüsü değilsiniz.' };
  }
  const st = ride.status as string;
  if (!['accepted', 'arriving'].includes(st)) {
    return { ok: false, reason: 'Bu aşamada kod doğrulanamaz.' };
  }
  if (ride.pickup_code_verified) {
    return { ok: true };
  }

  const expected = (ride.pickup_verification_code as string | null)?.trim();
  if (!expected || expected !== code) {
    return { ok: false, reason: 'Kod hatalı.' };
  }

  const { data: updated, error: upErr } = await supabaseAdmin
    .from('rides')
    .update({ pickup_code_verified: true })
    .eq('id', rideId)
    .eq('pickup_code_verified', false)
    .select('id')
    .maybeSingle();

  if (upErr || !updated) {
    const { data: again } = await supabaseAdmin
      .from('rides')
      .select('pickup_code_verified')
      .eq('id', rideId)
      .maybeSingle();
    if (again?.pickup_code_verified) {
      return { ok: true };
    }
    return { ok: false, reason: 'Doğrulama kaydedilemedi.' };
  }

  return { ok: true };
}
