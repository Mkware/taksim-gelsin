-- 005, RLS olmadan uygulandıysa: aynı tabloda RLS'yi açar (idempotent).
-- Yeni kurulumlarda 005 zaten RLS açtığı için bu adım zararsız tekrar.

ALTER TABLE IF EXISTS device_push_tokens ENABLE ROW LEVEL SECURITY;
