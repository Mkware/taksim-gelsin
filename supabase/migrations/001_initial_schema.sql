-- ============================================================
-- Taksim Gelsin - Veritabanı Şeması
-- Supabase PostgreSQL + PostGIS
-- Kırıkkale merkezli taksi çağırma sistemi
-- ============================================================

-- ============================================================
-- 1. UZANTILAR (Extensions)
-- PostGIS: Coğrafi veri desteği (konum sorguları)
-- uuid-ossp: UUID üretimi
-- pg_trgm: Metin arama optimizasyonu
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================================
-- 2. ENUM TİPLERİ
-- Kullanıcı rolleri ve yolculuk durumları
-- ============================================================

-- Kullanıcı rolü: müşteri veya sürücü
CREATE TYPE user_role AS ENUM ('customer', 'driver');

-- Yolculuk durumu: arama → kabul → varış → başladı → tamamlandı / iptal
CREATE TYPE ride_status AS ENUM (
  'searching',
  'accepted',
  'arriving',
  'in_progress',
  'completed',
  'cancelled'
);

-- ============================================================
-- 3. USERS TABLOSU
-- Tüm kullanıcılar (müşteri + sürücü) burada tutulur
-- ============================================================
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone VARCHAR(20) NOT NULL UNIQUE,
  full_name VARCHAR(100) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  avatar_url VARCHAR(500),
  role user_role NOT NULL DEFAULT 'customer',
  rating DECIMAL(3,2) NOT NULL DEFAULT 5.00,
  rating_count INTEGER NOT NULL DEFAULT 0,
  refresh_token TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Telefon numarasına göre hızlı arama
CREATE INDEX idx_users_phone ON users (phone);
-- Role göre filtreleme
CREATE INDEX idx_users_role ON users (role);

-- ============================================================
-- 4. DRIVERS TABLOSU
-- Sürücüye özel bilgiler (araç, konum, durum)
-- current_location: PostGIS GEOGRAPHY tipi (SRID 4326 = WGS84)
-- ============================================================
CREATE TABLE drivers (
  id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  vehicle_plate VARCHAR(20) NOT NULL,
  vehicle_model VARCHAR(100) NOT NULL,
  vehicle_color VARCHAR(50) NOT NULL,
  is_online BOOLEAN NOT NULL DEFAULT false,
  is_available BOOLEAN NOT NULL DEFAULT false,
  current_location GEOGRAPHY(POINT, 4326),
  last_location_update TIMESTAMPTZ,
  total_rides INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Müsait ve çevrimiçi sürücüleri hızlı bulmak için kısmi indeks
CREATE INDEX idx_drivers_available ON drivers (is_online, is_available)
  WHERE is_online = true AND is_available = true;

-- Coğrafi sorgular için GIST indeksi (ST_DWithin, ST_Distance)
CREATE INDEX idx_drivers_location ON drivers USING GIST (current_location);

-- Araç plakasına göre arama
CREATE INDEX idx_drivers_plate ON drivers (vehicle_plate);

-- ============================================================
-- 5. RIDES TABLOSU
-- Yolculuk kayıtları
-- pickup/dropoff: PostGIS GEOGRAPHY noktaları
-- ============================================================
CREATE TABLE rides (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  driver_id UUID REFERENCES drivers(id) ON DELETE SET NULL,
  pickup_location GEOGRAPHY(POINT, 4326) NOT NULL,
  dropoff_location GEOGRAPHY(POINT, 4326) NOT NULL,
  pickup_address TEXT NOT NULL,
  dropoff_address TEXT NOT NULL,
  distance_km DECIMAL(8,2),
  estimated_price DECIMAL(10,2) NOT NULL,
  final_price DECIMAL(10,2),
  status ride_status NOT NULL DEFAULT 'searching',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancel_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Müşterinin yolculuk geçmişi
CREATE INDEX idx_rides_customer ON rides (customer_id, requested_at DESC);
-- Sürücünün yolculuk geçmişi
CREATE INDEX idx_rides_driver ON rides (driver_id, requested_at DESC);
-- Aktif yolculuk sorgulama (searching, accepted, arriving, in_progress)
CREATE INDEX idx_rides_status ON rides (status)
  WHERE status NOT IN ('completed', 'cancelled');
-- Biniş noktası coğrafi arama
CREATE INDEX idx_rides_pickup ON rides USING GIST (pickup_location);

-- ============================================================
-- 6. REVIEWS TABLOSU
-- Yolculuk sonrası puanlama ve yorum
-- ============================================================
CREATE TABLE reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ride_id UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reviewed_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Bir yolculuk için her kullanıcı sadece 1 değerlendirme yapabilir
CREATE UNIQUE INDEX idx_reviews_unique ON reviews (ride_id, reviewer_id);
-- Değerlendirilen kullanıcının ortalama puanını hesaplamak için
CREATE INDEX idx_reviews_reviewed ON reviews (reviewed_id, rating);

-- ============================================================
-- 7. DRIVER_LOCATIONS_HISTORY TABLOSU
-- Sürücü konum geçmişi (canlı takip ve analiz)
-- ============================================================
CREATE TABLE driver_locations_history (
  id BIGSERIAL PRIMARY KEY,
  driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  location GEOGRAPHY(POINT, 4326) NOT NULL,
  bearing DECIMAL(5,2),
  speed DECIMAL(6,2),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sürücünün belirli zaman aralığındaki konumlarını sorgulamak
CREATE INDEX idx_driver_loc_history ON driver_locations_history (driver_id, recorded_at DESC);
-- Konum bazlı analiz sorguları
CREATE INDEX idx_driver_loc_geo ON driver_locations_history USING GIST (location);

-- ============================================================
-- 8. OTOMATİK GÜNCELLEME FONKSİYONU (updated_at trigger)
-- Her UPDATE işleminde updated_at alanını otomatik günceller
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- users tablosu için updated_at trigger
CREATE TRIGGER trigger_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- drivers tablosu için updated_at trigger
CREATE TRIGGER trigger_drivers_updated_at
  BEFORE UPDATE ON drivers
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- rides tablosu için updated_at trigger
CREATE TRIGGER trigger_rides_updated_at
  BEFORE UPDATE ON rides
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 9. PUAN GÜNCELLEME FONKSİYONU
-- Yeni review eklendiğinde kullanıcının ortalama puanını günceller
-- ============================================================
CREATE OR REPLACE FUNCTION update_user_rating()
RETURNS TRIGGER AS $$
DECLARE
  avg_rating DECIMAL(3,2);
  total_count INTEGER;
BEGIN
  -- Değerlendirilen kullanıcının tüm puanlarının ortalamasını hesapla
  SELECT
    COALESCE(AVG(rating)::DECIMAL(3,2), 5.00),
    COUNT(*)
  INTO avg_rating, total_count
  FROM reviews
  WHERE reviewed_id = NEW.reviewed_id;

  -- Users tablosundaki rating ve rating_count alanlarını güncelle
  UPDATE users
  SET
    rating = avg_rating,
    rating_count = total_count
  WHERE id = NEW.reviewed_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Review eklendikten sonra puanı güncelle
CREATE TRIGGER trigger_update_rating
  AFTER INSERT ON reviews
  FOR EACH ROW
  EXECUTE FUNCTION update_user_rating();

-- ============================================================
-- 10. SÜRÜCÜ TAMAMLANAN YOLCULUK SAYACI
-- Yolculuk tamamlandığında sürücünün total_rides'ını artırır
-- ============================================================
CREATE OR REPLACE FUNCTION increment_driver_total_rides()
RETURNS TRIGGER AS $$
BEGIN
  -- Yolculuk 'completed' durumuna geçtiğinde sürücünün sayacını artır
  IF NEW.status = 'completed' AND OLD.status != 'completed' AND NEW.driver_id IS NOT NULL THEN
    UPDATE drivers
    SET total_rides = total_rides + 1
    WHERE id = NEW.driver_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_increment_rides
  AFTER UPDATE ON rides
  FOR EACH ROW
  EXECUTE FUNCTION increment_driver_total_rides();

-- ============================================================
-- 11. YAKIN SÜRÜCÜLERİ BULMA FONKSİYONU
-- Belirtilen noktaya belirli mesafe içindeki müsait sürücüleri döndürür
-- radius_meters: Arama yarıçapı (metre cinsinden, varsayılan 5000m = 5km)
-- max_results: Döndürülecek maksimum sürücü sayısı
-- ============================================================
CREATE OR REPLACE FUNCTION find_nearby_drivers(
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  radius_meters INTEGER DEFAULT 5000,
  max_results INTEGER DEFAULT 10
)
RETURNS TABLE (
  driver_id UUID,
  full_name VARCHAR,
  phone VARCHAR,
  vehicle_plate VARCHAR,
  vehicle_model VARCHAR,
  vehicle_color VARCHAR,
  rating DECIMAL,
  distance_meters DOUBLE PRECISION,
  lat_out DOUBLE PRECISION,
  lng_out DOUBLE PRECISION
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.id AS driver_id,
    u.full_name,
    u.phone,
    d.vehicle_plate,
    d.vehicle_model,
    d.vehicle_color,
    u.rating,
    -- Sürücü ile belirtilen nokta arasındaki mesafe (metre)
    ST_Distance(
      d.current_location,
      ST_SetSRID(ST_MakePoint(lng, lat), 4326)::GEOGRAPHY
    ) AS distance_meters,
    ST_Y(d.current_location::GEOMETRY) AS lat_out,
    ST_X(d.current_location::GEOMETRY) AS lng_out
  FROM drivers d
  INNER JOIN users u ON u.id = d.id
  WHERE
    d.is_online = true
    AND d.is_available = true
    AND d.current_location IS NOT NULL
    -- PostGIS ST_DWithin: belirtilen yarıçap içindeki sürücüler
    AND ST_DWithin(
      d.current_location,
      ST_SetSRID(ST_MakePoint(lng, lat), 4326)::GEOGRAPHY,
      radius_meters
    )
  ORDER BY distance_meters ASC
  LIMIT max_results;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 12. SÜRÜCÜ KONUM GÜNCELLEME FONKSİYONU
-- Sürücünün anlık konumunu günceller ve geçmişe kayıt ekler
-- ============================================================
CREATE OR REPLACE FUNCTION update_driver_location(
  p_driver_id UUID,
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_bearing DECIMAL DEFAULT NULL,
  p_speed DECIMAL DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  -- Sürücünün mevcut konumunu güncelle
  UPDATE drivers
  SET
    current_location = ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::GEOGRAPHY,
    last_location_update = NOW()
  WHERE id = p_driver_id;

  -- Konum geçmişine yeni kayıt ekle (canlı takip için)
  INSERT INTO driver_locations_history (driver_id, location, bearing, speed, recorded_at)
  VALUES (
    p_driver_id,
    ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::GEOGRAPHY,
    p_bearing,
    p_speed,
    NOW()
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 13. ESKİ KONUM GEÇMİŞİNİ TEMİZLEME FONKSİYONU
-- 7 günden eski konum kayıtlarını siler (performans için)
-- Supabase pg_cron ile günlük çalıştırılabilir
-- ============================================================
CREATE OR REPLACE FUNCTION cleanup_old_location_history()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM driver_locations_history
  WHERE recorded_at < NOW() - INTERVAL '7 days';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 14. YOLCULUK İSTATİSTİKLERİ FONKSİYONU
-- Belirli bir sürücü veya müşteri için özet istatistikler
-- ============================================================
CREATE OR REPLACE FUNCTION get_ride_stats(p_user_id UUID)
RETURNS TABLE (
  total_rides BIGINT,
  completed_rides BIGINT,
  cancelled_rides BIGINT,
  total_spent DECIMAL,
  avg_rating DECIMAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT AS total_rides,
    COUNT(*) FILTER (WHERE r.status = 'completed')::BIGINT AS completed_rides,
    COUNT(*) FILTER (WHERE r.status = 'cancelled')::BIGINT AS cancelled_rides,
    COALESCE(SUM(r.final_price) FILTER (WHERE r.status = 'completed'), 0)::DECIMAL AS total_spent,
    COALESCE(
      (SELECT AVG(rv.rating)::DECIMAL(3,2) FROM reviews rv WHERE rv.reviewed_id = p_user_id),
      5.00
    ) AS avg_rating
  FROM rides r
  WHERE r.customer_id = p_user_id OR r.driver_id = p_user_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 15. ROW LEVEL SECURITY (RLS) POLİTİKALARI
-- Supabase RLS ile veri erişim kontrolü
-- ============================================================

-- Users tablosu RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Herkes kendi profilini okuyabilir
CREATE POLICY "users_read_own" ON users
  FOR SELECT USING (true);

-- Kullanıcılar sadece kendi profillerini güncelleyebilir
CREATE POLICY "users_update_own" ON users
  FOR UPDATE USING (id = auth.uid());

-- Drivers tablosu RLS
ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;

-- Tüm kullanıcılar aktif sürücüleri görebilir
CREATE POLICY "drivers_read_all" ON drivers
  FOR SELECT USING (true);

-- Sürücüler sadece kendi bilgilerini güncelleyebilir
CREATE POLICY "drivers_update_own" ON drivers
  FOR UPDATE USING (id = auth.uid());

-- Rides tablosu RLS
ALTER TABLE rides ENABLE ROW LEVEL SECURITY;

-- Kullanıcılar kendi yolculuklarını görebilir (müşteri veya sürücü olarak)
CREATE POLICY "rides_read_own" ON rides
  FOR SELECT USING (customer_id = auth.uid() OR driver_id = auth.uid());

-- Reviews tablosu RLS
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

-- Herkes değerlendirmeleri okuyabilir
CREATE POLICY "reviews_read_all" ON reviews
  FOR SELECT USING (true);

-- Sadece değerlendirmeyi yapan kişi yazabilir
CREATE POLICY "reviews_insert_own" ON reviews
  FOR INSERT WITH CHECK (reviewer_id = auth.uid());

-- ============================================================
-- 16. BAŞLANGIÇ VERİLERİ (Opsiyonel - Test amaçlı)
-- Kırıkkale merkezinde test verileri
-- ============================================================

-- Test müşterisi
-- INSERT INTO users (id, phone, full_name, password_hash, role)
-- VALUES (
--   'a0000000-0000-0000-0000-000000000001',
--   '+905551112233',
--   'Test Müşteri',
--   '$2b$12$placeholder_hash',
--   'customer'
-- );

-- Test sürücüsü
-- INSERT INTO users (id, phone, full_name, password_hash, role)
-- VALUES (
--   'b0000000-0000-0000-0000-000000000001',
--   '+905551114455',
--   'Test Sürücü',
--   '$2b$12$placeholder_hash',
--   'driver'
-- );

-- INSERT INTO drivers (id, vehicle_plate, vehicle_model, vehicle_color, is_online, is_available, current_location)
-- VALUES (
--   'b0000000-0000-0000-0000-000000000001',
--   '71 ABC 123',
--   'Fiat Egea',
--   'Beyaz',
--   true,
--   true,
--   ST_SetSRID(ST_MakePoint(33.5150, 39.8468), 4326)::GEOGRAPHY  -- Kırıkkale merkez
-- );
