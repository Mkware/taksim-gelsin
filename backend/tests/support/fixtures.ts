import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

/** Kırıkkale merkez — testlerde kullanılan sabit koordinat */
const KIRIKKALE_LNG = 33.515;
const KIRIKKALE_LAT = 39.8468;

export async function insertCustomer(pool: Pool, overrides: { phone?: string } = {}): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO users (id, phone, full_name, password_hash, role)
     VALUES ($1, $2, 'Test Müşteri', 'hash', 'customer')`,
    [id, overrides.phone ?? `+9055500${Math.floor(Math.random() * 100000)}`],
  );
  return id;
}

export async function insertDriver(
  pool: Pool,
  overrides: { balance?: number; phone?: string } = {},
): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO users (id, phone, full_name, password_hash, role)
     VALUES ($1, $2, 'Test Sürücü', 'hash', 'driver')`,
    [id, overrides.phone ?? `+9055501${Math.floor(Math.random() * 100000)}`],
  );
  await pool.query(
    `INSERT INTO drivers (id, vehicle_plate, vehicle_model, vehicle_color, is_online, is_available, balance, current_location)
     VALUES ($1, $2, 'Test Model', 'Beyaz', true, true, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326)::GEOGRAPHY)`,
    [id, `71 TEST ${Math.floor(Math.random() * 1000)}`, overrides.balance ?? 0, KIRIKKALE_LNG, KIRIKKALE_LAT],
  );
  return id;
}

export async function insertSearchingRide(
  pool: Pool,
  customerId: string,
  overrides: { estimatedPrice?: number } = {},
): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO rides (id, customer_id, pickup_location, dropoff_location, pickup_address, dropoff_address, estimated_price, status)
     VALUES (
       $1, $2,
       ST_SetSRID(ST_MakePoint($3, $4), 4326)::GEOGRAPHY,
       ST_SetSRID(ST_MakePoint($3, $4), 4326)::GEOGRAPHY,
       'Test biniş', 'Test varış', $5, 'searching'
     )`,
    [id, customerId, KIRIKKALE_LNG, KIRIKKALE_LAT, overrides.estimatedPrice ?? 100],
  );
  return id;
}
