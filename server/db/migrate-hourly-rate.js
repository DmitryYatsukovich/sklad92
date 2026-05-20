import 'dotenv/config';
import pool from './pool.js';

const sql = `ALTER TABLE users ADD COLUMN IF NOT EXISTS hourly_rate DECIMAL(18,2)`;

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(sql);
    console.log('hourly_rate migration completed.');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((e) => {
  console.error(e);
  process.exit(1);
});
