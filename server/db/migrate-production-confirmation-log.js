import 'dotenv/config';
import pool from './pool.js';

const sql = [
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
];

async function migrate() {
  const client = await pool.connect();
  try {
    for (const stmt of sql) {
      await client.query(stmt);
    }
    console.log('migrate-production-confirmation-log: OK');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((e) => {
  console.error(e);
  process.exit(1);
});
