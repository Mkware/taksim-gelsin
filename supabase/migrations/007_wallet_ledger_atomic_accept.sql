-- 007: Cüzdan veri tutarlılığı
--   1. Append-only cüzdan hareket defteri (wallet_transactions)
--   2. Negatif bakiye engeli (CHECK balance >= 0)
--   3. Müşteri başına tek aktif yolculuk (partial unique index)
--   4. Eski güvensiz deduct_driver_balance → negatif korumalı
--   5. Atomik kabul + ücret kesintisi + ledger (accept_ride_with_fee)
--   6. Idempotent iade (refund_ride_accept_fee)
--
-- NOT: Migration'lar Supabase SQL editöründe alfabetik sırayla MANUEL uygulanır.
-- Eğer 3. adımdaki unique index, mevcut veride bir müşteriye ait birden fazla
-- aktif yolculuk olduğu için başarısız olursa, önce o tutarsız kayıtları temizleyin.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Append-only cüzdan hareket defteri
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id       UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  ride_id         UUID REFERENCES rides(id) ON DELETE SET NULL,
  type            TEXT NOT NULL,            -- accept_fee | refund | admin_topup | admin_adjust | card_topup
  amount          DECIMAL(10,2) NOT NULL,   -- işaretli: kesinti negatif, kredi pozitif
  balance_after   DECIMAL(10,2),
  reason          TEXT,
  idempotency_key TEXT UNIQUE,              -- aynı işlemin iki kez işlenmesini engeller
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wallet_tx_driver ON wallet_transactions(driver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_ride   ON wallet_transactions(ride_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Negatif bakiye DB seviyesinde imkânsız
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE drivers DROP CONSTRAINT IF EXISTS drivers_balance_nonneg;
ALTER TABLE drivers ADD CONSTRAINT drivers_balance_nonneg CHECK (balance >= 0);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Müşteri başına tek aktif yolculuk — uygulama kontrolünü DB ile pekiştir
-- ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uniq_customer_active_ride
  ON rides(customer_id)
  WHERE status IN ('searching', 'accepted', 'arriving', 'in_progress');

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Eski güvensiz deduct fonksiyonunu negatif korumalı hale getir
--    (Backend bunu çağırmıyor; doğrudan/script çağrılarına karşı güvenlik.)
--    002_add_driver_balance.sql bu fonksiyonu RETURNS VOID olarak tanımlamıştı;
--    Postgres CREATE OR REPLACE ile dönüş tipi değişikliğine izin vermiyor
--    ("cannot change return type of existing function") — önce DROP şart.
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS deduct_driver_balance(UUID, DECIMAL);
CREATE OR REPLACE FUNCTION deduct_driver_balance(p_driver_id UUID, p_amount DECIMAL)
RETURNS BOOLEAN AS $$
DECLARE
  n INTEGER;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN TRUE;
  END IF;
  UPDATE drivers
  SET balance = balance - p_amount
  WHERE id = p_driver_id AND balance >= p_amount;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. ATOMİK kabul + ücret kesintisi + ledger — hepsi tek transaction
--
-- Sıra önemli: önce koşullu kabul (searching → accepted, ilk gelen kazanır).
-- Kabul başarısızsa hiç kesinti yapılmaz. Bakiye yetersizse RAISE ile tüm
-- transaction (kabul dahil) geri alınır; böylece "kestik ama kabul olmadı"
-- ya da "kabul oldu ama iade gerekti" yarışları tamamen ortadan kalkar.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION accept_ride_with_fee(
  p_ride_id         UUID,
  p_driver_id       UUID,
  p_fee             DECIMAL,
  p_pickup_pin      TEXT,
  p_idempotency_key TEXT
)
RETURNS JSONB AS $$
DECLARE
  v_ride        rides%ROWTYPE;
  v_new_balance DECIMAL(10,2);
  v_deducted    INTEGER;
BEGIN
  -- 1) Koşullu kabul — atomik "ilk gelen kazanır"
  UPDATE rides
  SET status                   = 'accepted',
      driver_id                = p_driver_id,
      accepted_at              = now(),
      pickup_verification_code = p_pickup_pin,
      pickup_code_verified     = false,
      platform_fee             = COALESCE(p_fee, 0)
  WHERE id = p_ride_id AND status = 'searching' AND driver_id IS NULL
  RETURNING * INTO v_ride;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'RIDE_UNAVAILABLE');
  END IF;

  -- 2) Ücret kesintisi (guarded). Yetersizse exception → tüm transaction rollback.
  IF p_fee IS NOT NULL AND p_fee > 0 THEN
    UPDATE drivers
    SET balance = balance - p_fee
    WHERE id = p_driver_id AND balance >= p_fee
    RETURNING balance INTO v_new_balance;
    GET DIAGNOSTICS v_deducted = ROW_COUNT;

    IF v_deducted = 0 THEN
      RAISE EXCEPTION 'INSUFFICIENT_BALANCE' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO wallet_transactions(driver_id, ride_id, type, amount, balance_after, reason, idempotency_key)
    VALUES (p_driver_id, p_ride_id, 'accept_fee', -p_fee, v_new_balance, 'ride accept fee', p_idempotency_key)
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  -- 3) Sürücüyü meşgul yap
  UPDATE drivers SET is_available = false WHERE id = p_driver_id;

  RETURN jsonb_build_object(
    'ok', true,
    'ride', jsonb_build_object(
      'id',                        v_ride.id,
      'customer_id',               v_ride.customer_id,
      'driver_id',                 v_ride.driver_id,
      'status',                    v_ride.status,
      'estimated_price',           v_ride.estimated_price,
      'final_price',               v_ride.final_price,
      'platform_fee',              v_ride.platform_fee,
      'requested_at',              v_ride.requested_at,
      'accepted_at',               v_ride.accepted_at,
      'pickup_address',            v_ride.pickup_address,
      'dropoff_address',           v_ride.dropoff_address,
      'distance_km',               v_ride.distance_km,
      'pickup_verification_code',  v_ride.pickup_verification_code,
      'pickup_code_verified',      v_ride.pickup_code_verified
    )
  );
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    -- Yetersiz bakiye: kabul güncellemesi dahil tüm değişiklikler geri alınır.
    RETURN jsonb_build_object('ok', false, 'code', 'INSUFFICIENT_BALANCE');
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. IDEMPOTENT iade — aynı idempotency_key ile iki kez çağrılsa bile tek kredi
--
-- Ledger INSERT'i (UNIQUE idempotency_key) kilit/gate görevi görür: önce ekle,
-- yalnızca satır gerçekten eklendiyse bakiyeyi artır. Böylece eşzamanlı tekrar
-- çağrılar çift krediye yol açmaz.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION refund_ride_accept_fee(
  p_driver_id       UUID,
  p_ride_id         UUID,
  p_amount          DECIMAL,
  p_idempotency_key TEXT,
  p_reason          TEXT DEFAULT 'ride accept fee refund'
)
RETURNS JSONB AS $$
DECLARE
  v_new_balance DECIMAL(10,2);
  v_inserted    INTEGER;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true);
  END IF;
  IF p_idempotency_key IS NULL OR p_idempotency_key = '' THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_REQUIRED' USING ERRCODE = 'P0002';
  END IF;

  -- Önce ledger satırını ekle (idempotency gate). Çakışırsa zaten işlenmiştir.
  INSERT INTO wallet_transactions(driver_id, ride_id, type, amount, reason, idempotency_key)
  VALUES (p_driver_id, p_ride_id, 'refund', p_amount, p_reason, p_idempotency_key)
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted = 0 THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true);
  END IF;

  UPDATE drivers
  SET balance = balance + p_amount
  WHERE id = p_driver_id
  RETURNING balance INTO v_new_balance;

  IF NOT FOUND THEN
    -- Sürücü yok: ledger satırını geri al (gate tutarlı kalsın)
    DELETE FROM wallet_transactions WHERE idempotency_key = p_idempotency_key;
    RETURN jsonb_build_object('ok', false, 'code', 'DRIVER_NOT_FOUND');
  END IF;

  UPDATE wallet_transactions
  SET balance_after = v_new_balance
  WHERE idempotency_key = p_idempotency_key;

  RETURN jsonb_build_object('ok', true, 'balance_after', v_new_balance);
EXCEPTION
  WHEN SQLSTATE 'P0002' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_KEY_REQUIRED');
END;
$$ LANGUAGE plpgsql;
