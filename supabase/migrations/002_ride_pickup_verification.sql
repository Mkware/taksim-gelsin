-- Biniş doğrulama: yolcuya 4 haneli kod, sürücü doğrulayınca varış navigasyonu
ALTER TABLE rides
  ADD COLUMN IF NOT EXISTS pickup_verification_code CHAR(4),
  ADD COLUMN IF NOT EXISTS pickup_code_verified BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN rides.pickup_verification_code IS 'Sürücü kabulünde üretilen PIN; yolcu sürücüye söyler.';
COMMENT ON COLUMN rides.pickup_code_verified IS 'Atanan sürücü PIN doğruladıysa true.';
