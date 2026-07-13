/**
 * Supabase İstemci Yapılandırması
 * İki ayrı istemci oluşturulur:
 * - supabase: Anon key ile (RLS kurallarına tabi)
 * - supabaseAdmin: Service role key ile (RLS bypass, backend işlemleri)
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env } from './env';

/**
 * Supabase REST çağrıları için timeout'lu fetch.
 *
 * Varsayılan fetch'in timeout'u yoktur; Supabase yavaşlar/askıda kalırsa istek (ve onu await
 * eden HTTP/Socket handler) süresiz beklerdi. AbortController ile üst sınır koyarak event
 * loop'un tıkanmasını ve isteklerin sonsuza asılmasını engelliyoruz.
 */
const SUPABASE_FETCH_TIMEOUT_MS = 10_000;

const fetchWithTimeout: typeof fetch = (input, init) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUPABASE_FETCH_TIMEOUT_MS);

  // Çağıran zaten bir signal verdiyse onun abort'unu da dinle.
  const callerSignal = init?.signal;
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
};

// Genel amaçlı Supabase istemcisi (RLS aktif)
export const supabase: SupabaseClient = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_ANON_KEY,
  {
    global: { fetch: fetchWithTimeout },
  }
);

// Yönetici Supabase istemcisi (RLS bypass — sadece backend'de kullanılır)
export const supabaseAdmin: SupabaseClient = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: { fetch: fetchWithTimeout },
  }
);
