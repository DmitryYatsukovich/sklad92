import { PAGE_SIZE_OPTIONS } from '../hooks/useListPagination';

export default function ListPagination({
  page,
  setPage,
  pageSize,
  setPageSize,
  total,
  totalPages,
  rangeStart,
  rangeEnd,
}) {
  if (!total) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-2 py-2 border-t border-white/10 bg-zinc-900/30 text-2xs text-zinc-400">
      <label className="flex items-center gap-2">
        <span className="text-zinc-500">На странице</span>
        <select
          value={pageSize}
          onChange={(e) => setPageSize(Number(e.target.value))}
          className="rounded border border-white/10 bg-zinc-800 text-white px-1.5 py-0.5 text-2xs"
          aria-label="Строк на странице"
        >
          {PAGE_SIZE_OPTIONS.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <span className="tabular-nums text-zinc-500">
          {rangeStart}–{rangeEnd} из {total}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="btn-ghost px-2 py-0.5 disabled:opacity-30"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
            aria-label="Предыдущая страница"
          >
            ←
          </button>
          <span className="tabular-nums min-w-[4rem] text-center text-zinc-300">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            className="btn-ghost px-2 py-0.5 disabled:opacity-30"
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
            aria-label="Следующая страница"
          >
            →
          </button>
        </div>
      </div>
    </div>
  );
}
