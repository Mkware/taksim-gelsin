/**
 * Platform operasyon ayarları — Supabase `platform_settings` + ortam değişkeni varsayılanları.
 * Admin panelinden güncellenir; GET ile birleştirilmiş değerler kullanılır.
 */

import { supabaseAdmin } from '../config/supabase';
import { env } from '../config/env';
import { logger } from '../utils/logger';

const ROW_ID = 'default';

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function envDefaults(): PlatformOperationalSettings {
  return {
    rideAcceptFeePercent: Number(process.env.RIDE_ACCEPT_FEE_PERCENT ?? 7),
    minDriverOnlineBalanceTcoin: Number(process.env.MIN_DRIVER_ONLINE_BALANCE_TCOIN ?? 20),
    pickupMaskRadiusM: Number(process.env.PICKUP_MASK_RADIUS_M ?? 300),
    matchingRoadMatrixMaxDrivers: clamp(
      Math.floor(Number(process.env.MATCHING_ROAD_MATRIX_MAX_DRIVERS ?? 10)),
      4,
      20,
    ),
    drivingDistanceCacheTtlSec: clamp(
      Math.floor(Number(process.env.DRIVING_DISTANCE_CACHE_TTL_SEC ?? 600)),
      60,
      3600,
    ),
    driverResponseTimeoutSeconds: clamp(
      Math.floor(Number(process.env.DRIVER_RESPONSE_TIMEOUT_SECONDS ?? 10)),
      5,
      180,
    ),
    matchingOfferWaveSize: clamp(
      Math.floor(Number(process.env.MATCHING_OFFER_WAVE_SIZE ?? 1)),
      1,
      3,
    ),
    walletCardSimulationEnabled: env.WALLET_CARD_SIMULATION_ENABLED,
    tariffBaseFare: Number(process.env.TARIFF_BASE_FARE ?? 50),
    tariffPerKmRate: Number(process.env.TARIFF_PER_KM_RATE ?? 50),
    tariffMinimumFare: Number(process.env.TARIFF_MINIMUM_FARE ?? 150),
    tariffWaitingRatePerMinute: Number(process.env.TARIFF_WAITING_RATE_PER_MINUTE ?? 3),
  };
}

/** JSON içinden gelen ham kısmi ayarlar */
export type PlatformSettingsPatch = Partial<{
  /** Tahmini yolculuk ücreti üzerinden kabul komisyonu (%) */
  rideAcceptFeePercent: number;
  minDriverOnlineBalanceTcoin: number;
  pickupMaskRadiusM: number;
  matchingRoadMatrixMaxDrivers: number;
  drivingDistanceCacheTtlSec: number;
  /** Sürücünün gelen çağrıya yanıt penceresi (sn) — eşleştirme timeout ile aynı. */
  driverResponseTimeoutSeconds: number;
  /** Aynı anda kaç sürücüye teklif gönderilir (paralel dalga). 1 = sıralı (klasik) davranış. */
  matchingOfferWaveSize: number;
  walletCardSimulationEnabled: boolean;
  /** Açılış ücreti (TL) — bkz. modules/ride/pricing.service.ts */
  tariffBaseFare: number;
  /** KM başı ücret (TL) */
  tariffPerKmRate: number;
  /** Taksimetre tabanı — hesaplanan ücret bunun altındaysa buna yuvarlanır (TL) */
  tariffMinimumFare: number;
  /** Bekleme (hareketsizlik) — dakika başı (TL) */
  tariffWaitingRatePerMinute: number;
}>;

export interface PlatformOperationalSettings {
  rideAcceptFeePercent: number;
  minDriverOnlineBalanceTcoin: number;
  pickupMaskRadiusM: number;
  matchingRoadMatrixMaxDrivers: number;
  drivingDistanceCacheTtlSec: number;
  driverResponseTimeoutSeconds: number;
  matchingOfferWaveSize: number;
  walletCardSimulationEnabled: boolean;
  tariffBaseFare: number;
  tariffPerKmRate: number;
  tariffMinimumFare: number;
  tariffWaitingRatePerMinute: number;
}

let cache: PlatformOperationalSettings | null = null;

function mergeFromDbRow(raw: Record<string, unknown> | null | undefined): PlatformOperationalSettings {
  const d = envDefaults();
  if (!raw || typeof raw !== 'object') return d;

  const num = (v: unknown, fallback: number) => {
    const x = Number(v);
    return Number.isFinite(x) ? x : fallback;
  };
  const bool = (v: unknown, fallback: boolean) =>
    typeof v === 'boolean' ? v : fallback;

  return {
    rideAcceptFeePercent: num(raw.rideAcceptFeePercent, d.rideAcceptFeePercent),
    minDriverOnlineBalanceTcoin: num(raw.minDriverOnlineBalanceTcoin, d.minDriverOnlineBalanceTcoin),
    pickupMaskRadiusM: num(raw.pickupMaskRadiusM, d.pickupMaskRadiusM),
    matchingRoadMatrixMaxDrivers: clamp(
      Math.floor(num(raw.matchingRoadMatrixMaxDrivers, d.matchingRoadMatrixMaxDrivers)),
      4,
      20,
    ),
    drivingDistanceCacheTtlSec: clamp(
      Math.floor(num(raw.drivingDistanceCacheTtlSec, d.drivingDistanceCacheTtlSec)),
      60,
      3600,
    ),
    driverResponseTimeoutSeconds: clamp(
      Math.floor(num(raw.driverResponseTimeoutSeconds, d.driverResponseTimeoutSeconds)),
      5,
      180,
    ),
    matchingOfferWaveSize: clamp(
      Math.floor(num(raw.matchingOfferWaveSize, d.matchingOfferWaveSize)),
      1,
      3,
    ),
    walletCardSimulationEnabled: bool(raw.walletCardSimulationEnabled, d.walletCardSimulationEnabled),
    tariffBaseFare: clamp(num(raw.tariffBaseFare, d.tariffBaseFare), 0, 10_000),
    tariffPerKmRate: clamp(num(raw.tariffPerKmRate, d.tariffPerKmRate), 0, 10_000),
    tariffMinimumFare: clamp(num(raw.tariffMinimumFare, d.tariffMinimumFare), 0, 10_000),
    tariffWaitingRatePerMinute: clamp(
      num(raw.tariffWaitingRatePerMinute, d.tariffWaitingRatePerMinute),
      0,
      1_000,
    ),
  };
}

/** Birleştirilmiş ayarlar (cache). Başlatma öncesi env varsayılanları döner. */
export function getPlatformSettings(): PlatformOperationalSettings {
  return cache ?? envDefaults();
}

/** Tahmini ücret × yüzde → T Coin kabul ücreti (2 ondalık). */
export function computeRideAcceptFeeTcoin(estimatedPrice: number): number {
  const pct = getPlatformSettings().rideAcceptFeePercent;
  if (pct <= 0) return 0;
  const price = Number(estimatedPrice);
  if (!Number.isFinite(price) || price <= 0) return 0;
  return Math.round((price * pct) / 100 * 100) / 100;
}

/** Smart matching / FCM — sürücü yanıt penceresi (ms). */
export function getDriverResponseTimeoutMs(): number {
  return getPlatformSettings().driverResponseTimeoutSeconds * 1000;
}

/** Uygulama açılışında ve admin güncellemesinden sonra çağırın. */
export async function initPlatformSettings(): Promise<void> {
  try {
    const { data, error } = await supabaseAdmin
      .from('platform_settings')
      .select('settings')
      .eq('id', ROW_ID)
      .maybeSingle();

    if (error) {
      logger.warn('[platform_settings] okuma hatası, env kullanılıyor:', error.message);
      cache = envDefaults();
      return;
    }

    const raw = (data?.settings as Record<string, unknown>) ?? {};
    cache = mergeFromDbRow(raw);
    logger.info('[platform_settings] yüklendi (DB + env birleşimi).');
  } catch (e) {
    logger.warn('[platform_settings] istisna, env kullanılıyor:', e);
    cache = envDefaults();
  }
}

export async function refreshPlatformSettings(): Promise<void> {
  await initPlatformSettings();
}

/** Admin doğrulaması sonrası kısmi güncelleme — DB + cache yenilenir. */
export async function updatePlatformSettings(
  patch: PlatformSettingsPatch,
): Promise<PlatformOperationalSettings> {
  const base = getPlatformSettings();
  const next: PlatformOperationalSettings = {
    rideAcceptFeePercent: clamp(
      Number(patch.rideAcceptFeePercent ?? base.rideAcceptFeePercent),
      0,
      100,
    ),
    minDriverOnlineBalanceTcoin: clamp(
      Number(patch.minDriverOnlineBalanceTcoin ?? base.minDriverOnlineBalanceTcoin),
      0,
      500,
    ),
    pickupMaskRadiusM: clamp(
      Number(patch.pickupMaskRadiusM ?? base.pickupMaskRadiusM),
      50,
      5000,
    ),
    matchingRoadMatrixMaxDrivers: clamp(
      Math.floor(Number(patch.matchingRoadMatrixMaxDrivers ?? base.matchingRoadMatrixMaxDrivers)),
      4,
      20,
    ),
    drivingDistanceCacheTtlSec: clamp(
      Math.floor(Number(patch.drivingDistanceCacheTtlSec ?? base.drivingDistanceCacheTtlSec)),
      60,
      3600,
    ),
    driverResponseTimeoutSeconds: clamp(
      Math.floor(Number(patch.driverResponseTimeoutSeconds ?? base.driverResponseTimeoutSeconds)),
      5,
      180,
    ),
    matchingOfferWaveSize: clamp(
      Math.floor(Number(patch.matchingOfferWaveSize ?? base.matchingOfferWaveSize)),
      1,
      3,
    ),
    walletCardSimulationEnabled:
      patch.walletCardSimulationEnabled ?? base.walletCardSimulationEnabled,
    tariffBaseFare: clamp(Number(patch.tariffBaseFare ?? base.tariffBaseFare), 0, 10_000),
    tariffPerKmRate: clamp(Number(patch.tariffPerKmRate ?? base.tariffPerKmRate), 0, 10_000),
    tariffMinimumFare: clamp(Number(patch.tariffMinimumFare ?? base.tariffMinimumFare), 0, 10_000),
    tariffWaitingRatePerMinute: clamp(
      Number(patch.tariffWaitingRatePerMinute ?? base.tariffWaitingRatePerMinute),
      0,
      1_000,
    ),
  };

  const settingsJson = {
    rideAcceptFeePercent: next.rideAcceptFeePercent,
    minDriverOnlineBalanceTcoin: next.minDriverOnlineBalanceTcoin,
    pickupMaskRadiusM: next.pickupMaskRadiusM,
    matchingRoadMatrixMaxDrivers: next.matchingRoadMatrixMaxDrivers,
    drivingDistanceCacheTtlSec: next.drivingDistanceCacheTtlSec,
    driverResponseTimeoutSeconds: next.driverResponseTimeoutSeconds,
    matchingOfferWaveSize: next.matchingOfferWaveSize,
    walletCardSimulationEnabled: next.walletCardSimulationEnabled,
    tariffBaseFare: next.tariffBaseFare,
    tariffPerKmRate: next.tariffPerKmRate,
    tariffMinimumFare: next.tariffMinimumFare,
    tariffWaitingRatePerMinute: next.tariffWaitingRatePerMinute,
  };

  const { error } = await supabaseAdmin.from('platform_settings').upsert(
    {
      id: ROW_ID,
      settings: settingsJson,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' },
  );

  if (error) {
    logger.error('[platform_settings] kayıt hatası:', error);
    throw new Error(error.message);
  }

  cache = next;
  return next;
}

/** Mobil / herkese açık — hassas olmayan alanlar */
export function getPublicPlatformConfig() {
  const s = getPlatformSettings();
  return {
    rideAcceptFeePercent: s.rideAcceptFeePercent,
    minDriverOnlineBalanceTcoin: s.minDriverOnlineBalanceTcoin,
    pickupMaskRadiusM: s.pickupMaskRadiusM,
    matchingRoadMatrixMaxDrivers: s.matchingRoadMatrixMaxDrivers,
    drivingDistanceCacheTtlSec: s.drivingDistanceCacheTtlSec,
    driverResponseTimeoutSeconds: s.driverResponseTimeoutSeconds,
  };
}
