-- Tek cihaz oturumu: JWT içindeki sürüm ile users.session_version eşleşmeli.
-- Supabase SQL Editor'da bir kez çalıştırın.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS session_version integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.users.session_version IS 'Her yeni girişte artar; JWT ile karşılaştırılır.';
