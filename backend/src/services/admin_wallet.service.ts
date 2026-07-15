/**
 * Admin paneli — sürücü cüzdanı (T-Coin) hareket defteri görünümü.
 * Kaynak tablo: wallet_transactions (bkz. supabase/migrations/007_wallet_ledger_atomic_accept.sql).
 */

import { supabaseAdmin } from '../config/supabase';
import { AppError } from '../middleware/error.middleware';
import { logger } from '../utils/logger';

export interface ListWalletTransactionsParams {
  page?: number;
  limit?: number;
  driverId?: string;
  type?: string;
}

export async function listWalletTransactions(
  params: ListWalletTransactionsParams,
): Promise<{ items: Record<string, unknown>[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(Math.max(1, params.limit ?? 50), 200);
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = supabaseAdmin
    .from('wallet_transactions')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (params.driverId) query = query.eq('driver_id', params.driverId);
  if (params.type) query = query.eq('type', params.type);

  const { data: rows, error, count } = await query;
  if (error) {
    logger.error('[AdminWallet] işlem listesi alınamadı:', error);
    throw new AppError('Cüzdan hareketleri alınamadı.', 500);
  }

  const driverIds = Array.from(new Set((rows ?? []).map((r) => r.driver_id as string)));
  let driverMap = new Map<string, Record<string, unknown>>();
  if (driverIds.length > 0) {
    const [{ data: drivers }, { data: users }] = await Promise.all([
      supabaseAdmin.from('drivers').select('id, vehicle_plate').in('id', driverIds),
      supabaseAdmin.from('users').select('id, full_name, phone').in('id', driverIds),
    ]);
    const userMap = new Map((users ?? []).map((u) => [u.id as string, u as Record<string, unknown>]));
    driverMap = new Map(
      (drivers ?? []).map((d) => [
        d.id as string,
        { ...d, ...(userMap.get(d.id as string) ?? {}) } as Record<string, unknown>,
      ]),
    );
  }

  const items = (rows ?? []).map((r) => ({
    ...r,
    driver: driverMap.get(r.driver_id as string) ?? null,
  }));

  return { items, total: count ?? 0, page, limit };
}
