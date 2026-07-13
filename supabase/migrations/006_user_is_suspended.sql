-- Müşteri / kullanıcı hesabı askıya alma (admin paneli)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_users_suspended ON users (is_suspended)
  WHERE is_suspended = true;

COMMENT ON COLUMN users.is_suspended IS 'true ise giriş ve API erişimi engellenir (admin).';
