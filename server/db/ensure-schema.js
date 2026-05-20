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
  `ALTER TABLE issuances ADD COLUMN IF NOT EXISTS production_confirmed BOOLEAN DEFAULT false`,
  `ALTER TABLE issuances ADD COLUMN IF NOT EXISTS production_confirmed_at TIMESTAMPTZ`,
  `ALTER TABLE issuances ADD COLUMN IF NOT EXISTS production_confirmed_by INTEGER REFERENCES users(id) ON DELETE SET NULL`,
  `CREATE TABLE IF NOT EXISTS production_confirmation_log (
    id SERIAL PRIMARY KEY,
    issuance_id INTEGER NOT NULL REFERENCES issuances(id) ON DELETE CASCADE,
    confirmed BOOLEAN NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_pcl_issuance ON production_confirmation_log(issuance_id)`,
  `CREATE INDEX IF NOT EXISTS idx_pcl_created ON production_confirmation_log(created_at)`,
  `INSERT INTO production_confirmation_log (issuance_id, confirmed, created_at, created_by)
   SELECT i.id, i.production_confirmed, i.production_confirmed_at, i.production_confirmed_by
   FROM issuances i
   WHERE i.production_confirmed_at IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM production_confirmation_log pcl WHERE pcl.issuance_id = i.id
     )`,
  `CREATE TABLE IF NOT EXISTS work_entrances (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
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
  `ALTER TABLE work_entrances ADD COLUMN IF NOT EXISTS object_id INTEGER REFERENCES warehouse_objects(id) ON DELETE CASCADE`,
  `ALTER TABLE work_entrances DROP CONSTRAINT IF EXISTS work_entrances_name_key`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_work_entrances_object_name ON work_entrances (object_id, name)`,
  `CREATE INDEX IF NOT EXISTS idx_work_entrances_object ON work_entrances(object_id)`,
  `ALTER TABLE issuances ADD COLUMN IF NOT EXISTS work_room_id INTEGER REFERENCES work_rooms(id) ON DELETE SET NULL`,
  `CREATE INDEX IF NOT EXISTS idx_issuances_work_room ON issuances(work_room_id)`,
  `ALTER TABLE production_confirmation_log ADD COLUMN IF NOT EXISTS work_room_id INTEGER REFERENCES work_rooms(id) ON DELETE SET NULL`,
  `ALTER TABLE issuances ADD COLUMN IF NOT EXISTS work_entrance_id INTEGER REFERENCES work_entrances(id) ON DELETE SET NULL`,
  `ALTER TABLE issuances ADD COLUMN IF NOT EXISTS work_floor_id INTEGER REFERENCES work_floors(id) ON DELETE SET NULL`,
  `ALTER TABLE issuances ADD COLUMN IF NOT EXISTS work_apartment_id INTEGER REFERENCES work_apartments(id) ON DELETE SET NULL`,
  `ALTER TABLE production_confirmation_log ADD COLUMN IF NOT EXISTS work_entrance_id INTEGER REFERENCES work_entrances(id) ON DELETE SET NULL`,
  `ALTER TABLE production_confirmation_log ADD COLUMN IF NOT EXISTS work_floor_id INTEGER REFERENCES work_floors(id) ON DELETE SET NULL`,
  `ALTER TABLE production_confirmation_log ADD COLUMN IF NOT EXISTS work_apartment_id INTEGER REFERENCES work_apartments(id) ON DELETE SET NULL`,
  `ALTER TABLE issuances ADD COLUMN IF NOT EXISTS work_object_id INTEGER REFERENCES warehouse_objects(id) ON DELETE SET NULL`,
  `ALTER TABLE issuances ADD COLUMN IF NOT EXISTS work_location_items JSONB`,
  `ALTER TABLE production_confirmation_log ADD COLUMN IF NOT EXISTS work_object_id INTEGER REFERENCES warehouse_objects(id) ON DELETE SET NULL`,
  `ALTER TABLE production_confirmation_log ADD COLUMN IF NOT EXISTS work_location_items JSONB`,
  `ALTER TABLE production_confirmation_log ADD COLUMN IF NOT EXISTS event_type VARCHAR(20)`,
  `UPDATE production_confirmation_log SET event_type = CASE WHEN confirmed THEN 'confirm' ELSE 'unconfirm' END WHERE event_type IS NULL`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS face_photo VARCHAR(255)`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS hourly_rate DECIMAL(18,2)`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS password_plain VARCHAR(255)`,
  `ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS marked_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`,
  `ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS manual_worked_minutes INTEGER`,
  `ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS edited_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`,
  `ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ`,
  `ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS last_face_scan_at TIMESTAMPTZ`,
  `ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS day_comment TEXT`,
  `ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS manual_minutes_updated_at TIMESTAMPTZ`,
  `UPDATE attendance_records SET last_face_scan_at = COALESCE(check_out_at, check_in_at)
   WHERE last_face_scan_at IS NULL AND (check_in_at IS NOT NULL OR check_out_at IS NOT NULL)`,
  `UPDATE attendance_records SET manual_minutes_updated_at = COALESCE(edited_at, last_face_scan_at, check_out_at, check_in_at)
   WHERE manual_worked_minutes IS NOT NULL AND manual_minutes_updated_at IS NULL`,
  `ALTER TABLE attendance_records ALTER COLUMN check_in_at DROP NOT NULL`,
  `CREATE TABLE IF NOT EXISTS timesheet_month_rates (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    month_key VARCHAR(7) NOT NULL,
    hourly_rate DECIMAL(18,2),
    bonus_rate DECIMAL(18,2),
    UNIQUE(user_id, month_key)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_timesheet_month_rates_month ON timesheet_month_rates(month_key)`,
  `CREATE TABLE IF NOT EXISTS organizations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(500) NOT NULL,
    inn VARCHAR(12),
    kpp VARCHAR(9),
    ogrn VARCHAR(15),
    legal_address TEXT,
    actual_address TEXT,
    phone VARCHAR(50),
    email VARCHAR(200),
    director_name VARCHAR(300),
    bank_name VARCHAR(300),
    bank_bik VARCHAR(9),
    bank_account VARCHAR(20),
    bank_corr_account VARCHAR(20),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (name)
  )`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL`,
  `CREATE INDEX IF NOT EXISTS idx_users_organization ON users(organization_id)`,
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
