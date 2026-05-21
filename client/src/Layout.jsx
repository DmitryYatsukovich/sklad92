import { useState, useEffect } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { auth, stats as statsApi } from './api';

const tabs = [
  { to: '/warehouse', label: 'Склад', perm: 'can_warehouse' },
  { to: '/issuance', label: 'Выдача', perm: 'can_issuance' },
  { to: '/production', label: 'Выраб.', perm: 'can_production' },
  { to: '/face', label: 'Отметка', perm: 'can_face' },
  { to: '/attendance', label: 'Посещ.', perm: 'can_attendance' },
  {
    to: '/settings',
    label: 'Настр.',
    perms: [
      'can_settings_organizations',
      'can_settings_warehouses',
      'can_settings_categories',
      'can_settings_work',
      'can_users',
      'can_roles',
    ],
  },
];

function formatBytes(n) {
  if (n == null || n < 0) return '—';
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} КБ`;
  return `${(n / 1024 / 1024).toFixed(1)} МБ`;
}

export default function Layout({ user, onLogout }) {
  const visibleTabs = tabs.filter((t) => {
    if (t.perms?.length) return t.perms.some((p) => user[p]);
    if (t.perm == null) return true;
    return user[t.perm];
  });
  const navTabs = visibleTabs;
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
  const timeStr = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-black/95 backdrop-blur-md">
        <div className="max-w-[100rem] mx-auto px-2 sm:px-3">
          <div className="flex items-center justify-between gap-2 h-9">
            <div className="flex items-center gap-2 shrink-0 min-w-0">
              <div className="w-6 h-6 rounded bg-white flex items-center justify-center shrink-0">
                <svg className="w-3.5 h-3.5 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
              </div>
              <span className="text-sm font-semibold text-white hidden xs:inline">Склад</span>
            </div>

            <nav className="flex items-center gap-0.5 overflow-x-auto flex-1 min-w-0 mx-1">
              {navTabs.map((tab) => (
                <NavLink
                  key={tab.to}
                  to={tab.to}
                  className={({ isActive }) => (isActive ? 'nav-pill-active' : 'nav-pill-inactive')}
                >
                  {tab.label}
                </NavLink>
              ))}
            </nav>

            <div className="flex items-center gap-1.5 shrink-0">
              <div className="hidden xl:flex items-center gap-1.5 text-zinc-500 text-2xs font-mono">
                <span>{dateStr}</span>
                <span className="text-zinc-700">·</span>
                <span>{timeStr}</span>
                <span className="text-zinc-700">·</span>
                <span>{dbSize != null ? formatBytes(dbSize) : '—'}</span>
                <span className={`w-1 h-1 rounded-full ${serverOnline ? 'bg-white' : 'bg-zinc-600'}`} />
              </div>
              <span className="hidden md:inline text-2xs text-zinc-400 max-w-[5rem] truncate">
                {user.display_name || user.login}
              </span>
              <button type="button" onClick={onLogout} className="btn-ghost">
                Выход
              </button>
            </div>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-[100rem] w-full mx-auto px-2 sm:px-3 py-2">
        <Outlet />
      </main>
    </div>
  );
}
