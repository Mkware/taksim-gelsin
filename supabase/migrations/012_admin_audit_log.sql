-- Admin panelinden yapılan mutasyon eylemlerinin denetim kaydı.
-- Hangi admin, ne zaman, hangi hedef üzerinde, hangi eylemi yaptı — panelde
-- hiçbir admin aksiyonu şu ana kadar loglanmıyordu (bkz. CLAUDE.md admin panel notu).

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  admin_phone TEXT NOT NULL,
  action      TEXT NOT NULL,        -- örn: driver.balance_add, driver.delete, settings.platform_update
  target_type TEXT,                 -- örn: driver, customer, ride, settings
  target_id   TEXT,
  details     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created ON admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_target ON admin_audit_log (target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_action ON admin_audit_log (action);

-- RLS: anon / authenticated (PostgREST) ile doğrudan okuma-yazma yok.
-- Node API yalnızca service_role ile yazar/okur; service_role RLS'yi atlar.
ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE admin_audit_log IS
  'Admin panelinden yapılan mutasyon eylemlerinin denetim kaydı. Yalnızca backend (service_role) yazar.';

INSERT INTO schema_migrations (filename) VALUES ('012_admin_audit_log.sql')
ON CONFLICT (filename) DO NOTHING;
