import { useState, useEffect, useMemo, useRef } from 'react';
import { materials as materialsApi, settings as settingsApi } from '../api';
import QrScanner from '../components/QrScanner';
import { QRCodeSVG } from 'qrcode.react';
import { operations } from '../api';
import MaterialLocationFields from '../components/MaterialLocationFields';
import MaterialQuantityHistory from '../components/MaterialQuantityHistory';
import {
  UNITS, emptyMaterialForm, materialToForm, formToPayload, locationLabel, formatUpdatedAt,
} from '../lib/materialForm';

const EMPTY_FILTERS = {
  code: '',
  name: '',
  object_id: '',
  warehouse_id: '',
  rack_id: '',
  category_id: '',
  unit: '',
  stock: '',
};

const NUMERIC_SORT_COLS = new Set(['price', 'production_price', 'quantity']);

const filterInputCls = 'filter-input';

export default function Warehouse({ user }) {
  const [list, setList] = useState([]);
  const [catalog, setCatalog] = useState({ objects: [], warehouses: [], racks: [], categories: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyMaterialForm());
  const [showScan, setShowScan] = useState(false);
  const [activeMaterial, setActiveMaterial] = useState(null);
  const [activeStep, setActiveStep] = useState(null); // 'menu' | 'add' | 'issue'
  const [addQtyAmount, setAddQtyAmount] = useState('');
  const [issueQty, setIssueQty] = useState('');
  const [issueToUserId, setIssueToUserId] = useState('');
  const [users, setUsers] = useState([]);
  const [showQrMaterial, setShowQrMaterial] = useState(null);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [sortBy, setSortBy] = useState('name');
  const [sortDir, setSortDir] = useState('asc');
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [info, setInfo] = useState('');
  const [historyMaterial, setHistoryMaterial] = useState(null);
  const fileInputRef = useRef(null);

  const load = () => {
    setLoading(true);
    materialsApi.list().then(setList).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };

  const loadCatalog = () => {
    settingsApi.catalog().then(setCatalog).catch(() => {});
  };

  useEffect(() => {
    load();
    loadCatalog();
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      materialsApi.list().then(setList).catch(() => {});
    }, 5000);
    return () => clearInterval(t);
  }, []);

  const openAdd = () => {
    setForm(emptyMaterialForm());
    setShowAdd(true);
    setEditing(null);
    setError('');
    loadCatalog();
  };

  const openEdit = (m) => {
    setForm(materialToForm(m));
    setEditing(m);
    setShowAdd(false);
    setError('');
    loadCatalog();
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await materialsApi.create(formToPayload(form, { includeQuantity: true }));
      setForm(emptyMaterialForm());
      setShowAdd(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleEdit = async (e) => {
    e.preventDefault();
    if (!editing) return;
    setError('');
    try {
      await materialsApi.update(editing.id, formToPayload(form));
      setEditing(null);
      setForm(emptyMaterialForm());
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const loadUsers = () => {
    materialsApi.usersForIssuance().then(setUsers).catch(() => setUsers([]));
  };

  const openMaterialMenu = (m) => {
    setActiveMaterial(m);
    setActiveStep('menu');
    setAddQtyAmount('');
    setIssueQty('');
    setIssueToUserId('');
    setError('');
    loadUsers();
  };

  const closeMaterialAction = () => {
    setActiveMaterial(null);
    setActiveStep(null);
    setAddQtyAmount('');
    setIssueQty('');
    setIssueToUserId('');
  };

  const handleAddQuantity = async (e) => {
    e.preventDefault();
    if (!activeMaterial) return;
    const amount = parseFloat(addQtyAmount);
    if (!(amount > 0)) return setError('Укажите количество');
    setError('');
    try {
      await materialsApi.addQuantity(activeMaterial.id, amount);
      closeMaterialAction();
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleIssue = async (e) => {
    e.preventDefault();
    if (!activeMaterial) return;
    const qty = parseFloat(issueQty);
    if (!(qty > 0)) return setError('Укажите количество');
    if (!issueToUserId) return setError('Выберите получателя');
    setError('');
    try {
      await operations.issue({
        material_id: activeMaterial.id,
        issued_to_user_id: parseInt(issueToUserId, 10),
        quantity: qty,
      });
      closeMaterialAction();
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleScan = (decoded) => {
    const code = (decoded || '').trim();
    if (!code) return;
    materialsApi
      .byCode(code)
      .then((m) => {
        setShowScan(false);
        openMaterialMenu(m);
      })
      .catch(() => setError('Материал не найден'));
  };

  const closeScan = () => {
    setShowScan(false);
    closeMaterialAction();
    setError('');
  };

  const warehousesForFilter = useMemo(() => {
    if (!filters.object_id) return catalog.warehouses;
    const oid = Number(filters.object_id);
    return catalog.warehouses.filter((w) => w.object_id === oid);
  }, [catalog.warehouses, filters.object_id]);

  const racksForFilter = useMemo(() => {
    if (!filters.warehouse_id) return catalog.racks;
    const wid = Number(filters.warehouse_id);
    return catalog.racks.filter((r) => r.warehouse_id === wid);
  }, [catalog.racks, filters.warehouse_id]);

  const hasActiveFilters = Object.values(filters).some(Boolean);

  const filteredList = useMemo(() => list.filter((m) => {
    if (filters.code && !(m.code || '').toLowerCase().includes(filters.code.toLowerCase())) return false;
    if (filters.name && !(m.name || '').toLowerCase().includes(filters.name.toLowerCase())) return false;
    if (filters.object_id && String(m.object_id) !== filters.object_id) return false;
    if (filters.warehouse_id && String(m.warehouse_id) !== filters.warehouse_id) return false;
    if (filters.rack_id && String(m.rack_id) !== filters.rack_id) return false;
    if (filters.category_id && String(m.category_id) !== filters.category_id) return false;
    if (filters.unit && !(m.unit || '').toLowerCase().includes(filters.unit.toLowerCase())) return false;
    if (filters.stock === 'zero' && Number(m.quantity) !== 0) return false;
    if (filters.stock === 'positive' && !(Number(m.quantity) > 0)) return false;
    return true;
  }), [list, filters]);

  const sortedList = useMemo(() => {
    const items = [...filteredList];
    if (!sortBy) return items;
    items.sort((a, b) => {
      let va;
      let vb;
      if (sortBy === 'location') {
        va = locationLabel(a).toLowerCase();
        vb = locationLabel(b).toLowerCase();
      } else if (sortBy === 'updated_at') {
        va = new Date(a.updated_at || 0).getTime();
        vb = new Date(b.updated_at || 0).getTime();
      } else if (NUMERIC_SORT_COLS.has(sortBy)) {
        va = Number(a[sortBy]) || 0;
        vb = Number(b[sortBy]) || 0;
      } else {
        va = (a[sortBy] ?? '').toString().toLowerCase();
        vb = (b[sortBy] ?? '').toString().toLowerCase();
      }
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return items;
  }, [filteredList, sortBy, sortDir]);

  const toggleSort = (col) => {
    if (sortBy === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortBy(col);
      setSortDir('asc');
    }
  };

  const SortIcon = ({ column }) => {
    if (sortBy !== column) return <span className="opacity-30">↕</span>;
    return sortDir === 'asc' ? <span>↑</span> : <span>↓</span>;
  };

  const resetFilters = () => setFilters(EMPTY_FILTERS);

  const onFilterObject = (objectId) => {
    setFilters((f) => {
      const wh = objectId
        ? catalog.warehouses.filter((w) => String(w.object_id) === objectId)
        : catalog.warehouses;
      const keepWh = wh.some((w) => String(w.id) === f.warehouse_id);
      const rackList = keepWh && f.warehouse_id
        ? catalog.racks.filter((r) => String(r.warehouse_id) === f.warehouse_id)
        : [];
      const keepRack = rackList.some((r) => String(r.id) === f.rack_id);
      return {
        ...f,
        object_id: objectId,
        warehouse_id: keepWh ? f.warehouse_id : '',
        rack_id: keepRack ? f.rack_id : '',
      };
    });
  };

  const onFilterWarehouse = (warehouseId) => {
    setFilters((f) => {
      const rackList = warehouseId
        ? catalog.racks.filter((r) => String(r.warehouse_id) === warehouseId)
        : [];
      const keepRack = rackList.some((r) => String(r.id) === f.rack_id);
      return { ...f, warehouse_id: warehouseId, rack_id: keepRack ? f.rack_id : '' };
    });
  };

  const handleDownloadTemplate = () => {
    setError('');
    setInfo('');
    materialsApi.downloadImportTemplate().catch((e) => setError(e.message));
  };

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImporting(true);
    setError('');
    setInfo('');
    try {
      const result = await materialsApi.importExcel(file);
      const parts = [];
      if (result.created) parts.push(`добавлено: ${result.created}`);
      if (result.updated) parts.push(`обновлено: ${result.updated}`);
      if (result.errors?.length) {
        const msg = result.errors.slice(0, 5).map((x) => `стр. ${x.row}: ${x.error}`).join('; ');
        parts.push(`ошибки (${result.errors.length}): ${msg}${result.errors.length > 5 ? '…' : ''}`);
      }
      if (parts.length === 0) parts.push('Нет изменений');
      if (result.errors?.length) setError(parts.filter((p) => p.startsWith('ошибки')).join('. ') || 'Импорт с ошибками');
      else setError('');
      setInfo(parts.filter((p) => !p.startsWith('ошибки')).join('. ') || parts.join('. '));
      load();
    } catch (err) {
      setError(err.message);
      setInfo('');
    } finally {
      setImporting(false);
    }
  };

  const handleExport = async (format) => {
    if (!sortedList.length) return setError('Нет данных для выгрузки');
    setExporting(true);
    setError('');
    setInfo('');
    try {
      if (format === 'pdf') await materialsApi.exportPdf(sortedList);
      else await materialsApi.exportExcel(sortedList);
    } catch (err) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return <div className="text-zinc-500 text-xs">Загрузка…</div>;
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="page-title shrink-0">Склад</h2>
          <span className="text-2xs text-zinc-500">
            {hasActiveFilters ? `${sortedList.length}/${list.length}` : list.length}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {hasActiveFilters && (
            <button type="button" onClick={resetFilters} className="btn-ghost">
              Сброс
            </button>
          )}
          <button type="button" onClick={handleDownloadTemplate} className="btn-ghost" title="Скачать шаблон Excel">
            Шаблон
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="btn-ghost"
            title="Загрузить из Excel"
          >
            {importing ? '…' : 'Импорт'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={handleImportFile}
          />
          <button
            type="button"
            onClick={() => handleExport('xlsx')}
            disabled={exporting || !sortedList.length}
            className="btn-ghost"
            title="Выгрузить отображаемые строки в Excel"
          >
            Excel
          </button>
          <button
            type="button"
            onClick={() => handleExport('pdf')}
            disabled={exporting || !sortedList.length}
            className="btn-ghost"
            title="Выгрузить отображаемые строки в PDF"
          >
            PDF
          </button>
          <button
            type="button"
            onClick={() => { closeMaterialAction(); setShowScan(true); setError(''); }}
            className="btn-primary"
          >
            QR
          </button>
          <button type="button" onClick={openAdd} className="btn-secondary">
            + Материал
          </button>
        </div>
      </div>

      {error && <p className="alert-error">{error}</p>}
      {info && <p className="alert-info">{info}</p>}

      <div className="table-wrap">
        <div className="filter-toolbar">
          <div className="filter-field w-16">
            <span className="filter-label">Код</span>
            <input
              type="text"
              value={filters.code}
              onChange={(e) => setFilters((f) => ({ ...f, code: e.target.value }))}
              className={filterInputCls}
            />
          </div>
          <div className="filter-field flex-1 min-w-[6rem]">
            <span className="filter-label">Название</span>
            <input
              type="text"
              value={filters.name}
              onChange={(e) => setFilters((f) => ({ ...f, name: e.target.value }))}
              className={filterInputCls}
            />
          </div>
          <div className="filter-field w-20">
            <span className="filter-label">Объект</span>
            <select value={filters.object_id} onChange={(e) => onFilterObject(e.target.value)} className={filterInputCls}>
              <option value="">—</option>
              {catalog.objects.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>
          <div className="filter-field w-20">
            <span className="filter-label">Склад</span>
            <select value={filters.warehouse_id} onChange={(e) => onFilterWarehouse(e.target.value)} className={filterInputCls}>
              <option value="">—</option>
              {warehousesForFilter.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>
          <div className="filter-field w-20">
            <span className="filter-label">Стеллаж</span>
            <select value={filters.rack_id} onChange={(e) => setFilters((f) => ({ ...f, rack_id: e.target.value }))} className={filterInputCls}>
              <option value="">—</option>
              {racksForFilter.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
          <div className="filter-field w-20">
            <span className="filter-label">Катег.</span>
            <select value={filters.category_id} onChange={(e) => setFilters((f) => ({ ...f, category_id: e.target.value }))} className={filterInputCls}>
              <option value="">—</option>
              {catalog.categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="filter-field w-12">
            <span className="filter-label">Ед.</span>
            <input
              type="text"
              value={filters.unit}
              onChange={(e) => setFilters((f) => ({ ...f, unit: e.target.value }))}
              className={filterInputCls}
            />
          </div>
          <div className="filter-field w-20">
            <span className="filter-label">Остаток</span>
            <select value={filters.stock} onChange={(e) => setFilters((f) => ({ ...f, stock: e.target.value }))} className={filterInputCls}>
              <option value="">Все</option>
              <option value="positive">Есть</option>
              <option value="zero">Ноль</option>
            </select>
          </div>
        </div>
        <div className="overflow-x-auto max-h-[calc(100vh-7.5rem)] overflow-y-auto">
          <table className="table-compact">
            <thead className="sticky top-0 bg-surface-900 z-10">
              <tr>
                <th>
                  <button type="button" onClick={() => toggleSort('code')} className="sort-btn">
                    Код <SortIcon column="code" />
                  </button>
                </th>
                <th>
                  <button type="button" onClick={() => toggleSort('name')} className="sort-btn">
                    Наимен. <SortIcon column="name" />
                  </button>
                </th>
                <th>
                  <button type="button" onClick={() => toggleSort('location')} className="sort-btn">
                    Место <SortIcon column="location" />
                  </button>
                </th>
                <th>
                  <button type="button" onClick={() => toggleSort('category_name')} className="sort-btn">
                    Кат. <SortIcon column="category_name" />
                  </button>
                </th>
                <th>
                  <button type="button" onClick={() => toggleSort('unit')} className="sort-btn">
                    Ед. <SortIcon column="unit" />
                  </button>
                </th>
                <th className="text-right">
                  <button type="button" onClick={() => toggleSort('price')} className="sort-btn ml-auto">
                    Цена <SortIcon column="price" />
                  </button>
                </th>
                <th className="text-right">
                  <button type="button" onClick={() => toggleSort('production_price')} className="sort-btn ml-auto">
                    СМР <SortIcon column="production_price" />
                  </button>
                </th>
                <th className="text-right">
                  <button type="button" onClick={() => toggleSort('quantity')} className="sort-btn ml-auto">
                    Кол. <SortIcon column="quantity" />
                  </button>
                </th>
                <th>
                  <button type="button" onClick={() => toggleSort('updated_at')} className="sort-btn">
                    Изменён <SortIcon column="updated_at" />
                  </button>
                </th>
                <th className="w-24" />
              </tr>
            </thead>
            <tbody>
              {sortedList.map((m) => (
                <tr
                  key={m.id}
                  className="cursor-pointer"
                  onClick={() => openMaterialMenu(m)}
                >
                  <td>
                    <span className="font-mono text-white text-2xs">{m.code}</span>
                  </td>
                  <td className="text-white max-w-[12rem] truncate" title={m.name}>{m.name}</td>
                  <td className="text-zinc-500 max-w-[8rem] truncate text-2xs" title={locationLabel(m)}>{locationLabel(m)}</td>
                  <td className="text-zinc-500 truncate max-w-[5rem]" title={m.category_name || ''}>{m.category_name || '—'}</td>
                  <td className="text-zinc-500">{m.unit}</td>
                  <td className="text-right text-zinc-400 tabular-nums">{Number(m.price ?? 0).toFixed(2)}</td>
                  <td className="text-right text-zinc-400 tabular-nums">{Number(m.production_price ?? 0).toFixed(2)}</td>
                  <td className="text-right">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setHistoryMaterial(m);
                      }}
                      className="text-white font-medium tabular-nums hover:text-zinc-300 underline decoration-dotted underline-offset-2"
                      title="История изменений"
                    >
                      {Number(m.quantity)}
                    </button>
                  </td>
                  <td className="text-zinc-500 text-2xs whitespace-nowrap" title={formatUpdatedAt(m.updated_at)}>
                    {formatUpdatedAt(m.updated_at)}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1 justify-end">
                      <button type="button" onClick={(e) => { e.stopPropagation(); openEdit(m); }} className="btn-ghost px-1">Изм</button>
                      <button
                        type="button"
                        onClick={() => setShowQrMaterial(m)}
                        className="p-0.5 rounded hover:bg-white/10"
                        title="QR"
                      >
                        <QRCodeSVG value={m.code} size={22} level="M" className="rounded bg-white p-0.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.length === 0 && (
          <p className="p-4 text-center text-zinc-500 text-xs">Нет материалов</p>
        )}
        {list.length > 0 && sortedList.length === 0 && (
          <p className="p-4 text-center text-zinc-500 text-xs">Ничего не найдено</p>
        )}
      </div>

      {showQrMaterial && (
        <div
          className="modal-backdrop z-[100]"
          onClick={() => setShowQrMaterial(null)}
          role="dialog"
          aria-modal="true"
          aria-label="QR-код"
        >
          <div
            className="card p-6 flex flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-white font-medium mb-2">{showQrMaterial.name}</p>
            <p className="text-slate-400 text-sm mb-4 font-mono">{showQrMaterial.code}</p>
            <QRCodeSVG value={showQrMaterial.code} size={256} level="M" className="rounded-lg bg-white p-2" />
            <button
              type="button"
              onClick={() => setShowQrMaterial(null)}
              className="mt-4 btn-secondary text-sm"
            >
              Закрыть
            </button>
          </div>
        </div>
      )}

      {(showAdd || editing) && (
        <div className="modal-backdrop">
          <div className="card p-6 max-w-lg w-full my-8 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-medium text-white mb-2">{editing ? 'Редактирование материала' : 'Новый материал'}</h3>
            {editing ? <p className="text-slate-500 text-sm mb-4 font-mono">{editing.code}</p> : <p className="text-slate-500 text-sm mb-4">QR-код создаётся автоматически.</p>}
            <form onSubmit={editing ? handleEdit : handleAdd} className="space-y-4">
              <div>
                <label className="label">Наименование</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="input"
                  required
                />
              </div>
              <MaterialLocationFields catalog={catalog} form={form} setForm={setForm} />
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Ед. изм.</label>
                  <select value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))} className="input">
                    {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                {!editing && (
                  <div>
                    <label className="label">Количество</label>
                    <input type="number" step="any" min="0" value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} className="input" />
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Цена</label>
                  <input type="number" step="0.01" min="0" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} className="input" />
                </div>
                <div>
                  <label className="label">СМР</label>
                  <input type="number" step="0.01" min="0" value={form.production_price} onChange={(e) => setForm((f) => ({ ...f, production_price: e.target.value }))} className="input" />
                </div>
              </div>
              {editing && <p className="text-slate-500 text-xs">Измените объект, склад и стеллаж для переноса на другое место.</p>}
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => { setShowAdd(false); setEditing(null); setForm(emptyMaterialForm()); }} className="px-4 py-2 rounded-xl text-slate-400 hover:text-white">Отмена</button>
                <button type="submit" className="btn-primary">{editing ? 'Сохранить' : 'Добавить'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showScan && !activeMaterial && (
        <QrScanner onScan={handleScan} onClose={closeScan} />
      )}

      {activeMaterial && activeStep === 'menu' && (
        <div className="modal-backdrop z-50" onClick={closeMaterialAction} role="dialog" aria-modal="true">
          <div className="card p-5 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-white mb-1">{activeMaterial.name}</h3>
            <p className="text-zinc-500 text-xs font-mono mb-1">{activeMaterial.code}</p>
            <p className="text-zinc-400 text-xs mb-4">
              На складе: <span className="text-white font-medium">{Number(activeMaterial.quantity)} {activeMaterial.unit}</span>
            </p>
            <div className="flex flex-col gap-2">
              <button type="button" onClick={() => setActiveStep('add')} className="btn-primary w-full py-2.5">
                Добавить
              </button>
              <button type="button" onClick={() => setActiveStep('issue')} className="btn-secondary w-full py-2.5">
                Выдать
              </button>
              <button type="button" onClick={closeMaterialAction} className="btn-ghost w-full py-2">
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {activeMaterial && activeStep === 'add' && (
        <div className="modal-backdrop z-50" onClick={closeMaterialAction}>
          <div className="card p-5 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-white mb-1">Добавить: {activeMaterial.name}</h3>
            <p className="text-zinc-500 text-xs mb-4 font-mono">{activeMaterial.code}</p>
            <form onSubmit={handleAddQuantity} className="space-y-3">
              <div>
                <label className="label">Количество</label>
                <input
                  type="number"
                  step="any"
                  min="0.0001"
                  value={addQtyAmount}
                  onChange={(e) => setAddQtyAmount(e.target.value)}
                  className="input"
                  autoFocus
                  required
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => setActiveStep('menu')} className="btn-ghost">
                  Назад
                </button>
                <button type="submit" className="btn-primary">
                  Оформить приход
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {historyMaterial && (
        <MaterialQuantityHistory
          material={historyMaterial}
          onClose={() => setHistoryMaterial(null)}
        />
      )}

      {activeMaterial && activeStep === 'issue' && (
        <div className="modal-backdrop z-50" onClick={closeMaterialAction}>
          <div className="card p-5 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-white mb-1">Выдать: {activeMaterial.name}</h3>
            <p className="text-zinc-500 text-xs mb-3 font-mono">{activeMaterial.code}</p>
            <p className="text-zinc-400 text-xs mb-3">
              Доступно: {Number(activeMaterial.quantity)} {activeMaterial.unit}
            </p>
            <form onSubmit={handleIssue} className="space-y-3">
              <div>
                <label className="label">Получатель</label>
                <select
                  value={issueToUserId}
                  onChange={(e) => setIssueToUserId(e.target.value)}
                  className="select"
                  required
                >
                  <option value="">— Выберите —</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>{u.display_name || u.login}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Количество</label>
                <input
                  type="number"
                  step="any"
                  min="0.0001"
                  max={Number(activeMaterial.quantity) || undefined}
                  value={issueQty}
                  onChange={(e) => setIssueQty(e.target.value)}
                  className="input"
                  required
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => setActiveStep('menu')} className="btn-ghost">
                  Назад
                </button>
                <button type="submit" className="btn-primary">
                  Выдать
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
