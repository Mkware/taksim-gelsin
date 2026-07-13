-- ============================================================
-- Taksim Gelsin - Test Verileri (Seed Data)
-- Kırıkkale merkezinde örnek kullanıcılar ve sürücüler
-- ============================================================
-- NOT: Bu dosya sadece geliştirme ortamında çalıştırılmalıdır.
-- Şifre hash'leri bcrypt ile üretilmiştir (şifre: "123456")
-- ============================================================

-- Test müşterisi 1
INSERT INTO users (id, phone, full_name, password_hash, role) VALUES
  ('a0000000-0000-0000-0000-000000000001', '+905551112233', 'Ahmet Yılmaz', '$2b$12$LJ3m5SZxLh5r8X1KkO0nNeYV7Kv0j8F3aQP5Rk6R8Y1jQxV3mZYe2', 'customer'),
  ('a0000000-0000-0000-0000-000000000002', '+905551113344', 'Ayşe Demir', '$2b$12$LJ3m5SZxLh5r8X1KkO0nNeYV7Kv0j8F3aQP5Rk6R8Y1jQxV3mZYe2', 'customer'),
  ('a0000000-0000-0000-0000-000000000003', '+905551115566', 'Fatma Kaya', '$2b$12$LJ3m5SZxLh5r8X1KkO0nNeYV7Kv0j8F3aQP5Rk6R8Y1jQxV3mZYe2', 'customer');

-- Test sürücüsü 1-5
INSERT INTO users (id, phone, full_name, password_hash, role) VALUES
  ('b0000000-0000-0000-0000-000000000001', '+905552221100', 'Mehmet Öztürk', '$2b$12$LJ3m5SZxLh5r8X1KkO0nNeYV7Kv0j8F3aQP5Rk6R8Y1jQxV3mZYe2', 'driver'),
  ('b0000000-0000-0000-0000-000000000002', '+905552221101', 'Ali Çelik', '$2b$12$LJ3m5SZxLh5r8X1KkO0nNeYV7Kv0j8F3aQP5Rk6R8Y1jQxV3mZYe2', 'driver'),
  ('b0000000-0000-0000-0000-000000000003', '+905552221102', 'Hasan Aydın', '$2b$12$LJ3m5SZxLh5r8X1KkO0nNeYV7Kv0j8F3aQP5Rk6R8Y1jQxV3mZYe2', 'driver'),
  ('b0000000-0000-0000-0000-000000000004', '+905552221103', 'Mustafa Şahin', '$2b$12$LJ3m5SZxLh5r8X1KkO0nNeYV7Kv0j8F3aQP5Rk6R8Y1jQxV3mZYe2', 'driver'),
  ('b0000000-0000-0000-0000-000000000005', '+905552221104', 'İbrahim Koç', '$2b$12$LJ3m5SZxLh5r8X1KkO0nNeYV7Kv0j8F3aQP5Rk6R8Y1jQxV3mZYe2', 'driver');

-- Sürücü araç bilgileri (Kırıkkale merkez civarında konumlar)
-- Kırıkkale merkez: 39.8468°N, 33.5150°E
INSERT INTO drivers (id, vehicle_plate, vehicle_model, vehicle_color, is_online, is_available, current_location) VALUES
  (
    'b0000000-0000-0000-0000-000000000001',
    '71 AB 001',
    'Fiat Egea',
    'Beyaz',
    true, true,
    ST_SetSRID(ST_MakePoint(33.5150, 39.8468), 4326)::GEOGRAPHY
  ),
  (
    'b0000000-0000-0000-0000-000000000002',
    '71 CD 002',
    'Toyota Corolla',
    'Gri',
    true, true,
    ST_SetSRID(ST_MakePoint(33.5180, 39.8490), 4326)::GEOGRAPHY
  ),
  (
    'b0000000-0000-0000-0000-000000000003',
    '71 EF 003',
    'Renault Megane',
    'Siyah',
    true, true,
    ST_SetSRID(ST_MakePoint(33.5120, 39.8450), 4326)::GEOGRAPHY
  ),
  (
    'b0000000-0000-0000-0000-000000000004',
    '71 GH 004',
    'Hyundai i20',
    'Mavi',
    true, false,
    ST_SetSRID(ST_MakePoint(33.5200, 39.8500), 4326)::GEOGRAPHY
  ),
  (
    'b0000000-0000-0000-0000-000000000005',
    '71 IJ 005',
    'Volkswagen Passat',
    'Lacivert',
    false, false,
    ST_SetSRID(ST_MakePoint(33.5100, 39.8430), 4326)::GEOGRAPHY
  );
