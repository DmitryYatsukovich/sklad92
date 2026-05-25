import { isQuickDeviceEnabled, setQuickDeviceEnabled } from './prefs.js';
import { prefetchOfflineData } from './prefetch.js';
import { setPrefetchNotice } from './notice.js';
import { formatPrefetchStatsMessage } from './prefetchStats.js';

let syncing = false;

/** Обновить кэш при появлении сети (без дублирования параллельных запусков). */
export async function refreshOfflineCacheIfNeeded(user, { silent = false } = {}) {
  if (!user?.id || !navigator.onLine) return null;
  if (!isQuickDeviceEnabled()) {
    // Обязательный офлайн-режим: как только есть онлайн-пользователь, включаем кэш устройства.
    setQuickDeviceEnabled(true);
  }
  if (syncing) return null;
  syncing = true;
  try {
    const result = await prefetchOfflineData(user, {
      onProgress: silent ? undefined : (msg) => {
        if (!silent) window.dispatchEvent(new CustomEvent('offline-cache-sync', { detail: { message: msg } }));
      },
    });
    if (result.ok && result.stats) {
      if (!silent) setPrefetchNotice(result.stats);
      window.dispatchEvent(new CustomEvent('offline-cache-updated', {
        detail: { stats: result.stats, message: formatPrefetchStatsMessage(result.stats) },
      }));
    }
    return result;
  } finally {
    syncing = false;
  }
}

export function initOfflineCacheAutoSync(getUser) {
  const onOnline = () => {
    const user = getUser();
    if (user) refreshOfflineCacheIfNeeded(user, { silent: false }).catch(() => {});
  };
  window.addEventListener('online', onOnline);
  return () => window.removeEventListener('online', onOnline);
}
