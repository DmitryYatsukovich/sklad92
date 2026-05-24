import { useState, useEffect } from 'react';
import { auth } from '../api';
import { isNetworkFailure } from '../lib/actionLog';
import {
  getQuickDeviceEnabledFromStorage,
  setQuickDeviceEnabled,
  setCachedUser as persistCachedUser,
  getCachedUser,
  prefetchOfflineData,
  isQuickDeviceEnabled,
} from '../lib/offlineCache';

export default function Login({ onLogin }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [quickDevice, setQuickDevice] = useState(() => getQuickDeviceEnabledFromStorage());
  const [prefetchStatus, setPrefetchStatus] = useState('');
  const [cachedSession, setCachedSession] = useState(null);
  const [offlineMode, setOfflineMode] = useState(!navigator.onLine);

  useEffect(() => {
    const syncOffline = () => setOfflineMode(!navigator.onLine);
    window.addEventListener('online', syncOffline);
    window.addEventListener('offline', syncOffline);
    return () => {
      window.removeEventListener('online', syncOffline);
      window.removeEventListener('offline', syncOffline);
    };
  }, []);

  useEffect(() => {
    if (!quickDevice && !isQuickDeviceEnabled()) return;
    getCachedUser().then((u) => {
      if (u) {
        setCachedSession(u);
        if (!login) setLogin(u.login || '');
      }
    });
  }, [quickDevice]);

  const continueOffline = async () => {
    setError('');
    const u = await getCachedUser();
    if (!u) {
      setError('Нет сохранённой сессии. Сначала войдите онлайн с включённым «Устройство для быстрой работы».');
      return;
    }
    if (login.trim() && u.login && login.trim() !== u.login) {
      setError(`Офлайн доступен для пользователя «${u.login}»`);
      return;
    }
    onLogin(u);
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setPrefetchStatus('');

    if (!navigator.onLine) {
      await continueOffline();
      return;
    }

    setLoading(true);
    try {
      const { user } = await auth.login(login.trim(), password);
      setQuickDeviceEnabled(quickDevice);
      if (quickDevice) {
        await persistCachedUser(user);
        setCachedSession(user);
        setPrefetchStatus('Загрузка данных на устройство…');
        const result = await prefetchOfflineData(user, {
          onProgress: (msg) => setPrefetchStatus(msg || 'Загрузка…'),
        });
        if (!result.ok) {
          setError(result.error || 'Не удалось сохранить все данные в кэш');
        }
      }
      onLogin(user);
    } catch (err) {
      if (quickDevice && isNetworkFailure(err)) {
        const u = await getCachedUser();
        if (u && (!login.trim() || u.login === login.trim())) {
          onLogin(u);
          return;
        }
      }
      const msg = err.message || 'Ошибка входа';
      setError(
        msg === 'Неверный логин или пароль'
          ? 'Неверный логин или пароль. Проверьте раскладку и тот же пароль, что задавали при создании.'
          : msg
      );
    } finally {
      setLoading(false);
      setPrefetchStatus('');
    }
  };

  const canContinueOffline = (quickDevice || isQuickDeviceEnabled()) && cachedSession;

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-black">
      <div className="w-full max-w-sm">
        <div className="card p-6">
          <div className="flex items-center gap-2 mb-6">
            <div className="w-8 h-8 rounded bg-white flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
            <div>
              <h1 className="text-base font-semibold text-white">Склад</h1>
              <p className="text-zinc-500 text-xs">Вход в систему</p>
            </div>
          </div>

          {offlineMode && (
            <p className="text-2xs text-amber-400/90 border border-amber-500/30 rounded px-2 py-1.5 mb-3">
              Нет связи с сервером.
              {canContinueOffline
                ? ' Можно продолжить с данными, сохранёнными на устройстве.'
                : ' Включите «Устройство для быстрой работы» и войдите онлайн хотя бы один раз.'}
            </p>
          )}

          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="label">Логин</label>
              <input
                type="text"
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                className="input"
                placeholder="Логин"
                autoComplete="username"
                required={!offlineMode}
              />
            </div>
            {!offlineMode && (
              <div>
                <label className="label">Пароль</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input"
                  placeholder="Пароль"
                  autoComplete="current-password"
                  required
                />
              </div>
            )}
            <label className="flex items-start gap-2 p-2 rounded-lg border border-white/10 bg-white/[0.02] cursor-pointer">
              <input
                type="checkbox"
                checked={quickDevice}
                onChange={(e) => setQuickDevice(e.target.checked)}
                className="mt-0.5 rounded border-zinc-600"
                disabled={offlineMode}
              />
              <span className="text-xs text-zinc-300">
                <span className="block text-white font-medium">Устройство для быстрой работы</span>
                Сохранить данные приложения в кэше устройства для работы без интернета
              </span>
            </label>
            {prefetchStatus && (
              <p className="text-2xs text-zinc-400 border border-white/10 rounded px-2 py-1.5">{prefetchStatus}</p>
            )}
            {error && <p className="alert-error">{error}</p>}
            {canContinueOffline && (
              <button
                type="button"
                disabled={loading}
                onClick={continueOffline}
                className="btn-secondary w-full text-sm"
              >
                Продолжить офлайн ({cachedSession.display_name || cachedSession.login})
              </button>
            )}
            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? (prefetchStatus || 'Вход…') : offlineMode ? 'Продолжить офлайн' : 'Войти'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
