/**
 * Sürücü → biniş yol mesafesi: Google Distance Matrix (driving) + Redis önbellek.
 * Anahtar yok / API hata: Haversine (metre).
 */

import * as https from 'https';
import { getPlatformSettings } from './platform_settings.service';
import { env } from '../config/env';
import { redis } from '../config/redis';
import { logger } from '../utils/logger';
import { calculateDistanceMeters, Coordinates } from '../utils/distance';

const MAX_MATRIX_ORIGINS_PER_REQUEST = 25;
/** Google yanıt vermezse istek sonsuza asılmasın — timeout'ta Haversine fallback'e düşülür. */
const MATRIX_HTTP_TIMEOUT_MS = 4000;

const CACHE_KEY_PREFIX = 'gdm:v1';

interface DMElement {
  status: string;
  distance?: { value: number; text: string };
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
 * Sadece Google API — cache yok. [drivers] ile aynı sırada metre.
 */
async function fetchMatrixMeters(
  pickupLat: number,
  pickupLng: number,
  drivers: { lat: number; lng: number }[],
  apiKey: string,
): Promise<number[]> {
  const pickup: Coordinates = { lat: pickupLat, lng: pickupLng };
  if (drivers.length === 0) return [];

  const out: number[] = [];

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
          out.push(haversineMeters({ lat: d.lat, lng: d.lng }, pickup));
        }
        continue;
      }

      for (let i = 0; i < chunk.length; i++) {
        const row = data.rows?.[i];
        const el = row?.elements?.[0];
        const d = chunk[i];
        if (el?.status === 'OK' && el.distance?.value != null && el.distance.value >= 0) {
          out.push(el.distance.value);
        } else {
          out.push(haversineMeters({ lat: d.lat, lng: d.lng }, pickup));
        }
      }
    } catch (e) {
      logger.warn('[DrivingDistance] Matrix HTTP hatası:', e);
      for (const d of chunk) {
        out.push(haversineMeters({ lat: d.lat, lng: d.lng }, pickup));
      }
    }
  }

  return out;
}

/**
 * Her sürücü konumundan binişe araçla mesafe (m). Sıra korunur.
 * Redis hit → API yok; sadece cache miss için Matrix (maliyet düşük).
 */
export async function drivingMetersDriverToPickup(
  pickupLat: number,
  pickupLng: number,
  drivers: { lat: number; lng: number }[],
): Promise<number[]> {
  const pickup: Coordinates = { lat: pickupLat, lng: pickupLng };
  if (drivers.length === 0) return [];

  const key = env.GOOGLE_MAPS_API_KEY?.trim();
  if (!key) {
    return drivers.map((d) => haversineMeters({ lat: d.lat, lng: d.lng }, pickup));
  }

  const results: number[] = new Array(drivers.length);
  const missIdx: number[] = [];
  const keys: string[] = drivers.map((d) =>
    pairCacheKey(d.lat, d.lng, pickupLat, pickupLng),
  );

  try {
    const cached = await redis.mget(...keys);
    for (let i = 0; i < drivers.length; i++) {
      const raw = cached[i];
      if (raw != null && raw !== '') {
        const m = Number(raw);
        if (Number.isFinite(m) && m >= 0) {
          results[i] = m;
          continue;
        }
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
  const fresh = await fetchMatrixMeters(pickupLat, pickupLng, missDrivers, key);

  try {
    const pipe = redis.pipeline();
    for (let j = 0; j < missIdx.length; j++) {
      const i = missIdx[j];
      const meters = fresh[j] ?? haversineMeters({ lat: drivers[i].lat, lng: drivers[i].lng }, pickup);
      results[i] = meters;
      pipe.setex(
        keys[i],
        getPlatformSettings().drivingDistanceCacheTtlSec,
        String(Math.round(meters)),
      );
    }
    await pipe.exec();
  } catch (e) {
    logger.warn('[DrivingDistance] Redis pipeline yazım hatası (mesafe yine hesaplandı):', e);
    for (let j = 0; j < missIdx.length; j++) {
      const i = missIdx[j];
      results[i] =
        fresh[j] ?? haversineMeters({ lat: drivers[i].lat, lng: drivers[i].lng }, pickup);
    }
  }

  return results;
}
