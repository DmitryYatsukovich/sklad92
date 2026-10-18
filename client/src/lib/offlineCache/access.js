import { hasAdminPermissionBypass } from '../adminAccess.js';

export function canUseOfflineMode(user) {
  if (!user) return false;
  if (hasAdminPermissionBypass(user)) return true;
  if (user.can_offline_mode == null) return true;
  return !!user.can_offline_mode;
}
