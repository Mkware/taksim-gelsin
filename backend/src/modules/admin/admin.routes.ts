import { Router, Request, Response, NextFunction } from 'express';
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
  addAdminDriverBalance,
  deleteAdminDriver,
  listAdminDrivers,
  setAdminDriverAccess,
  updateAdminDriver,
} from '../../services/admin_drivers.service';
import { getAdminOverview } from '../../services/admin_overview.service';
import {
  adminClearRideMatching,
  adminRecoverStaleSearching,
  getAdminLiveSnapshot,
  getAdminOpsHealth,
  listAdminSearchingMatching,
  readMatchingDiagnostics,
} from '../../services/admin_live_ops.service';
import { listWalletTransactions } from '../../services/admin_wallet.service';
import { listAdminAuditLog, recordAdminAction } from '../../services/admin_audit.service';

const router = Router();
const PRICING_KEY = 'admin:pricing:v1';

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
    const data = await getAdminOverview();
    res.json({ success: true, data });
  } catch (e) {
    if (e instanceof AppError) {
      res.status(e.statusCode).json({ success: false, error: e.message });
      return;
    }
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

router.put('/settings/pricing', async (req: AdminRequest, res: Response) => {
  try {
    const parsed = pricingSchema.safeParse(req.body);
    if (!parsed.success) {
      const first = Object.values(parsed.error.flatten().fieldErrors).flat()[0] ?? 'Geçersiz fiyat verisi.';
      res.status(400).json({ success: false, error: first });
      return;
    }
    const data = { ...parsed.data, updatedAt: new Date().toISOString() };
    await redis.set(PRICING_KEY, JSON.stringify(data));
    void recordAdminAction(req.adminUser!, 'settings.pricing_update', 'settings', 'pricing', parsed.data);
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

router.put('/settings/platform', async (req: AdminRequest, res: Response) => {
  try {
    const body = req.body as PlatformSettingsPatch;
    const next = await updatePlatformSettings(body);
    void recordAdminAction(req.adminUser!, 'settings.platform_update', 'settings', 'platform', body);
    res.json({ success: true, data: next });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Kayıt başarısız.';
    res.status(500).json({ success: false, error: msg });
  }
});

router.get('/drivers', async (_req: Request, res: Response) => {
  try {
    const data = await listAdminDrivers();
    res.json({ success: true, data });
  } catch (e) {
    if (e instanceof AppError) {
      res.status(e.statusCode).json({ success: false, error: e.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Sürücü listesi alınamadı.' });
  }
});

/** Yeni sürücü — `users` + `drivers` (kayıt akışıyla aynı kurallar) */
router.post('/drivers', async (req: AdminRequest, res: Response) => {
  try {
    const parsed = driverRegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.flatten().fieldErrors;
      const first = Object.values(msg).flat()[0] ?? 'Geçersiz veri.';
      res.status(400).json({ success: false, error: first });
      return;
    }
    const result = await registerDriver(parsed.data);
    void recordAdminAction(req.adminUser!, 'driver.create', 'driver', result.user.id, {
      phone: result.user.phone,
      vehicle_plate: result.driver.vehicle_plate,
    });
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
router.patch('/drivers/:id', async (req: AdminRequest, res: Response) => {
  const id = req.params.id;
  if (!isValidUUID(id)) {
    res.status(400).json({ success: false, error: 'Geçerli bir sürücü UUID gerekli.' });
    return;
  }

  const parsed = adminDriverUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    const first = parsed.error.flatten().fieldErrors;
    const msg = Object.values(first).flat()[0] ?? 'Geçersiz veri.';
    res.status(400).json({ success: false, error: msg });
    return;
  }

  try {
    const data = await updateAdminDriver(id, parsed.data);
    void recordAdminAction(req.adminUser!, 'driver.update', 'driver', id, {
      fields: Object.keys(parsed.data),
    });
    res.json({ success: true, data });
  } catch (e) {
    if (e instanceof AppError) {
      res.status(e.statusCode).json({ success: false, error: e.message });
      return;
    }
    logger.error('[Admin] Sürücü güncelleme:', e);
    res.status(500).json({ success: false, error: 'Sürücü güncellenemedi.' });
  }
});

/** Sürücüyü tamamen kaldırır (`users` silinir → `drivers` CASCADE) */
router.delete('/drivers/:id', async (req: AdminRequest, res: Response) => {
  const id = req.params.id;
  if (!isValidUUID(id)) {
    res.status(400).json({ success: false, error: 'Geçerli bir sürücü UUID gerekli.' });
    return;
  }

  try {
    const data = await deleteAdminDriver(id);
    void recordAdminAction(req.adminUser!, 'driver.delete', 'driver', id);
    res.json({ success: true, data });
  } catch (e) {
    if (e instanceof AppError) {
      res.status(e.statusCode).json({ success: false, error: e.message });
      return;
    }
    logger.error('[Admin] Sürücü silme istisna:', e);
    res.status(500).json({ success: false, error: 'Sürücü silinemedi.' });
  }
});

router.post('/drivers/:id/balance', async (req: AdminRequest, res: Response) => {
  const id = req.params.id;
  if (!isValidUUID(id)) {
    res.status(400).json({ success: false, error: 'Geçerli bir sürücü UUID zorunludur.' });
    return;
  }
  const body = req.body as { amount?: number; reason?: string };
  const amount = Number(body.amount ?? 0);
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) || undefined : undefined;

  try {
    const data = await addAdminDriverBalance(id, amount, reason);
    void recordAdminAction(req.adminUser!, 'driver.balance_add', 'driver', id, { amount, reason });
    res.json({ success: true, data });
  } catch (e) {
    if (e instanceof AppError) {
      res.status(e.statusCode).json({ success: false, error: e.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Sürücü bakiyesi güncellenemedi.' });
  }
});

router.patch('/drivers/:id/access', async (req: AdminRequest, res: Response) => {
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

  try {
    const data = await setAdminDriverAccess(id, rawEnabled);
    void recordAdminAction(req.adminUser!, 'driver.access_set', 'driver', id, { enabled: rawEnabled });
    res.json({ success: true, data });
  } catch (e) {
    if (e instanceof AppError) {
      res.status(e.statusCode).json({ success: false, error: e.message });
      return;
    }
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
    void recordAdminAction(req.adminUser!, 'ride.cancel', 'ride', id, { reason: parsed.data.reason });
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

router.patch('/customers/:id', async (req: AdminRequest, res: Response) => {
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
    void recordAdminAction(req.adminUser!, 'customer.update', 'customer', id, parsed.data);
    res.json({ success: true, data: customer });
  } catch (e) {
    if (e instanceof AppError) {
      res.status(e.statusCode).json({ success: false, error: e.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Müşteri güncellenemedi.' });
  }
});

router.post('/customers/:id/revoke-sessions', async (req: AdminRequest, res: Response) => {
  const id = req.params.id;
  if (!isValidUUID(id)) {
    res.status(400).json({ success: false, error: 'Geçerli bir müşteri UUID gerekli.' });
    return;
  }
  try {
    await revokeCustomerSessions(id);
    void recordAdminAction(req.adminUser!, 'customer.revoke_sessions', 'customer', id);
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

router.post('/customers/:id/reset-password', async (req: AdminRequest, res: Response) => {
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
    void recordAdminAction(req.adminUser!, 'customer.reset_password', 'customer', id);
    res.json({ success: true, message: 'Şifre güncellendi ve oturumlar kapatıldı.' });
  } catch (e) {
    if (e instanceof AppError) {
      res.status(e.statusCode).json({ success: false, error: e.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Şifre güncellenemedi.' });
  }
});

router.delete('/customers/:id', async (req: AdminRequest, res: Response) => {
  const id = req.params.id;
  if (!isValidUUID(id)) {
    res.status(400).json({ success: false, error: 'Geçerli bir müşteri UUID gerekli.' });
    return;
  }
  try {
    await deleteAdminCustomer(id);
    void recordAdminAction(req.adminUser!, 'customer.delete', 'customer', id);
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

router.post('/ops/matching/:rideId/clear', async (req: AdminRequest, res: Response) => {
  const rideId = req.params.rideId;
  if (!isValidUUID(rideId)) {
    res.status(400).json({ success: false, error: 'Geçerli yolculuk UUID gerekli.' });
    return;
  }
  try {
    await adminClearRideMatching(rideId);
    void recordAdminAction(req.adminUser!, 'ops.matching_clear', 'ride', rideId);
    res.json({ success: true, message: 'Eşleştirme kuyruğu temizlendi.' });
  } catch (e) {
    if (e instanceof AppError) {
      res.status(e.statusCode).json({ success: false, error: e.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Eşleştirme temizlenemedi.' });
  }
});

router.post('/ops/stale-searching/recover', async (req: AdminRequest, res: Response) => {
  try {
    const data = await adminRecoverStaleSearching();
    void recordAdminAction(req.adminUser!, 'ops.stale_searching_recover', 'ops', null, {
      recovered: data.recovered,
    });
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
    void recordAdminAction(req.adminUser!, 'push.broadcast', 'push', null, {
      audience,
      title,
      totalTokens: result.totalTokens,
      successCount: result.successCount,
    });
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

/** Sürücü cüzdanı (T-Coin) hareket defteri — filtre: driverId, type, page, limit. */
router.get('/wallet/transactions', async (req: Request, res: Response) => {
  try {
    const driverId = typeof req.query.driverId === 'string' ? req.query.driverId : undefined;
    if (driverId && !isValidUUID(driverId)) {
      res.status(400).json({ success: false, error: 'Geçerli bir sürücü UUID gerekli.' });
      return;
    }
    const data = await listWalletTransactions({
      page: Number(req.query.page ?? 1),
      limit: Number(req.query.limit ?? 50),
      driverId,
      type: typeof req.query.type === 'string' ? req.query.type : undefined,
    });
    res.json({ success: true, data });
  } catch (e) {
    if (e instanceof AppError) {
      res.status(e.statusCode).json({ success: false, error: e.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Cüzdan hareketleri alınamadı.' });
  }
});

/** Admin panelinden yapılan eylemlerin denetim kaydı — filtre: action, targetType, adminPhone, page, limit. */
router.get('/audit-log', async (req: Request, res: Response) => {
  try {
    const data = await listAdminAuditLog({
      page: Number(req.query.page ?? 1),
      limit: Number(req.query.limit ?? 50),
      action: typeof req.query.action === 'string' ? req.query.action : undefined,
      targetType: typeof req.query.targetType === 'string' ? req.query.targetType : undefined,
      adminPhone: typeof req.query.adminPhone === 'string' ? req.query.adminPhone : undefined,
    });
    res.json({ success: true, data });
  } catch (e) {
    if (e instanceof AppError) {
      res.status(e.statusCode).json({ success: false, error: e.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Denetim kaydı alınamadı.' });
  }
});

export { router as adminRoutes };
