/**
 * supabase/migrations/007_wallet_ledger_atomic_accept.sql — projenin en kritik
 * parası dokunan mantığı: atomik kabul+kesinti (accept_ride_with_fee) ve
 * idempotent iade (refund_ride_accept_fee). Gerçek Postgres+PostGIS üzerinde
 * (testcontainers) doğrudan RPC çağrısıyla test ediliyor; backend'in
 * supabase-js/PostgREST katmanı devre dışı — amaç SQL fonksiyonunun kendi
 * garantilerini doğrulamak.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { startTestDatabase, stopTestDatabase, type TestDatabase } from '../support/db';
import { insertCustomer, insertDriver, insertSearchingRide } from '../support/fixtures';

describe('accept_ride_with_fee / refund_ride_accept_fee', () => {
  let db: TestDatabase;
  let pool: Pool;

  beforeAll(async () => {
    db = await startTestDatabase();
    pool = db.pool;
  }, 120_000);

  afterAll(async () => {
    await stopTestDatabase(db);
  });

  it('yeterli bakiyede yolculuğu kabul eder, ücreti keser ve ledger satırı açar', async () => {
    const customerId = await insertCustomer(pool);
    const driverId = await insertDriver(pool, { balance: 50 });
    const rideId = await insertSearchingRide(pool, customerId, { estimatedPrice: 100 });

    const { rows } = await pool.query(
      `SELECT accept_ride_with_fee($1, $2, $3, $4, $5) AS result`,
      [rideId, driverId, 7, '1234', `accept:${rideId}:${driverId}`],
    );
    const result = rows[0].result;

    expect(result.ok).toBe(true);
    expect(result.ride.status).toBe('accepted');
    expect(result.ride.driver_id).toBe(driverId);

    const driver = await pool.query('SELECT balance, is_available FROM drivers WHERE id = $1', [driverId]);
    expect(Number(driver.rows[0].balance)).toBe(43);
    expect(driver.rows[0].is_available).toBe(false);

    const ledger = await pool.query(
      `SELECT type, amount, balance_after FROM wallet_transactions WHERE ride_id = $1`,
      [rideId],
    );
    expect(ledger.rows).toHaveLength(1);
    expect(ledger.rows[0].type).toBe('accept_fee');
    expect(Number(ledger.rows[0].amount)).toBe(-7);
    expect(Number(ledger.rows[0].balance_after)).toBe(43);
  });

  it('yetersiz bakiyede tüm işlemi geri alır (kabul dahil)', async () => {
    const customerId = await insertCustomer(pool);
    const driverId = await insertDriver(pool, { balance: 5 });
    const rideId = await insertSearchingRide(pool, customerId, { estimatedPrice: 100 });

    const { rows } = await pool.query(
      `SELECT accept_ride_with_fee($1, $2, $3, $4, $5) AS result`,
      [rideId, driverId, 7, '1234', `accept:${rideId}:${driverId}`],
    );
    const result = rows[0].result;

    expect(result.ok).toBe(false);
    expect(result.code).toBe('INSUFFICIENT_BALANCE');

    // Kabul de dahil hiçbir değişiklik kalıcı olmamalı
    const ride = await pool.query('SELECT status, driver_id FROM rides WHERE id = $1', [rideId]);
    expect(ride.rows[0].status).toBe('searching');
    expect(ride.rows[0].driver_id).toBeNull();

    const driver = await pool.query('SELECT balance FROM drivers WHERE id = $1', [driverId]);
    expect(Number(driver.rows[0].balance)).toBe(5);

    const ledger = await pool.query('SELECT id FROM wallet_transactions WHERE ride_id = $1', [rideId]);
    expect(ledger.rows).toHaveLength(0);
  });

  it('iki sürücü aynı yolculuğu eşzamanlı kabul etmeye çalışırsa yalnızca biri kazanır', async () => {
    const customerId = await insertCustomer(pool);
    const driverA = await insertDriver(pool, { balance: 50 });
    const driverB = await insertDriver(pool, { balance: 50 });
    const rideId = await insertSearchingRide(pool, customerId, { estimatedPrice: 100 });

    const [resA, resB] = await Promise.all([
      pool.query(`SELECT accept_ride_with_fee($1, $2, $3, $4, $5) AS result`, [
        rideId, driverA, 7, '1111', `accept:${rideId}:${driverA}`,
      ]),
      pool.query(`SELECT accept_ride_with_fee($1, $2, $3, $4, $5) AS result`, [
        rideId, driverB, 7, '2222', `accept:${rideId}:${driverB}`,
      ]),
    ]);

    const outcomes = [resA.rows[0].result, resB.rows[0].result];
    const winners = outcomes.filter((r) => r.ok === true);
    const losers = outcomes.filter((r) => r.ok === false);

    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0].code).toBe('RIDE_UNAVAILABLE');

    // Kaybeden sürücüden hiç kesinti yapılmamalı
    const balances = await pool.query(
      'SELECT id, balance FROM drivers WHERE id = ANY($1) ORDER BY balance ASC',
      [[driverA, driverB]],
    );
    expect(Number(balances.rows[0].balance)).toBe(43); // kazanan
    expect(Number(balances.rows[1].balance)).toBe(50); // kaybeden — dokunulmadı

    const ledger = await pool.query('SELECT id FROM wallet_transactions WHERE ride_id = $1', [rideId]);
    expect(ledger.rows).toHaveLength(1);
  });

  it('refund aynı idempotency_key ile iki kez çağrılsa bile bakiyeyi yalnızca bir kez kredilendirir', async () => {
    const driverId = await insertDriver(pool, { balance: 10 });
    const key = `refund:${randomUUID()}`;

    const first = await pool.query(
      `SELECT refund_ride_accept_fee($1, NULL, $2, $3) AS result`,
      [driverId, 7, key],
    );
    const second = await pool.query(
      `SELECT refund_ride_accept_fee($1, NULL, $2, $3) AS result`,
      [driverId, 7, key],
    );

    expect(first.rows[0].result.ok).toBe(true);
    expect(first.rows[0].result.duplicate).toBeUndefined();
    expect(second.rows[0].result.ok).toBe(true);
    expect(second.rows[0].result.duplicate).toBe(true);

    const driver = await pool.query('SELECT balance FROM drivers WHERE id = $1', [driverId]);
    expect(Number(driver.rows[0].balance)).toBe(17); // yalnızca bir kez +7

    const ledger = await pool.query(
      'SELECT id FROM wallet_transactions WHERE idempotency_key = $1',
      [key],
    );
    expect(ledger.rows).toHaveLength(1);
  });

  it('refund tutar <= 0 ise no-op döner, hiçbir şey değişmez', async () => {
    const driverId = await insertDriver(pool, { balance: 10 });

    const { rows } = await pool.query(
      `SELECT refund_ride_accept_fee($1, NULL, $2, $3) AS result`,
      [driverId, 0, `refund:${randomUUID()}`],
    );

    expect(rows[0].result.ok).toBe(true);
    expect(rows[0].result.skipped).toBe(true);

    const driver = await pool.query('SELECT balance FROM drivers WHERE id = $1', [driverId]);
    expect(Number(driver.rows[0].balance)).toBe(10);
  });
});
