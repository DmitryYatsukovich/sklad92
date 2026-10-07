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
  material_balances: [],
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
    material_balances: normalizeList(safe.material_balances),
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

function toNullableFilterKey(value) {
  if (value == null || value === '') return 'none';
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return String(value);
  return String(parsed);
}

function normalizeIdList(values) {
  return [...new Set((values || []).map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))];
}

function areSameIdLists(a, b) {
  const left = normalizeIdList(a).sort((x, y) => x - y);
  const right = normalizeIdList(b).sort((x, y) => x - y);
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
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
  const [selectedFloors, setSelectedFloors] = useState([]);
  const [selectedSystems, setSelectedSystems] = useState([]);
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [selectedStatuses, setSelectedStatuses] = useState([]);
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
  const [editorProductionRows, setEditorProductionRows] = useState([]);
  const [editorProductionBusyIssuanceId, setEditorProductionBusyIssuanceId] = useState(null);
  const [editorProductionLoading, setEditorProductionLoading] = useState(false);
  const [editorProductionError, setEditorProductionError] = useState('');
  const [editorProductionMessage, setEditorProductionMessage] = useState('');
  const [productionMode, setProductionMode] = useState(null);
  const [productionCommitted, setProductionCommitted] = useState({});
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

  const loadProductionCommitted = useCallback(async (issuanceId) => {
    const id = Number(issuanceId || 0);
    if (!id) {
      setProductionCommitted({});
      return;
    }
    try {
      const rows = await operationsApi.productionDistribution(id);
      const grouped = {};
      (Array.isArray(rows) ? rows : []).forEach((row) => {
        const slotId = Number(row?.location_system_id || 0);
        if (!slotId) return;
        if (!grouped[slotId]) {
          grouped[slotId] = {
            locationSystemId: slotId,
            statusId: row?.status_id == null ? null : Number(row.status_id),
            statusName: row?.status_name || '',
            statusColor: row?.status_color || '',
            workerUserIds: normalizeIdList(row?.worker_user_ids),
            workerNames: Array.isArray(row?.worker_names) ? row.worker_names.filter(Boolean) : [],
            quantity: Number(row?.quantity || 0),
          };
          return;
        }
        const current = grouped[slotId];
        current.quantity += Number(row?.quantity || 0);
        current.workerUserIds = normalizeIdList([...current.workerUserIds, ...(row?.worker_user_ids || [])]);
        current.workerNames = [...new Set([...current.workerNames, ...((Array.isArray(row?.worker_names) ? row.worker_names : []).filter(Boolean))])];
        if (current.statusId == null && row?.status_id != null) {
          current.statusId = Number(row.status_id);
          current.statusName = row?.status_name || current.statusName;
          current.statusColor = row?.status_color || current.statusColor;
        }
      });
      setProductionCommitted(grouped);
    } catch {
      setProductionCommitted({});
    }
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
    setProductionCommitted({});
    setProductionDrafts({});
    setProductionBusy(false);
    setProductionError('');
    setProductionMessage('');
    setProductionPicker(null);
    navigate(location.pathname, { replace: true, state: {} });
  }, [location.pathname, location.state, navigate]);

  useEffect(() => {
    if (!productionMode?.issuanceId) {
      setProductionCommitted({});
      return;
    }
    void loadProductionCommitted(productionMode.issuanceId);
  }, [productionMode?.issuanceId, loadProductionCommitted]);

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
  const apartmentsById = useMemo(() => {
    const map = new Map();
    apartments.forEach((row) => map.set(Number(row.id), row));
    return map;
  }, [apartments]);
  const roomsById = useMemo(() => {
    const map = new Map();
    rooms.forEach((row) => map.set(Number(row.id), row));
    return map;
  }, [rooms]);
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
  const floorIdSet = useMemo(() => asIntSet(selectedFloors), [selectedFloors]);
  const systemFilterSet = useMemo(() => new Set(selectedSystems.map((value) => String(value))), [selectedSystems]);
  const categoryFilterSet = useMemo(() => new Set(selectedCategories.map((value) => String(value))), [selectedCategories]);
  const statusFilterSet = useMemo(() => new Set(selectedStatuses.map((value) => String(value))), [selectedStatuses]);
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
  const entranceById = useMemo(() => {
    const map = new Map();
    entrances.forEach((row) => map.set(Number(row.id), row));
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
  const floorById = useMemo(() => {
    const map = new Map();
    floors.forEach((row) => map.set(Number(row.id), row));
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
  const isProductionMode = !!productionMode;

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
  const floorOptions = useMemo(() => {
    const visibleEntrances = entranceIdSet.size
      ? new Set([...entranceIdSet])
      : null;
    const visibleObjects = objectIdSet.size
      ? new Set([...objectIdSet])
      : null;
    return floors
      .filter((floor) => {
        const entrance = entrances.find((entry) => entry.id === floor.entrance_id);
        if (!entrance) return false;
        if (visibleEntrances && !visibleEntrances.has(entrance.id)) return false;
        if (visibleObjects && !visibleObjects.has(entrance.object_id)) return false;
        return true;
      })
      .map((floor) => {
      const entrance = entrances.find((entry) => entry.id === floor.entrance_id);
      const objectName = objects.find((objectRow) => objectRow.id === entrance?.object_id)?.name || '';
      return {
        id: String(floor.id),
        name: floor.name,
        entranceName: entrance?.name || '',
        objectName,
      };
    })
      .sort((a, b) => (
        naturalCompare(a.objectName, b.objectName)
        || naturalCompare(a.entranceName, b.entranceName)
        || naturalCompare(a.name, b.name)
      ));
  }, [floors, entrances, objects, entranceIdSet, objectIdSet]);
  const systemOptions = useMemo(() => {
    const map = new Map();
    data.location_systems.forEach((slot) => {
      const key = toNullableFilterKey(slot.system_id);
      if (!map.has(key)) {
        map.set(key, {
          id: key,
          name: String(slot.system_name || '').trim() || 'Без системы',
        });
      }
    });
    return [...map.values()].sort((a, b) => naturalCompare(a.name, b.name));
  }, [data.location_systems]);
  const categoryOptions = useMemo(() => {
    const map = new Map();
    data.location_systems.forEach((slot) => {
      const key = toNullableFilterKey(slot.category_id);
      if (!map.has(key)) {
        map.set(key, {
          id: key,
          name: String(slot.category_name || '').trim() || 'Без категории',
        });
      }
    });
    return [...map.values()].sort((a, b) => naturalCompare(a.name, b.name));
  }, [data.location_systems]);
  const statusOptions = useMemo(() => {
    const options = blockStatuses.map((status) => ({
      id: String(status.id),
      name: status.name,
      color: status.color || DEFAULT_STATUS_COLOR,
    }));
    const hasNone = data.location_systems.some((slot) => slot.status_id == null);
    if (hasNone) {
      options.push({
        id: 'none',
        name: 'Без статуса',
        color: DEFAULT_STATUS_COLOR,
      });
    }
    return options;
  }, [blockStatuses, data.location_systems]);

  const slotLocationMetaById = useMemo(() => {
    const map = new Map();
    data.location_systems.forEach((slot) => {
      const slotId = Number(slot.id || 0);
      if (!slotId) return;
      let apartment = null;
      if (slot.location_kind === 'apartment') {
        apartment = apartmentsById.get(Number(slot.location_id || 0)) || null;
      } else if (slot.location_kind === 'room') {
        const room = roomsById.get(Number(slot.location_id || 0)) || null;
        apartment = room ? (apartmentsById.get(Number(room.apartment_id || 0)) || null) : null;
      }
      const floor = apartment ? (floorById.get(Number(apartment.floor_id || 0)) || null) : null;
      const entrance = floor ? (entranceById.get(Number(floor.entrance_id || 0)) || null) : null;
      map.set(slotId, {
        objectId: entrance ? Number(entrance.object_id || 0) : 0,
        entranceId: floor ? Number(floor.entrance_id || 0) : 0,
        floorId: apartment ? Number(apartment.floor_id || 0) : 0,
      });
    });
    return map;
  }, [
    data.location_systems,
    apartmentsById,
    roomsById,
    floorById,
    entranceById,
  ]);

  const slotFiltersActive = isProductionMode
    || !!selectedSystems.length
    || !!selectedCategories.length
    || !!selectedStatuses.length;

  const slotMatchesFilters = useCallback((slot) => {
    if (isProductionMode && !productionEligibleSlotIds.has(Number(slot.id))) return false;
    if (systemFilterSet.size && !systemFilterSet.has(toNullableFilterKey(slot.system_id))) return false;
    if (categoryFilterSet.size && !categoryFilterSet.has(toNullableFilterKey(slot.category_id))) return false;
    if (statusFilterSet.size && !statusFilterSet.has(toNullableFilterKey(slot.status_id))) return false;
    return true;
  }, [
    isProductionMode,
    productionEligibleSlotIds,
    systemFilterSet,
    categoryFilterSet,
    statusFilterSet,
  ]);

  const slotMatchesLayoutFilters = useCallback((slot) => {
    const slotId = Number(slot?.id || 0);
    if (!slotId) return false;
    const meta = slotLocationMetaById.get(slotId);
    if (objectIdSet.size && !objectIdSet.has(Number(meta?.objectId || 0))) return false;
    if (entranceIdSet.size && !entranceIdSet.has(Number(meta?.entranceId || 0))) return false;
    if (floorIdSet.size && !floorIdSet.has(Number(meta?.floorId || 0))) return false;
    return true;
  }, [slotLocationMetaById, objectIdSet, entranceIdSet, floorIdSet]);

  const hasVisibleLocationSlots = useCallback((locationKind, locationId) => {
    const slots = slotsByLocation.get(`${locationKind}:${locationId}`) || [];
    if (!slots.length) return false;
    return slots.some((slot) => slotMatchesLayoutFilters(slot) && slotMatchesFilters(slot));
  }, [slotsByLocation, slotMatchesLayoutFilters, slotMatchesFilters]);

  const isFloorVisible = useCallback((floorId) => {
    if (floorIdSet.size && !floorIdSet.has(Number(floorId))) return false;
    if (!slotFiltersActive) return true;
    const floorApartments = apartmentsByFloor.get(Number(floorId)) || [];
    const floorRoomsBucket = floorApartments.find((apartment) => apartment.name === FLOOR_ROOMS_BUCKET_NAME);
    const floorOnlyRooms = floorRoomsBucket ? (roomsByApartment.get(floorRoomsBucket.id) || []) : [];
    if (floorOnlyRooms.some((room) => hasVisibleLocationSlots('room', room.id))) return true;
    return floorApartments
      .filter((apartment) => apartment.name !== FLOOR_ROOMS_BUCKET_NAME)
      .some((apartment) => (
        hasVisibleLocationSlots('apartment', apartment.id)
        || (roomsByApartment.get(apartment.id) || []).some((room) => hasVisibleLocationSlots('room', room.id))
      ));
  }, [floorIdSet, slotFiltersActive, apartmentsByFloor, roomsByApartment, hasVisibleLocationSlots]);

  const filteredObjects = useMemo(() => {
    return objects.filter((objectRow) => {
      if (objectIdSet.size && !objectIdSet.has(objectRow.id)) return false;
      const objectEntrances = entrancesByObject.get(objectRow.id) || [];
      const filteredEntrances = objectEntrances.filter((entry) => !entranceIdSet.size || entranceIdSet.has(entry.id));
      if (!filteredEntrances.length) return false;
      return filteredEntrances.some((entry) => {
        const entranceFloors = floorsByEntrance.get(entry.id) || [];
        return entranceFloors.some((floor) => isFloorVisible(floor.id));
      });
    });
  }, [
    objects,
    objectIdSet,
    entranceIdSet,
    entrancesByObject,
    floorsByEntrance,
    isFloorVisible,
  ]);

  const toggleFloorCollapse = (floorId) => {
    setCollapsedFloors((prev) => toggleSelection(prev, floorId));
  };
  const visibleFloorIds = useMemo(() => {
    const ids = [];
    filteredObjects.forEach((objectRow) => {
      const objectEntrances = (entrancesByObject.get(objectRow.id) || [])
        .filter((entry) => !entranceIdSet.size || entranceIdSet.has(entry.id));
      objectEntrances.forEach((entry) => {
        (floorsByEntrance.get(entry.id) || []).forEach((floor) => {
          if (isFloorVisible(floor.id)) ids.push(Number(floor.id));
        });
      });
    });
    return [...new Set(ids)];
  }, [filteredObjects, entrancesByObject, entranceIdSet, floorsByEntrance, isFloorVisible]);
  const allVisibleFloorsCollapsed = useMemo(() => {
    if (!visibleFloorIds.length) return false;
    return visibleFloorIds.every((floorId) => collapsedFloorSet.has(Number(floorId)));
  }, [visibleFloorIds, collapsedFloorSet]);

  const toggleAllFloors = useCallback(() => {
    if (!visibleFloorIds.length) return;
    if (allVisibleFloorsCollapsed) {
      setCollapsedFloors((prev) => prev.filter((id) => !visibleFloorIds.includes(Number(id))));
      return;
    }
    setCollapsedFloors((prev) => {
      const next = new Set(prev.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0));
      visibleFloorIds.forEach((floorId) => next.add(Number(floorId)));
      return [...next].map((id) => String(id));
    });
  }, [visibleFloorIds, allVisibleFloorsCollapsed]);

  const materialBalanceById = useMemo(() => {
    const map = new Map();
    data.material_balances.forEach((row) => {
      const materialId = Number(row?.id || 0);
      if (!materialId) return;
      map.set(materialId, {
        warehouseQuantity: Number(row?.warehouse_quantity || 0),
        onHandsQuantity: Number(row?.on_hands_quantity || 0),
      });
    });
    return map;
  }, [data.material_balances]);

  const visibleSlotIds = useMemo(() => {
    const ids = new Set();
    data.location_systems.forEach((slot) => {
      if (!slotMatchesLayoutFilters(slot)) return;
      if (!slotMatchesFilters(slot)) return;
      ids.add(Number(slot.id));
    });
    return ids;
  }, [data.location_systems, slotMatchesLayoutFilters, slotMatchesFilters]);

  const needSummaryRows = useMemo(() => {
    const grouped = new Map();
    data.location_system_materials.forEach((row) => {
      const slotId = Number(row?.location_system_id || 0);
      if (!visibleSlotIds.has(slotId)) return;
      const materialId = Number(row?.material_id || 0);
      if (!materialId) return;
      const key = String(materialId);
      const existing = grouped.get(key) || {
        materialId,
        materialName: row?.material_name || `Материал #${materialId}`,
        materialUnit: row?.material_unit || '',
        systemName: row?.material_system_name || 'Без системы',
        categoryName: row?.material_category_name || 'Без категории',
        requiredQuantity: 0,
      };
      existing.requiredQuantity += Number(row?.quantity || 0);
      grouped.set(key, existing);
    });
    return [...grouped.values()]
      .map((row) => {
        const balances = materialBalanceById.get(Number(row.materialId)) || {
          warehouseQuantity: 0,
          onHandsQuantity: 0,
        };
        const availableTotal = Number(balances.warehouseQuantity || 0) + Number(balances.onHandsQuantity || 0);
        const needToOrder = Math.max(Number(row.requiredQuantity || 0) - availableTotal, 0);
        return {
          ...row,
          warehouseQuantity: Number(balances.warehouseQuantity || 0),
          onHandsQuantity: Number(balances.onHandsQuantity || 0),
          needToOrder,
        };
      })
      .sort((a, b) => (
        naturalCompare(a.systemName, b.systemName)
        || naturalCompare(a.categoryName, b.categoryName)
        || naturalCompare(a.materialName, b.materialName)
      ));
  }, [data.location_system_materials, visibleSlotIds, materialBalanceById]);

  const needSummaryBySystemCategory = useMemo(() => {
    const map = new Map();
    needSummaryRows.forEach((row) => {
      const key = `${row.systemName}:::${row.categoryName}`;
      const bucket = map.get(key) || {
        key,
        systemName: row.systemName,
        categoryName: row.categoryName,
        rows: [],
      };
      bucket.rows.push(row);
      map.set(key, bucket);
    });
    return [...map.values()].sort((a, b) => (
      naturalCompare(a.systemName, b.systemName)
      || naturalCompare(a.categoryName, b.categoryName)
    ));
  }, [needSummaryRows]);

  const openSlotEditor = (slot) => {
    setEditor({
      open: true,
      slotId: slot.id,
      statusId: slot.status_id == null ? '' : String(slot.status_id),
      assigneeId: slot.assigned_user_id == null ? '' : String(slot.assigned_user_id),
    });
    setEditorError('');
    setEditorProductionMessage('');
  };

  const closeSlotEditor = () => {
    setEditor({ open: false, slotId: null, statusId: '', assigneeId: '' });
    setEditorBusy(false);
    setEditorError('');
    setEditorProductionRows([]);
    setEditorProductionBusyIssuanceId(null);
    setEditorProductionLoading(false);
    setEditorProductionError('');
    setEditorProductionMessage('');
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

  const loadEditorProduction = useCallback(async (slotId) => {
    const id = Number(slotId || 0);
    if (!id) {
      setEditorProductionRows([]);
      return;
    }
    setEditorProductionLoading(true);
    setEditorProductionError('');
    try {
      const rows = await objectsApi.locationSystemProduction(id);
      setEditorProductionRows(Array.isArray(rows) ? rows : []);
    } catch (e) {
      setEditorProductionRows([]);
      setEditorProductionError(e.message || 'Не удалось загрузить историю выработки по блоку');
    } finally {
      setEditorProductionLoading(false);
    }
  }, []);

  const cancelEditorProduction = useCallback(async (issuanceId) => {
    const slotId = Number(editor.slotId || 0);
    if (!slotId) return;
    setEditorProductionBusyIssuanceId(Number(issuanceId) || null);
    setEditorProductionError('');
    setEditorProductionMessage('');
    try {
      const response = await objectsApi.cancelLocationSystemProduction(slotId, issuanceId);
      const restoredQty = Number(response?.restored_quantity || 0);
      await Promise.all([
        load({ silent: true }),
        loadEditorProduction(slotId),
      ]);
      setEditorProductionMessage(
        `Выработка отменена. Возвращено: ${restoredQty.toLocaleString('ru-RU', { maximumFractionDigits: 4 })}`,
      );
    } catch (e) {
      setEditorProductionError(e.message || 'Не удалось отменить выработку');
    } finally {
      setEditorProductionBusyIssuanceId(null);
    }
  }, [editor.slotId, load, loadEditorProduction]);

  useEffect(() => {
    if (!editor.open || !editor.slotId) return;
    void loadEditorProduction(editor.slotId);
  }, [editor.open, editor.slotId, loadEditorProduction]);

  const productionCommittedRows = useMemo(
    () => Object.values(productionCommitted),
    [productionCommitted],
  );
  const productionCommittedQty = useMemo(
    () => productionCommittedRows.reduce((sum, row) => sum + Number(row.quantity || 0), 0),
    [productionCommittedRows],
  );
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
    setProductionCommitted({});
    setProductionDrafts({});
    setProductionBusy(false);
    setProductionError('');
    if (!keepMessage) setProductionMessage('');
    setProductionPicker(null);
  };

  const applyProductionDraft = ({ slotId, statusId, workerUserIds }) => {
    const materialEntry = productionMaterialEntryBySlot.get(Number(slotId));
    if (!materialEntry) return;
    const normalizedWorkerIds = normalizeIdList(workerUserIds);
    if (!normalizedWorkerIds.length) return;
    setProductionDrafts((prev) => ({
      ...prev,
      [slotId]: {
        locationSystemId: Number(slotId),
        statusId: Number(statusId),
        workerUserIds: normalizedWorkerIds,
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
    const slotId = Number(slot.id);
    const draft = productionDrafts[slotId] || null;
    const committed = productionCommitted[slotId] || null;
    const fallbackStatus = productionStatuses[0]?.id || '';
    const fallbackWorkers = normalizeIdList((productionMode?.selectedWorkers || []).map((row) => row.id));
    const pickerWorkerIds = draft
      ? normalizeIdList(draft.workerUserIds)
      : committed
        ? normalizeIdList(committed.workerUserIds)
        : fallbackWorkers;
    setProductionPicker({
      slotId,
      statusId: draft?.statusId || committed?.statusId || fallbackStatus,
      workerUserIds: pickerWorkerIds,
      canCancelCommitted: !!committed,
      committedQuantity: Number(committed?.quantity || 0),
    });
  };

  const handleProductionSlotClick = (slot) => {
    if (!isProductionMode) {
      openSlotEditor(slot);
      return;
    }
    setProductionError('');
    setProductionMessage('');
    const slotId = Number(slot.id);
    const committed = productionCommitted[slotId] || null;
    const materialEntry = productionMaterialEntryBySlot.get(slotId);
    if (!materialEntry && !committed) {
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
    if (!committed && productionStatuses.length === 1) {
      const statusId = Number(productionStatuses[0].id);
      const workerUserIds = normalizeIdList(workers.map((row) => row.id));
      const existing = productionDrafts[slotId];
      if (
        existing
        && Number(existing.statusId) === statusId
        && areSameIdLists(existing.workerUserIds, workerUserIds)
      ) {
        removeProductionDraft(slotId);
      } else {
        applyProductionDraft({ slotId, statusId, workerUserIds });
      }
      return;
    }
    openProductionPickerForSlot(slot);
  };

  const togglePickerWorker = (workerId) => {
    const id = Number(workerId);
    if (!productionPicker || !id) return;
    setProductionPicker((prev) => {
      const currentIds = normalizeIdList(prev?.workerUserIds);
      const exists = currentIds.includes(id);
      return {
        ...prev,
        workerUserIds: exists
          ? currentIds.filter((value) => value !== id)
          : [...currentIds, id],
      };
    });
  };

  const saveProductionPicker = () => {
    if (!productionPicker) return;
    if (!Number(productionPicker.statusId) || !normalizeIdList(productionPicker.workerUserIds).length) {
      setProductionError('Выберите статус и хотя бы одного сотрудника');
      return;
    }
    applyProductionDraft({
      slotId: productionPicker.slotId,
      statusId: Number(productionPicker.statusId),
      workerUserIds: normalizeIdList(productionPicker.workerUserIds),
    });
    setProductionPicker(null);
  };

  const cancelProductionForSlot = async (slotId) => {
    if (!productionMode?.issuanceId) return;
    setProductionBusy(true);
    setProductionError('');
    setProductionMessage('');
    try {
      const response = await operationsApi.cancelProductionDistribution(productionMode.issuanceId, slotId);
      const restoredQty = Number(response?.restored_quantity || 0);
      setProductionMode((prev) => (
        prev
          ? {
            ...prev,
            availableQty: Number(prev.availableQty || 0) + restoredQty,
          }
          : prev
      ));
      await Promise.all([
        load({ silent: true }),
        loadProductionCommitted(productionMode.issuanceId),
      ]);
      removeProductionDraft(slotId);
      setProductionMessage('Выработка по блоку отменена. Количество возвращено во вкладку «Выдача».');
      setProductionPicker(null);
    } catch (e) {
      setProductionError(e.message || 'Не удалось отменить выработку по блоку');
    } finally {
      setProductionBusy(false);
    }
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
      const response = await operationsApi.distributeProduction(productionMode.issuanceId, {
        assignments: productionDraftRows.map((row) => ({
          location_system_id: row.locationSystemId,
          worker_user_ids: normalizeIdList(row.workerUserIds),
          status_id: row.statusId,
        })),
      });
      setProductionDrafts({});
      setProductionMode((prev) => (
        prev
          ? {
            ...prev,
            availableQty: Number(response?.remaining_on_hands ?? prev.availableQty ?? 0),
          }
          : prev
      ));
      await Promise.all([
        load({ silent: true }),
        loadProductionCommitted(productionMode.issuanceId),
      ]);
      setProductionMessage('Выработка сохранена и добавлена в блоки.');
    } catch (e) {
      setProductionError(e.message || 'Не удалось сохранить выработку');
    } finally {
      setProductionBusy(false);
    }
  };

  const renderLocationBlocks = (locationKind, locationId) => {
    let slots = slotsByLocation.get(`${locationKind}:${locationId}`) || [];
    slots = slots.filter((slot) => slotMatchesFilters(slot));
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
                    const committed = productionCommitted[slot.id] || null;
                    const activeStatusId = draft?.statusId ?? committed?.statusId ?? null;
                    const activeStatus = activeStatusId == null ? null : productionStatusById.get(Number(activeStatusId));
                    const activeWorkerNames = draft
                      ? normalizeIdList(draft.workerUserIds).map((id) => productionWorkersById.get(id) || `#${id}`).filter(Boolean)
                      : (committed?.workerNames || []);
                    const activeStatusName = activeStatus?.name || committed?.statusName || '';
                    const hasMaterialQty = productionMaterialEntryBySlot.has(Number(slot.id));
                    const selectionCaption = draft
                      ? [...activeWorkerNames, activeStatusName, 'черновик'].filter(Boolean).join(' · ')
                      : committed
                        ? [...activeWorkerNames, activeStatusName, 'выполнено'].filter(Boolean).join(' · ')
                        : (isProductionMode && !hasMaterialQty ? 'Нет количества материала' : '');
                    return (
                    <LocationSlotChip
                      key={slot.id}
                      slot={slot}
                      entries={entries}
                      onOpen={handleProductionSlotClick}
                      selected={!!draft || !!committed}
                      selectionCaption={selectionCaption}
                      selectionColor={activeStatus?.color || ''}
                      disabled={isProductionMode && !hasMaterialQty && !committed}
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
        if (!slotMatchesFilters(slot)) return;
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

  const renderFloorCard = (floor, floorApartments, floorRooms, compact = false) => {
    const isCollapsed = collapsedFloorSet.has(floor.id);
    const floorRoomsBucket = floorApartments.find((apartment) => apartment.name === FLOOR_ROOMS_BUCKET_NAME);
    const regularApartmentsRaw = floorApartments.filter((apartment) => apartment.name !== FLOOR_ROOMS_BUCKET_NAME);
    const floorOnlyRoomsRaw = floorRoomsBucket ? (roomsByApartment.get(floorRoomsBucket.id) || []) : [];
    const floorOnlyRooms = slotFiltersActive
      ? floorOnlyRoomsRaw.filter((room) => hasVisibleLocationSlots('room', room.id))
      : floorOnlyRoomsRaw;
    const regularApartments = slotFiltersActive
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
                    const apartmentRooms = slotFiltersActive
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
          const objectEntrances = objectEntrancesRaw
            .map((entry) => {
              const entranceFloors = (floorsByEntrance.get(entry.id) || []).filter((floor) => isFloorVisible(floor.id));
              return { ...entry, _visibleFloors: entranceFloors };
            })
            .filter((entry) => entry._visibleFloors.length > 0);
          let floorCount = 0;
          let apartmentCount = 0;
          let roomCount = 0;
          const entranceCountRows = [];
          objectEntrances.forEach((entry) => {
            const entranceCounts = entry._visibleFloors.reduce((acc, floor) => {
              const floorCounts = getFloorCounts(floor.id);
              acc.floorsCount += 1;
              acc.apartmentsCount += floorCounts.apartmentsCount;
              acc.roomsCount += floorCounts.roomsCount;
              return acc;
            }, {
              floorsCount: 0,
              apartmentsCount: 0,
              roomsCount: 0,
            });
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
                    const entranceFloors = entry._visibleFloors || [];
                    const entranceCounts = entranceFloors.reduce((acc, floor) => {
                      const floorCounts = getFloorCounts(floor.id);
                      acc.apartmentsCount += floorCounts.apartmentsCount;
                      acc.roomsCount += floorCounts.roomsCount;
                      return acc;
                    }, { apartmentsCount: 0, roomsCount: 0 });
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
            {' · '}Проведено: {productionCommittedQty.toLocaleString('ru-RU', { maximumFractionDigits: 4 })} {productionMode.unit}
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

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-zinc-400 text-xs">
          Фильтры по объектам, этажам и блокам
        </p>
        <button
          type="button"
          className="btn-secondary text-xs"
          onClick={toggleAllFloors}
          disabled={!visibleFloorIds.length}
        >
          {allVisibleFloorsCollapsed ? 'Развернуть все этажи' : 'Свернуть все этажи'}
        </button>
      </div>

      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
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
        <MultiSelectFilter
          title="Фильтр этажей"
          options={floorOptions}
          selected={selectedFloors}
          onToggle={(id) => setSelectedFloors((prev) => toggleSelection(prev, id))}
          onClear={() => setSelectedFloors([])}
          getOptionLabel={(option) => (
            option.objectName
              ? `${option.objectName} → Подъезд ${option.entranceName || '—'} → Этаж ${option.name}`
              : `Этаж ${option.name}`
          )}
        />
        <MultiSelectFilter
          title="Фильтр систем"
          options={systemOptions}
          selected={selectedSystems}
          onToggle={(id) => setSelectedSystems((prev) => toggleSelection(prev, id))}
          onClear={() => setSelectedSystems([])}
          getOptionLabel={(option) => option.name}
        />
        <MultiSelectFilter
          title="Фильтр категорий"
          options={categoryOptions}
          selected={selectedCategories}
          onToggle={(id) => setSelectedCategories((prev) => toggleSelection(prev, id))}
          onClear={() => setSelectedCategories([])}
          getOptionLabel={(option) => option.name}
        />
        <MultiSelectFilter
          title="Фильтр статусов"
          options={statusOptions}
          selected={selectedStatuses}
          onToggle={(id) => setSelectedStatuses((prev) => toggleSelection(prev, id))}
          onClear={() => setSelectedStatuses([])}
          getOptionLabel={(option) => option.name}
        />
      </div>

      {!!(
        selectedObjects.length
        || selectedEntrances.length
        || selectedFloors.length
        || selectedSystems.length
        || selectedCategories.length
        || selectedStatuses.length
      ) && (
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
          {selectedFloors.map((id) => {
            const floor = floorOptions.find((o) => String(o.id) === id);
            const title = floor
              ? `${floor.objectName ? `${floor.objectName} → ` : ''}Подъезд ${floor.entranceName || '—'} → Этаж ${floor.name}`
              : id;
            return (
              <span key={`floor-${id}`} className="px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-300 text-2xs">
                Этаж: {title}
              </span>
            );
          })}
          {selectedSystems.map((id) => {
            const systemName = systemOptions.find((o) => String(o.id) === id)?.name || id;
            return (
              <span key={`system-${id}`} className="px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 text-2xs">
                Система: {systemName}
              </span>
            );
          })}
          {selectedCategories.map((id) => {
            const categoryName = categoryOptions.find((o) => String(o.id) === id)?.name || id;
            return (
              <span key={`category-${id}`} className="px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 text-2xs">
                Категория: {categoryName}
              </span>
            );
          })}
          {selectedStatuses.map((id) => {
            const statusName = statusOptions.find((o) => String(o.id) === id)?.name || id;
            return (
              <span key={`status-${id}`} className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 text-2xs">
                Статус: {statusName}
              </span>
            );
          })}
          <button
            type="button"
            className="text-2xs text-zinc-400 hover:text-white"
            onClick={() => {
              setSelectedObjects([]);
              setSelectedEntrances([]);
              setSelectedFloors([]);
              setSelectedSystems([]);
              setSelectedCategories([]);
              setSelectedStatuses([]);
            }}
          >
            Сбросить всё
          </button>
        </div>
      )}

      <div className="rounded-xl border border-white/10 bg-surface-850/80 p-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-white text-sm font-semibold">Нужно для завершения</h3>
          <span className="text-zinc-400 text-2xs">
            Позиции: {needSummaryRows.length}
          </span>
        </div>
        {needSummaryBySystemCategory.length ? (
          <div className="space-y-2 max-h-[26rem] overflow-auto pr-1">
            {needSummaryBySystemCategory.map((group) => (
              <section key={group.key} className="rounded-lg border border-white/10 bg-black/20 p-2 space-y-1.5">
                <p className="text-zinc-200 text-2xs font-semibold">
                  {group.systemName} · {group.categoryName}
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs table-fixed">
                    <colgroup>
                      <col style={{ width: '38%' }} />
                      <col style={{ width: '15.5%' }} />
                      <col style={{ width: '15.5%' }} />
                      <col style={{ width: '15.5%' }} />
                      <col style={{ width: '15.5%' }} />
                    </colgroup>
                    <thead>
                      <tr className="text-zinc-500 border-b border-white/10">
                        <th className="text-left py-1 pr-2">Наименование</th>
                        <th className="text-right py-1 px-1 whitespace-nowrap">Нужно</th>
                        <th className="text-right py-1 px-1 whitespace-nowrap">На складе</th>
                        <th className="text-right py-1 px-1 whitespace-nowrap">На руках</th>
                        <th className="text-right py-1 pl-1 whitespace-nowrap">Заказать</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.rows.map((row) => {
                        const needDanger = Number(row.needToOrder || 0) > 0;
                        const nameWithUnit = row.materialUnit
                          ? `${row.materialName} (${row.materialUnit})`
                          : row.materialName;
                        return (
                          <tr key={row.materialId} className="border-b border-white/5 last:border-b-0">
                            <td className="py-1.5 pr-2 text-zinc-200 truncate" title={nameWithUnit}>
                              {nameWithUnit}
                            </td>
                            <td className="py-1.5 px-1 text-right tabular-nums text-zinc-200 whitespace-nowrap">
                              {Number(row.requiredQuantity || 0).toLocaleString('ru-RU', { maximumFractionDigits: 4 })}
                            </td>
                            <td className="py-1.5 px-1 text-right tabular-nums text-zinc-300 whitespace-nowrap">
                              {Number(row.warehouseQuantity || 0).toLocaleString('ru-RU', { maximumFractionDigits: 4 })}
                            </td>
                            <td className="py-1.5 px-1 text-right tabular-nums text-sky-300 whitespace-nowrap">
                              {Number(row.onHandsQuantity || 0).toLocaleString('ru-RU', { maximumFractionDigits: 4 })}
                            </td>
                            <td className={`py-1.5 pl-1 text-right tabular-nums font-semibold whitespace-nowrap ${needDanger ? 'text-rose-400' : 'text-emerald-300'}`}>
                              {Number(row.needToOrder || 0).toLocaleString('ru-RU', { maximumFractionDigits: 4 })}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>
        ) : (
          <p className="text-zinc-500 text-xs">По выбранным фильтрам нет материалов для расчёта.</p>
        )}
      </div>

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
              {(floorsByEntrance.get(expandedEntrance.id) || []).filter((floor) => isFloorVisible(floor.id)).map((floor) => {
                const floorApartments = apartmentsByFloor.get(floor.id) || [];
                const floorCounts = getFloorCounts(floor.id);
                const floorRooms = floorCounts.roomsCount;
                return renderFloorCard(floor, floorApartments, floorRooms, true);
              })}
              {!((floorsByEntrance.get(expandedEntrance.id) || []).filter((floor) => isFloorVisible(floor.id)).length) && (
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
            {productionPicker.canCancelCommitted && (
              <p className="text-amber-300 text-2xs mt-1">
                В блоке уже проведена выработка: {Number(productionPicker.committedQuantity || 0).toLocaleString('ru-RU', { maximumFractionDigits: 4 })} {productionMode?.unit || 'шт'}
              </p>
            )}
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
                <label className="label">Исполнители</label>
                <div className="max-h-44 overflow-y-auto rounded-lg border border-white/10 bg-black/20 p-2 space-y-1">
                  {(productionMode?.selectedWorkers || []).map((row) => {
                    const selected = normalizeIdList(productionPicker.workerUserIds).includes(Number(row.id));
                    return (
                      <label
                        key={row.id}
                        className="flex items-start gap-2 text-sm text-zinc-200 cursor-pointer hover:bg-white/5 rounded px-1 py-0.5"
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={selected}
                          onChange={() => togglePickerWorker(row.id)}
                        />
                        <span>{row.label}</span>
                      </label>
                    );
                  })}
                </div>
                <p className="text-zinc-500 text-2xs mt-1">
                  Выбрано: {normalizeIdList(productionPicker.workerUserIds).length}
                </p>
              </div>
              <div className="flex justify-between gap-2">
                <button
                  type="button"
                  className="btn-ghost text-rose-300"
                  onClick={() => {
                    if (productionPicker.canCancelCommitted) {
                      void cancelProductionForSlot(productionPicker.slotId);
                      return;
                    }
                    removeProductionDraft(productionPicker.slotId);
                    setProductionPicker(null);
                  }}
                >
                  {productionPicker.canCancelCommitted ? 'Отменить выработку' : 'Снять выбор'}
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
          <div className="card p-5 max-w-2xl w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-white font-medium text-lg">Статус блока</h3>
            <p className="text-zinc-400 text-sm mt-1">
              {activeSlot.system_name || 'Без системы'}
              {activeSlot.category_name ? ` · ${activeSlot.category_name}` : ''}
            </p>
            {editorError && <p className="text-rose-400 text-sm mt-3">{editorError}</p>}
            <div className="mt-4 rounded-lg border border-white/10 bg-black/20 p-3 space-y-2">
              <p className="text-zinc-200 text-xs font-semibold">Проведенная выработка по блоку</p>
              {editorProductionLoading ? (
                <p className="text-zinc-500 text-2xs">Загрузка…</p>
              ) : editorProductionRows.length ? (
                <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                  {editorProductionRows.map((row) => (
                    <div key={`${row.issuance_id}-${row.last_created_at}`} className="rounded border border-white/10 bg-black/20 px-2 py-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-zinc-200 text-2xs">
                          Выдача #{row.issuance_id} · {row.material_name || 'Материал'}
                          {row.material_code ? ` (${row.material_code})` : ''}
                        </p>
                        <button
                          type="button"
                          className="btn-ghost text-rose-300 text-2xs"
                          disabled={editorProductionBusyIssuanceId === Number(row.issuance_id)}
                          onClick={() => void cancelEditorProduction(Number(row.issuance_id))}
                        >
                          {editorProductionBusyIssuanceId === Number(row.issuance_id) ? 'Отмена…' : 'Отменить выработку'}
                        </button>
                      </div>
                      <p className="text-zinc-400 text-2xs mt-1">
                        Кол-во: {Number(row.quantity || 0).toLocaleString('ru-RU', { maximumFractionDigits: 4 })} {row.material_unit || ''}
                      </p>
                      {!!(row.worker_names || []).length && (
                        <p className="text-zinc-400 text-2xs mt-0.5">Исполнители: {row.worker_names.join(', ')}</p>
                      )}
                      {!!(row.status_names || []).length && (
                        <p className="text-zinc-400 text-2xs mt-0.5">Статусы: {row.status_names.join(', ')}</p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-zinc-500 text-2xs">По этому блоку проведенной выработки нет.</p>
              )}
              {editorProductionError && <p className="text-rose-400 text-2xs">{editorProductionError}</p>}
              {editorProductionMessage && <p className="text-emerald-300 text-2xs">{editorProductionMessage}</p>}
            </div>
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
