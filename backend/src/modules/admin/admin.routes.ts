import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth.middleware';
import { supabaseAdmin } from '../../config/supabase';
import { redis } from '../../config/redis';
import { isAdminPhone, registerDriver } from '../auth/auth.service';
import { driverRegisterSchema, normalizeTrPhoneInput } from '../auth/auth.schema';
import { readFile } from 'node:fs/promises';
import {
  getPlatformSettings,
  updatePlatformSettings,
  type PlatformSettingsPatch,
} from '../../services/platform_settings.service';
import { logger } from '../../utils/logger';
import { AppError } from '../../middleware/error.middleware';
import { disconnectSocketsForUser } from '../../sockets/socket.manager';
import { invalidateSessionVersionCache } from '../../middleware/auth.middleware';
import { env } from '../../config/env';
import { sendAdminBroadcastPush } from '../../services/push_notification.service';
import { listAdminReviews } from '../../services/admin_reviews.service';
import { isValidUUID } from '../../utils/uuid';
import {
  adminCancelRide,
  getAdminRideById,
  listAdminRides,
} from '../../services/admin_rides.service';
import {
  deleteAdminCustomer,
  getAdminCustomerById,
  listAdminCustomers,
  resetCustomerPassword,
  revokeCustomerSessions,
  updateAdminCustomer,
} from '../../services/admin_customers.service';
import {
  adminClearRideMatching,
  adminRecoverStaleSearching,
  getAdminLiveSnapshot,
  getAdminOpsHealth,
  listAdminSearchingMatching,
  readMatchingDiagnostics,
} from '../../services/admin_live_ops.service';

const router = Router();
const PRICING_KEY = 'admin:pricing:v1';

const BCRYPT_ROUNDS = 12;

const adminBroadcastAudienceSchema = z.enum(['all', 'customers', 'drivers', 'user']);

const adminBroadcastPushSchema = z
  .object({
    title: z.string().min(1).max(80).trim(),
    body: z.string().min(1).max(500).trim(),
    audience: adminBroadcastAudienceSchema.default('all'),
    userId: z.string().uuid().optional(),
    phone: z
      .string()
      .transform((s) => normalizeTrPhoneInput(s))
      .pipe(z.string().regex(/^\+90[0-9]{10}$/, 'Geçerli Türk telefonu: +905551112233'))
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (data.audience !== 'user') return;
    if (!data.userId && !data.phone) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Tek kişi için userId veya phone gerekli.',
        path: ['userId'],
      });
    }
  });

const adminDriverUpdateSchema = z
  .object({
    full_name: z.string().min(2).max(100).trim().optional(),
    phone: z
      .string()
      .transform((s) => normalizeTrPhoneInput(s))
      .pipe(z.string().regex(/^\+90[0-9]{10}$/, 'Geçerli Türk telefonu: +905551112233'))
      .optional(),
    vehicle_plate: z.string().min(5).max(20).trim().optional(),
    vehicle_model: z.string().min(2).max(100).trim().optional(),
    vehicle_color: z.string().min(2).max(50).trim().optional(),
    password: z.string().min(6).max(128).optional(),
  })
  .strict();

type AdminRequest = Request & { adminUser?: { id: string; phone: string } };

async function requireAdmin(req: AdminRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Kimlik doğrulama gerekli.' });
      return;
    }

    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('id, phone')
      .eq('id', userId)
      .single();

    if (error || !user || !isAdminPhone(user.phone)) {
      res.status(403).json({ success: false, error: 'Bu işlem için admin yetkisi gerekli.' });
      return;
    }

    req.adminUser = { id: user.id, phone: user.phone as string };
    next();
  } catch {
    res.status(500).json({ success: false, error: 'Admin doğrulaması sırasında hata oluştu.' });
  }
}

// Global limiter `/api/v1/admin` yollarını atlıyor (app.ts) — bu yüzden web paneli
// açıldıktan sonra admin route'ları buraya kadar hiç throttle edilmiyordu.
const adminApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Çok fazla istek. Lütfen bir dakika bekleyin.' },
});

// Toplu bildirim tek route'ta ayrıca ekstra sıkı: yanlışlık/çift gönderim ile
// tüm kullanıcı tabanına spam atılmasını önler.
const broadcastPushLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Bildirim gönderme limiti aşıldı. Lütfen 10 dakika bekleyin.' },
});

router.use(authMiddleware, requireAdmin, adminApiLimiter);

router.get('/overview', async (_req: Request, res: Response) => {
  try {
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

    const sumRevenue = (rows: Array<{ final_price?: number | null; estimated_price?: number | null }> | null) =>
      (rows ?? []).reduce((acc, row) => acc + Number(row.final_price ?? row.estimated_price ?? 0), 0);

    res.json({
      success: true,
      data: {
        users: usersCountRes.count ?? 0,
        drivers: driversCountRes.count ?? 0,
        activeRides: activeRidesCountRes.count ?? 0,
        completedToday: completedTodayRes.count ?? 0,
        revenueToday: Math.round(sumRevenue(todayRevenueRes.data as Array<{ final_price?: number | null; estimated_price?: number | null }> | null) * 100) / 100,
        revenueMonth: Math.round(sumRevenue(monthRevenueRes.data as Array<{ final_price?: number | null; estimated_price?: number | null }> | null) * 100) / 100,
      },
    });
  } catch {
    res.status(500).json({ success: false, error: 'Genel durum bilgisi alınamadı.' });
  }
});

router.get('/settings/pricing', async (_req: Request, res: Response) => {
  try {
    const raw = await redis.get(PRICING_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, number>) : {};

    res.json({
      success: true,
      data: {
        entryDaily: Number(parsed.entryDaily ?? 0),
        entryWeekly: Number(parsed.entryWeekly ?? 0),
        entryMonthly: Number(parsed.entryMonthly ?? 0),
        commissionPercent: Number(parsed.commissionPercent ?? 0),
        commissionFlat: Number(parsed.commissionFlat ?? 0),
        minCommission: Number(parsed.minCommission ?? 0),
      },
    });
  } catch {
    res.status(500).json({ success: false, error: 'Fiyat ayarları alınamadı.' });
  }
});

const pricingSchema = z.object({
  entryDaily       : z.number().finite().min(0).max(100_000),
  entryWeekly      : z.number().finite().min(0).max(100_000),
  entryMonthly     : z.number().finite().min(0).max(100_000),
  commissionPercent: z.number().finite().min(0).max(100),
  commissionFlat   : z.number().finite().min(0).max(100_000),
  minCommission    : z.number().finite().min(0).max(100_000),
});

router.put('/settings/pricing', async (req: Request, res: Response) => {
  try {
    const parsed = pricingSchema.safeParse(req.body);
    if (!parsed.success) {
      const first = Object.values(parsed.error.flatten().fieldErrors).flat()[0] ?? 'Geçersiz fiyat verisi.';
      res.status(400).json({ success: false, error: first });
      return;
    }
    const data = { ...parsed.data, updatedAt: new Date().toISOString() };
    await redis.set(PRICING_KEY, JSON.stringify(data));
    res.json({ success: true, data });
  } catch {
    res.status(500).json({ success: false, error: 'Fiyat ayarları kaydedilemedi.' });
  }
});

/** T Coin, eşleştirme, cüzdan simülasyonu vb. — DB + env birleşimi */
router.get('/settings/platform', async (_req: Request, res: Response) => {
  try {
    res.json({ success: true, data: getPlatformSettings() });
  } catch {
    res.status(500).json({ success: false, error: 'Platform ayarları alınamadı.' });
  }
});

router.put('/settings/platform', async (req: Request, res: Response) => {
  try {
    const body = req.body as PlatformSettingsPatch;
    const next = await updatePlatformSettings(body);
    res.json({ success: true, data: next });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Kayıt başarısız.';
    res.status(500).json({ success: false, error: msg });
  }
});

router.get('/drivers', async (_req: Request, res: Response) => {
  try {
    const { data: drivers, error: driverErr } = await supabaseAdmin
      .from('drivers')
      .select('id, is_online, is_available, vehicle_plate, vehicle_model, vehicle_color, balance')
      .limit(200);

    if (driverErr) {
      res.status(500).json({ success: false, error: 'Sürücü listesi alınamadı.' });
      return;
    }

    const ids = (drivers ?? []).map((d) => d.id as string);
    let userMap = new Map<string, Record<string, unknown>>();
    if (ids.length > 0) {
      const { data: users, error: userErr } = await supabaseAdmin
        .from('users')
        .select('id, full_name, phone, rating, rating_count')
        .in('id', ids);
      if (!userErr && users) {
        userMap = new Map(
          users.map((u) => [u.id as string, u as Record<string, unknown>]),
        );
      }
    }

    const socketKeyValues = ids.length > 0
      ? await Promise.all(ids.map((id) => redis.get(`driver:socket:${id}`)))
      : [];
    const onlineSet = new Set(
      ids.filter((_, idx) => Boolean(socketKeyValues[idx])),
    );

    const items = (drivers ?? []).map((d) => {
      const id = d.id as string;
      const realtimeOnline = onlineSet.has(id);
      return {
        ...d,
        is_online: realtimeOnline,
        users: userMap.get(id) ?? null,
      };
    });

    res.json({ success: true, data: { items } });
  } catch {
    res.status(500).json({ success: false, error: 'Sürücü listesi alınamadı.' });
  }
});

/** Yeni sürücü — `users` + `drivers` (kayıt akışıyla aynı kurallar) */
router.post('/drivers', async (req: Request, res: Response) => {
  try {
    const parsed = driverRegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.flatten().fieldErrors;
      const first = Object.values(msg).flat()[0] ?? 'Geçersiz veri.';
      res.status(400).json({ success: false, error: first });
      return;
    }
    const result = await registerDriver(parsed.data);
    res.status(201).json({
      success: true,
      data: {
        id: result.user.id,
        phone: result.user.phone,
        full_name: result.user.full_name,
        vehicle_plate: result.driver.vehicle_plate,
        vehicle_model: result.driver.vehicle_model,
        vehicle_color: result.driver.vehicle_color,
      },
    });
  } catch (e) {
    if (e instanceof AppError) {
      res.status(e.statusCode).json({ success: false, error: e.message });
      return;
    }
    logger.error('[Admin] Sürücü oluşturma:', e);
    res.status(500).json({ success: false, error: 'Sürücü oluşturulamadı.' });
  }
});

/** Sürücü profil / araç / telefon / şifre güncelleme */
router.patch('/drivers/:id', async (req: Request, res: Response) => {
  const id = req.params.id;
  if (!isValidUUID(id)) {
    res.status(400).json({ success: false, error: 'Geçerli bir sürücü UUID gerekli.' });
    return;
  }

  try {
    const parsed = adminDriverUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      const first = parsed.error.flatten().fieldErrors;
      const msg = Object.values(first).flat()[0] ?? 'Geçersiz veri.';
      res.status(400).json({ success: false, error: msg });
      return;
    }
    const patch = parsed.data;
    if (Object.keys(patch).length === 0) {
      res.status(400).json({ success: false, error: 'Güncellenecek alan yok.' });
      return;
    }

    const { data: userRow, error: userErr } = await supabaseAdmin
      .from('users')
      .select('id, role, phone, session_version')
      .eq('id', id)
      .maybeSingle();

    if (userErr || !userRow || userRow.role !== 'driver') {
      res.status(404).json({ success: false, error: 'Sürücü bulunamadı.' });
      return;
    }

    if (patch.phone && patch.phone !== userRow.phone) {
      const { data: taken } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('phone', patch.phone)
        .neq('id', id)
        .maybeSingle();
      if (taken) {
        res.status(409).json({ success: false, error: 'Bu telefon başka kullanıcıda kayıtlı.' });
        return;
      }
    }

    if (patch.vehicle_plate) {
      const { data: plateRow } = await supabaseAdmin
        .from('drivers')
        .select('id')
        .eq('vehicle_plate', patch.vehicle_plate)
        .neq('id', id)
        .maybeSingle();
      if (plateRow) {
        res.status(409).json({ success: false, error: 'Bu plaka başka sürücüde kayıtlı.' });
        return;
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
      const { error: updUserErr } = await supabaseAdmin.from('users').update(userUpdates).eq('id', id);
      if (updUserErr) {
        logger.error('[Admin] users update:', updUserErr);
        res.status(500).json({ success: false, error: 'Kullanıcı güncellenemedi.' });
        return;
      }
    }

    const driverUpdates: Record<string, unknown> = {};
    if (patch.vehicle_plate != null) driverUpdates.vehicle_plate = patch.vehicle_plate;
    if (patch.vehicle_model != null) driverUpdates.vehicle_model = patch.vehicle_model;
    if (patch.vehicle_color != null) driverUpdates.vehicle_color = patch.vehicle_color;

    if (Object.keys(driverUpdates).length > 0) {
      const { error: drvErr } = await supabaseAdmin.from('drivers').update(driverUpdates).eq('id', id);
      if (drvErr) {
        logger.error('[Admin] drivers update:', drvErr);
        res.status(500).json({ success: false, error: 'Sürücü araç bilgisi güncellenemedi.' });
        return;
      }
    }

    if (bumpSession) {
      await invalidateSessionVersionCache(id);
      disconnectSocketsForUser(id);
    }

    res.json({ success: true, data: { id } });
  } catch (e) {
    logger.error('[Admin] Sürücü güncelleme:', e);
    res.status(500).json({ success: false, error: 'Sürücü güncellenemedi.' });
  }
});

/** Sürücüyü tamamen kaldırır (`users` silinir → `drivers` CASCADE) */
router.delete('/drivers/:id', async (req: Request, res: Response) => {
  const id = req.params.id;
  if (!isValidUUID(id)) {
    res.status(400).json({ success: false, error: 'Geçerli bir sürücü UUID gerekli.' });
    return;
  }

  try {
    const { data: userRow, error: userErr } = await supabaseAdmin
      .from('users')
      .select('id, role')
      .eq('id', id)
      .maybeSingle();

    if (userErr || !userRow || userRow.role !== 'driver') {
      res.status(404).json({ success: false, error: 'Sürücü bulunamadı.' });
      return;
    }

    disconnectSocketsForUser(id);
    await Promise.all([
      redis.del(`driver:socket:${id}`),
      redis.del(`driver:location:${id}`),
      redis.del(`driver:active_ride:${id}`),
      redis.del(`driver:pending_offer:${id}`),
    ]);

    const { error: delErr } = await supabaseAdmin.from('users').delete().eq('id', id);
    if (delErr) {
      logger.error('[Admin] Sürücü silme:', delErr);
      res.status(500).json({ success: false, error: 'Sürücü silinemedi.' });
      return;
    }

    await invalidateSessionVersionCache(id);
    res.json({ success: true, data: { id } });
  } catch (e) {
    logger.error('[Admin] Sürücü silme istisna:', e);
    res.status(500).json({ success: false, error: 'Sürücü silinemedi.' });
  }
});

router.post('/drivers/:id/balance', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const amount = Number((req.body as { amount?: number }).amount ?? 0);

    if (!isValidUUID(id)) {
      res.status(400).json({ success: false, error: 'Geçerli bir sürücü UUID zorunludur.' });
      return;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ success: false, error: 'Geçerli bir bakiye tutarı girin.' });
      return;
    }

    const { error: rpcError } = await supabaseAdmin.rpc('add_driver_balance', {
      p_driver_id: id,
      p_amount: amount,
    });

    if (rpcError) {
      logger.warn('[AdminBalance] add_driver_balance rpc missing/failed, fallback kullanılacak:', rpcError.message);

      // Bazı ortamlarda RPC migration'ı eksik/bozuk olabiliyor.
      // Panelin çalışmaya devam etmesi için kontrollü fallback (read+write) uygula.
      const { data: row, error: rowErr } = await supabaseAdmin
        .from('drivers')
        .select('id, balance')
        .eq('id', id)
        .single();

      if (rowErr || !row) {
        res.status(500).json({
          success: false,
          error: `Sürücü bakiyesi güncellenemedi (rpc): ${rpcError.message ?? 'bilinmeyen hata'}`,
        });
        return;
      }

      const current = Number(row.balance ?? 0);
      const nextBalance = Math.round((current + amount) * 100) / 100;
      const { data: updated, error: updErr } = await supabaseAdmin
        .from('drivers')
        .update({ balance: nextBalance })
        .eq('id', id)
        .select('id, balance')
        .single();

      if (updErr || !updated) {
        logger.error('[AdminBalance] fallback update error:', updErr);
        res.status(500).json({
          success: false,
          error: `Sürücü bakiyesi güncellenemedi (fallback): ${updErr?.message ?? 'bilinmeyen hata'}`,
        });
        return;
      }

      res.json({
        success: true,
        data: {
          id: updated.id,
          balance: Number(updated.balance ?? 0),
        },
      });
      return;
    }

    const { data: driver, error: driverError } = await supabaseAdmin
      .from('drivers')
      .select('id, balance')
      .eq('id', id)
      .single();

    if (driverError || !driver) {
      res.status(404).json({ success: false, error: 'Sürücü bulunamadı.' });
      return;
    }

    res.json({
      success: true,
      data: {
        id: driver.id,
        balance: Number(driver.balance ?? 0),
      },
    });
  } catch {
    res.status(500).json({ success: false, error: 'Sürücü bakiyesi güncellenemedi.' });
  }
});

router.patch('/drivers/:id/access', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    if (!isValidUUID(id)) {
      res.status(400).json({ success: false, error: 'Geçerli bir sürücü UUID gerekli.' });
      return;
    }
    const rawEnabled = (req.body as { enabled?: unknown }).enabled;
    if (typeof rawEnabled !== 'boolean') {
      res.status(400).json({ success: false, error: 'enabled boolean olmalıdır (true veya false).' });
      return;
    }
    const enabled = rawEnabled;

    const updateData = enabled
      ? { is_available: true }
      : { is_available: false, is_online: false };

    const { data, error } = await supabaseAdmin
      .from('drivers')
      .update(updateData)
      .eq('id', id)
      .select('id, is_online, is_available')
      .single();

    if (error || !data) {
      res.status(404).json({ success: false, error: 'Sürücü bulunamadı veya güncellenemedi.' });
      return;
    }

    res.json({ success: true, data });
  } catch {
    res.status(500).json({ success: false, error: 'Sürücü erişimi güncellenemedi.' });
  }
});

router.get('/rides', async (req: Request, res: Response) => {
  try {
    const { items } = await listAdminRides({
      limit: Number(req.query.limit ?? 50),
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      q: typeof req.query.q === 'string' ? req.query.q : undefined,
    });
    res.json({ success: true, data: { items } });
  } catch (e) {
    if (e instanceof AppError) {
      res.status(e.statusCode).json({ success: false, error: e.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Yolculuk listesi alınamadı.' });
  }
});

router.get('/rides/:id', async (req: Request, res: Response) => {
  const id = req.params.id;
  if (!isValidUUID(id)) {
    res.status(400).json({ success: false, error: 'Geçerli bir yolculuk UUID gerekli.' });
    return;
  }
  try {
    const ride = await getAdminRideById(id);
    res.json({ success: true, data: ride });
  } catch (e) {
    if (e instanceof AppError) {
      res.status(e.statusCode).json({ success: false, error: e.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Yolculuk detayı alınamadı.' });
  }
});

const adminRideCancelSchema = z.object({
  reason: z.string().max(500).trim().optional(),
});

router.post('/rides/:id/cancel', async (req: AdminRequest, res: Response) => {
  const id = req.params.id;
  if (!isValidUUID(id)) {
    res.status(400).json({ success: false, error: 'Geçerli bir yolculuk UUID gerekli.' });
    return;
  }
  const parsed = adminRideCancelSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Geçersiz iptal verisi.' });
    return;
  }
  try {
    const ride = await adminCancelRide(
      id,
      parsed.data.reason ?? '',
      req.adminUser?.id ?? 'admin',
    );
    res.json({ success: true, message: 'Yolculuk iptal edildi.', data: ride });
  } catch (e) {
    if (e instanceof AppError) {
      res.status(e.statusCode).json({ success: false, error: e.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Yolculuk iptal edilemedi.' });
  }
});

router.get('/customers', async (req: Request, res: Response) => {
  try {
    const { items } = await listAdminCustomers({
      limit: Number(req.query.limit ?? 50),
      q: typeof req.query.q === 'string' ? req.query.q : undefined,
      suspended: typeof req.query.suspended === 'string' ? req.query.suspended : undefined,
    });
    res.json({ success: true, data: { items } });
  } catch (e) {
    if (e instanceof AppError) {
      res.status(e.statusCode).json({ success: false, error: e.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Müşteri listesi alınamadı.' });
  }
});

router.get('/customers/:id', async (req: Request, res: Response) => {
  const id = req.params.id;
  if (!isValidUUID(id)) {
    res.status(400).json({ success: false, error: 'Geçerli bir müşteri UUID gerekli.' });
    return;
  }
  try {
    const customer = await getAdminCustomerById(id);
    res.json({ success: true, data: customer });
  } catch (e) {
    if (e instanceof AppError) {
      res.status(e.statusCode).json({ success: false, error: e.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Müşteri detayı alınamadı.' });
  }
});

const adminCustomerUpdateSchema = z
  .object({
    is_suspended: z.boolean().optional(),
    full_name: z.string().min(2).max(100).trim().optional(),
    phone: z
      .string()
      .transform((s) => normalizeTrPhoneInput(s))
      .pipe(z.string().regex(/^\+90[0-9]{10}$/, 'Geçerli Türk telefonu: +905551112233'))
      .optional(),
  })
  .strict();

router.patch('/customers/:id', async (req: Request, res: Response) => {
  const id = req.params.id;
  if (!isValidUUID(id)) {
    res.status(400).json({ success: false, error: 'Geçerli bir müşteri UUID gerekli.' });
    return;
  }
  const parsed = adminCustomerUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    const first = Object.values(parsed.error.flatten().fieldErrors).flat()[0] ?? 'Geçersiz veri.';
    res.status(400).json({ success: false, error: first });
    return;
  }
  try {
    const customer = await updateAdminCustomer(id, parsed.data);
    res.json({ success: true, data: customer });
  } catch (e) {
    if (e instanceof AppError) {
      res.status(e.statusCode).json({ success: false, error: e.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Müşteri güncellenemedi.' });
  }
});

router.post('/customers/:id/revoke-sessions', async (req: Request, res: Response) => {
  const id = req.params.id;
  if (!isValidUUID(id)) {
    res.status(400).json({ success: false, error: 'Geçerli bir müşteri UUID gerekli.' });
    return;
  }
  try {
    await revokeCustomerSessions(id);
    res.json({ success: true, message: 'Tüm oturumlar sonlandırıldı.' });
  } catch (e) {
    if (e instanceof AppError) {
      res.status(e.statusCode).json({ success: false, error: e.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Oturum sonlandırılamadı.' });
  }
});

const adminCustomerPasswordSchema = z.object({
  password: z.string().min(6).max(128),
});

router.post('/customers/:id/reset-password', async (req: Request, res: Response) => {
  const id = req.params.id;
  if (!isValidUUID(id)) {
    res.status(400).json({ success: false, error: 'Geçerli bir müşteri UUID gerekli.' });
    return;
  }
  const parsed = adminCustomerPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Şifre en az 6 karakter olmalı.' });
    return;
  }
  try {
    await resetCustomerPassword(id, parsed.data.password);
    res.json({ success: true, message: 'Şifre güncellendi ve oturumlar kapatıldı.' });
  } catch (e) {
    if (e instanceof AppError) {
      res.status(e.statusCode).json({ success: false, error: e.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Şifre güncellenemedi.' });
  }
});

router.delete('/customers/:id', async (req: Request, res: Response) => {
  const id = req.params.id;
  if (!isValidUUID(id)) {
    res.status(400).json({ success: false, error: 'Geçerli bir müşteri UUID gerekli.' });
    return;
  }
  try {
    await deleteAdminCustomer(id);
    res.json({ success: true, data: { id } });
  } catch (e) {
    if (e instanceof AppError) {
      res.status(e.statusCode).json({ success: false, error: e.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Müşteri silinemedi.' });
  }
});

router.get('/ops/live', async (_req: Request, res: Response) => {
  try {
    const data = await getAdminLiveSnapshot();
    res.json({ success: true, data });
  } catch (e) {
    if (e instanceof AppError) {
      res.status(e.statusCode).json({ success: false, error: e.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Canlı veri alınamadı.' });
  }
});

router.get('/ops/health', async (_req: Request, res: Response) => {
  try {
    const data = await getAdminOpsHealth();
    res.json({ success: true, data });
  } catch {
    res.status(500).json({ success: false, error: 'Sistem durumu alınamadı.' });
  }
});

router.get('/ops/matching', async (_req: Request, res: Response) => {
  try {
    const data = await listAdminSearchingMatching();
    res.json({ success: true, data });
  } catch (e) {
    if (e instanceof AppError) {
      res.status(e.statusCode).json({ success: false, error: e.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Eşleştirme listesi alınamadı.' });
  }
});

router.get('/ops/matching/:rideId', async (req: Request, res: Response) => {
  const rideId = req.params.rideId;
  if (!isValidUUID(rideId)) {
    res.status(400).json({ success: false, error: 'Geçerli yolculuk UUID gerekli.' });
    return;
  }
  try {
    const matching = await readMatchingDiagnostics(rideId);
    res.json({ success: true, data: { matching } });
  } catch (e) {
    if (e instanceof AppError) {
      res.status(e.statusCode).json({ success: false, error: e.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Eşleştirme detayı alınamadı.' });
  }
});

router.post('/ops/matching/:rideId/clear', async (req: Request, res: Response) => {
  const rideId = req.params.rideId;
  if (!isValidUUID(rideId)) {
    res.status(400).json({ success: false, error: 'Geçerli yolculuk UUID gerekli.' });
    return;
  }
  try {
    await adminClearRideMatching(rideId);
    res.json({ success: true, message: 'Eşleştirme kuyruğu temizlendi.' });
  } catch (e) {
    if (e instanceof AppError) {
      res.status(e.statusCode).json({ success: false, error: e.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Eşleştirme temizlenemedi.' });
  }
});

router.post('/ops/stale-searching/recover', async (_req: Request, res: Response) => {
  try {
    const data = await adminRecoverStaleSearching();
    res.json({
      success: true,
      message: `${data.recovered} yolculuk kurtarıldı/iptal edildi.`,
      data,
    });
  } catch (e) {
    if (e instanceof AppError) {
      res.status(e.statusCode).json({ success: false, error: e.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Kurtarma çalıştırılamadı.' });
  }
});

const ANSI_ESCAPE_REGEX = /\x1b\[[0-9;]*m/g;

router.get('/logs', async (req: Request, res: Response) => {
  try {
    const lines = Math.min(Math.max(Number(req.query.lines ?? 200), 20), 1000);

    const readLastLines = async (path: string): Promise<string[]> => {
      try {
        const content = await readFile(path, 'utf8');
        const normalized = content.replace(/\r\n/g, '\n').replace(ANSI_ESCAPE_REGEX, '');
        return normalized.split('\n').filter(Boolean).slice(-lines);
      } catch {
        return [];
      }
    };

    const outPath = env.ADMIN_LOG_OUT_PATH.trim();
    const errPath = env.ADMIN_LOG_ERROR_PATH.trim();

    if (!outPath || !errPath) {
      res.json({
        success: true,
        data: {
          out: [],
          error: [],
          fetchedAt: new Date().toISOString(),
          configured: false,
          message:
            'Log dosya yolları ayarlı değil. Sunucu .env içinde ADMIN_LOG_OUT_PATH ve ADMIN_LOG_ERROR_PATH tanımlayın (örn. PM2 out/error dosyaları).',
        },
      });
      return;
    }

    const [outLines, errorLines] = await Promise.all([
      readLastLines(outPath),
      readLastLines(errPath),
    ]);

    res.json({
      success: true,
      data: {
        out: outLines,
        error: errorLines,
        fetchedAt: new Date().toISOString(),
        configured: true,
      },
    });
  } catch {
    res.status(500).json({ success: false, error: 'Loglar alınamadı.' });
  }
});

/** Yolculuk değerlendirmeleri — yıldıza göre filtre (?rating=1..5), özet sayılar dahil. */
router.get('/reviews', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page ?? 1), 10) || 1);
    const limit = Math.min(Math.max(1, parseInt(String(req.query.limit ?? 40), 10) || 40), 100);
    const ratingRaw = req.query.rating;
    let rating: number | undefined;
    if (ratingRaw !== undefined && ratingRaw !== '' && ratingRaw !== 'all') {
      const n = parseInt(String(ratingRaw), 10);
      if (!Number.isInteger(n) || n < 1 || n > 5) {
        res.status(400).json({
          success: false,
          error: 'rating 1 ile 5 arasında tam sayı olmalıdır (veya all).',
        });
        return;
      }
      rating = n;
    }
    const data = await listAdminReviews({ rating, page, limit });
    res.json({ success: true, data });
  } catch (e) {
    if (e instanceof Error && e.message === 'REVIEWS_LIST_FAILED') {
      res.status(500).json({ success: false, error: 'Değerlendirmeler alınamadı.' });
      return;
    }
    logger.error('[Admin] GET /reviews:', e);
    res.status(500).json({ success: false, error: 'Değerlendirmeler alınamadı.' });
  }
});

/** Kayıtlı FCM token'larına yönetici bildirimi (tümü / yolcular / sürücüler / tek kullanıcı). */
router.post('/push/broadcast', broadcastPushLimiter, async (req: AdminRequest, res: Response) => {
  try {
    const parsed = adminBroadcastPushSchema.safeParse(req.body);
    if (!parsed.success) {
      const flat = parsed.error.flatten();
      const fieldMsg = Object.values(flat.fieldErrors).flat()[0];
      const formMsg = flat.formErrors[0];
      res.status(400).json({
        success: false,
        error: fieldMsg ?? formMsg ?? 'Geçersiz istek gövdesi.',
        details: flat,
      });
      return;
    }
    const { title, body, audience, userId, phone } = parsed.data;
    const adminId = req.adminUser!.id;
    const result = await sendAdminBroadcastPush(title, body, adminId, {
      audience,
      userId,
      phone,
    });
    logger.info(
      `[Admin] Push yayın: audience=${audience} admin=${adminId} token=${result.totalTokens} başarı=${result.successCount}`,
    );
    res.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'USER_NOT_FOUND') {
        res.status(404).json({ success: false, error: 'Kullanıcı bulunamadı.' });
        return;
      }
      if (error.message === 'USER_TARGET_REQUIRED') {
        res.status(400).json({
          success: false,
          error: 'Tek kişi bildirimi için userId veya phone gerekli.',
        });
        return;
      }
    }
    logger.error('Admin push/broadcast:', error);
    res.status(500).json({ success: false, error: 'Toplu bildirim gönderilemedi.' });
  }
});

export { router as adminRoutes };
