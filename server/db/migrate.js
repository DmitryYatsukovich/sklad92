import 'dotenv/config';
import pool from './pool.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const sql = `
-- Пользователи
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  login VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(200),
  role VARCHAR(20) NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Права доступа по функциям (для каждого пользователя)
CREATE TABLE IF NOT EXISTS user_permissions (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  can_warehouse BOOLEAN DEFAULT true,
  can_issuance BOOLEAN DEFAULT true,
  can_production BOOLEAN DEFAULT true,
  can_users BOOLEAN DEFAULT false
);

-- Материалы на складе
CREATE TABLE IF NOT EXISTS materials (
  id SERIAL PRIMARY KEY,
  code VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(300) NOT NULL,
  unit VARCHAR(50) DEFAULT 'шт',
  quantity DECIMAL(18,4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Выдачи материалов пользователям
CREATE TABLE IF NOT EXISTS issuances (
  id SERIAL PRIMARY KEY,
  material_id INTEGER NOT NULL REFERENCES materials(id),
  issued_by_user_id INTEGER NOT NULL REFERENCES users(id),
  issued_to_user_id INTEGER NOT NULL REFERENCES users(id),
  quantity DECIMAL(18,4) NOT NULL,
  issued_at TIMESTAMPTZ DEFAULT NOW(),
  returned_at TIMESTAMPTZ,
  returned_quantity DECIMAL(18,4) DEFAULT 0,
  note TEXT
);

CREATE INDEX IF NOT EXISTS idx_issuances_material ON issuances(material_id);
CREATE INDEX IF NOT EXISTS idx_issuances_to_user ON issuances(issued_to_user_id);
CREATE INDEX IF NOT EXISTS idx_issuances_issued_at ON issuances(issued_at);
`;

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(sql);
    console.log('Migration completed.');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((e) => {
  console.error(e);
  process.exit(1);
});
