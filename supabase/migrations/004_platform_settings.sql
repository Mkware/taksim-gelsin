-- Tek satırlık platform ayarları (JSON). Backend service_role ile yazar/okur.
CREATE TABLE IF NOT EXISTS public.platform_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.platform_settings (id, settings)
VALUES ('default', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.platform_settings IS 'Uygulama operasyon parametreleri — admin panelinden yönetilir; env ile birleştirilir.';

-- Güvenlik: istemci anahtarlarıyla doğrudan erişimi kapat.
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

-- Ek güvence: anon/authenticated rollerinin tablo yetkilerini kaldır.
REVOKE ALL ON TABLE public.platform_settings FROM anon, authenticated;