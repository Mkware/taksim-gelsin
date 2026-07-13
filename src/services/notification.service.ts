/**
 * Bildirim Servisi
 * Socket.io üzerinden kullanıcılara gerçek zamanlı bildirim gönderir.
 * Sürücüye yolculuk isteği, müşteriye durum güncellemesi vb.
 */

import { getIO } from '../sockets/socket.manager';
import { redis } from '../config/redis';
import { supabaseAdmin } from '../config/supabase';
import { decodeEwkbPoint } from '../utils/geo';
import { logger } from '../utils/logger';
import {
  computeRideAcceptFeeTcoin,
  getDriverResponseTimeoutMs,
  getPlatformSettings,
} from './platform_settings.service';
import { maskPickupForDriver } from '../utils/pickup_mask';
import { sendDriverNewRidePush } from './push_notification.service';
import type {
  RideNewRequestEvent,
  RideAcceptedEvent,
  RideNoDriverFoundEvent,
} from '../types/socket.types';
import { redisDriverResponseDeadlineKey } from './matching_timeouts';

// Redis key prefix'leri
const DRIVER_SOCKET_KEY = 'driver:socket:';

/**
 * Belirli bir sürücüye yeni yolculuk isteği gönderir
 * Sürücünün socket room'una emit edilir
 *
 * @param driverId Hedef sürücü ID'si
 * @param rideData Yolculuk isteği bilgileri
 * @returns Sürücüye ulaşılıp ulaşılamadığı
 */
export async function sendRideRequestToDriver(
  driverId: string,
  rideData: RideNewRequestEvent
): Promise<boolean> {
  try {
    const { data: driverRow, error: driverErr } = await supabaseAdmin
      .from('drivers')
      .select('is_online, is_available')
      .eq('id', driverId)
      .maybeSingle();

    if (driverErr || !driverRow) {
      logger.warn(
        `Yolculuk isteği atlandı (sürücü satırı yok/DB hata): ${driverId} ride=${rideData.rideId}`,
        driverErr,
      );
      return false;
    }

    const row = driverRow as { is_online?: boolean; is_available?: boolean };
    if (!row.is_online || !row.is_available) {
      logger.info(
        `Yolculuk isteği atlandı (sürücü çevrimdışı veya müsait değil): ${driverId} ride=${rideData.rideId}`,
      );
      return false;
    }

    const io = getIO();

    const socketId = await redis.get(`${DRIVER_SOCKET_KEY}${driverId}`);
    if (!socketId) {
      logger.info(
        `Sürücü socket yok (kilit/arka plan olabilir); Socket + FCM: ${driverId} ride=${rideData.rideId}`,
      );
    }

    // Her zaman room'a ilet — bağlıysa anında alır
    io.to(`driver:${driverId}`).emit('ride:new_request', rideData);

    // Kilit / arka plan / OS güç tasarrufu: Socket kesin değil → FCM zorunlu tamamlayıcı
    void sendDriverNewRidePush(driverId, rideData).catch((e) =>
      logger.warn(`[FCM] ride push arka plan hatası [${driverId}]:`, e),
    );

    logger.info(`📤 Yolculuk isteği gönderildi: ${rideData.rideId} → Sürücü: ${driverId}`);
    return true;
  } catch (error) {
    logger.error(`Sürücü bildirim hatası [${driverId}]:`, error);
    return false;
  }
}

/**
 * Müşteriye sürücü bulunamadı bildirimi gönderir
 * Tüm sürücüler reddettiyse veya yakında sürücü yoksa
 */
export async function notifyNoDriverFound(
  customerId: string,
  rideId: string
): Promise<void> {
  try {
    const io = getIO();

    const event: RideNoDriverFoundEvent = { rideId };
    io.to(`customer:${customerId}`).emit('ride:no_driver_found', event);

    logger.info(`📤 Sürücü bulunamadı bildirimi: ${rideId} → Müşteri: ${customerId}`);
  } catch (error) {
    logger.error(`Müşteri bildirim hatası [${customerId}]:`, error);
  }
}

/**
 * Müşteriye yolculuk kabul bildirimi gönderir
 */
export async function notifyRideAccepted(
  customerId: string,
  acceptedData: RideAcceptedEvent
): Promise<void> {
  try {
    const io = getIO();

    io.to(`customer:${customerId}`).emit('ride:accepted', acceptedData);

    logger.info(`📤 Yolculuk kabul bildirimi: ${acceptedData.rideId} → Müşteri: ${customerId}`);
  } catch (error) {
    logger.error(`Kabul bildirimi hatası [${customerId}]:`, error);
  }
}

/**
 * Bir yolculuk room'undaki herkese durum güncellemesi gönderir
 */
export async function broadcastRideStatus(
  rideId: string,
  status: string
): Promise<void> {
  try {
    const io = getIO();

    io.to(`ride:${rideId}`).emit('ride:status_update', {
      rideId,
      status: status as 'searching' | 'accepted' | 'arriving' | 'in_progress' | 'completed' | 'cancelled',
    });

    logger.debug(`📤 Durum yayını: ${rideId} → ${status}`);
  } catch (error) {
    logger.error(`Durum yayını hatası [${rideId}]:`, error);
  }
}

/**
 * smart_matching.service — rideId ile DB'den yükleyip sürücüye tam ride:new_request gönderir
 */
async function sendRideRequestByRideId(driverId: string, rideId: string): Promise<boolean> {
  const { data: ride, error } = await supabaseAdmin
    .from('rides')
    .select(
      'id, customer_id, pickup_address, dropoff_address, distance_km, estimated_price, pickup_location, dropoff_location'
    )
    .eq('id', rideId)
    .maybeSingle();

  if (error || !ride) {
    logger.error(`sendRideRequest: yolculuk bulunamadı [${rideId}]`, error);
    return false;
  }

  const pickup = decodeEwkbPoint(ride.pickup_location);
  const dropoff = decodeEwkbPoint(ride.dropoff_location);
  if (!pickup || !dropoff) {
    logger.warn(`sendRideRequest: koordinat çözülemedi [${rideId}]`);
    return false;
  }

  const { data: customer } = await supabaseAdmin
    .from('users')
    .select('id, full_name, phone, rating')
    .eq('id', ride.customer_id)
    .maybeSingle();

  const { data: driverRow } = await supabaseAdmin
    .from('drivers')
    .select('balance')
    .eq('id', driverId)
    .maybeSingle();
  const balanceTcoin = Number((driverRow as { balance?: number } | null)?.balance ?? 0);

  const settings = getPlatformSettings();
  const maskR = settings.pickupMaskRadiusM;
  const masked = maskPickupForDriver(
    pickup.lat,
    pickup.lng,
    rideId,
    driverId,
    maskR,
  );

  let responseDeadlineMs = Date.now() + getDriverResponseTimeoutMs();
  try {
    const raw = await redis.get(redisDriverResponseDeadlineKey(rideId));
    const parsed = raw != null ? Number(raw) : NaN;
    if (Number.isFinite(parsed)) {
      responseDeadlineMs = parsed;
    }
  } catch {
    // yok say — varsayılan tam pencere
  }

  const rideData: RideNewRequestEvent = {
    rideId,
    targetDriverId: driverId,
    pickup: { lat: masked.lat, lng: masked.lng },
    dropoff: { lat: dropoff.lat, lng: dropoff.lng },
    pickupAddress: ride.pickup_address,
    dropoffAddress: ride.dropoff_address,
    price: Number(ride.estimated_price),
    distanceKm: Number(ride.distance_km ?? 0),
    customerInfo: {
      id: customer?.id ?? ride.customer_id,
      fullName: customer?.full_name ?? 'Müşteri',
      phone: customer?.phone ?? '',
      rating: Number(customer?.rating ?? 5),
    },
    pickupMasked: true,
    pickupUncertaintyM: masked.uncertaintyRadiusM,
    acceptFeeTcoin: computeRideAcceptFeeTcoin(Number(ride.estimated_price)),
    balanceTcoin,
    responseDeadlineMs,
    responseTimeoutSeconds: settings.driverResponseTimeoutSeconds,
  };

  return sendRideRequestToDriver(driverId, rideData);
}

export const notificationService = {
  sendRideRequest: sendRideRequestByRideId,
};
