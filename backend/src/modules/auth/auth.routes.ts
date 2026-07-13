/**
 * Auth Route'ları
 * Kayıt, giriş, token yenileme ve çıkış endpoint'leri.
 *
 * POST /register          → Müşteri kaydı
 * POST /register/driver   → Sürücü kaydı
 * POST /login             → Giriş
 * POST /refresh           → Token yenileme
 * POST /logout            → Çıkış (JWT gerekli)
 * GET  /me                → Mevcut kullanıcı bilgisi (JWT gerekli)
 */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as authController from './auth.controller';
import { validate } from '../../middleware/validate.middleware';
import { authMiddleware, authMiddlewareLogout } from '../../middleware/auth.middleware';
import {
  registerSchema,
  driverRegisterSchema,
  loginSchema,
  refreshTokenSchema,
} from './auth.schema';

const router = Router();

// ============================================================
// OTA KİMLİK DOĞRULAMAYA ÖZEL RATE LIMITLER (brute-force koruması)
// Global limit'ten bağımsız — her IP için kısa pencerede düşük eşik.
// ============================================================

// Başarılı olmayan login denemeleri üzerinden sınırlandır.
const loginLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 dakika
  max: 10, // dakikada 10 başarısız login
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // 2xx başarılıları sayma → gerçek kullanıcıyı cezalandırma
  message: {
    success: false,
    error: 'Çok fazla giriş denemesi. Lütfen bir dakika bekleyin.',
  },
});

// Token yenileme — makul trafikte güvenlik sınırı
const refreshLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 dakika
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Çok fazla istek. Lütfen bir dakika bekleyin.',
  },
});

// Kayıt — IP başına saatlik limit (spam ve otomatik hesap açmaya karşı)
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 saat
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Çok fazla kayıt denemesi. Lütfen bir süre sonra tekrar deneyin.',
  },
});

// ============================================================
// PUBLIC ROUTE'LAR (JWT gerekmez)
// ============================================================

// Müşteri kaydı — Zod ile body doğrulaması yapıldıktan sonra controller'a yönlendirilir
router.post('/register', registerLimiter, validate(registerSchema), authController.register);

// Sürücü kaydı — araç bilgileri dahil doğrulama
router.post(
  '/register/driver',
  registerLimiter,
  validate(driverRegisterSchema),
  authController.registerDriver
);

// Giriş — telefon + şifre (brute-force koruması)
router.post('/login', loginLimiter, validate(loginSchema), authController.login);

// Token yenileme — refresh token ile yeni access token al
router.post('/refresh', refreshLimiter, validate(refreshTokenSchema), authController.refreshToken);

// ============================================================
// KORUNMUŞ ROUTE'LAR (JWT gerekli)
// ============================================================

// Çıkış — sadece geçerli oturumda DB güncellenir (eski cihaz token'ı ile de 200)
router.post('/logout', authMiddlewareLogout, authController.logout);

// Mevcut kullanıcı bilgisi — token'dan userId alınır
router.get('/me', authMiddleware, authController.getMe);

export { router as authRoutes };
