/**
 * Ride Route'ları
 * Yolculuk CRUD, ücret tahmini ve durum yönetimi.
 *
 * POST   /              → Yolculuk oluştur (müşteri)
 * GET    /              → Yolculuk geçmişi (sayfalı)
 * GET    /active        → Aktif yolculuğu getir
 * GET    /tariff        → Tarife bilgisi (public)
 * POST   /estimate      → Ücret tahmini (public)
 * GET    /:id           → Yolculuk detayı
 * POST   /:id/cancel    → Yolculuk iptal
 */

import { Router } from 'express';
import * as rideController from './ride.controller';
import { authMiddleware } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import { createRideSchema, estimatePriceSchema, cancelRideSchema } from './ride.schema';

const router = Router();

// ============================================================
// PUBLIC ROUTE'LAR (JWT gerekmez)
// ============================================================

// Tarife bilgisi — açılış ücreti, km başı ücret vb.
router.get('/tariff', rideController.getTariff);

// Ücret tahmini — koordinatlara göre fiyat hesapla
router.post('/estimate', validate(estimatePriceSchema), rideController.estimatePrice);

// ============================================================
// KORUNMUŞ ROUTE'LAR (JWT gerekli)
// ============================================================

router.use(authMiddleware);

// Yolculuk oluştur — müşteri biniş/iniş noktası belirler
router.post('/', validate(createRideSchema), rideController.createRide);

// Yolculuk geçmişi — kullanıcının tüm yolculukları (sayfalı)
router.get('/', rideController.listRides);

// Aktif yolculuğu getir — uygulama açıldığında kontrol
router.get('/active', rideController.getActiveRide);

// Yolculuk detayı — belirli bir yolculuğun bilgileri
router.get('/:id', rideController.getRide);

// Yolculuk iptal — müşteri veya sürücü tarafından
router.post('/:id/cancel', validate(cancelRideSchema), rideController.cancelRide);

export { router as rideRoutes };
