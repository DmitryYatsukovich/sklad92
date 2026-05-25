import { useState, useEffect } from 'react';
import { auth } from '../api';
import {
  setQuickDeviceEnabled,
  setCachedUser as persistCachedUser,
  getCachedUser,
  prefetchOfflineData,
  isQuickDeviceEnabled,
  saveOfflineCredentials,
  verifyOfflinePassword,
  setOfflineSession,
  setPrefetchNotice,
  formatPrefetchStatsMessage,
} from '../lib/offlineCache';

export default function Login({ onLogin }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [prefetchStatus, setPrefetchStatus] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [offlineMode, setOfflineMode] = useState(!navigator.onLine);

  useEffect(() => {
    const sync = () => setOfflineMode(!navigator.onLine);
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);

  useEffect(() => {
    if (!isQuickDeviceEnabled()) return;
    getCachedUser().then((u) => {
      if (u && !login) setLogin(u.login || '');
    });
  }, [login]);

  const finishLogin = async (user, { stats, withOfflineSession = false } = {}) => {
    if (withOfflineSession || isQuickDeviceEnabled()) {
      await setOfflineSession(user);
    }
    if (stats) {
      setPrefetchNotice(stats);
      setSuccessMsg(formatPrefetchStatsMessage(stats));
    }
    onLogin(user);
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setPrefetchStatus('');
    const loginNorm = login.trim();
    if (!loginNorm) return setError('Укажите логин');
    if (!password) return setError('Укажите пароль');

    setLoading(true);
    try {
      if (!navigator.onLine) {
        if (!isQuickDeviceEnabled()) {
          throw new Error('Нет сети. Подключите интернет и войдите онлайн, чтобы загрузить данные на устройство.');
        }
        const ok = await verifyOfflinePassword(loginNorm, password);
        if (!ok) throw new Error('Неверный логин или пароль (офлайн-проверка)');
        const user = await getCachedUser();
        if (!user || user.login !== loginNorm) {
          throw new Error('Нет данных пользователя в кэше. Войдите онлайн и дождитесь полной загрузки данных.');
        }
        await finishLogin(user, { withOfflineSession: true });
        return;
      }

      const { user } = await auth.login(loginNorm, password);
      // Всегда включаем офлайн-кэш устройства: вход онлайн = полная предзагрузка данных.
      setQuickDeviceEnabled(true);
      await persistCachedUser(user);
      await saveOfflineCredentials(loginNorm, password);
      setPrefetchStatus('Загрузка данных на устройство…');
      let result = await prefetchOfflineData(user, {
        onProgress: (msg) => setPrefetchStatus(msg || 'Загрузка…'),
      });
      if (!result.ok && navigator.onLine) {
        result = await prefetchOfflineData(user, {
          onProgress: (msg) => setPrefetchStatus(msg || 'Загрузка…'),
        });
      }
      if (!result.ok) {
        setError(result.error || 'Не удалось сохранить все данные в кэш устройства');
        await finishLogin(user, { withOfflineSession: true });
        return;
      }
      setSuccessMsg(formatPrefetchStatsMessage(result.stats));
      await finishLogin(user, { stats: result.stats, withOfflineSession: true });
    } catch (err) {
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
              Нет связи с сервером. Введите логин и пароль — проверка по данным, сохранённым на устройстве.
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
                required
              />
            </div>
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
            {!offlineMode && (
              <p className="text-2xs text-zinc-300 border border-white/10 rounded px-2 py-1.5 bg-white/[0.02]">
                При входе онлайн приложение автоматически загружает и сохраняет все доступные данные на устройство для офлайн-работы.
              </p>
            )}
            {prefetchStatus && (
              <p className="text-2xs text-zinc-400 border border-white/10 rounded px-2 py-1.5">{prefetchStatus}</p>
            )}
            {successMsg && (
              <p className="text-2xs text-emerald-400/90 border border-emerald-500/30 bg-emerald-500/10 rounded px-2 py-1.5">
                {successMsg}
              </p>
            )}
            {error && <p className="alert-error">{error}</p>}
            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading
                ? (prefetchStatus || (offlineMode ? 'Вход офлайн…' : 'Вход…'))
                : (offlineMode ? 'Войти офлайн' : 'Войти')}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
