/**
 * Postgres+PostGIS + migration'lar + PostgREST'i tek pakette ayağa kaldırır.
 * supabaseAdmin (supabase-js) kullanan gerçek servisleri (ride.service.ts,
 * auth.service.ts, smart_matching.service.ts) test etmek için giriş noktası.
 */

import { Network, type StartedNetwork } from 'testcontainers';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { applyMigrations } from './db';
import { startTestPostgrest, type TestPostgrest } from './postgrest';

const PG_NETWORK_ALIAS = 'db';

export interface PostgrestStack {
  network: StartedNetwork;
  pgContainer: StartedPostgreSqlContainer;
  pool: Pool;
  postgrest: TestPostgrest;
  stop: () => Promise<void>;
}

export async function startPostgrestStack(): Promise<PostgrestStack> {
  const network = await new Network().start();

  const pgContainer = await new PostgreSqlContainer('postgis/postgis:16-3.4')
    .withNetwork(network)
    .withNetworkAliases(PG_NETWORK_ALIAS)
    .withDatabase('taksim_test')
    .withUsername('test')
    .withPassword('test')
    .start();

  const pool = new Pool({ connectionString: pgContainer.getConnectionUri() });
  await applyMigrations(pool);

  const postgrest = await startTestPostgrest(pgContainer, network, PG_NETWORK_ALIAS);

  return {
    network,
    pgContainer,
    pool,
    postgrest,
    stop: async () => {
      await postgrest.stop();
      await pool.end();
      await pgContainer.stop();
      await network.stop();
    },
  };
}
