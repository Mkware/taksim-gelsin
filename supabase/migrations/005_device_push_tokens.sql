-- FCM / APNs cihaz token'ları — sürücüye yolculuk çağrısı push bildirimi için
CREATE TABLE IF NOT EXISTS device_push_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  platform VARCHAR(16) NOT NULL CHECK (platform IN ('android', 'ios', 'web')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT device_push_tokens_token_unique UNIQUE (token)
);

CREATE INDEX IF NOT EXISTS idx_device_push_tokens_user_id ON device_push_tokens (user_id);

-- RLS: anon / authenticated (PostgREST) ile doğrudan okuma-yazma yok.
-- Politika tanımlanmadığı için bu rollere erişim kapalıdır.
-- Node API yalnızca service_role ile yazar; service_role RLS'yi atlar.
ALTER TABLE device_push_tokens ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE device_push_tokens IS
  'FCM cihaz tokenları. Yalnızca backend (Supabase service_role) yönetir; istemci SDK erişimi RLS ile kapalı.';
