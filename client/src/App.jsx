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
        <Route index element={<Navigate to="/warehouse" replace />} />
        <Route path="warehouse" element={<Warehouse user={user} />} />
        <Route path="issuance" element={<Issuance user={user} />} />
        <Route path="production" element={<Production user={user} />} />
        <Route path="users" element={<Users user={user} />} />
        <Route path="roles" element={<Roles user={user} />} />
        <Route path="face" element={<FaceCheckIn />} />
        <Route path="attendance" element={<AttendanceAll />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
