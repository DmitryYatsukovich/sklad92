import pool from '../db/pool.js';

export function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }
  next();
}

export async function loadUser(req, res, next) {
  if (!req.session?.userId) return next();
  const r = await pool.query(
    `SELECT u.id, u.login, u.display_name, u.role, u.role_id,
            COALESCE(p.can_warehouse, r.can_warehouse, true) AS can_warehouse,
            COALESCE(p.can_issuance, r.can_issuance, true) AS can_issuance,
            COALESCE(p.can_production, r.can_production, true) AS can_production,
            (u.role = 'admin' OR COALESCE(p.can_users, r.can_users, false)) AS can_users,
            (u.role = 'admin' OR COALESCE(p.can_attendance, r.can_attendance, false)) AS can_attendance
     FROM users u
     LEFT JOIN user_permissions p ON p.user_id = u.id
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE u.id = $1`,
    [req.session.userId]
  );
  req.user = r.rows[0] || null;
  next();
}

export function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Требуется авторизация' });
    if (req.user.role === 'admin') return next();
    if (req.user[permission]) return next();
    return res.status(403).json({ error: 'Нет доступа' });
  };
}
