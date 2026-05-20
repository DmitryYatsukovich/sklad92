import 'dotenv/config';
import pool from './pool.js';

const sql = [
  `ALTER TABLE issuances ADD COLUMN IF NOT EXISTS production_confirmed BOOLEAN DEFAULT false`,
  `ALTER TABLE issuances ADD COLUMN IF NOT EXISTS production_confirmed_at TIMESTAMPTZ`,
  `ALTER TABLE issuances ADD COLUMN IF NOT EXISTS production_confirmed_by INTEGER REFERENCES users(id) ON DELETE SET NULL`,
];

async function migrate() {
  const client = await pool.connect();
  try {
    for (const stmt of sql) {
      await client.query(stmt);
    }
    console.log('migrate-production-confirmed: OK');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((e) => {
  console.error(e);
  process.exit(1);
});
