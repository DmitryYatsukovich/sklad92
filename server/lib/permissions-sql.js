import { PERMISSION_KEYS } from './app-permissions.js';
import { ADMIN_PERMISSION_BYPASS_SQL } from './admin-bypass.js';

function permCase(key) {
  return `CASE WHEN ${ADMIN_PERMISSION_BYPASS_SQL} THEN true
       WHEN u.role_id IS NOT NULL THEN COALESCE(r.${key}, false)
       ELSE COALESCE(p.${key}, false) END AS ${key}`;
}

/** Права: полный доступ только через admin_permission_bypass; иначе из роли или user_permissions. */
export const PERMISSIONS_SELECT = PERMISSION_KEYS.map(permCase).join(',\n  ');
