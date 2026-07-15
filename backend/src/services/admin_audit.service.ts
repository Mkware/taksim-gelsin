/**
 * Admin panelinden yapılan mutasyon eylemlerinin denetim kaydı.
 */

import { supabaseAdmin } from '../config/supabase';
import { AppError } from '../middleware/error.middleware';
import { logger } from '../utils/logger';

export interface AdminAuditActor {
  id: string;
  phone: string;
}

/**
 * Kayıt başarısız olursa asıl admin işlemini engellememesi için hatayı
 * yutar (loglar) — audit log ikincil bir kayıt, kritik yol değil.
 */
export async function recordAdminAction(
  actor: AdminAuditActor,
  action: string,
  targetType?: string,
  targetId?: string | null,
  details?: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabaseAdmin.from('admin_audit_log').insert({
    admin_id: actor.id,
    admin_phone: actor.phone,
    action,
    target_type: targetType ?? null,
    target_id: targetId ?? null,
    details: details ?? null,
  });

  if (error) {
    logger.error('[AdminAudit] kayıt eklenemedi:', error);
  }
}

export interface ListAdminAuditLogParams {
  page?: number;
  limit?: number;
  action?: string;
  targetType?: string;
  adminPhone?: string;
}

export async function listAdminAuditLog(
  params: ListAdminAuditLogParams,
): Promise<{ items: Record<string, unknown>[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(Math.max(1, params.limit ?? 50), 200);
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = supabaseAdmin
    .from('admin_audit_log')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (params.action) query = query.eq('action', params.action);
  if (params.targetType) query = query.eq('target_type', params.targetType);
  if (params.adminPhone) query = query.eq('admin_phone', params.adminPhone);

  const { data, error, count } = await query;
  if (error) {
    logger.error('[AdminAudit] liste alınamadı:', error);
    throw new AppError('Denetim kaydı alınamadı.', 500);
  }

  return { items: data ?? [], total: count ?? 0, page, limit };
}
