import { idbGet, idbPut, idbDelete, idbGetAllKeys } from './db.js';
import { META_ID } from './constants.js';

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

export async function deleteCachedResponse(path) {
  await idbDelete('entries', cacheKeyForPath(path));
}

export async function deleteCachedResponsesByPathPrefix(pathPrefix) {
  if (!pathPrefix) return 0;
  const allKeys = await idbGetAllKeys('entries');
  const keyPrefix = cacheKeyForPath(pathPrefix);
  const toDelete = allKeys.filter((k) => String(k).startsWith(keyPrefix));
  await Promise.all(toDelete.map((k) => idbDelete('entries', k)));
  return toDelete.length;
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
  const keys = await idbGetAllKeys('entries');
  const datasetKeys = await idbGetAllKeys('datasets');
  await Promise.all(keys.map((k) => idbDelete('entries', k)));
  await Promise.all(datasetKeys.map((k) => idbDelete('datasets', k)));
  await idbDelete('meta', META_ID);
}
