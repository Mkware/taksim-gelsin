-- Migration takibi (Faz 3, madde 9 — bkz. docs/KOD_ANALIZI_VE_YOL_HARITASI_2026-07-12.md).
--
-- Bu turda iki gerçek hata bulundu (007'deki deduct_driver_balance dönüş tipi
-- çakışması, eksik session_version kolonu) — ikisi de canlı Supabase'de SQL
-- editöründen elle düzeltilmiş/eklenmiş ama migration dosyalarına hiç
-- yansımamıştı. Sebep: hangi migration'ın gerçekten uygulandığının hiçbir
-- kaydı yok.
--
-- Supabase CLI'ya geçmek (yerel Docker stack + `supabase link` vb.) daha ağır
-- bir iş akışı değişikliği; onun yerine mevcut "SQL editöründen elle, dosyayı
-- olduğu gibi çalıştır" akışını koruyan hafif bir çözüm: bu tablo + KURAL —
-- BUNDAN SONRAKİ HER YENİ MİGRATION DOSYASI, EN SONUNDA KENDİSİNİ BU TABLOYA
-- KAYDETMELİ:
--
--   INSERT INTO schema_migrations (filename) VALUES ('0NN_isim.sql')
--   ON CONFLICT (filename) DO NOTHING;
--
-- Böylece dosyayı SQL editöründe çalıştırmak otomatik olarak "uygulandı"
-- kaydını da bırakır — ayrı bir adım unutulamaz. backend/npm run check-migrations
-- bu tabloyu local supabase/migrations/ ile karşılaştırıp sapmayı raporlar.

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename    TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;
-- Politika tanımlanmadığı için anon/authenticated erişimi kapalı (008'deki
-- desenle aynı) — yalnızca service_role (backend) okuyup yazabilir.

-- Geriye dönük doldurma: bu satırın kendisi çalıştırıldığında canlıda zaten
-- uygulanmış olduğu doğrulanan/varsayılan migration'lar (002_*_revert.sql ve
-- 002_seed_data.sql hariç — ilki hiç çalıştırılmadı, ikincisi yalnızca
-- geliştirme ortamı içindi).
INSERT INTO schema_migrations (filename) VALUES
  ('001_initial_schema.sql'),
  ('002_add_driver_balance.sql'),
  ('002_driver_request_log.sql'),
  ('002_ride_pickup_verification.sql'),
  ('003_tcoin_accept_fee.sql'),
  ('004_platform_settings.sql'),
  ('005_device_push_tokens.sql'),
  ('005_ride_accept_fee_percent.sql'),
  ('006_device_push_tokens_rls.sql'),
  ('006_user_is_suspended.sql'),
  ('007_wallet_ledger_atomic_accept.sql'),
  ('008_rls_hardening.sql'),
  ('009_user_session_version.sql'),
  ('010_schema_migrations.sql')
ON CONFLICT (filename) DO NOTHING;
