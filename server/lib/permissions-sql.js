import { PERMISSION_KEYS } from './app-permissions.js';
import { ADMIN_PERMISSION_BYPASS_SQL } from './admin-bypass.js';

function permCase(key) {
  return `CASE WHEN ${ADMIN_PERMISSION_BYPASS_SQL} THEN true
       ELSE COALESCE(r.${key}, false) END AS ${key}`;
}

/** Права: полный доступ только через admin_permission_bypass; иначе только из выбранной роли. */
export const PERMISSIONS_SELECT = PERMISSION_KEYS.map(permCase).join(',\n  ');
