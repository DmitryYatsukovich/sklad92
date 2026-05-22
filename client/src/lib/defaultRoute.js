/** Первая доступная страница по правам пользователя */
export function getDefaultRoute(user) {
  if (!user) return '/login';
  if (user.can_warehouse) return '/warehouse';
  if (user.can_issuance) return '/issuance';
  if (user.can_production) return '/production';
  if (user.can_attendance) return '/attendance';
  if (
    user.can_settings_organizations
    || user.can_settings_warehouses
    || user.can_settings_categories
    || user.can_settings_work
    || user.can_users
    || user.can_roles
  ) return '/settings';
  if (user.can_face) return '/face';
  return '/login';
}
