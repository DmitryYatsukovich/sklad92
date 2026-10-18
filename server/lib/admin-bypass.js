import { ADMIN_ROLE_NAME } from './app-permissions.js';

function escapeSqlLiteral(value) {
  return String(value || '').replace(/'/g, "''");
}

const adminRoleNameSql = escapeSqlLiteral(ADMIN_ROLE_NAME);

export const ADMIN_PERMISSION_BYPASS_SQL = `(
  u.role = 'admin'
  AND (
    u.role_id IS NULL
    OR LOWER(TRIM(COALESCE(r.name, ''))) = LOWER('${adminRoleNameSql}')
  )
)`;

export function hasAdminPermissionBypass(user) {
  if (!user) return false;
  if (Object.prototype.hasOwnProperty.call(user, 'admin_permission_bypass')) {
    return !!user.admin_permission_bypass;
  }
  return user.role === 'admin';
}

