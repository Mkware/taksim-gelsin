/**
 * ride.service.ts'deki updateRideStatus() durum geçişlerini DB seviyesinde
 * koruyan iki mekanizma:
 *   1. "Koşullu update" (compare-and-swap): her geçiş
 *      `UPDATE rides SET status = X WHERE id = ? AND status = <beklenen>` şeklinde —
 *      araya giren bir değişiklik varsa 0 satır döner (ride.service.ts bunu
 *      409'a çevirir). Bu test doğrudan aynı deseni SQL'de çalıştırıp
 *      koruma garantisini doğruluyor (supabase-js/PostgREST katmanı olmadan).
 *   2. DB constraint'leri: 001_initial_schema.sql'deki
 *      increment_driver_total_rides trigger'ı ve 007'deki
 *      uniq_customer_active_ride partial unique index.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { startTestDatabase, stopTestDatabase, type TestDatabase } from '../support/db';
import { insertCustomer, insertDriver, insertSearchingRide } from '../support/fixtures';

async function acceptRide(pool: Pool, rideId: string, driverId: string): Promise<void> {
  const { rows } = await pool.query(
    `UPDATE rides SET status = 'accepted', driver_id = $2, accepted_at = now()
     WHERE id = $1 AND status = 'searching' AND driver_id IS NULL
     RETURNING id`,
    [rideId, driverId],
  );
  expect(rows).toHaveLength(1);
}

describe('ride durum geçişleri — koşullu UPDATE + DB trigger/constraint garantileri', () => {
  let db: TestDatabase;
  let pool: Pool;

  beforeAll(async () => {
    db = await startTestDatabase();
    pool = db.pool;
  }, 120_000);

  afterAll(async () => {
    await stopTestDatabase(db);
  });

  it('tam yaşam döngüsünü (accepted → arriving → in_progress → completed) sırayla kabul eder', async () => {
    const customerId = await insertCustomer(pool);
    const driverId = await insertDriver(pool, { balance: 50 });
    const rideId = await insertSearchingRide(pool, customerId);
    await acceptRide(pool, rideId, driverId);

    for (const [from, to] of [
      ['accepted', 'arriving'],
      ['arriving', 'in_progress'],
      ['in_progress', 'completed'],
    ] as const) {
      const { rows } = await pool.query(
        `UPDATE rides SET status = $3 WHERE id = $1 AND status = $2 RETURNING status`,
        [rideId, from, to],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe(to);
    }

    const ride = await pool.query('SELECT status FROM rides WHERE id = $1', [rideId]);
    expect(ride.rows[0].status).toBe('completed');
  });

  it('beklenen durum eşleşmezse (araya giren geçiş) koşullu UPDATE 0 satır döner', async () => {
    const customerId = await insertCustomer(pool);
    const driverId = await insertDriver(pool, { balance: 50 });
    const rideId = await insertSearchingRide(pool, customerId);
    await acceptRide(pool, rideId, driverId);

    // Ride zaten başka bir yerde 'arriving'e geçmiş varsayımıyla, hâlâ 'accepted'
    // sanan (bayat) bir çağrı aynı geçişi tekrar dener — ilk kazanır, ikinci kaybetmeli.
    const first = await pool.query(
      `UPDATE rides SET status = 'arriving' WHERE id = $1 AND status = 'accepted' RETURNING status`,
      [rideId],
    );
    const stale = await pool.query(
      `UPDATE rides SET status = 'arriving' WHERE id = $1 AND status = 'accepted' RETURNING status`,
      [rideId],
    );

    expect(first.rows).toHaveLength(1);
    expect(stale.rows).toHaveLength(0); // bayat çağrı: ride artık 'accepted' değil
  });

  it('iki eşzamanlı arriving→in_progress denemesinden yalnızca biri kazanır', async () => {
    const customerId = await insertCustomer(pool);
    const driverId = await insertDriver(pool, { balance: 50 });
    const rideId = await insertSearchingRide(pool, customerId);
    await acceptRide(pool, rideId, driverId);
    await pool.query(`UPDATE rides SET status = 'arriving' WHERE id = $1`, [rideId]);

    const [a, b] = await Promise.all([
      pool.query(
        `UPDATE rides SET status = 'in_progress', started_at = now() WHERE id = $1 AND status = 'arriving' RETURNING status`,
        [rideId],
      ),
      pool.query(
        `UPDATE rides SET status = 'in_progress', started_at = now() WHERE id = $1 AND status = 'arriving' RETURNING status`,
        [rideId],
      ),
    ]);

    const winners = [a, b].filter((r) => r.rows.length === 1);
    expect(winners).toHaveLength(1);
  });

  it('yolculuk completed olunca sürücünün total_rides sayacı tetikleyiciyle bir kez artar', async () => {
    const customerId = await insertCustomer(pool);
    const driverId = await insertDriver(pool, { balance: 50 });
    const rideId = await insertSearchingRide(pool, customerId);
    await acceptRide(pool, rideId, driverId);
    await pool.query(`UPDATE rides SET status = 'arriving' WHERE id = $1`, [rideId]);
    await pool.query(`UPDATE rides SET status = 'in_progress' WHERE id = $1`, [rideId]);

    const before = await pool.query('SELECT total_rides FROM drivers WHERE id = $1', [driverId]);
    expect(Number(before.rows[0].total_rides)).toBe(0);

    await pool.query(
      `UPDATE rides SET status = 'completed', completed_at = now(), final_price = 100 WHERE id = $1`,
      [rideId],
    );

    const after = await pool.query('SELECT total_rides FROM drivers WHERE id = $1', [driverId]);
    expect(Number(after.rows[0].total_rides)).toBe(1);

    // Idempotency: completed → completed'e "geçiş" olmadığı için tekrar tetiklenmemeli
    // (uygulama zaten bunu denemez, ama trigger'ın OLD.status != 'completed' koşulunu doğrula)
    await pool.query(`UPDATE rides SET final_price = 100 WHERE id = $1`, [rideId]);
    const again = await pool.query('SELECT total_rides FROM drivers WHERE id = $1', [driverId]);
    expect(Number(again.rows[0].total_rides)).toBe(1);
  });

  it('bir müşterinin aynı anda birden fazla aktif yolculuğu olamaz (partial unique index)', async () => {
    const customerId = await insertCustomer(pool);
    await insertSearchingRide(pool, customerId);

    await expect(insertSearchingRide(pool, customerId)).rejects.toThrow(/uniq_customer_active_ride/);
  });

  it('bir yolculuk cancelled/completed olduktan sonra aynı müşteri yeni bir aktif yolculuk açabilir', async () => {
    const customerId = await insertCustomer(pool);
    const rideId = await insertSearchingRide(pool, customerId);
    await pool.query(`UPDATE rides SET status = 'cancelled', cancelled_at = now() WHERE id = $1`, [rideId]);

    await expect(insertSearchingRide(pool, customerId)).resolves.toBeTruthy();
  });
});
