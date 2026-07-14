/**
 * JWT Token Yardımcıları
 * Access token (15dk) ve Refresh token (30gün) üretimi ve doğrulaması.
 */

import { createHash } from 'node:crypto';
import jwt, { JwtPayload, SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';

// Token payload'ında taşınan kullanıcı bilgileri
export interface TokenPayload {
  userId: string;
  role: 'customer' | 'driver';
  /** DB users.session_version ile eşleşmeli; yeni girişte artar */
  sessionVersion: number;
}

// Doğrulama sonucu
export interface VerifyResult {
  valid: boolean;
  payload?: TokenPayload;
  error?: string;
}

/**
 * Access token üretir (kısa ömürlü — 15dk)
 * API isteklerinde Authorization header'ında gönderilir
 */
export function generateAccessToken(payload: TokenPayload): string {
  const options = {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
    issuer: 'taksim-gelsin',
    subject: payload.userId,
  } as SignOptions;
  return jwt.sign(
    {
      userId: payload.userId,
      role: payload.role,
      sessionVersion: payload.sessionVersion,
    },
    env.JWT_ACCESS_SECRET,
    options
  );
}

/**
 * Refresh token üretir (uzun ömürlü — 30 gün)
 * Access token yenilemek için kullanılır, veritabanında saklanır
 */
export function generateRefreshToken(payload: TokenPayload): string {
  const options = {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN,
    issuer: 'taksim-gelsin',
    subject: payload.userId,
  } as SignOptions;
  return jwt.sign(
    {
      userId: payload.userId,
      role: payload.role,
      sessionVersion: payload.sessionVersion,
    },
    env.JWT_REFRESH_SECRET,
    options
  );
}

/**
 * Access token doğrular
 * Başarılıysa payload döner, başarısızsa hata mesajı
 */
export function verifyAccessToken(token: string): VerifyResult {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      issuer: 'taksim-gelsin',
    }) as JwtPayload & TokenPayload;

    const raw = decoded as Record<string, unknown>;
    const sv = raw.sessionVersion;
    const sessionVersion = typeof sv === 'number' ? sv : 0;

    return {
      valid: true,
      payload: {
        userId: decoded.userId as string,
        role: decoded.role as 'customer' | 'driver',
        sessionVersion,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Token doğrulama hatası';
    return { valid: false, error: message };
  }
}

/**
 * Refresh token doğrular
 * Token yenileme endpoint'inde kullanılır
 */
export function verifyRefreshToken(token: string): VerifyResult {
  try {
    const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET, {
      issuer: 'taksim-gelsin',
    }) as JwtPayload & TokenPayload;

    const raw = decoded as Record<string, unknown>;
    const sv = raw.sessionVersion;
    const sessionVersion = typeof sv === 'number' ? sv : 0;

    return {
      valid: true,
      payload: {
        userId: decoded.userId as string,
        role: decoded.role as 'customer' | 'driver',
        sessionVersion,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Token doğrulama hatası';
    return { valid: false, error: message };
  }
}

/**
 * Refresh token'ı DB'de saklamadan önce hash'ler (SHA-256, hex).
 * Token zaten yüksek entropili bir JWT olduğundan tuzlamaya gerek yok;
 * amaç DB dump'ında token'ın düz metin çalınmasını önlemek. Deterministik
 * olması gerekiyor çünkü refreshTokens() gelen token'ın hash'ini DB'deki
 * değerle birebir karşılaştırıyor (rotation güvenliği).
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Her iki token'ı aynı anda üretir (login/register sonrası)
 */
export function generateTokenPair(payload: TokenPayload): {
  accessToken: string;
  refreshToken: string;
} {
  return {
    accessToken: generateAccessToken(payload),
    refreshToken: generateRefreshToken(payload),
  };
}
