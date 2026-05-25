import { useState, useEffect, useRef, useCallback, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { auth } from './api';
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

const Warehouse = lazy(() => import('./pages/Warehouse'));
const Issuance = lazy(() => import('./pages/Issuance'));
const Production = lazy(() => import('./pages/Production'));
const Users = lazy(() => import('./pages/Users'));
const FaceCheckIn = lazy(() => import('./pages/FaceCheckIn'));
const AttendanceAll = lazy(() => import('./pages/AttendanceAll'));
const Settings = lazy(() => import('./pages/Settings'));
const Actions = lazy(() => import('./pages/Actions'));

const STRICT_LOGOUT_ON_CLOSE = true;
const ACTIVE_SESSION_KEY = 'warehouse-active-session';
const PENDING_SERVER_LOGOUT_KEY = 'warehouse-pending-server-logout';

function HomeRedirect({ user }) {
  return <Navigate to={getDefaultRoute(user)} replace />;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const userRef = useRef(null);
  const warmedBundleKeyRef = useRef('');
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

  const prewarmTabBundles = useCallback((u) => {
    if (!u || !navigator.onLine) return;
    const canSettings = !!(
      u.can_settings_organizations
      || u.can_settings_warehouses
      || u.can_settings_categories
      || u.can_settings_work
      || u.can_users
      || u.can_roles
    );
    const warmKey = [
      u.id,
      u.can_warehouse ? 'w' : '',
      u.can_issuance ? 'i' : '',
      u.can_production ? 'p' : '',
      u.can_actions ? 'a' : '',
      u.can_face ? 'f' : '',
      u.can_attendance ? 't' : '',
      canSettings ? 's' : '',
    ].join('|');
    if (warmedBundleKeyRef.current === warmKey) return;
    warmedBundleKeyRef.current = warmKey;

    const jobs = [];
    if (u.can_warehouse) jobs.push(import('./pages/Warehouse'));
    if (u.can_issuance) jobs.push(import('./pages/Issuance'));
    if (u.can_production) jobs.push(import('./pages/Production'));
    if (u.can_actions) jobs.push(import('./pages/Actions'));
    if (u.can_face) jobs.push(import('./pages/FaceCheckIn'));
    if (u.can_attendance) jobs.push(import('./pages/AttendanceAll'));
    if (canSettings) jobs.push(import('./pages/Settings'));
    if (u.can_users) jobs.push(import('./pages/Users'));

    Promise.allSettled(jobs).then((results) => {
      if (results.some((r) => r.status === 'rejected')) {
        // Разрешаем повторить прогрев при следующем online-событии.
        warmedBundleKeyRef.current = '';
      }
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function restoreFromOfflineSession() {
      if (!isQuickDeviceEnabled()) return false;
      if (!(await hasValidOfflineSession())) return false;
      const cached = await getCachedUser();
      if (!cached || cancelled) return false;
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
            setQuickDeviceEnabled(true);
          }
          setUser(u);
          if (u) {
            await setOfflineSession(u);
            if (navigator.onLine) {
              await refreshOfflineCacheIfNeeded(u, { silent: true }).catch(() => {});
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
    if (isQuickDeviceEnabled()) {
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

  useEffect(() => {
    if (!user) return;
    const onOnline = () => {
      prewarmTabBundles(userRef.current);
      if (isQuickDeviceEnabled()) refreshOfflineCacheIfNeeded(user, { silent: false }).catch(() => {});
      auth.me().then(({ user: u }) => { if (u) setUser(u); }).catch(() => {});
    };
    prewarmTabBundles(user);
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [user?.id, prewarmTabBundles]);

  useEffect(() => {
    if (!user || !navigator.onLine) return;
    const t = setInterval(() => {
      auth.me()
        .then(({ user: u }) => {
          if (u) {
            setUser(u);
            if (isQuickDeviceEnabled()) refreshOfflineCacheIfNeeded(u, { silent: true }).catch(() => {});
          }
        })
        .catch(() => {});
    }, 60000);
    return () => clearInterval(t);
  }, [user?.id]);

  const onLogin = (u) => {
    setQuickDeviceEnabled(true);
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
      m.deleteCachedResponse('/api/users'),
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

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-black">
        <div className="w-8 h-8 rounded-full border-2 border-white/20 border-t-white animate-spin" aria-hidden />
        <p className="text-zinc-500 text-xs">Загрузка…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login onLogin={onLogin} />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
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
            <ProtectedRoute user={user} anyPerm={['can_settings_organizations', 'can_settings_warehouses', 'can_settings_categories', 'can_settings_work', 'can_users', 'can_roles']}>
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
  );
}
