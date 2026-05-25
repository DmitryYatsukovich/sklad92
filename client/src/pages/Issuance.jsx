import { useState, useEffect, useMemo, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { materials as materialsApi, operations as operationsApi, isOfflineQueuedError } from '../api';
import FilterDateInput from '../components/FilterDateInput';
import MaterialQrModal from '../components/MaterialQrModal';
import ListPagination from '../components/ListPagination';
import { useListPagination } from '../hooks/useListPagination';
import { usePendingMutations } from '../hooks/usePendingMutations';
import { useReloadOnSyncComplete } from '../hooks/useReloadOnSyncComplete';
import { applyPendingToIssuances, applyPendingToMaterials, withPendingRowClass } from '../lib/actionLog/applyOptimistic';
import { peekPageCache, setPageCache } from '../lib/pageCache';
import { isQuickDeviceEnabled } from '../lib/offlineCache';

const EMPTY_FILTERS = {
  date_from: '',
  date_to: '',
  material: '',
  recipient: '',
  status: '',
};

function parseFilterDate(s) {
  if (!s) return null;
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function issuanceLocalDay(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatSumMoney(n) {
  const s = (Number(n) || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${s} ₽`;
}

function formatSumQty(n) {
  const x = Number(n) || 0;
  return x.toLocaleString('ru-RU', { maximumFractionDigits: 4 });
}

function remainingQty(i) {
  return parseFloat(i.quantity) - parseFloat(i.returned_quantity || 0);
}

function enrichRow(i, materialPrices) {
  const qty = Number(i.quantity) || 0;
  const returned = Number(i.returned_quantity || 0);
  const netQty = Math.max(remainingQty(i), 0);
  const mp = materialPrices.get(i.material_id);
  const unitPrice = mp?.price ?? Number(i.price ?? 0);
  const unitSmr = mp?.production_price ?? Number(i.production_price ?? 0);
  return {
    ...i,
    _qty: qty,
    _returned: returned,
    _netQty: netQty,
    _cost: netQty * unitPrice,
    _smr: netQty * unitSmr,
    _recipient: (i.issued_to_name || i.issued_to_login || '').toLowerCase(),
    _materialSearch: `${i.material_name || ''} ${i.material_code || ''}`.toLowerCase(),
  };
}

function ThWithSum({ label, column, sortBy, sortDir, onSort, sum, sumClassName = 'text-zinc-500' }) {
  const SortIcon = () => {
    if (sortBy !== column) return <span className="opacity-30">↕</span>;
    return sortDir === 'asc' ? <span>↑</span> : <span>↓</span>;
  };
  return (
    <th className="text-right">
      <button
        type="button"
        onClick={() => onSort(column)}
        className="sort-btn gap-0.5 flex flex-col ml-auto items-end"
      >
        <span className="inline-flex items-center gap-0.5">
          {label} <SortIcon />
        </span>
        {sum != null && (
          <span className={`text-2xs font-normal tabular-nums ${sumClassName}`}>
            {sum}
          </span>
        )}
      </button>
    </th>
  );
}

export default function Issuance({ user }) {
  const location = useLocation();
  const [issuances, setIssuances] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [issueUsers, setIssueUsers] = useState([]);
  const pendingMutations = usePendingMutations();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [returnRow, setReturnRow] = useState(null);
  const [returnQuantity, setReturnQuantity] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [qrMaterial, setQrMaterial] = useState(null);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [sortBy, setSortBy] = useState('issued_at');
  const [sortDir, setSortDir] = useState('desc');

  const materialPrices = useMemo(() => {
    const map = new Map();
    for (const m of materials) {
      map.set(m.id, {
        price: Number(m.price ?? 0),
        production_price: Number(m.production_price ?? 0),
      });
    }
    return map;
  }, [materials]);

  const applyBundle = useCallback((bundle) => {
    if (!bundle) return;
    setIssuances(bundle.issuances);
    setMaterials(bundle.materials);
    setIssueUsers(bundle.issueUsers);
  }, []);

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    Promise.all([
      operationsApi.issuances(),
      materialsApi.list(),
      materialsApi.usersForIssuance().catch(() => []),
    ])
      .then(([iss, mats, users]) => {
        const bundle = { issuances: iss, materials: mats, issueUsers: users };
        setPageCache('issuance:bundle', bundle);
        applyBundle(bundle);
      })
      .catch((e) => setError(e.message))
      .finally(() => { if (!silent) setLoading(false); });
  }, [applyBundle]);

  useEffect(() => {
    if (location.pathname !== '/issuance') return undefined;
    let cancelled = false;
    const mem = peekPageCache('issuance:bundle');
    if (mem) {
      applyBundle(mem);
      setLoading(false);
    } else if (isQuickDeviceEnabled()) {
      Promise.all([
        import('../lib/offlineCache/store.js').then((m) => m.getCachedResponse('/api/operations/issuances')),
        import('../lib/offlineCache/store.js').then((m) => m.getCachedResponse('/api/materials')),
      ]).then(([iss, mats]) => {
        if (cancelled) return;
        if (Array.isArray(iss) && iss.length) setIssuances(iss);
        if (Array.isArray(mats) && mats.length) setMaterials(mats);
        if (Array.isArray(iss) || Array.isArray(mats)) setLoading(false);
      });
    }
    load(Boolean(mem));
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') load(true);
    }, 10000);
    const onVisible = () => {
      if (document.visibilityState === 'visible' && location.pathname === '/issuance') {
        load(true);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      cancelled = true;
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [location.pathname, load, applyBundle]);

  useReloadOnSyncComplete(() => load(true));

  const mergedIssuances = useMemo(
    () => applyPendingToIssuances(issuances, pendingMutations, {
      materials: applyPendingToMaterials(materials, pendingMutations, {}),
      issueUsers,
      currentUser: user,
    }),
    [issuances, pendingMutations, materials, issueUsers, user],
  );

  const enriched = useMemo(
    () => mergedIssuances.map((i) => enrichRow(i, materialPrices)),
    [mergedIssuances, materialPrices],
  );

  const hasActiveFilters = Object.values(filters).some(Boolean);

  const filteredList = useMemo(() => enriched.filter((i) => {
    const day = issuanceLocalDay(i.issued_at);
    const from = parseFilterDate(filters.date_from);
    const to = parseFilterDate(filters.date_to);
    if (from && (!day || day < from)) return false;
    if (to && (!day || day > to)) return false;
    if (filters.material) {
      const q = filters.material.toLowerCase();
      if (!i._materialSearch.includes(q)) return false;
    }
    if (filters.recipient) {
      const q = filters.recipient.toLowerCase();
      if (!i._recipient.includes(q)) return false;
    }
    if (filters.status === 'open' && !(i._netQty > 0.000001)) return false;
    if (filters.status === 'closed' && i._netQty > 0.000001) return false;
    return true;
  }), [enriched, filters]);

  const sortedList = useMemo(() => {
    const items = [...filteredList];
    items.sort((a, b) => {
      let va;
      let vb;
      if (sortBy === 'issued_at') {
        va = new Date(a.issued_at || 0).getTime();
        vb = new Date(b.issued_at || 0).getTime();
      } else if (sortBy === 'material') {
        va = (a.material_name || '').toLowerCase();
        vb = (b.material_name || '').toLowerCase();
      } else if (sortBy === 'recipient') {
        va = a._recipient;
        vb = b._recipient;
      } else if (sortBy === 'quantity') {
        va = a._qty;
        vb = b._qty;
      } else if (sortBy === 'cost') {
        va = a._cost;
        vb = b._cost;
      } else if (sortBy === 'smr') {
        va = a._smr;
        vb = b._smr;
      } else {
        va = 0;
        vb = 0;
      }
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return items;
  }, [filteredList, sortBy, sortDir]);

  const totals = useMemo(() => {
    let quantity = 0;
    let cost = 0;
    let smr = 0;
    for (const i of sortedList) {
      quantity += i._qty;
      cost += i._cost;
      smr += i._smr;
    }
    return { quantity, cost, smr };
  }, [sortedList]);

  const paginationResetKey = useMemo(() => JSON.stringify(filters), [filters]);
  const pagination = useListPagination(sortedList, 'issuance-page-size', paginationResetKey);

  const toggleSort = (col) => {
    if (sortBy === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortBy(col);
      setSortDir(col === 'issued_at' ? 'desc' : 'asc');
    }
  };

  const SortIcon = ({ column }) => {
    if (sortBy !== column) return <span className="opacity-30">↕</span>;
    return sortDir === 'asc' ? <span>↑</span> : <span>↓</span>;
  };

  const resetFilters = () => setFilters(EMPTY_FILTERS);

  const exportMeta = useMemo(() => ({
    date_from: filters.date_from || undefined,
    date_to: filters.date_to || undefined,
  }), [filters.date_from, filters.date_to]);

  const handleExport = async (format) => {
    if (!sortedList.length) return setError('Нет данных для выгрузки');
    setExporting(true);
    setError('');
    try {
      const rows = sortedList.map((i) => ({
        issued_at: i.issued_at,
        material_name: i.material_name,
        material_code: i.material_code,
        issued_to_name: i.issued_to_name,
        issued_to_login: i.issued_to_login,
        quantity: i._qty,
        returned_quantity: i._returned,
        unit: i.unit,
        cost: i._cost,
        smr: i._smr,
        net_qty: i._netQty,
      }));
      if (format === 'pdf') await operationsApi.exportPdf(rows, exportMeta);
      else await operationsApi.exportExcel(rows, exportMeta);
    } catch (err) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  };

  const openQr = (row) => {
    if (!row.material_code) return;
    materialsApi
      .byCode(row.material_code)
      .then((m) => setQrMaterial(m))
      .catch(() => setQrMaterial({
        name: row.material_name,
        code: row.material_code,
        unit: row.unit,
        quantity: 0,
        price: row.price ?? 0,
        production_price: row.production_price ?? 0,
      }));
  };

  const openReturn = (row) => {
    const returned = Number(row.returned_quantity || 0);
    setReturnRow(row);
    setReturnQuantity(returned > 0 ? String(returned) : '');
    setError('');
  };

  const closeReturn = () => {
    setReturnRow(null);
    setReturnQuantity('');
  };

  const handleDeleteIssuance = async () => {
    if (!returnRow || user?.role !== 'admin') return;
    if (!window.confirm('Удалить эту выдачу? Невозвращённое количество вернётся на склад.')) return;
    setSubmitting(true);
    setError('');
    try {
      await operationsApi.deleteIssuance(returnRow.id);
      closeReturn();
      load();
    } catch (err) {
      if (isOfflineQueuedError(err)) {
        closeReturn();
        return;
      }
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReturn = async (e) => {
    e.preventDefault();
    if (!returnRow) return;
    const totalReturned = parseFloat(returnQuantity);
    const issued = Number(returnRow.quantity);
    if (Number.isNaN(totalReturned) || totalReturned < 0) {
      return setError('Укажите корректное количество');
    }
    if (totalReturned > issued) {
      return setError(`Не больше выданного: ${issued} ${returnRow.unit}`);
    }
    setSubmitting(true);
    setError('');
    try {
      await operationsApi.setReturnedQuantity(returnRow.id, totalReturned);
      closeReturn();
      load();
    } catch (err) {
      if (isOfflineQueuedError(err)) {
        closeReturn();
        return;
      }
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="page-title">Выдача</h2>
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-2xs text-zinc-500">
            {hasActiveFilters ? `${sortedList.length}/${mergedIssuances.length}` : mergedIssuances.length}
          </span>
          <button
            type="button"
            onClick={() => handleExport('xlsx')}
            disabled={exporting || !sortedList.length}
            className="btn-ghost text-2xs"
            title="Выгрузить отображаемые строки в Excel"
          >
            {exporting ? '…' : 'Excel'}
          </button>
          <button
            type="button"
            onClick={() => handleExport('pdf')}
            disabled={exporting || !sortedList.length}
            className="btn-ghost text-2xs"
            title="Выгрузить отображаемые строки в PDF"
          >
            PDF
          </button>
          <button type="button" onClick={() => load()} className="btn-ghost text-2xs">
            Обновить
          </button>
        </div>
      </div>

      {error && !returnRow && (
        <p className="alert-error">
          {error}
          <button type="button" onClick={() => load()} className="btn-ghost ml-2 text-xs">
            Повторить
          </button>
        </p>
      )}

      {loading && <p className="text-zinc-500 text-xs">Загрузка…</p>}

      <div className="table-wrap">
        <div className="filter-toolbar">
          <div className="filter-field w-[7.5rem]">
            <span className="filter-label">С</span>
            <FilterDateInput
              value={filters.date_from}
              onChange={(e) => setFilters((f) => ({ ...f, date_from: e.target.value }))}
            />
          </div>
          <div className="filter-field w-[7.5rem]">
            <span className="filter-label">По</span>
            <FilterDateInput
              value={filters.date_to}
              onChange={(e) => setFilters((f) => ({ ...f, date_to: e.target.value }))}
            />
          </div>
          <div className="filter-field flex-1 min-w-[6rem]">
            <span className="filter-label">Материал</span>
            <input
              type="text"
              value={filters.material}
              onChange={(e) => setFilters((f) => ({ ...f, material: e.target.value }))}
              className="filter-input"
              placeholder="Название, код"
            />
          </div>
          <div className="filter-field flex-1 min-w-[5rem]">
            <span className="filter-label">Кому выдан</span>
            <input
              type="text"
              value={filters.recipient}
              onChange={(e) => setFilters((f) => ({ ...f, recipient: e.target.value }))}
              className="filter-input"
            />
          </div>
          <div className="filter-field w-24">
            <span className="filter-label">Статус</span>
            <select
              value={filters.status}
              onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
              className="filter-input"
            >
              <option value="">Все</option>
              <option value="open">Не закрыто</option>
              <option value="closed">Закрыто</option>
            </select>
          </div>
          {hasActiveFilters && (
            <button type="button" onClick={resetFilters} className="btn-ghost self-end mb-0.5">
              Сброс
            </button>
          )}
        </div>

        <div className="overflow-x-auto max-h-[calc(100vh-9rem)] overflow-y-auto">
          <table className="table-compact">
            <thead className="sticky top-0 bg-surface-900 z-10">
              <tr>
                <th>
                  <button type="button" onClick={() => toggleSort('issued_at')} className="sort-btn">
                    Дата <SortIcon column="issued_at" />
                  </button>
                </th>
                <th className="w-9 text-center text-zinc-500 text-2xs font-normal">QR</th>
                <th>
                  <button type="button" onClick={() => toggleSort('material')} className="sort-btn">
                    Материал <SortIcon column="material" />
                  </button>
                </th>
                <th>
                  <button type="button" onClick={() => toggleSort('recipient')} className="sort-btn">
                    Кому выдан <SortIcon column="recipient" />
                  </button>
                </th>
                <ThWithSum
                  label="Кол-во"
                  column="quantity"
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onSort={toggleSort}
                  sum={formatSumQty(totals.quantity)}
                />
                <ThWithSum
                  label="Стоимость"
                  column="cost"
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onSort={toggleSort}
                  sum={formatSumMoney(totals.cost)}
                />
                <ThWithSum
                  label="СМР"
                  column="smr"
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onSort={toggleSort}
                  sum={formatSumMoney(totals.smr)}
                />
                <th className="w-24 text-right" />
              </tr>
            </thead>
            <tbody>
              {pagination.paginatedItems.map((i) => {
                const canReturn = i._netQty > 0.000001;
                return (
                  <tr
                    key={i.id}
                    className={withPendingRowClass('', i)}
                    title={i._pending ? 'Ожидает отправки на сервер' : undefined}
                  >
                    <td className="text-zinc-500 text-2xs whitespace-nowrap">{formatDate(i.issued_at)}</td>
                    <td className="text-center p-0.5">
                      {i.material_code ? (
                        <button
                          type="button"
                          onClick={() => openQr(i)}
                          className="inline-flex rounded hover:bg-white/10 p-0.5"
                          title="QR-код"
                        >
                          <QRCodeSVG value={i.material_code} size={28} level="M" className="rounded bg-white p-0.5" />
                        </button>
                      ) : (
                        <span className="text-zinc-600 text-2xs">—</span>
                      )}
                    </td>
                    <td className="text-white max-w-[10rem] truncate font-medium" title={i.material_name}>
                      {i.material_name}
                    </td>
                    <td className="text-zinc-300 max-w-[8rem] truncate" title={i.issued_to_name || i.issued_to_login}>
                      {i.issued_to_name || i.issued_to_login}
                    </td>
                    <td className="text-right tabular-nums">
                      <span className="text-white">{i._qty}</span>
                      <span className="text-zinc-500 text-2xs"> {i.unit}</span>
                      {i._returned > 0 && (
                        <div className="text-2xs text-zinc-500">верн. {i._returned}</div>
                      )}
                    </td>
                    <td className="text-right text-zinc-400 tabular-nums">{i._cost.toFixed(2)}</td>
                    <td className="text-right text-zinc-400 tabular-nums">{i._smr.toFixed(2)}</td>
                    <td className="text-right">
                      {canReturn || i._returned > 0 ? (
                        <button type="button" onClick={() => openReturn(i)} className="btn-ghost px-1 text-xs">
                          {i._returned > 0 ? 'Изменить' : 'Возврат'}
                        </button>
                      ) : (
                        <span className="text-2xs text-zinc-600">закрыто</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <ListPagination {...pagination} />
        {mergedIssuances.length === 0 && !loading && (
          <p className="p-6 text-center text-zinc-500 text-xs">Выдач пока нет</p>
        )}
        {mergedIssuances.length > 0 && sortedList.length === 0 && !loading && (
          <p className="p-6 text-center text-zinc-500 text-xs">Ничего не найдено</p>
        )}
      </div>

      {qrMaterial && (
        <MaterialQrModal material={qrMaterial} onClose={() => setQrMaterial(null)} />
      )}

      {returnRow && (
        <div className="modal-backdrop z-50" onClick={closeReturn}>
          <div className="card p-5 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-white mb-1">Возврат на склад</h3>
            <p className="text-zinc-400 text-xs mb-3">
              {returnRow.material_name} → {returnRow.issued_to_name || returnRow.issued_to_login}
            </p>
            <p className="text-zinc-500 text-xs mb-4">
              Выдано: {Number(returnRow.quantity)} {returnRow.unit}, возвращено: {Number(returnRow.returned_quantity || 0)} {returnRow.unit},
              осталось: <span className="text-white">{remainingQty(returnRow)} {returnRow.unit}</span>
            </p>
            {error && <p className="alert-error mb-3">{error}</p>}
            <form onSubmit={handleReturn} className="space-y-3">
              <div>
                <label className="label">Всего возвращено на склад</label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  max={Number(returnRow.quantity)}
                  value={returnQuantity}
                  onChange={(e) => setReturnQuantity(e.target.value)}
                  className="input"
                  autoFocus
                  required
                />
                <p className="text-2xs text-zinc-500 mt-1">
                  Итоговое количество на складе (0 — без возврата). У получателя остаётся: {remainingQty(returnRow)} {returnRow.unit}
                </p>
              </div>
              <div className="flex gap-2 justify-end flex-wrap">
                {user?.role === 'admin' && (
                  <button
                    type="button"
                    onClick={handleDeleteIssuance}
                    className="px-4 py-2 rounded-xl text-red-400 hover:text-red-300 mr-auto"
                    disabled={submitting}
                  >
                    Удалить
                  </button>
                )}
                <button type="button" onClick={closeReturn} className="btn-ghost" disabled={submitting}>
                  Отмена
                </button>
                <button type="submit" className="btn-primary" disabled={submitting}>
                  {submitting ? '…' : 'Сохранить'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
