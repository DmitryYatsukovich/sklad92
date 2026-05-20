import 'dotenv/config';
import pool from './pool.js';

const sql = `ALTER TABLE materials ADD COLUMN IF NOT EXISTS price DECIMAL(18,2) DEFAULT 0`;

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(sql);
    console.log('materials price migration completed.');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((e) => {
  console.error(e);
  process.exit(1);
});
