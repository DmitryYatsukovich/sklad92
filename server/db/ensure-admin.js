import pool from './pool.js';
import bcrypt from 'bcryptjs';

/** Создаёт или обновляет admin при старте (логин/пароль из env или admin/admin). */
export async function ensureAdminUser() {
  if (process.env.ENSURE_ADMIN_ON_START === 'false') return;

  const login = (process.env.ADMIN_LOGIN || 'admin').trim();
  const password = process.env.ADMIN_PASSWORD || 'admin';
  const hash = await bcrypt.hash(password, 10);

  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `INSERT INTO users (login, password_hash, display_name, role)
       VALUES ($1, $2, 'Администратор', 'admin')
       ON CONFLICT (login) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         role = 'admin'
       RETURNING id`,
      [login, hash]
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
