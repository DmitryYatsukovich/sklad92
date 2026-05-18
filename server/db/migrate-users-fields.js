import 'dotenv/config';
import pool from './pool.js';

const sql = `
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name VARCHAR(200);
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name VARCHAR(200);
ALTER TABLE users ADD COLUMN IF NOT EXISTS birth_date DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS passport_number VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS snils VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS inn VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS employment_date DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar VARCHAR(255);
`;

async function migrate() {
  const client = await pool.connect();
  try {
    for (const stmt of sql.trim().split(';').filter(Boolean)) {
      await client.query(stmt);
    }
    console.log('User fields migration completed.');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((e) => {
  console.error(e);
  process.exit(1);
});
