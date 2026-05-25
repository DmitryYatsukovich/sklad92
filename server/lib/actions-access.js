/** Просмотр действий всех пользователей (иначе — только свои). */
export function canViewAllActions(user) {
  return user?.role === 'admin' || !!user?.can_actions_all;
}
