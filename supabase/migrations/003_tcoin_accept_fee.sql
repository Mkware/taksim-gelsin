-- T Coin (balance) ile güvenli kesinti / iade (sürücü kabul ücreti)
CREATE OR REPLACE FUNCTION try_deduct_driver_balance(p_driver_id UUID, p_amount DECIMAL)
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

CREATE OR REPLACE FUNCTION refund_driver_balance(p_driver_id UUID, p_amount DECIMAL)
RETURNS VOID AS $$
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN;
  END IF;
  UPDATE drivers SET balance = balance + p_amount WHERE id = p_driver_id;
END;
$$ LANGUAGE plpgsql;
