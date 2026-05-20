/** Первая доступная страница по правам пользователя */
export function getDefaultRoute(user) {
  if (!user) return '/login';
  if (user.can_warehouse) return '/warehouse';
  if (user.can_issuance) return '/issuance';
  if (user.can_production) return '/production';
  if (user.can_attendance) return '/attendance';
  if (user.can_settings || user.can_users) return '/settings';
  if (user.can_face) return '/face';
  return '/login';
}
