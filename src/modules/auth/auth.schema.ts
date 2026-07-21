/**
 * Auth Doğrulama Şemaları
 * Zod ile kayıt, giriş ve token yenileme isteklerinin doğrulanması.
 * Tüm input'lar bu şemalardan geçmeden controller'a ulaşamaz.
 */

import { z } from 'zod';

// Türk telefon numarası formatı: +905XXXXXXXXX (13 karakter)
const phoneRegex = /^\+90[0-9]{10}$/;

/** 0555… / 90555… / 555… → +905551112233 */
export function normalizeTrPhoneInput(raw: string): string {
  let s = raw.trim().replace(/[\s\-()]/g, '');
  if (s.startsWith('0') && s.length === 11) {
    s = `+90${s.slice(1)}`;
  } else if (s.startsWith('90') && s.length === 12) {
    s = `+${s}`;
  } else if (/^5[0-9]{9}$/.test(s)) {
    s = `+90${s}`;
  }
  return s;
}

const trPhoneSchema = z
  .string()
  .transform((s) => normalizeTrPhoneInput(s))
  .pipe(
    z.string().regex(phoneRegex, 'Geçerli bir Türk telefon numarası girin. Örnek: +905551112233'),
  );

/**
 * Müşteri kayıt şeması
 * Telefon, isim ve şifre zorunlu
 */
export const registerSchema = z.object({
  phone: trPhoneSchema,
  full_name: z
    .string()
    .min(2, 'İsim en az 2 karakter olmalı.')
    .max(100, 'İsim en fazla 100 karakter olabilir.')
    .trim(),
  password: z
    .string()
    .min(6, 'Şifre en az 6 karakter olmalı.')
    .max(128, 'Şifre en fazla 128 karakter olabilir.'),
});

/**
 * Sürücü kayıt şeması
 * Müşteri alanlarına ek olarak araç bilgileri zorunlu
 */
export const driverRegisterSchema = z.object({
  phone: trPhoneSchema,
  full_name: z
    .string()
    .min(2, 'İsim en az 2 karakter olmalı.')
    .max(100, 'İsim en fazla 100 karakter olabilir.')
    .trim(),
  password: z
    .string()
    .min(6, 'Şifre en az 6 karakter olmalı.')
    .max(128, 'Şifre en fazla 128 karakter olabilir.'),
  vehicle_plate: z
    .string()
    .min(5, 'Araç plakası en az 5 karakter olmalı.')
    .max(20, 'Araç plakası en fazla 20 karakter olabilir.')
    .trim(),
  vehicle_model: z
    .string()
    .min(2, 'Araç modeli en az 2 karakter olmalı.')
    .max(100, 'Araç modeli en fazla 100 karakter olabilir.')
    .trim(),
  vehicle_color: z
    .string()
    .min(2, 'Araç rengi en az 2 karakter olmalı.')
    .max(50, 'Araç rengi en fazla 50 karakter olabilir.')
    .trim(),
});

/**
 * Giriş şeması
 * Telefon ve şifre ile kimlik doğrulama
 */
export const loginSchema = z.object({
  phone: trPhoneSchema,
  password: z
    .string()
    .min(1, 'Şifre boş olamaz.'),
});

/**
 * Token yenileme şeması
 * Geçerli bir refresh token gerektirir
 */
export const refreshTokenSchema = z.object({
  refresh_token: z
    .string()
    .min(1, 'Refresh token boş olamaz.'),
});

/**
 * SMS OTP isteği — sadece telefon numarası
 */
export const otpRequestSchema = z.object({
  phone: trPhoneSchema,
});

/**
 * SMS OTP doğrulama — telefon + 4 haneli kod
 */
export const otpVerifySchema = z.object({
  phone: trPhoneSchema,
  code: z
    .string()
    .regex(/^[0-9]{4}$/, 'Kod 4 haneli olmalı.'),
});

// Tip çıkarımları — Controller'da kullanılır
export type RegisterInput = z.infer<typeof registerSchema>;
export type DriverRegisterInput = z.infer<typeof driverRegisterSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
export type OtpRequestInput = z.infer<typeof otpRequestSchema>;
export type OtpVerifyInput = z.infer<typeof otpVerifySchema>;
