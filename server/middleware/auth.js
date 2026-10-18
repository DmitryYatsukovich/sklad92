import pool from '../db/pool.js';
import { PERMISSIONS_SELECT } from '../lib/permissions-sql.js';
import { userAccessBlockReason } from '../lib/user-access.js';
import { ADMIN_PERMISSION_BYPASS_SQL, hasAdminPermissionBypass } from '../lib/admin-bypass.js';

const WAREHOUSE_GRANULAR_KEYS = [
  'can_warehouse_view',
  'can_warehouse_edit',
  'can_warehouse_qr_scan',
  'can_warehouse_issue',
  'can_warehouse_move',
  'can_warehouse_split',
];

function applyLegacyWarehousePermissions(user) {
  if (!user || hasAdminPermissionBypass(user)) return user;
  if (!user.can_warehouse) return user;
  if (user.warehouse_permissions_customized) return user;
  const hasGranularWarehouseAccess = WAREHOUSE_GRANULAR_KEYS.some((key) => !!user[key]);
  if (hasGranularWarehouseAccess) return user;
  // Обратная совместимость: старые роли имели только can_warehouse.
  WAREHOUSE_GRANULAR_KEYS.forEach((key) => {
    user[key] = true;
  });
  return user;
}

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
            u.organization_id,
            COALESCE(o.name, NULLIF(TRIM(u.employment_org), '')) AS organization_name,
            COALESCE(u.profile_active, true) AS profile_active,
            COALESCE(u.employment_status, 'working') AS employment_status,
            ${ADMIN_PERMISSION_BYPASS_SQL} AS admin_permission_bypass,
            CASE
              WHEN ${ADMIN_PERMISSION_BYPASS_SQL} THEN true
              ELSE COALESCE(r.warehouse_permissions_customized, false)
            END AS warehouse_permissions_customized,
            ${PERMISSIONS_SELECT}
     FROM users u
     LEFT JOIN roles r ON r.id = u.role_id
     LEFT JOIN organizations o ON o.id = u.organization_id
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
  if (row) {
    row.can_objects = !!(row.can_objects || row.can_settings_work);
    applyLegacyWarehousePermissions(row);
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
    if (hasAdminPermissionBypass(req.user)) return next();
    if (req.user[permission]) return next();
    return res.status(403).json({ error: 'Нет доступа' });
  };
}

export function requireAnyPermission(...permissions) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Требуется авторизация' });
    if (hasAdminPermissionBypass(req.user)) return next();
    if (permissions.some((p) => req.user[p])) return next();
    return res.status(403).json({ error: 'Нет доступа' });
  };
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Требуется авторизация' });
  if (!hasAdminPermissionBypass(req.user)) return res.status(403).json({ error: 'Только администратор' });
  next();
}
