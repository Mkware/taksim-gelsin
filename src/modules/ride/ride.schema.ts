/**
 * Ride Doğrulama Şemaları
 * Zod ile yolculuk oluşturma, güncelleme ve iptal isteklerinin doğrulanması.
 */

import { z } from 'zod';

// Koordinat doğrulama (lat: -90/+90, lng: -180/+180)
const coordinateSchema = z.object({
  lat: z.number().min(-90).max(90, 'Geçersiz enlem değeri.'),
  lng: z.number().min(-180).max(180, 'Geçersiz boylam değeri.'),
});

/**
 * Yolculuk oluşturma şeması
 * Müşteri biniş ve iniş noktalarını belirler
 */
export const createRideSchema = z.object({
  pickup: coordinateSchema,
  dropoff: coordinateSchema,
  pickup_address: z
    .string()
    .min(3, 'Biniş adresi en az 3 karakter olmalı.')
    .max(500, 'Biniş adresi en fazla 500 karakter olabilir.'),
  dropoff_address: z
    .string()
    .min(3, 'İniş adresi en az 3 karakter olmalı.')
    .max(500, 'İniş adresi en fazla 500 karakter olabilir.'),
  /** Müşteri uygulaması (Google Directions rota km). Yoksa sunucu Haversine kullanır. */
  distance_km: z.number().positive().max(2000).optional(),
});

/**
 * Ücret tahmini şeması
 * Yolculuk oluşturmadan önce fiyat tahmini almak için
 */
export const estimatePriceSchema = z.object({
  pickup: coordinateSchema,
  dropoff: coordinateSchema,
});

/**
 * Yolculuk iptal şeması
 */
export const cancelRideSchema = z.object({
  reason: z
    .string()
    .min(1, 'İptal sebebi boş olamaz.')
    .max(500, 'İptal sebebi en fazla 500 karakter olabilir.')
    .optional()
    .default('Kullanıcı tarafından iptal edildi.'),
});

/**
 * Yolculuk tamamlama şeması (sürücü tarafından)
 */
export const completeRideSchema = z.object({
  final_price: z
    .number()
    .positive('Ücret pozitif olmalı.')
    .optional(),
});

/**
 * Yolculuk listesi sayfalama şeması
 */
export const rideListSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  status: z.enum(['searching', 'accepted', 'arriving', 'in_progress', 'completed', 'cancelled']).optional(),
});

// Tip çıkarımları
export type CreateRideInput = z.infer<typeof createRideSchema>;
export type EstimatePriceInput = z.infer<typeof estimatePriceSchema>;
export type CancelRideInput = z.infer<typeof cancelRideSchema>;
export type CompleteRideInput = z.infer<typeof completeRideSchema>;
export type RideListInput = z.infer<typeof rideListSchema>;
