/**
 * Merkezi Hata Yönetimi Middleware
 * Tüm yakalanmayan hataları yakalar ve standart formatta yanıt döner.
 * Express'te 4 parametreli middleware hata yakalayıcı olarak çalışır.
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { env } from '../config/env';

// Özel hata sınıfı — HTTP durum kodu ve mesaj taşır
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: number = 500, isOperational: boolean = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

// Sık kullanılan hata fabrikaları
export const Errors = {
  notFound: (resource: string) =>
    new AppError(`${resource} bulunamadı.`, 404),

  unauthorized: (message: string = 'Yetkilendirme gerekli.') =>
    new AppError(message, 401),

  forbidden: (message: string = 'Bu işlem için yetkiniz yok.') =>
    new AppError(message, 403),

  badRequest: (message: string) =>
    new AppError(message, 400),

  conflict: (message: string) =>
    new AppError(message, 409),

  internal: (message: string = 'Sunucu hatası oluştu.') =>
    new AppError(message, 500, false),
};

/**
 * 404 yakalayıcı — tanımsız route'lar için
 */
export function notFoundHandler(req: Request, res: Response, _next: NextFunction): void {
  res.status(404).json({
    success: false,
    error: `İstenen yol bulunamadı: ${req.method} ${req.originalUrl}`,
  });
}

/**
 * Merkezi hata yakalayıcı middleware
 * Express'te hata middleware'i 4 parametre almalıdır
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  // Error olmayan throw'lara (string, obje vb.) karşı normalize et
  const normalized: Error | AppError =
    err instanceof Error ? err : new AppError(typeof err === 'string' ? err : 'Beklenmeyen bir hata oluştu.', 500, false);

  // AppError ise durum kodunu kullan, değilse 500
  const statusCode = normalized instanceof AppError ? normalized.statusCode : 500;
  const isOperational = normalized instanceof AppError ? normalized.isOperational : false;

  // Operasyonel olmayan hatalar (beklenmeyen) logla
  if (!isOperational) {
    logger.error('Beklenmeyen hata:', {
      message: normalized.message,
      stack: normalized.stack,
    });
  } else {
    // Operasyonel hatalar debug seviyesinde logla
    logger.debug(`Operasyonel hata [${statusCode}]: ${normalized.message}`);
  }

  // Yanıt zaten gönderilmişse (akış ortasında hata) çift yanıt verme — Express'e devret
  if (res.headersSent) {
    next(normalized);
    return;
  }

  // Yanıt gövdesi
  const response: Record<string, unknown> = {
    success: false,
    error: normalized.message || 'Beklenmeyen bir hata oluştu.',
  };

  // Geliştirme ortamında stack trace ekle
  if (env.NODE_ENV === 'development') {
    response.stack = normalized.stack;
  }

  res.status(statusCode).json(response);
}
