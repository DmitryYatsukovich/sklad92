import 'dotenv/config';
import pool from './pool.js';

const sql = `
-- Соответствие номера карты доступа (ПИК и др.) внутреннему номеру (UID)
CREATE TABLE IF NOT EXISTS card_uid_mapping (
  card_number VARCHAR(20) PRIMARY KEY,
  internal_uid VARCHAR(20) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_card_uid_mapping_internal_uid ON card_uid_mapping(internal_uid);

-- Внутренний номер сотрудника (UID) для связи с картой доступа
ALTER TABLE users ADD COLUMN IF NOT EXISTS internal_uid VARCHAR(20);
CREATE INDEX IF NOT EXISTS idx_users_internal_uid ON users(internal_uid);
`;

async function migrate() {
  const client = await pool.connect();
  try {
    for (const stmt of sql.trim().split(';').filter(Boolean)) {
      await client.query(stmt);
    }
    console.log('Card/UID migration completed.');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((e) => {
  console.error(e);
  process.exit(1);
});
