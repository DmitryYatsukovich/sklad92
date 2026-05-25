import { useState, useEffect, useMemo, useCallback } from 'react';
import { reports, isOfflineQueuedError } from '../api';
import FilterDateInput from '../components/FilterDateInput';
import ProductionHistoryModal from '../components/ProductionHistoryModal';
import ProductionConfirmModal from '../components/ProductionConfirmModal';
import ListPagination from '../components/ListPagination';
import { useListPagination } from '../hooks/useListPagination';
import { usePendingMutations } from '../hooks/usePendingMutations';
import { useReloadOnSyncComplete } from '../hooks/useReloadOnSyncComplete';
import { applyPendingToProduction, applyPendingToMaterials, withPendingRowClass } from '../lib/actionLog/applyOptimistic';
import { clearPendingMutationsForDeleteAll, waitForActionLogIdle } from '../lib/actionLog';
import { formatWorkLocationFromSelection } from '../lib/workLocationLabel';
import { materials as materialsApi } from '../api';
import { peekPageCache, setPageCache } from '../lib/pageCache';
import { isQuickDeviceEnabled } from '../lib/offlineCache';

const EMPTY_FILTERS = {
  date_from: '',
  date_to: '',
  material: '',
  user: '',
  status: '',
};

function isObjectRow(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asArrayOfObjects(value) {
  return Array.isArray(value) ? value.filter(isObjectRow) : [];
}

function asText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function normalizeFilterValue(value) {
  return typeof value === 'string' ? value : '';
}

function formatDateInput(d) {
  const x = new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

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

function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatSumMoney(n) {
  return `${(Number(n) || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;
}

function formatSumQty(n) {
  return (Number(n) || 0).toLocaleString('ru-RU', { maximumFractionDigits: 4 });
}

function userLabel(r) {
  const displayName = asText(r?.display_name);
  const first = asText(r?.first_name);
  const last = asText(r?.last_name);
  const login = asText(r?.login);
  return displayName || [first, last].filter(Boolean).join(' ') || login || '—';
}

function enrichRow(r) {
  const source = isObjectRow(r) ? r : {};
  const row = source?._pending != null || source?._pendingCreate != null
    ? (({ _pending, _pendingCreate, ...rest }) => rest)(source)
    : source;
  const produced = Number(row.produced) || 0;
  const unitSmr = Number(row.production_price) || 0;
  const computedSmr = produced * unitSmr;
  const rawSmr = Number(row.smr_total);
  const smrTotal = Number.isFinite(rawSmr) ? rawSmr : computedSmr;
  const materialName = asText(row.material_name);
  const workLocation = asText(row.work_location_label);
  return {
    ...row,
    material_name: materialName,
    unit: asText(row.unit) || 'шт',
    login: asText(row.login),
    display_name: asText(row.display_name),
    first_name: asText(row.first_name),
    last_name: asText(row.last_name),
    work_location_label: workLocation,
    _produced: produced,
    _unitSmr: unitSmr,
    _smrTotal: smrTotal,
    _userSearch: userLabel(row).toLowerCase(),
    _materialSearch: materialName.toLowerCase(),
    _confirmed: !!row.production_confirmed,
    _workLocation: workLocation,
  };
}

function normalizeProductionRows(data) {
  return asArrayOfObjects(data)
    .filter((row) => Number(row?.issuance_id) > 0)
    .map((row) => {
      const issued = Number(row.total_issued) || 0;
      const returned = Number(row.total_returned) || 0;
      return {
        ...row,
        issuance_id: Number(row.issuance_id),
        produced: Math.max(issued - returned, 0),
      };
    });
}

const EMPTY_LOCATIONS = {
  objects: [],
  work_entrances: [],
  work_floors: [],
  work_apartments: [],
  work_rooms: [],
};

function normalizeLocations(value) {
  const src = isObjectRow(value) ? value : {};
  return {
    objects: asArrayOfObjects(src.objects),
    work_entrances: asArrayOfObjects(src.work_entrances),
    work_floors: asArrayOfObjects(src.work_floors),
    work_apartments: asArrayOfObjects(src.work_apartments),
    work_rooms: asArrayOfObjects(src.work_rooms),
  };
}

function ThWithSum({ label, column, sortBy, sortDir, onSort, sum, align = 'right' }) {
  const SortIcon = () => {
    if (sortBy !== column) return <span className="opacity-30">↕</span>;
    return sortDir === 'asc' ? <span>↑</span> : <span>↓</span>;
  };
  return (
    <th className={align === 'right' ? 'text-right' : ''}>
      <button
        type="button"
        onClick={() => onSort(column)}
        className={`sort-btn gap-0.5 flex flex-col ${align === 'right' ? 'ml-auto items-end' : 'items-start'}`}
      >
        <span className="inline-flex items-center gap-0.5">
          {label} <SortIcon />
        </span>
        {sum != null && (
          <span className="text-2xs font-normal tabular-nums text-zinc-500">
            {sum}
          </span>
        )}
      </button>
    </th>
  );
}

export default function Production({ user }) {
  const isAdmin = user?.role === 'admin';
  const today = formatDateInput(new Date());
  const firstDay = formatDateInput(new Date(new Date().getFullYear(), new Date().getMonth(), 1));

  const [periodFrom, setPeriodFrom] = useState(formatDateInput(firstDay));
  const [periodTo, setPeriodTo] = useState(today);
  const [rows, setRows] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [issueUsers, setIssueUsers] = useState([]);
  const pendingMutations = usePendingMutations();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [sortBy, setSortBy] = useState('issued_at');
  const [sortDir, setSortDir] = useState('desc');
  const [confirmingId, setConfirmingId] = useState(null);
  const [deletingAll, setDeletingAll] = useState(false);
  const [locationModal, setLocationModal] = useState(null);
  const [historyRow, setHistoryRow] = useState(null);
  const [locations, setLocations] = useState(EMPTY_LOCATIONS);

  const loadLocations = useCallback(() => {
    reports.productionLocations().then((data) => setLocations(normalizeLocations(data))).catch(() => {});
  }, []);

  useEffect(() => {
    loadLocations();
    Promise.all([
      materialsApi.list().catch(() => []),
      materialsApi.usersForIssuance().catch(() => []),
    ]).then(([mats, users]) => {
      setMaterials(asArrayOfObjects(mats));
      setIssueUsers(asArrayOfObjects(users));
    });
  }, [loadLocations]);

  const productionCacheKey = `production:${periodFrom}:${periodTo}`;
  const productionOfflinePath = `/api/reports/production?from=${encodeURIComponent(periodFrom)}&to=${encodeURIComponent(periodTo)}`;

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    reports
      .production(periodFrom, periodTo)
      .then((data) => {
        const mapped = asArrayOfObjects(normalizeProductionRows(data).map(enrichRow));
        setRows(mapped);
        setPageCache(productionCacheKey, mapped);
      })
      .catch((e) => {
        setError(e.message);
        setRows([]);
      })
      .finally(() => { if (!silent) setLoading(false); });
  }, [periodFrom, periodTo, productionCacheKey]);

  useReloadOnSyncComplete(() => {
    load(true);
    materialsApi.list().then((mats) => setMaterials(asArrayOfObjects(mats))).catch(() => {});
  });

  useEffect(() => {
    let cancelled = false;
    const mem = peekPageCache(productionCacheKey);
    const memRows = asArrayOfObjects(mem);
    if (memRows.length) {
      setRows(memRows.map(enrichRow));
      setLoading(false);
    } else if (isQuickDeviceEnabled()) {
      import('../lib/offlineCache/store.js').then((m) => (
        m.getCachedResponse(productionOfflinePath)
      )).then((cached) => {
        const safeCached = asArrayOfObjects(cached);
        if (cancelled || !safeCached.length) return;
        const mapped = asArrayOfObjects(normalizeProductionRows(safeCached).map(enrichRow));
        setRows(mapped);
        setPageCache(productionCacheKey, mapped);
        setLoading(false);
      });
    }
    load(Boolean(memRows.length));
    return () => { cancelled = true; };
  }, [load, productionCacheKey, productionOfflinePath]);

  const hasActiveFilters = Boolean(
    normalizeFilterValue(filters.material)
    || normalizeFilterValue(filters.user)
    || normalizeFilterValue(filters.status)
    || (normalizeFilterValue(filters.date_from) && normalizeFilterValue(filters.date_from) !== periodFrom)
    || (normalizeFilterValue(filters.date_to) && normalizeFilterValue(filters.date_to) !== periodTo),
  );

  const displayRows = useMemo(
    () => asArrayOfObjects(applyPendingToProduction(rows, pendingMutations, {
      materials: applyPendingToMaterials(materials, pendingMutations, {}),
      issueUsers,
      locations,
      periodFrom,
      periodTo,
      currentUser: user,
      isAdmin,
    }).map((r) => enrichRow(r))),
    [rows, pendingMutations, materials, issueUsers, locations, periodFrom, periodTo, user, isAdmin],
  );

  const filteredList = useMemo(() => {
    const filtersSafe = {
      date_from: normalizeFilterValue(filters.date_from),
      date_to: normalizeFilterValue(filters.date_to),
      material: normalizeFilterValue(filters.material),
      user: normalizeFilterValue(filters.user),
      status: normalizeFilterValue(filters.status),
    };
    const fromD = parseFilterDate(filtersSafe.date_from || periodFrom);
    const toD = parseFilterDate(filtersSafe.date_to || periodTo);
    return displayRows.filter((r) => {
      const day = issuanceLocalDay(r.issued_at);
      if (fromD && day && day < fromD) return false;
      if (toD && day && day > toD) return false;
      if (filtersSafe.material && !r._materialSearch.includes(filtersSafe.material.trim().toLowerCase())) return false;
      if (isAdmin && filtersSafe.user && !r._userSearch.includes(filtersSafe.user.trim().toLowerCase())) return false;
      if (filtersSafe.status === 'confirmed' && !r._confirmed) return false;
      if (filtersSafe.status === 'pending' && r._confirmed) return false;
      return true;
    });
  }, [displayRows, filters, periodFrom, periodTo, isAdmin]);

  const sortedList = useMemo(() => {
    const list = [...filteredList];
    const dir = sortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      let va;
      let vb;
      switch (sortBy) {
        case 'user':
          va = a._userSearch;
          vb = b._userSearch;
          return va.localeCompare(vb, 'ru') * dir;
        case 'material':
          va = a.material_name || '';
          vb = b.material_name || '';
          return va.localeCompare(vb, 'ru') * dir;
        case 'issued':
          va = Number(a.total_issued);
          vb = Number(b.total_issued);
          break;
        case 'returned':
          va = Number(a.total_returned);
          vb = Number(b.total_returned);
          break;
        case 'produced':
          va = a._produced;
          vb = b._produced;
          break;
        case 'production_price':
          va = a._unitSmr;
          vb = b._unitSmr;
          break;
        case 'smr_total':
          va = a._smrTotal;
          vb = b._smrTotal;
          break;
        case 'status':
          va = a._confirmed ? 1 : 0;
          vb = b._confirmed ? 1 : 0;
          break;
        case 'issued_at':
        default:
          va = new Date(a.issued_at).getTime();
          vb = new Date(b.issued_at).getTime();
          break;
      }
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
    return list;
  }, [filteredList, sortBy, sortDir]);

  const totals = useMemo(() => {
    let produced = 0;
    let smr = 0;
    for (const r of sortedList) {
      produced += r._produced;
      smr += r._smrTotal;
    }
    return { produced, smr };
  }, [sortedList]);

  const paginationResetKey = useMemo(
    () => `${periodFrom}|${periodTo}|${
      [
        normalizeFilterValue(filters.date_from),
        normalizeFilterValue(filters.date_to),
        normalizeFilterValue(filters.material),
        normalizeFilterValue(filters.user),
        normalizeFilterValue(filters.status),
      ].join('|')
    }`,
    [periodFrom, periodTo, filters],
  );
  const pagination = useListPagination(sortedList, 'production-page-size', paginationResetKey);

  const toggleSort = (col) => {
    if (sortBy === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortBy(col);
      setSortDir(col === 'issued_at' ? 'desc' : 'asc');
    }
  };

  const handleUnconfirm = async (row) => {
    setConfirmingId(row.issuance_id);
    setError('');
    try {
      await reports.unconfirmProduction(row.issuance_id);
      setRows((prev) => prev.map((r) => (
        r.issuance_id === row.issuance_id
          ? enrichRow({
            ...r,
            production_confirmed: false,
            work_room_id: null,
            work_location_label: '',
            room_name: null,
            apartment_name: null,
            floor_name: null,
            entrance_name: null,
            object_name: null,
          })
          : r
      )));
    } catch (e) {
      if (isOfflineQueuedError(e)) {
        setRows((prev) => prev.map((r) => (
          r.issuance_id === row.issuance_id
            ? enrichRow({ ...r, production_confirmed: false, _pending: true })
            : r
        )));
      } else {
        setError(e.message);
      }
    } finally {
      setConfirmingId(null);
    }
  };

  const handleLocationSubmit = async (location) => {
    if (!locationModal) return;
    const { row, mode } = locationModal;
    setConfirmingId(row.issuance_id);
    setError('');
    try {
      if (mode === 'confirm') {
        const res = await reports.confirmProduction(row.issuance_id, location);
        setRows((prev) => prev.map((r) => (
          r.issuance_id === row.issuance_id
            ? enrichRow({
              ...r,
              production_confirmed: true,
              work_location_label: res.work_location_label,
              work_object_id: location.object_id,
              work_location_items: {
                entrance_ids: location.entrance_ids,
                floor_ids: location.floor_ids,
                apartment_ids: location.apartment_ids,
                room_ids: location.room_ids,
              },
            })
            : r
        )));
      } else {
        const res = await reports.setProductionLocation(row.issuance_id, location);
        setRows((prev) => prev.map((r) => (
          r.issuance_id === row.issuance_id
            ? enrichRow({
              ...r,
              work_location_label: res.work_location_label,
              work_object_id: location.object_id,
              work_location_items: {
                entrance_ids: location.entrance_ids,
                floor_ids: location.floor_ids,
                apartment_ids: location.apartment_ids,
                room_ids: location.room_ids,
              },
            })
            : r
        )));
      }
      setLocationModal(null);
    } catch (e) {
      if (isOfflineQueuedError(e)) {
        const label = formatWorkLocationFromSelection(locations, location.object_id, {
          entrance_ids: location.entrance_ids || [],
          floor_ids: location.floor_ids || [],
          apartment_ids: location.apartment_ids || [],
          room_ids: location.room_ids || [],
        });
        setRows((prev) => prev.map((r) => {
          if (r.issuance_id !== row.issuance_id) return r;
          return enrichRow({
            ...r,
            production_confirmed: mode === 'confirm' ? true : r.production_confirmed,
            work_location_label: label,
            work_object_id: location.object_id,
            work_location_items: {
              entrance_ids: location.entrance_ids,
              floor_ids: location.floor_ids,
              apartment_ids: location.apartment_ids,
              room_ids: location.room_ids,
            },
            _pending: true,
          });
        }));
        setLocationModal(null);
      } else {
        setError(e.message);
      }
    } finally {
      setConfirmingId(null);
    }
  };

  const handleDeleteAllProduction = async () => {
    if (!isAdmin) return;
    if (!displayRows.length) {
      setError('Нет выработки для удаления в выбранном периоде');
      return;
    }
    const ok = window.confirm(
      `Удалить всю выработку за период ${periodFrom} — ${periodTo}? `
      + `Будут удалены все выдачи в этом периоде (${displayRows.length}), остатки вернутся на склад.`,
    );
    if (!ok) return;

    setDeletingAll(true);
    setError('');
    try {
      await waitForActionLogIdle();
      await clearPendingMutationsForDeleteAll();
      await waitForActionLogIdle();
      await reports.deleteAllProduction(periodFrom, periodTo);
      await clearPendingMutationsForDeleteAll();
      setHistoryRow(null);
      setLocationModal(null);
      setRows([]);
      load();
    } catch (e) {
      if (isOfflineQueuedError(e)) {
        setRows([]);
        return;
      }
      setError(e.message || 'Ошибка удаления выработки');
    } finally {
      setDeletingAll(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="page-title">Выработка</h2>
          <p className="text-zinc-500 text-xs mt-0.5">
            {isAdmin
              ? 'Подтверждение с указанием места проведения работ. Пользователи могут указать место до подтверждения.'
              : 'Ваши выдачи за период. Укажите место проведения работ — администратор увидит его при подтверждении.'}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-2xs text-zinc-500">
            {hasActiveFilters ? `${sortedList.length}/${displayRows.length}` : displayRows.length}
          </span>
          {isAdmin && (
            <button
              type="button"
              onClick={handleDeleteAllProduction}
              disabled={deletingAll || !displayRows.length}
              className="btn-ghost text-2xs text-red-400 hover:text-red-300 disabled:text-zinc-600"
            >
              {deletingAll ? 'Удаление…' : 'Удалить все'}
            </button>
          )}
          <button type="button" onClick={load} className="btn-ghost text-2xs">
            Обновить
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div>
          <span className="filter-label">Период с</span>
          <input
            type="date"
            value={periodFrom}
            onChange={(e) => setPeriodFrom(e.target.value)}
            className="filter-input w-[9rem]"
          />
        </div>
        <div>
          <span className="filter-label">по</span>
          <input
            type="date"
            value={periodTo}
            onChange={(e) => setPeriodTo(e.target.value)}
            className="filter-input w-[9rem]"
          />
        </div>
        <button type="button" onClick={load} disabled={loading} className="btn-primary text-2xs mb-0.5">
          {loading ? '…' : 'Показать'}
        </button>
      </div>

      {error && <p className="alert-error">{error}</p>}

      {loading && rows.length === 0 && <p className="text-zinc-500 text-xs">Загрузка…</p>}

      <div className="table-wrap">
        <div className="filter-toolbar">
          <div className="filter-field w-[7.5rem]">
            <span className="filter-label">С</span>
            <FilterDateInput
              value={filters.date_from}
              onChange={(e) => setFilters((f) => ({ ...f, date_from: e.target.value }))}
              placeholder={periodFrom}
            />
          </div>
          <div className="filter-field w-[7.5rem]">
            <span className="filter-label">По</span>
            <FilterDateInput
              value={filters.date_to}
              onChange={(e) => setFilters((f) => ({ ...f, date_to: e.target.value }))}
              placeholder={periodTo}
            />
          </div>
          {isAdmin && (
            <div className="filter-field min-w-[8rem] flex-1">
              <span className="filter-label">Пользователь</span>
              <input
                type="text"
                value={filters.user}
                onChange={(e) => setFilters((f) => ({ ...f, user: e.target.value }))}
                placeholder="Фильтр…"
                className="filter-input"
              />
            </div>
          )}
          <div className="filter-field min-w-[8rem] flex-1">
            <span className="filter-label">Материал</span>
            <input
              type="text"
              value={filters.material}
              onChange={(e) => setFilters((f) => ({ ...f, material: e.target.value }))}
              placeholder="Фильтр…"
              className="filter-input"
            />
          </div>
          <div className="filter-field w-[8rem]">
            <span className="filter-label">Статус</span>
            <select
              value={filters.status}
              onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
              className="filter-input"
            >
              <option value="">Все</option>
              <option value="pending">Не подтверждено</option>
              <option value="confirmed">Подтверждено</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-surface-900 z-10">
              <tr className="border-b border-white/10 text-zinc-400">
                <th className="p-2 font-medium">
                  <button type="button" onClick={() => toggleSort('issued_at')} className="sort-btn">
                    Дата <span className="opacity-50">{sortBy === 'issued_at' ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}</span>
                  </button>
                </th>
                <th className="p-2 font-medium">
                  <button type="button" onClick={() => toggleSort('user')} className="sort-btn">
                    Пользователь <span className="opacity-50">{sortBy === 'user' ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}</span>
                  </button>
                </th>
                <th className="p-2 font-medium">
                  <button type="button" onClick={() => toggleSort('material')} className="sort-btn">
                    Материал <span className="opacity-50">{sortBy === 'material' ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}</span>
                  </button>
                </th>
                <ThWithSum label="Выдано" column="issued" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                <ThWithSum label="Возврат" column="returned" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                <ThWithSum
                  label="Выработка"
                  column="produced"
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onSort={toggleSort}
                  sum={formatSumQty(totals.produced)}
                />
                <ThWithSum label="СМР/ед." column="production_price" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                <ThWithSum
                  label="СМР"
                  column="smr_total"
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onSort={toggleSort}
                  sum={formatSumMoney(totals.smr)}
                />
                <th className="p-2 font-medium min-w-[10rem]">Место работ</th>
                <th className="p-2 font-medium">
                  <button type="button" onClick={() => toggleSort('status')} className="sort-btn">
                    Статус <span className="opacity-50">{sortBy === 'status' ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}</span>
                  </button>
                </th>
                <th className="p-2 font-medium w-32" />
              </tr>
            </thead>
            <tbody>
              {sortedList.map((r) => (
                <tr
                  key={r.issuance_id}
                  className={withPendingRowClass('border-b border-white/5 hover:bg-white/[0.02]', r)}
                  title={r._pending ? 'Ожидает отправки на сервер' : undefined}
                >
                  <td className="p-2 text-zinc-400 whitespace-nowrap">{formatDateTime(r.issued_at)}</td>
                  <td className="p-2 text-white">{userLabel(r)}</td>
                  <td className="p-2">
                    <button
                      type="button"
                      onClick={() => setHistoryRow(r)}
                      className="text-left text-white hover:text-brand-300 underline decoration-white/20 underline-offset-2"
                      title="История изменений выработки"
                    >
                      {r.material_name}
                    </button>
                  </td>
                  <td className="p-2 text-right tabular-nums text-zinc-300">
                    {formatSumQty(r.total_issued)} {r.unit}
                  </td>
                  <td className="p-2 text-right tabular-nums text-zinc-400">
                    {formatSumQty(r.total_returned)} {r.unit}
                  </td>
                  <td className="p-2 text-right tabular-nums font-medium text-brand-300">
                    {formatSumQty(r._produced)} {r.unit}
                  </td>
                  <td className="p-2 text-right tabular-nums text-zinc-400">
                    {formatSumMoney(r._unitSmr)}
                  </td>
                  <td className="p-2 text-right tabular-nums text-zinc-300">
                    {formatSumMoney(r._smrTotal)}
                  </td>
                  <td className="p-2 text-zinc-400 text-2xs max-w-[14rem] truncate" title={r._workLocation}>
                    {r._workLocation || '—'}
                  </td>
                  <td className="p-2">
                    {r._confirmed ? (
                      <span className="text-emerald-400">Подтверждено</span>
                    ) : (
                      <span className="text-amber-400/90">Не подтверждено</span>
                    )}
                  </td>
                  <td className="p-2 text-right whitespace-nowrap">
                    {!r._confirmed && (
                      <button
                        type="button"
                        disabled={confirmingId === r.issuance_id}
                        onClick={() => setLocationModal({ row: r, mode: 'assign' })}
                        className="btn-ghost text-2xs text-sky-400"
                      >
                        {r._workLocation ? 'Изм. место' : 'Указать место'}
                      </button>
                    )}
                    {isAdmin && !r._confirmed && (
                      <button
                        type="button"
                        disabled={confirmingId === r.issuance_id}
                        onClick={() => setLocationModal({ row: r, mode: 'confirm' })}
                        className="btn-ghost text-2xs text-brand-400 ml-1"
                      >
                        Подтвердить
                      </button>
                    )}
                    {isAdmin && r._confirmed && (
                      <button
                        type="button"
                        disabled={confirmingId === r.issuance_id}
                        onClick={() => handleUnconfirm(r)}
                        className="btn-ghost text-2xs text-zinc-400"
                      >
                        Снять
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ListPagination {...pagination} />
        {displayRows.length === 0 && !loading && (
          <p className="p-6 text-center text-zinc-500 text-xs">Нет выдач за выбранный период</p>
        )}
        {displayRows.length > 0 && sortedList.length === 0 && !loading && (
          <p className="p-6 text-center text-zinc-500 text-xs">Ничего не найдено по фильтрам</p>
        )}
      </div>

      {locationModal && (
        <ProductionConfirmModal
          row={locationModal.row}
          mode={locationModal.mode}
          catalog={locations}
          onSubmit={handleLocationSubmit}
          onClose={() => setLocationModal(null)}
          saving={confirmingId === locationModal.row.issuance_id}
        />
      )}

      {historyRow && (
        <ProductionHistoryModal
          row={historyRow}
          currentUser={user}
          periodFrom={periodFrom}
          periodTo={periodTo}
          onClose={() => setHistoryRow(null)}
        />
      )}
    </div>
  );
}
