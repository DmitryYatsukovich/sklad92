/** Просмотр задач всех пользователей (иначе — только своих). */
export function canViewAllTasks(user) {
  return user?.role === 'admin' || !!user?.can_tasks_all;
}
