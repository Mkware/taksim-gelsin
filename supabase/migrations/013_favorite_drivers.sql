-- Favori sürücü çağırma
-- Her sürücüye benzersiz kısa kod (favorileme anahtarı — telefon numarası DEĞİL, hiçbir
-- yerde enumeration riski taşımaz) + müşterinin favori sürücüleri tablosu.

ALTER TABLE drivers ADD COLUMN IF NOT EXISTS driver_code VARCHAR(4);

-- Mevcut sürücüleri sırayla doldur (deterministik, çakışmasız)
UPDATE drivers d
SET driver_code = lpad(sub.rn::text, 4, '0')
FROM (
  SELECT id, row_number() OVER (ORDER BY created_at) AS rn
  FROM drivers
  WHERE driver_code IS NULL
) sub
WHERE d.id = sub.id;

ALTER TABLE drivers ALTER COLUMN driver_code SET NOT NULL;
ALTER TABLE drivers ADD CONSTRAINT drivers_driver_code_unique UNIQUE (driver_code);

CREATE TABLE IF NOT EXISTS customer_favorite_drivers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  driver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT customer_favorite_drivers_unique UNIQUE (customer_id, driver_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_favorite_drivers_customer ON customer_favorite_drivers (customer_id);

-- RLS: device_push_tokens ile aynı desen — policy yok → anon/authenticated erişemez,
-- yalnızca backend (service_role) yazar/okur.
ALTER TABLE customer_favorite_drivers ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE customer_favorite_drivers IS
  'Müşterinin favori sürücüleri (maks. 3 — uygulama katmanında zorlanır). Yalnızca backend (service_role) yönetir.';

INSERT INTO schema_migrations (filename) VALUES ('013_favorite_drivers.sql') ON CONFLICT (filename) DO NOTHING;
