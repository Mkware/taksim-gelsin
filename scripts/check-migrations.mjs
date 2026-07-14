#!/usr/bin/env node
/**
 * supabase/migrations/ altındaki dosyaları canlı (veya .env'de tanımlı
 * herhangi bir) Supabase projesinin `schema_migrations` tablosuyla karşılaştırır.
 * Yalnızca SELECT yapar, hiçbir şeyi değiştirmez.
 *
 * Kullanım: npm run check-migrations   (backend/.env'deki SUPABASE_URL/
 * SUPABASE_SERVICE_ROLE_KEY kullanılır — service_role şart, schema_migrations
 * RLS ile anon/authenticated'a kapalı.)
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY bulunamadı (backend/.env kontrol edin).');
  process.exit(1);
}

const MIGRATIONS_DIR = path.resolve(__dirname, '../../supabase/migrations');

function localForwardMigrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => !f.endsWith('_revert.sql'))
    .filter((f) => !f.endsWith('_seed_data.sql'))
    .sort();
}

async function fetchAppliedMigrations() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/schema_migrations?select=filename&order=filename.asc`, {
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `schema_migrations okunamadı (HTTP ${res.status}): ${body}\n` +
        `Not: 010_schema_migrations.sql henüz canlıya uygulanmadıysa bu tablo yoktur.`,
    );
  }
  const rows = await res.json();
  return new Set(rows.map((r) => r.filename));
}

const local = localForwardMigrationFiles();
const applied = await fetchAppliedMigrations();

const missing = local.filter((f) => !applied.has(f));
const untracked = [...applied].filter((f) => !local.includes(f));

console.log(`Yerel forward migration sayısı: ${local.length}`);
console.log(`schema_migrations'ta kayıtlı: ${applied.size}`);
console.log('');

if (missing.length === 0 && untracked.length === 0) {
  console.log('✅ Sapma yok — yerel dosyalar ve canlı schema_migrations birebir eşleşiyor.');
  process.exit(0);
}

if (missing.length > 0) {
  console.log('⚠️  Yerelde var ama schema_migrations\'ta yok (canlıya uygulanmamış OLABİLİR — ya da uygulanmış ama INSERT satırı unutulmuş):');
  for (const f of missing) console.log(`   - ${f}`);
}
if (untracked.length > 0) {
  console.log('⚠️  schema_migrations\'ta var ama yerel supabase/migrations/ dizininde yok:');
  for (const f of untracked) console.log(`   - ${f}`);
}
process.exit(1);
