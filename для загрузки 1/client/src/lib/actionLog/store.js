import { idbGetAll, idbPut, idbDelete } from './db.js';

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
  return id;
}

export async function removePendingMutation(id) {
  await idbDelete('mutations', id);
}

export async function countUnsyncedActions() {
  const all = await idbGetAll('actions');
  return all.filter((a) => !a.synced).length;
}

export async function countPendingMutations() {
  const all = await idbGetAll('mutations');
  return all.length;
}
