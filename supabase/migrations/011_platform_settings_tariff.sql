-- Taksi tarifesi artık platform_settings.settings (JSONB) içinde — deploy
-- gerekmeden admin panelinden değiştirilebilir (Faz 3, madde 12). Önceden
-- backend/src/modules/ride/pricing.service.ts içinde sabit kodluydu.
--
-- Şema değişikliği yok (settings zaten JSONB — 004_platform_settings.sql).
-- DB satırında bu anahtarlar yoksa backend env bootstrap varsayılanlarını
-- kullanır (TARIFF_BASE_FARE vb., bkz. backend/.env.example) — bu migration
-- yalnızca dokümantasyon amaçlı; isterseniz aşağıdaki UPDATE ile mevcut
-- varsayılan tarifeyi (50 TL açılış / 50 TL-km / 150 TL taban / 3 TL-dk
-- bekleme) canlı satıra da açıkça yazabilirsiniz (isteğe bağlı):
--
-- UPDATE public.platform_settings
-- SET settings = settings || '{
--   "tariffBaseFare": 50,
--   "tariffPerKmRate": 50,
--   "tariffMinimumFare": 150,
--   "tariffWaitingRatePerMinute": 3
-- }'::jsonb,
--     updated_at = NOW()
-- WHERE id = 'default';

INSERT INTO schema_migrations (filename) VALUES ('011_platform_settings_tariff.sql')
ON CONFLICT (filename) DO NOTHING;
