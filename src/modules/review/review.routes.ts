/**
 * Review Route'ları
 * Yolculuk değerlendirme ve puanlama endpoint'leri.
 */

import { Router, Request, Response } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { supabaseAdmin } from '../../config/supabase';
import { logger } from '../../utils/logger';
import { sendAdminLowRatingReviewPush } from '../../services/push_notification.service';

const router = Router();

// UUID v4 format kontrolü
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isValidUUID(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

// Tüm review route'ları JWT ile korunur
router.use(authMiddleware);

// Yolculuk değerlendirmesi oluştur
router.post('/', async (req: Request, res: Response) => {
  try {
    const reviewerId = req.user!.userId;
    const { ride_id, reviewed_id, rating, comment } = req.body;

    // Zorunlu alan kontrolü
    if (!ride_id || !reviewed_id || rating === undefined || rating === null) {
      res.status(400).json({
        success: false,
        error: 'ride_id, reviewed_id ve rating alanları zorunludur.',
      });
      return;
    }

    // UUID format kontrolü
    if (!isValidUUID(ride_id)) {
      res.status(400).json({ success: false, error: 'ride_id geçerli bir UUID olmalıdır.' });
      return;
    }
    if (!isValidUUID(reviewed_id)) {
      res.status(400).json({ success: false, error: 'reviewed_id geçerli bir UUID olmalıdır.' });
      return;
    }

    // Puan: tam sayı ve 1-5 (JSON bazen string gönderir)
    const ratingNum =
      typeof rating === 'number' && Number.isInteger(rating)
        ? rating
        : typeof rating === 'string' && /^\d+$/.test(rating.trim())
          ? parseInt(rating.trim(), 10)
          : NaN;
    if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      res.status(400).json({
        success: false,
        error: 'Puan 1 ile 5 arasında tam sayı olmalıdır.',
      });
      return;
    }

    // Yorum uzunluğu kontrolü
    if (comment !== undefined && comment !== null) {
      if (typeof comment !== 'string' || comment.length > 500) {
        res.status(400).json({
          success: false,
          error: 'Yorum en fazla 500 karakter olabilir.',
        });
        return;
      }
    }

    // Yolculuğun var olduğunu ve tamamlandığını doğrula
    const { data: ride, error: rideError } = await supabaseAdmin
      .from('rides')
      .select('id, status, customer_id, driver_id')
      .eq('id', ride_id)
      .single();

    if (rideError || !ride) {
      res.status(404).json({ success: false, error: 'Yolculuk bulunamadı.' });
      return;
    }

    if (ride.status !== 'completed') {
      res.status(400).json({
        success: false,
        error: 'Sadece tamamlanmış yolculuklar değerlendirilebilir.',
      });
      return;
    }

    // Değerlendiren kişinin bu yolculuğa dahil olduğunu kontrol et
    if (ride.customer_id !== reviewerId && ride.driver_id !== reviewerId) {
      res.status(403).json({
        success: false,
        error: 'Bu yolculuğu değerlendirme yetkiniz yok.',
      });
      return;
    }

    const counterpartId =
      reviewerId === ride.customer_id ? ride.driver_id : ride.customer_id;
    if (!counterpartId || reviewed_id !== counterpartId) {
      res.status(400).json({
        success: false,
        error: 'reviewed_id yolculuktaki karşı tarafın kullanıcı kimliği olmalıdır.',
      });
      return;
    }

    // Mükerrer değerlendirme kontrolü
    const { data: existing } = await supabaseAdmin
      .from('reviews')
      .select('id')
      .eq('ride_id', ride_id)
      .eq('reviewer_id', reviewerId)
      .single();

    if (existing) {
      res.status(409).json({
        success: false,
        error: 'Bu yolculuk için zaten bir değerlendirme yaptınız.',
      });
      return;
    }

    // Değerlendirmeyi kaydet
    const { data, error } = await supabaseAdmin
      .from('reviews')
      .insert({
        ride_id,
        reviewer_id: reviewerId,
        reviewed_id,
        rating: ratingNum,
        comment: comment || null,
      })
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: 'Değerlendirme kaydedilemedi.' });
      return;
    }

    if (ratingNum <= 2) {
      const userIds = [reviewerId, reviewed_id];
      const { data: users } = await supabaseAdmin
        .from('users')
        .select('id, full_name, role')
        .in('id', userIds);
      const byId = new Map((users ?? []).map((u) => [u.id as string, u]));
      const reviewer = byId.get(reviewerId);
      const reviewed = byId.get(reviewed_id);
      void sendAdminLowRatingReviewPush({
        reviewId: data.id as string,
        rideId: ride_id,
        rating: ratingNum,
        reviewerName: String(reviewer?.full_name ?? 'Kullanıcı'),
        reviewerRole: (reviewer?.role as 'customer' | 'driver') ?? 'customer',
        reviewedName: String(reviewed?.full_name ?? 'Kullanıcı'),
        reviewedRole: (reviewed?.role as 'customer' | 'driver') ?? 'driver',
        comment: (comment as string | null) ?? null,
      }).catch((pushErr) => {
        logger.warn('[Review] Admin düşük puan bildirimi gönderilemedi:', pushErr);
      });
    }

    res.status(201).json({
      success: true,
      data,
      message: 'Değerlendirmeniz kaydedildi. Teşekkürler!',
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Değerlendirme sırasında hata oluştu.' });
  }
});

// Belirli bir kullanıcının değerlendirmelerini listele
router.get('/user/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    if (!isValidUUID(userId)) {
      res.status(400).json({ success: false, error: 'userId geçerli bir UUID olmalıdır.' });
      return;
    }

    const page = parseInt(req.query.page as string) || 1;
    const rawLimit = parseInt(req.query.limit as string) || 10;
    const limit = Math.min(rawLimit, 50); // en fazla 50 kayıt
    const offset = (page - 1) * limit;

    const { data, error, count } = await supabaseAdmin
      .from('reviews')
      .select('id, rating, comment, created_at, reviewer_id, users!reviewer_id(full_name)', { count: 'exact' })
      .eq('reviewed_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      res.status(500).json({ success: false, error: 'Değerlendirmeler alınamadı.' });
      return;
    }

    res.json({
      success: true,
      data: {
        items: data || [],
        total: count || 0,
        page,
        limit,
        totalPages: Math.ceil((count || 0) / limit),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Değerlendirmeler alınırken hata oluştu.' });
  }
});

// Belirli bir yolculuğun değerlendirmelerini getir
// Yetki: yalnızca yolculuğa dahil olan müşteri veya sürücü görebilir
router.get('/ride/:rideId', async (req: Request, res: Response) => {
  try {
    const { rideId } = req.params;
    const requesterId = req.user!.userId;

    if (!isValidUUID(rideId)) {
      res.status(400).json({ success: false, error: 'rideId geçerli bir UUID olmalıdır.' });
      return;
    }

    // Yolculuğun var olduğunu ve isteği yapanın dahil olduğunu doğrula
    const { data: ride, error: rideError } = await supabaseAdmin
      .from('rides')
      .select('customer_id, driver_id')
      .eq('id', rideId)
      .maybeSingle();

    if (rideError || !ride) {
      res.status(404).json({ success: false, error: 'Yolculuk bulunamadı.' });
      return;
    }

    if (ride.customer_id !== requesterId && ride.driver_id !== requesterId) {
      res.status(403).json({ success: false, error: 'Bu yolculuğun değerlendirmelerini görme yetkiniz yok.' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('reviews')
      .select('id, rating, comment, created_at, reviewer_id, reviewed_id')
      .eq('ride_id', rideId);

    if (error) {
      res.status(500).json({ success: false, error: 'Değerlendirmeler alınamadı.' });
      return;
    }

    res.json({ success: true, data: data || [] });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Değerlendirmeler alınırken hata oluştu.' });
  }
});

export { router as reviewRoutes };
