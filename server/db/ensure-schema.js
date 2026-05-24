import pool from './pool.js';

/** Идемпотентные миграции при старте (Timeweb: без ручного npm run db:migrate-*).
 *  Не перезаписываем roles / user_permissions — сохранённые настройки ролей остаются после перезапуска.
 *  Синхронизация прав пользователей с ролью — при сохранении роли (PUT /api/roles/:id). */
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
  `ALTER TABLE materials ADD COLUMN IF NOT EXISTS parent_material_id INTEGER REFERENCES materials(id) ON DELETE CASCADE`,
  `ALTER TABLE materials ADD COLUMN IF NOT EXISTS part_index INTEGER`,
  `ALTER TABLE materials ADD COLUMN IF NOT EXISTS part_label VARCHAR(120)`,
  `CREATE INDEX IF NOT EXISTS idx_materials_parent ON materials(parent_material_id)`,
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
  `ALTER TABLE user_permissions ADD COLUMN IF NOT EXISTS can_settings_organizations BOOLEAN DEFAULT false`,
  `ALTER TABLE roles ADD COLUMN IF NOT EXISTS can_settings_organizations BOOLEAN DEFAULT false`,
  `ALTER TABLE user_permissions ADD COLUMN IF NOT EXISTS can_settings_warehouses BOOLEAN DEFAULT false`,
  `ALTER TABLE roles ADD COLUMN IF NOT EXISTS can_settings_warehouses BOOLEAN DEFAULT false`,
  `ALTER TABLE user_permissions ADD COLUMN IF NOT EXISTS can_settings_categories BOOLEAN DEFAULT false`,
  `ALTER TABLE roles ADD COLUMN IF NOT EXISTS can_settings_categories BOOLEAN DEFAULT false`,
  `ALTER TABLE user_permissions ADD COLUMN IF NOT EXISTS can_settings_work BOOLEAN DEFAULT false`,
  `ALTER TABLE roles ADD COLUMN IF NOT EXISTS can_settings_work BOOLEAN DEFAULT false`,
  `ALTER TABLE roles ADD COLUMN IF NOT EXISTS can_roles BOOLEAN DEFAULT false`,
  `ALTER TABLE user_permissions ADD COLUMN IF NOT EXISTS can_roles BOOLEAN DEFAULT false`,
  `ALTER TABLE roles ADD COLUMN IF NOT EXISTS can_attendance_all BOOLEAN DEFAULT false`,
  `ALTER TABLE user_permissions ADD COLUMN IF NOT EXISTS can_attendance_all BOOLEAN DEFAULT false`,
  `ALTER TABLE roles ADD COLUMN IF NOT EXISTS can_attendance_edit BOOLEAN DEFAULT false`,
  `ALTER TABLE user_permissions ADD COLUMN IF NOT EXISTS can_attendance_edit BOOLEAN DEFAULT false`,
  `ALTER TABLE roles ADD COLUMN IF NOT EXISTS can_attendance_pay BOOLEAN DEFAULT false`,
  `ALTER TABLE user_permissions ADD COLUMN IF NOT EXISTS can_attendance_pay BOOLEAN DEFAULT false`,
  `ALTER TABLE roles ADD COLUMN IF NOT EXISTS can_attendance_edit_rates BOOLEAN DEFAULT false`,
  `ALTER TABLE user_permissions ADD COLUMN IF NOT EXISTS can_attendance_edit_rates BOOLEAN DEFAULT false`,
  `ALTER TABLE roles ADD COLUMN IF NOT EXISTS can_attendance_add_member BOOLEAN DEFAULT false`,
  `ALTER TABLE user_permissions ADD COLUMN IF NOT EXISTS can_attendance_add_member BOOLEAN DEFAULT false`,
  `ALTER TABLE roles ADD COLUMN IF NOT EXISTS can_attendance_export BOOLEAN DEFAULT false`,
  `ALTER TABLE user_permissions ADD COLUMN IF NOT EXISTS can_attendance_export BOOLEAN DEFAULT false`,
  `ALTER TABLE roles ADD COLUMN IF NOT EXISTS can_attendance_import BOOLEAN DEFAULT false`,
  `ALTER TABLE user_permissions ADD COLUMN IF NOT EXISTS can_attendance_import BOOLEAN DEFAULT false`,
  `ALTER TABLE roles ADD COLUMN IF NOT EXISTS can_attendance_change_month BOOLEAN DEFAULT false`,
  `ALTER TABLE user_permissions ADD COLUMN IF NOT EXISTS can_attendance_change_month BOOLEAN DEFAULT false`,
  `ALTER TABLE user_permissions ADD COLUMN IF NOT EXISTS can_face BOOLEAN DEFAULT false`,
  `ALTER TABLE roles ADD COLUMN IF NOT EXISTS can_face BOOLEAN DEFAULT false`,
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
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_data BYTEA`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_mime VARCHAR(64)`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS face_photo_data BYTEA`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS face_photo_mime VARCHAR(64)`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS hourly_rate DECIMAL(18,2)`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS password_plain VARCHAR(255)`,
  `ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS marked_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`,
  `ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS manual_worked_minutes INTEGER`,
  `ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS edited_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`,
  `ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ`,
  `ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS last_face_scan_at TIMESTAMPTZ`,
  `ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS day_comment TEXT`,
  `ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS manual_minutes_updated_at TIMESTAMPTZ`,
  `ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS times_edited_at TIMESTAMPTZ`,
  `ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS check_in_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`,
  `ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS check_out_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`,
  `ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS check_in_via VARCHAR(16)`,
  `ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS check_out_via VARCHAR(16)`,
  `UPDATE attendance_records SET times_edited_at = edited_at
   WHERE times_edited_at IS NULL AND edited_by_user_id IS NOT NULL
     AND (check_in_at IS NOT NULL OR check_out_at IS NOT NULL)`,
  `UPDATE attendance_records SET check_in_by_user_id = marked_by_user_id, check_in_via = 'face'
   WHERE check_in_at IS NOT NULL AND check_in_by_user_id IS NULL AND marked_by_user_id IS NOT NULL`,
  `UPDATE attendance_records SET check_out_by_user_id = marked_by_user_id, check_out_via = 'face'
   WHERE check_out_at IS NOT NULL AND check_out_by_user_id IS NULL AND marked_by_user_id IS NOT NULL`,
  `UPDATE attendance_records SET check_out_by_user_id = edited_by_user_id, check_out_via = 'manual'
   WHERE check_out_at IS NOT NULL AND times_edited_at IS NOT NULL AND edited_by_user_id IS NOT NULL`,
  `UPDATE attendance_records SET check_in_by_user_id = edited_by_user_id, check_in_via = 'manual'
   WHERE check_in_at IS NOT NULL AND check_out_at IS NULL AND times_edited_at IS NOT NULL AND edited_by_user_id IS NOT NULL`,
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
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_active BOOLEAN DEFAULT true`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS employment_status VARCHAR(20) DEFAULT 'working'`,
  `UPDATE users SET profile_active = true WHERE profile_active IS NULL`,
  `UPDATE users SET employment_status = 'working' WHERE employment_status IS NULL OR TRIM(employment_status) = ''`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS labor_contract_data BYTEA`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS labor_contract_mime VARCHAR(128)`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS labor_contract_filename VARCHAR(255)`,
  `CREATE TABLE IF NOT EXISTS user_labor_contract_files (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    mime VARCHAR(128) NOT NULL DEFAULT 'application/octet-stream',
    file_data BYTEA NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_user_labor_contract_files_user ON user_labor_contract_files(user_id)`,
  `CREATE TABLE IF NOT EXISTS app_action_log (
    id SERIAL PRIMARY KEY,
    client_id VARCHAR(64) NOT NULL UNIQUE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    kind VARCHAR(50) NOT NULL,
    title VARCHAR(300) NOT NULL,
    description TEXT,
    payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_app_action_log_created ON app_action_log(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_app_action_log_user ON app_action_log(user_id)`,
  `ALTER TABLE user_permissions ADD COLUMN IF NOT EXISTS can_actions BOOLEAN DEFAULT false`,
  `ALTER TABLE roles ADD COLUMN IF NOT EXISTS can_actions BOOLEAN DEFAULT false`,
  `ALTER TABLE user_permissions ADD COLUMN IF NOT EXISTS can_actions_all BOOLEAN DEFAULT false`,
  `ALTER TABLE roles ADD COLUMN IF NOT EXISTS can_actions_all BOOLEAN DEFAULT false`,
];

export async function ensureSchema() {
  if (process.env.ENSURE_SCHEMA_ON_START === 'false') return;

  const client = await pool.connect();
  try {
    for (const stmt of statements) {
      await client.query(stmt);
    }
    console.log('ensureSchema: OK');
    const { migrateUserImagesFromDisk } = await import('../lib/user-images.js');
    await migrateUserImagesFromDisk(pool);
    const { migrateLaborContractsToTable } = await import('../lib/user-labor-contract.js');
    await migrateLaborContractsToTable(pool);
    if (process.env.SYNC_USER_PERMISSIONS_ON_START === 'true') {
      const { syncAllUsersPermissionsFromRoles } = await import(
        '../lib/sync-user-permissions-from-role.js'
      );
      await syncAllUsersPermissionsFromRoles(pool);
    }
  } catch (e) {
    console.error('ensureSchema:', e.message);
    throw e;
  } finally {
    client.release();
  }
}
