export { QUICK_DEVICE_KEY } from './constants.js';
export {
  isQuickDeviceEnabled,
  setQuickDeviceEnabled,
  getQuickDeviceEnabledFromStorage,
} from './prefs.js';
export {
  getCachedResponse,
  setCachedResponse,
  getCachedUser,
  setCachedUser,
  getCacheMeta,
  setCacheMeta,
  shouldCacheGetPath,
  clearOfflineCache,
} from './store.js';
export { prefetchOfflineData } from './prefetch.js';
export { formatPrefetchStatsMessage } from './prefetchStats.js';
export { formatBytes, measureOfflineCacheSize } from './cacheSize.js';
export { refreshOfflineCacheIfNeeded, initOfflineCacheAutoSync } from './autoSync.js';
export {
  saveOfflineCredentials,
  verifyOfflinePassword,
  setOfflineSession,
  clearOfflineSession,
  hasValidOfflineSession,
} from './offlineAuth.js';

export { setPrefetchNotice, consumePrefetchNotice } from './notice.js';
