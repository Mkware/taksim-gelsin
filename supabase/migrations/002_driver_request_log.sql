-- ============================================================
-- Migration: driver_request_log tablosu + record_driver_request RPC
-- Dosya: supabase/migrations/002_driver_request_log.sql
-- ============================================================

-- 1. Tablo: Sürücüye gelen her istek kaydedilir
CREATE TABLE IF NOT EXISTS driver_request_log (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id   UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ride_id     UUID        REFERENCES rides(id) ON DELETE SET NULL,
  accepted    BOOLEAN     NOT NULL,
  reason      TEXT        CHECK (reason IN ('accepted', 'rejected', 'timeout')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. İndeksler
CREATE INDEX idx_drl_driver_id   ON driver_request_log (driver_id, created_at DESC);
CREATE INDEX idx_drl_created_at  ON driver_request_log (created_at DESC);

-- 3. RPC: Sürücü isteğini kaydet + kabul oranını güncelle
CREATE OR REPLACE FUNCTION record_driver_request(
  p_driver_id UUID,
  p_accepted  BOOLEAN,
  p_reason    TEXT DEFAULT 'accepted',
  p_ride_id   UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total     INT;
  v_accepted  INT;
  v_rate      NUMERIC;
BEGIN
  -- İstek loguna yaz
  INSERT INTO driver_request_log (driver_id, ride_id, accepted, reason)
  VALUES (p_driver_id, p_ride_id, p_accepted, p_reason);

  -- Son 30 istek üzerinden kabul oranını hesapla
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE accepted = TRUE)
  INTO v_total, v_accepted
  FROM (
    SELECT accepted
    FROM driver_request_log
    WHERE driver_id = p_driver_id
    ORDER BY created_at DESC
    LIMIT 30
  ) recent;

  IF v_total > 0 THEN
    v_rate := v_accepted::NUMERIC / v_total;
  ELSE
    v_rate := 0.8; -- varsayılan
  END IF;

  -- drivers tablosuna kabul oranını yaz
  -- Not: drivers tablosuna acceptance_rate sütunu eklenmeli (aşağıda)
  UPDATE drivers
  SET acceptance_rate = v_rate
  WHERE id = p_driver_id;

END;
$$;

-- 4. drivers tablosuna acceptance_rate sütunu ekle
ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS acceptance_rate NUMERIC(4,3) DEFAULT 0.800;

-- 5. Eski logları temizle (30 günden eski)
-- pg_cron kuruluysa scheduler eklenebilir:
-- SELECT cron.schedule('cleanup-request-log', '0 3 * * *',
--   'DELETE FROM driver_request_log WHERE created_at < NOW() - INTERVAL ''30 days''');

-- 6. RLS Politikaları
ALTER TABLE driver_request_log ENABLE ROW LEVEL SECURITY;

-- Servis role bypass (backend supabaseAdmin kullanır)
CREATE POLICY "service_role_all" ON driver_request_log
  FOR ALL USING (auth.role() = 'service_role');

-- Sürücü sadece kendi logunu görebilir
CREATE POLICY "driver_own_log" ON driver_request_log
  FOR SELECT USING (driver_id = auth.uid());

-- ============================================================
-- KONTROL SORGUSU
-- ============================================================
-- SELECT
--   d.id,
--   u.full_name,
--   d.acceptance_rate,
--   COUNT(drl.id) AS total_requests,
--   COUNT(drl.id) FILTER (WHERE drl.accepted) AS accepted_count
-- FROM drivers d
-- JOIN users u ON u.id = d.id
-- LEFT JOIN driver_request_log drl ON drl.driver_id = d.id
-- GROUP BY d.id, u.full_name, d.acceptance_rate
-- ORDER BY d.acceptance_rate ASC;
