/**
 * JWT Kimlik Doğrulama Middleware
 * Her korumalı endpoint'ten önce çalışır.
 * Authorization header'daki Bearer token'ı doğrular.
 * Başarılıysa req.user'a kullanıcı bilgilerini ekler.
 */

import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/jwt';
import { AuthenticatedUser } from '../types';
import { supabaseAdmin } from '../config/supabase';
import { redis } from '../config/redis';
import { logger } from '../utils/logger';

// Oturum + askıya alma cache — geçerli olduğu sürece DB'ye gitmeyiz
const AUTH_GATE_KEY = 'auth:gate:';
const SESSION_VERSION_TTL_SEC = 60;

export interface UserAuthGate {
  sessionVersion: number;
  isSuspended: boolean;
}

/**
 * Kullanıcının güncel session_version ve is_suspended değerlerini cache'li getirir.
 */
export async function getUserAuthGate(userId: string): Promise<UserAuthGate | null> {
  try {
    const cached = await redis.get(`${AUTH_GATE_KEY}${userId}`);
    if (cached !== null) {
      const parts = cached.split(':');
      const sv = Number(parts[0]);
      if (Number.isFinite(sv)) {
        return { sessionVersion: sv, isSuspended: parts[1] === '1' };
      }
    }
  } catch (e) {
    logger.debug('auth gate cache okunamadı:', e);
  }

  const { data, error } = await supabaseAdmin
    .from('users')
    .select('session_version, is_suspended')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    logger.warn(`auth gate DB okunamadı [${userId}]:`, error);
    return null;
  }
  if (!data) return null;

  const sessionVersion = (data.session_version as number | null) ?? 0;
  const isSuspended = Boolean(data.is_suspended);
  try {
    await redis.set(
      `${AUTH_GATE_KEY}${userId}`,
      `${sessionVersion}:${isSuspended ? 1 : 0}`,
      'EX',
      SESSION_VERSION_TTL_SEC,
    );
  } catch (e) {
    logger.debug('auth gate cache yazılamadı:', e);
  }
  return { sessionVersion, isSuspended };
}

/**
 * Login / logout / refresh / admin müdahale — cache invalidation.
 */
export async function invalidateSessionVersionCache(userId: string): Promise<void> {
  try {
    await redis.del(`${AUTH_GATE_KEY}${userId}`);
  } catch (e) {
    logger.debug('auth gate cache silinemedi:', e);
  }
}

// Express Request tipine user alanı ekleme
declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

/**
 * JWT token doğrulama middleware'i
 * Authorization: Bearer <token> formatını bekler
 */
export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Authorization header'ını al
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        error: 'Yetkilendirme token\'ı bulunamadı. Authorization: Bearer <token> formatında gönderin.',
      });
      return;
    }

    // Token'ı ayıkla ("Bearer " kısmını çıkar)
    const token = authHeader.split(' ')[1];

    if (!token) {
      res.status(401).json({
        success: false,
        error: 'Token formatı hatalı.',
      });
      return;
    }

    // Token'ı doğrula
    const result = verifyAccessToken(token);

    if (!result.valid || !result.payload) {
      res.status(401).json({
        success: false,
        error: result.error || 'Geçersiz veya süresi dolmuş token.',
      });
      return;
    }

    const gate = await getUserAuthGate(result.payload.userId);
    if (gate === null) {
      res.status(401).json({
        success: false,
        error: 'Kullanıcı bulunamadı.',
      });
      return;
    }
    if (gate.isSuspended) {
      res.status(403).json({
        success: false,
        error: 'Hesabınız askıya alınmış. Destek ile iletişime geçin.',
        code: 'ACCOUNT_SUSPENDED',
      });
      return;
    }
    const jwtSv = result.payload.sessionVersion ?? 0;
    if (jwtSv !== gate.sessionVersion) {
      res.status(401).json({
        success: false,
        error: 'Hesabınıza başka bir cihazdan giriş yapıldı. Lütfen tekrar giriş yapın.',
        code: 'SESSION_REPLACED',
      });
      return;
    }

    // Doğrulanmış kullanıcı bilgilerini request'e ekle
    req.user = {
      userId: result.payload.userId,
      role: result.payload.role,
      sessionVersion: result.payload.sessionVersion ?? 0,
    };

    next();
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Kimlik doğrulama sırasında bir hata oluştu.',
    });
  }
}

/**
 * Çıkış endpoint'i için: JWT imzası geçerli olması yeterli (session_version DB ile
 * uyuşmayabilir — başka cihaz giriş yapmış eski cihaz güvenli şekilde yerel çıkış yapabilsin).
 * Geçersiz oturumda DB'ye dokunulmaz (aktif cihazın oturumu silinmez).
 */
export async function authMiddlewareLogout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        error: 'Yetkilendirme token\'ı bulunamadı.',
      });
      return;
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
      res.status(401).json({
        success: false,
        error: 'Token formatı hatalı.',
      });
      return;
    }

    const result = verifyAccessToken(token);

    if (!result.valid || !result.payload) {
      res.status(401).json({
        success: false,
        error: result.error || 'Geçersiz veya süresi dolmuş token.',
      });
      return;
    }

    req.user = {
      userId: result.payload.userId,
      role: result.payload.role,
      sessionVersion: result.payload.sessionVersion ?? 0,
    };

    next();
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Kimlik doğrulama sırasında bir hata oluştu.',
    });
  }
}
