/** Доступ в приложение: активный профиль и не уволен */
export function userAccessBlockReason(row) {
  if (!row) return 'Пользователь не найден';
  if (row.profile_active === false) {
    return 'Учётная запись неактивна. Обратитесь к администратору.';
  }
  if (row.employment_status === 'fired') {
    return 'Пользователь уволен. Доступ к приложению закрыт.';
  }
  return null;
}

export function userCanAccessApp(row) {
  return !userAccessBlockReason(row);
}
