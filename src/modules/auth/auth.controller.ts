/**
 * Auth Controller
 * HTTP isteklerini karşılar, doğrulamayı schema yapar,
 * iş mantığını auth.service'e devreder.
 */

import { Request, Response, NextFunction } from 'express';
import * as authService from './auth.service';
import { AppError } from '../../middleware/error.middleware';
import { logger } from '../../utils/logger';

/**
 * POST /api/v1/auth/register
 * Yeni müşteri kaydı
 * Body: { phone, full_name, password }
 */
export async function register(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await authService.registerCustomer(req.body);

    res.status(201).json({
      success: true,
      message: 'Kayıt başarılı. Hoş geldiniz!',
      data: {
        user: result.user,
        tokens: {
          access_token: result.accessToken,
          refresh_token: result.refreshToken,
        },
      },
    });
  } catch (error) {
    // AppError ise doğrudan next'e gönder (merkezi hata yakalayıcı işleyecek)
    if (error instanceof AppError) {
      next(error);
      return;
    }
    logger.error('Müşteri kaydı hatası:', error);
    next(new AppError('Kayıt sırasında beklenmeyen bir hata oluştu.', 500));
  }
}

/**
 * POST /api/v1/auth/login
 * Giriş — telefon + şifre ile kimlik doğrulama
 * Body: { phone, password }
 */
export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await authService.login(req.body);

    res.json({
      success: true,
      message: 'Giriş başarılı.',
      data: {
        user: result.user,
        tokens: {
          access_token: result.accessToken,
          refresh_token: result.refreshToken,
        },
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
      return;
    }
    logger.error('Giriş hatası:', error);
    next(new AppError('Giriş sırasında beklenmeyen bir hata oluştu.', 500));
  }
}

/**
 * POST /api/v1/auth/refresh
 * Access token yenileme
 * Body: { refresh_token }
 */
export async function refreshToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      next(new AppError('Refresh token gerekli.', 400));
      return;
    }

    const result = await authService.refreshTokens(refresh_token);

    res.json({
      success: true,
      message: 'Token yenilendi.',
      data: {
        user: result.user,
        tokens: {
          access_token: result.accessToken,
          refresh_token: result.refreshToken,
        },
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
      return;
    }
    logger.error('Token yenileme hatası:', error);
    next(new AppError('Token yenileme sırasında bir hata oluştu.', 500));
  }
}

/**
 * POST /api/v1/auth/logout
 * Çıkış — refresh token'ı geçersiz kılar
 * Header: Authorization: Bearer <access_token>
 */
export async function logout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // authMiddleware'den gelen kullanıcı bilgisi
    if (!req.user) {
      next(new AppError('Kimlik doğrulama gerekli.', 401));
      return;
    }

    await authService.logout(req.user.userId, req.user.sessionVersion ?? 0);

    res.json({
      success: true,
      message: 'Çıkış başarılı.',
    });
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
      return;
    }
    logger.error('Çıkış hatası:', error);
    next(new AppError('Çıkış sırasında bir hata oluştu.', 500));
  }
}

/**
 * GET /api/v1/auth/me
 * Mevcut oturumdaki kullanıcı bilgilerini döner
 * Header: Authorization: Bearer <access_token>
 */
export async function getMe(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      next(new AppError('Kimlik doğrulama gerekli.', 401));
      return;
    }

    // Supabase'den güncel kullanıcı bilgilerini çek
    const { supabaseAdmin } = await import('../../config/supabase');

    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('id, phone, full_name, avatar_url, role, rating, rating_count, created_at')
      .eq('id', req.user.userId)
      .single();

    if (error || !user) {
      next(new AppError('Kullanıcı bulunamadı.', 404));
      return;
    }

    // Sürücü ise araç bilgilerini de getir
    let driverInfo = null;
    if (user.role === 'driver') {
      const { data: driver } = await supabaseAdmin
        .from('drivers')
        .select('vehicle_plate, vehicle_model, vehicle_color, is_online, is_available, total_rides, balance')
        .eq('id', user.id)
        .single();

      driverInfo = driver;
    }

    const completedRidesFromRides = await authService.countCompletedRides(
      user.id,
      user.role as 'customer' | 'driver',
    );

    // Değerlendirme özeti: reviews tablosundan doğrudan hesapla (users.rating stale kalabilir)
    let rating = Number(user.rating ?? 0);
    let ratingCount = Number(user.rating_count ?? 0);
    try {
      const { data: reviewRows, error: reviewErr } = await supabaseAdmin
        .from('reviews')
        .select('rating')
        .eq('reviewed_id', user.id);
      if (!reviewErr && reviewRows != null) {
        const count = reviewRows.length;
        if (count > 0) {
          const sum = reviewRows.reduce(
            (acc, r) => acc + Number((r as { rating?: number }).rating ?? 0),
            0,
          );
          ratingCount = count;
          rating = sum / count;
        } else {
          ratingCount = 0;
          rating = 0;
        }
      }
    } catch {
      // reviews sorgusu başarısız olursa users tablosundaki mevcut değerlerle devam et
    }

    // Yolculuk sayısı: rides count ana kaynak, drivers.total_rides güvenli fallback
    const completedRides =
      user.role === 'driver'
        ? Math.max(
            completedRidesFromRides,
            Number((driverInfo as { total_rides?: number } | null)?.total_rides ?? 0),
          )
        : completedRidesFromRides;

    // Sürücü için kabul/red oranı (driver_request_log). Tablo yoksa alanlar null kalır.
    let acceptanceRate: number | null = null;
    let rejectionRate: number | null = null;
    let rejectedPer100: number | null = null;
    if (user.role === 'driver') {
      try {
        const { data: reqRows, error: reqErr } = await supabaseAdmin
          .from('driver_request_log')
          .select('accepted')
          .eq('driver_id', user.id)
          .order('created_at', { ascending: false })
          .limit(100);
        if (!reqErr && reqRows != null && reqRows.length > 0) {
          const normalized = reqRows
            .map((r) => (r as { accepted?: unknown }).accepted)
            .filter((v): v is boolean => v === true || v === false);
          const total = normalized.length;
          if (total > 0) {
            const accepted = normalized.filter((v) => v === true).length;
            const rejected = normalized.filter((v) => v === false).length;
            acceptanceRate = accepted / total;
            rejectionRate = rejected / total;
            rejectedPer100 = Math.round((rejected / total) * 100);
          } else {
            acceptanceRate = 0;
            rejectionRate = 0;
            rejectedPer100 = 0;
          }
        }
      } catch {
        // Optional veri; hata durumunda sessizce null bırak.
      }
    }

    res.json({
      success: true,
      data: {
        user: {
          ...user,
          is_admin: authService.isAdminPhone(user.phone),
          rating,
          rating_count: ratingCount,
          completed_rides: completedRides,
          acceptance_rate: acceptanceRate,
          rejection_rate: rejectionRate,
          rejected_per_100: rejectedPer100,
        },
        driver: driverInfo,
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
      return;
    }
    logger.error('Profil bilgisi hatası:', error);
    next(new AppError('Profil bilgileri alınırken bir hata oluştu.', 500));
  }
}
