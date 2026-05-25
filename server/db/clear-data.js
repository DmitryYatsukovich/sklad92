import 'dotenv/config';
import pool from './pool.js';

/** Порядок не важен — одна команда TRUNCATE с CASCADE. */
const DATA_TABLES = [
  'app_action_log',
  'production_confirmation_log',
  'material_quantity_log',
  'issuances',
  'materials',
  'attendance_records',
  'timesheet_month_rates',
  'user_labor_contract_files',
  'card_uid_mapping',
  'work_rooms',
  'work_apartments',
  'work_floors',
  'work_entrances',
  'warehouse_racks',
  'warehouses',
  'warehouse_objects',
  'material_categories',
  'user_permissions',
  'users',
  'organizations',
  'roles',
  'session',
];

async function clearData() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
    );
    const existing = new Set(rows.map((r) => r.tablename));
    const toTruncate = DATA_TABLES.filter((t) => existing.has(t));

    if (toTruncate.length === 0) {
      console.log('Нет таблиц для очистки (схема не создана?).');
      return;
    }

    const quoted = toTruncate.map((t) => `"${t}"`).join(', ');
    await client.query(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
    console.log('Очищено таблиц:', toTruncate.length);
    console.log(toTruncate.join(', '));
  } finally {
    client.release();
    await pool.end();
  }
}

clearData().catch((e) => {
  console.error(e);
  process.exit(1);
});
