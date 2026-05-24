import { useState, useEffect, useMemo, useRef, Fragment } from 'react';
import { materials as materialsApi, settings as settingsApi } from '../api';
import QrScanner from '../components/QrScanner';
import { QRCodeSVG } from 'qrcode.react';
import { operations, isOfflineQueuedError } from '../api';
import MaterialLocationFields from '../components/MaterialLocationFields';
import MaterialQuantityHistory from '../components/MaterialQuantityHistory';
import MaterialQrModal from '../components/MaterialQrModal';
import MaterialStockSummary from '../components/MaterialStockSummary';
import {
  UNITS,
  emptyMaterialForm,
  materialToForm,
  formToPayload,
  locationLabel,
  formatUpdatedAt,
  defaultSplitParts,
  splitQuantitiesEvenly,
  syncSplitPartLabels,
  applySplitPartQuantityChange,
  resyncSplitPartsForTotal,
} from '../lib/materialForm';
import {
  materialDisplayName,
  materialQrHoverTitle,
  isMaterialGroupRow,
  isMaterialPart,
  materialRowQuantity,
  materialPartsCount,
  materialGroupSummary,
  materialPartDisplayName,
  materialPartQuantity,
  materialRowLocation,
  materialHasStock,
  filterPartsInStock,
} from '../lib/materialDisplay';
import MaterialPartsModal from '../components/MaterialPartsModal';
import ListPagination from '../components/ListPagination';
import { useListPagination } from '../hooks/useListPagination';
import { usePendingMutations } from '../hooks/usePendingMutations';
import { applyPendingToMaterials, withPendingRowClass } from '../lib/actionLog/applyOptimistic';

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

const NUMERIC_SORT_COLS = new Set(['price', 'production_price', 'quantity', 'cost_total', 'smr_total']);

const filterInputCls = 'filter-input';

function formatSumMoney(n) {
  const s = (Number(n) || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${s} ₽`;
}

function formatSumQty(n) {
  const x = Number(n) || 0;
  return x.toLocaleString('ru-RU', { maximumFractionDigits: 4 });
}

function ThWithSum({ label, column, sortBy, sortDir, onSort, sum, sumClassName = 'text-zinc-500', align = 'right' }) {
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
          <span className={`text-2xs font-normal tabular-nums ${sumClassName}`}>
            {sum}
          </span>
        )}
      </button>
    </th>
  );
}

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
  const [activeStep, setActiveStep] = useState(null); // 'menu' | 'add' | 'issue' | 'move'
  const [moveForm, setMoveForm] = useState(() => emptyMaterialForm());
  const [addQtyAmount, setAddQtyAmount] = useState('');
  const [issueQty, setIssueQty] = useState('');
  const [issueToUserId, setIssueToUserId] = useState('');
  const [users, setUsers] = useState([]);
  const [showQrMaterial, setShowQrMaterial] = useState(null);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [sortBy, setSortBy] = useState('name');
  const [sortDir, setSortDir] = useState('asc');
  const [importPreviewing, setImportPreviewing] = useState(false);
  const [importConfirm, setImportConfirm] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleteAllConfirm, setDeleteAllConfirm] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);
  const [info, setInfo] = useState('');
  const [historyMaterial, setHistoryMaterial] = useState(null);
  const [partsModalMaterial, setPartsModalMaterial] = useState(null);
  const [splitEnabled, setSplitEnabled] = useState(false);
  const [splitSaved, setSplitSaved] = useState(false);
  const [splitParts, setSplitParts] = useState(() => defaultSplitParts(1));
  const [expandedGroupIds, setExpandedGroupIds] = useState(() => new Set());
  const [groupPartsCache, setGroupPartsCache] = useState({});
  const [loadingPartsIds, setLoadingPartsIds] = useState(() => new Set());
  const expandedGroupIdsRef = useRef(expandedGroupIds);
  const fileInputRef = useRef(null);
  const pendingMutations = usePendingMutations();

  const displayList = useMemo(
    () => applyPendingToMaterials(list, pendingMutations, { catalog, issueUsers: users }),
    [list, pendingMutations, catalog, users],
  );

  useEffect(() => {
    expandedGroupIdsRef.current = expandedGroupIds;
  }, [expandedGroupIds]);

  const mapGroupParts = (parts, parentName, parentMeta = {}) => (
    (parts || []).map((p) => ({
      ...p,
      parent_material_id: p.parent_material_id ?? parentMeta.id ?? null,
      group_name: p.group_name || parentName,
      group_total_quantity: parentMeta.group_total_quantity ?? p.group_total_quantity,
      parts_count: parentMeta.parts_count ?? p.parts_count,
    }))
  );

  const loadGroupPartsIntoCache = async (id, parentName, parentMeta = {}, { showLoading = false } = {}) => {
    if (showLoading) {
      setLoadingPartsIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
    }
    try {
      const data = await materialsApi.getParts(id);
      const name = data.parent?.name || parentName;
      const meta = {
        group_total_quantity: data.parent?.group_total_quantity ?? parentMeta.group_total_quantity,
        parts_count: data.parent?.parts_count ?? parentMeta.parts_count,
      };
      const mapped = mapGroupParts(data.parts, name, { ...meta, id });
      setGroupPartsCache((c) => ({ ...c, [id]: mapped }));
      return mapped;
    } finally {
      if (showLoading) {
        setLoadingPartsIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    }
  };

  const refreshExpandedGroupParts = async (rows) => {
    const ids = expandedGroupIdsRef.current;
    if (!ids.size) return;
    await Promise.all([...ids].map(async (id) => {
      const parent = rows.find((r) => r.id === id);
      if (!parent) return;
      try {
        await loadGroupPartsIntoCache(id, parent.name, {
          id,
          group_total_quantity: parent.group_total_quantity,
          parts_count: parent.parts_count,
        });
      } catch {
        /* keep previous cache on silent refresh failure */
      }
    }));
  };

  const load = (opts = { silent: false }) => {
    if (!opts.silent) setLoading(true);
    materialsApi.list()
      .then((rows) => {
        setList(rows);
        if (!opts.silent) {
          setGroupPartsCache({});
        } else {
          void refreshExpandedGroupParts(rows);
        }
        setError('');
      })
      .catch((e) => setError(e.message || 'Не удалось загрузить материалы'))
      .finally(() => { if (!opts.silent) setLoading(false); });
  };

  const loadCatalog = () => {
    settingsApi.catalog().then(setCatalog).catch(() => {});
  };

  useEffect(() => {
    load();
    loadCatalog();
  }, []);

  useEffect(() => {
    const t = setInterval(() => load({ silent: true }), 5000);
    return () => clearInterval(t);
  }, []);

  const resetSplitState = () => {
    setSplitEnabled(false);
    setSplitSaved(false);
    setSplitParts(defaultSplitParts(1));
  };

  const openAdd = () => {
    setForm(emptyMaterialForm());
    resetSplitState();
    setShowAdd(true);
    setEditing(null);
    setError('');
    loadCatalog();
  };

  const saveSplitDivision = () => {
    if (splitParts.length < 1) {
      setError('Добавьте хотя бы одну часть');
      return;
    }
    if (splitParts.some((p) => !(parseFloat(p.quantity) > 0))) {
      setError('У каждой части укажите количество > 0');
      return;
    }
    const sum = splitParts.reduce((s, p) => s + (parseFloat(p.quantity) || 0), 0);
    const total = parseFloat(form.quantity) || 0;
    if (total > 0 && Math.abs(sum - total) > 0.0001) {
      setError(`Сумма частей (${sum}) не совпадает с общим количеством (${total})`);
      return;
    }
    setSplitSaved(true);
    setError('');
  };

  const toggleGroupExpand = async (e, m) => {
    e.stopPropagation();
    e.preventDefault();
    const id = m.id;
    const willExpand = !expandedGroupIds.has(id);
    setExpandedGroupIds((prev) => {
      const next = new Set(prev);
      if (willExpand) next.add(id);
      else next.delete(id);
      return next;
    });
    if (willExpand) {
      const hasCache = (groupPartsCache[id]?.length ?? 0) > 0;
      try {
        await loadGroupPartsIntoCache(id, m.name, {
          id,
          group_total_quantity: m.group_total_quantity,
          parts_count: m.parts_count,
        }, { showLoading: !hasCache });
      } catch (err) {
        setError(err.message);
        setExpandedGroupIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    }
  };

  const openMaterialRowClick = (m) => {
    if (isMaterialGroupRow(m)) {
      setPartsModalMaterial(m);
      return;
    }
    openMaterialMenu(m);
  };

  const canUseSplit = !editing || (!isMaterialPart(editing) && !isMaterialGroupRow(editing));

  const buildSplitPartsPayload = () => splitParts.map((p) => ({
    quantity: parseFloat(p.quantity) || 0,
    object_id: p.object_id || form.object_id || null,
    warehouse_id: p.warehouse_id || form.warehouse_id || null,
    rack_id: p.rack_id || form.rack_id || null,
    part_label: p.part_label?.trim() || undefined,
  }));

  const validateSplitBeforeSubmit = () => {
    if (!splitSaved) {
      setError('Сначала нажмите «Сохранить» для подтверждения разделения');
      return false;
    }
    const parts = buildSplitPartsPayload();
    const sum = parts.reduce((s, p) => s + p.quantity, 0);
    if (parts.some((p) => p.quantity <= 0)) {
      setError('У каждой части укажите количество > 0');
      return false;
    }
    const total = parseFloat(form.quantity) || 0;
    if (total > 0 && Math.abs(sum - total) > 0.0001) {
      setError(`Сумма частей (${sum}) не совпадает с общим количеством (${total})`);
      return false;
    }
    return true;
  };

  const toggleSplitMode = () => {
    const total = parseFloat(form.quantity);
    if (!splitEnabled && !(total > 0)) {
      setError('Сначала укажите количество');
      return;
    }
    setSplitEnabled((v) => {
      const next = !v;
      if (next) {
        setSplitSaved(false);
        const first = defaultSplitParts(1, form)[0];
        setSplitParts([{
          ...first,
          quantity: String(total),
          object_id: form.object_id || first.object_id,
          warehouse_id: form.warehouse_id || first.warehouse_id,
          rack_id: form.rack_id || first.rack_id,
        }]);
        setError('');
      } else {
        setSplitSaved(false);
      }
      return next;
    });
  };

  const openEdit = (m) => {
    resetSplitState();
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
      if (splitEnabled) {
        if (!validateSplitBeforeSubmit()) return;
        await materialsApi.create({
          ...formToPayload(form, { includeQuantity: false }),
          parts: buildSplitPartsPayload(),
        });
      } else {
        await materialsApi.create(formToPayload(form, { includeQuantity: true }));
      }
      setForm(emptyMaterialForm());
      resetSplitState();
      setShowAdd(false);
      load();
    } catch (err) {
      if (isOfflineQueuedError(err)) {
        setShowAdd(false);
        setForm(emptyMaterialForm());
        resetSplitState();
        return;
      }
      setError(err.message);
    }
  };

  const handleEdit = async (e) => {
    e.preventDefault();
    if (!editing) return;
    setError('');
    const isPart = isMaterialPart(editing);
    const parentId = editing.parent_material_id;
    const splittingExisting = splitEnabled && !isPart && !isMaterialGroupRow(editing);
    try {
      if (splittingExisting) {
        if (!validateSplitBeforeSubmit()) return;
        await materialsApi.split(editing.id, {
          ...formToPayload(form),
          parts: buildSplitPartsPayload(),
        });
      } else {
        await materialsApi.update(editing.id, formToPayload(form, {
          includeQuantity: isPart || !isMaterialGroupRow(editing),
          includePartLabel: isPart,
        }));
      }
      setEditing(null);
      setForm(emptyMaterialForm());
      resetSplitState();
      const rows = await materialsApi.list();
      setList(rows);
      if (parentId && expandedGroupIdsRef.current.has(parentId)) {
        const parent = rows.find((r) => r.id === parentId);
        await loadGroupPartsIntoCache(parentId, parent?.name || '', {
          id: parentId,
          group_total_quantity: parent?.group_total_quantity,
          parts_count: parent?.parts_count,
        });
      }
    } catch (err) {
      if (isOfflineQueuedError(err)) {
        setEditing(null);
        setForm(emptyMaterialForm());
        resetSplitState();
        return;
      }
      setError(err.message);
    }
  };

  const handleDeleteMaterial = async () => {
    if (!editing || user?.role !== 'admin') return;
    const isPart = isMaterialPart(editing);
    const msg = isPart
      ? `Удалить часть «${editing.part_label || `Часть ${editing.part_index}`}»?`
      : `Удалить материал «${editing.name}» и все связанные выдачи?`;
    if (!window.confirm(msg)) return;
    setError('');
    try {
      await materialsApi.delete(editing.id);
      setEditing(null);
      setForm(emptyMaterialForm());
      load();
    } catch (err) {
      if (isOfflineQueuedError(err)) {
        setEditing(null);
        setForm(emptyMaterialForm());
        return;
      }
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
    setMoveForm(emptyMaterialForm());
  };

  const openMoveStep = () => {
    if (!activeMaterial) return;
    if (isMaterialGroupRow(activeMaterial)) {
      setError('У группового материала перемещайте отдельные части');
      return;
    }
    setMoveForm(materialToForm(activeMaterial));
    setActiveStep('move');
    setError('');
    loadCatalog();
  };

  const handleMoveMaterial = async (e) => {
    e.preventDefault();
    if (!activeMaterial || isMaterialGroupRow(activeMaterial)) return;
    setError('');
    try {
      await materialsApi.update(activeMaterial.id, {
        object_id: moveForm.object_id || null,
        warehouse_id: moveForm.warehouse_id || null,
        rack_id: moveForm.rack_id || null,
      });
      closeMaterialAction();
      load();
    } catch (err) {
      if (isOfflineQueuedError(err)) {
        closeMaterialAction();
        return;
      }
      setError(err.message);
    }
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
      if (isOfflineQueuedError(err)) {
        closeMaterialAction();
        return;
      }
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
      if (isOfflineQueuedError(err)) {
        closeMaterialAction();
        return;
      }
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
        if (isMaterialGroupRow(m)) {
          openMaterialRowClick(m);
        } else {
          openMaterialMenu(m);
        }
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

  const filteredList = useMemo(() => displayList.filter((m) => {
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
  }), [displayList, filters]);

  const sortedList = useMemo(() => {
    const items = [...filteredList];
    if (!sortBy) return items;
    items.sort((a, b) => {
      let va;
      let vb;
      if (sortBy === 'location') {
        va = materialRowLocation(a).toLowerCase();
        vb = materialRowLocation(b).toLowerCase();
      } else if (sortBy === 'updated_at') {
        va = new Date(a.updated_at || 0).getTime();
        vb = new Date(b.updated_at || 0).getTime();
      } else if (sortBy === 'cost_total') {
        va = (Number(a.quantity) || 0) * (Number(a.price) || 0);
        vb = (Number(b.quantity) || 0) * (Number(b.price) || 0);
      } else if (sortBy === 'smr_total') {
        va = (Number(a.quantity) || 0) * (Number(a.production_price) || 0);
        vb = (Number(b.quantity) || 0) * (Number(b.production_price) || 0);
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

  const totals = useMemo(() => {
    let quantity = 0;
    let price = 0;
    let smr = 0;
    let costTotal = 0;
    let smrTotal = 0;
    for (const m of sortedList) {
      const q = materialRowQuantity(m);
      const p = Number(m.price) || 0;
      const s = Number(m.production_price) || 0;
      quantity += q;
      price += p;
      smr += s;
      costTotal += q * p;
      smrTotal += q * s;
    }
    return { quantity, price, smr, costTotal, smrTotal };
  }, [sortedList]);

  const paginationResetKey = useMemo(() => JSON.stringify(filters), [filters]);
  const pagination = useListPagination(sortedList, 'warehouse-page-size', paginationResetKey);

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

  const openImportResultModal = (data) => {
    setImportConfirm(null);
    const rowErrors = Array.isArray(data.errors) && data.errors.length > 0
      ? data.errors
      : (data.message ? [{ row: '—', error: data.message }] : []);
    setImportResult({
      fileName: '',
      total: 0,
      created: 0,
      updated: 0,
      created_groups: 0,
      updated_groups: 0,
      created_parts: 0,
      updated_parts: 0,
      errorOnly: false,
      ...data,
      errors: rowErrors,
    });
  };

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImportPreviewing(true);
    setError('');
    setInfo('');
    try {
      const preview = await materialsApi.previewImportExcel(file);
      setImportConfirm({
        file,
        fileName: file.name,
        total: preview.total ?? 0,
        toCreate: preview.toCreate ?? 0,
        toUpdate: preview.toUpdate ?? 0,
        groupsCreate: preview.groupsCreate ?? 0,
        groupsUpdate: preview.groupsUpdate ?? 0,
        partsCreate: preview.partsCreate ?? 0,
        partsUpdate: preview.partsUpdate ?? 0,
        singlesCreate: preview.singlesCreate ?? 0,
        singlesUpdate: preview.singlesUpdate ?? 0,
        issuancesCreate: preview.issuancesCreate ?? 0,
        issuancesUpdate: preview.issuancesUpdate ?? 0,
        productionUpdate: preview.productionUpdate ?? 0,
        autoCreate: preview.autoCreate ?? [],
        warnings: preview.warnings ?? [],
        canImport: preview.canImport !== false,
      });
    } catch (err) {
      setError('');
      openImportResultModal({
        fileName: file.name,
        errorOnly: true,
        message: err.message || 'Не удалось прочитать файл',
      });
    } finally {
      setImportPreviewing(false);
    }
  };

  const closeImportConfirm = () => {
    if (!importing) setImportConfirm(null);
  };

  const confirmImport = async () => {
    if (!importConfirm?.file || !importConfirm.canImport) return;
    setImporting(true);
    setError('');
    try {
      const result = await materialsApi.importExcel(importConfirm.file);
      openImportResultModal({
        fileName: importConfirm.fileName,
        total: importConfirm.total,
        created: result.created ?? 0,
        updated: result.updated ?? 0,
        created_groups: result.created_groups ?? 0,
        updated_groups: result.updated_groups ?? 0,
        created_parts: result.created_parts ?? 0,
        updated_parts: result.updated_parts ?? 0,
        issuances_created: result.issuances_created ?? 0,
        issuances_updated: result.issuances_updated ?? 0,
        production_updated: result.production_updated ?? 0,
        errors: result.errors ?? [],
      });
      if (!result.errors?.length) {
        setError('');
        setInfo('Импорт завершён');
      } else {
        setError('');
        setInfo('');
      }
      load();
    } catch (err) {
      setError('');
      openImportResultModal({
        fileName: importConfirm?.fileName || '',
        errorOnly: true,
        message: err.message || 'Ошибка импорта',
      });
    } finally {
      setImporting(false);
    }
  };

  const isAdmin = user?.role === 'admin';

  const handleDeleteAllWarehouse = async () => {
    setClearingAll(true);
    setError('');
    setInfo('');
    try {
      const result = await materialsApi.deleteAll();
      setDeleteAllConfirm(false);
      setExpandedGroupIds(new Set());
      setGroupPartsCache({});
      setEditing(null);
      setForm(emptyMaterialForm());
      resetSplitState();
      const parts = [`удалено материалов: ${result.deleted ?? 0}`];
      if (result.issuances_deleted) {
        parts.push(`отменено выдач: ${result.issuances_deleted}`);
      }
      setInfo(parts.join(', ') || 'Склад очищен');
      load();
    } catch (err) {
      setError(err.message || 'Не удалось очистить склад');
    } finally {
      setClearingAll(false);
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

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="page-title shrink-0">Склад</h2>
          <span className="text-2xs text-zinc-500">
            {hasActiveFilters ? `${sortedList.length}/${displayList.length}` : displayList.length}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {hasActiveFilters && (
            <button type="button" onClick={resetFilters} className="btn-ghost">
              Сброс
            </button>
          )}
          <button
            type="button"
            onClick={() => { setInfo(''); fileInputRef.current?.click(); }}
            disabled={importing || importPreviewing}
            className="btn-ghost"
            title="Загрузить из Excel"
          >
            {importPreviewing ? '…' : importing ? '…' : 'Импорт'}
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
          {isAdmin && (
            <button
              type="button"
              onClick={() => setDeleteAllConfirm(true)}
              disabled={clearingAll || !list.length}
              className="btn-ghost text-red-400 hover:text-red-300 disabled:opacity-40"
              title="Удалить все материалы и выдачи со склада"
            >
              {clearingAll ? '…' : 'Удалить всё'}
            </button>
          )}
        </div>
      </div>

      {deleteAllConfirm && (
        <div
          className="modal-backdrop z-50"
          onClick={() => !clearingAll && setDeleteAllConfirm(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="warehouse-delete-all-title"
        >
          <div
            className="card p-5 max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="warehouse-delete-all-title" className="text-white font-medium text-lg mb-3">
              Очистить склад
            </h3>
            <p className="text-slate-300 text-sm mb-2">
              Будут безвозвратно удалены все материалы на складе
              {list.length ? ` (${list.length} поз. в списке)` : ''}, включая части разделённых групп.
            </p>
            <p className="text-slate-500 text-xs mb-5">
              Также удалятся все связанные выдачи материалов. Справочники (объекты, склады, категории) не затрагиваются.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn-ghost text-sm"
                onClick={() => setDeleteAllConfirm(false)}
                disabled={clearingAll}
              >
                Отмена
              </button>
              <button
                type="button"
                className="btn-primary text-sm bg-red-600 hover:bg-red-500 border-red-600"
                onClick={handleDeleteAllWarehouse}
                disabled={clearingAll}
              >
                {clearingAll ? 'Удаление…' : 'Удалить всё'}
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <p className="alert-error">
          {error}
          <button type="button" onClick={() => load()} className="btn-ghost ml-2 text-xs">
            Повторить
          </button>
        </p>
      )}
      {info && <p className="alert-info">{info}</p>}

      {importConfirm && (
        <div
          className="modal-backdrop z-50"
          onClick={closeImportConfirm}
          role="dialog"
          aria-modal="true"
          aria-labelledby="warehouse-import-confirm-title"
        >
          <div
            className="card p-5 max-w-lg w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="warehouse-import-confirm-title" className="text-white font-medium text-lg mb-3">
              Импорт склада
            </h3>
            <p className="text-slate-400 text-sm mb-4 truncate" title={importConfirm.fileName}>
              Файл: {importConfirm.fileName}
            </p>
            <dl className="space-y-2 text-sm mb-4">
              <div className="flex justify-between gap-4 border-b border-slate-700 pb-2">
                <dt className="text-slate-400">Строк в файле</dt>
                <dd className="text-white font-medium tabular-nums">{importConfirm.total}</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-slate-700 pb-2">
                <dt className="text-slate-400">Будет добавлено</dt>
                <dd className="text-emerald-400 font-medium tabular-nums">{importConfirm.toCreate}</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-slate-700 pb-2">
                <dt className="text-slate-400">Будет обновлено</dt>
                <dd className="text-sky-400 font-medium tabular-nums">{importConfirm.toUpdate}</dd>
              </div>
              {(importConfirm.groupsCreate > 0 || importConfirm.groupsUpdate > 0
                || importConfirm.partsCreate > 0 || importConfirm.partsUpdate > 0) && (
                <div className="text-slate-500 text-xs pt-1 space-y-1">
                  {importConfirm.groupsCreate + importConfirm.groupsUpdate > 0 && (
                    <p>Группы: +{importConfirm.groupsCreate} / ~{importConfirm.groupsUpdate}</p>
                  )}
                  {importConfirm.partsCreate + importConfirm.partsUpdate > 0 && (
                    <p>Части: +{importConfirm.partsCreate} / ~{importConfirm.partsUpdate}</p>
                  )}
                  {importConfirm.singlesCreate + importConfirm.singlesUpdate > 0 && (
                    <p>Одиночные: +{importConfirm.singlesCreate} / ~{importConfirm.singlesUpdate}</p>
                  )}
                </div>
              )}
              {(importConfirm.issuancesCreate > 0 || importConfirm.issuancesUpdate > 0
                || importConfirm.productionUpdate > 0) && (
                <div className="text-slate-500 text-xs pt-1 space-y-1 border-t border-slate-700 mt-2">
                  {(importConfirm.issuancesCreate > 0 || importConfirm.issuancesUpdate > 0) && (
                    <p>Выдача: +{importConfirm.issuancesCreate} / ~{importConfirm.issuancesUpdate}</p>
                  )}
                  {importConfirm.productionUpdate > 0 && (
                    <p>Выработка: ~{importConfirm.productionUpdate}</p>
                  )}
                </div>
              )}
            </dl>
            {importConfirm.autoCreate?.length > 0 && (
              <p className="text-amber-400/90 text-xs mb-3">
                Будут созданы в справочнике: {importConfirm.autoCreate.join(', ')}
              </p>
            )}
            {importConfirm.warnings.length > 0 && (
              <div className="mb-4">
                <p className="text-rose-400 text-sm mb-2">
                  Исправьте файл перед загрузкой ({importConfirm.warnings.length})
                </p>
                <ul className="text-rose-400 text-xs space-y-1 max-h-40 overflow-y-auto">
                  {importConfirm.warnings.slice(0, 20).map((w, i) => (
                    <li key={i}>
                      {w.sheet ? `${w.sheet}, ` : ''}строка {w.row}{w.code ? ` (${w.code})` : ''}: {w.error}
                    </li>
                  ))}
                  {importConfirm.warnings.length > 20 && (
                    <li className="text-slate-500">…и ещё {importConfirm.warnings.length - 20}</li>
                  )}
                </ul>
              </div>
            )}
            <p className="text-slate-500 text-xs mb-5">
              Лист «Склад»: одиночный, группа, часть. Листы «Выдача» и «Выработка» — отдельные вкладки в файле.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn-ghost text-sm"
                onClick={closeImportConfirm}
                disabled={importing}
              >
                Отмена
              </button>
              <button
                type="button"
                className="btn-primary text-sm"
                onClick={confirmImport}
                disabled={importing || !importConfirm.canImport}
              >
                {importing ? 'Загрузка…' : 'Импортировать'}
              </button>
            </div>
          </div>
        </div>
      )}

      {importResult && (
        <div
          className="modal-backdrop z-50"
          onClick={() => setImportResult(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="warehouse-import-result-title"
        >
          <div
            className="card p-5 max-w-lg w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="warehouse-import-result-title" className="text-white font-medium text-lg mb-3">
              {importResult.errorOnly
                ? 'Ошибка импорта'
                : importResult.errors.length > 0
                  ? 'Импорт завершён с ошибками'
                  : 'Результат импорта'}
            </h3>
            {importResult.fileName && (
              <p className="text-slate-400 text-sm mb-4 truncate" title={importResult.fileName}>
                Файл: {importResult.fileName}
              </p>
            )}
            {!importResult.errorOnly && (
              <dl className="space-y-2 text-sm mb-4">
                <div className="flex justify-between gap-4 border-b border-slate-700 pb-2">
                  <dt className="text-slate-400">Строк в файле</dt>
                  <dd className="text-white font-medium tabular-nums">{importResult.total}</dd>
                </div>
                <div className="flex justify-between gap-4 border-b border-slate-700 pb-2">
                  <dt className="text-slate-400">Добавлено</dt>
                  <dd className="text-emerald-400 font-medium tabular-nums">{importResult.created}</dd>
                </div>
                {importResult.updated > 0 && (
                  <div className="flex justify-between gap-4 border-b border-slate-700 pb-2">
                    <dt className="text-slate-400">Обновлено</dt>
                    <dd className="text-sky-400 font-medium tabular-nums">{importResult.updated}</dd>
                  </div>
                )}
                {(importResult.created_groups > 0 || importResult.updated_groups > 0
                  || importResult.created_parts > 0 || importResult.updated_parts > 0) && (
                  <div className="text-slate-500 text-xs pt-1 space-y-1 border-b border-slate-700 pb-2">
                    {(importResult.created_groups > 0 || importResult.updated_groups > 0) && (
                      <p>Группы: +{importResult.created_groups} / ~{importResult.updated_groups}</p>
                    )}
                    {(importResult.created_parts > 0 || importResult.updated_parts > 0) && (
                      <p>Части: +{importResult.created_parts} / ~{importResult.updated_parts}</p>
                    )}
                  </div>
                )}
                {(importResult.issuances_created > 0 || importResult.issuances_updated > 0
                  || importResult.production_updated > 0) && (
                  <div className="text-slate-500 text-xs pt-1 space-y-1 border-b border-slate-700 pb-2">
                    {(importResult.issuances_created > 0 || importResult.issuances_updated > 0) && (
                      <p>Выдача: +{importResult.issuances_created} / ~{importResult.issuances_updated}</p>
                    )}
                    {importResult.production_updated > 0 && (
                      <p>Выработка: ~{importResult.production_updated}</p>
                    )}
                  </div>
                )}
              </dl>
            )}
            {importResult.errors.length > 0 && (
              <div className="mb-4">
                <p className="text-rose-400 text-sm mb-2 font-medium">
                  Ошибки по строкам ({importResult.errors.length})
                </p>
                <ul className="text-rose-400 text-xs space-y-1.5 max-h-52 overflow-y-auto rounded border border-rose-900/40 bg-rose-950/20 p-3">
                  {importResult.errors.map((err, i) => (
                    <li key={i}>
                      <span className="text-rose-300 font-medium">
                        {err.sheet ? `${err.sheet}, ` : ''}строка {err.row}
                      </span>
                      {err.code ? <span className="text-slate-500"> ({err.code})</span> : null}
                      : {err.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex justify-end">
              <button
                type="button"
                className="btn-primary text-sm"
                onClick={() => setImportResult(null)}
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {loading && <p className="text-zinc-500 text-xs">Загрузка…</p>}

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
                <th className="w-8" aria-label="Развернуть" />
                <th className="w-10 text-center text-zinc-500 text-2xs font-normal">№</th>
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
                <ThWithSum
                  label="Кол."
                  column="quantity"
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onSort={toggleSort}
                  sum={formatSumQty(totals.quantity)}
                />
                <ThWithSum
                  label="Стоимость за ед."
                  column="price"
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onSort={toggleSort}
                  sum={formatSumMoney(totals.price)}
                />
                <ThWithSum
                  label="Стоимость"
                  column="cost_total"
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onSort={toggleSort}
                  sum={formatSumMoney(totals.costTotal)}
                  sumClassName="text-zinc-400"
                />
                <ThWithSum
                  label="СМР за ед."
                  column="production_price"
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onSort={toggleSort}
                  sum={formatSumMoney(totals.smr)}
                />
                <ThWithSum
                  label="СМР"
                  column="smr_total"
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onSort={toggleSort}
                  sum={formatSumMoney(totals.smrTotal)}
                  sumClassName="text-zinc-400"
                />
                <th>
                  <button type="button" onClick={() => toggleSort('updated_at')} className="sort-btn">
                    Изменён <SortIcon column="updated_at" />
                  </button>
                </th>
                <th className="w-24" />
              </tr>
            </thead>
            <tbody>
              {pagination.paginatedItems.map((m, rowIndex) => {
                const globalRowIndex = (pagination.page - 1) * pagination.pageSize + rowIndex;
                const qty = materialRowQuantity(m);
                const unitPrice = Number(m.price) || 0;
                const unitSmr = Number(m.production_price) || 0;
                const costTotal = qty * unitPrice;
                const smrTotalRow = qty * unitSmr;
                const isGroup = isMaterialGroupRow(m);
                const expanded = expandedGroupIds.has(m.id);
                const childParts = filterPartsInStock(groupPartsCache[m.id] || []);
                const partsLoading = loadingPartsIds.has(m.id);
                const partsCount = materialPartsCount(m, childParts);

                const renderRow = (row, { isChild = false, childIndex } = {}) => {
                  const rowUnitPrice = Number(row.price) || unitPrice;
                  const rowUnitSmr = Number(row.production_price) || unitSmr;
                  const rowQty = isChild
                    ? materialPartQuantity(row)
                    : materialRowQuantity(row);
                  const rowCost = rowQty * rowUnitPrice;
                  const rowSmr = rowQty * rowUnitSmr;
                  const partNames = isChild ? materialPartDisplayName(row, m.name) : null;
                  return (
                    <tr
                      key={isChild ? `part-${row.id}` : row.id}
                      className={withPendingRowClass(
                        `cursor-pointer ${isChild ? 'bg-zinc-900/50' : ''}`,
                        row,
                      )}
                      title={row._pending ? 'Ожидает отправки на сервер' : undefined}
                      onClick={() => (isChild ? openMaterialMenu(row) : openMaterialRowClick(row))}
                    >
                      <td className="w-8 text-center" onClick={(e) => e.stopPropagation()}>
                        {!isChild && isGroup ? (
                          <button
                            type="button"
                            onClick={(e) => toggleGroupExpand(e, m)}
                            className="w-6 h-6 inline-flex items-center justify-center rounded hover:bg-white/10 text-zinc-400"
                            title={expanded ? 'Свернуть части' : 'Показать части'}
                            aria-expanded={expanded}
                          >
                            {expanded ? '▼' : '▶'}
                          </button>
                        ) : null}
                      </td>
                      <td className="text-center text-zinc-500 text-2xs tabular-nums">
                        {isChild ? `${globalRowIndex + 1}.${childIndex}` : globalRowIndex + 1}
                      </td>
                      <td
                        className={`text-white max-w-[14rem] ${isChild ? 'pl-4' : ''}`}
                        title={isChild ? `${partNames.name}${partNames.partLabel ? ` · ${partNames.partLabel}` : ''}` : materialDisplayName(row)}
                      >
                        {isChild ? (
                          <div className="min-w-0">
                            <div className="truncate text-white">{partNames.name}</div>
                            {partNames.partLabel && (
                              <div className="truncate text-2xs text-zinc-500">{partNames.partLabel}</div>
                            )}
                          </div>
                        ) : (
                          <>
                            {row.name}
                            {isGroup && (
                              <span
                                className="ml-1.5 text-2xs text-brand-400/90 font-normal"
                                title={`${partsCount} частей, всего ${materialRowQuantity(m)} ${m.unit || ''}`}
                              >
                                {partsCount} ч.
                              </span>
                            )}
                          </>
                        )}
                      </td>
                      <td
                        className="text-zinc-500 max-w-[12rem] truncate text-2xs"
                        title={materialRowLocation(row, { parts: isGroup && !isChild ? childParts : undefined })}
                      >
                        {materialRowLocation(row, { parts: isGroup && !isChild ? childParts : undefined })}
                      </td>
                      <td className="text-zinc-500 truncate max-w-[5rem]" title={row.category_name || ''}>
                        {row.category_name || '—'}
                      </td>
                      <td className="text-zinc-500">{row.unit}</td>
                      <td className="text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setHistoryMaterial(row);
                          }}
                          className="text-white font-medium tabular-nums hover:text-zinc-300"
                          title={isChild
                            ? `Количество части: ${rowQty} ${row.unit || m.unit || ''}`
                            : 'История изменений'}
                        >
                          {rowQty}
                          {isChild && (row.unit || m.unit) && (
                            <span className="text-zinc-500 font-normal text-2xs ml-0.5">{row.unit || m.unit}</span>
                          )}
                        </button>
                      </td>
                      <td className="text-right text-zinc-400 tabular-nums">{rowUnitPrice.toFixed(2)}</td>
                      <td className="text-right text-white tabular-nums font-medium">{rowCost.toFixed(2)}</td>
                      <td className="text-right text-zinc-400 tabular-nums">{rowUnitSmr.toFixed(2)}</td>
                      <td className="text-right text-zinc-300 tabular-nums">{rowSmr.toFixed(2)}</td>
                      <td className="text-zinc-500 text-2xs whitespace-nowrap" title={formatUpdatedAt(row.updated_at)}>
                        {formatUpdatedAt(row.updated_at)}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1 justify-end">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); openEdit(row); }}
                            className="btn-ghost px-1"
                          >
                            Изм
                          </button>
                          {row.code && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setShowQrMaterial(row);
                              }}
                              className="p-0.5 rounded hover:bg-white/10"
                              title={materialQrHoverTitle(row)}
                            >
                              <QRCodeSVG value={row.code} size={22} level="M" className="rounded bg-white p-0.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                };

                return (
                  <Fragment key={m.id}>
                    {renderRow(m)}
                    {isGroup && expanded && partsLoading && childParts.length === 0 && (
                      <tr className="bg-zinc-900/50">
                        <td />
                        <td />
                        <td colSpan={10} className="text-2xs text-zinc-500 py-2 pl-4">
                          Загрузка частей…
                        </td>
                      </tr>
                    )}
                    {isGroup && expanded && childParts.map((part, i) => renderRow(part, { isChild: true, childIndex: i + 1 }))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <ListPagination {...pagination} />
        {list.length === 0 && (
          <p className="p-4 text-center text-zinc-500 text-xs">Нет материалов</p>
        )}
        {list.length > 0 && sortedList.length === 0 && (
          <p className="p-4 text-center text-zinc-500 text-xs">Ничего не найдено</p>
        )}
      </div>

      {showQrMaterial && (
        <MaterialQrModal
          material={showQrMaterial}
          groupInfo={materialGroupSummary(showQrMaterial)}
          onClose={() => setShowQrMaterial(null)}
        />
      )}

      {partsModalMaterial && (
        <MaterialPartsModal
          material={partsModalMaterial}
          catalog={catalog}
          onClose={() => setPartsModalMaterial(null)}
          onUpdated={load}
          onOpenMenu={(m) => {
            setPartsModalMaterial(null);
            openMaterialMenu(m);
          }}
        />
      )}

      {(showAdd || editing) && (
        <div className="modal-backdrop">
          <div className="card p-6 max-w-lg w-full my-8 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-medium text-white mb-2">
              {editing
                ? (isMaterialPart(editing) ? 'Редактирование части' : 'Редактирование материала')
                : 'Новый материал'}
            </h3>
            {editing ? (
              <p className="text-slate-500 text-sm mb-4 font-mono">
                {editing.code}
                {editing.part_index ? ` · ${editing.part_label || `Часть ${editing.part_index}`}` : ''}
              </p>
            ) : (
              <p className="text-slate-500 text-sm mb-4">QR-код создаётся автоматически. Можно разделить на части с отдельными QR.</p>
            )}
            <form onSubmit={editing ? handleEdit : handleAdd} className="space-y-4">
              <div>
                <label className="label">Наименование</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => {
                    const v = e.target.value;
                    setForm((f) => ({ ...f, name: v }));
                    if (splitEnabled) {
                      setSplitParts((prev) => syncSplitPartLabels(prev, v));
                      setSplitSaved(false);
                    }
                  }}
                  className="input"
                  required
                  disabled={editing && isMaterialPart(editing)}
                />
                {editing && isMaterialPart(editing) && (
                  <p className="text-2xs text-zinc-500 mt-1">Наименование общее для всех частей материала</p>
                )}
              </div>
              {editing && isMaterialPart(editing) && (
                <div>
                  <label className="label">Подпись части</label>
                  <input
                    type="text"
                    value={form.part_label}
                    onChange={(e) => setForm((f) => ({ ...f, part_label: e.target.value }))}
                    className="input"
                    placeholder="Бухта 1"
                  />
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Ед. изм.</label>
                  <select value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))} className="input">
                    {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                {(!editing || (!isMaterialPart(editing) && !isMaterialGroupRow(editing))) && (
                  <div>
                    <label className="label">
                      {splitEnabled || !editing ? 'Общее количество' : 'Количество'}
                    </label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={form.quantity}
                      onChange={(e) => {
                        const v = e.target.value;
                        setForm((f) => ({ ...f, quantity: v }));
                        if (splitEnabled) {
                          setSplitParts((prev) => resyncSplitPartsForTotal(prev, v, { ...form, quantity: v }));
                          setSplitSaved(false);
                        }
                      }}
                      className="input"
                      required
                      disabled={Boolean(editing && splitEnabled)}
                    />
                  </div>
                )}
              </div>
              {((!editing && !splitEnabled) || (editing && isMaterialPart(editing)) || (editing && !isMaterialGroupRow(editing) && !isMaterialPart(editing) && !splitEnabled)) && (
                <MaterialLocationFields catalog={catalog} form={form} setForm={setForm} />
              )}
              {splitEnabled && canUseSplit && (
                <div className="space-y-3 max-h-[40vh] overflow-y-auto border border-zinc-700 rounded-xl p-3 bg-zinc-900/50">
                  <p className="text-2xs text-zinc-500">
                    Всего: <span className="text-zinc-300 tabular-nums">{form.quantity || '—'}</span> {form.unit}.
                    Введите количество в часть 1 — остаток перейдёт в следующую часть; при изменении части 2 появится часть 3 и т.д.
                    Затем нажмите «Сохранить».
                  </p>
                  {(() => {
                    const assigned = splitParts.reduce((s, p) => s + (parseFloat(p.quantity) || 0), 0);
                    const total = parseFloat(form.quantity) || 0;
                    const rest = Math.max(0, Math.round((total - assigned) * 10000) / 10000);
                    if (total > 0) {
                      return (
                        <p className="text-2xs text-brand-400/90 tabular-nums">
                          Распределено: {assigned} · Остаток: {rest}
                        </p>
                      );
                    }
                    return null;
                  })()}
                  {splitParts.map((p, idx) => (
                    <div key={idx} className="border border-zinc-700/80 rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs text-white font-medium">{p.part_label || `Часть ${idx + 1}`}</p>
                        {splitParts.length > 1 && idx < splitParts.length - 1 && (
                          <button
                            type="button"
                            className="text-2xs text-red-400 hover:text-red-300"
                            onClick={() => {
                              setSplitParts((arr) => {
                                const next = arr.filter((_, i) => i !== idx);
                                return resyncSplitPartsForTotal(next, form.quantity, form);
                              });
                              setSplitSaved(false);
                            }}
                          >
                            Удалить
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="label text-2xs">Кол-во</label>
                          <input
                            type="number"
                            step="any"
                            min="0"
                            required
                            value={p.quantity}
                            onChange={(e) => {
                              const v = e.target.value;
                              setSplitParts((arr) => applySplitPartQuantityChange(arr, idx, v, form.quantity, form));
                              setSplitSaved(false);
                            }}
                            className="input"
                          />
                        </div>
                        <div>
                          <label className="label text-2xs">Подпись</label>
                          <input
                            type="text"
                            value={p.part_label}
                            onChange={(e) => {
                              const v = e.target.value;
                              setSplitParts((arr) => arr.map((row, i) => (
                                i === idx ? { ...row, part_label: v, labelManual: true } : row
                              )));
                              setSplitSaved(false);
                            }}
                            className="input"
                          />
                        </div>
                      </div>
                      <MaterialLocationFields
                        catalog={catalog}
                        form={p}
                        setForm={(updater) => {
                          setSplitParts((arr) => arr.map((row, i) => {
                            if (i !== idx) return row;
                            const next = typeof updater === 'function' ? updater(row) : updater;
                            return { ...row, ...next };
                          }));
                          setSplitSaved(false);
                        }}
                      />
                    </div>
                  ))}
                  {!splitSaved && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      <button
                        type="button"
                        className="btn-primary text-sm"
                        onClick={saveSplitDivision}
                      >
                        Сохранить разделение
                      </button>
                    </div>
                  )}
                </div>
              )}
              {editing && isMaterialGroupRow(editing) && (
                <p className="text-slate-500 text-xs">
                  Место и количество задаются для каждой части — раскройте строку в таблице и нажмите «Изм» у нужной части.
                </p>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Стоимость за единицу</label>
                  <input type="number" step="0.01" min="0" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} className="input" />
                </div>
                <div>
                  <label className="label">СМР за единицу</label>
                  <input type="number" step="0.01" min="0" value={form.production_price} onChange={(e) => setForm((f) => ({ ...f, production_price: e.target.value }))} className="input" />
                </div>
              </div>
              {editing && isMaterialPart(editing) && (
                <p className="text-slate-500 text-xs">Измените количество, подпись, место хранения или цены для этой части.</p>
              )}
              {editing && !isMaterialPart(editing) && !isMaterialGroupRow(editing) && !splitEnabled && (
                <p className="text-slate-500 text-xs">Измените объект, склад и стеллаж для переноса на другое место.</p>
              )}
              {canUseSplit && (
                <div className="pt-2 border-t border-zinc-800 space-y-3">
                  {!splitEnabled && (
                    <p className="text-2xs text-zinc-500">
                      {editing
                        ? 'Разделите материал на части с отдельными QR и местами хранения. Количество на складе должно быть больше 0.'
                        : 'Для разделения укажите общее количество, затем нажмите «Разделить» внизу.'}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className={splitEnabled ? 'btn-primary text-sm' : 'btn-secondary text-sm'}
                      onClick={toggleSplitMode}
                    >
                      {splitEnabled ? 'Скрыть разделение' : 'Разделить'}
                    </button>
                    {splitEnabled && !splitSaved && splitParts.length > 1 && (
                      <button
                        type="button"
                        className="btn-ghost text-xs"
                        onClick={() => {
                          const n = splitParts.length;
                          setSplitParts(splitQuantitiesEvenly(defaultSplitParts(n, form), form.quantity));
                          setSplitSaved(false);
                        }}
                      >
                        Разбить поровну
                      </button>
                    )}
                    {splitEnabled && splitSaved && (
                      <span className="text-2xs text-emerald-400">
                        Разделение сохранено ({splitParts.length} ч.)
                        <button
                          type="button"
                          className="ml-2 text-zinc-400 underline hover:text-white"
                          onClick={() => setSplitSaved(false)}
                        >
                          Изменить
                        </button>
                      </span>
                    )}
                  </div>
                </div>
              )}
              <div className="flex gap-2 justify-end flex-wrap">
                {editing && user?.role === 'admin' && (
                  <button
                    type="button"
                    onClick={handleDeleteMaterial}
                    className="px-4 py-2 rounded-xl text-red-400 hover:text-red-300 mr-auto"
                  >
                    Удалить
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setShowAdd(false);
                    setEditing(null);
                    setForm(emptyMaterialForm());
                    resetSplitState();
                  }}
                  className="px-4 py-2 rounded-xl text-slate-400 hover:text-white"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={canUseSplit && splitEnabled && !splitSaved}
                >
                  {editing ? (splitEnabled ? 'Сохранить разделение' : 'Сохранить') : 'Добавить'}
                </button>
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
            <h3 className="text-base font-semibold text-white mb-1">
              {materialDisplayName(activeMaterial)}
            </h3>
            <p className="text-zinc-500 text-xs font-mono mb-1">{activeMaterial.code}</p>
            {!isMaterialGroupRow(activeMaterial) && (
              <p className="text-2xs text-zinc-500 mb-3">{locationLabel(activeMaterial)}</p>
            )}
            <MaterialStockSummary material={activeMaterial} className="mb-4" />
            {error && <p className="text-red-400 text-xs mb-3">{error}</p>}
            <div className="flex flex-col gap-2">
              <button type="button" onClick={() => setActiveStep('add')} className="btn-primary w-full py-2.5">
                Добавить
              </button>
              <button type="button" onClick={() => setActiveStep('issue')} className="btn-secondary w-full py-2.5">
                Выдать
              </button>
              {!isMaterialGroupRow(activeMaterial) && (
                <button type="button" onClick={openMoveStep} className="btn-secondary w-full py-2.5">
                  Переместить
                </button>
              )}
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

      {activeMaterial && activeStep === 'move' && (
        <div className="modal-backdrop z-50" onClick={closeMaterialAction}>
          <div className="card p-5 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-white mb-1">
              Переместить: {materialDisplayName(activeMaterial)}
            </h3>
            <p className="text-zinc-500 text-xs font-mono mb-1">{activeMaterial.code}</p>
            <p className="text-2xs text-zinc-500 mb-4">
              Сейчас: {locationLabel(activeMaterial)}
            </p>
            {error && <p className="text-red-400 text-xs mb-3">{error}</p>}
            <form onSubmit={handleMoveMaterial} className="space-y-4">
              <MaterialLocationFields
                catalog={catalog}
                form={moveForm}
                setForm={setMoveForm}
                showCategory={false}
              />
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => { setActiveStep('menu'); setError(''); }} className="btn-ghost">
                  Назад
                </button>
                <button type="submit" className="btn-primary">
                  Сохранить
                </button>
              </div>
            </form>
          </div>
        </div>
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
