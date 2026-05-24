import 'dotenv/config';
import pool from './pool.js';

const sql = [
  `CREATE TABLE IF NOT EXISTS work_entrances (
    id SERIAL PRIMARY KEY,
    object_id INTEGER REFERENCES warehouse_objects(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (object_id, name)
  )`,
  `ALTER TABLE work_entrances ADD COLUMN IF NOT EXISTS object_id INTEGER REFERENCES warehouse_objects(id) ON DELETE CASCADE`,
  `ALTER TABLE work_entrances DROP CONSTRAINT IF EXISTS work_entrances_name_key`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_work_entrances_object_name ON work_entrances (object_id, name)`,
  `CREATE TABLE IF NOT EXISTS work_floors (
    id SERIAL PRIMARY KEY,
    entrance_id INTEGER NOT NULL REFERENCES work_entrances(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (entrance_id, name)
  )`,
  `CREATE TABLE IF NOT EXISTS work_apartments (
    id SERIAL PRIMARY KEY,
    floor_id INTEGER NOT NULL REFERENCES work_floors(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (floor_id, name)
  )`,
  `CREATE TABLE IF NOT EXISTS work_rooms (
    id SERIAL PRIMARY KEY,
    apartment_id INTEGER NOT NULL REFERENCES work_apartments(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (apartment_id, name)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_work_floors_entrance ON work_floors(entrance_id)`,
  `CREATE INDEX IF NOT EXISTS idx_work_apartments_floor ON work_apartments(floor_id)`,
  `CREATE INDEX IF NOT EXISTS idx_work_rooms_apartment ON work_rooms(apartment_id)`,
];

async function migrate() {
  const client = await pool.connect();
  try {
    for (const stmt of sql) {
      await client.query(stmt);
    }
    console.log('migrate-work-locations: OK');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((e) => {
  console.error(e);
  process.exit(1);
});
