import 'dotenv/config';
import pool from './pool.js';

const sql = [
  `ALTER TABLE user_permissions ADD COLUMN IF NOT EXISTS can_settings BOOLEAN DEFAULT false`,
  `ALTER TABLE roles ADD COLUMN IF NOT EXISTS can_settings BOOLEAN DEFAULT false`,
  `UPDATE user_permissions SET can_settings = COALESCE(can_warehouse, false)
   WHERE can_settings IS NOT TRUE AND COALESCE(can_warehouse, false) = true`,
];

async function migrate() {
  const client = await pool.connect();
  try {
    for (const stmt of sql) {
      await client.query(stmt);
    }
    console.log('migrate-settings: OK');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((e) => {
  console.error(e);
  process.exit(1);
});
