import 'dotenv/config';
import pool from './pool.js';
import bcrypt from 'bcryptjs';

const ADMIN_ROLE_NAME = 'Администратор';

async function ensureAdminRoleId(client) {
  const existing = (await client.query(
    'SELECT id FROM roles WHERE LOWER(TRIM(name)) = LOWER($1) LIMIT 1',
    [ADMIN_ROLE_NAME],
  )).rows[0];
  if (existing?.id) return Number(existing.id);
  const created = (await client.query(
    'INSERT INTO roles (name, warehouse_permissions_customized) VALUES ($1, true) RETURNING id',
    [ADMIN_ROLE_NAME],
  )).rows[0];
  return Number(created.id);
}

const login = (process.env.ADMIN_LOGIN || 'admin').trim();
const password = process.env.ADMIN_PASSWORD || 'admin';

async function upsertPermissions(client, userId) {
  const { rows } = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'user_permissions' AND column_name = 'can_attendance'`
  );
  const hasAttendance = rows.length > 0;
  if (hasAttendance) {
    await client.query(
      `INSERT INTO user_permissions (user_id, can_warehouse, can_issuance, can_production, can_users, can_attendance)
       VALUES ($1, true, true, true, true, true)
       ON CONFLICT (user_id) DO UPDATE SET
         can_warehouse = true, can_issuance = true, can_production = true,
         can_users = true, can_attendance = true`,
      [userId]
    );
  } else {
    await client.query(
      `INSERT INTO user_permissions (user_id, can_warehouse, can_issuance, can_production, can_users)
       VALUES ($1, true, true, true, true)
       ON CONFLICT (user_id) DO UPDATE SET
         can_warehouse = true, can_issuance = true, can_production = true, can_users = true`,
      [userId]
    );
  }
}

async function createAdmin() {
  const hash = await bcrypt.hash(password, 10);
  const client = await pool.connect();
  try {
    const adminRoleId = await ensureAdminRoleId(client);
    const { rows } = await client.query(
      `INSERT INTO users (login, password_hash, display_name, role, role_id)
       VALUES ($1, $2, 'Администратор', 'admin', $3)
       ON CONFLICT (login) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         display_name = EXCLUDED.display_name,
         role = 'admin',
         role_id = EXCLUDED.role_id
       RETURNING id`,
      [login, hash, adminRoleId]
    );
    await upsertPermissions(client, rows[0].id);
    console.log('OK: пользователь создан/обновлён:', login, '(пароль из ADMIN_PASSWORD или "admin")');
  } finally {
    client.release();
    await pool.end();
  }
}

createAdmin().catch((e) => {
  console.error('create-admin failed:', e.message);
  process.exit(1);
});
