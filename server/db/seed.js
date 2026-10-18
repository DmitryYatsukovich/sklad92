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

async function seed() {
  const client = await pool.connect();
  try {
    const adminRoleId = await ensureAdminRoleId(client);
    const adminLogin = process.env.ADMIN_LOGIN || 'admin';
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin';
    const hash = await bcrypt.hash(adminPassword, 10);

    await client.query(
      `INSERT INTO users (login, password_hash, display_name, role, role_id)
       VALUES ($1, $2, 'Администратор', 'admin', $3)
       ON CONFLICT (login) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         display_name = EXCLUDED.display_name,
         role = 'admin',
         role_id = EXCLUDED.role_id`,
      [adminLogin, hash, adminRoleId]
    );

    const { rows: [admin] } = await client.query(
      'SELECT id FROM users WHERE login = $1',
      [adminLogin]
    );
    if (admin) {
      await client.query(
        `INSERT INTO user_permissions (user_id, can_warehouse, can_issuance, can_production, can_users)
         VALUES ($1, true, true, true, true)
         ON CONFLICT (user_id) DO UPDATE SET can_users = true, can_warehouse = true, can_issuance = true, can_production = true`,
        [admin.id]
      );
    }

    const managerLogin = process.env.MANAGER_LOGIN || 'manager';
    const managerPassword = process.env.MANAGER_PASSWORD || 'manager';
    const managerHash = await bcrypt.hash(managerPassword, 10);
    await client.query(
      `INSERT INTO users (login, password_hash, display_name, role)
       VALUES ($1, $2, 'Менеджер', 'admin')
       ON CONFLICT (login) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         role = 'admin'`,
      [managerLogin, managerHash]
    );
    const { rows: [manager] } = await client.query('SELECT id FROM users WHERE login = $1', [managerLogin]);
    if (manager) {
      await client.query(
        `INSERT INTO user_permissions (user_id, can_warehouse, can_issuance, can_production, can_users)
         VALUES ($1, true, true, true, true)
         ON CONFLICT (user_id) DO UPDATE SET can_warehouse = true, can_issuance = true, can_production = true, can_users = true`,
        [manager.id]
      );
    }

    const testHash = await bcrypt.hash('test', 10);
    await client.query(
      `INSERT INTO users (login, password_hash, display_name, first_name, last_name, role)
       VALUES ('test', $1, 'Тестовый пользователь', 'Тест', 'Тестов', 'user')
       ON CONFLICT (login) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      [testHash]
    );
    const { rows: [testUser] } = await client.query("SELECT id FROM users WHERE login = 'test'");
    if (testUser) {
      await client.query(
        `INSERT INTO user_permissions (user_id, can_warehouse, can_issuance, can_production, can_users)
         VALUES ($1, true, true, true, false)
         ON CONFLICT (user_id) DO UPDATE SET can_warehouse = true, can_issuance = true, can_production = true`,
        [testUser.id]
      );
    }

    console.log('Seed completed. Default admin:', adminLogin, '/', adminPassword);
    console.log('User with all rights:', managerLogin, '/', managerPassword);
    console.log('Test user for edit/photo:', 'test', '/', 'test');
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
