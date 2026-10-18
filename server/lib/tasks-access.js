import { hasAdminPermissionBypass } from './admin-bypass.js';

/** Просмотр задач всех пользователей (иначе — только своих). */
export function canViewAllTasks(user) {
  return hasAdminPermissionBypass(user) || !!user?.can_tasks_all;
}
