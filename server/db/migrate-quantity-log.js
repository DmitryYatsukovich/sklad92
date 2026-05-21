import 'dotenv/config';
import pool from './pool.js';

const sql = `
CREATE TABLE IF NOT EXISTS material_quantity_log (
  id SERIAL PRIMARY KEY,
  material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  delta DECIMAL(18,4) NOT NULL,
  quantity_after DECIMAL(18,4) NOT NULL,
  kind VARCHAR(30) NOT NULL,
  issuance_id INTEGER REFERENCES issuances(id) ON DELETE SET NULL,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mql_material ON material_quantity_log(material_id);
CREATE INDEX IF NOT EXISTS idx_mql_created ON material_quantity_log(created_at DESC);
`;

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(sql);
    console.log('material_quantity_log migration completed.');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((e) => {
  console.error(e);
  process.exit(1);
});
