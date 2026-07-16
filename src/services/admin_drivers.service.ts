/**
 * Admin sürücü yönetimi.
 */

import bcrypt from 'bcryptjs';
import { supabaseAdmin } from '../config/supabase';
import { redis } from '../config/redis';
import { AppError } from '../middleware/error.middleware';
import { logger } from '../utils/logger';
import { invalidateSessionVersionCache } from '../middleware/auth.middleware';
import { disconnectSocketsForUser } from '../sockets/socket.manager';

const BCRYPT_ROUNDS = 12;

type DriverRow = Record<string, unknown>;

export async function listAdminDrivers(): Promise<{ items: DriverRow[] }> {
  const { data: drivers, error: driverErr } = await supabaseAdmin
    .from('drivers')
    .select('id, is_online, is_available, vehicle_plate, vehicle_model, vehicle_color, balance, total_rides, acceptance_rate')
    .limit(200);

  if (driverErr) {
    logger.error('[Admin] sürücü listesi:', driverErr);
    throw new AppError('Sürücü listesi alınamadı.', 500);
  }

  const ids = (drivers ?? []).map((d) => d.id as string);
  let userMap = new Map<string, Record<string, unknown>>();
  if (ids.length > 0) {
    const { data: users, error: userErr } = await supabaseAdmin
      .from('users')
      .select('id, full_name, phone, rating, rating_count')
      .in('id', ids);
    if (!userErr && users) {
      userMap = new Map(users.map((u) => [u.id as string, u as Record<string, unknown>]));
    }
  }

  const socketKeyValues = ids.length > 0
    ? await Promise.all(ids.map((id) => redis.get(`driver:socket:${id}`)))
    : [];
  const onlineSet = new Set(ids.filter((_, idx) => Boolean(socketKeyValues[idx])));

  const items = (drivers ?? []).map((d) => {
    const id = d.id as string;
    return {
      ...d,
      is_online: onlineSet.has(id),
      users: userMap.get(id) ?? null,
    };
  });

  return { items };
}

export interface AdminDriverUpdatePatch {
  full_name?: string;
  phone?: string;
  vehicle_plate?: string;
  vehicle_model?: string;
  vehicle_color?: string;
  password?: string;
}

export async function updateAdminDriver(
  driverId: string,
  patch: AdminDriverUpdatePatch,
): Promise<{ id: string }> {
  if (Object.keys(patch).length === 0) {
    throw new AppError('Güncellenecek alan yok.', 400);
  }

  const { data: userRow, error: userErr } = await supabaseAdmin
    .from('users')
    .select('id, role, phone, session_version')
    .eq('id', driverId)
    .maybeSingle();

  if (userErr || !userRow || userRow.role !== 'driver') {
    throw new AppError('Sürücü bulunamadı.', 404);
  }

  if (patch.phone && patch.phone !== userRow.phone) {
    const { data: taken } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('phone', patch.phone)
      .neq('id', driverId)
      .maybeSingle();
    if (taken) {
      throw new AppError('Bu telefon başka kullanıcıda kayıtlı.', 409);
    }
  }

  if (patch.vehicle_plate) {
    const { data: plateRow } = await supabaseAdmin
      .from('drivers')
      .select('id')
      .eq('vehicle_plate', patch.vehicle_plate)
      .neq('id', driverId)
      .maybeSingle();
    if (plateRow) {
      throw new AppError('Bu plaka başka sürücüde kayıtlı.', 409);
    }
  }

  const userUpdates: Record<string, unknown> = {};
  if (patch.full_name != null) userUpdates.full_name = patch.full_name;
  if (patch.phone != null) userUpdates.phone = patch.phone;

  let bumpSession = false;
  if (patch.password != null) {
    userUpdates.password_hash = await bcrypt.hash(patch.password, BCRYPT_ROUNDS);
    bumpSession = true;
  }
  if (patch.phone != null && patch.phone !== userRow.phone) {
    bumpSession = true;
  }

  if (bumpSession) {
    const curSv = Number(userRow.session_version ?? 0);
    userUpdates.session_version = curSv + 1;
    userUpdates.refresh_token = null;
  }

  if (Object.keys(userUpdates).length > 0) {
    const { error: updUserErr } = await supabaseAdmin.from('users').update(userUpdates).eq('id', driverId);
    if (updUserErr) {
      logger.error('[Admin] sürücü users update:', updUserErr);
      throw new AppError('Kullanıcı güncellenemedi.', 500);
    }
  }

  const driverUpdates: Record<string, unknown> = {};
  if (patch.vehicle_plate != null) driverUpdates.vehicle_plate = patch.vehicle_plate;
  if (patch.vehicle_model != null) driverUpdates.vehicle_model = patch.vehicle_model;
  if (patch.vehicle_color != null) driverUpdates.vehicle_color = patch.vehicle_color;

  if (Object.keys(driverUpdates).length > 0) {
    const { error: drvErr } = await supabaseAdmin.from('drivers').update(driverUpdates).eq('id', driverId);
    if (drvErr) {
      logger.error('[Admin] sürücü drivers update:', drvErr);
      throw new AppError('Sürücü araç bilgisi güncellenemedi.', 500);
    }
  }

  if (bumpSession) {
    await invalidateSessionVersionCache(driverId);
    disconnectSocketsForUser(driverId);
  }

  return { id: driverId };
}

/** Sürücüyü tamamen kaldırır (`users` silinir → `drivers` CASCADE). */
export async function deleteAdminDriver(driverId: string): Promise<{ id: string }> {
  const { data: userRow, error: userErr } = await supabaseAdmin
    .from('users')
    .select('id, role')
    .eq('id', driverId)
    .maybeSingle();

  if (userErr || !userRow || userRow.role !== 'driver') {
    throw new AppError('Sürücü bulunamadı.', 404);
  }

  disconnectSocketsForUser(driverId);
  await Promise.all([
    redis.del(`driver:socket:${driverId}`),
    redis.del(`driver:location:${driverId}`),
    redis.del(`driver:active_ride:${driverId}`),
    redis.del(`driver:pending_offer:${driverId}`),
  ]);

  const { error: delErr } = await supabaseAdmin.from('users').delete().eq('id', driverId);
  if (delErr) {
    logger.error('[Admin] sürücü silme:', delErr);
    throw new AppError('Sürücü silinemedi.', 500);
  }

  await invalidateSessionVersionCache(driverId);
  return { id: driverId };
}

/** Admin bakiye ekleme sonucunda `wallet_transactions`'a iz bırakır (yoksa panel üzerinden yapılan hiçbir ekleme izlenemez). */
async function recordAdminTopupLedgerEntry(
  driverId: string,
  amount: number,
  balanceAfter: number,
  reason?: string,
): Promise<void> {
  const { error } = await supabaseAdmin.from('wallet_transactions').insert({
    driver_id: driverId,
    type: 'admin_topup',
    amount,
    balance_after: balanceAfter,
    reason: reason ?? null,
  });
  if (error) {
    logger.error('[AdminBalance] wallet_transactions kaydı eklenemedi:', error);
  }
}

/** T Coin ekler (`add_driver_balance` RPC; RPC eksikse read+write fallback). */
export async function addAdminDriverBalance(
  driverId: string,
  amount: number,
  reason?: string,
): Promise<{ id: string; balance: number }> {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new AppError('Geçerli bir bakiye tutarı girin.', 400);
  }

  const { error: rpcError } = await supabaseAdmin.rpc('add_driver_balance', {
    p_driver_id: driverId,
    p_amount: amount,
  });

  if (rpcError) {
    logger.warn('[AdminBalance] add_driver_balance rpc missing/failed, fallback kullanılacak:', rpcError.message);

    // Bazı ortamlarda RPC migration'ı eksik/bozuk olabiliyor.
    // Panelin çalışmaya devam etmesi için kontrollü fallback (read+write) uygula.
    const { data: row, error: rowErr } = await supabaseAdmin
      .from('drivers')
      .select('id, balance')
      .eq('id', driverId)
      .single();

    if (rowErr || !row) {
      throw new AppError(`Sürücü bakiyesi güncellenemedi (rpc): ${rpcError.message ?? 'bilinmeyen hata'}`, 500);
    }

    const current = Number(row.balance ?? 0);
    const nextBalance = Math.round((current + amount) * 100) / 100;
    const { data: updated, error: updErr } = await supabaseAdmin
      .from('drivers')
      .update({ balance: nextBalance })
      .eq('id', driverId)
      .select('id, balance')
      .single();

    if (updErr || !updated) {
      logger.error('[AdminBalance] fallback update error:', updErr);
      throw new AppError(`Sürücü bakiyesi güncellenemedi (fallback): ${updErr?.message ?? 'bilinmeyen hata'}`, 500);
    }

    await recordAdminTopupLedgerEntry(driverId, amount, Number(updated.balance ?? 0), reason);
    return { id: updated.id as string, balance: Number(updated.balance ?? 0) };
  }

  const { data: driver, error: driverError } = await supabaseAdmin
    .from('drivers')
    .select('id, balance')
    .eq('id', driverId)
    .single();

  if (driverError || !driver) {
    throw new AppError('Sürücü bulunamadı.', 404);
  }

  await recordAdminTopupLedgerEntry(driverId, amount, Number(driver.balance ?? 0), reason);
  return { id: driver.id as string, balance: Number(driver.balance ?? 0) };
}

export async function setAdminDriverAccess(
  driverId: string,
  enabled: boolean,
): Promise<{ id: string; is_online: boolean; is_available: boolean }> {
  const updateData = enabled
    ? { is_available: true }
    : { is_available: false, is_online: false };

  const { data, error } = await supabaseAdmin
    .from('drivers')
    .update(updateData)
    .eq('id', driverId)
    .select('id, is_online, is_available')
    .single();

  if (error || !data) {
    throw new AppError('Sürücü bulunamadı veya güncellenemedi.', 404);
  }

  return data as { id: string; is_online: boolean; is_available: boolean };
}
