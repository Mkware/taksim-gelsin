/**
 * Uzun süre `searching` kalan yolculukları kurtarır (deploy / crash sonrası setTimeout kaybı vb.).
 * Periyodik olarak DB + Redis ile senkron tutar; müşteri ve bekleyen sürücüye bildirim gönderir.
 */

import { supabaseAdmin } from '../config/supabase';
import { redis } from '../config/redis';
import { logger } from '../utils/logger';
import { env } from '../config/env';
import { AppError } from '../middleware/error.middleware';
import * as rideService from '../modules/ride/ride.service';
import { clearSmartMatchingQueue, startSmartMatching } from './smart_matching.service';
import { getSocketManager } from '../sockets/socket.manager';
import { notifyRideCancelledByFcm } from './push_notification.service';
import { decodeEwkbPoint } from '../utils/geo';

const INTERVAL_MS = 5 * 60 * 1000;
let intervalHandle: NodeJS.Timeout | null = null;

/** Orphan kurtarma daha sık çalışır (deploy/restart sonrası boşluğu hızlı kapatır). */
const ORPHAN_INTERVAL_MS = 60 * 1000;
let orphanIntervalHandle: NodeJS.Timeout | null = null;
/** Bu yaştan eski "searching" ride'lar, normal eşleştirme akışıyla yarışmamak için kontrol edilir. */
const ORPHAN_MIN_AGE_MS = 45 * 1000;

export async function recoverStaleSearchingRidesOnce(): Promise<number> {
  const minutes = env.STALE_SEARCHING_MINUTES;
  const cutoff = new Date(Date.now() - minutes * 60 * 1000).toISOString();

  const { data: rows, error } = await supabaseAdmin
    .from('rides')
    .select('id, customer_id')
    .eq('status', 'searching')
    .lt('requested_at', cutoff)
    .limit(50);

  if (error) {
    logger.error('[StaleRide] Arama sorgusu hatası:', error);
    return 0;
  }
  if (!rows?.length) return 0;

  let recovered = 0;
  for (const row of rows) {
    const rideId = row.id as string;
    const customerId = row.customer_id as string;
    try {
      await rideService.updateRideStatus(rideId, 'cancelled', customerId, {
        cancelReason: 'Arama süresi aşıldı. Lütfen yeni bir talep oluşturun.',
      });
    } catch (e) {
      if (e instanceof AppError && e.statusCode === 409) {
        // Bu sırada kabul edilmiş veya iptal edilmiş — atla
        continue;
      }
      logger.warn(`[StaleRide] ${rideId} iptal edilemedi:`, e);
      continue;
    }

    try {
      await clearSmartMatchingQueue(rideId, true, 'customer_cancelled');
    } catch (e) {
      logger.warn(`[StaleRide] ${rideId} Redis temizliği:`, e);
    }

    recovered++;
    try {
      const io = getSocketManager();
      io.to(`customer:${customerId}`).emit('ride:cancelled', {
        rideId,
        reason: 'Arama süresi aşıldı. Yeni talep oluşturabilirsiniz.',
        cancelledBy: 'customer',
      });
      void notifyRideCancelledByFcm({
        rideId,
        customerId,
        scenario: 'system',
        systemBody: 'Arama süresi aşıldı. Yeni talep oluşturabilirsiniz.',
      }).catch((e: unknown) => logger.warn('[FCM] stale_searching push:', e));
    } catch {
      // Socket henüz yok veya hata — DB tutarlılığı öncelikli
    }
  }

  if (recovered > 0) {
    logger.info(`[StaleRide] ${recovered} yolculuk iptal edildi (searching > ${minutes} dk)`);
  }
  return recovered;
}

/**
 * "Orphan" searching ride kurtarması: DB'de `searching` ama Redis'te hiç eşleştirme state'i
 * (pending teklif veya kuyruk) olmayan yolculukları yeniden eşleştirmeye sokar.
 *
 * Bu durum tipik olarak deploy/restart sonrası oluşur: in-memory timer kaybolur, kuyruk/pending
 * TTL ile düşer ve ride hiç ilerlemeden `searching`de kalırdı (stale eşik ~15 dk'ya kadar).
 * Burada yeniden eşleştirme tetiklenir; uygun sürücü yoksa startSmartMatching zaten iptal eder.
 */
export async function recoverOrphanSearchingRidesOnce(): Promise<number> {
  const cutoff = new Date(Date.now() - ORPHAN_MIN_AGE_MS).toISOString();

  const { data: rows, error } = await supabaseAdmin
    .from('rides')
    .select('id, customer_id, pickup_location, requested_at')
    .eq('status', 'searching')
    .lt('requested_at', cutoff)
    .limit(50);

  if (error) {
    logger.error('[OrphanRide] Arama sorgusu hatası:', error);
    return 0;
  }
  if (!rows?.length) return 0;

  let restarted = 0;
  for (const row of rows) {
    const rideId = row.id as string;
    const customerId = row.customer_id as string;
    try {
      // Redis'te canlı eşleştirme state'i var mı? (pending teklif veya dolu kuyruk)
      const [pending, queueLen] = await Promise.all([
        redis.get(`ride:pending:${rideId}`),
        redis.llen(`ride:matching:${rideId}`),
      ]);
      if (pending || (Number(queueLen) || 0) > 0) {
        continue; // eşleştirme canlı — dokunma
      }

      const pt = decodeEwkbPoint((row as { pickup_location?: unknown }).pickup_location);
      if (!pt) {
        logger.warn(`[OrphanRide] ${rideId} pickup çözülemedi — atlanıyor`);
        continue;
      }

      logger.warn(`[OrphanRide] Orphan searching ride yeniden eşleştiriliyor ride=${rideId}`);
      await startSmartMatching(rideId, pt.lat, pt.lng, customerId);
      restarted++;
    } catch (e) {
      logger.warn(`[OrphanRide] ${rideId} yeniden eşleştirme hatası:`, e);
    }
  }

  if (restarted > 0) {
    logger.info(`[OrphanRide] ${restarted} orphan searching ride yeniden eşleştirildi`);
  }
  return restarted;
}

export function initStaleSearchingRecoveryCron(): void {
  if (intervalHandle) return;
  void recoverStaleSearchingRidesOnce();
  intervalHandle = setInterval(() => {
    void recoverStaleSearchingRidesOnce();
  }, INTERVAL_MS);
  logger.info(`[StaleRide] periyodik kurtarma aktif (her ${INTERVAL_MS / 60000} dk, eşik ${env.STALE_SEARCHING_MINUTES} dk)`);

  if (!orphanIntervalHandle) {
    // Başlangıçta kısa bir gecikmeyle bir kez (sürücülerin reconnect olmasına fırsat ver),
    // sonra periyodik.
    setTimeout(() => { void recoverOrphanSearchingRidesOnce(); }, 8000);
    orphanIntervalHandle = setInterval(() => {
      void recoverOrphanSearchingRidesOnce();
    }, ORPHAN_INTERVAL_MS);
    logger.info(`[OrphanRide] periyodik orphan kurtarma aktif (her ${ORPHAN_INTERVAL_MS / 1000} sn)`);
  }
}

export function stopStaleSearchingRecoveryCron(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    logger.info('[StaleRide] periyodik kurtarma durduruldu.');
  }
  if (orphanIntervalHandle) {
    clearInterval(orphanIntervalHandle);
    orphanIntervalHandle = null;
    logger.info('[OrphanRide] periyodik orphan kurtarma durduruldu.');
  }
}
