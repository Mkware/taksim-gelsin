/**
 * Admin müşteri (yolcu) yönetimi.
 */

import bcrypt from 'bcryptjs';
import { supabaseAdmin } from '../config/supabase';
import { AppError } from '../middleware/error.middleware';
import { logger } from '../utils/logger';
import { invalidateSessionVersionCache } from '../middleware/auth.middleware';
import { disconnectSocketsForUser } from '../sockets/socket.manager';
import { normalizeTrPhoneInput } from '../modules/auth/auth.schema';
import { countCompletedRides, isAdminPhone } from '../modules/auth/auth.service';

const BCRYPT_ROUNDS = 12;

function escapeIlike(q: string): string {
  return q.replace(/[%_\\]/g, '\\$&');
}

type CustomerRow = Record<string, unknown>;

async function attachRideStats(items: CustomerRow[]): Promise<CustomerRow[]> {
  const ids = items.map((u) => String(u.id));
  if (ids.length === 0) return items;

  const { data: rides, error } = await supabaseAdmin
    .from('rides')
    .select('customer_id, status')
    .in('customer_id', ids);

  if (error) {
    logger.warn('[Admin] müşteri yolculuk istatistikleri:', error.message);
    return items.map((u) => ({
      ...u,
      completed_rides: 0,
      has_active_ride: false,
    }));
  }

  const completed = new Map<string, number>();
  const active = new Set<string>();
  const activeStatuses = new Set(['searching', 'accepted', 'arriving', 'in_progress']);

  for (const r of rides ?? []) {
    const cid = String(r.customer_id);
    if (r.status === 'completed') {
      completed.set(cid, (completed.get(cid) ?? 0) + 1);
    }
    if (activeStatuses.has(String(r.status))) {
      active.add(cid);
    }
  }

  return items.map((u) => {
    const id = String(u.id);
    return {
      ...u,
      completed_rides: completed.get(id) ?? 0,
      has_active_ride: active.has(id),
    };
  });
}

export interface ListAdminCustomersParams {
  limit?: number;
  q?: string;
  /** all | true | false */
  suspended?: string;
}

export async function listAdminCustomers(
  params: ListAdminCustomersParams,
): Promise<{ items: CustomerRow[] }> {
  const limit = Math.min(Math.max(Number(params.limit ?? 50), 1), 200);
  const q = (params.q ?? '').trim();
  const suspended = (params.suspended ?? 'all').trim();

  let query = supabaseAdmin
    .from('users')
    .select(
      'id, phone, full_name, role, rating, rating_count, created_at, is_suspended',
    )
    .eq('role', 'customer')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (suspended === 'true') {
    query = query.eq('is_suspended', true);
  } else if (suspended === 'false') {
    query = query.eq('is_suspended', false);
  }

  if (q.length > 0) {
    const term = escapeIlike(q);
    query = query.or(`full_name.ilike.%${term}%,phone.ilike.%${term}%`);
  }

  const { data: users, error } = await query;
  if (error) {
    if (error.message?.includes('is_suspended')) {
      throw new AppError(
        'Veritabanında is_suspended sütunu yok. supabase/migrations/006_user_is_suspended.sql dosyasını uygulayın.',
        500,
      );
    }
    logger.error('[Admin] müşteri listesi:', error);
    throw new AppError('Müşteri listesi alınamadı.', 500);
  }

  const items = await attachRideStats((users ?? []) as CustomerRow[]);
  return { items };
}

export async function getAdminCustomerById(userId: string): Promise<CustomerRow> {
  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select(
      'id, phone, full_name, role, rating, rating_count, created_at, is_suspended, session_version',
    )
    .eq('id', userId)
    .eq('role', 'customer')
    .maybeSingle();

  if (error || !user) {
    throw new AppError('Müşteri bulunamadı.', 404);
  }

  const [enriched] = await attachRideStats([user as CustomerRow]);
  const completed = await countCompletedRides(userId, 'customer');
  return { ...enriched, completed_rides: completed };
}

export async function updateAdminCustomer(
  userId: string,
  patch: { is_suspended?: boolean; full_name?: string; phone?: string },
): Promise<CustomerRow> {
  const { data: row, error: fetchErr } = await supabaseAdmin
    .from('users')
    .select('id, role, phone, session_version')
    .eq('id', userId)
    .maybeSingle();

  if (fetchErr || !row || row.role !== 'customer') {
    throw new AppError('Müşteri bulunamadı.', 404);
  }

  if (isAdminPhone(row.phone as string)) {
    throw new AppError('Admin telefonlu hesap bu ekrandan düzenlenemez.', 403);
  }

  const updates: Record<string, unknown> = {};
  let bumpSession = false;

  if (patch.full_name != null) {
    updates.full_name = patch.full_name.trim();
  }
  if (patch.phone != null) {
    const phone = normalizeTrPhoneInput(patch.phone);
    const { data: taken } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('phone', phone)
      .neq('id', userId)
      .maybeSingle();
    if (taken) {
      throw new AppError('Bu telefon başka kullanıcıda kayıtlı.', 409);
    }
    if (phone !== row.phone) {
      updates.phone = phone;
      bumpSession = true;
    }
  }
  if (patch.is_suspended != null) {
    updates.is_suspended = patch.is_suspended;
    if (patch.is_suspended) {
      bumpSession = true;
    }
  }

  if (Object.keys(updates).length === 0) {
    throw new AppError('Güncellenecek alan yok.', 400);
  }

  if (bumpSession) {
    const curSv = Number(row.session_version ?? 0);
    updates.session_version = curSv + 1;
    updates.refresh_token = null;
  }

  const { error: updErr } = await supabaseAdmin.from('users').update(updates).eq('id', userId);
  if (updErr) {
    logger.error('[Admin] müşteri güncelleme:', updErr);
    throw new AppError('Müşteri güncellenemedi.', 500);
  }

  if (bumpSession) {
    await invalidateSessionVersionCache(userId);
    disconnectSocketsForUser(userId);
  }

  return getAdminCustomerById(userId);
}

export async function revokeCustomerSessions(userId: string): Promise<void> {
  const { data: row } = await supabaseAdmin
    .from('users')
    .select('id, role, session_version')
    .eq('id', userId)
    .maybeSingle();

  if (!row || row.role !== 'customer') {
    throw new AppError('Müşteri bulunamadı.', 404);
  }

  const nextSv = Number(row.session_version ?? 0) + 1;
  const { error } = await supabaseAdmin
    .from('users')
    .update({ session_version: nextSv, refresh_token: null })
    .eq('id', userId);

  if (error) {
    throw new AppError('Oturum sonlandırılamadı.', 500);
  }

  await invalidateSessionVersionCache(userId);
  disconnectSocketsForUser(userId);
}

export async function resetCustomerPassword(userId: string, password: string): Promise<void> {
  if (password.length < 6) {
    throw new AppError('Şifre en az 6 karakter olmalı.', 400);
  }

  const { data: row } = await supabaseAdmin
    .from('users')
    .select('id, role')
    .eq('id', userId)
    .maybeSingle();

  if (!row || row.role !== 'customer') {
    throw new AppError('Müşteri bulunamadı.', 404);
  }

  const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const { error } = await supabaseAdmin
    .from('users')
    .update({ password_hash })
    .eq('id', userId);

  if (error) {
    throw new AppError('Şifre güncellenemedi.', 500);
  }

  await revokeCustomerSessions(userId);
}

export async function deleteAdminCustomer(userId: string): Promise<void> {
  const { data: row } = await supabaseAdmin
    .from('users')
    .select('id, role, phone')
    .eq('id', userId)
    .maybeSingle();

  if (!row || row.role !== 'customer') {
    throw new AppError('Müşteri bulunamadı.', 404);
  }

  if (isAdminPhone(row.phone as string)) {
    throw new AppError('Admin hesabı silinemez.', 403);
  }

  const { data: active } = await supabaseAdmin
    .from('rides')
    .select('id')
    .eq('customer_id', userId)
    .in('status', ['searching', 'accepted', 'arriving', 'in_progress'])
    .limit(1);

  if (active && active.length > 0) {
    throw new AppError('Aktif yolculuğu olan müşteri silinemez. Önce yolculuğu iptal edin.', 409);
  }

  disconnectSocketsForUser(userId);
  const { error } = await supabaseAdmin.from('users').delete().eq('id', userId);
  if (error) {
    logger.error('[Admin] müşteri silme:', error);
    throw new AppError('Müşteri silinemedi.', 500);
  }
  await invalidateSessionVersionCache(userId);
}
