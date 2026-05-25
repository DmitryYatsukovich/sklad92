import { getCacheMeta, setCacheMeta, getCachedUser } from './store.js';
import { isQuickDeviceEnabled } from './prefs.js';

async function hashPassword(login, password) {
  const text = `${String(login).trim()}\0${password}`;
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Сохранить проверку пароля для офлайн-входа (после успешного входа онлайн). */
export async function saveOfflineCredentials(login, password) {
  const loginNorm = String(login || '').trim();
  if (!loginNorm || !password) return;
  const hash = await hashPassword(loginNorm, password);
  await setCacheMeta({
    offlineLogin: loginNorm,
    offlinePasswordHash: hash,
  });
}

/** Проверить логин и пароль офлайн. */
export async function verifyOfflinePassword(login, password) {
  const meta = await getCacheMeta();
  const loginNorm = String(login || '').trim();
  if (!meta?.offlineLogin || !meta?.offlinePasswordHash) return false;
  if (meta.offlineLogin !== loginNorm) return false;
  const hash = await hashPassword(loginNorm, password);
  return hash === meta.offlinePasswordHash;
}

export async function setOfflineSession(user) {
  if (!user?.id) return;
  await setCacheMeta({
    offlineSession: {
      active: true,
      userId: user.id,
      at: new Date().toISOString(),
    },
  });
}

export async function clearOfflineSession() {
  await setCacheMeta({
    offlineSession: null,
  });
}

/** Активна ли сессия для работы без повторного ввода пароля (обновление страницы). */
export async function hasValidOfflineSession() {
  if (!isQuickDeviceEnabled()) return false;
  const user = await getCachedUser();
  if (!user?.id) return false;
  const meta = await getCacheMeta();
  const session = meta?.offlineSession;
  if (session?.active && session.userId === user.id) return true;
  return Boolean(meta?.offlineLogin && meta?.offlinePasswordHash);
}
