/**
 * User Route'ları
 * Kullanıcı profili CRUD işlemleri.
 */

import { Router, Request, Response } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { supabaseAdmin } from '../../config/supabase';
import { drivingMetersAndSecondsDriverToPickup } from '../../services/driving_distance.service';
import { decodeEwkbPoint } from '../../utils/geo';
import { logger } from '../../utils/logger';

const router = Router();

// Tüm user route'ları JWT ile korunur
router.use(authMiddleware);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isValidUUID(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

type PushPlatform = 'android' | 'ios' | 'web';

function parsePushPlatform(raw: unknown): PushPlatform | null {
  if (raw === 'android' || raw === 'ios' || raw === 'web') return raw;
  return null;
}

// Kendi profil bilgilerini getir
router.get('/me', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;

    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id, phone, full_name, avatar_url, role, rating, rating_count, created_at')
      .eq('id', userId)
      .single();

    if (error || !data) {
      res.status(404).json({ success: false, error: 'Kullanıcı bulunamadı.' });
      return;
    }

    res.json({ success: true, data });
  } catch {
    res.status(500).json({ success: false, error: 'Profil bilgileri alınamadı.' });
  }
});

/**
 * FCM / APNs cihaz token kaydı — özellikle sürücü çağrı bildirimi için (Socket tamamlayıcısı).
 * POST body: { token: string, platform: 'android' | 'ios' | 'web' }
 */
router.post('/me/push-token', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    const platform = parsePushPlatform(req.body?.platform);
    if (!token || token.length > 4096) {
      res.status(400).json({ success: false, error: 'Geçerli bir token gerekli.' });
      return;
    }
    if (!platform) {
      res.status(400).json({
        success: false,
        error: 'platform: android, ios veya web olmalı.',
      });
      return;
    }

    const now = new Date().toISOString();
    // Aynı FCM token tek satır: önce tüm sahiplikten sil (başka hesapta kalmış satır kalmasın).
    await supabaseAdmin.from('device_push_tokens').delete().eq('token', token);
    const { error } = await supabaseAdmin.from('device_push_tokens').insert({
      user_id: userId,
      token,
      platform,
      created_at: now,
      updated_at: now,
    });

    if (error) {
      res.status(500).json({ success: false, error: 'Token kaydedilemedi.' });
      return;
    }

    res.json({ success: true, message: 'Push token kaydedildi.' });
  } catch {
    res.status(500).json({ success: false, error: 'Push token işlenemedi.' });
  }
});

/** Çıkış veya izin kapatıldığında token silmek için */
router.delete('/me/push-token', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    if (!token) {
      res.status(400).json({ success: false, error: 'token gerekli.' });
      return;
    }

    await supabaseAdmin
      .from('device_push_tokens')
      .delete()
      .eq('user_id', userId)
      .eq('token', token);

    res.json({ success: true, message: 'Push token silindi.' });
  } catch {
    res.status(500).json({ success: false, error: 'Push token silinemedi.' });
  }
});

// ─── Favori sürücüler (favori sürücü çağırma) ─────────────────────────────

const DRIVER_CODE_RE = /^\d{4}$/;

/** Favori sürücüleri getir — çevrimiçi olanlar için (lat/lng verilmişse) ETA hesaplanır. */
router.get('/me/favorite-drivers', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;

    const { data, error } = await supabaseAdmin
      .from('customer_favorite_drivers')
      .select(`
        driver_id,
        drivers:driver_id (
          id, vehicle_plate, vehicle_model, vehicle_color, is_online, current_location,
          users:id (full_name, rating, rating_count)
        )
      `)
      .eq('customer_id', userId)
      .order('created_at', { ascending: true });

    if (error) {
      logger.error('[FavoriteDrivers] GET select hata:', error);
      res.status(500).json({ success: false, error: 'Favori sürücüler alınamadı.' });
      return;
    }

    const rows = (data ?? []) as unknown as Array<{
      driver_id: string;
      drivers: {
        id: string;
        vehicle_plate: string;
        vehicle_model: string;
        vehicle_color: string;
        is_online: boolean;
        current_location: unknown;
        users: { full_name: string; rating: number; rating_count: number } | null;
      } | null;
    }>;

    const qLat = Number(req.query.lat);
    const qLng = Number(req.query.lng);
    const haveOrigin = Number.isFinite(qLat) && Number.isFinite(qLng);

    const onlineWithLocation = rows
      .map((r) => r.drivers)
      .filter((d): d is NonNullable<typeof d> => !!d && d.is_online)
      .map((d) => ({ id: d.id, point: decodeEwkbPoint(d.current_location) }))
      .filter((d): d is { id: string; point: { lat: number; lng: number } } => !!d.point);

    const etaByDriverId = new Map<string, number>();
    if (haveOrigin && onlineWithLocation.length > 0) {
      try {
        const driving = await drivingMetersAndSecondsDriverToPickup(
          qLat,
          qLng,
          onlineWithLocation.map((d) => d.point),
        );
        onlineWithLocation.forEach((d, i) => {
          const seconds = driving[i]?.seconds;
          if (Number.isFinite(seconds)) etaByDriverId.set(d.id, seconds as number);
        });
      } catch {
        // ETA hesaplanamazsa liste yine dönsün, yalnızca eta_seconds boş kalır
      }
    }

    const result = rows
      .filter((r) => !!r.drivers)
      .map((r) => {
        const d = r.drivers!;
        return {
          driver_id: d.id,
          full_name: d.users?.full_name ?? '',
          rating: d.users?.rating ?? 5,
          vehicle_plate: d.vehicle_plate,
          vehicle_model: d.vehicle_model,
          vehicle_color: d.vehicle_color,
          is_online: d.is_online,
          eta_seconds: etaByDriverId.get(d.id) ?? null,
        };
      });

    res.json({ success: true, data: result });
  } catch (e) {
    logger.error('[FavoriteDrivers] GET beklenmeyen hata:', e);
    res.status(500).json({ success: false, error: 'Favori sürücüler alınırken hata oluştu.' });
  }
});

/** Favori sürücü ekle — sürücü numarasıyla (maks. 3, telefon numarası kullanılmaz). */
router.post('/me/favorite-drivers', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const code = typeof req.body?.driver_code === 'string' ? req.body.driver_code.trim() : '';

    if (!DRIVER_CODE_RE.test(code)) {
      res.status(400).json({ success: false, error: 'Geçerli bir sürücü numarası girin.' });
      return;
    }

    const { data: driver, error: driverError } = await supabaseAdmin
      .from('drivers')
      .select('id')
      .eq('driver_code', code)
      .single();

    if (driverError || !driver) {
      res.status(404).json({ success: false, error: 'Sürücü bulunamadı.' });
      return;
    }

    const { count } = await supabaseAdmin
      .from('customer_favorite_drivers')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', userId);

    if ((count ?? 0) >= 3) {
      res.status(400).json({ success: false, error: 'En fazla 3 favori sürücü ekleyebilirsiniz.' });
      return;
    }

    const { error: insertError } = await supabaseAdmin
      .from('customer_favorite_drivers')
      .insert({ customer_id: userId, driver_id: driver.id });

    if (insertError) {
      if (insertError.code === '23505') {
        res.status(409).json({ success: false, error: 'Bu sürücü zaten favorilerinizde.' });
        return;
      }
      res.status(500).json({ success: false, error: 'Favori sürücü eklenemedi.' });
      return;
    }

    res.json({ success: true, message: 'Favori sürücü eklendi.' });
  } catch {
    res.status(500).json({ success: false, error: 'Favori sürücü eklenirken hata oluştu.' });
  }
});

/** Favori sürücü çıkar. */
router.delete('/me/favorite-drivers/:driverId', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { driverId } = req.params;

    if (!isValidUUID(driverId)) {
      res.status(400).json({ success: false, error: 'Geçerli bir sürücü UUID gerekli.' });
      return;
    }

    await supabaseAdmin
      .from('customer_favorite_drivers')
      .delete()
      .eq('customer_id', userId)
      .eq('driver_id', driverId);

    res.json({ success: true, message: 'Favori sürücü çıkarıldı.' });
  } catch {
    res.status(500).json({ success: false, error: 'Favori sürücü çıkarılırken hata oluştu.' });
  }
});

// Profil güncelleme
router.put('/me', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { full_name, avatar_url } = req.body;

    const updateData: Record<string, string> = {};

    if (full_name !== undefined) {
      if (typeof full_name !== 'string' || full_name.trim().length < 2 || full_name.trim().length > 100) {
        res.status(400).json({ success: false, error: 'İsim 2-100 karakter arasında olmalıdır.' });
        return;
      }
      updateData.full_name = full_name.trim();
    }

    if (avatar_url !== undefined) {
      if (typeof avatar_url !== 'string' || avatar_url.length > 500) {
        res.status(400).json({ success: false, error: 'Geçersiz avatar URL (maks 500 karakter).' });
        return;
      }
      const av = avatar_url.trim();
      if (av.length > 0 && !/^https:\/\//i.test(av)) {
        res.status(400).json({
          success: false,
          error: 'avatar_url yalnızca https:// ile başlayan bir adres olabilir veya boş bırakılabilir.',
        });
        return;
      }
      updateData.avatar_url = av;
    }

    if (Object.keys(updateData).length === 0) {
      res.status(400).json({ success: false, error: 'Güncellenecek alan belirtilmedi.' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('users')
      .update(updateData)
      .eq('id', userId)
      .select('id, phone, full_name, avatar_url, role, rating, rating_count')
      .single();

    if (error) {
      res.status(500).json({ success: false, error: 'Profil güncellenemedi.' });
      return;
    }

    res.json({ success: true, data, message: 'Profil güncellendi.' });
  } catch {
    res.status(500).json({ success: false, error: 'Profil güncellenirken hata oluştu.' });
  }
});

// Belirli bir kullanıcının public profilini getir
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!isValidUUID(id)) {
      res.status(400).json({ success: false, error: 'Geçerli bir kullanıcı UUID gerekli.' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id, full_name, avatar_url, role, rating, rating_count, created_at')
      .eq('id', id)
      .single();

    if (error || !data) {
      res.status(404).json({ success: false, error: 'Kullanıcı bulunamadı.' });
      return;
    }

    res.json({ success: true, data });
  } catch {
    res.status(500).json({ success: false, error: 'Kullanıcı bilgileri alınamadı.' });
  }
});

export { router as userRoutes };
