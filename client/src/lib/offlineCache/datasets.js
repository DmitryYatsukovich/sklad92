import { idbDelete, idbGet, idbGetAll, idbGetAllKeys, idbPut } from './db.js';
import { META_ID } from './constants.js';

function datasetKey(name, userId) {
  const uid = Number(userId) > 0 ? String(Number(userId)) : 'global';
  return `${name}::${uid}`;
}

async function resolveUserId(preferredUserId) {
  if (Number(preferredUserId) > 0) return Number(preferredUserId);
  const meta = await idbGet('meta', META_ID);
  const uid = Number(meta?.user?.id || 0);
  return uid > 0 ? uid : null;
}

export async function setOfflineDataset(name, data, userId = null) {
  if (!name) return;
  const uid = await resolveUserId(userId);
  await idbPut('datasets', {
    key: datasetKey(name, uid),
    name,
    userId: uid,
    data,
    updatedAt: new Date().toISOString(),
  });
}

export async function getOfflineDataset(name, userId = null) {
  if (!name) return null;
  const uid = await resolveUserId(userId);
  const direct = await idbGet('datasets', datasetKey(name, uid));
  if (direct?.data != null) return direct.data;

  // Fallback to the most recently updated snapshot for this dataset.
  const all = await idbGetAll('datasets');
  const candidate = all
    .filter((row) => row?.name === name && row?.data != null)
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))[0];
  return candidate?.data ?? null;
}

export async function clearOfflineDatasets() {
  const keys = await idbGetAllKeys('datasets');
  await Promise.all(keys.map((k) => idbDelete('datasets', k)));
}
