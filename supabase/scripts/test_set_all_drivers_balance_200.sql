-- TEST: Önce şema (balance + platform_fee + RPC), sonra tüm sürücülere 200 T Coin.
-- Supabase SQL Editor’da tek sefer çalıştırın.

-- 1) drivers.balance yoksa ekle
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'drivers'
      AND column_name = 'balance'
  ) THEN
    ALTER TABLE public.drivers
      ADD COLUMN balance DECIMAL(10, 2) NOT NULL DEFAULT 0;
  END IF;
END $$;

-- 2) rides.platform_fee yoksa ekle (backend kabul ücreti için)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'rides'
      AND column_name = 'platform_fee'
  ) THEN
    ALTER TABLE public.rides
      ADD COLUMN platform_fee DECIMAL(10, 2) NOT NULL DEFAULT 0;
  END IF;
END $$;

-- 3) Kabul ücreti için güvenli kesinti / iade (003 ile uyumlu)
CREATE OR REPLACE FUNCTION try_deduct_driver_balance(p_driver_id UUID, p_amount DECIMAL)
RETURNS BOOLEAN AS $$
DECLARE
  n INTEGER;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN TRUE;
  END IF;
  UPDATE public.drivers
  SET balance = balance - p_amount
  WHERE id = p_driver_id AND balance >= p_amount;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION refund_driver_balance(p_driver_id UUID, p_amount DECIMAL)
RETURNS VOID AS $$
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN;
  END IF;
  UPDATE public.drivers SET balance = balance + p_amount WHERE id = p_driver_id;
END;
$$ LANGUAGE plpgsql;

-- 4) Tüm sürücülere test bakiyesi
UPDATE public.drivers
SET balance = 200::decimal;
