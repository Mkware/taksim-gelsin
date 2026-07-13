import { createHash } from 'crypto';

const EARTH_RADIUS_M = 6371000;

function offsetMeters(lat: number, lng: number, bearing: number, distanceM: number): { lat: number; lng: number } {
  const δ = distanceM / EARTH_RADIUS_M;
  const θ = bearing;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lng * Math.PI) / 180;
  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ),
  );
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2),
    );
  return { lat: (φ2 * 180) / Math.PI, lng: (λ2 * 180) / Math.PI };
}

/**
 * Yolcunun gerçek alımını sürücüye göstermeden, deterministik yaklaşık nokta üretir (rideId+driverId hash).
 * Nokta gerçek çember içinde kalır (max ~maskRadiusM).
 */
export function maskPickupForDriver(
  realLat: number,
  realLng: number,
  rideId: string,
  driverId: string,
  maskRadiusM: number,
): { lat: number; lng: number; uncertaintyRadiusM: number } {
  const h = createHash('sha256').update(`${rideId}:${driverId}`).digest();
  const u1 = h.readUInt32BE(0) / 0xffffffff;
  const u2 = h.readUInt32BE(4) / 0xffffffff;
  const angle = u1 * 2 * Math.PI;
  const distM = maskRadiusM * (0.25 + u2 * 0.7);
  const noisy = offsetMeters(realLat, realLng, angle, distM);
  return {
    lat: noisy.lat,
    lng: noisy.lng,
    uncertaintyRadiusM: maskRadiusM,
  };
}
