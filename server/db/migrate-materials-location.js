import 'dotenv/config';
import pool from './pool.js';

const statements = [
  `CREATE TABLE IF NOT EXISTS warehouse_objects (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS warehouses (
    id SERIAL PRIMARY KEY,
    object_id INTEGER NOT NULL REFERENCES warehouse_objects(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (object_id, name)
  )`,
  `CREATE TABLE IF NOT EXISTS warehouse_racks (
    id SERIAL PRIMARY KEY,
    warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (warehouse_id, name)
  )`,
  `CREATE TABLE IF NOT EXISTS material_categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `ALTER TABLE materials ADD COLUMN IF NOT EXISTS object_id INTEGER REFERENCES warehouse_objects(id) ON DELETE SET NULL`,
  `ALTER TABLE materials ADD COLUMN IF NOT EXISTS warehouse_id INTEGER REFERENCES warehouses(id) ON DELETE SET NULL`,
  `ALTER TABLE materials ADD COLUMN IF NOT EXISTS rack_id INTEGER REFERENCES warehouse_racks(id) ON DELETE SET NULL`,
  `ALTER TABLE materials ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES material_categories(id) ON DELETE SET NULL`,
  `ALTER TABLE materials ADD COLUMN IF NOT EXISTS production_price DECIMAL(18,2) DEFAULT 0`,
  `CREATE INDEX IF NOT EXISTS idx_materials_object ON materials(object_id)`,
  `CREATE INDEX IF NOT EXISTS idx_materials_warehouse ON materials(warehouse_id)`,
  `CREATE INDEX IF NOT EXISTS idx_materials_category ON materials(category_id)`,
];

async function migrate() {
  const client = await pool.connect();
  try {
    for (const stmt of statements) {
      await client.query(stmt);
    }
    console.log('Materials location migration completed.');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((e) => {
  console.error(e);
  process.exit(1);
});
