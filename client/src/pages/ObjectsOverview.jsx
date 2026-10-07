import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { objectsView as objectsApi, operations as operationsApi } from '../api';

const EMPTY_DATA = {
  objects: [],
  entrances: [],
  floors: [],
  apartments: [],
  rooms: [],
  location_systems: [],
  location_system_materials: [],
  location_system_equipment: [],
  location_system_works: [],
  block_statuses: [],
  assignable_users: [],
};
const FLOOR_ROOMS_BUCKET_NAME = 'Помещения этажа';
const FLOOR_ROOMS_DISPLAY_TITLE = 'Помещения на этаже';
const DEFAULT_STATUS_COLOR = '#475569';

function naturalCompare(a, b) {
  return String(a || '').localeCompare(String(b || ''), 'ru', { numeric: true, sensitivity: 'base' });
}

function normalizeList(value) {
  return Array.isArray(value) ? value.filter((row) => row && typeof row === 'object') : [];
}

function normalizeHierarchy(value) {
  const safe = value && typeof value === 'object' ? value : {};
  return {
    objects: normalizeList(safe.objects),
    entrances: normalizeList(safe.entrances),
    floors: normalizeList(safe.floors),
    apartments: normalizeList(safe.apartments),
    rooms: normalizeList(safe.rooms),
    location_systems: normalizeList(safe.location_systems),
    location_system_materials: normalizeList(safe.location_system_materials),
    location_system_equipment: normalizeList(safe.location_system_equipment),
    location_system_works: normalizeList(safe.location_system_works),
    block_statuses: normalizeList(safe.block_statuses),
    assignable_users: normalizeList(safe.assignable_users),
  };
}

function asIntSet(values) {
  return new Set(values.map((v) => Number.parseInt(v, 10)).filter((v) => Number.isInteger(v) && v > 0));
}

function toggleSelection(list, id) {
  const key = String(id);
  return list.includes(key) ? list.filter((x) => x !== key) : [...list, key];
}

function idsEqualNullable(a, b) {
  if (a == null && b == null) return true;
  return Number(a || 0) === Number(b || 0);
}

function normalizeNameKey(value) {
  return String(value || '').trim().toLowerCase();
}

function getTextColorForHex(hex) {
  if (!/^#[0-9a-fA-F]{6}$/.test(String(hex || ''))) return '#E5E7EB';
  const cleanHex = hex.slice(1);
  const r = Number.parseInt(cleanHex.slice(0, 2), 16);
  const g = Number.parseInt(cleanHex.slice(2, 4), 16);
  const b = Number.parseInt(cleanHex.slice(4, 6), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 150 ? '#111827' : '#F9FAFB';
}

function blockSizeClass(level, score) {
  if (level === 'object') {
    if (score >= 18) return 'xl:col-span-2 min-h-[24rem]';
    if (score >= 10) return 'min-h-[21rem]';
    return 'min-h-[18rem]';
  }
  if (level === 'entrance') {
    if (score >= 12) return 'min-h-[14rem]';
    if (score >= 6) return 'min-h-[12rem]';
    return 'min-h-[10rem]';
  }
  if (level === 'floor') return '';
  return '';
}

function formatEntryLabel(entry) {
  const qty = Number(entry?.quantity || 0);
  const unit = String(entry?.unit || '').trim();
  const qtyLabel = Number.isFinite(qty)
    ? `${qty.toLocaleString('ru-RU', { maximumFractionDigits: 4 })}${unit ? ` ${unit}` : ''}`
    : '';
  return `${entry?.name || '—'}${qtyLabel ? ` — ${qtyLabel}` : ''}`;
}

function LocationSlotChip({
  slot,
  entries,
  onOpen,
  selected = false,
  selectionCaption = '',
  selectionColor = '',
  disabled = false,
}) {
  const entryLines = entries.map(formatEntryLabel).filter(Boolean);
  const statusName = slot.status_name || 'Без статуса';
  const statusColor = slot.status_color || DEFAULT_STATUS_COLOR;
  const backgroundColor = selectionColor || statusColor;
  const title = [
    `Система: ${slot.system_name || '—'}`,
    `Категория: ${slot.category_name || '—'}`,
    `Статус: ${statusName}`,
    `Исполнитель: ${slot.assigned_user_name || slot.assigned_user_login || '—'}`,
    `Позиции: ${entryLines.length ? entryLines.join('; ') : '—'}`,
  ].join('\n');
  return (
    <button
      type="button"
      onClick={() => onOpen?.(slot)}
      title={title}
      disabled={disabled}
      className={`rounded border shadow-sm p-1.5 text-left transition-transform min-h-[5.5rem] min-w-[12rem] max-w-[12rem] ${
        disabled ? 'opacity-55 cursor-not-allowed' : 'hover:scale-[1.01]'
      } ${
        selected ? 'ring-2 ring-emerald-300/70 border-emerald-200/70' : 'border-black/20'
      }`}
      style={{
        backgroundColor,
        color: getTextColorForHex(backgroundColor),
      }}
    >
      <span className="block space-y-0.5 leading-tight">
        <span className="block text-[9px] font-semibold uppercase">
          {slot.system_name || 'Система'}
          {slot.category_name ? ` · ${slot.category_name}` : ''}
        </span>
        {entryLines.length ? (
          entryLines.map((line, idx) => (
            <span key={`${slot.id}-entry-${idx}`} className="block text-[10px]">
              {line}
            </span>
          ))
        ) : (
          <span className="block text-[10px] opacity-90">Нет материалов</span>
        )}
        {selectionCaption ? (
          <span className="block text-[9px] font-semibold pt-0.5">{selectionCaption}</span>
        ) : null}
      </span>
    </button>
  );
}

function MultiSelectFilter({
  title,
  options,
  selected,
  onToggle,
  onClear,
  getOptionLabel,
}) {
  return (
    <details className="rounded-xl border border-white/10 bg-surface-850/80 p-3">
      <summary className="list-none cursor-pointer">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-zinc-200 font-medium">{title}</span>
          <span className="text-2xs text-zinc-400">
            {selected.length ? `Выбрано: ${selected.length}` : 'Все'}
          </span>
        </div>
      </summary>
      <div className="mt-3 space-y-2 max-h-52 overflow-auto pr-1">
        {options.length ? options.map((option) => {
          const id = String(option.id);
          const checked = selected.includes(id);
          return (
            <label
              key={id}
              className="flex items-start gap-2 rounded-lg border border-white/5 p-2 hover:bg-white/5 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(id)}
                className="mt-1 rounded border-zinc-600 text-sky-500"
              />
              <span className="text-sm text-zinc-200">{getOptionLabel(option)}</span>
            </label>
          );
        }) : (
          <p className="text-zinc-500 text-sm">Нет вариантов для выбора</p>
        )}
      </div>
      {!!selected.length && (
        <button
          type="button"
          onClick={onClear}
          className="mt-3 text-2xs text-sky-400 hover:text-sky-300"
        >
          Сбросить выбор
        </button>
      )}
    </details>
  );
}

export default function ObjectsOverview() {
  const location = useLocation();
  const navigate = useNavigate();
  const [data, setData] = useState(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedObjects, setSelectedObjects] = useState([]);
  const [selectedEntrances, setSelectedEntrances] = useState([]);
  const [collapsedFloors, setCollapsedFloors] = useState([]);
  const [expandedEntrance, setExpandedEntrance] = useState(null);
  const [editor, setEditor] = useState({
    open: false,
    slotId: null,
    statusId: '',
    assigneeId: '',
  });
  const [editorBusy, setEditorBusy] = useState(false);
  const [editorError, setEditorError] = useState('');
  const [productionMode, setProductionMode] = useState(null);
  const [productionDrafts, setProductionDrafts] = useState({});
  const [productionBusy, setProductionBusy] = useState(false);
  const [productionError, setProductionError] = useState('');
  const [productionMessage, setProductionMessage] = useState('');
  const [productionPicker, setProductionPicker] = useState(null);

  const load = useCallback(({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError('');
    return objectsApi.hierarchy()
      .then((payload) => setData(normalizeHierarchy(payload)))
      .catch((e) => setError(e.message || 'Ошибка загрузки схемы объектов'))
      .finally(() => {
        if (!silent) setLoading(false);
      });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const payload = location.state?.productionAllocation;
    if (!payload) return;
    const issuanceId = Number(payload.issuanceId || 0);
    const materialId = Number(payload.materialId || 0);
    if (!issuanceId || !materialId) return;
    const selectedWorkers = Array.isArray(payload.selectedWorkers)
      ? payload.selectedWorkers
        .map((row) => ({
          id: Number(row?.id || 0),
          label: String(row?.label || '').trim(),
        }))
        .filter((row) => row.id > 0)
      : [];
    setProductionMode({
      issuanceId,
      materialId,
      materialName: String(payload.materialName || ''),
      materialCode: String(payload.materialCode || ''),
      unit: String(payload.unit || 'шт'),
      materialSystemId: payload.materialSystemId == null ? null : Number(payload.materialSystemId),
      materialSystemName: String(payload.materialSystemName || ''),
      materialCategoryId: payload.materialCategoryId == null ? null : Number(payload.materialCategoryId),
      materialCategoryName: String(payload.materialCategoryName || ''),
      availableQty: Math.max(Number(payload.availableQty || 0), 0),
      selectedWorkers,
    });
    setProductionDrafts({});
    setProductionBusy(false);
    setProductionError('');
    setProductionMessage('');
    setProductionPicker(null);
    navigate(location.pathname, { replace: true, state: {} });
  }, [location.pathname, location.state, navigate]);

  const objects = useMemo(
    () => [...data.objects].sort((a, b) => naturalCompare(a.name, b.name)),
    [data.objects],
  );
  const entrances = useMemo(
    () => [...data.entrances].sort((a, b) => naturalCompare(a.name, b.name)),
    [data.entrances],
  );
  const floors = useMemo(
    () => [...data.floors].sort((a, b) => (
      Number(a.sort_order || Number.MAX_SAFE_INTEGER) - Number(b.sort_order || Number.MAX_SAFE_INTEGER)
      || naturalCompare(a.name, b.name)
    )),
    [data.floors],
  );
  const apartments = useMemo(
    () => [...data.apartments].sort((a, b) => naturalCompare(a.name, b.name)),
    [data.apartments],
  );
  const rooms = useMemo(
    () => [...data.rooms].sort((a, b) => naturalCompare(a.name, b.name)),
    [data.rooms],
  );
  const blockStatuses = useMemo(
    () => [...data.block_statuses].sort((a, b) => (
      Number(a.sort_order || 0) - Number(b.sort_order || 0)
      || naturalCompare(a.name, b.name)
    )),
    [data.block_statuses],
  );
  const assignableUsers = useMemo(
    () => [...data.assignable_users].sort((a, b) => (
      naturalCompare(a.full_name || a.login, b.full_name || b.login)
      || naturalCompare(a.login, b.login)
    )),
    [data.assignable_users],
  );
  const slotById = useMemo(() => {
    const map = new Map();
    data.location_systems.forEach((slot) => map.set(slot.id, slot));
    return map;
  }, [data.location_systems]);

  const objectIdSet = useMemo(() => asIntSet(selectedObjects), [selectedObjects]);
  const entranceIdSet = useMemo(() => asIntSet(selectedEntrances), [selectedEntrances]);
  const collapsedFloorSet = useMemo(() => asIntSet(collapsedFloors), [collapsedFloors]);
  const statusesById = useMemo(() => {
    const map = new Map();
    blockStatuses.forEach((status) => map.set(String(status.id), status));
    return map;
  }, [blockStatuses]);
  const productionStatuses = useMemo(
    () => blockStatuses.filter((status) => !!status.is_for_production),
    [blockStatuses],
  );
  const productionStatusById = useMemo(() => {
    const map = new Map();
    productionStatuses.forEach((status) => map.set(Number(status.id), status));
    return map;
  }, [productionStatuses]);
  const productionWorkersById = useMemo(() => {
    const map = new Map();
    (productionMode?.selectedWorkers || []).forEach((row) => {
      map.set(Number(row.id), row.label || `#${row.id}`);
    });
    return map;
  }, [productionMode]);

  const entrancesByObject = useMemo(() => {
    const map = new Map();
    entrances.forEach((row) => {
      const list = map.get(row.object_id) || [];
      list.push(row);
      map.set(row.object_id, list);
    });
    return map;
  }, [entrances]);

  const floorsByEntrance = useMemo(() => {
    const map = new Map();
    floors.forEach((row) => {
      const list = map.get(row.entrance_id) || [];
      list.push(row);
      map.set(row.entrance_id, list);
    });
    return map;
  }, [floors]);

  const apartmentsByFloor = useMemo(() => {
    const map = new Map();
    apartments.forEach((row) => {
      const list = map.get(row.floor_id) || [];
      list.push(row);
      map.set(row.floor_id, list);
    });
    return map;
  }, [apartments]);

  const roomsByApartment = useMemo(() => {
    const map = new Map();
    rooms.forEach((row) => {
      const list = map.get(row.apartment_id) || [];
      list.push(row);
      map.set(row.apartment_id, list);
    });
    return map;
  }, [rooms]);

  const slotsByLocation = useMemo(() => {
    const map = new Map();
    data.location_systems.forEach((slot) => {
      const key = `${slot.location_kind}:${slot.location_id}`;
      const list = map.get(key) || [];
      list.push(slot);
      map.set(key, list);
    });
    map.forEach((list, key) => {
      map.set(key, [...list].sort((a, b) => (
        naturalCompare(a.system_name, b.system_name)
        || naturalCompare(a.category_name, b.category_name)
        || (Number(a.id || 0) - Number(b.id || 0))
      )));
    });
    return map;
  }, [data.location_systems]);

  const entriesBySlot = useMemo(() => {
    const map = new Map();
    const pushEntry = (slotId, row) => {
      const list = map.get(slotId) || [];
      list.push(row);
      map.set(slotId, list);
    };
    data.location_system_materials.forEach((row) => {
      pushEntry(row.location_system_id, {
        name: row.material_name,
        quantity: Number(row.quantity || 0),
        unit: row.material_unit || '',
      });
    });
    data.location_system_equipment.forEach((row) => {
      pushEntry(row.location_system_id, {
        name: row.name,
        quantity: Number(row.quantity || 0),
        unit: '',
      });
    });
    data.location_system_works.forEach((row) => {
      pushEntry(row.location_system_id, {
        name: row.name,
        quantity: Number(row.quantity || 0),
        unit: '',
      });
    });
    map.forEach((list, key) => {
      map.set(key, [...list].sort((a, b) => naturalCompare(a.name, b.name)));
    });
    return map;
  }, [
    data.location_system_materials,
    data.location_system_equipment,
    data.location_system_works,
  ]);
  const productionEligibleSlotIds = useMemo(() => {
    const set = new Set();
    if (!productionMode) return set;
    const targetSystemId = productionMode.materialSystemId;
    const targetCategoryId = productionMode.materialCategoryId;
    data.location_systems.forEach((slot) => {
      if (!idsEqualNullable(slot.system_id, targetSystemId)) return;
      if (!idsEqualNullable(slot.category_id, targetCategoryId)) return;
      set.add(Number(slot.id));
    });
    return set;
  }, [data.location_systems, productionMode]);

  const productionMaterialEntryBySlot = useMemo(() => {
    const map = new Map();
    if (!productionMode) return map;
    const materialId = Number(productionMode.materialId || 0);
    const materialNameKey = normalizeNameKey(productionMode.materialName);
    const targetSystemId = productionMode.materialSystemId;
    const targetCategoryId = productionMode.materialCategoryId;

    const acc = new Map();
    data.location_system_materials.forEach((row) => {
      const slotId = Number(row.location_system_id || 0);
      if (!productionEligibleSlotIds.has(slotId)) return;
      const current = acc.get(slotId) || {
        exactQty: 0,
        fallbackQty: 0,
        equipmentQty: 0,
        worksQty: 0,
        unit: row.material_unit || '',
      };
      const qty = Number(row.quantity || 0);
      if (Number(row.material_id) === materialId) {
        current.exactQty += qty;
      } else if (
        materialNameKey
        && normalizeNameKey(row.material_name) === materialNameKey
        && idsEqualNullable(row.material_system_id, targetSystemId)
        && idsEqualNullable(row.material_category_id, targetCategoryId)
      ) {
        current.fallbackQty += qty;
      }
      if (!current.unit && row.material_unit) current.unit = row.material_unit;
      acc.set(slotId, current);
    });

    data.location_system_equipment.forEach((row) => {
      const slotId = Number(row.location_system_id || 0);
      if (!productionEligibleSlotIds.has(slotId)) return;
      if (!materialNameKey) return;
      if (normalizeNameKey(row.name) !== materialNameKey) return;
      const current = acc.get(slotId) || {
        exactQty: 0,
        fallbackQty: 0,
        equipmentQty: 0,
        worksQty: 0,
        unit: '',
      };
      current.equipmentQty += Number(row.quantity || 0);
      acc.set(slotId, current);
    });

    data.location_system_works.forEach((row) => {
      const slotId = Number(row.location_system_id || 0);
      if (!productionEligibleSlotIds.has(slotId)) return;
      if (!materialNameKey) return;
      if (normalizeNameKey(row.name) !== materialNameKey) return;
      const current = acc.get(slotId) || {
        exactQty: 0,
        fallbackQty: 0,
        equipmentQty: 0,
        worksQty: 0,
        unit: '',
      };
      current.worksQty += Number(row.quantity || 0);
      acc.set(slotId, current);
    });

    acc.forEach((value, slotId) => {
      let quantity = 0;
      if (value.exactQty > 0) quantity = value.exactQty;
      else if (value.fallbackQty > 0) quantity = value.fallbackQty;
      else if (value.equipmentQty > 0) quantity = value.equipmentQty;
      else if (value.worksQty > 0) quantity = value.worksQty;
      if (!(quantity > 0)) return;
      map.set(slotId, {
        materialId,
        name: productionMode.materialName || '',
        quantity,
        unit: value.unit || productionMode.unit || '',
      });
    });
    return map;
  }, [
    data.location_system_materials,
    data.location_system_equipment,
    data.location_system_works,
    productionMode,
    productionEligibleSlotIds,
  ]);
  const productionEligibleSlotsCount = productionEligibleSlotIds.size;

  const objectOptions = objects;
  const entranceOptions = useMemo(() => {
    const filteredByObjects = objectIdSet.size
      ? entrances.filter((e) => objectIdSet.has(e.object_id))
      : entrances;
    return filteredByObjects.map((row) => ({
      ...row,
      _objectName: objects.find((o) => o.id === row.object_id)?.name || '',
    }));
  }, [entrances, objects, objectIdSet]);

  const filteredObjects = useMemo(() => {
    return objects.filter((objectRow) => {
      if (objectIdSet.size && !objectIdSet.has(objectRow.id)) return false;
      if (!entranceIdSet.size) return true;
      const objectEntrances = entrancesByObject.get(objectRow.id) || [];
      return objectEntrances.some((entry) => entranceIdSet.has(entry.id));
    });
  }, [objects, objectIdSet, entranceIdSet, entrancesByObject]);

  const toggleFloorCollapse = (floorId) => {
    setCollapsedFloors((prev) => toggleSelection(prev, floorId));
  };

  const openSlotEditor = (slot) => {
    setEditor({
      open: true,
      slotId: slot.id,
      statusId: slot.status_id == null ? '' : String(slot.status_id),
      assigneeId: slot.assigned_user_id == null ? '' : String(slot.assigned_user_id),
    });
    setEditorError('');
  };

  const closeSlotEditor = () => {
    setEditor({ open: false, slotId: null, statusId: '', assigneeId: '' });
    setEditorBusy(false);
    setEditorError('');
  };

  const saveSlotEditor = async (event) => {
    event.preventDefault();
    if (!editor.slotId) return;
    setEditorBusy(true);
    setEditorError('');
    try {
      await objectsApi.updateLocationSystemStatusAssignment(editor.slotId, {
        status_id: editor.statusId ? Number(editor.statusId) : null,
        assigned_user_id: editor.assigneeId ? Number(editor.assigneeId) : null,
      });
      closeSlotEditor();
      await load({ silent: true });
    } catch (e) {
      setEditorError(e.message || 'Не удалось сохранить блок');
      setEditorBusy(false);
    }
  };

  const isProductionMode = !!productionMode;
  const productionDraftRows = useMemo(
    () => Object.values(productionDrafts),
    [productionDrafts],
  );
  const plannedProductionQty = useMemo(
    () => productionDraftRows.reduce((sum, row) => sum + Number(row.quantity || 0), 0),
    [productionDraftRows],
  );
  const productionRemainingPreview = useMemo(
    () => Math.max((Number(productionMode?.availableQty || 0) - plannedProductionQty), 0),
    [productionMode, plannedProductionQty],
  );

  const clearProductionMode = ({ keepMessage = false } = {}) => {
    setProductionMode(null);
    setProductionDrafts({});
    setProductionBusy(false);
    setProductionError('');
    if (!keepMessage) setProductionMessage('');
    setProductionPicker(null);
  };

  const applyProductionDraft = ({ slotId, statusId, workerUserId }) => {
    const materialEntry = productionMaterialEntryBySlot.get(Number(slotId));
    if (!materialEntry) return;
    setProductionDrafts((prev) => ({
      ...prev,
      [slotId]: {
        locationSystemId: Number(slotId),
        statusId: Number(statusId),
        workerUserId: Number(workerUserId),
        quantity: Number(materialEntry.quantity || 0),
      },
    }));
  };

  const removeProductionDraft = (slotId) => {
    setProductionDrafts((prev) => {
      const next = { ...prev };
      delete next[slotId];
      return next;
    });
  };

  const openProductionPickerForSlot = (slot) => {
    const existing = productionDrafts[slot.id];
    const fallbackStatus = productionStatuses[0]?.id || '';
    const fallbackWorker = productionMode?.selectedWorkers?.[0]?.id || '';
    setProductionPicker({
      slotId: Number(slot.id),
      statusId: existing?.statusId || fallbackStatus,
      workerUserId: existing?.workerUserId || fallbackWorker,
    });
  };

  const handleProductionSlotClick = (slot) => {
    if (!isProductionMode) {
      openSlotEditor(slot);
      return;
    }
    setProductionError('');
    setProductionMessage('');
    const materialEntry = productionMaterialEntryBySlot.get(Number(slot.id));
    if (!materialEntry) {
      setProductionError('Для этого блока не найдено количество выбранного материала.');
      return;
    }
    if (!productionStatuses.length) {
      setProductionError('В настройках статусов нет ни одного статуса, отмеченного как «для выработки».');
      return;
    }
    const workers = productionMode?.selectedWorkers || [];
    if (!workers.length) {
      setProductionError('Нет выбранных сотрудников для выработки.');
      return;
    }
    if (productionStatuses.length === 1 && workers.length === 1) {
      const statusId = Number(productionStatuses[0].id);
      const workerUserId = Number(workers[0].id);
      const existing = productionDrafts[slot.id];
      if (existing && existing.statusId === statusId && existing.workerUserId === workerUserId) {
        removeProductionDraft(slot.id);
      } else {
        applyProductionDraft({ slotId: slot.id, statusId, workerUserId });
      }
      return;
    }
    openProductionPickerForSlot(slot);
  };

  const saveProductionPicker = () => {
    if (!productionPicker) return;
    if (!Number(productionPicker.statusId) || !Number(productionPicker.workerUserId)) {
      setProductionError('Выберите статус и сотрудника');
      return;
    }
    applyProductionDraft({
      slotId: productionPicker.slotId,
      statusId: Number(productionPicker.statusId),
      workerUserId: Number(productionPicker.workerUserId),
    });
    setProductionPicker(null);
  };

  const saveProductionDistribution = async () => {
    if (!productionMode?.issuanceId) return;
    if (!productionDraftRows.length) {
      setProductionError('Выберите хотя бы один блок для сохранения выработки.');
      return;
    }
    if (plannedProductionQty > Number(productionMode.availableQty || 0) + 1e-9) {
      setProductionError('Сумма распределения превышает доступный остаток на руках.');
      return;
    }
    setProductionBusy(true);
    setProductionError('');
    setProductionMessage('');
    try {
      await operationsApi.distributeProduction(productionMode.issuanceId, {
        assignments: productionDraftRows.map((row) => ({
          location_system_id: row.locationSystemId,
          worker_user_id: row.workerUserId,
          status_id: row.statusId,
        })),
      });
      setProductionMessage('Выработка сохранена. Статусы блоков обновлены.');
      await load({ silent: true });
      clearProductionMode({ keepMessage: true });
    } catch (e) {
      setProductionError(e.message || 'Не удалось сохранить выработку');
    } finally {
      setProductionBusy(false);
    }
  };

  const renderLocationBlocks = (locationKind, locationId) => {
    let slots = slotsByLocation.get(`${locationKind}:${locationId}`) || [];
    if (isProductionMode) {
      slots = slots.filter((slot) => productionEligibleSlotIds.has(Number(slot.id)));
    }
    if (!slots.length) return null;
    const groupedBySystem = slots.reduce((acc, slot) => {
      const systemName = String(slot.system_name || '').trim() || 'Без системы';
      const systemKey = `${String(slot.system_id || 'none')}::${systemName.toLowerCase()}`;
      if (!acc.has(systemKey)) {
        acc.set(systemKey, {
          key: systemKey,
          systemName,
          categories: new Map(),
        });
      }
      const systemBucket = acc.get(systemKey);
      const categoryName = String(slot.category_name || '').trim() || 'Без категории';
      const categoryKey = `${String(slot.category_id || 'none')}::${categoryName.toLowerCase()}`;
      if (!systemBucket.categories.has(categoryKey)) {
        systemBucket.categories.set(categoryKey, {
          key: categoryKey,
          categoryName,
          slots: [],
        });
      }
      systemBucket.categories.get(categoryKey).slots.push(slot);
      return acc;
    }, new Map());

    const groupedRows = [...groupedBySystem.values()]
      .map((systemRow) => ({
        ...systemRow,
        categories: [...systemRow.categories.values()]
          .map((categoryRow) => ({
            ...categoryRow,
            slots: [...categoryRow.slots].sort((a, b) => Number(a.id || 0) - Number(b.id || 0)),
          }))
          .sort((a, b) => naturalCompare(a.categoryName, b.categoryName)),
      }))
      .sort((a, b) => naturalCompare(a.systemName, b.systemName));

    return (
      <div className="mt-1.5 space-y-1.5">
        {groupedRows.map((systemRow) => (
          <div key={systemRow.key} className="rounded-md border border-white/10 bg-white/[0.02] p-1.5 space-y-1">
            <p className="text-[10px] text-zinc-200 font-semibold">{systemRow.systemName}</p>
            {systemRow.categories.map((categoryRow) => (
              <div key={categoryRow.key} className="space-y-1">
                <p className="text-[9px] text-zinc-400">{categoryRow.categoryName}</p>
                <div className="flex flex-wrap gap-1">
                  {categoryRow.slots.map((slot) => {
                    const entries = entriesBySlot.get(slot.id) || [];
                    const draft = productionDrafts[slot.id] || null;
                    const draftStatus = draft ? productionStatusById.get(Number(draft.statusId)) : null;
                    const draftWorker = draft ? productionWorkersById.get(Number(draft.workerUserId)) : '';
                    const hasMaterialQty = productionMaterialEntryBySlot.has(Number(slot.id));
                    const selectionCaption = draft
                      ? [draftWorker, draftStatus?.name].filter(Boolean).join(' · ')
                      : (isProductionMode && !hasMaterialQty ? 'Нет количества материала' : '');
                    return (
                    <LocationSlotChip
                      key={slot.id}
                      slot={slot}
                      entries={entries}
                      onOpen={handleProductionSlotClick}
                      selected={!!draft}
                      selectionCaption={selectionCaption}
                      selectionColor={draftStatus?.color || ''}
                      disabled={isProductionMode && !hasMaterialQty}
                    />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  };

  const getFloorStatusStats = (floorApartmentsRaw, floorOnlyRooms) => {
    const regularApartments = floorApartmentsRaw.filter((apartment) => apartment.name !== FLOOR_ROOMS_BUCKET_NAME);
    const statusCounts = new Map();
    const appendSlots = (locationKind, locationId) => {
      const slots = slotsByLocation.get(`${locationKind}:${locationId}`) || [];
      slots.forEach((slot) => {
        const key = slot.status_id == null ? 'none' : String(slot.status_id);
        const knownStatus = slot.status_id == null ? null : statusesById.get(key);
        const row = statusCounts.get(key) || {
          key,
          name: knownStatus?.name || slot.status_name || 'Без статуса',
          color: knownStatus?.color || slot.status_color || DEFAULT_STATUS_COLOR,
          count: 0,
        };
        row.count += 1;
        statusCounts.set(key, row);
      });
    };

    floorOnlyRooms.forEach((room) => appendSlots('room', room.id));
    regularApartments.forEach((apartment) => {
      appendSlots('apartment', apartment.id);
      (roomsByApartment.get(apartment.id) || []).forEach((room) => appendSlots('room', room.id));
    });

    const rows = [];
    blockStatuses.forEach((status) => {
      const key = String(status.id);
      const row = statusCounts.get(key);
      if (row?.count) rows.push(row);
    });
    if (statusCounts.get('none')?.count) rows.push(statusCounts.get('none'));
    return rows;
  };

  const getFloorCounts = useCallback((floorId) => {
    const floorApartments = apartmentsByFloor.get(floorId) || [];
    const apartmentsCount = floorApartments.filter((apartment) => apartment.name !== FLOOR_ROOMS_BUCKET_NAME).length;
    let roomsCount = 0;
    floorApartments.forEach((apartment) => {
      roomsCount += (roomsByApartment.get(apartment.id) || []).length;
    });
    return { apartmentsCount, roomsCount };
  }, [apartmentsByFloor, roomsByApartment]);

  const getEntranceCounts = useCallback((entranceId) => {
    const entranceFloors = floorsByEntrance.get(entranceId) || [];
    let apartmentsCount = 0;
    let roomsCount = 0;
    entranceFloors.forEach((floor) => {
      const floorCounts = getFloorCounts(floor.id);
      apartmentsCount += floorCounts.apartmentsCount;
      roomsCount += floorCounts.roomsCount;
    });
    return {
      floorsCount: entranceFloors.length,
      apartmentsCount,
      roomsCount,
    };
  }, [floorsByEntrance, getFloorCounts]);

  const hasVisibleLocationSlots = useCallback((locationKind, locationId) => {
    const slots = slotsByLocation.get(`${locationKind}:${locationId}`) || [];
    if (!slots.length) return false;
    if (!isProductionMode) return true;
    return slots.some((slot) => productionEligibleSlotIds.has(Number(slot.id)));
  }, [slotsByLocation, isProductionMode, productionEligibleSlotIds]);

  const renderFloorCard = (floor, floorApartments, floorRooms, compact = false) => {
    const isCollapsed = collapsedFloorSet.has(floor.id);
    const floorRoomsBucket = floorApartments.find((apartment) => apartment.name === FLOOR_ROOMS_BUCKET_NAME);
    const regularApartmentsRaw = floorApartments.filter((apartment) => apartment.name !== FLOOR_ROOMS_BUCKET_NAME);
    const floorOnlyRoomsRaw = floorRoomsBucket ? (roomsByApartment.get(floorRoomsBucket.id) || []) : [];
    const floorOnlyRooms = isProductionMode
      ? floorOnlyRoomsRaw.filter((room) => hasVisibleLocationSlots('room', room.id))
      : floorOnlyRoomsRaw;
    const regularApartments = isProductionMode
      ? regularApartmentsRaw.filter((apartment) => (
        hasVisibleLocationSlots('apartment', apartment.id)
          || (roomsByApartment.get(apartment.id) || []).some((room) => hasVisibleLocationSlots('room', room.id))
      ))
      : regularApartmentsRaw;
    const floorStatusStats = getFloorStatusStats(floorApartments, floorOnlyRooms);
    return (
      <div
        key={floor.id}
        className={`rounded-lg border border-white/10 bg-black/20 ${compact ? 'p-2.5' : 'p-2'} space-y-1.5`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => toggleFloorCollapse(floor.id)}
            className="text-zinc-100 text-xs font-semibold hover:text-white text-left"
            title={isCollapsed ? 'Развернуть этаж' : 'Свернуть этаж'}
          >
            Этаж {floor.name}
          </button>
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <span className="text-2xs text-zinc-400">
              Квартир: {regularApartments.length} · Помещений: {floorRooms}
            </span>
            {floorStatusStats.map((row) => (
              <span
                key={`${floor.id}:${row.key}`}
                className="inline-flex items-center gap-1 rounded-full border border-black/30 px-1.5 py-0.5 text-[10px]"
                style={{
                  backgroundColor: row.color || DEFAULT_STATUS_COLOR,
                  color: getTextColorForHex(row.color || DEFAULT_STATUS_COLOR),
                }}
                title={`${row.name}: ${row.count}`}
              >
                {row.name}: {row.count}
              </span>
            ))}
          </div>
        </div>
        {!isCollapsed && (
          (regularApartments.length || floorOnlyRooms.length) ? (
            <div className="space-y-2">
              {floorOnlyRooms.length ? (
                <div className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5">
                  <p className="text-zinc-200 text-2xs font-medium">{FLOOR_ROOMS_DISPLAY_TITLE}</p>
                  <div className="mt-1 space-y-1.5">
                    {floorOnlyRooms.map((room) => (
                      <div
                        key={room.id}
                        className="rounded border border-white/10 bg-black/20 px-2 py-1.5"
                      >
                        <p className="text-zinc-200 text-2xs font-medium">Пом. {room.name}</p>
                        {renderLocationBlocks('room', room.id)}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {regularApartments.length ? (
                <div className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5 space-y-1.5">
                  <p className="text-zinc-200 text-2xs font-medium">Квартиры на этаже</p>
                  {regularApartments.map((apartment) => {
                    const apartmentRoomsRaw = roomsByApartment.get(apartment.id) || [];
                    const apartmentRooms = isProductionMode
                      ? apartmentRoomsRaw.filter((room) => hasVisibleLocationSlots('room', room.id))
                      : apartmentRoomsRaw;
                    return (
                      <div key={apartment.id} className="rounded border border-white/10 bg-black/20 px-2 py-1.5">
                        <p className="text-zinc-200 text-2xs font-medium">Кв. {apartment.name}</p>
                        {renderLocationBlocks('apartment', apartment.id)}
                        {apartmentRooms.length ? (
                          <div className="mt-1 space-y-1">
                            {apartmentRooms.map((room) => (
                              <div key={room.id} className="px-1.5 py-1 rounded bg-zinc-800/80 text-zinc-300 text-[10px] leading-none space-y-1">
                                <p>Пом. {room.name}</p>
                                {renderLocationBlocks('room', room.id)}
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-zinc-500 text-2xs">Квартиры и помещения еще не добавлены</p>
          )
        )}
      </div>
    );
  };

  const renderObjectCards = () => {
    if (isProductionMode && productionEligibleSlotsCount === 0) {
      return (
        <p className="text-zinc-500 text-sm py-4">
          Для выбранного материала не найдено блоков с такой системой и категорией.
        </p>
      );
    }
    if (!filteredObjects.length) {
      return (
        <p className="text-zinc-500 text-sm py-4">
          По выбранным фильтрам нет объектов. Измените выбор фильтров.
        </p>
      );
    }

    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filteredObjects.map((objectRow) => {
          const objectEntrancesRaw = (entrancesByObject.get(objectRow.id) || [])
            .filter((entry) => !entranceIdSet.size || entranceIdSet.has(entry.id));
          const objectEntrances = isProductionMode
            ? objectEntrancesRaw.filter((entry) => {
              const entranceFloors = floorsByEntrance.get(entry.id) || [];
              return entranceFloors.some((floor) => {
                const floorApartments = apartmentsByFloor.get(floor.id) || [];
                return floorApartments.some((apartment) => {
                  if (apartment.name === FLOOR_ROOMS_BUCKET_NAME) {
                    return (roomsByApartment.get(apartment.id) || []).some((room) => hasVisibleLocationSlots('room', room.id));
                  }
                  if (hasVisibleLocationSlots('apartment', apartment.id)) return true;
                  return (roomsByApartment.get(apartment.id) || []).some((room) => hasVisibleLocationSlots('room', room.id));
                });
              });
            })
            : objectEntrancesRaw;
          let floorCount = 0;
          let apartmentCount = 0;
          let roomCount = 0;
          const entranceCountRows = [];
          objectEntrances.forEach((entry) => {
            const entranceCounts = getEntranceCounts(entry.id);
            floorCount += entranceCounts.floorsCount;
            apartmentCount += entranceCounts.apartmentsCount;
            roomCount += entranceCounts.roomsCount;
            entranceCountRows.push({
              entranceId: entry.id,
              entranceName: entry.name,
              ...entranceCounts,
            });
          });

          const equipmentCount = Number(objectRow.equipment_count || 0);
          const worksCount = Number(objectRow.works_count || 0);
          const objectScore = (equipmentCount * 2) + (worksCount * 2) + floorCount + (apartmentCount * 0.6) + (roomCount * 0.25);

          return (
            <article
              key={objectRow.id}
              className={`rounded-2xl border border-sky-500/30 bg-gradient-to-b from-sky-950/30 to-black/20 p-4 space-y-3 ${blockSizeClass('object', objectScore)}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="text-white font-semibold text-base">{objectRow.name}</h3>
                <div className="flex flex-wrap gap-1">
                  <span className="px-2 py-0.5 rounded-full text-2xs bg-emerald-500/20 text-emerald-300">
                    Оборудование: {equipmentCount}
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-2xs bg-amber-500/20 text-amber-300">
                    Работы: {worksCount}
                  </span>
                </div>
              </div>

              <p className="text-zinc-400 text-2xs">
                Подъезды: {objectEntrances.length} · Этажи: {floorCount} · Квартиры: {apartmentCount} · Помещения: {roomCount}
              </p>
              {!!entranceCountRows.length && (
                <div className="flex flex-wrap gap-1.5">
                  {entranceCountRows.map((row) => (
                    <span key={row.entranceId} className="px-2 py-0.5 rounded-full border border-emerald-500/35 bg-emerald-950/30 text-emerald-200 text-2xs">
                      Подъезд {row.entranceName}: Кв. {row.apartmentsCount} · Пом. {row.roomsCount}
                    </span>
                  ))}
                </div>
              )}

              {objectEntrances.length ? (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {objectEntrances.map((entry) => {
                    const entranceFloors = floorsByEntrance.get(entry.id) || [];
                    const entranceCounts = getEntranceCounts(entry.id);
                    const entranceApartments = entranceCounts.apartmentsCount;
                    const entranceRooms = entranceCounts.roomsCount;
                    const entranceScore = entranceFloors.length + (entranceApartments * 0.6) + (entranceRooms * 0.3);
                    return (
                      <section
                        key={entry.id}
                        className={`rounded-xl border border-emerald-500/25 bg-emerald-950/20 p-3 space-y-2 ${blockSizeClass('entrance', entranceScore)}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => setExpandedEntrance({
                              id: entry.id,
                              name: entry.name,
                              objectName: objectRow.name,
                            })}
                            className="text-emerald-200 text-sm font-medium hover:text-emerald-100 underline decoration-dotted underline-offset-2"
                            title="Открыть подъезд на весь экран"
                          >
                            Подъезд {entry.name}
                          </button>
                          <span className="text-2xs text-zinc-400">
                            Этажей: {entranceFloors.length} · Кв.: {entranceApartments} · Пом.: {entranceRooms}
                          </span>
                        </div>
                        {entranceFloors.length ? (
                          <div className="space-y-2">
                            {entranceFloors.map((floor) => {
                              const floorApartments = apartmentsByFloor.get(floor.id) || [];
                              const floorCounts = getFloorCounts(floor.id);
                              const floorRooms = floorCounts.roomsCount;
                              return renderFloorCard(floor, floorApartments, floorRooms);
                            })}
                          </div>
                        ) : (
                          <p className="text-zinc-500 text-xs">Этажи ещё не добавлены</p>
                        )}
                      </section>
                    );
                  })}
                </div>
              ) : (
                <p className="text-zinc-500 text-sm">Подъезды для объекта ещё не добавлены</p>
              )}
            </article>
          );
        })}
      </div>
    );
  };

  const activeSlot = editor.slotId ? slotById.get(editor.slotId) : null;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="page-title">Объекты</h2>
        {isProductionMode ? (
          <p className="text-zinc-300 text-sm mt-1">
            Режим выработки: выберите блоки с материалом и назначьте сотрудника + статус для выработки, затем нажмите «Сохранить».
          </p>
        ) : (
          <p className="text-zinc-400 text-sm mt-1">
            Блоки сгруппированы как в настройках объектов (Система → Категория). Клик по блоку открывает выбор статуса и исполнителя.
          </p>
        )}
      </div>

      {isProductionMode && (
        <div className="rounded-xl border border-sky-500/30 bg-sky-950/20 p-3 space-y-2">
          <p className="text-sky-200 text-sm font-medium">
            {productionMode.materialName || 'Материал'}{productionMode.materialCode ? ` (${productionMode.materialCode})` : ''}
          </p>
          <p className="text-zinc-400 text-2xs">
            Система: {productionMode.materialSystemName || '—'}
            {' · '}
            Категория: {productionMode.materialCategoryName || '—'}
          </p>
          <p className="text-zinc-300 text-xs">
            На руках: {Number(productionMode.availableQty || 0).toLocaleString('ru-RU', { maximumFractionDigits: 4 })} {productionMode.unit}
            {' · '}Запланировано: {plannedProductionQty.toLocaleString('ru-RU', { maximumFractionDigits: 4 })} {productionMode.unit}
            {' · '}Останется: {productionRemainingPreview.toLocaleString('ru-RU', { maximumFractionDigits: 4 })} {productionMode.unit}
          </p>
          <p className="text-zinc-400 text-2xs">
            Сотрудники: {(productionMode.selectedWorkers || []).map((row) => row.label).join(', ') || '—'}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary text-sm"
              onClick={saveProductionDistribution}
              disabled={productionBusy || !productionDraftRows.length}
            >
              {productionBusy ? 'Сохранение…' : 'Сохранить'}
            </button>
            <button
              type="button"
              className="btn-secondary text-sm"
              onClick={() => clearProductionMode()}
              disabled={productionBusy}
            >
              Отмена
            </button>
          </div>
          {productionError && <p className="text-rose-400 text-xs">{productionError}</p>}
          {productionMessage && <p className="text-emerald-300 text-xs">{productionMessage}</p>}
        </div>
      )}
      {!isProductionMode && productionMessage && (
        <p className="text-emerald-300 text-xs">{productionMessage}</p>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <MultiSelectFilter
          title="Фильтр объектов"
          options={objectOptions}
          selected={selectedObjects}
          onToggle={(id) => setSelectedObjects((prev) => toggleSelection(prev, id))}
          onClear={() => setSelectedObjects([])}
          getOptionLabel={(option) => option.name}
        />
        <MultiSelectFilter
          title="Фильтр подъездов"
          options={entranceOptions}
          selected={selectedEntrances}
          onToggle={(id) => setSelectedEntrances((prev) => toggleSelection(prev, id))}
          onClear={() => setSelectedEntrances([])}
          getOptionLabel={(option) => (option._objectName ? `${option._objectName} → ${option.name}` : option.name)}
        />
      </div>

      {!!(selectedObjects.length || selectedEntrances.length) && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-zinc-400 text-xs">Активные фильтры:</p>
          {selectedObjects.map((id) => {
            const objectName = objectOptions.find((o) => String(o.id) === id)?.name || id;
            return (
              <span key={`obj-${id}`} className="px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-300 text-2xs">
                Объект: {objectName}
              </span>
            );
          })}
          {selectedEntrances.map((id) => {
            const entrance = entranceOptions.find((o) => String(o.id) === id);
            const title = entrance ? (entrance._objectName ? `${entrance._objectName} → ${entrance.name}` : entrance.name) : id;
            return (
              <span key={`ent-${id}`} className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 text-2xs">
                Подъезд: {title}
              </span>
            );
          })}
          <button
            type="button"
            className="text-2xs text-zinc-400 hover:text-white"
            onClick={() => {
              setSelectedObjects([]);
              setSelectedEntrances([]);
            }}
          >
            Сбросить всё
          </button>
        </div>
      )}

      {error && <p className="text-rose-400 text-sm">{error}</p>}
      {loading ? <p className="text-zinc-500 text-sm">Загрузка схемы объектов…</p> : renderObjectCards()}

      {expandedEntrance && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm p-2 sm:p-4">
          <div className="h-full w-full rounded-2xl border border-emerald-500/30 bg-zinc-950 p-4 overflow-auto">
            <div className="sticky top-0 z-10 bg-zinc-950/95 backdrop-blur rounded-xl border border-white/10 p-3 mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-emerald-200 text-sm font-semibold">
                  {expandedEntrance.objectName} · Подъезд {expandedEntrance.name}
                </p>
                <p className="text-zinc-400 text-2xs">Расширенный режим отображения этажей</p>
              </div>
              <button
                type="button"
                onClick={() => setExpandedEntrance(null)}
                className="btn-secondary text-xs"
              >
                Закрыть
              </button>
            </div>
            <div className="space-y-2">
              {(floorsByEntrance.get(expandedEntrance.id) || []).map((floor) => {
                const floorApartments = apartmentsByFloor.get(floor.id) || [];
                const floorCounts = getFloorCounts(floor.id);
                const floorRooms = floorCounts.roomsCount;
                return renderFloorCard(floor, floorApartments, floorRooms, true);
              })}
              {!((floorsByEntrance.get(expandedEntrance.id) || []).length) && (
                <p className="text-zinc-500 text-sm">Для этого подъезда этажи ещё не добавлены</p>
              )}
            </div>
          </div>
        </div>
      )}

      {productionPicker && (
        <div className="modal-backdrop z-50" onClick={() => setProductionPicker(null)} role="dialog" aria-modal="true">
          <div className="card p-5 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-white font-medium text-lg">Параметры выработки</h3>
            <p className="text-zinc-400 text-xs mt-1">
              Блок #{productionPicker.slotId}
            </p>
            <div className="space-y-3 mt-4">
              <div>
                <label className="label">Статус выработки</label>
                <select
                  className="input"
                  value={productionPicker.statusId}
                  onChange={(e) => setProductionPicker((prev) => ({ ...prev, statusId: Number(e.target.value || 0) }))}
                >
                  <option value="">Выберите статус</option>
                  {productionStatuses.map((status) => (
                    <option key={status.id} value={status.id}>
                      {status.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Сотрудник</label>
                <select
                  className="input"
                  value={productionPicker.workerUserId}
                  onChange={(e) => setProductionPicker((prev) => ({ ...prev, workerUserId: Number(e.target.value || 0) }))}
                >
                  <option value="">Выберите сотрудника</option>
                  {(productionMode?.selectedWorkers || []).map((row) => (
                    <option key={row.id} value={row.id}>{row.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex justify-between gap-2">
                <button
                  type="button"
                  className="btn-ghost text-rose-300"
                  onClick={() => {
                    removeProductionDraft(productionPicker.slotId);
                    setProductionPicker(null);
                  }}
                >
                  Снять выбор
                </button>
                <div className="flex gap-2">
                  <button type="button" className="btn-secondary text-sm" onClick={() => setProductionPicker(null)}>
                    Отмена
                  </button>
                  <button type="button" className="btn-primary text-sm" onClick={saveProductionPicker}>
                    Применить
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {editor.open && activeSlot && (
        <div className="modal-backdrop z-50" onClick={closeSlotEditor} role="dialog" aria-modal="true">
          <div className="card p-5 max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-white font-medium text-lg">Статус блока</h3>
            <p className="text-zinc-400 text-sm mt-1">
              {activeSlot.system_name || 'Без системы'}
              {activeSlot.category_name ? ` · ${activeSlot.category_name}` : ''}
            </p>
            {editorError && <p className="text-rose-400 text-sm mt-3">{editorError}</p>}
            <form className="space-y-3 mt-4" onSubmit={saveSlotEditor}>
              <div>
                <label className="label">Статус</label>
                <select
                  className="input"
                  value={editor.statusId}
                  onChange={(e) => setEditor((prev) => ({ ...prev, statusId: e.target.value }))}
                >
                  <option value="">Без статуса</option>
                  {blockStatuses.map((status) => (
                    <option key={status.id} value={status.id}>
                      {status.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Исполнитель</label>
                <select
                  className="input"
                  value={editor.assigneeId}
                  onChange={(e) => setEditor((prev) => ({ ...prev, assigneeId: e.target.value }))}
                >
                  <option value="">Не назначен</option>
                  {assignableUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.full_name || user.login}
                      {user.full_name && user.login ? ` (${user.login})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              {!!editor.statusId && (
                <div className="text-xs text-zinc-300">
                  {(() => {
                    const status = statusesById.get(editor.statusId);
                    if (!status) return null;
                    const statusColor = status.color || DEFAULT_STATUS_COLOR;
                    return (
                      <span className="inline-flex items-center gap-2">
                        <span className="h-3.5 w-3.5 rounded-full border border-white/20" style={{ backgroundColor: statusColor }} />
                        Цвет блока: {statusColor}
                      </span>
                    );
                  })()}
                </div>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" className="btn-secondary text-sm" onClick={closeSlotEditor} disabled={editorBusy}>
                  Отмена
                </button>
                <button type="submit" className="btn-primary text-sm" disabled={editorBusy}>
                  {editorBusy ? 'Сохранение…' : 'Сохранить'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
