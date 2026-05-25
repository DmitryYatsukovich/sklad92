const PREFETCH_NOTICE_KEY = 'warehouse_prefetch_notice';

export function setPrefetchNotice(stats) {
  try {
    sessionStorage.setItem(PREFETCH_NOTICE_KEY, JSON.stringify(stats));
  } catch {
    /* ignore */
  }
}

export function consumePrefetchNotice() {
  try {
    const raw = sessionStorage.getItem(PREFETCH_NOTICE_KEY);
    sessionStorage.removeItem(PREFETCH_NOTICE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
