import 'dotenv/config';
import pool from './pool.js';

const statements = [
  `CREATE TABLE IF NOT EXISTS roles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    can_warehouse BOOLEAN DEFAULT true,
    can_issuance BOOLEAN DEFAULT true,
    can_production BOOLEAN DEFAULT true,
    can_users BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `ALTER TABLE roles ADD COLUMN IF NOT EXISTS can_warehouse BOOLEAN DEFAULT true`,
  `ALTER TABLE roles ADD COLUMN IF NOT EXISTS can_issuance BOOLEAN DEFAULT true`,
  `ALTER TABLE roles ADD COLUMN IF NOT EXISTS can_production BOOLEAN DEFAULT true`,
  `ALTER TABLE roles ADD COLUMN IF NOT EXISTS can_users BOOLEAN DEFAULT false`,
  `ALTER TABLE roles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS role_id INTEGER REFERENCES roles(id) ON DELETE SET NULL`,
  // Синхронизировать sequence на случай рассинхронизации
  `SELECT setval(pg_get_serial_sequence('roles', 'id'), COALESCE((SELECT MAX(id) FROM roles), 0))`,
  `INSERT INTO roles (name, can_warehouse, can_issuance, can_production, can_users)
   SELECT 'Администратор', true, true, true, true
   WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'Администратор')`,
  `INSERT INTO roles (name, can_warehouse, can_issuance, can_production, can_users)
   SELECT 'Пользователь', true, true, true, false
   WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'Пользователь')`,
];

async function migrate() {
  const client = await pool.connect();
  try {
    for (const stmt of statements) {
      await client.query(stmt);
    }
    console.log('Roles migration completed.');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((e) => {
  console.error(e);
  process.exit(1);
});
