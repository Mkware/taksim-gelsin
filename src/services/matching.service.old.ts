/**
 * Sürücü Eşleştirme Servisi
 * Müşteri yolculuk isteği → en yakın müsait sürücüyü bul → istek gönder → kabul/ret yönet
 *
 * Algoritma:
 *   1. Müşteri ride oluşturur → status: 'searching'
 *   2. PostGIS ile 5 km içindeki müsait sürücüler ST_DWithin ile bulunur
 *   3. ST_Distance ile mesafeye göre sıralanır (en yakın önce)
 *   4. Redis'e eşleştirme kuyruğu oluşturulur
 *   5. 1. sürücüye socket event gönderilir (30 sn timeout)
 *   6. Kabul → ride güncellenir, müşteriye bildirim
 *      Ret/Timeout → 2. sürücüye geçilir
 *   7. 5 sürücü de reddederse → müşteriye 'no_driver_found'
 */

import { redis } from '../config/redis';
import { logger } from '../utils/logger';
import { findNearbyDrivers } from './location.service';
import { sendRideRequestToDriver, notifyNoDriverFound } from './notification.service';
import { supabaseAdmin } from '../config/supabase';
import type { LatLng, NearbyDriver } from '../types';
import type { RideNewRequestEvent } from '../types/socket.types';

// Eşleştirme sabitleri
const DRIVER_RESPONSE_TIMEOUT_MS = 30000;  // Sürücü yanıt süresi: 30 saniye
const MAX_DRIVER_ATTEMPTS = 5;              // Maksimum denenen sürücü sayısı
const SEARCH_RADIUS_METERS = 5000;          // Arama yarıçapı: 5 km
const MATCHING_KEY_PREFIX = 'ride:matching:';
const REJECTED_KEY_PREFIX = 'ride:rejected:';
const PENDING_KEY_PREFIX = 'ride:pending:';

// Eşleştirme kuyruğu veri yapısı (Redis'te JSON olarak saklanır)
interface MatchingQueue {
  rideId: string;
  customerId: string;
  pickup: LatLng;
  dropoff: LatLng;
  pickupAddress: string;
  dropoffAddress: string;
  estimatedPrice: number;
  distanceKm: number;
  candidateDrivers: string[];   // Sıralı aday sürücü ID'leri
  currentIndex: number;          // Şu an hangi sürücüde
  attemptCount: number;          // Toplam deneme sayısı
  createdAt: number;
}

/**
 * Yolculuk için eşleştirme sürecini başlatır
 * 1. Yakın sürücüleri bul
 * 2. Redis kuyruğu oluştur
 * 3. İlk sürücüye istek gönder
 */
export async function startMatching(
  rideId: string,
  customerId: string,
  pickup: LatLng,
  dropoff: LatLng,
  pickupAddress: string,
  dropoffAddress: string,
  estimatedPrice: number,
  distanceKm: number
): Promise<void> {
  try {
    logger.info(`🔍 Eşleştirme başlatılıyor: ${rideId}`);

    // Daha önce reddeden sürücüleri al
    const rejectedDrivers = await redis.smembers(`${REJECTED_KEY_PREFIX}${rideId}`);

    // PostGIS ile yakındaki müsait sürücüleri bul
    const nearbyDrivers = await findNearbyDrivers(
      pickup,
      SEARCH_RADIUS_METERS,
      MAX_DRIVER_ATTEMPTS + rejectedDrivers.length,
      rejectedDrivers
    );

    if (nearbyDrivers.length === 0) {
      logger.warn(`Yakında müsait sürücü yok: ${rideId}`);
      await handleNoDriversAvailable(rideId, customerId);
      return;
    }

    // Sürücü ID'lerini mesafe sırasına göre al (PostGIS zaten sıralamış)
    const candidateDrivers = nearbyDrivers.map((d) => d.driver_id);

    // Redis'e eşleştirme kuyruğu oluştur
    const queue: MatchingQueue = {
      rideId,
      customerId,
      pickup,
      dropoff,
      pickupAddress,
      dropoffAddress,
      estimatedPrice,
      distanceKm,
      candidateDrivers,
      currentIndex: 0,
      attemptCount: 0,
      createdAt: Date.now(),
    };

    // Kuyruğu Redis'e kaydet (TTL: 5 dakika)
    await redis.set(
      `${MATCHING_KEY_PREFIX}${rideId}`,
      JSON.stringify(queue),
      'EX',
      300
    );

    // Müşteri bilgilerini al (sürücüye göstermek için)
    const { data: customer } = await supabaseAdmin
      .from('users')
      .select('id, full_name, phone, rating')
      .eq('id', customerId)
      .single();

    // İlk sürücüye istek gönder
    await sendRequestToNextDriver(rideId, queue, customer, nearbyDrivers);

    logger.info(`🔍 Eşleştirme kuyruğu oluşturuldu: ${rideId}, ${candidateDrivers.length} aday sürücü`);
  } catch (error) {
    logger.error(`Eşleştirme başlatma hatası [${rideId}]:`, error);
    await handleNoDriversAvailable(rideId, customerId);
  }
}

/**
 * Sıradaki sürücüye yolculuk isteği gönderir.
 * Ulaşılamayan sürücüleri atlayıp ilk bağlı sürücüde durur (iterative, stack kirletmez).
 * Timeout sonrası `handleDriverTimeout` bir sonraki turu tetikler.
 */
async function sendRequestToNextDriver(
  rideId: string,
  queue: MatchingQueue,
  customer: { id: string; full_name: string; phone: string; rating: number } | null,
  _nearbyDrivers: NearbyDriver[]
): Promise<void> {
  while (true) {
    if (
      queue.currentIndex >= queue.candidateDrivers.length ||
      queue.attemptCount >= MAX_DRIVER_ATTEMPTS
    ) {
      logger.warn(`Tüm sürücüler denendi veya limit aşıldı: ${rideId}`);
      await handleNoDriversAvailable(rideId, queue.customerId);
      return;
    }

    const driverId = queue.candidateDrivers[queue.currentIndex];

    const rideRequest: RideNewRequestEvent = {
      rideId,
      targetDriverId: driverId,
      pickup: queue.pickup,
      dropoff: queue.dropoff,
      pickupAddress: queue.pickupAddress,
      dropoffAddress: queue.dropoffAddress,
      price: queue.estimatedPrice,
      distanceKm: queue.distanceKm,
      customerInfo: {
        id: customer?.id || queue.customerId,
        fullName: customer?.full_name || 'Müşteri',
        phone: customer?.phone || '',
        rating: customer?.rating || 5,
      },
    };

    const delivered = await sendRideRequestToDriver(driverId, rideRequest);

    if (!delivered) {
      logger.warn(`Sürücüye ulaşılamadı: ${driverId}, sıradakine geçiliyor`);
      queue.currentIndex++;
      queue.attemptCount++;
      await redis.set(
        `${MATCHING_KEY_PREFIX}${rideId}`,
        JSON.stringify(queue),
        'EX',
        300
      );
      continue; // bir sonraki sürücüyü dene
    }

    // İstek gönderildi — kuyruğu güncelle ve timeout kur
    queue.attemptCount++;
    await redis.set(
      `${MATCHING_KEY_PREFIX}${rideId}`,
      JSON.stringify(queue),
      'EX',
      300
    );

    // ride:accept'in ETA hesaplaması ve müşteri iptalinde "istek çekildi" bildirimi
    // için bekleyen sürücü + pickup bilgisini Redis'e yaz.
    const pendingSnapshot = {
      driverId,
      rideId,
      pickup: queue.pickup,
      dropoff: queue.dropoff,
      pickupAddress: queue.pickupAddress,
      dropoffAddress: queue.dropoffAddress,
      sentAt: Date.now(),
    };
    await redis.set(
      `${PENDING_KEY_PREFIX}${rideId}`,
      JSON.stringify(pendingSnapshot),
      'EX',
      Math.ceil(DRIVER_RESPONSE_TIMEOUT_MS / 1000) + 5
    );

    logger.info(
      `📤 Yolculuk isteği gönderildi: ${rideId} → Sürücü ${queue.currentIndex + 1}/${queue.candidateDrivers.length}: ${driverId}`
    );

    // Yanıt süresi — sürücü cevap vermezse sıradakine geç
    setTimeout(() => {
      // Fire-and-forget; hata yakalayıcı `handleDriverTimeout` içinde
      void handleDriverTimeout(rideId, driverId);
    }, DRIVER_RESPONSE_TIMEOUT_MS);

    return;
  }
}

/**
 * Sürücü yanıt vermedi (timeout)
 * Sürücüyü reddeden listesine ekle ve sıradaki sürücüye geç
 */
async function handleDriverTimeout(rideId: string, driverId: string): Promise<void> {
  try {
    // Kuyruğu Redis'ten al
    const queueStr = await redis.get(`${MATCHING_KEY_PREFIX}${rideId}`);
    if (!queueStr) {
      // Kuyruk yok — yolculuk zaten kabul veya iptal edilmiş
      return;
    }

    const queue: MatchingQueue = JSON.parse(queueStr);

    // Mevcut sürücü hâlâ aynı mı? (Kabul edilmişse index ilerlemiştir)
    if (queue.candidateDrivers[queue.currentIndex] !== driverId) {
      return; // Zaten başka bir sürücüye geçilmiş
    }

    // Yolculuğun hâlâ 'searching' durumunda olduğunu doğrula
    const { data: ride } = await supabaseAdmin
      .from('rides')
      .select('status')
      .eq('id', rideId)
      .single();

    if (!ride || ride.status !== 'searching') {
      return; // Yolculuk artık aranmıyor
    }

    logger.info(`⏰ Sürücü zaman aşımı: ${driverId}, Yolculuk: ${rideId}`);

    // Sürücüyü reddeden listesine ekle
    await redis.sadd(`${REJECTED_KEY_PREFIX}${rideId}`, driverId);

    // Sıradaki sürücüye geç
    queue.currentIndex++;

    // Kuyruğu güncelle
    await redis.set(
      `${MATCHING_KEY_PREFIX}${rideId}`,
      JSON.stringify(queue),
      'EX',
      300
    );

    // Müşteri bilgilerini yeniden al
    const { data: customer } = await supabaseAdmin
      .from('users')
      .select('id, full_name, phone, rating')
      .eq('id', queue.customerId)
      .single();

    // Sıradaki sürücüye istek gönder
    await sendRequestToNextDriver(rideId, queue, customer, []);
  } catch (error) {
    logger.error(`Driver timeout hatası [${rideId}]:`, error);
  }
}

/**
 * Sürücü yolculuğu reddetti
 * handleDriverTimeout ile benzer ama sürücünün aktif ret eylemi
 */
export async function handleDriverRejection(rideId: string, driverId: string): Promise<void> {
  try {
    // Sürücüyü reddeden listesine ekle
    await redis.sadd(`${REJECTED_KEY_PREFIX}${rideId}`, driverId);

    // Kuyruğu Redis'ten al
    const queueStr = await redis.get(`${MATCHING_KEY_PREFIX}${rideId}`);
    if (!queueStr) return;

    const queue: MatchingQueue = JSON.parse(queueStr);

    // Sıradaki sürücüye geç
    queue.currentIndex++;

    // Kuyruğu güncelle
    await redis.set(
      `${MATCHING_KEY_PREFIX}${rideId}`,
      JSON.stringify(queue),
      'EX',
      300
    );

    // Müşteri bilgilerini al
    const { data: customer } = await supabaseAdmin
      .from('users')
      .select('id, full_name, phone, rating')
      .eq('id', queue.customerId)
      .single();

    // Sıradaki sürücüye geç
    await sendRequestToNextDriver(rideId, queue, customer, []);

    logger.info(`❌ Sürücü reddetti: ${driverId}, sıradaki sürücüye geçiliyor`);
  } catch (error) {
    logger.error(`Driver rejection hatası [${rideId}]:`, error);
  }
}

/**
 * Yakında sürücü bulunamadı veya tüm sürücüler reddetti
 * 1. Yolculuk durumunu 'cancelled' yap
 * 2. Müşteriye bildirim gönder
 * 3. Redis verilerini temizle
 */
async function handleNoDriversAvailable(rideId: string, customerId: string): Promise<void> {
  try {
    // Yolculuk durumunu kontrol et (zaten iptal edilmiş olabilir)
    const { data: ride } = await supabaseAdmin
      .from('rides')
      .select('status')
      .eq('id', rideId)
      .single();

    if (ride && ride.status === 'searching') {
      // Yolculuğu iptal et
      await supabaseAdmin
        .from('rides')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          cancel_reason: 'Yakında müsait sürücü bulunamadı.',
        })
        .eq('id', rideId);
    }

    // Müşteriye bildirim gönder
    await notifyNoDriverFound(customerId, rideId);

    // Redis verilerini temizle
    await redis.del(`${MATCHING_KEY_PREFIX}${rideId}`);
    await redis.del(`${REJECTED_KEY_PREFIX}${rideId}`);
    await redis.del(`${PENDING_KEY_PREFIX}${rideId}`);

    logger.info(`🚫 Sürücü bulunamadı: ${rideId} → Müşteri bilgilendirildi`);
  } catch (error) {
    logger.error(`handleNoDriversAvailable hatası [${rideId}]:`, error);
  }
}

export interface ClearMatchingQueueOptions {
  /** Socket.io sunucusu — döngüsel import önlenir (typed server ride.handler'dan gelir) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  io?: any;
  /** Varsa, hâlâ yanıt bekleyen sürücüye isteğin çekildiğini bildirir (müşteri iptali) */
  notifyPendingDriver?: boolean;
}

/**
 * Eşleştirme kuyruğunu temizler
 * Yolculuk kabul veya iptal edildiğinde çağrılır.
 * Müşteri arama sırasında iptal ederse notifyPendingDriver + io ile bekleyen sürücüye event gider.
 */
export async function clearMatchingQueue(
  rideId: string,
  options?: ClearMatchingQueueOptions
): Promise<void> {
  const { io, notifyPendingDriver = false } = options ?? {};
  try {
    const queueStr = await redis.get(`${MATCHING_KEY_PREFIX}${rideId}`);
    if (queueStr && io && notifyPendingDriver) {
      try {
        const queue: MatchingQueue = JSON.parse(queueStr);
        const pendingDriverId = queue.candidateDrivers[queue.currentIndex];
        if (pendingDriverId) {
          io.to(`driver:${pendingDriverId}`).emit('ride:request_cancelled', { rideId });
          logger.info(`📤 İstek geri çekildi bildirimi: ${rideId} → sürücü ${pendingDriverId}`);
        }
      } catch (e) {
        logger.warn(`Bekleyen sürücüye iptal bildirimi parse hatası [${rideId}]:`, e);
      }
    }

    await redis.del(`${MATCHING_KEY_PREFIX}${rideId}`);
    await redis.del(`${REJECTED_KEY_PREFIX}${rideId}`);
    await redis.del(`${PENDING_KEY_PREFIX}${rideId}`);
    logger.debug(`Eşleştirme kuyruğu temizlendi: ${rideId}`);
  } catch (error) {
    logger.error(`Kuyruk temizleme hatası [${rideId}]:`, error);
  }
}
