import { idbGetAll, idbPut, idbDelete, idbGet } from './db.js';
import { remapMutationForSync } from './tempIds.js';

const REF_MAPS_KEY = 'idMaps';

export function newClientId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `a-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export async function listLocalActions() {
  const items = await idbGetAll('actions');
  return items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export async function saveLocalAction(entry) {
  await idbPut('actions', entry);
  return entry;
}

export async function markActionsSynced(clientIds) {
  if (!clientIds?.length) return;
  const all = await idbGetAll('actions');
  const set = new Set(clientIds);
  await Promise.all(
    all
      .filter((a) => set.has(a.clientId))
      .map((a) => idbPut('actions', { ...a, synced: true })),
  );
}

export async function listPendingMutations() {
  const items = await idbGetAll('mutations');
  return items.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

export async function addPendingMutation(mutation) {
  const id = await idbPut('mutations', mutation);
  const method = (mutation.method || 'GET').toUpperCase();
  if (mutation.path === '/api/materials' && method === 'POST' && id != null) {
    const { tempMaterialId } = await import('./tempIds.js');
    await idbPut('mutations', { ...mutation, id, tempMaterialId: tempMaterialId(id) });
  }
  return id;
}

export async function removePendingMutation(id) {
  await idbDelete('mutations', id);
}

export async function removePendingMutationsByPathPrefixes(prefixes = []) {
  if (!Array.isArray(prefixes) || !prefixes.length) return 0;
  const queue = await listPendingMutations();
  const toDelete = queue.filter((item) => prefixes.some((p) => item.path?.startsWith(p)));
  await Promise.all(toDelete.map((item) => idbDelete('mutations', item.id)));
  return toDelete.length;
}

export async function countUnsyncedActions() {
  const all = await idbGetAll('actions');
  return all.filter((a) => !a.synced).length;
}

export async function countPendingMutations() {
  const all = await idbGetAll('mutations');
  return all.length;
}

export async function getOfflineRefMaps() {
  try {
    const row = await idbGet('refs', REF_MAPS_KEY);
    return {
      material: row?.material || {},
      issuance: row?.issuance || {},
    };
  } catch {
    return { material: {}, issuance: {} };
  }
}

export async function saveOfflineRefMaps(materialMap, issuanceMap) {
  const material = {};
  const issuance = {};
  for (const [k, v] of materialMap) material[String(k)] = v;
  for (const [k, v] of issuanceMap) issuance[String(k)] = v;
  await idbPut('refs', { key: REF_MAPS_KEY, material, issuance });
}

export async function clearOfflineRefMaps() {
  try {
    await idbDelete('refs', REF_MAPS_KEY);
  } catch {
    /* ignore */
  }
}

export async function rewritePendingMutationsWithMaps(materialIdMap, issuanceIdMap) {
  const queue = await listPendingMutations();
  await Promise.all(queue.map(async (item) => {
    const remapped = remapMutationForSync(item, materialIdMap, issuanceIdMap);
    if (remapped.path === item.path && remapped.body === item.body) return;
    await idbPut('mutations', { ...item, path: remapped.path, body: remapped.body });
  }));
}
