/**
 * Ride Controller
 * Yolculuk HTTP isteklerini karşılar.
 * Doğrulama ride.schema, iş mantığı ride.service tarafından yapılır.
 */

import { Request, Response, NextFunction } from 'express';
import * as rideService from './ride.service';
import { getPriceBreakdown, getTariffInfo } from './pricing.service';
import { calculateDistance, Coordinates } from '../../utils/distance';
import { AppError } from '../../middleware/error.middleware';
import { logger } from '../../utils/logger';
import { isValidUUIDv4 } from '../../utils/uuid';
import { notifyRideCancelledByFcm } from '../../services/push_notification.service';

/**
 * POST /api/v1/rides
 * Yeni yolculuk oluştur
 * Body: { pickup: {lat,lng}, dropoff: {lat,lng}, pickup_address, dropoff_address }
 */
export async function createRide(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      next(new AppError('Kimlik doğrulama gerekli.', 401));
      return;
    }

    const ride = await rideService.createRide(req.user.userId, req.body);

    res.status(201).json({
      success: true,
      message: 'Yolculuk oluşturuldu. Sürücü aranıyor...',
      data: ride,
    });
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
      return;
    }
    logger.error('Yolculuk oluşturma hatası:', error);
    next(new AppError('Yolculuk oluşturulamadı.', 500));
  }
}

/**
 * GET /api/v1/rides/:id
 * Yolculuk detayını getir
 */
export async function getRide(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      next(new AppError('Kimlik doğrulama gerekli.', 401));
      return;
    }

    if (!isValidUUIDv4(req.params.id)) {
      next(new AppError('Geçerli bir yolculuk UUID gerekli.', 400));
      return;
    }

    const ride = await rideService.getRideById(req.params.id, req.user.userId);

    res.json({ success: true, data: ride });
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
      return;
    }
    logger.error('Yolculuk detay hatası:', error);
    next(new AppError('Yolculuk bilgisi alınamadı.', 500));
  }
}

/**
 * GET /api/v1/rides
 * Yolculuk geçmişini listele (sayfalı)
 * Query: ?page=1&limit=10&status=completed
 */
export async function listRides(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      next(new AppError('Kimlik doğrulama gerekli.', 401));
      return;
    }

    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const rawLimit = parseInt(req.query.limit as string, 10) || 10;
    const limit = Math.min(100, Math.max(1, rawLimit));
    const statusRaw = req.query.status as string | undefined;

    const VALID_STATUSES = ['searching', 'accepted', 'arriving', 'in_progress', 'completed', 'cancelled'] as const;
    type RideStatus = typeof VALID_STATUSES[number];

    if (statusRaw !== undefined && !VALID_STATUSES.includes(statusRaw as RideStatus)) {
      next(new AppError(`Geçersiz status değeri. İzin verilenler: ${VALID_STATUSES.join(', ')}`, 400));
      return;
    }

    const status = statusRaw as RideStatus | undefined;

    const result = await rideService.listRides(
      req.user.userId,
      req.user.role,
      page,
      limit,
      status
    );

    res.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
      return;
    }
    logger.error('Yolculuk listesi hatası:', error);
    next(new AppError('Yolculuk listesi alınamadı.', 500));
  }
}

/**
 * GET /api/v1/rides/active
 * Aktif yolculuğu getir (uygulama açıldığında kontrol)
 */
export async function getActiveRide(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      next(new AppError('Kimlik doğrulama gerekli.', 401));
      return;
    }

    const ride = await rideService.getActiveRide(req.user.userId, req.user.role);

    res.json({
      success: true,
      data: ride,
      message: ride ? 'Aktif yolculuk bulundu.' : 'Aktif yolculuk yok.',
    });
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
      return;
    }
    logger.error('Aktif yolculuk hatası:', error);
    next(new AppError('Aktif yolculuk bilgisi alınamadı.', 500));
  }
}

/**
 * POST /api/v1/rides/:id/cancel
 * Yolculuğu iptal et
 * Body: { reason?: string }
 */
export async function cancelRide(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      next(new AppError('Kimlik doğrulama gerekli.', 401));
      return;
    }

    if (!isValidUUIDv4(req.params.id)) {
      next(new AppError('Geçerli bir yolculuk UUID gerekli.', 400));
      return;
    }

    const { reason } = req.body;

    const ride = await rideService.updateRideStatus(
      req.params.id,
      'cancelled',
      req.user.userId,
      { cancelReason: reason || 'Kullanıcı tarafından iptal edildi.' }
    );

    void notifyRideCancelledByFcm({
      rideId: req.params.id,
      customerId: String(ride.customer_id),
      driverId: ride.driver_id,
      scenario: req.user.role === 'customer' ? 'customer' : 'driver',
    }).catch((e: unknown) => logger.warn('[FCM] İptal push (REST):', e));

    res.json({
      success: true,
      message: 'Yolculuk iptal edildi.',
      data: ride,
    });
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
      return;
    }
    logger.error('Yolculuk iptal hatası:', error);
    next(new AppError('Yolculuk iptal edilemedi.', 500));
  }
}

/**
 * POST /api/v1/rides/estimate
 * Ücret tahmini al (yolculuk oluşturmadan önce)
 * Body: { pickup: {lat,lng}, dropoff: {lat,lng} }
 */
export async function estimatePrice(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { pickup, dropoff } = req.body;

    if (!pickup || !dropoff || !pickup.lat || !pickup.lng || !dropoff.lat || !dropoff.lng) {
      next(new AppError('Biniş ve iniş koordinatları gerekli.', 400));
      return;
    }

    // Mesafe hesapla (Haversine)
    const from: Coordinates = { lat: pickup.lat, lng: pickup.lng };
    const to: Coordinates = { lat: dropoff.lat, lng: dropoff.lng };
    const distanceKm = calculateDistance(from, to);

    // Ücret detaylarını hesapla
    const breakdown = getPriceBreakdown(distanceKm);

    res.json({
      success: true,
      data: {
        distance_km: distanceKm,
        ...breakdown,
        currency: 'TRY',
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
      return;
    }
    logger.error('Ücret tahmini hatası:', error);
    next(new AppError('Ücret tahmini hesaplanamadı.', 500));
  }
}

/**
 * GET /api/v1/rides/tariff
 * Tarife bilgilerini döndür (bilgilendirme amaçlı)
 */
export async function getTariff(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tariff = getTariffInfo();

    res.json({
      success: true,
      data: tariff,
    });
  } catch (error) {
    logger.error('Tarife bilgisi hatası:', error);
    next(new AppError('Tarife bilgisi alınamadı.', 500));
  }
}
