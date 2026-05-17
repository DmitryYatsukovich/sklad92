/** Поля прав с учётом роли admin, user_permissions и roles */
export const PERMISSIONS_SELECT = `
  CASE WHEN u.role = 'admin' THEN true
       ELSE COALESCE(p.can_warehouse, r.can_warehouse, false) END AS can_warehouse,
  CASE WHEN u.role = 'admin' THEN true
       ELSE COALESCE(p.can_issuance, r.can_issuance, false) END AS can_issuance,
  CASE WHEN u.role = 'admin' THEN true
       ELSE COALESCE(p.can_production, r.can_production, false) END AS can_production,
  CASE WHEN u.role = 'admin' THEN true
       ELSE COALESCE(p.can_users, r.can_users, false) END AS can_users,
  CASE WHEN u.role = 'admin' THEN true
       ELSE COALESCE(p.can_attendance, r.can_attendance, false) END AS can_attendance`;
