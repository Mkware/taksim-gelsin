/**
 * Ücret Hesaplama Servisi — Kırıkkale ili taksi tarifesi (şimdilik sabit).
 *
 * Tarife:
 *   Açılış ücreti     : 50 TL
 *   KM başı ücret     : 50 TL (hareket)
 *   Minimum ücret     : 150 TL (taksimetre tabanı)
 *   Bekleme (hareket yok): 3 TL / dakika
 *
 * Tahmini yol ücreti (rota km bilindiğinde):
 *   max(150, 50 + km × 50)
 *
 * Bekleme ücreti yolculuk sırasında (durunca) eklenir; ön tahmine dahil değildir.
 */

const BASE_FARE = 50;
const PER_KM_RATE = 50;
const MINIMUM_FARE = 150;
/** Taksi hareket etmediğinde dakika başı (TL) */
const WAITING_RATE_PER_MINUTE = 3;

/**
 * Mesafeye göre tahmini ücret (bekleme hariç)
 */
export function calculatePrice(distanceKm: number): number {
  if (distanceKm <= 0) {
    return MINIMUM_FARE;
  }

  const calculated = BASE_FARE + distanceKm * PER_KM_RATE;
  const price = Math.max(MINIMUM_FARE, calculated);
  return Math.round(price * 100) / 100;
}

/**
 * Bekleme süresine göre ücret (hareket yok, dakika başı)
 */
export function calculateWaitingCharge(waitingMinutes: number): number {
  if (waitingMinutes <= 0) return 0;
  return Math.round(waitingMinutes * WAITING_RATE_PER_MINUTE * 100) / 100;
}

export function getPriceBreakdown(distanceKm: number): {
  baseFare: number;
  distanceFare: number;
  totalPrice: number;
  distanceKm: number;
} {
  const distanceFare =
    distanceKm > 0 ? Math.round(distanceKm * PER_KM_RATE * 100) / 100 : 0;
  const totalPrice = calculatePrice(distanceKm);

  return {
    baseFare: BASE_FARE,
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
  return {
    baseFare: BASE_FARE,
    perKmRate: PER_KM_RATE,
    minimumFare: MINIMUM_FARE,
    waitingRatePerMinute: WAITING_RATE_PER_MINUTE,
    currency: 'TRY',
    city: 'Kırıkkale',
    region: 'Kırıkkale ili',
  };
}
