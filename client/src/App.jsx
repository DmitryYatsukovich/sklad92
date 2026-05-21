import { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { auth } from './api';
import Login from './pages/Login';
import Layout from './Layout';
import Warehouse from './pages/Warehouse';
import Issuance from './pages/Issuance';
import Production from './pages/Production';
import Users from './pages/Users';
import FaceCheckIn from './pages/FaceCheckIn';
import AttendanceAll from './pages/AttendanceAll';
import Settings from './pages/Settings';
import { getDefaultRoute } from './lib/defaultRoute.js';
import ProtectedRoute from './components/ProtectedRoute.jsx';

function HomeRedirect({ user }) {
  return <Navigate to={getDefaultRoute(user)} replace />;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    auth.me()
      .then(({ user: u }) => setUser(u))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!user) return;
    const t = setInterval(() => {
      auth.me()
        .then(({ user: u }) => { if (u) setUser(u); })
        .catch(() => setUser(null));
    }, 15000);
    return () => clearInterval(t);
  }, [user?.id]);

  const onLogin = (u) => setUser(u);
  const onLogout = () => auth.logout().then(() => setUser(null)).catch(() => setUser(null));

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
        <Route path="warehouse" element={<ProtectedRoute user={user} perm="can_warehouse"><Warehouse user={user} /></ProtectedRoute>} />
        <Route path="settings" element={<ProtectedRoute user={user} anyPerm={['can_settings_organizations', 'can_settings_warehouses', 'can_settings_categories', 'can_settings_work', 'can_users', 'can_roles']}><Settings user={user} /></ProtectedRoute>} />
        <Route path="users" element={<Navigate to="/settings" replace state={{ tab: 'users' }} />} />
        <Route path="issuance" element={<ProtectedRoute user={user} perm="can_issuance"><Issuance user={user} /></ProtectedRoute>} />
        <Route path="production" element={<ProtectedRoute user={user} perm="can_production"><Production user={user} /></ProtectedRoute>} />
        <Route path="face" element={<ProtectedRoute user={user} perm="can_face"><FaceCheckIn user={user} /></ProtectedRoute>} />
        <Route path="attendance" element={<ProtectedRoute user={user} perm="can_attendance"><AttendanceAll user={user} /></ProtectedRoute>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
