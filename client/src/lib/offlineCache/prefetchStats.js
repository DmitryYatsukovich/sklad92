import { formatBytes } from './cacheSize.js';

/** Сообщение о загруженных в кэш данных (объём памяти). */
export function formatPrefetchStatsMessage(stats) {
  if (!stats?.totalBytes) {
    return 'Данные на устройство не загружены.';
  }
  const total = formatBytes(stats.totalBytes);
  const parts = (stats.items || [])
    .map((i) => `${i.label}: ${formatBytes(i.bytes)}`)
    .join('; ');
  const countHint = stats.entriesCount != null ? `, ${stats.entriesCount} записей` : '';
  return parts
    ? `Данные в кэше: ${total}${countHint} (${parts})`
    : `Данные в кэше: ${total}${countHint}`;
}

export function buildPrefetchStatsFromStorage(storage) {
  return {
    totalBytes: storage.totalBytes,
    entriesCount: storage.entriesCount,
    items: storage.items,
  };
}
