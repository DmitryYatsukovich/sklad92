import { formatBytes } from './cacheSize.js';

/** Сообщение после загрузки данных на устройство (экран входа). */
export function formatPrefetchStatsMessage(stats) {
  if (!stats?.totalBytes) {
    return 'Данные на устройство не загружены.';
  }
  return `Данные на устройстве: ${formatBytes(stats.totalBytes)}`;
}

export function buildPrefetchStatsFromStorage(storage) {
  return {
    totalBytes: storage.totalBytes,
    entriesCount: storage.entriesCount,
    items: storage.items,
  };
}
