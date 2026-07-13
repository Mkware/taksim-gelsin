-- 1. Sürücülerin güncel bakiyesini / borcunu takip etmek için alan
ALTER TABLE drivers ADD COLUMN balance DECIMAL(10,2) NOT NULL DEFAULT 0;

-- 2. Her yolculuk için kesilen spesifik platform ücretini loglamak için alan
ALTER TABLE rides ADD COLUMN platform_fee DECIMAL(10,2) NOT NULL DEFAULT 0;

-- 3. Bakiye düşmek için atomic RPC fonksiyonu
CREATE OR REPLACE FUNCTION deduct_driver_balance(p_driver_id UUID, p_amount DECIMAL)
RETURNS VOID AS $$
BEGIN
  UPDATE drivers
  SET balance = balance - p_amount
  WHERE id = p_driver_id;
END;
$$ LANGUAGE plpgsql;

-- 4. Bakiye eklemek/sıfırlamak için atomic RPC fonksiyonu (Admin paneli için)
CREATE OR REPLACE FUNCTION add_driver_balance(p_driver_id UUID, p_amount DECIMAL)
RETURNS VOID AS $$
BEGIN
  UPDATE drivers
  SET balance = balance + p_amount
  WHERE id = p_driver_id;
END;
$$ LANGUAGE plpgsql;
