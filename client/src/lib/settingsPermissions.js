/** Ключи прав на вкладки раздела «Настройка» */
export const SETTINGS_TAB_PERMISSIONS = {
  users: 'can_users',
  roles: 'can_roles',
  organizations: 'can_settings_organizations',
  warehouses: 'can_settings_warehouses',
  categories: 'can_settings_categories',
  work: 'can_settings_work',
};

export const SETTINGS_ACCESS_KEYS = Object.values(SETTINGS_TAB_PERMISSIONS);

export function canAccessSettingsTab(user, permKey) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return !!user[permKey];
}

export function hasAnySettingsAccess(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return SETTINGS_ACCESS_KEYS.some((k) => user[k]);
}

/** Первая доступная вкладка настроек */
export function getFirstSettingsTab(user) {
  if (canAccessSettingsTab(user, SETTINGS_TAB_PERMISSIONS.users)) return 'users';
  if (canAccessSettingsTab(user, SETTINGS_TAB_PERMISSIONS.roles)) return 'roles';
  if (canAccessSettingsTab(user, SETTINGS_TAB_PERMISSIONS.organizations)) return 'organizations';
  if (canAccessSettingsTab(user, SETTINGS_TAB_PERMISSIONS.warehouses)) return 'warehouses';
  if (canAccessSettingsTab(user, SETTINGS_TAB_PERMISSIONS.categories)) return 'categories';
  if (canAccessSettingsTab(user, SETTINGS_TAB_PERMISSIONS.work)) return 'work';
  return null;
}
