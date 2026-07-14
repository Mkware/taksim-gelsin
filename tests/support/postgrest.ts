/**
 * ride.service.ts / auth.service.ts / smart_matching.service.ts gibi servisler
 * `supabaseAdmin` (supabase-js) üzerinden Supabase'e (PostgREST) yazıyor.
 * Bu modül, testcontainers Postgres'imize karşı gerçek bir `postgrest/postgrest`
 * konteyneri ayağa kaldırıp bu servisleri OLDUĞU GİBİ (mock'lamadan) test
 * edilebilir kılıyor.
 *
 * Gerçek Supabase kurulumunu birebir taklit ediyor: fiziksel bağlantı
 * `authenticator` rolüyle kurulur, PostgREST her istekte JWT'nin `role` claim'ine
 * göre `SET ROLE` yapar (bkz. tests/support/db.ts'teki authenticator/service_role
 * GRANT'ları).
 *
 * supabase-js her zaman `${SUPABASE_URL}/rest/v1/...` çağırır ama PostgREST
 * path prefix'i desteklemiyor (kendisi root'ta serve eder) — gerçek Supabase'de
 * bunu Kong gateway hallediyor. Burada onun yerine minik bir Node HTTP proxy
 * `/rest/v1` önekini soyup PostgREST'e yönlendiriyor.
 */

import http from 'node:http';
import jwt from 'jsonwebtoken';
import { GenericContainer, StartedTestContainer, Wait, type StartedNetwork } from 'testcontainers';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';

export interface TestPostgrest {
  jwtSecret: string;
  serviceRoleKey: string;
  anonKey: string;
  /** supabase-js'in SUPABASE_URL'i — proxy üzerinden PostgREST'e gider. */
  supabaseUrl: string;
  stop: () => Promise<void>;
}

const JWT_SECRET = 'test-postgrest-jwt-secret-0123456789abcdef';

function startRestV1Proxy(targetHost: string, targetPort: number): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const forwardedPath = (req.url ?? '/').replace(/^\/rest\/v1/, '') || '/';
    const proxyReq = http.request(
      {
        host: targetHost,
        port: targetPort,
        path: forwardedPath,
        method: req.method,
        headers: req.headers,
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
        proxyRes.pipe(res);
      },
    );
    proxyReq.on('error', (err) => {
      res.writeHead(502);
      res.end(`proxy hatası: ${err.message}`);
    });
    req.pipe(proxyReq);
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') throw new Error('proxy adresi alınamadı');
      resolve({
        port: addr.port,
        close: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
  });
}

export async function startTestPostgrest(
  pg: StartedPostgreSqlContainer,
  network: StartedNetwork,
  pgNetworkAlias: string,
): Promise<TestPostgrest> {
  const dbUri = `postgres://authenticator:authenticator@${pgNetworkAlias}:5432/${pg.getDatabase()}`;

  const container: StartedTestContainer = await new GenericContainer('postgrest/postgrest:v12.2.3')
    .withNetwork(network)
    .withExposedPorts(3000)
    .withEnvironment({
      PGRST_DB_URI: dbUri,
      PGRST_DB_SCHEMAS: 'public',
      PGRST_DB_ANON_ROLE: 'anon',
      PGRST_JWT_SECRET: JWT_SECRET,
    })
    .withWaitStrategy(Wait.forHttp('/', 3000))
    .start();

  const proxy = await startRestV1Proxy(container.getHost(), container.getMappedPort(3000));

  const serviceRoleKey = jwt.sign({ role: 'service_role' }, JWT_SECRET);
  const anonKey = jwt.sign({ role: 'anon' }, JWT_SECRET);

  return {
    jwtSecret: JWT_SECRET,
    serviceRoleKey,
    anonKey,
    supabaseUrl: `http://127.0.0.1:${proxy.port}`,
    stop: async () => {
      await proxy.close();
      await container.stop();
    },
  };
}
