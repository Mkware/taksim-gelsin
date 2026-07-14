/**
 * Admin panosu — genel durum özeti (kullanıcı/sürücü sayısı, aktif yolculuk, ciro).
 */

import { supabaseAdmin } from '../config/supabase';
import { AppError } from '../middleware/error.middleware';
import { logger } from '../utils/logger';

export interface AdminOverview {
  users: number;
  drivers: number;
  activeRides: number;
  completedToday: number;
  revenueToday: number;
  revenueMonth: number;
}

function sumRevenue(
  rows: Array<{ final_price?: number | null; estimated_price?: number | null }> | null,
): number {
  return (rows ?? []).reduce((acc, row) => acc + Number(row.final_price ?? row.estimated_price ?? 0), 0);
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  const [
    usersCountRes,
    driversCountRes,
    activeRidesCountRes,
    completedTodayRes,
    todayRevenueRes,
    monthRevenueRes,
  ] = await Promise.all([
    supabaseAdmin.from('users').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('drivers').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('rides').select('id', { count: 'exact', head: true }).in('status', ['searching', 'accepted', 'arriving', 'in_progress']),
    supabaseAdmin.from('rides').select('id', { count: 'exact', head: true }).eq('status', 'completed').gte('completed_at', today.toISOString()),
    supabaseAdmin.from('rides').select('final_price, estimated_price').eq('status', 'completed').gte('completed_at', today.toISOString()),
    supabaseAdmin.from('rides').select('final_price, estimated_price').eq('status', 'completed').gte('completed_at', monthStart.toISOString()),
  ]);

  if (
    usersCountRes.error || driversCountRes.error || activeRidesCountRes.error ||
    completedTodayRes.error || todayRevenueRes.error || monthRevenueRes.error
  ) {
    logger.error('[Admin] overview sorgu hatası:', {
      users: usersCountRes.error,
      drivers: driversCountRes.error,
      activeRides: activeRidesCountRes.error,
      completedToday: completedTodayRes.error,
      todayRevenue: todayRevenueRes.error,
      monthRevenue: monthRevenueRes.error,
    });
    throw new AppError('Genel durum bilgisi alınamadı.', 500);
  }

  return {
    users: usersCountRes.count ?? 0,
    drivers: driversCountRes.count ?? 0,
    activeRides: activeRidesCountRes.count ?? 0,
    completedToday: completedTodayRes.count ?? 0,
    revenueToday: Math.round(sumRevenue(todayRevenueRes.data) * 100) / 100,
    revenueMonth: Math.round(sumRevenue(monthRevenueRes.data) * 100) / 100,
  };
}
