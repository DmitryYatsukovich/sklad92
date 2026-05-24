import 'dotenv/config';
import pool from './pool.js';

const sql = [
  `ALTER TABLE issuances ADD COLUMN IF NOT EXISTS work_room_id INTEGER REFERENCES work_rooms(id) ON DELETE SET NULL`,
  `CREATE INDEX IF NOT EXISTS idx_issuances_work_room ON issuances(work_room_id)`,
  `ALTER TABLE production_confirmation_log ADD COLUMN IF NOT EXISTS work_room_id INTEGER REFERENCES work_rooms(id) ON DELETE SET NULL`,
];

async function migrate() {
  const client = await pool.connect();
  try {
    for (const stmt of sql) {
      await client.query(stmt);
    }
    console.log('migrate-production-work-location: OK');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((e) => {
  console.error(e);
  process.exit(1);
});
