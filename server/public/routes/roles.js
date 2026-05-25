import { Router } from 'express';
import pool from '../db/pool.js';
import { requireAuth, loadUser, requirePermission } from '../middleware/auth.js';
import {
  APP_PERMISSIONS,
  PERMISSION_KEYS,
  ROLE_COLUMNS,
  isAdminRoleName,
  fullPermissionFlags,
  permissionsFromBody,
  ADMIN_ROLE_NAME,
} from '../lib/app-permissions.js';
import { syncUsersPermissionsFromRole } from '../lib/sync-user-permissions-from-role.js';

const router = Router();
router.use(requireAuth);
router.use(loadUser);
router.use(requirePermission('can_roles'));

async function ensureAdminRoleFullAccess(client) {
  const sets = PERMISSION_KEYS.map((k) => `${k} = true`).join(', ');
  await client.query(
    `UPDATE roles SET ${sets} WHERE LOWER(TRIM(name)) = LOWER($1)`,
    [ADMIN_ROLE_NAME],
  );
}

router.get('/permissions', (_req, res) => {
  res.json(APP_PERMISSIONS);
});

router.get('/', async (_req, res) => {
  const client = await pool.connect();
  try {
    await ensureAdminRoleFullAccess(client);
    const r = await client.query(
      `SELECT id, name, ${ROLE_COLUMNS}, created_at FROM roles ORDER BY name`,
    );
    res.json(r.rows.map((row) => ({
      ...row,
      is_admin_role: isAdminRoleName(row.name),
    })));
  } finally {
    client.release();
  }
});

router.post('/', async (req, res) => {
  const { name, ...rest } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Укажите название роли' });
  if (isAdminRoleName(name)) {
    return res.status(400).json({ error: 'Роль «Администратор» создаётся системой' });
  }
  const perms = permissionsFromBody(rest);
  const cols = ['name', ...PERMISSION_KEYS];
  const vals = [name.trim(), ...PERMISSION_KEYS.map((k) => perms[k])];
  const placeholders = vals.map((_, i) => `$${i + 1}`).join(', ');
  try {
    const r = await pool.query(
      `INSERT INTO roles (${cols.join(', ')}) VALUES (${placeholders})
       RETURNING id, name, ${ROLE_COLUMNS}, created_at`,
      vals,
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Роль с таким названием уже есть' });
    throw e;
  }
});

router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { name, ...rest } = req.body || {};
  if (!id) return res.status(400).json({ error: 'Неверный id' });

  const cur = (await pool.query('SELECT id, name FROM roles WHERE id = $1', [id])).rows[0];
  if (!cur) return res.status(404).json({ error: 'Роль не найдена' });

  const adminRole = isAdminRoleName(cur.name) || isAdminRoleName(name);
  const perms = adminRole ? fullPermissionFlags(true) : permissionsFromBody(rest);
  const roleName = adminRole ? ADMIN_ROLE_NAME : (name?.trim() || cur.name);

  const sets = ['name = $1', ...PERMISSION_KEYS.map((k, i) => `${k} = $${i + 2}`)];
  const vals = [roleName, ...PERMISSION_KEYS.map((k) => perms[k]), id];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE roles SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
    await syncUsersPermissionsFromRole(client, id, perms);
    await client.query('COMMIT');
    const r = await client.query(
      `SELECT id, name, ${ROLE_COLUMNS}, created_at FROM roles WHERE id = $1`,
      [id],
    );
    res.json({ ...r.rows[0], is_admin_role: isAdminRoleName(r.rows[0].name) });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    if (e.code === '23505') return res.status(400).json({ error: 'Роль с таким названием уже есть' });
    throw e;
  } finally {
    client.release();
  }
});

router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const cur = (await pool.query('SELECT name FROM roles WHERE id = $1', [id])).rows[0];
  if (!cur) return res.status(404).json({ error: 'Роль не найдена' });
  if (isAdminRoleName(cur.name)) {
    return res.status(400).json({ error: 'Роль «Администратор» нельзя удалить' });
  }
  const used = await pool.query('SELECT COUNT(*)::int AS c FROM users WHERE role_id = $1', [id]);
  if (used.rows[0]?.c > 0) {
    return res.status(400).json({ error: 'Роль назначена пользователям — сначала смените им роль' });
  }
  const r = await pool.query('DELETE FROM roles WHERE id = $1 RETURNING id', [id]);
  if (r.rowCount === 0) return res.status(404).json({ error: 'Роль не найдена' });
  res.json({ ok: true });
});

export default router;
