-- Fonksiyonları kaldır
DROP FUNCTION IF EXISTS deduct_driver_balance(UUID, DECIMAL);
DROP FUNCTION IF EXISTS add_driver_balance(UUID, DECIMAL);

-- Eklenen kolonları kaldır
ALTER TABLE rides DROP COLUMN IF EXISTS platform_fee;
ALTER TABLE drivers DROP COLUMN IF EXISTS balance;
