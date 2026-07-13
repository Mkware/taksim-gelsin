/**
 * Canlı Takip Socket Handler
 * - Müşteri / sürücü bağlandığında aktif yolculuğu restore eder (kaldığı yerden devam).
 */

import { Socket } from 'socket.io';
import { redis } from '../../config/redis';
import { logger } from '../../utils/logger';
import * as rideService from '../../modules/ride/ride.service';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
  RideSnapshotEvent,
} from '../../types/socket.types';
import type { TypedSocketServer } from '../socket.manager';

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

/**
 * Canlı takip handler'larını socket'e bağlar
 */
export function registerTrackingHandlers(socket: TypedSocket, io: TypedSocketServer): void {
  const userId = socket.data.userId;
  const role = socket.data.role;

  if (role === 'customer') {
    setupCustomerTracking(socket, io, userId);
  }

  if (role === 'driver') {
    setupDriverTracking(socket, userId);
  }
}

/**
 * Müşteri takip kurulumu
 * Bağlantı kurulduğunda aktif yolculuğu bulur, room'a ekler ve istemciye
 * `ride:snapshot` gönderir (kaldığı yerden devam için).
 */
async function setupCustomerTracking(
  socket: TypedSocket,
  _io: TypedSocketServer,
  userId: string
): Promise<void> {
  // Müşteriyi kendi room'una ekle (her zaman)
  socket.join(`customer:${userId}`);

  try {
    // Önce hafif sorgu ile aktif ride id'sini al ve room'a HEMEN katıl — tam snapshot
    // sorgusu sürerken gelen ride:cancelled/completed event'lerinin kaçma penceresini daralt.
    const brief = await rideService.getActiveRideBrief(userId, 'customer');
    if (!brief) return;
    socket.join(`ride:${brief.id}`);

    const snapshot = await rideService.getActiveRide(userId, 'customer');
    if (!snapshot) return;

    const payload = buildSnapshotPayload(snapshot, 'customer');
    socket.emit('ride:snapshot', payload);

    // Sürücü konumunu anlık olarak da ilet (UI markerı)
    if (snapshot.driver_id && payload.driver?.lat != null && payload.driver?.lng != null) {
      socket.emit('driver:location:broadcast', {
        driverId: snapshot.driver_id,
        lat: payload.driver.lat,
        lng: payload.driver.lng,
        bearing: payload.driver.bearing ?? 0,
      });
    }

    socket.emit('ride:status_update', {
      rideId: snapshot.id,
      status: snapshot.status,
    });

    logger.debug(`Müşteri snapshot gönderildi: ${userId} → ride ${snapshot.id} (${snapshot.status})`);
  } catch (error) {
    logger.error(`Müşteri takip kurulum hatası [${userId}]:`, error);
  }
}

/**
 * Sürücü takip kurulumu
 * Bağlantı kurulduğunda aktif yolculuk varsa room'a ekler ve snapshot gönderir.
 */
async function setupDriverTracking(socket: TypedSocket, userId: string): Promise<void> {
  try {
    // Önce hafif sorgu — aktif yolculuk varsa room'lara HEMEN katıl (event kaçma penceresini daralt).
    // Kişisel oda yalnızca devam eden yolculuk varken — aksi halde sürücü
    // `driver:go_online` demeden eşleştirme bildirimlerini (`ride:new_request`) alırdı.
    const brief = await rideService.getActiveRideBrief(userId, 'driver');
    if (!brief) return;

    socket.join(`driver:${userId}`);
    // Not: driver:active_ride her zaman plain rideId string yazar (driver.handler ile tutarlı)
    socket.join(`ride:${brief.id}`);
    try {
      await redis.set(
        `driver:active_ride:${userId}`,
        brief.id,
        'EX',
        600
      );
    } catch {
      // cache hatası kritik değil
    }

    const snapshot = await rideService.getActiveRide(userId, 'driver');
    if (!snapshot) return;

    const payload = buildSnapshotPayload(snapshot, 'driver');
    socket.emit('ride:snapshot', payload);

    socket.emit('ride:status_update', {
      rideId: snapshot.id,
      status: snapshot.status,
    });

    logger.debug(`Sürücü snapshot gönderildi: ${userId} → ride ${snapshot.id} (${snapshot.status})`);
  } catch (error) {
    logger.error(`Sürücü takip kurulum hatası [${userId}]:`, error);
  }
}

/** DB snapshot'ını socket event tipine çevirir */
function buildSnapshotPayload(
  snap: NonNullable<Awaited<ReturnType<typeof rideService.getActiveRide>>>,
  role: 'customer' | 'driver'
): RideSnapshotEvent {
  return {
    ride: {
      id: snap.id,
      customerId: snap.customer_id,
      driverId: snap.driver_id,
      pickupAddress: snap.pickup_address,
      dropoffAddress: snap.dropoff_address,
      pickupLat: snap.pickup_lat ?? null,
      pickupLng: snap.pickup_lng ?? null,
      dropoffLat: snap.dropoff_lat ?? null,
      dropoffLng: snap.dropoff_lng ?? null,
      distanceKm: snap.distance_km,
      estimatedPrice: snap.estimated_price,
      finalPrice: snap.final_price,
      status: snap.status,
      requestedAt: snap.requested_at,
      acceptedAt: snap.accepted_at,
      startedAt: snap.started_at,
      pickupVerificationCode:
        role === 'customer' ? snap.pickup_verification_code ?? null : null,
      pickupCodeVerified: role === 'driver' ? Boolean(snap.pickup_code_verified) : false,
    },
    driver:
      role === 'customer' && snap.driver
        ? {
            id: snap.driver.id,
            fullName: snap.driver.full_name,
            phone: snap.driver.phone,
            rating: snap.driver.rating,
            vehiclePlate: snap.driver.vehicle_plate,
            vehicleModel: snap.driver.vehicle_model,
            vehicleColor: snap.driver.vehicle_color,
            lat: snap.driver.lat,
            lng: snap.driver.lng,
            bearing: snap.driver.bearing,
          }
        : null,
    customer:
      role === 'driver' && snap.customer
        ? {
            id: snap.customer.id,
            fullName: snap.customer.full_name,
            phone: snap.customer.phone,
            rating: snap.customer.rating,
          }
        : null,
  };
}
