/**
 * User Route'ları
 * Kullanıcı profili CRUD işlemleri.
 */

import { Router, Request, Response } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { supabaseAdmin } from '../../config/supabase';

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
  } catch (error) {
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
  } catch (error) {
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
  } catch (error) {
    res.status(500).json({ success: false, error: 'Kullanıcı bilgileri alınamadı.' });
  }
});

export { router as userRoutes };
