import { hasAdminPermissionBypass } from './admin-bypass.js';

/** Просмотр действий всех пользователей (иначе — только свои). */
export function canViewAllActions(user) {
  return hasAdminPermissionBypass(user) || !!user?.can_actions_all;
}
