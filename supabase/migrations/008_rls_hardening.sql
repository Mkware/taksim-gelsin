-- 008: RLS sıkılaştırma (derinlemesine savunma)
--
-- Mobil uygulama Supabase SDK'sını DOĞRUDAN kullanmaz; tüm erişim backend (service_role,
-- RLS/GRANT bypass) üzerindendir. Bu migration, ileride doğrudan istemci erişimi olursa
-- veri sızıntısı / kötüye kullanımı engellemek için anon/authenticated yetkilerini daraltır.
-- service_role etkilenmez; backend davranışı değişmez.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. users: "herkes herkesi okuyabilir" → yalnızca kendi profili
--    (eski politika adı "users_read_own" olmasına rağmen USING (true) idi — telefon dahil
--     tüm kullanıcılar herkese açıktı.)
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "users_read_own" ON users;
CREATE POLICY "users_read_own" ON users
  FOR SELECT USING (id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. drivers: doğrudan istemci yalnızca araç bilgisi güncelleyebilsin.
--    Önceki "drivers_update_own" politikası satır bazlıydı ama SÜTUN kısıtı yoktu;
--    auth.uid() eşleşen biri doğrudan Supabase ile balance / is_online güncelleyebilirdi.
--    Sütun seviyesinde GRANT ile bunu engelliyoruz (RLS satır kontrolü korunur).
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE UPDATE ON drivers FROM authenticated;
GRANT UPDATE (vehicle_plate, vehicle_model, vehicle_color) ON drivers TO authenticated;
