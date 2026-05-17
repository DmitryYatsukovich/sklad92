import 'dotenv/config';
import pool from './pool.js';

const sql = `ALTER TABLE users ADD COLUMN IF NOT EXISTS employment_org VARCHAR(300)`;

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(sql);
    console.log('employment_org migration completed.');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((e) => {
  console.error(e);
  process.exit(1);
});
