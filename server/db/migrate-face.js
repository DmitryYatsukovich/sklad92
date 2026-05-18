import 'dotenv/config';
import pool from './pool.js';

const sql = [
  `ALTER TABLE user_permissions ADD COLUMN IF NOT EXISTS can_face BOOLEAN DEFAULT false`,
  `ALTER TABLE roles ADD COLUMN IF NOT EXISTS can_face BOOLEAN DEFAULT false`,
  `UPDATE user_permissions SET can_face = true WHERE can_face IS NOT TRUE`,
];

async function migrate() {
  const client = await pool.connect();
  try {
    for (const stmt of sql) {
      await client.query(stmt);
    }
    console.log('migrate-face: OK');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((e) => {
  console.error(e);
  process.exit(1);
});
