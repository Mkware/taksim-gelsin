/**
 * Mesafe Hesaplama Yardımcıları
 * Haversine formülü ile iki koordinat arası mesafe hesaplar.
 * PostGIS kullanılamadığı durumlarda yedek olarak kullanılır.
 */

// Dünya yarıçapı (km)
const EARTH_RADIUS_KM = 6371;

// Koordinat çifti tipi
export interface Coordinates {
  lat: number;
  lng: number;
}

/**
 * Dereceyi radyana çevirir
 */
function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Haversine formülü ile iki nokta arası mesafeyi hesaplar
 * @param from Başlangıç noktası (lat, lng)
 * @param to Bitiş noktası (lat, lng)
 * @returns Mesafe (kilometre cinsinden)
 *
 * Örnek: İstanbul → Ankara ≈ 350 km
 * Kırıkkale merkez → Kırıkkale Üniversitesi ≈ 5 km
 */
export function calculateDistance(from: Coordinates, to: Coordinates): number {
  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(from.lat)) *
      Math.cos(toRadians(to.lat)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  // Sonucu 2 ondalık basamağa yuvarla
  return Math.round(EARTH_RADIUS_KM * c * 100) / 100;
}

/**
 * Mesafeyi metre cinsinden döndürür
 */
export function calculateDistanceMeters(from: Coordinates, to: Coordinates): number {
  return calculateDistance(from, to) * 1000;
}

/**
 * Tahmini varış süresini hesaplar (dakika)
 * Şehir içi ortalama hız: 30 km/h varsayımı
 */
export function estimateArrivalTime(
  from: Coordinates,
  to: Coordinates,
  avgSpeedKmh: number = 30
): number {
  const distanceKm = calculateDistance(from, to);
  const timeHours = distanceKm / avgSpeedKmh;
  // Dakikaya çevir ve yukarı yuvarla (minimum 1 dakika)
  return Math.max(1, Math.ceil(timeHours * 60));
}

/**
 * Dört koordinat ile Haversine mesafesi (km) — smart matching ile uyumlu imza
 */
export function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  return calculateDistance({ lat: lat1, lng: lng1 }, { lat: lat2, lng: lng2 });
}
