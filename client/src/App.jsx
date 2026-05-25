import { useState, useEffect, useRef, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { auth } from './api';
import Login from './pages/Login';
import Layout from './Layout';
import { getDefaultRoute } from './lib/defaultRoute.js';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import { setActionLogUser, initActionLogSync } from './lib/actionLog';
import {
  isQuickDeviceEnabled,
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

function HomeRedirect({ user }) {
  return <Navigate to={getDefaultRoute(user)} replace />;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const userRef = useRef(null);
  userRef.current = user;

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
      if (await restoreFromOfflineSession()) {
        if (!cancelled) setLoading(false);
        return;
      }

      try {
        const { user: u } = await auth.me();
        if (!cancelled) {
          setUser(u);
          if (u && isQuickDeviceEnabled()) {
            await setOfflineSession(u);
            if (navigator.onLine) refreshOfflineCacheIfNeeded(u, { silent: true }).catch(() => {});
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
  }, []);

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
      if (isQuickDeviceEnabled()) refreshOfflineCacheIfNeeded(user, { silent: false }).catch(() => {});
      auth.me().then(({ user: u }) => { if (u) setUser(u); }).catch(() => {});
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [user?.id]);

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

  const onLogin = (u) => setUser(u);
  const onLogout = async () => {
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
              <Warehouse user={user} />
            </ProtectedRoute>
          )}
        />
        <Route
          path="settings"
          element={(
            <ProtectedRoute user={user} anyPerm={['can_settings_organizations', 'can_settings_warehouses', 'can_settings_categories', 'can_settings_work', 'can_users', 'can_roles']}>
              <Settings user={user} />
            </ProtectedRoute>
          )}
        />
        <Route path="users" element={<Navigate to="/settings" replace state={{ tab: 'users' }} />} />
        <Route
          path="issuance"
          element={(
            <ProtectedRoute user={user} perm="can_issuance">
              <Issuance user={user} />
            </ProtectedRoute>
          )}
        />
        <Route
          path="production"
          element={(
            <ProtectedRoute user={user} perm="can_production">
              <Production user={user} />
            </ProtectedRoute>
          )}
        />
        <Route
          path="face"
          element={(
            <ProtectedRoute user={user} perm="can_face">
              <FaceCheckIn user={user} />
            </ProtectedRoute>
          )}
        />
        <Route
          path="attendance"
          element={(
            <ProtectedRoute user={user} perm="can_attendance">
              <AttendanceAll user={user} />
            </ProtectedRoute>
          )}
        />
        <Route
          path="actions"
          element={(
            <ProtectedRoute user={user} perm="can_actions">
              <Actions user={user} />
            </ProtectedRoute>
          )}
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
