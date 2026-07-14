-- Tek-cihaz oturum takibi: backend/src/modules/auth/auth.service.ts, auth.middleware.ts
-- ve sockets/middleware/socket.auth.ts bu kolonu login/refresh/logout ve her
-- korumalı istekte okuyup yazıyor, ama şimdiye kadar hiçbir migration'da
-- tanımlanmamıştı (14 Tem 2026'da backend/tests/ altyapısı kurulurken fark
-- edildi — muhtemelen üretimde SQL editöründen elle eklenmiş, migration
-- geçmişine hiç girmemiş). Login sırasında sürüm +1 artırılır; JWT'deki
-- sessionVersion DB'dekiyle eşleşmezse istek/socket reddedilir ("başka bir
-- cihazdan giriş yapıldı").
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN users.session_version IS 'Her login''de +1 artar; JWT''deki sessionVersion bununla eşleşmezse oturum geçersiz sayılır (tek aktif cihaz).';
