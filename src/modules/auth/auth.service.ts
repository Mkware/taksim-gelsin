/**
 * Auth Servis Katmanı
 * Kayıt, giriş, token yenileme ve çıkış iş mantığı.
 * Controller bu servisi çağırır, servis veritabanı ve JWT işlemlerini yapar.
 */

import bcrypt from 'bcryptjs';
import { supabaseAdmin } from '../../config/supabase';
import { generateTokenPair, verifyRefreshToken, hashRefreshToken, TokenPayload } from '../../utils/jwt';
import { logger } from '../../utils/logger';
import { AppError } from '../../middleware/error.middleware';
import { disconnectSocketsForUser, disconnectStaleSocketsForUser } from '../../sockets/socket.manager';
import { invalidateSessionVersionCache } from '../../middleware/auth.middleware';
import { env } from '../../config/env';
import type { RegisterInput, DriverRegisterInput, LoginInput } from './auth.schema';

// Bcrypt salt round sayısı — şifre hash gücü (12 önerilen)
const SALT_ROUNDS = 12;

/**
 * Tamamlanan yolculuk sayısı (müşteri: customer_id, sürücü: driver_id = users.id)
 */
export async function countCompletedRides(userId: string, role: 'customer' | 'driver'): Promise<number> {
  const col = role === 'driver' ? 'driver_id' : 'customer_id';
  const { count, error } = await supabaseAdmin
    .from('rides')
    .select('id', { count: 'exact', head: true })
    .eq(col, userId)
    .eq('status', 'completed');

  if (error) {
    logger.warn('countCompletedRides:', error.message);
    return 0;
  }
  return count ?? 0;
}

/** JWT ile dönen kullanıcı özeti (mobil profil ile uyumlu) */
export interface AuthUserPayload {
  id: string;
  phone: string;
  full_name: string;
  role: 'customer' | 'driver';
  rating: number;
  rating_count: number;
  created_at?: string | null;
  avatar_url?: string | null;
  completed_rides: number;
  is_admin: boolean;
}

const adminPhoneSet = new Set(
  env.ADMIN_PHONES
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map(normalizePhone),
);

function normalizePhone(phone: string): string {
  return phone.replace(/\s+/g, '');
}

export function isAdminPhone(phone: string | null | undefined): boolean {
  if (!phone) return false;
  return adminPhoneSet.has(normalizePhone(phone));
}

function mapUserRowToAuthPayload(
  row: Record<string, unknown>,
  completedRides: number,
): AuthUserPayload {
  return {
    id: row.id as string,
    phone: row.phone as string,
    full_name: row.full_name as string,
    role: row.role as 'customer' | 'driver',
    rating: Number(row.rating ?? 5),
    rating_count: Number(row.rating_count ?? 0),
    created_at: (row.created_at as string | null | undefined) ?? null,
    avatar_url: (row.avatar_url as string | null | undefined) ?? null,
    completed_rides: completedRides,
    is_admin: isAdminPhone((row.phone as string | undefined) ?? null),
  };
}

// Auth servis yanıt tipi
interface AuthResult {
  user: AuthUserPayload;
  accessToken: string;
  refreshToken: string;
}

// Sürücü bilgisi dahil auth yanıtı
interface DriverAuthResult extends AuthResult {
  driver: {
    vehicle_plate: string;
    vehicle_model: string;
    vehicle_color: string;
  };
}

/**
 * Müşteri kaydı
 * 1. Telefon numarasının benzersizliğini kontrol et
 * 2. Şifreyi bcrypt ile hashle
 * 3. Kullanıcıyı veritabanına kaydet
 * 4. JWT token çifti üret
 * 5. Refresh token'ı veritabanına kaydet
 */
export async function registerCustomer(input: RegisterInput): Promise<AuthResult> {
  const { phone, full_name, password } = input;

  // Telefon numarası daha önce kayıtlı mı?
  const { data: existing } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('phone', phone)
    .single();

  if (existing) {
    throw new AppError('Bu telefon numarası zaten kayıtlı.', 409);
  }

  // Şifreyi hashle (bcrypt, salt rounds: 12)
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  // Kullanıcıyı oluştur
  const { data: user, error } = await supabaseAdmin
    .from('users')
    .insert({
      phone,
      full_name,
      password_hash: passwordHash,
      role: 'customer' as const,
    })
    .select('id, phone, full_name, role, rating, rating_count, created_at, avatar_url')
    .single();

  if (error || !user) {
    logger.error('Müşteri kaydı başarısız:', error);
    throw new AppError('Kayıt sırasında bir hata oluştu.', 500);
  }

  // JWT token çifti üret (ilk oturum sürümü: 1)
  const tokenPayload: TokenPayload = { userId: user.id, role: 'customer', sessionVersion: 1 };
  const tokens = generateTokenPair(tokenPayload);

  // Refresh token + oturum sürümü
  await supabaseAdmin
    .from('users')
    .update({ refresh_token: hashRefreshToken(tokens.refreshToken), session_version: 1 })
    .eq('id', user.id);

  logger.info(`Yeni müşteri kaydı: ${user.phone} (${user.id})`);

  return {
    user: mapUserRowToAuthPayload(user as Record<string, unknown>, 0),
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  };
}

/**
 * Sürücü kaydı
 * Müşteri kaydına ek olarak drivers tablosuna araç bilgilerini ekler
 */
export async function registerDriver(input: DriverRegisterInput): Promise<DriverAuthResult> {
  const { phone, full_name, password, vehicle_plate, vehicle_model, vehicle_color } = input;

  // Telefon numarası daha önce kayıtlı mı?
  const { data: existing } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('phone', phone)
    .single();

  if (existing) {
    throw new AppError('Bu telefon numarası zaten kayıtlı.', 409);
  }

  // Araç plakası daha önce kayıtlı mı?
  const { data: existingPlate } = await supabaseAdmin
    .from('drivers')
    .select('id')
    .eq('vehicle_plate', vehicle_plate)
    .single();

  if (existingPlate) {
    throw new AppError('Bu araç plakası zaten kayıtlı.', 409);
  }

  // Şifreyi hashle
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  // Kullanıcıyı oluştur (rol: driver)
  const { data: user, error: userError } = await supabaseAdmin
    .from('users')
    .insert({
      phone,
      full_name,
      password_hash: passwordHash,
      role: 'driver' as const,
    })
    .select('id, phone, full_name, role, rating, rating_count, created_at, avatar_url')
    .single();

  if (userError || !user) {
    logger.error('Sürücü kullanıcı kaydı başarısız:', userError);
    throw new AppError('Kayıt sırasında bir hata oluştu.', 500);
  }

  // Sürücü detaylarını kaydet (drivers tablosu, users.id ile ilişkili)
  // driver_code: favori sürücü çağırma özelliğinin lookup anahtarı (telefon numarası DEĞİL).
  // Benzersizliği DB unique constraint garanti eder; çakışma çıkarsa birkaç kez yeniden denenir.
  let driverError: { code?: string; message?: string } | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { error } = await supabaseAdmin
      .from('drivers')
      .insert({
        id: user.id,
        vehicle_plate,
        vehicle_model,
        vehicle_color,
        driver_code: String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0'),
      });
    driverError = error;
    if (!error || error.code !== '23505') break;
  }

  if (driverError) {
    // Sürücü kaydı başarısızsa kullanıcıyı da sil (tutarlılık)
    await supabaseAdmin.from('users').delete().eq('id', user.id);
    logger.error('Sürücü detay kaydı başarısız:', driverError);
    throw new AppError('Sürücü kaydı sırasında bir hata oluştu.', 500);
  }

  const tokenPayload: TokenPayload = { userId: user.id, role: 'driver', sessionVersion: 1 };
  const tokens = generateTokenPair(tokenPayload);

  await supabaseAdmin
    .from('users')
    .update({ refresh_token: hashRefreshToken(tokens.refreshToken), session_version: 1 })
    .eq('id', user.id);

  logger.info(`Yeni sürücü kaydı: ${user.phone} (${user.id}), Plaka: ${vehicle_plate}`);

  return {
    user: mapUserRowToAuthPayload(user as Record<string, unknown>, 0),
    driver: {
      vehicle_plate,
      vehicle_model,
      vehicle_color,
    },
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  };
}

/**
 * Giriş (Login)
 * 1. Telefon numarası ile kullanıcıyı bul
 * 2. Şifreyi bcrypt ile karşılaştır
 * 3. Yeni JWT token çifti üret
 * 4. Refresh token'ı güncelle
 */
export async function login(input: LoginInput): Promise<AuthResult> {
  const { phone, password } = input;

  // Kullanıcıyı telefon numarası ile bul
  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select(
      'id, phone, full_name, password_hash, role, rating, rating_count, created_at, avatar_url, is_suspended',
    )
    .eq('phone', phone)
    .single();

  if (error || !user) {
    // Güvenlik: Kullanıcı bulunamadığında da aynı mesajı ver
    throw new AppError('Telefon numarası veya şifre hatalı.', 401);
  }

  // Şifre karşılaştırma (bcrypt compare)
  const isPasswordValid = await bcrypt.compare(password, user.password_hash);

  if (!isPasswordValid) {
    throw new AppError('Telefon numarası veya şifre hatalı.', 401);
  }

  if (Boolean((user as { is_suspended?: boolean }).is_suspended)) {
    throw new AppError('Hesabınız askıya alınmış. Destek ile iletişime geçin.', 403);
  }

  const { data: curSv } = await supabaseAdmin
    .from('users')
    .select('session_version')
    .eq('id', user.id)
    .single();
  const nextSv = (curSv?.session_version ?? 0) + 1;

  const tokenPayload: TokenPayload = { userId: user.id, role: user.role, sessionVersion: nextSv };
  const tokens = generateTokenPair(tokenPayload);

  await supabaseAdmin
    .from('users')
    .update({ refresh_token: hashRefreshToken(tokens.refreshToken), session_version: nextSv })
    .eq('id', user.id);

  // session_version cache'i invalidate et — middleware eski sürümü kullanmasın
  await invalidateSessionVersionCache(user.id);

  // Yalnızca önceki oturum sürümündeki socket'leri kes (yeni token ile bağlanan cihazı kesme)
  disconnectStaleSocketsForUser(user.id, nextSv);

  logger.info(`Giriş başarılı: ${user.phone} (${user.role})`);

  const completedRides = await countCompletedRides(user.id, user.role as 'customer' | 'driver');

  return {
    user: mapUserRowToAuthPayload(user as Record<string, unknown>, completedRides),
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  };
}

/**
 * Token Yenileme (Refresh)
 * 1. Refresh token'ı doğrula
 * 2. Veritabanındaki refresh token ile karşılaştır
 * 3. Yeni token çifti üret
 *
 * Bu sayede:
 * - Çalınmış refresh token tespit edilebilir (DB'deki ile eşleşmezse)
 * - Her yenilemede eski refresh token geçersiz olur (rotation)
 */
export async function refreshTokens(refreshToken: string): Promise<AuthResult> {
  // Refresh token'ı doğrula (imza + süre kontrolü)
  const result = verifyRefreshToken(refreshToken);

  if (!result.valid || !result.payload) {
    throw new AppError('Geçersiz veya süresi dolmuş refresh token.', 401);
  }

  // Kullanıcıyı bul ve DB'deki refresh token ile karşılaştır
  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('id, phone, full_name, role, rating, rating_count, created_at, avatar_url, refresh_token, session_version')
    .eq('id', result.payload.userId)
    .single();

  if (error || !user) {
    throw new AppError('Kullanıcı bulunamadı.', 401);
  }

  if ((result.payload.sessionVersion ?? 0) !== (user.session_version ?? 0)) {
    throw new AppError('Oturum geçersiz. Lütfen tekrar giriş yapın.', 401);
  }

  // DB'deki refresh token hash'i ile gelen token'ın hash'i eşleşmeli (token rotation güvenliği)
  if (user.refresh_token !== hashRefreshToken(refreshToken)) {
    // Token çalınmış olabilir — tüm token'ları geçersiz kıl
    logger.warn(`Şüpheli token yenileme girişimi: ${user.id}`);
    await supabaseAdmin
      .from('users')
      .update({ refresh_token: null })
      .eq('id', user.id);
    throw new AppError('Refresh token geçersiz. Lütfen tekrar giriş yapın.', 401);
  }

  const tokenPayload: TokenPayload = {
    userId: user.id,
    role: user.role,
    sessionVersion: user.session_version ?? 0,
  };
  const tokens = generateTokenPair(tokenPayload);

  await supabaseAdmin
    .from('users')
    .update({ refresh_token: hashRefreshToken(tokens.refreshToken) })
    .eq('id', user.id);

  logger.debug(`Token yenilendi: ${user.id}`);

  const completedRides = await countCompletedRides(user.id, user.role as 'customer' | 'driver');

  return {
    user: mapUserRowToAuthPayload(user as Record<string, unknown>, completedRides),
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  };
}

/**
 * Çıkış (Logout)
 * Refresh token'ı veritabanından siler.
 * Access token client tarafında silinmelidir.
 */
/**
 * Çıkış — yalnızca JWT'deki oturum hâlâ geçerliyse (session_version DB ile aynı)
 * refresh temizlenir ve sürüm artırılır. Eski cihazdan (başkası giriş yapmış) gelen
 * token ile çağrılırsa DB'ye dokunulmaz; aktif cihazın oturumu korunur.
 */
export async function logout(userId: string, jwtSessionVersion: number): Promise<void> {
  const { data: row } = await supabaseAdmin
    .from('users')
    .select('session_version')
    .eq('id', userId)
    .single();

  const dbSv = row?.session_version ?? 0;
  const jwtSv = jwtSessionVersion ?? 0;

  if (jwtSv !== dbSv) {
    logger.info(`Çıkış no-op (eski oturum): user=${userId} jwtSv=${jwtSv} dbSv=${dbSv}`);
    return;
  }

  const nextSv = dbSv + 1;

  const { error } = await supabaseAdmin
    .from('users')
    .update({ refresh_token: null, session_version: nextSv })
    .eq('id', userId);

  if (error) {
    logger.error('Çıkış sırasında hata:', error);
    throw new AppError('Çıkış işlemi başarısız oldu.', 500);
  }

  await invalidateSessionVersionCache(userId);

  disconnectSocketsForUser(userId);

  logger.info(`Çıkış yapıldı: ${userId}`);
}
