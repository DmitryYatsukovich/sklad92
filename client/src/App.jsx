import { useState, useEffect, useRef, useCallback, lazy } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { auth, tasks as tasksApi, notifications as notificationsApi } from './api';
import Login from './pages/Login';
import Layout from './Layout';
import { getDefaultRoute } from './lib/defaultRoute.js';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import RecoverableErrorBoundary from './components/RecoverableErrorBoundary.jsx';
import { setActionLogUser, initActionLogSync } from './lib/actionLog';
import {
  isQuickDeviceEnabled,
  setQuickDeviceEnabled,
  getCachedUser,
  hasValidOfflineSession,
  clearOfflineSession,
  setOfflineSession,
  refreshOfflineCacheIfNeeded,
  initOfflineCacheAutoSync,
} from './lib/offlineCache';
import { canUseOfflineMode } from './lib/offlineCache/access.js';
import { isMobileDevice, getAdaptivePollInterval } from './lib/device.js';

const Warehouse = lazy(() => import('./pages/Warehouse'));
const Issuance = lazy(() => import('./pages/Issuance'));
const Production = lazy(() => import('./pages/Production'));
const Tools = lazy(() => import('./pages/Tools'));
const Tasks = lazy(() => import('./pages/Tasks'));
const Users = lazy(() => import('./pages/Users'));
const FaceCheckIn = lazy(() => import('./pages/FaceCheckIn'));
const AttendanceAll = lazy(() => import('./pages/AttendanceAll'));
const Settings = lazy(() => import('./pages/Settings'));
const Actions = lazy(() => import('./pages/Actions'));

const STRICT_LOGOUT_ON_CLOSE = true;
const ACTIVE_SESSION_KEY = 'warehouse-active-session';
const PENDING_SERVER_LOGOUT_KEY = 'warehouse-pending-server-logout';
const TASK_SEEN_IDS_LIMIT = 500;
const TASK_PUSH_PROMPTED_PREFIX = 'warehouse-task-push-prompted:';

function normalizeTaskId(value) {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function loadSeenTaskIds(storageKey) {
  try {
    const raw = localStorage.getItem(storageKey);
    const parsed = JSON.parse(raw || '[]');
    if (!Array.isArray(parsed)) return new Set();
    const set = new Set();
    for (const value of parsed) {
      const id = normalizeTaskId(value);
      if (id) set.add(id);
    }
    return set;
  } catch {
    return new Set();
  }
}

function encodeSeenTaskIds(set) {
  const ids = Array.from(set);
  if (ids.length <= TASK_SEEN_IDS_LIMIT) return ids;
  return ids.slice(ids.length - TASK_SEEN_IDS_LIMIT);
}

function urlBase64ToUint8Array(base64String) {
  const normalized = String(base64String || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
  const rawData = atob(padded);
  return Uint8Array.from([...rawData].map((ch) => ch.charCodeAt(0)));
}

function HomeRedirect({ user }) {
  return <Navigate to={getDefaultRoute(user)} replace />;
}

export default function App() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [taskToasts, setTaskToasts] = useState([]);
  const userRef = useRef(null);
  const warmedBundleKeyRef = useRef('');
  const warmedFaceModelsKeyRef = useRef('');
  const taskSeenIdsRef = useRef(new Set());
  const taskSeenStorageKeyRef = useRef('');
  userRef.current = user;

  const markActiveSession = useCallback((active) => {
    try {
      if (active) sessionStorage.setItem(ACTIVE_SESSION_KEY, '1');
      else sessionStorage.removeItem(ACTIVE_SESSION_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const hasActiveSessionMarker = useCallback(() => {
    try {
      return sessionStorage.getItem(ACTIVE_SESSION_KEY) === '1';
    } catch {
      return false;
    }
  }, []);

  const setPendingServerLogout = useCallback((pending) => {
    try {
      if (pending) localStorage.setItem(PENDING_SERVER_LOGOUT_KEY, '1');
      else localStorage.removeItem(PENDING_SERVER_LOGOUT_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const hasPendingServerLogout = useCallback(() => {
    try {
      return localStorage.getItem(PENDING_SERVER_LOGOUT_KEY) === '1';
    } catch {
      return false;
    }
  }, []);

  const persistSeenTaskIds = useCallback(() => {
    const storageKey = taskSeenStorageKeyRef.current;
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(encodeSeenTaskIds(taskSeenIdsRef.current)));
    } catch {
      /* ignore */
    }
  }, []);

  const markTaskSeen = useCallback((taskId) => {
    const id = normalizeTaskId(taskId);
    if (!id) return false;
    if (taskSeenIdsRef.current.has(id)) return false;
    taskSeenIdsRef.current.add(id);
    while (taskSeenIdsRef.current.size > TASK_SEEN_IDS_LIMIT) {
      const oldest = taskSeenIdsRef.current.values().next().value;
      if (!oldest) break;
      taskSeenIdsRef.current.delete(oldest);
    }
    persistSeenTaskIds();
    return true;
  }, [persistSeenTaskIds]);

  const removeTaskToast = useCallback((toastId) => {
    setTaskToasts((prev) => prev.filter((row) => row.id !== toastId));
  }, []);

  const showTaskToast = useCallback((payload = {}) => {
    const toastId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const title = String(payload.title || 'Новая задача');
    const message = String(payload.body || payload.message || 'Вам назначили новую задачу');
    setTaskToasts((prev) => [
      { id: toastId, title, message },
      ...prev,
    ].slice(0, 4));
    setTimeout(() => removeTaskToast(toastId), 7000);
  }, [removeTaskToast]);

  const prewarmTabBundles = useCallback((u) => {
    if (!u || !navigator.onLine) return;
    const canSettings = !!(
      u.can_settings_organizations
      || u.can_settings_warehouses
      || u.can_settings_categories
      || u.can_settings_work
      || u.can_settings_tools
      || u.can_users
      || u.can_roles
    );
    const warmKey = [
      u.id,
      u.can_warehouse ? 'w' : '',
      u.can_issuance ? 'i' : '',
      u.can_production ? 'p' : '',
      u.can_tools ? 'u' : '',
      u.can_tasks ? 'k' : '',
      u.can_actions ? 'a' : '',
      u.can_face ? 'f' : '',
      u.can_attendance ? 't' : '',
      canSettings ? 's' : '',
    ].join('|');
    if (warmedBundleKeyRef.current === warmKey) return;
    warmedBundleKeyRef.current = warmKey;

    const loaders = [];
    if (u.can_warehouse) loaders.push(() => import('./pages/Warehouse'));
    if (u.can_issuance) loaders.push(() => import('./pages/Issuance'));
    if (u.can_production) loaders.push(() => import('./pages/Production'));
    if (u.can_tools) loaders.push(() => import('./pages/Tools'));
    if (u.can_tasks) loaders.push(() => import('./pages/Tasks'));
    if (u.can_actions) loaders.push(() => import('./pages/Actions'));
    if (u.can_face) loaders.push(() => import('./pages/FaceCheckIn'));
    if (u.can_attendance) loaders.push(() => import('./pages/AttendanceAll'));
    if (canSettings) loaders.push(() => import('./pages/Settings'));
    if (u.can_users) loaders.push(() => import('./pages/Users'));
    if (!loaders.length) return;

    if (!isMobileDevice()) {
      Promise.allSettled(loaders.map((load) => load())).then((results) => {
        if (results.some((r) => r.status === 'rejected')) {
          warmedBundleKeyRef.current = '';
        }
      });
      return;
    }

    // На мобильных прогреваем чанки в idle-режиме, чтобы не блокировать UI после входа.
    let index = 0;
    let failed = false;
    const schedule = (fn, timeout = 1200) => {
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(fn, { timeout });
      } else {
        setTimeout(fn, 250);
      }
    };
    const runNext = () => {
      if (warmedBundleKeyRef.current !== warmKey) return;
      const load = loaders[index];
      index += 1;
      if (!load) {
        if (failed) warmedBundleKeyRef.current = '';
        return;
      }
      load().catch(() => { failed = true; }).finally(() => schedule(runNext, 1500));
    };
    setTimeout(() => schedule(runNext, 1500), 900);
  }, []);

  const prewarmFaceModels = useCallback((u) => {
    if (!u?.can_face || !navigator.onLine) return;
    const warmKey = `${u.id}|face`;
    if (warmedFaceModelsKeyRef.current === warmKey) return;
    warmedFaceModelsKeyRef.current = warmKey;
    const schedule = (fn) => {
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(fn, { timeout: 1800 });
      } else {
        setTimeout(fn, 300);
      }
    };
    schedule(() => {
      import('./lib/faceClient')
        .then((m) => (m.warmupFacePipeline ? m.warmupFacePipeline() : m.loadFaceModels()))
        .catch(() => {
          warmedFaceModelsKeyRef.current = '';
        });
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function restoreFromOfflineSession() {
      if (!isQuickDeviceEnabled()) return false;
      if (!(await hasValidOfflineSession())) return false;
      const cached = await getCachedUser();
      if (!cached || cancelled) return false;
      if (!canUseOfflineMode(cached)) {
        setQuickDeviceEnabled(false);
        await clearOfflineSession().catch(() => {});
        return false;
      }
      setUser(cached);
      return true;
    }

    (async () => {
      if (STRICT_LOGOUT_ON_CLOSE && !hasActiveSessionMarker()) {
        setPendingServerLogout(true);
        await clearOfflineSession().catch(() => {});
        if (navigator.onLine) {
          await auth.logout().catch(() => {});
          setPendingServerLogout(false);
        }
        if (!cancelled) {
          setUser(null);
          setLoading(false);
        }
        return;
      }

      if (await restoreFromOfflineSession()) {
        if (!cancelled) setLoading(false);
        return;
      }

      try {
        const { user: u } = await auth.me();
        if (!cancelled) {
          if (u) {
            setQuickDeviceEnabled(canUseOfflineMode(u));
          }
          setUser(u);
          if (u) {
            if (canUseOfflineMode(u)) {
              await setOfflineSession(u);
              await refreshOfflineCacheIfNeeded(u, { silent: true }).catch(() => {});
            } else {
              await clearOfflineSession().catch(() => {});
            }
          }
        }
      } catch {
        if (!cancelled && (await restoreFromOfflineSession())) {
          /* кэш после обрыва сети */
        } else if (!cancelled) {
          setUser(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [hasActiveSessionMarker, setPendingServerLogout]);

  useEffect(() => {
    if (!STRICT_LOGOUT_ON_CLOSE) return undefined;
    const flushPendingLogout = async () => {
      if (!hasPendingServerLogout() || !navigator.onLine) return;
      await auth.logout().catch(() => {});
      setPendingServerLogout(false);
    };
    flushPendingLogout();
    window.addEventListener('online', flushPendingLogout);
    return () => window.removeEventListener('online', flushPendingLogout);
  }, [hasPendingServerLogout, setPendingServerLogout]);

  useEffect(() => {
    if (!user) return undefined;
    setActionLogUser(user);
    if (isQuickDeviceEnabled() && canUseOfflineMode(user)) {
      setOfflineSession(user).catch(() => {});
    }
    return initActionLogSync();
  }, [user?.id]);

  useEffect(() => {
    if (!user) return undefined;
    return initOfflineCacheAutoSync(() => userRef.current);
  }, [user?.id]);

  useEffect(() => {
    if (!user) return undefined;
    const onCacheUpdated = () => {
      import('./lib/pageCache').then((m) => m.invalidatePageCache()).catch(() => {});
    };
    window.addEventListener('offline-cache-updated', onCacheUpdated);
    return () => window.removeEventListener('offline-cache-updated', onCacheUpdated);
  }, [user?.id]);

  const canTaskNotifications = !!(user?.can_tasks && user?.can_task_notifications);

  useEffect(() => {
    if (!user) {
      taskSeenStorageKeyRef.current = '';
      taskSeenIdsRef.current = new Set();
      return;
    }
    const storageKey = `warehouse-task-seen:${user.id}`;
    taskSeenStorageKeyRef.current = storageKey;
    taskSeenIdsRef.current = loadSeenTaskIds(storageKey);
  }, [user?.id]);

  useEffect(() => {
    if (!user || !canTaskNotifications) return undefined;
    let cancelled = false;
    let initialized = false;
    const loadAssignments = async () => {
      if (cancelled || !navigator.onLine) return;
      try {
        const data = await tasksApi.list();
        if (cancelled) return;
        const items = Array.isArray(data?.items) ? data.items : [];
        const mine = items.filter((row) => Number(row?.assigned_user_id) === Number(user.id));
        if (!initialized) {
          mine.forEach((row) => {
            const id = normalizeTaskId(row?.id);
            if (id) taskSeenIdsRef.current.add(id);
          });
          persistSeenTaskIds();
          initialized = true;
          return;
        }
        const incoming = [];
        for (const row of mine) {
          const id = normalizeTaskId(row?.id);
          if (!id || taskSeenIdsRef.current.has(id)) continue;
          incoming.push(row);
          taskSeenIdsRef.current.add(id);
        }
        if (incoming.length) {
          persistSeenTaskIds();
          incoming
            .sort((a, b) => Date.parse(a?.created_at || 0) - Date.parse(b?.created_at || 0))
            .forEach((row) => {
              showTaskToast({
                title: 'Новая задача',
                body: row?.title || 'Вам назначили новую задачу',
              });
            });
        }
      } catch {
        /* silent polling */
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') loadAssignments();
    };
    loadAssignments();
    const timer = setInterval(onVisible, getAdaptivePollInterval(15000, {
      mobileMs: 25000,
      lowPowerMs: 35000,
    }));
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [user?.id, canTaskNotifications, persistSeenTaskIds, showTaskToast]);

  useEffect(() => {
    if (!user || !canTaskNotifications) return undefined;
    const onSwMessage = (event) => {
      const msg = event?.data;
      if (!msg || msg.type !== 'TASK_PUSH_EVENT') return;
      const payload = msg.payload || {};
      const taskId = normalizeTaskId(payload.taskId || payload.task_id);
      if (taskId && !markTaskSeen(taskId)) return;
      showTaskToast({
        title: payload.title || 'Новая задача',
        body: payload.body || payload.taskTitle || 'Вам назначили новую задачу',
      });
    };
    navigator.serviceWorker?.addEventListener?.('message', onSwMessage);
    return () => navigator.serviceWorker?.removeEventListener?.('message', onSwMessage);
  }, [user?.id, canTaskNotifications, markTaskSeen, showTaskToast]);

  useEffect(() => {
    if (!user || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      return undefined;
    }
    let cancelled = false;
    const disablePush = async () => {
      const registration = await navigator.serviceWorker.ready.catch(() => null);
      if (!registration) return;
      const current = await registration.pushManager.getSubscription().catch(() => null);
      if (!current) return;
      const endpoint = current.endpoint;
      await current.unsubscribe().catch(() => {});
      if (navigator.onLine) {
        await notificationsApi.deletePushSubscription(endpoint).catch(() => {});
      }
    };
    const syncPushSubscription = async () => {
      if (cancelled || !canTaskNotifications || !navigator.onLine) return;
      const keyResponse = await notificationsApi.getPushPublicKey().catch(() => null);
      const publicKey = keyResponse?.publicKey;
      if (!publicKey) return;

      let permission = Notification.permission;
      if (permission === 'default') {
        const promptKey = `${TASK_PUSH_PROMPTED_PREFIX}${user.id}`;
        const prompted = localStorage.getItem(promptKey) === '1';
        if (!prompted) {
          localStorage.setItem(promptKey, '1');
          permission = await Notification.requestPermission();
        }
      }
      if (permission !== 'granted') return;

      const registration = await navigator.serviceWorker.ready.catch(() => null);
      if (!registration) return;
      let subscription = await registration.pushManager.getSubscription().catch(() => null);
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      }
      const json = subscription?.toJSON ? subscription.toJSON() : null;
      if (!json) return;
      await notificationsApi.savePushSubscription(json);
    };

    if (!canTaskNotifications) {
      disablePush().catch(() => {});
      return undefined;
    }

    syncPushSubscription().catch(() => {});
    const onOnline = () => syncPushSubscription().catch(() => {});
    window.addEventListener('online', onOnline);
    return () => {
      cancelled = true;
      window.removeEventListener('online', onOnline);
    };
  }, [user?.id, canTaskNotifications]);

  useEffect(() => {
    if (!user) return;
    const onOnline = () => {
      const currentUser = userRef.current;
      prewarmTabBundles(currentUser);
      prewarmFaceModels(currentUser);
      if (currentUser && isQuickDeviceEnabled() && canUseOfflineMode(currentUser)) {
        refreshOfflineCacheIfNeeded(currentUser, { silent: false }).catch(() => {});
      }
      auth.me().then(({ user: u }) => { if (u) setUser(u); }).catch(() => {});
    };
    prewarmTabBundles(user);
    prewarmFaceModels(user);
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [user?.id, prewarmTabBundles, prewarmFaceModels]);

  useEffect(() => {
    if (!user || !navigator.onLine) return;
    const t = setInterval(() => {
      auth.me()
        .then(({ user: u }) => {
          if (u) {
            setUser(u);
            setQuickDeviceEnabled(canUseOfflineMode(u));
            if (isQuickDeviceEnabled() && canUseOfflineMode(u)) {
              refreshOfflineCacheIfNeeded(u, { silent: true }).catch(() => {});
            } else {
              clearOfflineSession().catch(() => {});
            }
          }
        })
        .catch(() => {});
    }, getAdaptivePollInterval(60000, {
      mobileMs: 120000,
      lowPowerMs: 180000,
    }));
    return () => clearInterval(t);
  }, [user?.id]);

  const onLogin = (u) => {
    setQuickDeviceEnabled(canUseOfflineMode(u));
    if (!canUseOfflineMode(u)) {
      clearOfflineSession().catch(() => {});
    }
    markActiveSession(true);
    setUser(u);
  };
  const recoverWarehouseTabCache = useCallback(() => {
    import('./lib/pageCache').then((m) => m.invalidatePageCache('warehouse:materials')).catch(() => {});
    import('./lib/offlineCache').then((m) => Promise.allSettled([
      m.deleteCachedResponse('/api/materials'),
      m.deleteCachedResponse('/api/settings/catalog'),
      m.deleteCachedResponse('/api/materials/users-for-issuance'),
      m.deleteCachedResponsesByPathPrefix('/api/materials/by-code/'),
      m.deleteCachedResponsesByPathPrefix('/api/materials/'),
    ])).catch(() => {});
  }, []);
  const recoverIssuanceTabCache = useCallback(() => {
    import('./lib/pageCache').then((m) => m.invalidatePageCache('issuance:bundle')).catch(() => {});
    import('./lib/offlineCache').then((m) => Promise.allSettled([
      m.deleteCachedResponse('/api/operations/issuances'),
      m.deleteCachedResponse('/api/materials'),
      m.deleteCachedResponse('/api/materials/users-for-issuance'),
    ])).catch(() => {});
  }, []);
  const recoverSettingsTabCache = useCallback(() => {
    import('./lib/pageCache').then((m) => m.invalidatePageCache()).catch(() => {});
    import('./lib/offlineCache').then((m) => Promise.allSettled([
      m.deleteCachedResponsesByPathPrefix('/api/settings/'),
      m.deleteCachedResponsesByPathPrefix('/api/roles'),
      m.deleteCachedResponsesByPathPrefix('/api/users'),
      m.deleteCachedResponsesByPathPrefix('/api/organizations'),
    ])).catch(() => {});
  }, []);
  const recoverAttendanceTabCache = useCallback(() => {
    import('./lib/pageCache').then((m) => m.invalidatePageCache()).catch(() => {});
    import('./lib/offlineCache').then((m) => Promise.allSettled([
      m.deleteCachedResponsesByPathPrefix('/api/attendance/'),
    ])).catch(() => {});
  }, []);
  const recoverActionsTabCache = useCallback(() => {
    import('./lib/pageCache').then((m) => m.invalidatePageCache('actions:list')).catch(() => {});
    import('./lib/offlineCache').then((m) => Promise.allSettled([
      m.deleteCachedResponsesByPathPrefix('/api/actions'),
    ])).catch(() => {});
  }, []);
  const recoverProductionTabCache = useCallback(() => {
    import('./lib/pageCache').then((m) => m.invalidatePageCache()).catch(() => {});
    import('./lib/offlineCache').then((m) => Promise.allSettled([
      m.deleteCachedResponsesByPathPrefix('/api/reports/production'),
      m.deleteCachedResponse('/api/reports/production/locations'),
      m.deleteCachedResponse('/api/operations/issuances'),
      m.deleteCachedResponse('/api/materials'),
      m.deleteCachedResponse('/api/materials/users-for-issuance'),
    ])).catch(() => {});
  }, []);
  const recoverToolsTabCache = useCallback(() => {
    import('./lib/pageCache').then((m) => m.invalidatePageCache()).catch(() => {});
    import('./lib/offlineCache').then((m) => Promise.allSettled([
      m.deleteCachedResponsesByPathPrefix('/api/tools'),
      m.deleteCachedResponse('/api/settings/catalog'),
    ])).catch(() => {});
  }, []);
  const recoverTasksTabCache = useCallback(() => {
    import('./lib/pageCache').then((m) => m.invalidatePageCache()).catch(() => {});
    import('./lib/offlineCache').then((m) => Promise.allSettled([
      m.deleteCachedResponsesByPathPrefix('/api/tasks'),
    ])).catch(() => {});
  }, []);
  const onLogout = async () => {
    markActiveSession(false);
    setPendingServerLogout(false);
    await clearOfflineSession();
    try {
      await auth.logout();
    } catch {
      /* offline */
    }
    setUser(null);
  };

  const toastStack = taskToasts.length ? (
    <div className="fixed top-12 right-2 z-[120] flex flex-col gap-2 w-[min(24rem,calc(100vw-1rem))]">
      {taskToasts.map((toast) => (
        <button
          type="button"
          key={toast.id}
          className="text-left rounded-xl border border-sky-500/40 bg-black/90 shadow-lg px-3 py-2 hover:bg-black"
          onClick={() => {
            removeTaskToast(toast.id);
            navigate('/tasks');
          }}
        >
          <div className="text-sky-300 text-xs font-medium">{toast.title}</div>
          <div className="text-zinc-200 text-2xs mt-0.5">{toast.message}</div>
        </button>
      ))}
    </div>
  ) : null;

  if (loading) {
    return (
      <>
        {toastStack}
        <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-black">
          <div className="w-8 h-8 rounded-full border-2 border-white/20 border-t-white animate-spin" aria-hidden />
          <p className="text-zinc-500 text-xs">Загрузка…</p>
        </div>
      </>
    );
  }

  if (!user) {
    return (
      <>
        {toastStack}
        <Routes>
          <Route path="/login" element={<Login onLogin={onLogin} />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </>
    );
  }

  return (
    <>
      {toastStack}
      <Routes>
        <Route path="/" element={<Layout user={user} onLogout={onLogout} />}>
          <Route index element={<HomeRedirect user={user} />} />
          <Route
            path="warehouse"
            element={(
              <ProtectedRoute user={user} perm="can_warehouse">
                <RecoverableErrorBoundary onError={recoverWarehouseTabCache}>
                  <Warehouse user={user} />
                </RecoverableErrorBoundary>
              </ProtectedRoute>
            )}
          />
          <Route
            path="settings"
            element={(
              <ProtectedRoute user={user} anyPerm={['can_settings_organizations', 'can_settings_warehouses', 'can_settings_categories', 'can_settings_work', 'can_settings_tools', 'can_users', 'can_roles']}>
                <RecoverableErrorBoundary onError={recoverSettingsTabCache}>
                  <Settings user={user} />
                </RecoverableErrorBoundary>
              </ProtectedRoute>
            )}
          />
          <Route path="users" element={<Navigate to="/settings" replace state={{ tab: 'users' }} />} />
          <Route
            path="issuance"
            element={(
              <ProtectedRoute user={user} perm="can_issuance">
                <RecoverableErrorBoundary onError={recoverIssuanceTabCache}>
                  <Issuance user={user} />
                </RecoverableErrorBoundary>
              </ProtectedRoute>
            )}
          />
          <Route
            path="production"
            element={(
              <ProtectedRoute user={user} perm="can_production">
                <RecoverableErrorBoundary onError={recoverProductionTabCache}>
                  <Production user={user} />
                </RecoverableErrorBoundary>
              </ProtectedRoute>
            )}
          />
          <Route
            path="face"
            element={(
              <ProtectedRoute user={user} perm="can_face">
                <RecoverableErrorBoundary onError={recoverAttendanceTabCache}>
                  <FaceCheckIn user={user} />
                </RecoverableErrorBoundary>
              </ProtectedRoute>
            )}
          />
          <Route
            path="attendance"
            element={(
              <ProtectedRoute user={user} perm="can_attendance">
                <RecoverableErrorBoundary onError={recoverAttendanceTabCache}>
                  <AttendanceAll user={user} />
                </RecoverableErrorBoundary>
              </ProtectedRoute>
            )}
          />
          <Route
          path="tools"
          element={(
            <ProtectedRoute user={user} perm="can_tools">
              <RecoverableErrorBoundary onError={recoverToolsTabCache}>
                <Tools user={user} />
              </RecoverableErrorBoundary>
            </ProtectedRoute>
          )}
        />
        <Route
            path="tasks"
            element={(
              <ProtectedRoute user={user} perm="can_tasks">
                <RecoverableErrorBoundary onError={recoverTasksTabCache}>
                  <Tasks user={user} />
                </RecoverableErrorBoundary>
              </ProtectedRoute>
            )}
          />
          <Route
            path="actions"
            element={(
              <ProtectedRoute user={user} perm="can_actions">
                <RecoverableErrorBoundary onError={recoverActionsTabCache}>
                  <Actions user={user} />
                </RecoverableErrorBoundary>
              </ProtectedRoute>
            )}
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
