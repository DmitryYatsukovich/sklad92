import pool from '../db/pool.js';
import { PERMISSIONS_SELECT } from '../lib/permissions-sql.js';
import { userAccessBlockReason } from '../lib/user-access.js';

export function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }
  next();
}

export async function loadUser(req, res, next) {
  if (!req.session?.userId) return next();
  try {
  const r = await pool.query(
    `SELECT u.id, u.login, u.display_name, u.role, u.role_id,
            COALESCE(u.profile_active, true) AS profile_active,
            COALESCE(u.employment_status, 'working') AS employment_status,
            ${PERMISSIONS_SELECT}
     FROM users u
     LEFT JOIN user_permissions p ON p.user_id = u.id
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE u.id = $1`,
    [req.session.userId],
  );
  const row = r.rows[0] || null;
  const accessBlock = userAccessBlockReason(row);
  if (accessBlock) {
    req.session?.destroy?.(() => {});
    req.user = null;
    return next();
  }
  req.user = row;
  next();
  } catch (err) {
    console.error('loadUser DB error:', err.message);
    req.session?.destroy?.(() => {});
    next();
  }
}

export function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Требуется авторизация' });
    if (req.user.role === 'admin') return next();
    if (req.user[permission]) return next();
    return res.status(403).json({ error: 'Нет доступа' });
  };
}

export function requireAnyPermission(...permissions) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Требуется авторизация' });
    if (req.user.role === 'admin') return next();
    if (permissions.some((p) => req.user[p])) return next();
    return res.status(403).json({ error: 'Нет доступа' });
  };
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Требуется авторизация' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Только администратор' });
  next();
}
