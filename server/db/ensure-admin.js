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

/** Создаёт или обновляет admin при старте (логин/пароль из env или admin/admin). */
export async function ensureAdminUser() {
  if (process.env.ENSURE_ADMIN_ON_START === 'false') return;

  const login = (process.env.ADMIN_LOGIN || 'admin').trim();
  const password = process.env.ADMIN_PASSWORD || 'admin';
  const hash = await bcrypt.hash(password, 10);

  const client = await pool.connect();
  try {
    const adminRoleId = await ensureAdminRoleId(client);
    const { rows } = await client.query(
      `INSERT INTO users (login, password_hash, display_name, role, role_id)
       VALUES ($1, $2, 'Администратор', 'admin', $3)
       ON CONFLICT (login) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         role = 'admin',
         role_id = EXCLUDED.role_id
       RETURNING id`,
      [login, hash, adminRoleId]
    );
    const userId = rows[0].id;
    const { rows: cols } = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'user_permissions' AND column_name = 'can_attendance'`
    );
    if (cols.length > 0) {
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
    console.log('Admin для входа:', login, '(пароль: ADMIN_PASSWORD или "admin")');
  } catch (e) {
    console.error('ensureAdminUser:', e.message);
  } finally {
    client.release();
  }
}
