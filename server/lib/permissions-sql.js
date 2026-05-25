import { PERMISSION_KEYS } from './app-permissions.js';

function permCase(key) {
  return `CASE WHEN u.role = 'admin' THEN true
       WHEN u.role_id IS NOT NULL THEN COALESCE(r.${key}, false)
       ELSE COALESCE(p.${key}, false) END AS ${key}`;
}

/** Права: системный admin — всё; при role_id — только роль; иначе user_permissions */
export const PERMISSIONS_SELECT = PERMISSION_KEYS.map(permCase).join(',\n  ');
