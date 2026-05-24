import {
  saveLocalAction,
  markActionsSynced,
  listPendingMutations,
  addPendingMutation,
  removePendingMutation,
  countUnsyncedActions,
  countPendingMutations,
  newClientId,
} from './store.js';
import { buildActionFromRequest } from './buildAction.js';

const listeners = new Set();
let syncing = false;
let currentUser = null;

export const OFFLINE_QUEUED = 'OFFLINE_QUEUED';

export function setActionLogUser(user) {
  currentUser = user;
}

function notify() {
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
  await addPendingMutation({
    path,
    method,
    body: bodyText || null,
    actionClientId: clientId,
    createdAt: new Date().toISOString(),
  });
  notify();
  const err = new Error('Действие сохранено офлайн и будет отправлено при подключении');
  err.code = OFFLINE_QUEUED;
  throw err;
}

async function replayMutations() {
  const queue = await listPendingMutations();
  for (const item of queue) {
    await rawFetch(item.path, {
      method: item.method,
      body: item.body || undefined,
    });
    await removePendingMutation(item.id);
    if (item.actionClientId) {
      await markActionsSynced([item.actionClientId]);
    }
  }
}

export async function syncActionLogToServer() {
  if (syncing || !navigator.onLine || !currentUser) return { ok: false };
  syncing = true;
  try {
    await replayMutations();

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
    return { ok: false, error: e.message };
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
