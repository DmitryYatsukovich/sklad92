import { useState, useEffect, useCallback } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { auth, stats as statsApi } from './api';
import { syncActionLogToServer } from './lib/actionLog';
import {
  isQuickDeviceEnabled,
  refreshOfflineCacheIfNeeded,
  consumePrefetchNotice,
  formatPrefetchStatsMessage,
  measureOfflineCacheSize,
} from './lib/offlineCache';

const tabs = [
  { to: '/warehouse', label: 'Склад', perm: 'can_warehouse' },
  { to: '/issuance', label: 'Выдача', perm: 'can_issuance' },
  { to: '/production', label: 'Выраб.', perm: 'can_production' },
  { to: '/actions', label: 'Действия', perm: 'can_actions' },
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
  const [networkOnline, setNetworkOnline] = useState(() => navigator.onLine);
  const [prefetchBanner, setPrefetchBanner] = useState(null);
  const [cacheSizeLabel, setCacheSizeLabel] = useState(null);

  const isAppOnline = networkOnline && serverOnline;

  const updateCacheSizeLabel = useCallback(() => {
    if (!isQuickDeviceEnabled()) {
      setCacheSizeLabel(null);
      return;
    }
    measureOfflineCacheSize()
      .then((s) => setCacheSizeLabel(formatBytes(s.totalBytes)))
      .catch(() => setCacheSizeLabel(null));
  }, []);

  useEffect(() => {
    const stats = consumePrefetchNotice();
    if (stats) setPrefetchBanner(formatPrefetchStatsMessage(stats));
    updateCacheSizeLabel();
    const onCacheUpdated = (e) => {
      if (e.detail?.message) setPrefetchBanner(e.detail.message);
      updateCacheSizeLabel();
    };
    window.addEventListener('offline-cache-updated', onCacheUpdated);
    return () => window.removeEventListener('offline-cache-updated', onCacheUpdated);
  }, [updateCacheSizeLabel]);

  useEffect(() => {
    const onNet = () => setNetworkOnline(navigator.onLine);
    window.addEventListener('online', onNet);
    window.addEventListener('offline', onNet);
    return () => {
      window.removeEventListener('online', onNet);
      window.removeEventListener('offline', onNet);
    };
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const check = () => {
      if (!navigator.onLine) {
        setServerOnline(false);
        return;
      }
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

  useEffect(() => {
    if (!networkOnline || !user) return;
    syncActionLogToServer().catch(() => {});
    if (serverOnline && isQuickDeviceEnabled()) {
      const t = setTimeout(() => {
        refreshOfflineCacheIfNeeded(user, { silent: true })
          .then(() => updateCacheSizeLabel())
          .catch(() => {});
      }, 400);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [networkOnline, serverOnline, user?.id]);

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
              </div>
              {isQuickDeviceEnabled() && cacheSizeLabel && (
                <span className="hidden lg:inline text-2xs text-zinc-500" title="Объём кэша на устройстве">
                  кэш {cacheSizeLabel}
                </span>
              )}
              <span
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs font-medium ${
                  isAppOnline
                    ? 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30'
                    : 'bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30'
                }`}
                title={
                  !networkOnline
                    ? 'Нет интернета на устройстве'
                    : !serverOnline
                      ? 'Интернет есть, сервер недоступен — работа из кэша'
                      : 'Связь с сервером есть'
                }
              >
                <span className={`w-1.5 h-1.5 rounded-full ${isAppOnline ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                {isAppOnline ? 'Онлайн' : 'Офлайн'}
              </span>
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
      {prefetchBanner && (
        <div className="border-b border-emerald-500/30 bg-emerald-500/10 px-2 sm:px-3 py-1.5">
          <div className="max-w-[100rem] mx-auto flex items-start justify-between gap-2">
            <p className="text-2xs text-emerald-300">{prefetchBanner}</p>
            <button
              type="button"
              className="text-zinc-500 hover:text-white text-xs shrink-0"
              onClick={() => setPrefetchBanner(null)}
              aria-label="Закрыть"
            >
              ×
            </button>
          </div>
        </div>
      )}
      <main className="flex-1 max-w-[100rem] w-full mx-auto px-2 sm:px-3 py-2">
        <Outlet />
      </main>
    </div>
  );
}
