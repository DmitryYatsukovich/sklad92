import { useState, useEffect } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { auth, stats as statsApi } from './api';

const tabs = [
  { to: '/warehouse', label: 'Склад', perm: 'can_warehouse' },
  { to: '/issuance', label: 'Выдача', perm: 'can_issuance' },
  { to: '/production', label: 'Выработка', perm: 'can_production' },
  { to: '/face', label: 'Отметка', perm: null },
  { to: '/attendance', label: 'Посещения', perm: 'can_attendance' },
  { to: '/users', label: 'Пользователи', perm: 'can_users' },
  { to: '/roles', label: 'Роли', perm: 'can_users' },
];

function formatBytes(n) {
  if (n == null || n < 0) return '—';
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} КБ`;
  return `${(n / 1024 / 1024).toFixed(1)} МБ`;
}

export default function Layout({ user, onLogout }) {
  const visibleTabs = tabs.filter((t) => t.perm == null || user[t.perm]);
  const navTabs = visibleTabs.length > 0 ? visibleTabs : tabs;
  const [now, setNow] = useState(() => new Date());
  const [dbSize, setDbSize] = useState(null);
  const [serverOnline, setServerOnline] = useState(true);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const check = () => {
      auth.me()
        .then(() => {
          setServerOnline(true);
          return statsApi.get().then(({ sizeBytes }) => setDbSize(sizeBytes)).catch(() => {});
        })
        .catch(() => setServerOnline(false));
    };
    check();
    const t = setInterval(check, 15000);
    return () => clearInterval(t);
  }, []);

  const dateStr = now.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-surface-800 border-b border-slate-700/50 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <h1 className="text-xl font-semibold text-white tracking-tight">Склад</h1>
          <nav className="flex items-center gap-1 overflow-x-auto pb-1 md:pb-0">
            {navTabs.map((tab) => (
              <NavLink
                key={tab.to}
                to={tab.to}
                className={({ isActive }) =>
                  'px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ' +
                  (isActive ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50')
                }
              >
                {tab.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-3 shrink-0">
            <div className="hidden md:flex items-center gap-3 text-slate-500 text-xs">
              <span title="Дата и время">{dateStr} {timeStr}</span>
              <span className="text-slate-600">|</span>
              <span title="Размер базы данных">{dbSize != null ? formatBytes(dbSize) : '—'}</span>
              <span className="text-slate-600">|</span>
              <span className="flex items-center gap-1" title="Соединение с сервером">
                <span className={`w-1.5 h-1.5 rounded-full ${serverOnline ? 'bg-emerald-500' : 'bg-red-500'}`} />
                {serverOnline ? 'Онлайн' : 'Офлайн'}
              </span>
            </div>
            <span className="text-slate-400 text-sm hidden sm:inline">
              {user.display_name || user.login}
              {user.role === 'admin' && ' (админ)'}
            </span>
            <button
              type="button"
              onClick={onLogout}
              className="px-3 py-1.5 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-slate-700/50"
            >
              Выход
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
