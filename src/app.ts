/**
 * Express Uygulama Kurulumu
 * Tüm middleware'ler, route'lar ve hata yönetimi burada yapılandırılır.
 * Socket.io server.ts'de ayrıca kurulur.
 */

// Express 4 async boşluğunu kapatır: async route handler'larında fırlatılan/redde uğrayan
// hatalar otomatik olarak global errorHandler'a iletilir (try/catch unutulsa bile süreç
// çökmeden tutarlı 500 döner). Diğer importlardan ÖNCE yüklenmelidir.
// Harici paket yerine yerel yama (üretimde MODULE_NOT_FOUND riskini ortadan kaldırır).
import './utils/patch_async_errors';
import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { env } from './config/env';
import { redis } from './config/redis';
import { supabaseAdmin } from './config/supabase';
import { logger } from './utils/logger';
import { notFoundHandler, errorHandler } from './middleware/error.middleware';
import { authRoutes } from './modules/auth/auth.routes';
import { userRoutes } from './modules/user/user.routes';
import { driverRoutes } from './modules/driver/driver.routes';
import { rideRoutes } from './modules/ride/ride.routes';
import { reviewRoutes } from './modules/review/review.routes';
import { adminRoutes } from './modules/admin/admin.routes';
import { configRoutes } from './modules/config/config.routes';

// Express uygulaması oluştur
const app: Application = express();

// Reverse proxy / load balancer arkasındaysak gerçek IP için X-Forwarded-For
// (rate-limit'in gerçek IP görmesi ve CORS/log doğruluğu için zorunlu)
app.set('trust proxy', 1);

// ============================================================
// GÜVENLİK MIDDLEWARE'LERİ
// ============================================================

// Helmet: HTTP güvenlik header'ları (XSS, clickjacking koruması vb.)
app.use(
  helmet()
);

// CORS: Sadece izinli origin'lerden gelen isteklere izin ver
const allowedOrigins = env.CORS_ORIGINS.split(',').map((o) => o.trim());
app.use(
  cors({
    origin: (origin, callback) => {
      // Origin yoksa (curl, Postman vb.) veya izinli listede ise izin ver
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: ${origin} origin'ine izin verilmiyor.`));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Rate Limiting: Belirli sürede maksimum istek sayısını sınırla
// NOT: /health hariç (monitoring için), auth endpoint'lerinde ayrı/sıkı limit var.
const limiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS, // 15 dakika
  max: env.RATE_LIMIT_MAX_REQUESTS,    // Pencere başına maksimum istek
  message: {
    success: false,
    error: 'Çok fazla istek gönderdiniz. Lütfen biraz bekleyin.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) =>
    req.path === '/health' ||
    req.path === '/health/ready' ||
    req.path.startsWith('/api/v1/admin'),
});
app.use(limiter);

// ============================================================
// PARSER MIDDLEWARE'LERİ
// ============================================================

// JSON body parser (max 10MB)
app.use(express.json({ limit: '10mb' }));
// URL-encoded body parser
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ============================================================
// LOGLAMA
// ============================================================

// Morgan: HTTP istek loglaması (Winston stream'ine yönlendirilir)
const morganStream = {
  write: (message: string) => {
    logger.info(message.trim());
  },
};
app.use(morgan('short', { stream: morganStream }));

// ============================================================
// SAĞLIK KONTROLÜ
// ============================================================

// Sunucunun çalışır durumda olduğunu doğrulayan endpoint
app.get('/health', (_req, res) => {
  res.json({
    success: true,
    data: {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: env.NODE_ENV,
    },
  });
});

// Load balancer / orchestrator readiness: Redis + veritabanı ping
app.get('/health/ready', async (_req, res) => {
  try {
    const pong = await redis.ping();
    if (pong !== 'PONG') {
      res.status(503).json({ success: false, error: 'Redis yanıt vermedi.', data: { redis: 'fail' } });
      return;
    }
    const { error } = await supabaseAdmin.from('users').select('id').limit(1);
    if (error) {
      logger.warn('/health/ready Supabase:', error.message);
      res.status(503).json({
        success: false,
        error: 'Veritabanına erişilemiyor.',
        data: { redis: 'ok', database: 'fail' },
      });
      return;
    }
    res.json({
      success: true,
      data: {
        status: 'ready',
        redis: 'ok',
        database: 'ok',
        timestamp: new Date().toISOString(),
      },
    });
  } catch (e) {
    logger.error('/health/ready hata:', e);
    res.status(503).json({ success: false, error: 'Hazırlık kontrolü başarısız.', data: { redis: 'error' } });
  }
});

// ============================================================
// API ROUTE'LARI
// ============================================================

const API_PREFIX = '/api/v1';

app.use(`${API_PREFIX}/config`, configRoutes);
app.use(`${API_PREFIX}/auth`, authRoutes);
app.use(`${API_PREFIX}/users`, userRoutes);
app.use(`${API_PREFIX}/drivers`, driverRoutes);
app.use(`${API_PREFIX}/rides`, rideRoutes);
app.use(`${API_PREFIX}/reviews`, reviewRoutes);
app.use(`${API_PREFIX}/admin`, adminRoutes);

// ============================================================
// HATA YÖNETİMİ
// ============================================================

// 404 — tanımsız route'lar
app.use(notFoundHandler);
// Merkezi hata yakalayıcı (en sona konmalı)
app.use(errorHandler);

export { app };
