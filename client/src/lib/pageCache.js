/** Кэш данных вкладок в памяти (сессия) — мгновенное открытие при повторном переходе. */
const store = new Map();

export function peekPageCache(key) {
  return store.get(key) ?? null;
}

export function setPageCache(key, data) {
  if (data === undefined) store.delete(key);
  else store.set(key, data);
}

export function invalidatePageCache(key) {
  if (key) store.delete(key);
  else store.clear();
}

/** Показать кэш из памяти или IndexedDB, затем обновить с сервера. */
export async function hydrateFromCaches({ memoryKey, offlinePath, onData, quickDevice }) {
  const mem = peekPageCache(memoryKey);
  if (mem != null) {
    onData(mem);
    return true;
  }
  if (!quickDevice || !offlinePath) return false;
  const { getCachedResponse } = await import('./offlineCache/store.js');
  const cached = await getCachedResponse(offlinePath);
  if (cached == null) return false;
  onData(cached);
  setPageCache(memoryKey, cached);
  return true;
}
