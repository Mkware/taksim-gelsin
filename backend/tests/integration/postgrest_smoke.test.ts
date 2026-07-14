/**
 * tests/support/postgrest_stack.ts'in gerçekten çalıştığını doğrulayan
 * bağımsız duman testi: supabase-js ile (backend'in kullandığı client'ın
 * aynısı) PostgREST üzerinden bir satır yazıp okuyabiliyor muyuz?
 * Socket entegrasyon testinden önce bu altyapının izole doğrulanması için.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { startPostgrestStack, type PostgrestStack } from '../support/postgrest_stack';

describe('postgrest_stack duman testi', () => {
  let stack: PostgrestStack;
  let supabaseAdmin: SupabaseClient;

  beforeAll(async () => {
    stack = await startPostgrestStack();
    supabaseAdmin = createClient(stack.postgrest.supabaseUrl, stack.postgrest.serviceRoleKey, {
      auth: { persistSession: false },
    });
  }, 180_000);

  afterAll(async () => {
    await stack.stop();
  });

  it('service_role ile bir kullanıcı satırı yazıp PostgREST üzerinden okuyabilir', async () => {
    const id = randomUUID();
    const { error: insertError } = await supabaseAdmin.from('users').insert({
      id,
      phone: '+905550000000',
      full_name: 'PostgREST Duman Testi',
      password_hash: 'hash',
      role: 'customer',
    });
    expect(insertError).toBeNull();

    const { data, error: selectError } = await supabaseAdmin
      .from('users')
      .select('id, phone, full_name')
      .eq('id', id)
      .single();

    expect(selectError).toBeNull();
    expect(data?.phone).toBe('+905550000000');
  });
});
