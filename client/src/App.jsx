import { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { auth } from './api';
import Login from './pages/Login';
import Layout from './Layout';
import Warehouse from './pages/Warehouse';
import Issuance from './pages/Issuance';
import Production from './pages/Production';
import Users from './pages/Users';
import Roles from './pages/Roles';
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

  const onLogin = (u) => setUser(u);
  const onLogout = () => auth.logout().then(() => setUser(null)).catch(() => setUser(null));

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-900">
        <div className="text-brand-400 text-lg">Загрузка…</div>
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
        <Route path="settings" element={<ProtectedRoute user={user} perm="can_warehouse"><Settings /></ProtectedRoute>} />
        <Route path="issuance" element={<ProtectedRoute user={user} perm="can_issuance"><Issuance user={user} /></ProtectedRoute>} />
        <Route path="production" element={<ProtectedRoute user={user} perm="can_production"><Production user={user} /></ProtectedRoute>} />
        <Route path="users" element={<ProtectedRoute user={user} perm="can_users"><Users user={user} /></ProtectedRoute>} />
        <Route path="roles" element={<ProtectedRoute user={user} perm="can_users"><Roles user={user} /></ProtectedRoute>} />
        <Route path="face" element={<FaceCheckIn />} />
        <Route path="attendance" element={<ProtectedRoute user={user} perm="can_attendance"><AttendanceAll /></ProtectedRoute>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
