import {
  saveLocalAction,
  markActionsSynced,
  listPendingMutations,
  addPendingMutation,
  removePendingMutation,
  countUnsyncedActions,
  countPendingMutations,
  newClientId,
  getOfflineRefMaps,
  saveOfflineRefMaps,
  clearOfflineRefMaps,
  rewritePendingMutationsWithMaps,
} from './store.js';
import {
  remapMutationForSync,
  tempIssuanceId,
  tempMaterialId,
  pendingMaterialCode,
  resolveCreatedMaterialId,
  mapsFromPersisted,
} from './tempIds.js';
import { buildActionFromRequest } from './buildAction.js';
import { cleanupOfflineCacheAfterSync } from './cleanupCache.js';

const listeners = new Set();
let syncing = false;
let currentUser = null;

export const OFFLINE_QUEUED = 'OFFLINE_QUEUED';

export function setActionLogUser(user) {
  currentUser = user;
}

function notify() {
  import('./applyOptimistic.js').then((m) => m.invalidatePendingEntriesCache?.()).catch(() => {});
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
}

export function subscribeActionLog(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export async function getActionLogCounts() {
  const [unsynced, pending] = await Promise.all([
    countUnsyncedActions(),
    countPendingMutations(),
  ]);
  return { unsynced, pending };
}

export async function recordAction(meta, { synced = false, clientId } = {}) {
  const entry = {
    clientId: clientId || newClientId(),
    kind: meta.kind || 'unknown',
    title: meta.title || 'Действие',
    description: meta.description || null,
    payload: meta.payload ?? null,
    createdAt: new Date().toISOString(),
    synced: Boolean(synced),
    userId: currentUser?.id ?? null,
    userDisplayName: currentUser?.display_name || currentUser?.login || null,
  };
  await saveLocalAction(entry);
  notify();
  if (synced && navigator.onLine) {
    syncActionLogToServer().catch(() => {});
  }
  return entry;
}

async function rawFetch(path, options = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(path, {
      ...options,
      signal: ctrl.signal,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    clearTimeout(t);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText || 'Ошибка');
    return data;
  } catch (e) {
    clearTimeout(t);
    if (e.name === 'AbortError') throw new Error('Таймаут запроса');
    throw e;
  }
}

export async function enqueueOfflineMutation(path, method, bodyText, actionMeta) {
  const clientId = newClientId();
  const meta = actionMeta || buildActionFromRequest(path, method, bodyText);
  if (meta) {
    await recordAction(meta, { synced: false, clientId });
  }
  const mutationId = await addPendingMutation({
    path,
    method,
    body: bodyText || null,
    actionClientId: clientId,
    createdAt: new Date().toISOString(),
  });
  if (path === '/api/materials' && (method || 'GET').toUpperCase() === 'POST' && mutationId != null) {
    patchOfflineCacheForNewMaterial(bodyText, mutationId).catch(() => {});
  }
  notify();
  const err = new Error('Действие сохранено офлайн и будет отправлено при подключении');
  err.code = OFFLINE_QUEUED;
  throw err;
}

async function patchOfflineCacheForNewMaterial(bodyText, mutationId) {
  const { isQuickDeviceEnabled } = await import('../offlineCache/prefs.js');
  if (!isQuickDeviceEnabled()) return;
  const { getCachedResponse, setCachedResponse } = await import('../offlineCache/store.js');
  let body = {};
  try {
    body = bodyText ? JSON.parse(bodyText) : {};
  } catch {
    return;
  }
  const id = tempMaterialId(mutationId);
  const code = body.code || pendingMaterialCode(mutationId);
  const row = {
    id,
    name: body.name || '',
    unit: body.unit || 'шт',
    price: body.price ?? 0,
    production_price: body.production_price ?? 0,
    quantity: body.quantity ?? 0,
    code,
    material_code: code,
    object_id: body.object_id ?? null,
    warehouse_id: body.warehouse_id ?? null,
    rack_id: body.rack_id ?? null,
    category_id: body.category_id ?? null,
    _pending: true,
  };
  const list = (await getCachedResponse('/api/materials')) || [];
  if (!list.some((m) => m.id === id)) {
    await setCachedResponse('/api/materials', [row, ...list]);
  }
  await setCachedResponse(
    `/api/materials/by-code/${encodeURIComponent(code)}`,
    row,
  );
}

async function registerCreatedMaterialMapping(item, data, materialIdMap, issuanceIdMap) {
  const realId = resolveCreatedMaterialId(data);
  if (realId == null) return;
  const tempId = Number(item.tempMaterialId ?? tempMaterialId(item.id));
  materialIdMap.set(tempId, realId);
  await saveOfflineRefMaps(materialIdMap, issuanceIdMap);
  await rewritePendingMutationsWithMaps(materialIdMap, issuanceIdMap);
}

async function replayMutations() {
  const queue = await listPendingMutations();
  if (!queue.length) return;

  const persisted = await getOfflineRefMaps();
  const { materialIdMap, issuanceIdMap } = mapsFromPersisted(persisted);

  for (const item of queue) {
    const method = (item.method || 'GET').toUpperCase();
    const { path, body } = remapMutationForSync(item, materialIdMap, issuanceIdMap);

    if (path === '/api/operations/issue' && method === 'POST' && body) {
      try {
        const parsed = JSON.parse(body);
        const mid = Number(parsed.material_id);
        if (Number.isFinite(mid) && mid < 0 && !materialIdMap.has(mid)) {
          throw new Error(
            'Выдача ссылается на материал, который ещё не создан на сервере. Дождитесь синхронизации склада или повторите отправку.',
          );
        }
      } catch (e) {
        if (e.message?.includes('материал')) throw e;
      }
    }

    const data = await rawFetch(path, {
      method,
      body: body || undefined,
    });

    if (path === '/api/materials' && method === 'POST') {
      await registerCreatedMaterialMapping(item, data, materialIdMap, issuanceIdMap);
    }

    if (path === '/api/operations/issue' && method === 'POST' && data?.id != null) {
      issuanceIdMap.set(Number(tempIssuanceId(item.id)), data.id);
      await saveOfflineRefMaps(materialIdMap, issuanceIdMap);
    }

    await removePendingMutation(item.id);
    if (item.actionClientId) {
      await markActionsSynced([item.actionClientId]);
    }
  }

  await clearOfflineRefMaps();
}

export async function syncActionLogToServer() {
  if (syncing || !navigator.onLine || !currentUser) {
    return { ok: false, error: !currentUser ? 'Нет пользователя' : 'Нет сети' };
  }
  syncing = true;
  try {
    await replayMutations();
    await cleanupOfflineCacheAfterSync();

    const { listLocalActions } = await import('./store.js');
    const local = await listLocalActions();
    const unsynced = local.filter((a) => !a.synced);
    if (!unsynced.length) {
      notify();
      return { ok: true, synced: [] };
    }

    const data = await rawFetch('/api/actions/sync', {
      method: 'POST',
      body: JSON.stringify({
        items: unsynced.map((a) => ({
          clientId: a.clientId,
          kind: a.kind,
          title: a.title,
          description: a.description,
          payload: a.payload,
          createdAt: a.createdAt,
          userId: a.userId,
        })),
      }),
    });
    const syncedIds = data.synced || [];
    await markActionsSynced(syncedIds);
    notify();
    if (currentUser) {
      import('../offlineCache/prefs.js').then(({ isQuickDeviceEnabled }) => {
        if (!isQuickDeviceEnabled()) return;
        import('../offlineCache/prefetch.js').then((m) => {
          m.prefetchOfflineData(currentUser).catch(() => {});
        });
      });
    }
    return { ok: true, synced: syncedIds };
  } catch (e) {
    console.warn('syncActionLog:', e.message);
    notify();
    return { ok: false, error: e.message || 'Ошибка синхронизации' };
  } finally {
    syncing = false;
  }
}

export function initActionLogSync() {
  const run = () => {
    if (navigator.onLine) syncActionLogToServer();
  };
  window.addEventListener('online', run);
  run();
  return () => window.removeEventListener('online', run);
}

export async function recordActionAfterSuccess(path, method, bodyText) {
  const meta = buildActionFromRequest(path, method, bodyText);
  if (!meta) return null;
  const entry = await recordAction(meta, { synced: false });
  if (navigator.onLine) {
    const r = await syncActionLogToServer();
    if (r.ok) return { ...entry, synced: true };
  }
  return entry;
}
