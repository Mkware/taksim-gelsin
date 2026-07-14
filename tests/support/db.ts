/**
 * Testcontainers ile gerçek bir Postgres+PostGIS ayağa kaldırıp
 * supabase/migrations altındaki tüm forward migration'ları uygular.
 *
 * Supabase'e özgü `auth.uid()` / `auth.role()` fonksiyonları ve
 * anon/authenticated/service_role rolleri vanilla Postgres imajında yok;
 * migration'lardaki CREATE POLICY / GRANT / REVOKE ifadeleri bunlara
 * referans verdiği için önce stub'lanıyor. Backend zaten service_role
 * (RLS bypass) ile bağlandığından stub'ların gerçek semantiği önemsiz —
 * yalnızca migration'ların hatasız uygulanmasını sağlıyorlar.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../supabase/migrations');

const AUTH_STUB_SQL = `
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
  CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'service_role'::text $$;
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
  END $$;
`;

function forwardMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    // rollback script — ileri yönlü uygulanmaz (bkz. CLAUDE.md)
    .filter((f) => !f.endsWith('_revert.sql'))
    // yalnızca geliştirme ortamı için örnek veri — şema testlerinde istenmiyor,
    // her test kendi fixture'ını oluşturuyor
    .filter((f) => !f.endsWith('_seed_data.sql'))
    .sort();
}

export interface TestDatabase {
  container: StartedPostgreSqlContainer;
  pool: Pool;
}

export async function startTestDatabase(): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer('postgis/postgis:16-3.4')
    .withDatabase('taksim_test')
    .withUsername('test')
    .withPassword('test')
    .start();

  const pool = new Pool({ connectionString: container.getConnectionUri() });

  await pool.query(AUTH_STUB_SQL);

  for (const file of forwardMigrationFiles()) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
    try {
      await pool.query(sql);
    } catch (err) {
      throw new Error(`Migration ${file} başarısız: ${(err as Error).message}`);
    }
  }

  return { container, pool };
}

export async function stopTestDatabase(db: TestDatabase): Promise<void> {
  await db.pool.end();
  await db.container.stop();
}
