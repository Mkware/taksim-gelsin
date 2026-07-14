/**
 * Testcontainers ile gerçek bir Postgres+PostGIS ayağa kaldırıp
 * supabase/migrations altındaki tüm forward migration'ları uygular.
 *
 * Supabase'e özgü `auth.uid()` / `auth.role()` fonksiyonları ve
 * anon/authenticated/service_role rolleri vanilla Postgres imajında yok;
 * migration'lardaki CREATE POLICY / GRANT / REVOKE ifadeleri bunlara
 * referans verdiği için önce stub'lanıyor.
 *
 * `authenticator` rolü + service_role'e BYPASSRLS ve tüm tablolara ALTER
 * DEFAULT PRIVILEGES ile tam erişim veriliyor — bu, gerçek Supabase
 * projelerinin standart PostgREST kurulumunu birebir taklit ediyor ve
 * tests/support/postgrest.ts'in service_role JWT'siyle gelen isteklerin
 * gerçekten çalışmasını sağlıyor (yalnızca SQL-only testler için gereksiz
 * ama zararsız).
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedNetwork } from 'testcontainers';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../supabase/migrations');

const AUTH_STUB_SQL = `
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
  CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULL::text $$;
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
      CREATE ROLE anon NOLOGIN NOINHERIT;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
      CREATE ROLE authenticated NOLOGIN NOINHERIT;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
      CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
    END IF;
    -- PostgREST/Supabase kalıbı: fiziksel bağlantı bu rolle kurulur, JWT'deki
    -- role claim'ine göre isteğe özel SET ROLE yapılır.
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticator') THEN
      CREATE ROLE authenticator NOINHERIT LOGIN PASSWORD 'authenticator';
    END IF;
  END $$;
  GRANT anon TO authenticator;
  GRANT authenticated TO authenticator;
  GRANT service_role TO authenticator;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
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

export async function applyMigrations(pool: Pool): Promise<void> {
  await pool.query(AUTH_STUB_SQL);

  for (const file of forwardMigrationFiles()) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
    try {
      await pool.query(sql);
    } catch (err) {
      throw new Error(`Migration ${file} başarısız: ${(err as Error).message}`);
    }
  }
}

export interface TestDatabase {
  container: StartedPostgreSqlContainer;
  pool: Pool;
}

export interface StartTestDatabaseOptions {
  /** PostgREST gibi başka bir konteynerin de bağlanabilmesi için ortak Docker network'ü. */
  network?: StartedNetwork;
  networkAliases?: string[];
}

export async function startTestDatabase(options: StartTestDatabaseOptions = {}): Promise<TestDatabase> {
  let builder = new PostgreSqlContainer('postgis/postgis:16-3.4')
    .withDatabase('taksim_test')
    .withUsername('test')
    .withPassword('test');

  if (options.network) {
    builder = builder.withNetwork(options.network);
  }
  if (options.networkAliases?.length) {
    builder = builder.withNetworkAliases(...options.networkAliases);
  }

  const container = await builder.start();
  const pool = new Pool({ connectionString: container.getConnectionUri() });
  await applyMigrations(pool);

  return { container, pool };
}

export async function stopTestDatabase(db: TestDatabase): Promise<void> {
  await db.pool.end();
  await db.container.stop();
}
