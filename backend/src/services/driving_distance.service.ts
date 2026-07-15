/**
 * Sürücü → biniş yol mesafesi + süresi: Google Distance Matrix (driving) + Redis önbellek.
 * Anahtar yok / API hata: Haversine mesafe + sabit hız varsayımıyla tahmini süre.
 */

import * as https from 'https';
import { getPlatformSettings } from './platform_settings.service';
import { env } from '../config/env';
import { redis } from '../config/redis';
import { logger } from '../utils/logger';
import { calculateDistanceMeters, estimateArrivalTime, Coordinates } from '../utils/distance';

const MAX_MATRIX_ORIGINS_PER_REQUEST = 25;
/** Google yanıt vermezse istek sonsuza asılmasın — timeout'ta Haversine fallback'e düşülür. */
const MATRIX_HTTP_TIMEOUT_MS = 4000;

const CACHE_KEY_PREFIX = 'gdm:v2'; // v2: değer artık "metre:saniye" (önceki v1 sadece metreydi)

export interface DrivingResult {
  meters: number;
  seconds: number;
}

interface DMElement {
  status: string;
  distance?: { value: number; text: string };
  duration?: { value: number; text: string };
}

interface DMRow {
  elements: DMElement[];
}

interface DMResponse {
  status: string;
  error_message?: string;
  rows: DMRow[];
}

function haversineMeters(from: Coordinates, to: Coordinates): number {
  return calculateDistanceMeters(from, to);
}

/** Matrix/Redis'ten süre alınamadığında: sabit 30km/h varsayımıyla tahmini süre (sn). */
function estimatedSecondsFallback(from: Coordinates, to: Coordinates): number {
  return estimateArrivalTime(from, to) * 60;
}

function haversineFallback(from: Coordinates, to: Coordinates): DrivingResult {
  return { meters: haversineMeters(from, to), seconds: estimatedSecondsFallback(from, to) };
}

/** 4 ondalık ≈ 11 m ızgara — aynı hücrede tekrar Matrix ödenmez. */
function snap4(n: number): string {
  if (!Number.isFinite(n)) return '0.0000';
  return (Math.round(n * 10000) / 10000).toFixed(4);
}

/**
 * Sadece sayısal parçalar; API anahtarı veya kullanıcı girdisi yok (güvenli Redis anahtarı).
 */
function pairCacheKey(
  driverLat: number,
  driverLng: number,
  pickupLat: number,
  pickupLng: number,
): string {
  return `${CACHE_KEY_PREFIX}:${snap4(driverLat)}:${snap4(driverLng)}:${snap4(pickupLat)}:${snap4(pickupLng)}`;
}

function httpsGetJson<T>(url: string, timeoutMs = MATRIX_HTTP_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const req = https.get(url, (res) => {
      let body = '';
      res.on('data', (c: string) => {
        body += c;
      });
      res.on('end', () => {
        done(() => {
          try {
            resolve(JSON.parse(body) as T);
          } catch (e) {
            reject(e);
          }
        });
      });
    });

    // Yanıt gelmezse istek sonsuza kadar askıda kalmasın (eşleştirme donmasın).
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Distance Matrix HTTP timeout (${timeoutMs} ms)`));
    });

    req.on('error', (e) => {
      done(() => reject(e));
    });
  });
}

/**
 * Sadece Google API — cache yok. [drivers] ile aynı sırada { meters, seconds }.
 */
async function fetchMatrixResults(
  pickupLat: number,
  pickupLng: number,
  drivers: { lat: number; lng: number }[],
  apiKey: string,
): Promise<DrivingResult[]> {
  const pickup: Coordinates = { lat: pickupLat, lng: pickupLng };
  if (drivers.length === 0) return [];

  const out: DrivingResult[] = [];

  for (let offset = 0; offset < drivers.length; offset += MAX_MATRIX_ORIGINS_PER_REQUEST) {
    const chunk = drivers.slice(offset, offset + MAX_MATRIX_ORIGINS_PER_REQUEST);
    const originsParam = chunk.map((d) => `${d.lat},${d.lng}`).join('|');
    const params = new URLSearchParams({
      origins: originsParam,
      destinations: `${pickupLat},${pickupLng}`,
      mode: 'driving',
      units: 'metric',
      key: apiKey,
    });

    try {
      const url = `https://maps.googleapis.com/maps/api/distancematrix/json?${params.toString()}`;
      const data = await httpsGetJson<DMResponse>(url);

      if (data.status !== 'OK') {
        logger.warn(`[DrivingDistance] Matrix status=${data.status} ${data.error_message ?? ''}`);
        for (const d of chunk) {
          out.push(haversineFallback({ lat: d.lat, lng: d.lng }, pickup));
        }
        continue;
      }

      for (let i = 0; i < chunk.length; i++) {
        const row = data.rows?.[i];
        const el = row?.elements?.[0];
        const d = chunk[i];
        if (el?.status === 'OK' && el.distance?.value != null && el.distance.value >= 0) {
          const meters = el.distance.value;
          const seconds =
            el.duration?.value != null && el.duration.value >= 0
              ? el.duration.value
              : estimatedSecondsFallback({ lat: d.lat, lng: d.lng }, pickup);
          out.push({ meters, seconds });
        } else {
          out.push(haversineFallback({ lat: d.lat, lng: d.lng }, pickup));
        }
      }
    } catch (e) {
      logger.warn('[DrivingDistance] Matrix HTTP hatası:', e);
      for (const d of chunk) {
        out.push(haversineFallback({ lat: d.lat, lng: d.lng }, pickup));
      }
    }
  }

  return out;
}

function parseCachedValue(raw: string): DrivingResult | null {
  // v2 format: "metre:saniye". Eski v1 (sadece metre) prefix değiştiği için artık
  // hiç karşılaşılmaz, ama olur da bir ortam eski cache anahtarını taşırsa yine de
  // güvenli şekilde reddedilir (miss sayılır, Matrix'ten tazelenir).
  const idx = raw.indexOf(':');
  if (idx <= 0) return null;
  const meters = Number(raw.slice(0, idx));
  const seconds = Number(raw.slice(idx + 1));
  if (!Number.isFinite(meters) || meters < 0 || !Number.isFinite(seconds) || seconds < 0) return null;
  return { meters, seconds };
}

/**
 * Her sürücü konumundan binişe araçla mesafe (m) + süre (sn). Sıra korunur.
 * Redis hit → API yok; sadece cache miss için Matrix (maliyet düşük).
 */
export async function drivingMetersAndSecondsDriverToPickup(
  pickupLat: number,
  pickupLng: number,
  drivers: { lat: number; lng: number }[],
): Promise<DrivingResult[]> {
  const pickup: Coordinates = { lat: pickupLat, lng: pickupLng };
  if (drivers.length === 0) return [];

  const key = env.GOOGLE_MAPS_API_KEY?.trim();
  if (!key) {
    return drivers.map((d) => haversineFallback({ lat: d.lat, lng: d.lng }, pickup));
  }

  const results: DrivingResult[] = new Array(drivers.length);
  const missIdx: number[] = [];
  const keys: string[] = drivers.map((d) =>
    pairCacheKey(d.lat, d.lng, pickupLat, pickupLng),
  );

  try {
    const cached = await redis.mget(...keys);
    for (let i = 0; i < drivers.length; i++) {
      const raw = cached[i];
      const parsed = raw != null && raw !== '' ? parseCachedValue(raw) : null;
      if (parsed) {
        results[i] = parsed;
        continue;
      }
      missIdx.push(i);
    }
  } catch (e) {
    logger.warn('[DrivingDistance] Redis mget hatası, Matrix tam yükleniyor:', e);
    missIdx.length = 0;
    for (let i = 0; i < drivers.length; i++) missIdx.push(i);
  }

  if (missIdx.length === 0) {
    return results;
  }

  const missDrivers = missIdx.map((i) => drivers[i]);
  const fresh = await fetchMatrixResults(pickupLat, pickupLng, missDrivers, key);

  try {
    const pipe = redis.pipeline();
    for (let j = 0; j < missIdx.length; j++) {
      const i = missIdx[j];
      const result =
        fresh[j] ?? haversineFallback({ lat: drivers[i].lat, lng: drivers[i].lng }, pickup);
      results[i] = result;
      pipe.setex(
        keys[i],
        getPlatformSettings().drivingDistanceCacheTtlSec,
        `${Math.round(result.meters)}:${Math.round(result.seconds)}`,
      );
    }
    await pipe.exec();
  } catch (e) {
    logger.warn('[DrivingDistance] Redis pipeline yazım hatası (mesafe yine hesaplandı):', e);
    for (let j = 0; j < missIdx.length; j++) {
      const i = missIdx[j];
      results[i] =
        fresh[j] ?? haversineFallback({ lat: drivers[i].lat, lng: drivers[i].lng }, pickup);
    }
  }

  return results;
}
