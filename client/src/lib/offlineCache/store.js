import { idbGet, idbPut, idbDelete } from './db.js';

const META_ID = 'app';

export function cacheKeyForPath(path) {
  return `GET:${path}`;
}

export function shouldCacheGetPath(path) {
  if (!path.startsWith('/api/')) return false;
  if (path === '/api/auth/me') return true;
  if (path === '/api/auth/login' || path === '/api/auth/logout') return false;
  if (path.includes('/export') || path.includes('/import')) return false;
  if (path.includes('/avatar') || path.includes('/face-photo') || path.includes('/labor-contract')) return false;
  if (path.includes('/qr-pdf') || path.includes('/models')) return false;
  return true;
}

export async function getCachedResponse(path) {
  const row = await idbGet('entries', cacheKeyForPath(path));
  return row?.data ?? null;
}

export async function setCachedResponse(path, data, userId = null) {
  await idbPut('entries', {
    key: cacheKeyForPath(path),
    path,
    data,
    userId,
    updatedAt: new Date().toISOString(),
  });
}

export async function getCachedUser() {
  const meta = await idbGet('meta', META_ID);
  return meta?.user ?? null;
}

export async function setCachedUser(user) {
  const prev = (await idbGet('meta', META_ID)) || { id: META_ID };
  await idbPut('meta', {
    ...prev,
    id: META_ID,
    user,
    userCachedAt: new Date().toISOString(),
  });
}

export async function getCacheMeta() {
  return idbGet('meta', META_ID);
}

export async function setCacheMeta(patch) {
  const prev = (await idbGet('meta', META_ID)) || { id: META_ID };
  await idbPut('meta', { ...prev, ...patch, id: META_ID });
}

export async function clearOfflineCache() {
  const { idbGetAllKeys } = await import('./db.js');
  const keys = await idbGetAllKeys('entries');
  await Promise.all(keys.map((k) => idbDelete('entries', k)));
  await idbDelete('meta', META_ID);
}
