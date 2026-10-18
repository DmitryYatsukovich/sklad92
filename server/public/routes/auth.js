import { Router } from 'express';
import bcrypt from 'bcryptjs';
import pool from '../db/pool.js';
import { loadUser } from '../middleware/auth.js';
import { PERMISSION_KEYS } from '../lib/app-permissions.js';
import { userAccessBlockReason } from '../lib/user-access.js';
import { ADMIN_PERMISSION_BYPASS_SQL } from '../lib/admin-bypass.js';
import {
  resolveUserPermissionsForSave,
  upsertUserPermissions,
} from '../lib/sync-user-permissions-from-role.js';

const router = Router();
const ROLE_PERMISSIONS_SELECT = PERMISSION_KEYS
  .map((k) => `COALESCE(r.${k}, false) AS role_${k}`)
  .join(',\n            ');

function effectivePermissionsFromRoleRow(row = {}) {
  const isAdminBypass = !!row.admin_permission_bypass;
  const perms = {};
  for (const key of PERMISSION_KEYS) {
    perms[key] = isAdminBypass ? true : !!row[`role_${key}`];
  }
  perms.can_objects = !!(perms.can_objects || perms.can_settings_work);
  return perms;
}

router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

function userPayload(base, perms = {}) {
  const effectivePerms = {
    ...perms,
    can_objects: !!(perms.can_objects || perms.can_settings_work),
  };
  return {
    id: base.id,
    login: base.login,
    display_name: base.display_name,
    role: base.role,
    admin_permission_bypass: !!(perms.admin_permission_bypass ?? base.admin_permission_bypass),
    ...Object.fromEntries(PERMISSION_KEYS.map((k) => [k, !!effectivePerms[k]])),
  };
}

router.post('/login', async (req, res) => {
  const login = (req.body?.login || '').trim();
  const password = req.body?.password ?? '';
  if (!login || !password) {
    return res.status(400).json({ error: 'Укажите логин и пароль' });
  }
  const r = await pool.query(
    `SELECT id, login, password_hash, display_name, role, role_id,
            COALESCE(profile_active, true) AS profile_active,
            COALESCE(employment_status, 'working') AS employment_status
     FROM users WHERE LOWER(TRIM(login)) = LOWER($1)`,
    [login],
  );
  const user = r.rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }
  const accessBlock = userAccessBlockReason(user);
  if (accessBlock) {
    return res.status(403).json({ error: accessBlock });
  }
  const loginSyncClient = await pool.connect();
  try {
    await loginSyncClient.query('BEGIN');
    const syncedPerms = await resolveUserPermissionsForSave(loginSyncClient, {
      role_id: user.role_id,
    });
    await upsertUserPermissions(loginSyncClient, user.id, syncedPerms);
    await loginSyncClient.query('COMMIT');
  } catch (syncErr) {
    await loginSyncClient.query('ROLLBACK').catch(() => {});
    console.error('public auth login permission sync failed:', syncErr);
  } finally {
    loginSyncClient.release();
  }

  const perm = await pool.query(
    `SELECT ${ADMIN_PERMISSION_BYPASS_SQL} AS admin_permission_bypass,
            ${ROLE_PERMISSIONS_SELECT}
     FROM users u
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE u.id = $1`,
    [user.id]
  );
  const permRow = perm.rows[0] || {};
  const p = {
    admin_permission_bypass: !!permRow.admin_permission_bypass,
    ...effectivePermissionsFromRoleRow(permRow),
  };
  const hasAnyAccess = !!p.admin_permission_bypass || PERMISSION_KEYS.some((k) => p[k]);
  if (!hasAnyAccess) {
    return res.status(403).json({
      error: 'Нет назначенных прав доступа. Обратитесь к администратору.',
    });
  }
  req.session.userId = user.id;
  try {
    await new Promise((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    console.error('session.save:', err);
    return res.status(500).json({ error: 'Ошибка сессии' });
  }
  res.json({ user: userPayload(user, p) });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

router.get('/me', loadUser, (req, res) => {
  if (!req.user) return res.json({ user: null });
  res.json({ user: userPayload(req.user, req.user) });
});

export default router;
