/** Права: admin — всё; иначе галочки пользователя ИЛИ права назначенной роли */
export const PERMISSIONS_SELECT = `
  CASE WHEN u.role = 'admin' THEN true
       ELSE COALESCE(p.can_warehouse, false) OR COALESCE(r.can_warehouse, false) END AS can_warehouse,
  CASE WHEN u.role = 'admin' THEN true
       ELSE COALESCE(p.can_issuance, false) OR COALESCE(r.can_issuance, false) END AS can_issuance,
  CASE WHEN u.role = 'admin' THEN true
       ELSE COALESCE(p.can_production, false) OR COALESCE(r.can_production, false) END AS can_production,
  CASE WHEN u.role = 'admin' THEN true
       ELSE COALESCE(p.can_users, false) OR COALESCE(r.can_users, false) END AS can_users,
  CASE WHEN u.role = 'admin' THEN true
       ELSE COALESCE(p.can_attendance, false) OR COALESCE(r.can_attendance, false) END AS can_attendance,
  CASE WHEN u.role = 'admin' THEN true
       ELSE COALESCE(p.can_settings, false) OR COALESCE(r.can_settings, false) END AS can_settings,
  CASE WHEN u.role = 'admin' THEN true
       ELSE COALESCE(p.can_face, false) OR COALESCE(r.can_face, false) END AS can_face`;
