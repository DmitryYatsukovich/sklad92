import { idbGetAll } from './db.js';
import { META_ID } from './constants.js';
import { idbGet } from './db.js';

export function formatBytes(n) {
  const num = Number(n) || 0;
  if (num < 1024) return `${num} Б`;
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} КБ`;
  return `${(num / 1024 / 1024).toFixed(2)} МБ`;
}

function estimateBytes(value) {
  if (value == null) return 0;
  try {
    return new Blob([JSON.stringify(value)]).size;
  } catch {
    return 0;
  }
}

function sectionForPath(path) {
  if (!path) return 'прочее';
  if (path.startsWith('/api/materials')) {
    if (path.includes('/by-code/')) return 'QR материалов';
    if (path.includes('/parts')) return 'части материалов';
    if (path === '/api/materials') return 'материалы';
    return 'материалы';
  }
  if (path.startsWith('/api/settings/catalog')) return 'справочник';
  if (path.includes('users-for-issuance')) return 'получатели';
  if (path.startsWith('/api/operations')) return 'выдачи';
  if (path.includes('/production/locations')) return 'адреса работ';
  if (path.startsWith('/api/reports/production')) return 'выработка';
  if (path.includes('/attendance/timesheet')) return 'табель';
  if (path.startsWith('/api/actions')) return 'действия';
  if (path === '/api/auth/me') return 'профиль';
  return 'прочее';
}

let sizeCache = null;
let sizeCacheAt = 0;
const SIZE_CACHE_MS = 30_000;

/** Оценка объёма кэша в IndexedDB (данные приложения). */
export async function measureOfflineCacheSize({ force = false } = {}) {
  if (!force && sizeCache && Date.now() - sizeCacheAt < SIZE_CACHE_MS) {
    return sizeCache;
  }
  const entries = await idbGetAll('entries');
  const meta = await idbGet('meta', META_ID);
  const bySection = {};
  let entriesBytes = 0;

  for (const row of entries) {
    const bytes = estimateBytes(row);
    entriesBytes += bytes;
    const section = sectionForPath(row.path);
    if (!bySection[section]) bySection[section] = { label: section, bytes: 0, count: 0 };
    bySection[section].bytes += bytes;
    bySection[section].count += 1;
  }

  const metaBytes = estimateBytes(meta);
  let actionsLogBytes = 0;
  try {
    const { listLocalActions } = await import('../actionLog/store.js');
    const actions = await listLocalActions();
    actionsLogBytes = estimateBytes(actions);
    if (actionsLogBytes > 0) {
      bySection['журнал (локальный)'] = {
        label: 'журнал (локальный)',
        bytes: actionsLogBytes,
        count: actions.length,
      };
    }
  } catch {
    /* ignore */
  }

  const items = Object.values(bySection)
    .filter((i) => i.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes);

  const totalBytes = entriesBytes + metaBytes + actionsLogBytes;
  sizeCache = {
    totalBytes,
    entriesBytes,
    metaBytes,
    actionsLogBytes,
    entriesCount: entries.length,
    items,
  };
  sizeCacheAt = Date.now();
  return sizeCache;
}

export function invalidateOfflineCacheSizeCache() {
  sizeCache = null;
  sizeCacheAt = 0;
}
