/**
 * Ortam Değişkenleri Yapılandırması
 * Zod ile tüm env değişkenleri doğrulanır ve tiplendirilir.
 * Eksik veya hatalı değişken varsa uygulama başlamaz.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import dotenv from 'dotenv';

/**
 * PM2 / systemd bazen `process.cwd()` proje kökü değil (ör. `/root`) olur;
 * `dotenv.config()` yalnızca cwd’de aradığı için `.env` okunmaz. Önce paket kökü
 * (`dist/config` veya `src/config` → iki üst = `backend/`), sonra cwd dene.
 */
function loadDotenv(): void {
  const explicit = process.env.DOTENV_CONFIG_PATH?.trim();
  const packageRootEnv = path.resolve(__dirname, '../../.env');
  const cwdEnv = path.join(process.cwd(), '.env');

  const candidates = [explicit, packageRootEnv, cwdEnv].filter(
    (p): p is string => typeof p === 'string' && p.length > 0,
  );

  for (const filePath of candidates) {
    if (existsSync(filePath)) {
      dotenv.config({ path: filePath });
      return;
    }
  }
  dotenv.config();
}

loadDotenv();

// Ortam değişkenleri şeması — her değişkenin tipi ve varsayılan değeri
const envSchema = z.object({
  // Sunucu ayarları
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),

  // Supabase bağlantı bilgileri
  SUPABASE_URL: z.string().url('Geçerli bir Supabase URL gerekli'),
  SUPABASE_ANON_KEY: z.string().min(1, 'Supabase Anon Key gerekli'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'Supabase Service Role Key gerekli'),

  // JWT token ayarları
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT Access Secret en az 32 karakter olmalı'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT Refresh Secret en az 32 karakter olmalı'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),

  // Redis bağlantı bilgileri
  REDIS_HOST: z.string().default('127.0.0.1'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().default(''),
  REDIS_DB: z.coerce.number().default(0),
  // TLS — Upstash vb. cloud Redis için 'true'. Yerel Redis için 'false'/boş.
  REDIS_TLS: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1' || v.toLowerCase() === 'yes'),

  // CORS izinli origin'ler (virgülle ayrılmış)
  CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:8080'),

  // Rate limiting ayarları
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(900000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(100),

  // Google Maps API key (opsiyonel)
  GOOGLE_MAPS_API_KEY: z.string().default(''),

  // Loglama seviyesi
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('debug'),

  // Uygulama içi admin yetkili telefonlar (virgülle ayrılmış E.164, örn: +905551112233)
  ADMIN_PHONES: z.string().default(''),

  /** Gerçek ödeme yok; sürücü cüzdanına T Coin yazar. Prod’da false önerilir. */
  WALLET_CARD_SIMULATION_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v === 'true' || v === '1' || v.toLowerCase() === 'yes'),

  /**
   * Firebase Admin JSON (HTTP v1) — tek satır string.
   * Boşsa yolculuk çağrısında yalnızca Socket.io kullanılır; push gönderilmez.
   */
  FCM_SERVICE_ACCOUNT_JSON: z.string().default(''),

  /** Admin GET /logs için stdout/out log dosyası (PM2 vb.); boşsa log endpoint’i satır dönmez */
  ADMIN_LOG_OUT_PATH: z.string().default(''),
  /** Admin GET /logs için stderr/error log dosyası */
  ADMIN_LOG_ERROR_PATH: z.string().default(''),

  /** DB'de searching kalan yolculuklar bu süreden eskiyse kurtarma job'ı iptal eder (dk). */
  STALE_SEARCHING_MINUTES: z.coerce.number().min(5).max(180).default(15),
})
  .refine(
    (d) =>
      d.NODE_ENV !== 'production' ||
      d.WALLET_CARD_SIMULATION_ENABLED === false,
    {
      path: ['WALLET_CARD_SIMULATION_ENABLED'],
      message:
        'NODE_ENV=production iken WALLET_CARD_SIMULATION_ENABLED=false olmalıdır (kart simülasyonu canlıda kapalı).',
    },
  )
  .refine(
    (d) =>
      d.NODE_ENV !== 'production' ||
      d.ADMIN_PHONES.split(',').some((p) => p.trim().length >= 8),
    {
      path: ['ADMIN_PHONES'],
      message:
        'NODE_ENV=production iken ADMIN_PHONES içinde en az bir geçerli telefon (E.164) tanımlanmalıdır.',
    },
  )
  .refine(
    (d) =>
      d.NODE_ENV !== 'production' || d.JWT_ACCESS_SECRET !== d.JWT_REFRESH_SECRET,
    {
      path: ['JWT_REFRESH_SECRET'],
      message: 'NODE_ENV=production iken JWT_ACCESS_SECRET ile JWT_REFRESH_SECRET farklı olmalıdır.',
    },
  );

// Env doğrulama sonucu tipi
export type EnvConfig = z.infer<typeof envSchema>;

// Env değişkenlerini doğrula ve dışa aktar
function validateEnv(): EnvConfig {
  try {
    const parsed = envSchema.parse(process.env);
    return parsed;
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      const missingVars = error.errors
        .map((e) => `  ❌ ${e.path.join('.')}: ${e.message}`)
        .join('\n');
      console.error(`\n🚫 Ortam değişkenleri doğrulama hatası:\n${missingVars}\n`);
      console.error(
        '💡 Sunucuda `backend/.env` dosyası olmalı (PM2 cwd farklı olsa da okunur). ' +
          'Yoksa `.env.example` → `.env` kopyalayıp doldurun; isteğe bağlı `DOTENV_CONFIG_PATH=/tam/yol/.env`.\n',
      );
    }
    process.exit(1);
  }
}

// Doğrulanmış ortam değişkenleri — tüm modüller bu nesneyi kullanır
export const env = validateEnv();
