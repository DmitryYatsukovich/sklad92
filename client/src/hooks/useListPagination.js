import { useState, useEffect, useMemo } from 'react';

export const PAGE_SIZE_OPTIONS = [20, 50, 100, 500, 1000];

const DEFAULT_PAGE_SIZE = 50;

function readStoredPageSize(storageKey) {
  if (!storageKey) return DEFAULT_PAGE_SIZE;
  try {
    const v = parseInt(localStorage.getItem(storageKey), 10);
    if (PAGE_SIZE_OPTIONS.includes(v)) return v;
  } catch {
    /* ignore */
  }
  return DEFAULT_PAGE_SIZE;
}

/**
 * @param {unknown[]} items
 * @param {string} [storageKey] — ключ localStorage для размера страницы
 * @param {string|number} [resetKey] — при смене (фильтры, период) сброс на стр. 1
 */
export function useListPagination(items, storageKey, resetKey = '') {
  const [pageSize, setPageSizeState] = useState(() => readStoredPageSize(storageKey));
  const [page, setPage] = useState(1);

  const total = items?.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const effectivePage = Math.min(Math.max(1, page), totalPages);

  useEffect(() => {
    setPage(1);
  }, [pageSize, resetKey]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const start = (effectivePage - 1) * pageSize;
  const paginatedItems = useMemo(
    () => (items ?? []).slice(start, start + pageSize),
    [items, start, pageSize],
  );

  const setPageSize = (size) => {
    const n = Number(size);
    if (!PAGE_SIZE_OPTIONS.includes(n)) return;
    setPageSizeState(n);
    if (storageKey) {
      try {
        localStorage.setItem(storageKey, String(n));
      } catch {
        /* ignore */
      }
    }
  };

  return {
    page: effectivePage,
    setPage,
    pageSize,
    setPageSize,
    total,
    totalPages,
    paginatedItems,
    rangeStart: total ? start + 1 : 0,
    rangeEnd: Math.min(start + pageSize, total),
  };
}
