export function hasAdminPermissionBypass(user) {
  return !!user?.admin_permission_bypass;
}

