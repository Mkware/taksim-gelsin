/**
 * Auth Route'ları
 * Kayıt, giriş, token yenileme ve çıkış endpoint'leri.
 *
 * POST /register          → Müşteri kaydı
 * POST /login             → Giriş
 * POST /refresh           → Token yenileme
 * POST /logout            → Çıkış (JWT gerekli)
 * GET  /me                → Mevcut kullanıcı bilgisi (JWT gerekli)
 *
 * Not: sürücü kaydı artık burada yok — sürücüler admin panelinden manuel eklenir
 * (`POST /api/v1/admin/drivers`, bkz. `admin_drivers.service.ts`). Genel kullanıma
 * açık bir sürücü kayıt endpoint'i, "manuel ekleme" politikasını atlayabileceği için kaldırıldı.
 */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as authController from './auth.controller';
import { validate } from '../../middleware/validate.middleware';
import { authMiddleware, authMiddlewareLogout } from '../../middleware/auth.middleware';
import {
  registerSchema,
  loginSchema,
  refreshTokenSchema,
  otpRequestSchema,
  otpVerifySchema,
  otpCompleteSchema,
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

// OTP isteği — aynı IP'den SMS spam'ine karşı sıkı limit
const otpRequestLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 dakika
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Çok fazla kod isteği. Lütfen bir dakika bekleyin.',
  },
});

// OTP doğrulama — 4 haneli kodun brute-force ile denenmesine karşı sıkı limit
const otpVerifyLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 dakika
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    success: false,
    error: 'Çok fazla deneme. Lütfen bir dakika bekleyin.',
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

// Giriş — telefon + şifre (brute-force koruması)
router.post('/login', loginLimiter, validate(loginSchema), authController.login);

// SMS OTP ile birleşik giriş/kayıt — istek + doğrulama + (yeni hesapsa) tamamlama
// (bkz. auth.service.ts TEMP_OTP_CODE notu)
router.post('/otp/request', otpRequestLimiter, validate(otpRequestSchema), authController.requestOtp);
router.post('/otp/verify', otpVerifyLimiter, validate(otpVerifySchema), authController.verifyOtp);
router.post(
  '/otp/complete',
  otpVerifyLimiter,
  validate(otpCompleteSchema),
  authController.completeOtpRegistration,
);

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
