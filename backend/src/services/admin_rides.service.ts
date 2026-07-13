/**
 * Admin yolculuk listesi, detay ve zorunlu iptal.
 */

import { supabaseAdmin } from '../config/supabase';
import { redis } from '../config/redis';
import { AppError } from '../middleware/error.middleware';
import { logger } from '../utils/logger';
import { getSocketManager } from '../sockets/socket.manager';
import { clearSmartMatchingQueue } from './smart_matching.service';
import { notifyRideCancelledByFcm } from './push_notification.service';
import { computeRideAcceptFeeTcoin } from './platform_settings.service';
import * as walletService from './wallet.service';
import type { RideStatus } from '../types/index';

const CANCELLABLE: RideStatus[] = ['searching', 'accepted', 'arriving', 'in_progress'];

const RIDE_SELECT = `
  id, customer_id, driver_id,
  pickup_address, dropoff_address,
  distance_km, estimated_price, final_price, platform_fee,
  status, requested_at, accepted_at, started_at,
  completed_at, cancelled_at, cancel_reason
`;

type RideRow = Record<string, unknown>;

function escapeIlike(q: string): string {
  return q.replace(/[%_\\]/g, '\\$&');
}

async function enrichRidesWithUsers(rides: RideRow[]): Promise<RideRow[]> {
  const userIds = new Set<string>();
  for (const ride of rides) {
    if (ride.customer_id) userIds.add(String(ride.customer_id));
    if (ride.driver_id) userIds.add(String(ride.driver_id));
  }
  let userMap = new Map<string, Record<string, unknown>>();
  if (userIds.size > 0) {
    const { data: users } = await supabaseAdmin
      .from('users')
      .select('id, full_name, phone')
      .in('id', [...userIds]);
    if (users) {
      userMap = new Map(users.map((u) => [u.id as string, u as Record<string, unknown>]));
    }
  }
  return rides.map((ride) => {
    const customer = userMap.get(String(ride.customer_id ?? ''));
    const driver = userMap.get(String(ride.driver_id ?? ''));
    const status = String(ride.status ?? '');
    return {
      ...ride,
      customer_name: (customer?.full_name as string | undefined) ?? null,
      customer_phone: (customer?.phone as string | undefined) ?? null,
      driver_name: (driver?.full_name as string | undefined) ?? null,
      driver_phone: (driver?.phone as string | undefined) ?? null,
      can_cancel: CANCELLABLE.includes(status as RideStatus),
    };
  });
}

export interface ListAdminRidesParams {
  limit?: number;
  status?: string;
  /** Ad, telefon veya adres parçası */
  q?: string;
}

export async function listAdminRides(params: ListAdminRidesParams): Promise<{ items: RideRow[] }> {
  const limit = Math.min(Math.max(Number(params.limit ?? 50), 1), 200);
  const status = (params.status ?? '').trim();
  const q = (params.q ?? '').trim();

  let query = supabaseAdmin
    .from('rides')
    .select(RIDE_SELECT)
    .order('requested_at', { ascending: false })
    .limit(limit);

  if (status && status !== 'all') {
    const allowed: RideStatus[] = [
      'searching',
      'accepted',
      'arriving',
      'in_progress',
      'completed',
      'cancelled',
    ];
    if (!allowed.includes(status as RideStatus)) {
      throw new AppError('Geçersiz durum filtresi.', 400);
    }
    query = query.eq('status', status);
  }

  if (q.length > 0) {
    const term = escapeIlike(q);
    const { data: matchedUsers } = await supabaseAdmin
      .from('users')
      .select('id')
      .or(`full_name.ilike.%${term}%,phone.ilike.%${term}%`)
      .limit(30);
    const userIds = (matchedUsers ?? []).map((u) => u.id as string);
    const parts = [
      `pickup_address.ilike.%${term}%`,
      `dropoff_address.ilike.%${term}%`,
    ];
    if (userIds.length > 0) {
      parts.push(`customer_id.in.(${userIds.join(',')})`);
      parts.push(`driver_id.in.(${userIds.join(',')})`);
    }
    query = query.or(parts.join(','));
  }

  const { data: rides, error } = await query;
  if (error) {
    logger.error('[Admin] rides list:', error);
    throw new AppError('Yolculuk listesi alınamadı.', 500);
  }

  const items = await enrichRidesWithUsers((rides ?? []) as RideRow[]);
  return { items };
}

export async function getAdminRideById(rideId: string): Promise<RideRow> {
  const { data: ride, error } = await supabaseAdmin
    .from('rides')
    .select(RIDE_SELECT)
    .eq('id', rideId)
    .maybeSingle();

  if (error || !ride) {
    throw new AppError('Yolculuk bulunamadı.', 404);
  }

  const [enriched] = await enrichRidesWithUsers([ride as RideRow]);
  return enriched;
}

export async function adminCancelRide(
  rideId: string,
  reason: string,
  adminUserId: string,
): Promise<RideRow> {
  const { data: ride, error: fetchError } = await supabaseAdmin
    .from('rides')
    .select('id, customer_id, driver_id, status, estimated_price, platform_fee')
    .eq('id', rideId)
    .maybeSingle();

  if (fetchError || !ride) {
    throw new AppError('Yolculuk bulunamadı.', 404);
  }

  const status = String(ride.status) as RideStatus;
  if (status === 'cancelled') {
    return getAdminRideById(rideId);
  }
  if (status === 'completed') {
    throw new AppError('Tamamlanmış yolculuk iptal edilemez.', 400);
  }
  if (!CANCELLABLE.includes(status)) {
    throw new AppError(`Bu durumda iptal yapılamaz: ${status}`, 400);
  }

  const cancelReason =
    reason.trim() || `Yönetici tarafından iptal (admin=${adminUserId.slice(0, 8)}…)`;

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('rides')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancel_reason: cancelReason,
    })
    .eq('id', rideId)
    .eq('status', status)
    .select(RIDE_SELECT)
    .maybeSingle();

  if (updateError) {
    logger.error('[Admin] ride cancel update:', updateError);
    throw new AppError('Yolculuk iptal edilemedi.', 500);
  }
  if (!updated) {
    throw new AppError('Yolculuk durumu bu sırada değişti. Listeyi yenileyin.', 409);
  }

  const driverId = ride.driver_id as string | null;

  if (driverId && (status === 'accepted' || status === 'arriving')) {
    const pf = Number((ride as { platform_fee?: number | null }).platform_fee ?? 0);
    const refundAmount =
      pf > 0 ? pf : computeRideAcceptFeeTcoin(Number(ride.estimated_price ?? 0));
    // Idempotent: aynı ride için admin iadesi tekrarlanırsa çift kredi olmaz.
    const ok = await walletService.refundRideAcceptFeeIdempotent(
      driverId,
      rideId,
      refundAmount,
      `refund:admin_cancel:${rideId}`,
      'admin cancel refund',
    );
    if (!ok) {
      logger.error(
        `[Admin] Kabul ücreti iade başarısız driver=${driverId} ride=${rideId} amount=${refundAmount}`,
      );
    }
  }

  if (driverId) {
    await supabaseAdmin.from('drivers').update({ is_available: true }).eq('id', driverId);
    await redis.del(`driver:active_ride:${driverId}`);
  }

  await clearSmartMatchingQueue(rideId, true, 'customer_cancelled');

  const io = getSocketManager();
  const payload = {
    rideId,
    reason: cancelReason,
    cancelledBy: 'admin' as const,
  };
  io.to(`ride:${rideId}`).emit('ride:cancelled', payload);
  if (updated.customer_id) {
    io.to(`customer:${updated.customer_id}`).emit('ride:cancelled', payload);
  }
  if (updated.driver_id) {
    io.to(`driver:${updated.driver_id}`).emit('ride:cancelled', payload);
  }
  io.socketsLeave(`ride:${rideId}`);

  void notifyRideCancelledByFcm({
    rideId,
    customerId: String(updated.customer_id),
    driverId: updated.driver_id,
    scenario: 'admin',
    systemBody: cancelReason,
  }).catch((e: unknown) => logger.warn('[FCM] Admin iptal push:', e));

  logger.info(`[Admin] Yolculuk iptal: ${rideId} (${status}→cancelled) by ${adminUserId}`);
  const [enriched] = await enrichRidesWithUsers([updated as RideRow]);
  return enriched;
}
