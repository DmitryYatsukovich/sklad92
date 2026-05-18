import pool from './pool.js';

/** Идемпотентные миграции при старте (Timeweb: без ручного npm run db:migrate-*) */
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
  `ALTER TABLE materials ADD COLUMN IF NOT EXISTS price DECIMAL(18,2) DEFAULT 0`,
  `ALTER TABLE materials ADD COLUMN IF NOT EXISTS production_price DECIMAL(18,2) DEFAULT 0`,
  `ALTER TABLE materials ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
  `CREATE INDEX IF NOT EXISTS idx_materials_object ON materials(object_id)`,
  `CREATE INDEX IF NOT EXISTS idx_materials_warehouse ON materials(warehouse_id)`,
  `CREATE INDEX IF NOT EXISTS idx_materials_category ON materials(category_id)`,
  `CREATE TABLE IF NOT EXISTS material_quantity_log (
    id SERIAL PRIMARY KEY,
    material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    delta DECIMAL(18,4) NOT NULL,
    quantity_after DECIMAL(18,4) NOT NULL,
    kind VARCHAR(30) NOT NULL,
    issuance_id INTEGER REFERENCES issuances(id) ON DELETE SET NULL,
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_mql_material ON material_quantity_log(material_id)`,
  `CREATE INDEX IF NOT EXISTS idx_mql_created ON material_quantity_log(created_at DESC)`,
  `ALTER TABLE user_permissions ADD COLUMN IF NOT EXISTS can_settings BOOLEAN DEFAULT false`,
  `ALTER TABLE roles ADD COLUMN IF NOT EXISTS can_settings BOOLEAN DEFAULT false`,
  `UPDATE user_permissions SET can_settings = COALESCE(can_warehouse, false)
   WHERE can_settings IS NOT TRUE AND COALESCE(can_warehouse, false) = true`,
  `ALTER TABLE user_permissions ADD COLUMN IF NOT EXISTS can_face BOOLEAN DEFAULT false`,
  `ALTER TABLE roles ADD COLUMN IF NOT EXISTS can_face BOOLEAN DEFAULT false`,
  `UPDATE user_permissions SET can_face = true WHERE can_face IS NOT TRUE`,
];

export async function ensureSchema() {
  if (process.env.ENSURE_SCHEMA_ON_START === 'false') return;

  const client = await pool.connect();
  try {
    for (const stmt of statements) {
      await client.query(stmt);
    }
    console.log('ensureSchema: OK');
  } catch (e) {
    console.error('ensureSchema:', e.message);
    throw e;
  } finally {
    client.release();
  }
}
