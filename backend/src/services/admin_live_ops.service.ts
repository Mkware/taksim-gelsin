/**
 * Admin canlı operasyon: harita verisi, eşleştirme teşhisi, sistem sağlığı.
 */

import { supabaseAdmin } from '../config/supabase';
import { redis } from '../config/redis';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/error.middleware';
import { decodeEwkbPoint } from '../utils/geo';
import { clearSmartMatchingQueue, getPendingOfferDrivers } from './smart_matching.service';
import { recoverStaleSearchingRidesOnce } from './stale_searching_recovery.service';
import { redisDriverResponseDeadlineKey } from './matching_timeouts';
import { getPlatformSettings } from './platform_settings.service';

const DRIVER_SOCKET_PREFIX = 'driver:socket:';
const DRIVER_LOCATION_PREFIX = 'driver:location:';

const MATCHING_KEYS = {
  queue: (rideId: string) => `ride:matching:${rideId}`,
  queuedTotal: (rideId: string) => `ride:matching:queued_total:${rideId}`,
  asked: (rideId: string) => `ride:matching:asked:${rideId}`,
  rejected: (rideId: string) => `ride:rejected:${rideId}`,
  pending: (rideId: string) => `ride:pending:${rideId}`,
  driverOffer: (driverId: string) => `driver:pending_offer:${driverId}`,
} as const;

export interface MatchingDiagnostics {
  rideId: string;
  driversQueued: number;
  driversAsked: number;
  queueRemaining: number;
  queueDriverIds: string[];
  rejectedDriverIds: string[];
  /** Geriye dönük alan — dalgadaki ilk sürücü (varsa). */
  pendingDriverId: string | null;
  /** Dalgadaki tüm açık teklif sahipleri. */
  pendingDriverIds: string[];
  offerSecondsLeft: number | null;
  hasMatchingQueue: boolean;
}

export async function readMatchingDiagnostics(rideId: string): Promise<MatchingDiagnostics> {
  const timeoutSec = getPlatformSettings().driverResponseTimeoutSeconds;
  const [queuedTotalRaw, askedRaw, queueLen, queueIds, rejected, pendingIds] =
    await Promise.all([
      redis.get(MATCHING_KEYS.queuedTotal(rideId)),
      redis.get(MATCHING_KEYS.asked(rideId)),
      redis.llen(MATCHING_KEYS.queue(rideId)),
      redis.lrange(MATCHING_KEYS.queue(rideId), 0, -1),
      redis.smembers(MATCHING_KEYS.rejected(rideId)),
      getPendingOfferDrivers(rideId),
    ]);

  // Dalgadaki en geç biten teklifin kalan süresi.
  let offerSecondsLeft: number | null = null;
  if (pendingIds.length > 0) {
    const deadlineRaws = await Promise.all(
      pendingIds.map((d) => redis.get(redisDriverResponseDeadlineKey(rideId, d))),
    );
    const deadlines = deadlineRaws.map((v) => Number(v)).filter((v) => Number.isFinite(v));
    offerSecondsLeft =
      deadlines.length > 0
        ? Math.max(0, Math.ceil((Math.max(...deadlines) - Date.now()) / 1000))
        : timeoutSec;
  }

  const queueRemaining = Math.max(0, Number(queueLen) || 0);
  return {
    rideId,
    driversQueued: Math.max(0, Number(queuedTotalRaw) || 0),
    driversAsked: Math.max(0, Number(askedRaw) || 0),
    queueRemaining,
    queueDriverIds: queueIds ?? [],
    rejectedDriverIds: rejected ?? [],
    pendingDriverId: pendingIds[0] ?? null,
    pendingDriverIds: pendingIds,
    offerSecondsLeft,
    hasMatchingQueue:
      queueRemaining > 0 ||
      pendingIds.length > 0 ||
      (rejected?.length ?? 0) > 0 ||
      Number(queuedTotalRaw) > 0,
  };
}

export async function getAdminLiveSnapshot(): Promise<{
  drivers: Array<Record<string, unknown>>;
  rides: Array<Record<string, unknown>>;
  fetchedAt: string;
}> {
  const { data: driverRows, error: drvErr } = await supabaseAdmin
    .from('drivers')
    .select('id, is_online, is_available, vehicle_plate')
    .limit(300);

  if (drvErr) {
    logger.error('[AdminLive] drivers:', drvErr);
    throw new AppError('Sürücü verisi alınamadı.', 500);
  }

  const driverIds = (driverRows ?? []).map((d) => d.id as string);
  let userMap = new Map<string, Record<string, unknown>>();
  if (driverIds.length > 0) {
    const { data: users } = await supabaseAdmin
      .from('users')
      .select('id, full_name, phone')
      .in('id', driverIds);
    if (users) {
      userMap = new Map(users.map((u) => [u.id as string, u as Record<string, unknown>]));
    }
  }

  const drivers: Array<Record<string, unknown>> = [];
  await Promise.all(
    driverIds.map(async (id) => {
      const [socketVal, locRaw] = await Promise.all([
        redis.get(`${DRIVER_SOCKET_PREFIX}${id}`),
        redis.get(`${DRIVER_LOCATION_PREFIX}${id}`),
      ]);
      if (!socketVal) return;

      const row = (driverRows ?? []).find((d) => d.id === id);
      const user = userMap.get(id);
      let lat: number | null = null;
      let lng: number | null = null;
      let bearing = 0;
      let locationUpdatedAt: number | null = null;

      if (locRaw) {
        try {
          const parsed = JSON.parse(locRaw) as {
            lat?: number;
            lng?: number;
            bearing?: number;
            updatedAt?: number;
          };
          if (Number.isFinite(parsed.lat) && Number.isFinite(parsed.lng)) {
            lat = parsed.lat as number;
            lng = parsed.lng as number;
            bearing = Number(parsed.bearing) || 0;
            locationUpdatedAt = parsed.updatedAt ?? null;
          }
        } catch {
          // yok say
        }
      }

      drivers.push({
        id,
        full_name: user?.full_name ?? null,
        phone: user?.phone ?? null,
        vehicle_plate: row?.vehicle_plate ?? null,
        is_available: row?.is_available ?? false,
        lat,
        lng,
        bearing,
        locationUpdatedAt,
        hasLocation: lat != null && lng != null,
      });
    }),
  );

  const { data: rideRows, error: rideErr } = await supabaseAdmin
    .from('rides')
    .select(
      'id, status, customer_id, driver_id, pickup_address, dropoff_address, pickup_location, dropoff_location, requested_at, estimated_price',
    )
    .in('status', ['searching', 'accepted', 'arriving', 'in_progress'])
    .order('requested_at', { ascending: false })
    .limit(60);

  if (rideErr) {
    logger.error('[AdminLive] rides:', rideErr);
    throw new AppError('Aktif yolculuklar alınamadı.', 500);
  }

  const rideUserIds = new Set<string>();
  for (const r of rideRows ?? []) {
    if (r.customer_id) rideUserIds.add(r.customer_id as string);
    if (r.driver_id) rideUserIds.add(r.driver_id as string);
  }
  let rideUserMap = new Map<string, Record<string, unknown>>();
  if (rideUserIds.size > 0) {
    const { data: ru } = await supabaseAdmin
      .from('users')
      .select('id, full_name, phone')
      .in('id', [...rideUserIds]);
    if (ru) {
      rideUserMap = new Map(ru.map((u) => [u.id as string, u as Record<string, unknown>]));
    }
  }

  const rides = await Promise.all(
    (rideRows ?? []).map(async (r) => {
      const pickup = decodeEwkbPoint(r.pickup_location);
      const dropoff = decodeEwkbPoint(r.dropoff_location);
      const customer = rideUserMap.get((r.customer_id as string) ?? '');
      const driver = rideUserMap.get((r.driver_id as string) ?? '');
      let matching: MatchingDiagnostics | null = null;
      if (r.status === 'searching') {
        matching = await readMatchingDiagnostics(r.id as string);
      }
      return {
        ...r,
        customer_name: customer?.full_name ?? null,
        driver_name: driver?.full_name ?? null,
        pickup_lat: pickup?.lat ?? null,
        pickup_lng: pickup?.lng ?? null,
        dropoff_lat: dropoff?.lat ?? null,
        dropoff_lng: dropoff?.lng ?? null,
        matching,
      };
    }),
  );

  return {
    drivers,
    rides,
    fetchedAt: new Date().toISOString(),
  };
}

export async function listAdminSearchingMatching(): Promise<{
  items: Array<Record<string, unknown>>;
}> {
  const { data: rows, error } = await supabaseAdmin
    .from('rides')
    .select('id, status, customer_id, pickup_address, requested_at, estimated_price')
    .eq('status', 'searching')
    .order('requested_at', { ascending: false })
    .limit(40);

  if (error) {
    throw new AppError('Aranan yolculuklar alınamadı.', 500);
  }

  const items = await Promise.all(
    (rows ?? []).map(async (r) => {
      const matching = await readMatchingDiagnostics(r.id as string);
      const { data: customer } = await supabaseAdmin
        .from('users')
        .select('full_name, phone')
        .eq('id', r.customer_id as string)
        .maybeSingle();
      return {
        ...r,
        customer_name: customer?.full_name ?? null,
        customer_phone: customer?.phone ?? null,
        matching,
      };
    }),
  );

  return { items };
}

export async function adminClearRideMatching(rideId: string): Promise<void> {
  const { data: ride } = await supabaseAdmin
    .from('rides')
    .select('id, status')
    .eq('id', rideId)
    .maybeSingle();

  if (!ride) {
    throw new AppError('Yolculuk bulunamadı.', 404);
  }
  if (ride.status !== 'searching') {
    throw new AppError('Yalnızca aranan (searching) yolculukların eşleştirmesi temizlenebilir.', 400);
  }

  await clearSmartMatchingQueue(rideId, true, 'customer_cancelled');
}

export async function adminRecoverStaleSearching(): Promise<{ recovered: number }> {
  const recovered = await recoverStaleSearchingRidesOnce();
  return { recovered };
}

export async function getAdminOpsHealth(): Promise<Record<string, unknown>> {
  let redisOk = false;
  try {
    const pong = await redis.ping();
    redisOk = pong === 'PONG';
  } catch {
    redisOk = false;
  }

  let databaseOk = false;
  try {
    const { error } = await supabaseAdmin.from('users').select('id', { head: true, count: 'exact' });
    databaseOk = !error;
  } catch {
    databaseOk = false;
  }

  const { count: searchingCount } = await supabaseAdmin
    .from('rides')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'searching');

  let onlineSocketCount = 0;
  try {
    const keys = await redis.keys(`${DRIVER_SOCKET_PREFIX}*`);
    onlineSocketCount = keys.length;
  } catch {
    onlineSocketCount = 0;
  }

  return {
    status: redisOk && databaseOk ? 'ready' : 'degraded',
    redis: redisOk ? 'ok' : 'error',
    database: databaseOk ? 'ok' : 'error',
    onlineDriversSocket: onlineSocketCount,
    searchingRides: searchingCount ?? 0,
    staleSearchingMinutes: env.STALE_SEARCHING_MINUTES,
    timestamp: new Date().toISOString(),
  };
}
