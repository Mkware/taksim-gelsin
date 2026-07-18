-- Sürücü numarasını (driver_code) sıra tahmini/brute-force'a karşı sertleştir.
-- Sorun: 013'te mevcut sürücülere created_at sırasına göre 0001, 0002, ... atanmıştı
-- (yalnızca yeni kayıtlar rastgeleydi) ve alan yalnızca 4 hane (10.000 olasılık) idi —
-- ardışık numaralar art arda denenerek kolayca bulunabiliyordu.
-- Çözüm: alanı 6 haneye çıkar (1.000.000 olasılık, ayrıca endpoint'lere rate limit eklendi
-- — bkz. driver.routes.ts/user.routes.ts) ve TÜM sürücülere (eskiler dahil) gerçek rastgele,
-- ardışık olmayan yeni kodlar ata.

ALTER TABLE drivers ALTER COLUMN driver_code TYPE VARCHAR(6);

DO $$
DECLARE
  d RECORD;
  new_code TEXT;
BEGIN
  FOR d IN SELECT id FROM drivers LOOP
    LOOP
      new_code := lpad(floor(random() * 1000000)::text, 6, '0');
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM drivers WHERE driver_code = new_code AND id <> d.id
      );
    END LOOP;
    UPDATE drivers SET driver_code = new_code WHERE id = d.id;
  END LOOP;
END $$;

INSERT INTO schema_migrations (filename) VALUES ('015_driver_code_harden.sql') ON CONFLICT (filename) DO NOTHING;
