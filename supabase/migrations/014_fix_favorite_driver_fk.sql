-- 013'te customer_favorite_drivers.driver_id yanlışlıkla users(id) referans alıyordu.
-- Değer olarak doğruydu (drivers.id = users.id, 1:1) ama PostgREST'in embedded select
-- (`drivers:driver_id (...)`) için customer_favorite_drivers <-> drivers arasında
-- keşfedilebilir bir FK ilişkisi gerekiyor — users'a referans bu ilişkiyi kurmuyor,
-- GET /users/me/favorite-drivers "Could not find a relationship..." ile 500 veriyordu.

ALTER TABLE customer_favorite_drivers
  DROP CONSTRAINT IF EXISTS customer_favorite_drivers_driver_id_fkey;

ALTER TABLE customer_favorite_drivers
  ADD CONSTRAINT customer_favorite_drivers_driver_id_fkey
  FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE;

INSERT INTO schema_migrations (filename) VALUES ('014_fix_favorite_driver_fk.sql') ON CONFLICT (filename) DO NOTHING;
