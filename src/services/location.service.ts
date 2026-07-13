/**
 * Konum Servisi (PostGIS Sorguları)
 * Sürücü konum güncelleme, yakın sürücü bulma ve mesafe hesaplama.
 * Tüm coğrafi sorgular PostGIS ile yapılır (SRID 4326 = WGS84).
 */

import { supabaseAdmin } from '../config/supabase';
import { redis } from '../config/redis';
import { logger } from '../utils/logger';
import type { NearbyDriver, LatLng } from '../types';

// Redis key prefix'leri
const DRIVER_LOCATION_KEY = 'driver:location:';

/**
 * Yakındaki müsait sürücüleri PostGIS ile bulur
 * ST_DWithin: Belirtilen yarıçap içindeki sürücüleri filtreler
 * ST_Distance: Mesafeye göre sıralar (en yakın önce)
 *
 * @param pickup Biniş noktası koordinatları
 * @param radiusMeters Arama yarıçapı (metre, varsayılan 5000 = 5km)
 * @param maxResults Maksimum sonuç sayısı (varsayılan 10)
 * @param excludeDriverIds Hariç tutulacak sürücü ID'leri (reddeden sürücüler)
 */
export async function findNearbyDrivers(
  pickup: LatLng,
  radiusMeters: number = 5000,
  maxResults: number = 10,
  excludeDriverIds: string[] = []
): Promise<NearbyDriver[]> {
  try {
    // PostGIS fonksiyonunu çağır
    const { data, error } = await supabaseAdmin.rpc('find_nearby_drivers', {
      lat: pickup.lat,
      lng: pickup.lng,
      radius_meters: radiusMeters,
      max_results: maxResults + excludeDriverIds.length, // Hariç tutulacakları hesaba kat
    });

    if (error) {
      logger.error('Yakın sürücü bulma hatası (PostGIS):', error);
      return [];
    }

    if (!data || data.length === 0) {
      return [];
    }

    // Hariç tutulacak sürücüleri filtrele ve sonucu dönüştür
    const drivers: NearbyDriver[] = data
      .filter((d: { driver_id: string }) => !excludeDriverIds.includes(d.driver_id))
      .slice(0, maxResults)
      .map((d: {
        driver_id: string;
        full_name: string;
        phone: string;
        vehicle_plate: string;
        vehicle_model: string;
        vehicle_color: string;
        rating: number;
        distance_meters: number;
        lat_out: number;
        lng_out: number;
      }) => ({
        driver_id: d.driver_id,
        full_name: d.full_name,
        phone: d.phone,
        vehicle_plate: d.vehicle_plate,
        vehicle_model: d.vehicle_model,
        vehicle_color: d.vehicle_color,
        rating: d.rating,
        distance_meters: d.distance_meters,
        lat: d.lat_out,
        lng: d.lng_out,
      }));

    // Not: Bu fonksiyon hem eşleştirme hem de müşteri haritası (yakın taksiler)
    // için periyodik çağrılıyor; her çağrıda log düşürmek gürültü yaratıyordu.
    return drivers;
  } catch (error) {
    logger.error('findNearbyDrivers hatası:', error);
    return [];
  }
}

/**
 * Sürücünün anlık konumunu Redis cache'den alır
 * Redis'te yoksa null döner
 */
export async function getDriverLocation(driverId: string): Promise<LatLng | null> {
  try {
    const locationStr = await redis.get(`${DRIVER_LOCATION_KEY}${driverId}`);
    if (!locationStr) return null;

    const location = JSON.parse(locationStr);
    return { lat: location.lat, lng: location.lng };
  } catch (error) {
    logger.error(`Sürücü konum cache hatası [${driverId}]:`, error);
    return null;
  }
}

/**
 * Sürücünün konumunu Redis cache ve DB'de günceller
 */
export async function updateDriverLocation(
  driverId: string,
  lat: number,
  lng: number,
  bearing: number = 0
): Promise<void> {
  try {
    // Redis cache güncelle (TTL: 5 dakika)
    const locationData = JSON.stringify({ lat, lng, bearing, updatedAt: Date.now() });
    await redis.set(`${DRIVER_LOCATION_KEY}${driverId}`, locationData, 'EX', 300);

    // PostGIS fonksiyonu ile DB güncelle + geçmişe kaydet
    await supabaseAdmin.rpc('update_driver_location', {
      p_driver_id: driverId,
      p_lat: lat,
      p_lng: lng,
      p_bearing: bearing,
    });
  } catch (error) {
    logger.error(`Konum güncelleme hatası [${driverId}]:`, error);
  }
}

/**
 * Belirli bir bölgedeki tüm aktif sürücülerin konumlarını döndürür
 * Harita üzerinde sürücü ikonları göstermek için kullanılır
 */
export async function getActiveDriversInArea(
  center: LatLng,
  radiusMeters: number = 10000
): Promise<Array<{ driverId: string; lat: number; lng: number; bearing: number }>> {
  try {
    const drivers = await findNearbyDrivers(center, radiusMeters, 50);

    // Her sürücünün anlık konumunu Redis'ten al (daha güncel)
    const result = await Promise.all(
      drivers.map(async (driver) => {
        const cached = await getDriverLocation(driver.driver_id);
        return {
          driverId: driver.driver_id,
          lat: cached?.lat || driver.lat,
          lng: cached?.lng || driver.lng,
          bearing: 0,
        };
      })
    );

    return result;
  } catch (error) {
    logger.error('Aktif sürücüler hatası:', error);
    return [];
  }
}
