/**
 * Ücret Hesaplama Servisi — Kırıkkale ili taksi tarifesi.
 *
 * Tarife sayısal değerleri (açılış, km başı, taksimetre tabanı, bekleme) artık
 * `platform_settings` tablosunda (admin panelinden değiştirilebilir, `.env`
 * yalnızca boş bir DB için bootstrap varsayılanı) — bkz. platform_settings.service.ts.
 * Deploy gerekmeden değiştirilebilir hale getirmek için 15 Tem 2026'da buradan
 * taşındı (Faz 3, madde 12).
 *
 * Varsayılan tarife (DB satırı yoksa):
 *   Açılış ücreti     : 50 TL
 *   KM başı ücret     : 50 TL (hareket)
 *   Minimum ücret     : 150 TL (taksimetre tabanı)
 *   Bekleme (hareket yok): 3 TL / dakika
 *
 * Tahmini yol ücreti (rota km bilindiğinde):
 *   max(minimumFare, baseFare + km × perKmRate)
 *
 * Bekleme ücreti yolculuk sırasında (durunca) eklenir; ön tahmine dahil değildir.
 */

import { getPlatformSettings } from '../../services/platform_settings.service';

/**
 * Mesafeye göre tahmini ücret (bekleme hariç)
 */
export function calculatePrice(distanceKm: number): number {
  const { tariffBaseFare, tariffPerKmRate, tariffMinimumFare } = getPlatformSettings();

  if (distanceKm <= 0) {
    return tariffMinimumFare;
  }

  const calculated = tariffBaseFare + distanceKm * tariffPerKmRate;
  const price = Math.max(tariffMinimumFare, calculated);
  return Math.round(price * 100) / 100;
}

/**
 * Bekleme süresine göre ücret (hareket yok, dakika başı)
 */
export function calculateWaitingCharge(waitingMinutes: number): number {
  if (waitingMinutes <= 0) return 0;
  const { tariffWaitingRatePerMinute } = getPlatformSettings();
  return Math.round(waitingMinutes * tariffWaitingRatePerMinute * 100) / 100;
}

export function getPriceBreakdown(distanceKm: number): {
  baseFare: number;
  distanceFare: number;
  totalPrice: number;
  distanceKm: number;
} {
  const { tariffPerKmRate } = getPlatformSettings();
  const distanceFare =
    distanceKm > 0 ? Math.round(distanceKm * tariffPerKmRate * 100) / 100 : 0;
  const totalPrice = calculatePrice(distanceKm);

  return {
    baseFare: getPlatformSettings().tariffBaseFare,
    distanceFare,
    totalPrice,
    distanceKm: Math.round(distanceKm * 100) / 100,
  };
}

export function getTariffInfo(): {
  baseFare: number;
  perKmRate: number;
  minimumFare: number;
  waitingRatePerMinute: number;
  currency: string;
  city: string;
  region: string;
} {
  const { tariffBaseFare, tariffPerKmRate, tariffMinimumFare, tariffWaitingRatePerMinute } =
    getPlatformSettings();
  return {
    baseFare: tariffBaseFare,
    perKmRate: tariffPerKmRate,
    minimumFare: tariffMinimumFare,
    waitingRatePerMinute: tariffWaitingRatePerMinute,
    currency: 'TRY',
    city: 'Kırıkkale',
    region: 'Kırıkkale ili',
  };
}
