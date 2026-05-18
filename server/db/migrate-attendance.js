import 'dotenv/config';
import pool from './pool.js';

const statements = [
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS face_descriptor JSONB`,
  `ALTER TABLE user_permissions ADD COLUMN IF NOT EXISTS can_attendance BOOLEAN DEFAULT false`,
  `ALTER TABLE roles ADD COLUMN IF NOT EXISTS can_attendance BOOLEAN DEFAULT false`,
  `CREATE TABLE IF NOT EXISTS attendance_records (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    visit_date DATE NOT NULL,
    check_in_at TIMESTAMPTZ NOT NULL,
    check_out_at TIMESTAMPTZ,
    UNIQUE(user_id, visit_date)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_attendance_visit_date ON attendance_records(visit_date)`,
  `CREATE INDEX IF NOT EXISTS idx_attendance_user ON attendance_records(user_id)`,
  `UPDATE roles SET can_attendance = true WHERE name = 'Администратор' AND can_attendance IS NOT TRUE`,
];

async function migrate() {
  const client = await pool.connect();
  try {
    for (const stmt of statements) {
      await client.query(stmt);
    }
    console.log('Attendance / face migration completed.');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((e) => {
  console.error(e);
  process.exit(1);
});
