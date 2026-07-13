/**
 * Loglama Servisi
 * Winston ile yapılandırılmış merkezi loglama.
 * Geliştirme: renkli konsol çıktısı
 * Üretim: JSON formatında dosya ve konsol
 */

import winston from 'winston';
import { env } from '../config/env';

// `env` importu dotenv'i (config/env.ts içinde) senkron olarak yükler — bu yüzden
// process.env yerine doğrulanmış `env` nesnesi kullanılır. Doğrudan process.env.NODE_ENV
// okunursa, bu modül .env henüz yüklenmeden import edildiğinde (import sırasına bağlı
// olarak) production'da bile yanlışlıkla renkli/dev formatı seçilebiliyordu — üretim log
// dosyalarına ANSI kaçış kodları (garip karakterler) yazılmasına yol açıyordu.
const logLevel = env.LOG_LEVEL;
const isProduction = env.NODE_ENV === 'production';

// Özel log formatı — zaman damgası + seviye + mesaj
const customFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf((info) => {
    const { timestamp, level, message, stack, ...meta } = info;
    // Hata stack trace varsa ekle
    const stackTrace = stack ? `\n${stack}` : '';
    // Ek meta verisi varsa JSON olarak ekle
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] ${level.toUpperCase()}: ${message}${metaStr}${stackTrace}`;
  })
);

// Renkli konsol formatı (geliştirme ortamı için)
const consoleFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf((info) => {
    const { timestamp, level, message, stack } = info;
    const stackTrace = stack ? `\n${stack}` : '';
    return `[${timestamp}] ${level}: ${message}${stackTrace}`;
  })
);

// Transport'lar (log çıkış noktaları)
const transports: winston.transport[] = [];

if (isProduction) {
  // Üretim: JSON formatında dosya + düz konsol
  transports.push(
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 5242880,
      maxFiles: 5,
    }),
    new winston.transports.Console({ format: customFormat })
  );
} else {
  // Geliştirme: renkli konsol
  transports.push(
    new winston.transports.Console({ format: consoleFormat })
  );
}

// Winston logger örneği
export const logger = winston.createLogger({
  level: logLevel,
  format: customFormat,
  transports,
  // Yakalanmayan hatalar için
  exceptionHandlers: isProduction
    ? [new winston.transports.File({ filename: 'logs/exceptions.log' })]
    : undefined,
});
