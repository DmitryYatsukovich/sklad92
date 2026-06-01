export function canUseOfflineMode(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.can_offline_mode == null) return true;
  return !!user.can_offline_mode;
}
