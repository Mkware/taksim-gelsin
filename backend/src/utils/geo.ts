/**
 * Coğrafi yardımcılar
 * PostGIS `GEOGRAPHY(POINT, 4326)` sütunları Supabase REST üzerinden
 * EWKB hex string olarak döner. Bu yardımcı o hex'i parse edip {lat, lng} üretir.
 *
 * EWKB POINT formatı (little endian):
 *   [byte 0]       endian (01 = LE)
 *   [byte 1-4]     type (0x20000001 = POINT + SRID flag)
 *   [byte 5-8]     SRID (genelde 4326)
 *   [byte 9-16]    X (lng) — double LE
 *   [byte 17-24]   Y (lat) — double LE
 *
 * Not: PostGIS bazen SRID flag'siz WKB (21 byte) de dönebilir.
 * Bu durumda SRID bölümü atlanır.
 */

export interface Point {
  lat: number;
  lng: number;
}

/**
 * Supabase'ten dönen EWKB hex string'ini {lat, lng}'e çevirir.
 * Başarısız olursa null döner (bozuk veri ve eski kayıtlara karşı güvenli).
 */
export function decodeEwkbPoint(value: unknown): Point | null {
  if (!value || typeof value !== 'string') return null;
  const hex = value.trim();
  // En kısa geçerli WKB POINT: 1 + 4 + 16 = 21 byte (42 hex)
  if (hex.length < 42) return null;

  try {
    const buf = Buffer.from(hex, 'hex');
    const endian = buf.readUInt8(0); // 0 = BE, 1 = LE
    const isLE = endian === 1;
    const typeRaw = isLE ? buf.readUInt32LE(1) : buf.readUInt32BE(1);

    // SRID flag: 0x20000000
    const hasSrid = (typeRaw & 0x20000000) !== 0;
    const coordStart = 1 + 4 + (hasSrid ? 4 : 0);

    if (buf.length < coordStart + 16) return null;

    const lng = isLE ? buf.readDoubleLE(coordStart) : buf.readDoubleBE(coordStart);
    const lat = isLE ? buf.readDoubleLE(coordStart + 8) : buf.readDoubleBE(coordStart + 8);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    // Makul sınırlar: enlem [-90, 90], boylam [-180, 180]
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

    return { lat, lng };
  } catch {
    return null;
  }
}
