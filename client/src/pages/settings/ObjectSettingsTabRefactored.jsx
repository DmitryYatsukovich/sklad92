import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { settings as settingsApi } from '../../api';

const FLOOR_ROOMS_BUCKET_NAME = 'Помещения этажа';

function naturalCompare(a, b) {
  return String(a || '').localeCompare(String(b || ''), 'ru', { numeric: true, sensitivity: 'base' });
}

function normalizeNameKey(value) {
  return String(value || '').trim().toLowerCase();
}

function formatQty(value) {
  return Number(value || 0).toLocaleString('ru-RU', { maximumFractionDigits: 4 });
}

function parseDecimalInput(value) {
  const normalized = String(value ?? '').trim().replace(',', '.');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function floorSortRank(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function getVisibleRangeSpanRows(visibleFloors, minRank, maxRank) {
  let startIndex = -1;
  let endIndex = -1;
  visibleFloors.forEach((floorRow, index) => {
    const rank = floorSortRank(floorRow?.sort_order);
    if (rank < minRank || rank > maxRank) return;
    if (startIndex === -1) startIndex = index;
    endIndex = index;
  });
  if (startIndex === -1 || endIndex === -1) return null;
  return {
    startRow: startIndex + 1,
    endRow: endIndex + 2,
  };
}

function slotCompleteness(slot, entryNames = []) {
  const hasSystem = Boolean(String(slot?.system_name || '').trim());
  const hasCategory = Boolean(String(slot?.category_name || '').trim());
  const hasEntryName = entryNames.some((name) => Boolean(String(name || '').trim()));
  const missing = [];
  if (!hasSystem) missing.push('система');
  if (!hasCategory) missing.push('категория');
  if (!hasEntryName) missing.push('название');
  return {
    hasSystem,
    hasCategory,
    hasEntryName,
    isIncomplete: missing.length > 0,
    missing,
  };
}

function toggleSelection(list, value) {
  const key = String(value ?? '');
  if (!key) return list;
  return list.includes(key) ? list.filter((x) => x !== key) : [...list, key];
}

function asObjects(value) {
  return Array.isArray(value) ? value.filter((row) => row && typeof row === 'object') : [];
}

function normalizePayload(payload) {
  const safe = payload && typeof payload === 'object' ? payload : {};
  return {
    objects: asObjects(safe.objects),
    entrances: asObjects(safe.entrances),
    floors: asObjects(safe.floors),
    apartments: asObjects(safe.apartments),
    rooms: asObjects(safe.rooms),
    transits: asObjects(safe.transits),
    stairwells: asObjects(safe.stairwells),
    systems: asObjects(safe.systems),
    categories: asObjects(safe.categories),
    locationSystems: asObjects(safe.location_systems),
    locationSystemMaterials: asObjects(safe.location_system_materials),
    locationSystemEquipment: asObjects(safe.location_system_equipment),
    locationSystemWorks: asObjects(safe.location_system_works),
    transitCableLines: asObjects(safe.transit_cable_lines),
  };
}

function getLocationKindTitle(kind) {
  if (kind === 'room') return 'Помещение';
  if (kind === 'apartment') return 'Квартира';
  if (kind === 'transit') return 'Транзит';
  if (kind === 'stairwell') return 'Лестничная клетка';
  return 'Локация';
}

function SystemSquare({
  slot,
  onOpen,
  totals,
  incomplete = false,
  selectionMode = false,
  selected = false,
  selectionEnabled = true,
  selectionTone = 'default',
  onToggleSelect,
}) {
  const entriesPreview = Array.isArray(slot.entryNames) ? slot.entryNames.filter(Boolean) : [];
  const previewText = entriesPreview.length ? entriesPreview.slice(0, 2).join(', ') : 'Позиции не добавлены';
  const previewCount = entriesPreview.length;
  const tooltip = `${slot.system_name || 'Без системы'}${slot.category_name ? ` • ${slot.category_name}` : ''}${slot.missingFieldsText ? `\nНе заполнено: ${slot.missingFieldsText}` : ''}`;
  const systemShort = String(slot.system_name || 'Сист').slice(0, 5);
  const selectedRingClass = selectionTone === 'cable' ? 'ring-cyan-300/80' : 'ring-white/70';
  const idleRingClass = selectionTone === 'cable' ? 'ring-cyan-400/30' : 'ring-white/25';
  const disabledSelectionClass = selectionMode && !selectionEnabled ? 'opacity-45 cursor-not-allowed' : '';
  return (
    <button
      type="button"
      data-slot-id={slot.id}
      data-slot-location-kind={slot.location_kind}
      data-slot-location-id={slot.location_id}
      onClick={() => {
        if (selectionMode) {
          if (!selectionEnabled) return;
          onToggleSelect?.(slot);
          return;
        }
        onOpen(slot);
      }}
      className={`relative w-[2.45rem] h-[2.45rem] rounded-md border p-0.5 text-left transition hover:bg-white/10 hover:shadow-[0_6px_14px_rgba(0,0,0,0.24)] shadow-[0_3px_8px_rgba(0,0,0,0.18)] ${incomplete ? 'border-rose-500/70 bg-rose-950/35 text-rose-100' : 'border-white/15 bg-zinc-900/80 text-zinc-100'} ${selectionMode ? (selected ? `ring-2 ${selectedRingClass}` : `ring-1 ${idleRingClass}`) : ''} ${disabledSelectionClass}`}
      title={tooltip}
    >
      {selectionMode && (
        <span
          className={`absolute top-1 right-1 h-3.5 w-3.5 rounded-full border ${selected ? 'bg-white border-white' : 'bg-transparent border-white/60'} ${!selectionEnabled ? 'opacity-40' : ''}`}
          aria-hidden="true"
        />
      )}
      <div className="flex h-full flex-col justify-between">
        <div className="space-y-0.5">
          <p className="text-[4.5px] font-semibold leading-tight truncate tracking-wide uppercase">{systemShort}</p>
          <p className="text-[4.5px] text-zinc-400 leading-tight truncate">{slot.category_name || 'Без'}</p>
        </div>
        <div className="space-y-0.5">
          <p className="text-[4.5px] text-zinc-200/90 leading-tight truncate">{previewText}</p>
          <p className="inline-flex rounded-full border border-white/15 px-0.5 py-0.5 text-[4.5px] text-zinc-300 leading-tight">
            {totals?.positions || previewCount || 0} поз.
          </p>
        </div>
      </div>
    </button>
  );
}

function MultiSelectFilter({ label, options, selectedValues, onToggle }) {
  const selectedCount = selectedValues.length;
  return (
    <details className="filter-field relative w-full sm:w-56 rounded-lg border border-white/10 bg-zinc-900/70 px-2.5 py-2">
      <summary className="cursor-pointer list-none select-none">
        <span className="inline-flex w-full items-center justify-between gap-2">
          <span className="truncate text-xs text-zinc-200 font-medium">{label}</span>
          <span className="text-zinc-500 text-[10px] rounded-full border border-white/10 px-1.5 py-0.5">
            {selectedCount ? `${selectedCount}` : '▼'}
          </span>
        </span>
      </summary>
      <div className="absolute left-0 right-0 z-30 mt-1 w-full max-h-64 overflow-y-auto rounded-lg border border-white/10 bg-surface-900 p-2 shadow-xl">
        {options.length === 0 && (
          <p className="px-1 py-1 text-2xs text-zinc-500">Нет вариантов</p>
        )}
        {options.map((option) => (
          <label
            key={option.value}
            className="flex items-center gap-2 px-1 py-1.5 text-[11px] text-zinc-200 hover:bg-white/5 rounded"
          >
            <input
              type="checkbox"
              checked={selectedValues.includes(option.value)}
              onChange={() => onToggle(option.value)}
            />
            <span className="truncate">{option.label}</span>
          </label>
        ))}
      </div>
    </details>
  );
}

export default function ObjectSettingsTabRefactored() {
  const [data, setData] = useState(normalizePayload({}));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [collapsedFloors, setCollapsedFloors] = useState([]);

  const [slotModalOpen, setSlotModalOpen] = useState(false);
  const [activeSlot, setActiveSlot] = useState(null);
  const [slotDraft, setSlotDraft] = useState({ locationKind: '', locationId: null, title: '' });
  const [slotSystemId, setSlotSystemId] = useState('');
  const [slotCategoryId, setSlotCategoryId] = useState('');
  const [entryQuery, setEntryQuery] = useState('');
  const [stockSuggestions, setStockSuggestions] = useState([]);
  const [stockSuggestionLoading, setStockSuggestionLoading] = useState(false);
  const [selectedMaterial, setSelectedMaterial] = useState(null);
  const [entryQuantity, setEntryQuantity] = useState('1');
  const [slotBusy, setSlotBusy] = useState(false);
  const [slotCableModalOpen, setSlotCableModalOpen] = useState(false);
  const [slotCableDraft, setSlotCableDraft] = useState(null);
  const [slotCableBusy, setSlotCableBusy] = useState(false);
  const [slotCablePlanPick, setSlotCablePlanPick] = useState(null);
  const [copiedSlotTemplate, setCopiedSlotTemplate] = useState(null);
  const [copiedLocationTemplate, setCopiedLocationTemplate] = useState(null);
  const [copiedFloorTemplate, setCopiedFloorTemplate] = useState(null);
  const [pasteBusyKey, setPasteBusyKey] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedSystemIds, setSelectedSystemIds] = useState([]);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState([]);
  const [selectedApartmentScopes, setSelectedApartmentScopes] = useState([]);
  const [selectedRoomNames, setSelectedRoomNames] = useState([]);
  const [multiCopyLocationKey, setMultiCopyLocationKey] = useState('');
  const [multiCopySelectedSlotIds, setMultiCopySelectedSlotIds] = useState([]);
  const [summaryEditOpen, setSummaryEditOpen] = useState(false);
  const [summaryEditTarget, setSummaryEditTarget] = useState(null);
  const [summaryEditName, setSummaryEditName] = useState('');
  const [summaryEditSystemId, setSummaryEditSystemId] = useState('');
  const [summaryEditCategoryId, setSummaryEditCategoryId] = useState('');
  const [summaryEditBusy, setSummaryEditBusy] = useState(false);
  const [activeCableTransitId, setActiveCableTransitId] = useState(null);
  const [cableDraft, setCableDraft] = useState({
    lineId: null,
    routeMode: 'transit',
    transitId: '',
    fromSlotId: null,
    toSlotId: null,
    systemId: '',
    categoryId: '',
    name: '',
    lengthM: '',
  });
  const [cableBusy, setCableBusy] = useState(false);
  const [cablePickTarget, setCablePickTarget] = useState('');
  const [cableStockSuggestions, setCableStockSuggestions] = useState([]);
  const [cableStockSuggestionLoading, setCableStockSuggestionLoading] = useState(false);
  const [cableSelectedMaterial, setCableSelectedMaterial] = useState(null);
  const [cableEditModalOpen, setCableEditModalOpen] = useState(false);
  const [cableEditDraft, setCableEditDraft] = useState(null);
  const [cableEditBusy, setCableEditBusy] = useState(false);
  const [cableEditPickTarget, setCableEditPickTarget] = useState('');
  const entranceGridRefs = useRef(new Map());
  const [entranceCableOverlay, setEntranceCableOverlay] = useState({});
  const [hoveredCableLine, setHoveredCableLine] = useState(null);
  const [entranceFloorHeights, setEntranceFloorHeights] = useState({});
  const mergeTransitCableLine = useCallback((prevLines, nextLine) => {
    const safePrev = Array.isArray(prevLines) ? prevLines : [];
    if (!nextLine?.id) return safePrev;
    const merged = [
      ...safePrev.filter((line) => String(line.id) !== String(nextLine.id)),
      nextLine,
    ];
    merged.sort((a, b) => (
      (Number.parseInt(a?.transit_id, 10) || 0) - (Number.parseInt(b?.transit_id, 10) || 0)
      || (Number.parseInt(a?.id, 10) || 0) - (Number.parseInt(b?.id, 10) || 0)
    ));
    return merged;
  }, []);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const payload = await settingsApi.objectSettings.layout();
      setData(normalizePayload(payload));
    } catch (e) {
      setError(e.message || 'Ошибка загрузки настроек объектов');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onPointerDown = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.filter-field')) return;
      document.querySelectorAll('.filter-field[open]').forEach((node) => {
        node.removeAttribute('open');
      });
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  useEffect(() => {
    if (activeCableTransitId || cableEditModalOpen) {
      setHoveredCableLine(null);
    }
  }, [activeCableTransitId, cableEditModalOpen]);

  useEffect(() => {
    if (!cableEditPickTarget || cableEditModalOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      setCableEditPickTarget('');
      setCableEditModalOpen(true);
      setNotice('Выбор на схеме отменен.');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cableEditPickTarget, cableEditModalOpen]);

  const sortedObjects = useMemo(() => [...data.objects].sort((a, b) => naturalCompare(a.name, b.name)), [data.objects]);
  const sortedEntrances = useMemo(() => [...data.entrances].sort((a, b) => (
    naturalCompare(a.object_name, b.object_name) || naturalCompare(a.name, b.name)
  )), [data.entrances]);
  const sortedFloors = useMemo(() => [...data.floors].sort((a, b) => (
    naturalCompare(a.object_name, b.object_name)
    || naturalCompare(a.entrance_name, b.entrance_name)
    || ((a.sort_order ?? Number.MAX_SAFE_INTEGER) - (b.sort_order ?? Number.MAX_SAFE_INTEGER))
    || naturalCompare(a.name, b.name)
  )), [data.floors]);
  const sortedApartments = useMemo(() => [...data.apartments].sort((a, b) => (
    naturalCompare(a.object_name, b.object_name)
    || naturalCompare(a.entrance_name, b.entrance_name)
    || ((a.floor_sort_order ?? Number.MAX_SAFE_INTEGER) - (b.floor_sort_order ?? Number.MAX_SAFE_INTEGER))
    || naturalCompare(a.floor_name, b.floor_name)
    || naturalCompare(a.name, b.name)
  )), [data.apartments]);
  const sortedRooms = useMemo(() => [...data.rooms].sort((a, b) => (
    naturalCompare(a.object_name, b.object_name)
    || naturalCompare(a.entrance_name, b.entrance_name)
    || ((a.floor_sort_order ?? Number.MAX_SAFE_INTEGER) - (b.floor_sort_order ?? Number.MAX_SAFE_INTEGER))
    || naturalCompare(a.floor_name, b.floor_name)
    || naturalCompare(a.apartment_name, b.apartment_name)
    || naturalCompare(a.name, b.name)
  )), [data.rooms]);
  const sortedTransits = useMemo(() => [...data.transits].sort((a, b) => (
    naturalCompare(a.object_name, b.object_name)
    || naturalCompare(a.entrance_name, b.entrance_name)
    || ((a.from_floor_sort_order ?? Number.MAX_SAFE_INTEGER) - (b.from_floor_sort_order ?? Number.MAX_SAFE_INTEGER))
    || ((a.to_floor_sort_order ?? Number.MAX_SAFE_INTEGER) - (b.to_floor_sort_order ?? Number.MAX_SAFE_INTEGER))
    || naturalCompare(a.name, b.name)
  )), [data.transits]);
  const sortedStairwells = useMemo(() => [...data.stairwells].sort((a, b) => (
    naturalCompare(a.object_name, b.object_name)
    || naturalCompare(a.entrance_name, b.entrance_name)
    || ((a.from_floor_sort_order ?? Number.MAX_SAFE_INTEGER) - (b.from_floor_sort_order ?? Number.MAX_SAFE_INTEGER))
    || ((a.to_floor_sort_order ?? Number.MAX_SAFE_INTEGER) - (b.to_floor_sort_order ?? Number.MAX_SAFE_INTEGER))
    || naturalCompare(a.name, b.name)
  )), [data.stairwells]);

  const collapsedFloorSet = useMemo(() => new Set(
    collapsedFloors
      .map((v) => Number.parseInt(v, 10))
      .filter((v) => Number.isInteger(v) && v > 0),
  ), [collapsedFloors]);

  const entrancesByObject = useMemo(() => {
    const map = new Map();
    sortedEntrances.forEach((row) => {
      const list = map.get(row.object_id) || [];
      list.push(row);
      map.set(row.object_id, list);
    });
    return map;
  }, [sortedEntrances]);

  const floorsByEntrance = useMemo(() => {
    const map = new Map();
    sortedFloors.forEach((row) => {
      const list = map.get(row.entrance_id) || [];
      list.push(row);
      map.set(row.entrance_id, list);
    });
    return map;
  }, [sortedFloors]);

  const apartmentsByFloor = useMemo(() => {
    const map = new Map();
    sortedApartments.forEach((row) => {
      const list = map.get(row.floor_id) || [];
      list.push(row);
      map.set(row.floor_id, list);
    });
    return map;
  }, [sortedApartments]);

  const roomsByApartment = useMemo(() => {
    const map = new Map();
    sortedRooms.forEach((row) => {
      const list = map.get(row.apartment_id) || [];
      list.push(row);
      map.set(row.apartment_id, list);
    });
    return map;
  }, [sortedRooms]);

  const transitsByEntrance = useMemo(() => {
    const map = new Map();
    sortedTransits.forEach((row) => {
      const list = map.get(row.entrance_id) || [];
      list.push(row);
      map.set(row.entrance_id, list);
    });
    return map;
  }, [sortedTransits]);

  const stairwellsByEntrance = useMemo(() => {
    const map = new Map();
    sortedStairwells.forEach((row) => {
      const list = map.get(row.entrance_id) || [];
      list.push(row);
      map.set(row.entrance_id, list);
    });
    return map;
  }, [sortedStairwells]);

  const roomNameById = useMemo(() => {
    const map = new Map();
    sortedRooms.forEach((row) => map.set(row.id, row.name));
    return map;
  }, [sortedRooms]);

  const systemFilterOptions = useMemo(
    () => [...data.systems]
      .sort((a, b) => naturalCompare(a.name, b.name))
      .map((system) => ({ value: String(system.id), label: system.name })),
    [data.systems],
  );

  const categoryFilterOptions = useMemo(
    () => [...data.categories]
      .sort((a, b) => naturalCompare(a.name, b.name))
      .map((category) => ({ value: String(category.id), label: category.name })),
    [data.categories],
  );

  const apartmentFilterOptions = useMemo(
    () => [{ value: 'all', label: 'Все квартиры' }],
    [],
  );

  const roomFilterOptions = useMemo(() => {
    const names = new Map();
    data.locationSystems.forEach((slot) => {
      if (slot.location_kind !== 'room') return;
      const roomName = roomNameById.get(slot.location_id);
      const key = normalizeNameKey(roomName);
      if (!key || names.has(key)) return;
      names.set(key, roomName);
    });
    return [...names.entries()]
      .sort((a, b) => naturalCompare(a[1], b[1]))
      .map(([value, label]) => ({ value, label }));
  }, [data.locationSystems, roomNameById]);

  const hasSlotFilters = selectedSystemIds.length > 0
    || selectedCategoryIds.length > 0
    || selectedApartmentScopes.length > 0
    || selectedRoomNames.length > 0;

  const slotMatchesFilters = useCallback((slot) => {
    if (!slot) return false;
    if (selectedSystemIds.length && !selectedSystemIds.includes(String(slot.system_id || ''))) return false;
    if (selectedCategoryIds.length && !selectedCategoryIds.includes(String(slot.category_id || ''))) return false;
    const apartmentsSelected = selectedApartmentScopes.includes('all');
    if (apartmentsSelected || selectedRoomNames.length) {
      if (slot.location_kind === 'apartment') {
        if (!apartmentsSelected) return false;
      } else if (slot.location_kind === 'room') {
        if (!selectedRoomNames.length) return false;
        const roomNameKey = normalizeNameKey(roomNameById.get(slot.location_id));
        if (!selectedRoomNames.includes(roomNameKey)) return false;
      } else {
        return false;
      }
    }
    return true;
  }, [selectedSystemIds, selectedCategoryIds, selectedApartmentScopes, selectedRoomNames, roomNameById]);
  const slotMatchesLocationScope = useCallback((slot) => {
    if (!slot) return false;
    const apartmentsSelected = selectedApartmentScopes.includes('all');
    const hasRoomFilters = selectedRoomNames.length > 0;
    const hasLocationFilters = apartmentsSelected || hasRoomFilters;
    if (!hasLocationFilters) return true;
    if (slot.location_kind === 'apartment') return apartmentsSelected;
    if (slot.location_kind === 'room') {
      if (!hasRoomFilters) return false;
      const roomNameKey = normalizeNameKey(roomNameById.get(slot.location_id));
      return selectedRoomNames.includes(roomNameKey);
    }
    return false;
  }, [selectedApartmentScopes, selectedRoomNames, roomNameById]);
  const lineMatchesActiveFilters = useCallback((line) => {
    if (!line) return false;
    const lineSystemKey = line.system_id == null ? '' : String(line.system_id);
    const lineCategoryKey = line.category_id == null ? '' : String(line.category_id);
    if (selectedSystemIds.length && !selectedSystemIds.includes(lineSystemKey)) return false;
    if (selectedCategoryIds.length && !selectedCategoryIds.includes(lineCategoryKey)) return false;
    const apartmentsSelected = selectedApartmentScopes.includes('all');
    const hasRoomFilters = selectedRoomNames.length > 0;
    const hasLocationFilters = apartmentsSelected || hasRoomFilters;
    if (!hasLocationFilters) return true;
    const resolveSlot = (slotIdRaw) => (
      slotById.get(slotIdRaw)
      || slotById.get(Number.parseInt(slotIdRaw, 10))
      || null
    );
    const fromSlot = resolveSlot(line.from_location_system_id);
    const toSlot = resolveSlot(line.to_location_system_id);
    return slotMatchesLocationScope(fromSlot) || slotMatchesLocationScope(toSlot);
  }, [
    selectedSystemIds,
    selectedCategoryIds,
    selectedApartmentScopes,
    selectedRoomNames,
    slotById,
    slotMatchesLocationScope,
  ]);

  const slotsByLocation = useMemo(() => {
    const map = new Map();
    data.locationSystems.forEach((slot) => {
      const key = `${slot.location_kind}:${slot.location_id}`;
      const list = map.get(key) || [];
      list.push(slot);
      map.set(key, list);
    });
    return map;
  }, [data.locationSystems]);

  const materialsBySlot = useMemo(() => {
    const map = new Map();
    data.locationSystemMaterials.forEach((row) => {
      const list = map.get(row.location_system_id) || [];
      list.push(row);
      map.set(row.location_system_id, list);
    });
    map.forEach((list, key) => map.set(key, [...list].sort((a, b) => naturalCompare(a.material_name, b.material_name))));
    return map;
  }, [data.locationSystemMaterials]);

  const equipmentBySlot = useMemo(() => {
    const map = new Map();
    data.locationSystemEquipment.forEach((row) => {
      const list = map.get(row.location_system_id) || [];
      list.push(row);
      map.set(row.location_system_id, list);
    });
    map.forEach((list, key) => map.set(key, [...list].sort((a, b) => naturalCompare(a.name, b.name))));
    return map;
  }, [data.locationSystemEquipment]);

  const worksBySlot = useMemo(() => {
    const map = new Map();
    data.locationSystemWorks.forEach((row) => {
      const list = map.get(row.location_system_id) || [];
      list.push(row);
      map.set(row.location_system_id, list);
    });
    map.forEach((list, key) => map.set(key, [...list].sort((a, b) => naturalCompare(a.name, b.name))));
    return map;
  }, [data.locationSystemWorks]);

  const slotById = useMemo(() => {
    const map = new Map();
    data.locationSystems.forEach((slot) => map.set(slot.id, slot));
    return map;
  }, [data.locationSystems]);

  const apartmentById = useMemo(() => {
    const map = new Map();
    sortedApartments.forEach((row) => map.set(row.id, row));
    return map;
  }, [sortedApartments]);

  const roomById = useMemo(() => {
    const map = new Map();
    sortedRooms.forEach((row) => map.set(row.id, row));
    return map;
  }, [sortedRooms]);
  const transitById = useMemo(() => {
    const map = new Map();
    sortedTransits.forEach((row) => map.set(row.id, row));
    return map;
  }, [sortedTransits]);
  const stairwellById = useMemo(() => {
    const map = new Map();
    sortedStairwells.forEach((row) => map.set(row.id, row));
    return map;
  }, [sortedStairwells]);
  const transitCableLinesByTransit = useMemo(() => {
    const map = new Map();
    data.transitCableLines.forEach((line) => {
      const transitId = Number.parseInt(line.transit_id, 10);
      if (!transitId) return;
      const list = map.get(transitId) || [];
      list.push(line);
      map.set(transitId, list);
    });
    map.forEach((list, key) => {
      map.set(key, [...list].sort((a, b) => naturalCompare(a.name, b.name) || (a.id - b.id)));
    });
    return map;
  }, [data.transitCableLines]);
  const transitCableLineById = useMemo(() => {
    const map = new Map();
    data.transitCableLines.forEach((line) => {
      map.set(String(line.id), line);
    });
    return map;
  }, [data.transitCableLines]);
  const transitLaneDemandById = useMemo(() => {
    const map = new Map();
    data.transitCableLines.forEach((line) => {
      if (!lineMatchesActiveFilters(line)) return;
      const transitId = Number.parseInt(line.transit_id, 10);
      if (!transitId) return;
      map.set(transitId, (map.get(transitId) || 0) + 1);
    });
    return map;
  }, [data.transitCableLines, lineMatchesActiveFilters]);
  const cableEndpointSlotIdSet = useMemo(() => {
    const set = new Set();
    data.transitCableLines.forEach((line) => {
      const fromId = Number.parseInt(line.from_location_system_id, 10);
      const toId = Number.parseInt(line.to_location_system_id, 10);
      if (fromId) set.add(fromId);
      if (toId) set.add(toId);
    });
    return set;
  }, [data.transitCableLines]);

  const slotPlacementById = useMemo(() => {
    const map = new Map();
    data.locationSystems.forEach((slot) => {
      let location = null;
      if (slot.location_kind === 'apartment') location = apartmentById.get(slot.location_id) || null;
      if (slot.location_kind === 'room') location = roomById.get(slot.location_id) || null;
      if (slot.location_kind === 'transit') location = transitById.get(slot.location_id) || null;
      if (slot.location_kind === 'stairwell') location = stairwellById.get(slot.location_id) || null;
      if (!location) return;
      map.set(slot.id, { slot, location });
    });
    return map;
  }, [data.locationSystems, apartmentById, roomById, transitById, stairwellById]);

  const getSlotEntries = useCallback((slotId) => {
    const rows = [];
    (materialsBySlot.get(slotId) || []).forEach((row) => {
      rows.push({
        source: 'material',
        id: row.id,
        key: `material:${row.id}`,
        name: row.material_name,
        quantity: Number(row.quantity || 0),
        unit: row.material_unit || '',
        materialId: row.material_id,
      });
    });
    (equipmentBySlot.get(slotId) || []).forEach((row) => {
      rows.push({
        source: 'equipment',
        id: row.id,
        key: `equipment:${row.id}`,
        name: row.name,
        quantity: Number(row.quantity || 0),
        unit: '',
      });
    });
    (worksBySlot.get(slotId) || []).forEach((row) => {
      rows.push({
        source: 'work',
        id: row.id,
        key: `work:${row.id}`,
        name: row.name,
        quantity: Number(row.quantity || 0),
        unit: '',
      });
    });
    return rows.sort((a, b) => naturalCompare(a.name, b.name));
  }, [materialsBySlot, equipmentBySlot, worksBySlot]);

  const buildSlotTemplate = useCallback((slot) => {
    const entries = getSlotEntries(slot.id).map((entry) => ({
      source: entry.source,
      name: entry.name,
      quantity: Number(entry.quantity || 0),
      materialId: entry.materialId || null,
    }));
    return {
      systemId: slot.system_id,
      systemName: slot.system_name,
      categoryId: slot.category_id ?? null,
      categoryName: slot.category_name || '',
      entries,
    };
  }, [getSlotEntries]);

  const getLocationSlotTemplates = useCallback((locationKind, locationId) => {
    const slots = slotsByLocation.get(`${locationKind}:${locationId}`) || [];
    return slots.map((slot) => buildSlotTemplate(slot));
  }, [slotsByLocation, buildSlotTemplate]);

  const pasteEntryToSlot = useCallback(async (locationSystemId, entry) => {
    const quantity = Number(entry.quantity || 0);
    if (!entry.name || !Number.isFinite(quantity) || quantity <= 0) return;

    if (entry.source === 'material' && entry.materialId) {
      try {
        await settingsApi.objectSettings.addMaterial(locationSystemId, {
          material_id: entry.materialId,
          quantity,
        });
        return;
      } catch {
        // Материал мог быть удалён/изменён после копирования — сохраняем позицию как ручную.
        await settingsApi.objectSettings.addEquipment(locationSystemId, {
          name: entry.name,
          quantity,
        });
        return;
      }
    }

    if (entry.source === 'work') {
      await settingsApi.objectSettings.addWork(locationSystemId, {
        name: entry.name,
        quantity,
      });
      return;
    }

    await settingsApi.objectSettings.addEquipment(locationSystemId, {
      name: entry.name,
      quantity,
    });
  }, []);

  const cloneSlotTemplateToLocation = useCallback(async (locationKind, locationId, slotTemplate) => {
    const created = await settingsApi.objectSettings.createLocationSystem({
      location_kind: locationKind,
      location_id: locationId,
      system_id: slotTemplate.systemId,
      category_id: slotTemplate.categoryId,
    });
    for (const entry of slotTemplate.entries || []) {
      await pasteEntryToSlot(created.id, entry);
    }
    return created;
  }, [pasteEntryToSlot]);

  const objectSummaryById = useMemo(() => {
    const summary = new Map();
    const ensureObject = (objectId) => {
      if (!objectId) return null;
      if (!summary.has(objectId)) summary.set(objectId, { entriesMap: new Map() });
      return summary.get(objectId);
    };
    const getSlotObjectId = (slot) => {
      if (!slot) return null;
      if (slot.location_kind === 'apartment') return apartmentById.get(slot.location_id)?.object_id || null;
      if (slot.location_kind === 'room') return roomById.get(slot.location_id)?.object_id || null;
      if (slot.location_kind === 'transit') return transitById.get(slot.location_id)?.object_id || null;
      if (slot.location_kind === 'stairwell') return stairwellById.get(slot.location_id)?.object_id || null;
      return null;
    };
    const pushEntry = ({
      objectId,
      source = 'slot',
      slot,
      name,
      quantity,
      unit = '',
      systemIdValue = null,
      systemNameValue = '',
      categoryIdValue = null,
      categoryNameValue = '',
      slotIdValue = null,
    }) => {
      const target = ensureObject(objectId);
      if (!target) return;
      const nameKey = normalizeNameKey(name);
      if (!nameKey) return;
      const systemIdRaw = systemIdValue ?? slot?.system_id ?? '';
      const systemId = systemIdRaw == null ? '' : String(systemIdRaw);
      const systemName = systemNameValue || slot?.system_name || 'Без системы';
      const key = `${source}::${systemId}::${nameKey}`;
      const prev = target.entriesMap.get(key) || {
        key,
        source,
        name: String(name || '').trim(),
        systemId,
        systemName,
        quantity: 0,
        unit: '',
        slotIdsSet: new Set(),
        categoriesMap: new Map(),
      };
      prev.quantity += Number(quantity || 0);
      if (!prev.unit && unit) prev.unit = unit;
      const slotId = slotIdValue ?? slot?.id ?? null;
      if (slotId) prev.slotIdsSet.add(slotId);
      const categoryIdRaw = categoryIdValue ?? slot?.category_id ?? null;
      const categoryKey = categoryIdRaw == null ? '' : String(categoryIdRaw);
      if (!prev.categoriesMap.has(categoryKey)) {
        prev.categoriesMap.set(categoryKey, {
          id: categoryKey,
          name: categoryNameValue || slot?.category_name || 'Без категории',
        });
      }
      target.entriesMap.set(key, prev);
    };

    data.locationSystemMaterials.forEach((row) => {
      const slot = slotById.get(row.location_system_id);
      if (!slotMatchesFilters(slot)) return;
      const objectId = getSlotObjectId(slot);
      pushEntry({
        objectId,
        source: 'slot',
        slot,
        name: row.material_name,
        quantity: row.quantity,
        unit: row.material_unit || '',
      });
    });
    data.locationSystemEquipment.forEach((row) => {
      const slot = slotById.get(row.location_system_id);
      if (!slotMatchesFilters(slot)) return;
      const objectId = getSlotObjectId(slot);
      pushEntry({
        objectId,
        source: 'slot',
        slot,
        name: row.name,
        quantity: row.quantity,
      });
    });
    data.locationSystemWorks.forEach((row) => {
      const slot = slotById.get(row.location_system_id);
      if (!slotMatchesFilters(slot)) return;
      const objectId = getSlotObjectId(slot);
      pushEntry({
        objectId,
        source: 'slot',
        slot,
        name: row.name,
        quantity: row.quantity,
      });
    });

    data.transitCableLines.forEach((line) => {
      const resolveSlot = (slotIdRaw) => (
        slotById.get(slotIdRaw)
        || slotById.get(Number.parseInt(slotIdRaw, 10))
        || null
      );
      const fromSlot = resolveSlot(line.from_location_system_id);
      const toSlot = resolveSlot(line.to_location_system_id);
      if (!fromSlot || !toSlot) return;
      if (!lineMatchesActiveFilters(line)) return;

      const transitObjectId = line.transit_id ? transitById.get(Number(line.transit_id))?.object_id : null;
      const objectId = transitObjectId || getSlotObjectId(fromSlot) || getSlotObjectId(toSlot);
      if (!objectId) return;
      pushEntry({
        objectId,
        source: 'cable',
        name: line.name,
        quantity: Number(line.length_m || 0),
        unit: 'м',
        systemIdValue: line.system_id ?? null,
        systemNameValue: line.system_name || 'Без системы',
        categoryIdValue: line.category_id ?? null,
        categoryNameValue: line.category_name || 'Без категории',
      });
    });

    const prepared = new Map();
    summary.forEach((raw, objectId) => {
      const entries = [...raw.entriesMap.values()]
        .map((row) => ({
          key: row.key,
          source: row.source,
          name: row.name,
          quantity: row.quantity,
          unit: row.unit,
          slotIds: [...row.slotIdsSet.values()],
          systems: [{ id: row.systemId, name: row.systemName }],
          categories: [...row.categoriesMap.values()].sort((a, b) => naturalCompare(a.name, b.name)),
        }))
        .sort((a, b) => (
          naturalCompare(a.systems[0]?.name || '', b.systems[0]?.name || '')
          || naturalCompare(a.name, b.name)
        ));
      prepared.set(objectId, {
        entries,
        totalQty: entries.reduce((acc, row) => acc + Number(row.quantity || 0), 0),
      });
    });
    return prepared;
  }, [
    data.locationSystemMaterials,
    data.locationSystemEquipment,
    data.locationSystemWorks,
    data.transitCableLines,
    slotById,
    apartmentById,
    roomById,
    transitById,
    stairwellById,
    slotMatchesFilters,
    lineMatchesActiveFilters,
  ]);

  const knownManualEntries = useMemo(() => {
    const map = new Map();
    [...data.locationSystemEquipment, ...data.locationSystemWorks].forEach((row) => {
      const name = String(row?.name || '').trim();
      if (!name) return;
      const key = normalizeNameKey(name);
      const prev = map.get(key) || { key, name, usage: 0 };
      prev.usage += 1;
      map.set(key, prev);
    });
    return [...map.values()].sort((a, b) => ((b.usage - a.usage) || naturalCompare(a.name, b.name)));
  }, [data.locationSystemEquipment, data.locationSystemWorks]);

  const manualSuggestions = useMemo(() => {
    const query = normalizeNameKey(entryQuery);
    if (!query) return [];
    return knownManualEntries
      .filter((row) => normalizeNameKey(row.name).includes(query))
      .slice(0, 20);
  }, [entryQuery, knownManualEntries]);

  const mergedSuggestions = useMemo(() => {
    const merged = new Map();
    stockSuggestions.forEach((row) => {
      const key = normalizeNameKey(row?.name);
      if (!key || merged.has(key)) return;
      merged.set(key, {
        key: `stock:${row.id}`,
        kind: 'stock',
        name: row.name,
        unit: row.unit || '',
        quantity: row.quantity,
        material: row,
      });
    });
    manualSuggestions.forEach((row) => {
      const key = normalizeNameKey(row?.name);
      if (!key || merged.has(key)) return;
      merged.set(key, {
        key: `manual:${key}`,
        kind: 'manual',
        name: row.name,
        usage: row.usage || 0,
      });
    });
    return [...merged.values()].slice(0, 30);
  }, [stockSuggestions, manualSuggestions]);

  const resetEntryEditor = useCallback(() => {
    setEntryQuery('');
    setStockSuggestions([]);
    setStockSuggestionLoading(false);
    setSelectedMaterial(null);
    setEntryQuantity('1');
  }, []);

  const openCreateSlotModal = (locationKind, locationId, title) => {
    setActiveSlot(null);
    setSlotDraft({ locationKind, locationId, title });
    setSlotSystemId('');
    setSlotCategoryId('');
    setSlotModalOpen(true);
    resetEntryEditor();
  };

  const openSlotModal = (slot) => {
    setActiveSlot(slot);
    setSlotDraft({
      locationKind: slot.location_kind,
      locationId: slot.location_id,
      title: slot.locationTitle || getLocationKindTitle(slot.location_kind),
    });
    setSlotSystemId(String(slot.system_id || ''));
    setSlotCategoryId(slot.category_id == null ? '' : String(slot.category_id));
    setSlotModalOpen(true);
    resetEntryEditor();
  };

  const closeSlotModal = () => {
    setSlotModalOpen(false);
    setSlotCableModalOpen(false);
    setSlotCableDraft(null);
    setSlotCableBusy(false);
    setSlotCablePlanPick(null);
    setActiveSlot(null);
    setSlotDraft({ locationKind: '', locationId: null, title: '' });
    setSlotSystemId('');
    setSlotCategoryId('');
    resetEntryEditor();
  };

  const closeSlotCableModal = useCallback((options = {}) => {
    const force = Boolean(options?.force);
    if (slotCableBusy && !force) return;
    setSlotCableModalOpen(false);
    setSlotCableDraft(null);
    setSlotCablePlanPick(null);
  }, [slotCableBusy]);

  const activeSlotPlacement = useMemo(
    () => (activeSlot?.id ? (slotPlacementById.get(activeSlot.id) || null) : null),
    [activeSlot?.id, slotPlacementById],
  );
  const activeSlotCableAnchor = activeSlotPlacement?.location
    ? {
      object_id: Number(activeSlotPlacement.location.object_id || 0),
      entrance_id: Number(activeSlotPlacement.location.entrance_id || 0),
    }
    : null;
  const slotCableTransitOptions = activeSlotCableAnchor?.entrance_id
    ? (transitsByEntrance.get(activeSlotCableAnchor.entrance_id) || [])
    : [];
  const slotCableSelectableSlots = useMemo(() => {
    if (!activeSlot?.id || !activeSlotCableAnchor?.entrance_id) return [];
    return data.locationSystems
      .filter((slot) => ['apartment', 'room'].includes(slot.location_kind))
      .filter((slot) => Number(slot.id) !== Number(activeSlot.id))
      .filter((slot) => {
        const placement = slotPlacementById.get(slot.id);
        const location = placement?.location;
        if (!location) return false;
        return (
          Number(location.object_id || 0) === Number(activeSlotCableAnchor.object_id || 0)
          && Number(location.entrance_id || 0) === Number(activeSlotCableAnchor.entrance_id || 0)
        );
      })
      .sort((a, b) => {
        const placementA = slotPlacementById.get(a.id);
        const placementB = slotPlacementById.get(b.id);
        const rankA = floorSortRank({ sort_order: placementA?.location?.floor_sort_order });
        const rankB = floorSortRank({ sort_order: placementB?.location?.floor_sort_order });
        return (
          (rankA - rankB)
          || naturalCompare(placementA?.location?.apartment_name || '', placementB?.location?.apartment_name || '')
          || naturalCompare(placementA?.location?.name || '', placementB?.location?.name || '')
          || naturalCompare(a.system_name || '', b.system_name || '')
          || (a.id - b.id)
        );
      });
  }, [activeSlot?.id, activeSlotCableAnchor, data.locationSystems, slotPlacementById]);

  const openSlotCableModal = useCallback(() => {
    if (!activeSlot?.id) return;
    if (!['apartment', 'room'].includes(activeSlot.location_kind)) {
      setError('Соединять кабелем можно только блоки квартир и помещений');
      return;
    }
    if (!activeSlotCableAnchor?.entrance_id) {
      setError('Не удалось определить подъезд текущего блока');
      return;
    }
    const hasTransitOptions = slotCableTransitOptions.length > 0;
    setSlotCableDraft({
      routeMode: hasTransitOptions ? 'transit' : 'direct',
      transitId: hasTransitOptions ? String(slotCableTransitOptions[0].id) : '',
      toSlotId: '',
      name: 'Кабель',
      lengthM: '1',
      systemId: '',
      categoryId: '',
    });
    setSlotCablePlanPick(null);
    setError('');
    setSlotCableModalOpen(true);
  }, [activeSlot, activeSlotCableAnchor, slotCableTransitOptions]);

  const handleSlotCablePickOnPlanStart = useCallback(() => {
    if (!activeSlot?.id || !slotCableDraft) return;
    setSlotCablePlanPick({
      fromSlotId: activeSlot.id,
      draft: { ...slotCableDraft },
    });
    setSlotCableModalOpen(false);
    setSlotModalOpen(false);
    setNotice('Режим выбора: нажмите на блок на плане, с которым нужно соединить.');
    setError('');
  }, [activeSlot, slotCableDraft]);

  const handleCancelSlotCablePlanPick = useCallback(() => {
    setSlotCablePlanPick(null);
    setNotice('');
  }, []);

  const handleSystemSquareOpen = useCallback((slot) => {
    if (!slotCablePlanPick?.fromSlotId) {
      openSlotModal(slot);
      return;
    }
    const fromSlot = slotById.get(slotCablePlanPick.fromSlotId);
    if (!fromSlot) {
      setSlotCablePlanPick(null);
      openSlotModal(slot);
      return;
    }
    if (Number(slot.id) === Number(fromSlot.id)) {
      setError('Нельзя соединить блок сам с собой');
      return;
    }
    const fromPlacement = slotPlacementById.get(fromSlot.id);
    const toPlacement = slotPlacementById.get(slot.id);
    const sameScope = (
      Number(fromPlacement?.location?.object_id || 0) === Number(toPlacement?.location?.object_id || 0)
      && Number(fromPlacement?.location?.entrance_id || 0) === Number(toPlacement?.location?.entrance_id || 0)
    );
    if (!sameScope) {
      setError('Выберите блок в том же подъезде');
      return;
    }
    openSlotModal(fromSlot);
    setSlotCableDraft((prev) => ({
      ...(slotCablePlanPick.draft || prev || {}),
      toSlotId: String(slot.id),
    }));
    setSlotCablePlanPick(null);
    setSlotCableModalOpen(true);
    setNotice('Блок для соединения выбран.');
    setError('');
  }, [slotCablePlanPick, slotById, slotPlacementById]);

  const handleSaveSlotCableConnection = async (e, options = {}) => {
    e.preventDefault();
    const keepOpen = Boolean(options?.keepOpen);
    if (!activeSlot?.id || !slotCableDraft) return;
    const routeMode = slotCableDraft.routeMode === 'direct' ? 'direct' : 'transit';
    const transitIdParsed = Number.parseInt(slotCableDraft.transitId, 10);
    const transitId = routeMode === 'transit' ? (transitIdParsed || null) : null;
    const toSlotId = Number.parseInt(slotCableDraft.toSlotId, 10);
    const name = String(slotCableDraft.name || '').trim();
    const lengthM = parseDecimalInput(slotCableDraft.lengthM);
    const systemId = slotCableDraft.systemId === '' ? null : Number.parseInt(slotCableDraft.systemId, 10);
    const categoryId = slotCableDraft.categoryId === '' ? null : Number.parseInt(slotCableDraft.categoryId, 10);
    if (routeMode === 'transit' && !transitId) return setError('Выберите транзит для маршрута');
    if (!toSlotId) return setError('Выберите второй блок для соединения');
    if (Number(toSlotId) === Number(activeSlot.id)) return setError('Нельзя соединить блок сам с собой');
    if (!name) return setError('Укажите название кабельной линии');
    if (!Number.isFinite(lengthM) || lengthM <= 0) return setError('Укажите корректную длину кабеля');
    if (slotCableDraft.systemId !== '' && !systemId) return setError('Выберите корректную систему кабельной линии');
    if (slotCableDraft.categoryId !== '' && !categoryId) return setError('Выберите корректную категорию');

    setSlotCableBusy(true);
    setError('');
    try {
      const createdLine = await settingsApi.objectSettings.createCableLine({
        transit_id: transitId,
        from_location_system_id: activeSlot.id,
        to_location_system_id: toSlotId,
        system_id: systemId,
        category_id: categoryId,
        name,
        length_m: lengthM,
      });
      setData((prev) => ({
        ...prev,
        transitCableLines: mergeTransitCableLine(prev.transitCableLines, createdLine),
      }));
      revealCableSlotFloor(activeSlot.id);
      revealCableSlotFloor(toSlotId);
      if (keepOpen) {
        setSlotCableDraft((prev) => ({
          ...prev,
          toSlotId: '',
        }));
        setNotice('Кабельная линия сохранена. Можно добавить следующее соединение.');
      } else {
        setNotice('Кабельная линия сохранена.');
        closeSlotCableModal({ force: true });
      }
    } catch (err) {
      setError(err.message || 'Не удалось сохранить кабельную линию');
    } finally {
      setSlotCableBusy(false);
    }
  };

  const handleSaveSlotMeta = async (e) => {
    e.preventDefault();
    const systemId = Number.parseInt(slotSystemId, 10);
    const categoryId = slotCategoryId ? Number.parseInt(slotCategoryId, 10) : null;
    if (!systemId) return setError('Выберите систему');
    if (slotCategoryId && !categoryId) return setError('Неверная категория');
    if (!slotDraft.locationKind || !slotDraft.locationId) return setError('Локация не выбрана');

    setSlotBusy(true);
    setError('');
    try {
      let saved;
      if (activeSlot?.id) {
        saved = await settingsApi.objectSettings.updateLocationSystem(activeSlot.id, {
          system_id: systemId,
          category_id: categoryId,
        });
      } else {
        saved = await settingsApi.objectSettings.createLocationSystem({
          location_kind: slotDraft.locationKind,
          location_id: slotDraft.locationId,
          system_id: systemId,
          category_id: categoryId,
        });
      }
      setActiveSlot(saved);
      setSlotSystemId(String(saved.system_id || ''));
      setSlotCategoryId(saved.category_id == null ? '' : String(saved.category_id));
      await load({ silent: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSlotBusy(false);
    }
  };

  useEffect(() => {
    if (!slotModalOpen || !activeSlot?.id) return undefined;
    const chosenSystemId = Number.parseInt(slotSystemId, 10) || Number(activeSlot.system_id || 0);
    if (!chosenSystemId) return undefined;
    const query = entryQuery.trim();
    if (!query) {
      setStockSuggestions([]);
      setStockSuggestionLoading(false);
      return undefined;
    }
    const chosenCategoryId = slotCategoryId === ''
      ? (activeSlot.category_id || null)
      : (Number.parseInt(slotCategoryId, 10) || null);
    const timer = setTimeout(() => {
      setStockSuggestionLoading(true);
      settingsApi.objectSettings.materialSuggestions(
        chosenSystemId,
        query,
        chosenCategoryId,
      )
        .then((rows) => setStockSuggestions(Array.isArray(rows) ? rows : []))
        .catch(() => setStockSuggestions([]))
        .finally(() => setStockSuggestionLoading(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [
    slotModalOpen,
    activeSlot?.id,
    activeSlot?.system_id,
    activeSlot?.category_id,
    slotSystemId,
    slotCategoryId,
    entryQuery,
  ]);

  const handleDeleteSlot = async () => {
    if (!activeSlot?.id) return;
    if (!confirm(`Удалить блок системы «${activeSlot.system_name}»?`)) return;
    setSlotBusy(true);
    setError('');
    try {
      await settingsApi.objectSettings.deleteLocationSystem(activeSlot.id);
      closeSlotModal();
      await load({ silent: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSlotBusy(false);
    }
  };

  const handleAddEntry = async (e) => {
    e.preventDefault();
    if (!activeSlot?.id) return;

    const qty = Number.parseFloat(entryQuantity);
    if (!Number.isFinite(qty) || qty <= 0) return setError('Количество должно быть больше нуля');

    const textName = String(entryQuery || '').trim();
    if (!textName) return setError('Введите название позиции');

    setSlotBusy(true);
    setError('');
    try {
      const typedNameKey = normalizeNameKey(textName);
      const selectedNameKey = normalizeNameKey(selectedMaterial?.name);
      if (selectedMaterial?.id && typedNameKey && typedNameKey === selectedNameKey) {
        await settingsApi.objectSettings.addMaterial(activeSlot.id, {
          material_id: selectedMaterial.id,
          quantity: qty,
        });
      } else {
        await settingsApi.objectSettings.addEquipment(activeSlot.id, {
          name: textName,
          quantity: qty,
        });
      }
      resetEntryEditor();
      await load({ silent: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSlotBusy(false);
    }
  };

  const handleDeleteEntry = async (entry) => {
    if (!entry?.id) return;
    if (!confirm(`Удалить «${entry.name || 'позицию'}» из блока?`)) return;
    setSlotBusy(true);
    setError('');
    try {
      if (entry.source === 'material') {
        await settingsApi.objectSettings.deleteMaterial(entry.id);
      } else if (entry.source === 'equipment') {
        await settingsApi.objectSettings.deleteEquipment(entry.id);
      } else if (entry.source === 'work') {
        await settingsApi.objectSettings.deleteWork(entry.id);
      }
      await load({ silent: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSlotBusy(false);
    }
  };

  const handleCopyActiveSlot = () => {
    if (!activeSlot?.id) return;
    setCopiedSlotTemplate(buildSlotTemplate(activeSlot));
    setNotice(`Блок «${activeSlot.system_name}${activeSlot.category_name ? ` • ${activeSlot.category_name}` : ''}» скопирован.`);
    setError('');
  };

  const handlePasteSlotToLocation = async (locationKind, locationId, title) => {
    if (!copiedSlotTemplate?.systemId) return;
    const key = `slot:${locationKind}:${locationId}`;
    setPasteBusyKey(key);
    setError('');
    setNotice('');
    try {
      await cloneSlotTemplateToLocation(locationKind, locationId, copiedSlotTemplate);
      setNotice(`Блок «${copiedSlotTemplate.systemName}» вставлен в «${title}».`);
      await load({ silent: true });
    } catch (err) {
      setError(err.message || 'Не удалось вставить блок');
    } finally {
      setPasteBusyKey('');
    }
  };

  const handleCopyLocationBlocks = (locationKind, locationId, title) => {
    const slots = getLocationSlotTemplates(locationKind, locationId);
    if (!slots.length) {
      setError('В выбранной локации нет блоков для копирования.');
      setNotice('');
      return;
    }
    setCopiedLocationTemplate({
      locationKind,
      title,
      slots,
    });
    setError('');
    setNotice(`Блоки локации «${title}» скопированы.`);
  };

  const handlePasteLocationBlocks = async (locationKind, locationId, title) => {
    if (!copiedLocationTemplate?.slots?.length) return;
    if (copiedLocationTemplate.locationKind !== locationKind) {
      setError('Можно вставлять только в локацию того же типа.');
      setNotice('');
      return;
    }
    const key = `location:${locationKind}:${locationId}`;
    setPasteBusyKey(key);
    setError('');
    setNotice('');
    try {
      for (const slotTemplate of copiedLocationTemplate.slots) {
        await cloneSlotTemplateToLocation(locationKind, locationId, slotTemplate);
      }
      setNotice(`Блоки локации вставлены в «${title}».`);
      await load({ silent: true });
    } catch (err) {
      setError(err.message || 'Не удалось вставить блоки локации');
    } finally {
      setPasteBusyKey('');
    }
  };

  const handleCopyFloorBlocks = (floor) => {
    const floorApartmentsRaw = apartmentsByFloor.get(floor.id) || [];
    const floorRoomsBucket = floorApartmentsRaw.find((x) => x.name === FLOOR_ROOMS_BUCKET_NAME);
    const floorApartments = floorApartmentsRaw.filter((x) => x.name !== FLOOR_ROOMS_BUCKET_NAME);
    const floorRooms = floorRoomsBucket ? (roomsByApartment.get(floorRoomsBucket.id) || []) : [];

    const items = [];

    floorRooms.forEach((room) => {
      const roomSlots = getLocationSlotTemplates('room', room.id);
      if (!roomSlots.length) return;
      items.push({
        locationKind: 'room',
        scope: 'floor',
        roomName: room.name,
        slots: roomSlots,
      });
    });

    floorApartments.forEach((apartment) => {
      const apartmentSlots = getLocationSlotTemplates('apartment', apartment.id);
      if (apartmentSlots.length) {
        items.push({
          locationKind: 'apartment',
          scope: 'apartment',
          apartmentName: apartment.name,
          slots: apartmentSlots,
        });
      }
      (roomsByApartment.get(apartment.id) || []).forEach((room) => {
        const roomSlots = getLocationSlotTemplates('room', room.id);
        if (!roomSlots.length) return;
        items.push({
          locationKind: 'room',
          scope: 'apartment',
          apartmentName: apartment.name,
          roomName: room.name,
          slots: roomSlots,
        });
      });
    });

    if (!items.length) {
      setError(`На этаже ${floor.name} нет блоков для копирования.`);
      setNotice('');
      return;
    }

    setCopiedFloorTemplate({
      sourceFloorId: floor.id,
      sourceFloorName: floor.name,
      items,
    });
    setError('');
    setNotice(`Блоки этажа «${floor.name}» скопированы.`);
  };

  const handlePasteFloorBlocks = async (targetFloor) => {
    if (!copiedFloorTemplate?.items?.length) return;
    const key = `floor:${targetFloor.id}`;
    setPasteBusyKey(key);
    setError('');
    setNotice('');
    try {
      const targetApartmentsRaw = apartmentsByFloor.get(targetFloor.id) || [];
      const targetRoomsBucket = targetApartmentsRaw.find((x) => x.name === FLOOR_ROOMS_BUCKET_NAME);
      const targetApartments = targetApartmentsRaw.filter((x) => x.name !== FLOOR_ROOMS_BUCKET_NAME);
      const targetFloorRooms = targetRoomsBucket ? (roomsByApartment.get(targetRoomsBucket.id) || []) : [];

      const targetApartmentsByName = new Map();
      targetApartments.forEach((apartment) => {
        targetApartmentsByName.set(normalizeNameKey(apartment.name), apartment);
      });
      const targetFloorRoomsByName = new Map();
      targetFloorRooms.forEach((room) => {
        targetFloorRoomsByName.set(normalizeNameKey(room.name), room);
      });
      const targetApartmentRoomsByKey = new Map();
      targetApartments.forEach((apartment) => {
        const apartmentKey = normalizeNameKey(apartment.name);
        (roomsByApartment.get(apartment.id) || []).forEach((room) => {
          const roomKey = normalizeNameKey(room.name);
          targetApartmentRoomsByKey.set(`${apartmentKey}::${roomKey}`, room);
        });
      });

      let insertedBlocks = 0;
      let skippedBlocks = 0;

      for (const item of copiedFloorTemplate.items) {
        let targetLocation = null;
        if (item.locationKind === 'apartment') {
          targetLocation = targetApartmentsByName.get(normalizeNameKey(item.apartmentName));
        } else if (item.scope === 'floor') {
          targetLocation = targetFloorRoomsByName.get(normalizeNameKey(item.roomName));
        } else {
          const apartmentKey = normalizeNameKey(item.apartmentName);
          const roomKey = normalizeNameKey(item.roomName);
          targetLocation = targetApartmentRoomsByKey.get(`${apartmentKey}::${roomKey}`);
        }

        if (!targetLocation?.id) {
          skippedBlocks += item.slots.length;
          continue;
        }

        for (const slotTemplate of item.slots || []) {
          await cloneSlotTemplateToLocation(item.locationKind, targetLocation.id, slotTemplate);
          insertedBlocks += 1;
        }
      }

      if (!insertedBlocks) {
        setError('Не удалось вставить блоки: на целевом этаже не найдены совпадающие помещения/квартиры.');
      } else {
        setNotice(
          skippedBlocks
            ? `Вставлено блоков: ${insertedBlocks}. Пропущено: ${skippedBlocks} (не найдены совпадающие локации).`
            : `Вставлено блоков: ${insertedBlocks}.`,
        );
      }
      await load({ silent: true });
    } catch (err) {
      setError(err.message || 'Не удалось вставить блоки этажа');
    } finally {
      setPasteBusyKey('');
    }
  };

  const hasLocationBlocks = useCallback((locationKind, locationId) => (
    (slotsByLocation.get(`${locationKind}:${locationId}`) || []).length > 0
  ), [slotsByLocation]);

  const handleDeleteLocationBlocks = async (locationKind, locationId, title) => {
    const currentCount = (slotsByLocation.get(`${locationKind}:${locationId}`) || []).length;
    if (!currentCount) {
      setError(`В «${title}» пока нет блоков для удаления.`);
      setNotice('');
      return;
    }
    if (!confirm(`Удалить все блоки в «${title}»?`)) return;
    const key = `location:${locationKind}:${locationId}`;
    setPasteBusyKey(key);
    setError('');
    setNotice('');
    try {
      const result = await settingsApi.objectSettings.deleteLocationBlocks(locationKind, locationId);
      setNotice(`Удалено блоков: ${result?.deleted_blocks ?? currentCount} (${title}).`);
      await load({ silent: true });
    } catch (err) {
      setError(err.message || 'Не удалось удалить блоки локации');
    } finally {
      setPasteBusyKey('');
    }
  };

  const handleStartMultiCopySelection = (locationKind, locationId) => {
    const key = `${locationKind}:${locationId}`;
    const slots = (slotsByLocation.get(key) || []).filter(slotMatchesFilters);
    if (!slots.length) {
      setError('В выбранной локации нет блоков для копирования.');
      setNotice('');
      return;
    }
    setError('');
    setNotice('Выберите блоки и нажмите «Копировать».');
    setMultiCopyLocationKey(key);
    setMultiCopySelectedSlotIds([]);
  };

  const handleCancelMultiCopySelection = () => {
    setMultiCopyLocationKey('');
    setMultiCopySelectedSlotIds([]);
    setError('');
  };

  const handleToggleMultiCopySlot = (slot) => {
    if (!slot?.id) return;
    setMultiCopySelectedSlotIds((prev) => toggleSelection(prev, String(slot.id)));
  };

  const handleCopySelectedBlocks = (locationKind, locationId, title) => {
    const key = `${locationKind}:${locationId}`;
    if (multiCopyLocationKey !== key) return;
    const selectedSet = new Set(multiCopySelectedSlotIds.map((id) => String(id)));
    const selectedSlots = (slotsByLocation.get(key) || []).filter((slot) => selectedSet.has(String(slot.id)));
    if (!selectedSlots.length) {
      setError('Сначала выберите хотя бы один блок.');
      setNotice('');
      return;
    }
    setCopiedLocationTemplate({
      locationKind,
      title,
      slots: selectedSlots.map((slot) => buildSlotTemplate(slot)),
    });
    setError('');
    setNotice(`Выбрано и скопировано блоков: ${selectedSlots.length} (${title}).`);
    setMultiCopyLocationKey('');
    setMultiCopySelectedSlotIds([]);
  };

  const activeCableTransit = useMemo(
    () => (activeCableTransitId ? transitById.get(activeCableTransitId) || null : null),
    [activeCableTransitId, transitById],
  );
  const selectedCableTransit = useMemo(() => {
    const selectedTransitId = Number.parseInt(cableDraft.transitId, 10);
    if (selectedTransitId && transitById.has(selectedTransitId)) {
      return transitById.get(selectedTransitId) || null;
    }
    return activeCableTransit;
  }, [cableDraft.transitId, transitById, activeCableTransit]);

  const cableSelectedSlotIds = useMemo(() => {
    const values = [cableDraft.fromSlotId, cableDraft.toSlotId]
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isInteger(value) && value > 0);
    return new Set(values.map(String));
  }, [cableDraft.fromSlotId, cableDraft.toSlotId]);

  const describeSlot = useCallback((slotId) => {
    const placement = slotPlacementById.get(slotId);
    if (!placement) return 'Блок не найден';
    const { slot, location } = placement;
    if (slot.location_kind === 'apartment') {
      return `Кв. ${location.name} · эт. ${location.floor_name} · ${slot.system_name}${slot.category_name ? ` / ${slot.category_name}` : ''}`;
    }
    if (slot.location_kind === 'room') {
      const apartmentName = location.apartment_name ? ` · кв. ${location.apartment_name}` : '';
      return `Пом. ${location.name}${apartmentName} · эт. ${location.floor_name} · ${slot.system_name}${slot.category_name ? ` / ${slot.category_name}` : ''}`;
    }
    return `${getLocationKindTitle(slot.location_kind)} ${location.name || ''} · ${slot.system_name}`;
  }, [slotPlacementById]);

  const isSlotEligibleForTransitWithCriteria = useCallback((slot, transit, systemIdValue, categoryIdValue) => {
    if (!slot || !transit) return false;
    if (!['apartment', 'room'].includes(slot.location_kind)) return false;
    const requiredSystemId = Number.parseInt(systemIdValue, 10);
    const requiredCategoryId = categoryIdValue === '' || categoryIdValue == null
      ? null
      : Number.parseInt(categoryIdValue, 10);
    if (requiredSystemId && Number(slot.system_id || 0) !== requiredSystemId) return false;
    if (requiredCategoryId && Number(slot.category_id || 0) !== requiredCategoryId) return false;
    const placement = slotPlacementById.get(slot.id);
    if (!placement?.location) return false;
    const location = placement.location;
    if (Number(location.object_id || 0) !== Number(transit.object_id || 0)) return false;
    if (Number(location.entrance_id || 0) !== Number(transit.entrance_id || 0)) return false;
    return true;
  }, [slotPlacementById]);

  const isSlotEligibleForCableDraft = useCallback((slot) => {
    if (!slot || !['apartment', 'room'].includes(slot.location_kind)) return false;
    if (cableDraft.routeMode === 'transit') {
      return selectedCableTransit
        ? isSlotEligibleForTransitWithCriteria(slot, selectedCableTransit, cableDraft.systemId, cableDraft.categoryId)
        : false;
    }
    const requiredSystemId = Number.parseInt(cableDraft.systemId, 10);
    const requiredCategoryId = cableDraft.categoryId === '' || cableDraft.categoryId == null
      ? null
      : Number.parseInt(cableDraft.categoryId, 10);
    if (requiredSystemId && Number(slot.system_id || 0) !== requiredSystemId) return false;
    if (requiredCategoryId && Number(slot.category_id || 0) !== requiredCategoryId) return false;
    if (!activeCableTransit) return true;
    const placement = slotPlacementById.get(slot.id);
    if (!placement?.location) return false;
    const location = placement.location;
    return (
      Number(location.object_id || 0) === Number(activeCableTransit.object_id || 0)
      && Number(location.entrance_id || 0) === Number(activeCableTransit.entrance_id || 0)
    );
  }, [
    cableDraft.routeMode,
    cableDraft.systemId,
    cableDraft.categoryId,
    selectedCableTransit,
    isSlotEligibleForTransitWithCriteria,
    slotPlacementById,
    activeCableTransit,
  ]);

  const revealCableSlotFloor = useCallback((slotIdValue) => {
    const slotId = Number.parseInt(slotIdValue, 10);
    if (!slotId) return;
    const placement = slotPlacementById.get(slotId);
    const floorId = placement?.location?.floor_id;
    if (!floorId) return;
    const floorKey = String(floorId);
    setCollapsedFloors((prev) => prev.filter((value) => value !== floorKey));
  }, [slotPlacementById]);

  const resetCableDraft = useCallback((transitId = null) => {
    setCableDraft({
      lineId: null,
      routeMode: 'transit',
      transitId: transitId ? String(transitId) : '',
      fromSlotId: null,
      toSlotId: null,
      systemId: '',
      categoryId: '',
      name: '',
      lengthM: '',
    });
  }, []);

  const handleStartCableSelection = (transitId) => {
    if (multiCopyLocationKey) {
      setMultiCopyLocationKey('');
      setMultiCopySelectedSlotIds([]);
    }
    const normalizedTransitId = Number.parseInt(transitId, 10);
    if (!normalizedTransitId) {
      setError('Неверный транзит для добавления кабеля');
      return;
    }
    setActiveCableTransitId(normalizedTransitId);
    resetCableDraft(normalizedTransitId);
    setCablePickTarget('from');
    setError('');
    setNotice('Нажмите «От», выберите блок, затем «До» и выберите второй блок.');
  };

  const handleCancelCableSelection = () => {
    setActiveCableTransitId(null);
    resetCableDraft();
    setCablePickTarget('');
    setCableStockSuggestions([]);
    setCableStockSuggestionLoading(false);
    setCableSelectedMaterial(null);
    setError('');
  };

  const handleCloneCableLine = useCallback((line, fallbackTransitId = null) => {
    if (!line) return;
    const transitId = line.transit_id ? String(line.transit_id) : (fallbackTransitId ? String(fallbackTransitId) : '');
    if (transitId) {
      const parsedTransitId = Number.parseInt(transitId, 10);
      if (parsedTransitId) setActiveCableTransitId(parsedTransitId);
    }
    setCableDraft({
      lineId: null,
      routeMode: line.transit_id ? 'transit' : 'direct',
      transitId,
      fromSlotId: line.from_location_system_id || null,
      toSlotId: line.to_location_system_id || null,
      systemId: line.system_id == null ? '' : String(line.system_id),
      categoryId: line.category_id == null ? '' : String(line.category_id),
      name: line.name || '',
      lengthM: line.length_m == null ? '' : String(line.length_m),
    });
    setCablePickTarget('');
    setError('');
    setNotice('Параметры линии скопированы. Нажмите «Добавить кабель», чтобы создать новую линию.');
    revealCableSlotFloor(line.from_location_system_id);
    revealCableSlotFloor(line.to_location_system_id);
  }, [revealCableSlotFloor]);

  useEffect(() => {
    if (!activeCableTransitId) {
      setCableStockSuggestions([]);
      setCableStockSuggestionLoading(false);
      setCableSelectedMaterial(null);
      return undefined;
    }
    const systemId = Number.parseInt(cableDraft.systemId, 10);
    const query = String(cableDraft.name || '').trim();
    if (!systemId || !query) {
      setCableStockSuggestions([]);
      setCableStockSuggestionLoading(false);
      return undefined;
    }
    const categoryId = cableDraft.categoryId === '' ? null : Number.parseInt(cableDraft.categoryId, 10);
    if (cableDraft.categoryId !== '' && !categoryId) {
      setCableStockSuggestions([]);
      setCableStockSuggestionLoading(false);
      return undefined;
    }
    const timer = setTimeout(() => {
      setCableStockSuggestionLoading(true);
      settingsApi.objectSettings.materialSuggestions(systemId, query, categoryId)
        .then((rows) => setCableStockSuggestions(Array.isArray(rows) ? rows : []))
        .catch(() => setCableStockSuggestions([]))
        .finally(() => setCableStockSuggestionLoading(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [activeCableTransitId, cableDraft.systemId, cableDraft.categoryId, cableDraft.name]);

  const handlePickCableSlot = useCallback((slot) => {
    if (!activeCableTransit) return;
    if (!cablePickTarget) {
      setError('Нажмите кнопку «От» или «До», затем выберите блок.');
      return;
    }
    if (!isSlotEligibleForCableDraft(slot)) {
      setError(cableDraft.routeMode === 'transit'
        ? 'Для линии через транзит выбирайте блоки в том же подъезде, что и выбранный транзит.'
        : 'Для прямой линии выбирайте блоки в том же подъезде.');
      return;
    }
    setError('');
    setCableDraft((prev) => {
      const pickedId = Number(slot.id);
      if (cablePickTarget === 'from') {
        return {
          ...prev,
          lineId: null,
          fromSlotId: pickedId,
          toSlotId: Number(prev.toSlotId) === pickedId ? null : prev.toSlotId,
        };
      }
      return {
        ...prev,
        lineId: null,
        toSlotId: pickedId,
        fromSlotId: Number(prev.fromSlotId) === pickedId ? null : prev.fromSlotId,
      };
    });
    revealCableSlotFloor(slot.id);
    if (cablePickTarget === 'from') {
      setCablePickTarget('to');
      setNotice('Блок «От» выбран. Выберите блок «До».');
    } else {
      setCablePickTarget('');
      setNotice('Блок «До» выбран. При необходимости выберите другой «От» или «До».');
    }
  }, [activeCableTransit, cablePickTarget, isSlotEligibleForCableDraft, revealCableSlotFloor, cableDraft.routeMode]);

  const handleSaveCableLine = async (e, transitIdArg, options = {}) => {
    e.preventDefault();
    const keepOpen = Boolean(options?.keepOpen);
    const routeMode = cableDraft.routeMode === 'direct' ? 'direct' : 'transit';
    const transitSeed = cableDraft.transitId || transitIdArg || activeCableTransitId || '';
    const selectedTransitId = Number.parseInt(transitSeed, 10);
    const transitId = routeMode === 'transit' ? (selectedTransitId || null) : null;
    if (routeMode === 'transit' && !transitId) return setError('Выберите транзит для маршрута');
    const fromSlotId = Number.parseInt(cableDraft.fromSlotId, 10);
    const toSlotId = Number.parseInt(cableDraft.toSlotId, 10);
    const systemId = cableDraft.systemId === '' ? null : Number.parseInt(cableDraft.systemId, 10);
    const categoryId = cableDraft.categoryId === '' ? null : Number.parseInt(cableDraft.categoryId, 10);
    const name = String(cableDraft.name || '').trim();
    const lengthM = parseDecimalInput(cableDraft.lengthM);
    if (cableDraft.systemId !== '' && !systemId) return setError('Выберите корректную систему кабельной линии');
    if (cableDraft.categoryId !== '' && !categoryId) return setError('Выберите корректную категорию');
    if (!fromSlotId || !toSlotId) return setError('Выберите два блока для кабельной линии');
    if (fromSlotId === toSlotId) return setError('Блоки «От» и «До» должны отличаться');
    if (!name) return setError('Укажите название кабельной линии');
    if (!Number.isFinite(lengthM) || lengthM <= 0) return setError('Укажите корректную длину кабеля (м)');

    const optimisticLineId = `tmp-cable-${Date.now()}-${fromSlotId}-${toSlotId}`;
    const optimisticLine = {
      id: optimisticLineId,
      route_mode: routeMode,
      transit_id: transitId,
      from_location_system_id: fromSlotId,
      to_location_system_id: toSlotId,
      system_id: systemId,
      category_id: categoryId,
      name,
      length_m: lengthM,
      __optimistic: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    setCableBusy(true);
    setError('');
    revealCableSlotFloor(fromSlotId);
    revealCableSlotFloor(toSlotId);
    setData((prev) => ({
      ...prev,
      transitCableLines: mergeTransitCableLine(prev.transitCableLines, optimisticLine),
    }));
    setNotice('Сохранение кабельной линии…');
    try {
      const createdLine = await settingsApi.objectSettings.createCableLine({
        transit_id: transitId,
        from_location_system_id: fromSlotId,
        to_location_system_id: toSlotId,
        system_id: systemId,
        category_id: categoryId,
        name,
        length_m: lengthM,
      });
      setData((prev) => ({
        ...prev,
        transitCableLines: mergeTransitCableLine(
          (prev.transitCableLines || []).filter((line) => String(line.id) !== String(optimisticLineId)),
          createdLine,
        ),
      }));
      if (keepOpen) {
        setCableDraft((prev) => ({
          ...prev,
          fromSlotId: null,
          toSlotId: null,
          name: '',
          lengthM: '',
        }));
        setCablePickTarget('');
        setCableSelectedMaterial(null);
        setNotice('Кабельная линия добавлена. Нажмите «От» или «До», чтобы выбрать следующую пару блоков.');
      } else {
        setActiveCableTransitId(null);
        resetCableDraft();
        setCablePickTarget('');
        setCableStockSuggestions([]);
        setCableStockSuggestionLoading(false);
        setCableSelectedMaterial(null);
        setNotice('Кабельная линия добавлена.');
      }
    } catch (err) {
      setData((prev) => ({
        ...prev,
        transitCableLines: (prev.transitCableLines || []).filter(
          (line) => String(line.id) !== String(optimisticLineId),
        ),
      }));
      setError(err.message || 'Не удалось сохранить кабельную линию');
      setNotice('');
    } finally {
      setCableBusy(false);
    }
  };

  const openCableEditModal = (line) => {
    if (!line) return;
    const inferredSystemId = line.system_id ?? '';
    const inferredCategoryId = line.category_id ?? '';
    const lineTransitId = line.transit_id == null ? '' : String(line.transit_id);
    setCableEditDraft({
      lineId: line.id,
      routeMode: lineTransitId ? 'transit' : 'direct',
      transitId: lineTransitId,
      fromSlotId: line.from_location_system_id,
      toSlotId: line.to_location_system_id,
      systemId: String(inferredSystemId || ''),
      categoryId: inferredCategoryId == null ? '' : String(inferredCategoryId),
      name: line.name || '',
      lengthM: String(line.length_m ?? ''),
    });
    setCableEditModalOpen(true);
    setCableEditPickTarget('');
    setError('');
  };

  const closeCableEditModal = () => {
    if (cableEditBusy) return;
    setCableEditPickTarget('');
    setCableEditModalOpen(false);
    setCableEditDraft(null);
  };

  const handleStartCableEditPlanPick = useCallback((target) => {
    if (cableEditBusy || !cableEditDraft) return;
    const normalizedTarget = target === 'from' ? 'from' : 'to';
    setCableEditPickTarget(normalizedTarget);
    setCableEditModalOpen(false);
    setError('');
    setNotice(`Выбор точки «${normalizedTarget === 'from' ? 'От' : 'До'}»: кликните по блоку на схеме.`);
  }, [cableEditBusy, cableEditDraft]);

  const handleSaveCableEdit = async (e) => {
    e.preventDefault();
    if (!cableEditDraft?.lineId) return;
    const routeMode = cableEditDraft.routeMode === 'direct' ? 'direct' : 'transit';
    const transitIdRaw = Number.parseInt(cableEditDraft.transitId, 10);
    const transitId = routeMode === 'transit' ? (transitIdRaw || null) : null;
    const fromSlotId = Number.parseInt(cableEditDraft.fromSlotId, 10);
    const toSlotId = Number.parseInt(cableEditDraft.toSlotId, 10);
    const systemId = cableEditDraft.systemId === '' ? null : Number.parseInt(cableEditDraft.systemId, 10);
    const categoryId = cableEditDraft.categoryId === '' ? null : Number.parseInt(cableEditDraft.categoryId, 10);
    const name = String(cableEditDraft.name || '').trim();
    const lengthM = parseDecimalInput(cableEditDraft.lengthM);
    if (!fromSlotId || !toSlotId || !name || !Number.isFinite(lengthM) || lengthM <= 0) {
      return setError('Проверьте поля редактирования кабеля');
    }
    if (routeMode === 'transit' && !transitId) return setError('Выберите транзит для маршрута');
    if (cableEditDraft.systemId !== '' && !systemId) return setError('Выберите корректную систему кабельной линии');
    if (fromSlotId === toSlotId) return setError('Блоки «От» и «До» должны отличаться');
    if (cableEditDraft.categoryId !== '' && !categoryId) return setError('Выберите корректную категорию');
    setCableEditBusy(true);
    setError('');
    try {
      const updatedLine = await settingsApi.objectSettings.updateTransitCableLine(cableEditDraft.lineId, {
        transit_id: transitId,
        from_location_system_id: fromSlotId,
        to_location_system_id: toSlotId,
        system_id: systemId,
        category_id: categoryId,
        name,
        length_m: lengthM,
      });
      setData((prev) => ({
        ...prev,
        transitCableLines: mergeTransitCableLine(prev.transitCableLines, updatedLine),
      }));
      setNotice('Кабельная линия обновлена.');
      closeCableEditModal();
    } catch (err) {
      setError(err.message || 'Не удалось обновить кабельную линию');
    } finally {
      setCableEditBusy(false);
    }
  };

  const handleDeleteCableEdit = async () => {
    if (!cableEditDraft?.lineId) return;
    if (!confirm('Удалить кабельную линию?')) return;
    setCableEditBusy(true);
    setError('');
    try {
      await settingsApi.objectSettings.deleteTransitCableLine(cableEditDraft.lineId);
      setData((prev) => ({
        ...prev,
        transitCableLines: (prev.transitCableLines || []).filter(
          (line) => String(line.id) !== String(cableEditDraft.lineId),
        ),
      }));
      setNotice('Кабельная линия удалена.');
      closeCableEditModal();
    } catch (err) {
      setError(err.message || 'Не удалось удалить кабельную линию');
    } finally {
      setCableEditBusy(false);
    }
  };

  useEffect(() => {
    if (!activeCableTransitId) return;
    const activeId = Number.parseInt(activeCableTransitId, 10);
    if (!activeId || !transitById.has(activeId)) {
      setActiveCableTransitId(null);
      resetCableDraft();
      setCablePickTarget('');
    }
  }, [activeCableTransitId, transitById, resetCableDraft]);

  const openSummaryEditModal = (objectName, row) => {
    if (!row?.slotIds?.length) return;
    setSummaryEditTarget({
      objectName,
      sourceName: row.name,
      slotIds: [...row.slotIds],
    });
    setSummaryEditName(row.name || '');
    setSummaryEditSystemId(row.systems.length === 1 ? row.systems[0].id : '');
    setSummaryEditCategoryId(row.categories.length === 1 ? row.categories[0].id : '');
    setSummaryEditOpen(true);
    setError('');
  };

  const closeSummaryEditModal = () => {
    setSummaryEditOpen(false);
    setSummaryEditTarget(null);
    setSummaryEditName('');
    setSummaryEditSystemId('');
    setSummaryEditCategoryId('');
  };

  const handleApplySummaryEdit = async (e) => {
    e.preventDefault();
    if (!summaryEditTarget?.slotIds?.length) return;
    const nextName = String(summaryEditName || '').trim();
    const systemId = Number.parseInt(summaryEditSystemId, 10);
    const categoryId = summaryEditCategoryId ? Number.parseInt(summaryEditCategoryId, 10) : null;
    if (!nextName) return setError('Укажите название позиции');
    if (!systemId) return setError('Выберите систему');
    if (summaryEditCategoryId && !categoryId) return setError('Неверная категория');

    setSummaryEditBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await settingsApi.objectSettings.bulkRenameEntry({
        source_name: summaryEditTarget.sourceName,
        name: nextName,
        system_id: systemId,
        category_id: categoryId,
        slot_ids: summaryEditTarget.slotIds,
      });
      const updated = result?.updated_entries ?? 0;
      setNotice(updated
        ? `Обновлено позиций: ${updated}.`
        : 'Подходящие позиции не найдены для изменения.');
      closeSummaryEditModal();
      await load({ silent: true });
    } catch (err) {
      setError(err.message || 'Не удалось изменить позицию');
    } finally {
      setSummaryEditBusy(false);
    }
  };

  const renderLocationActions = (locationKind, locationId, title) => {
    const canPaste = copiedLocationTemplate && copiedLocationTemplate.locationKind === locationKind;
    const locationBusy = pasteBusyKey === `location:${locationKind}:${locationId}`;
    const key = `${locationKind}:${locationId}`;
    const blockCount = (slotsByLocation.get(key) || []).length;
    const selectingMultiple = multiCopyLocationKey === key;
    const selectedCount = selectingMultiple ? multiCopySelectedSlotIds.length : 0;
    const cableSelectionActive = Boolean((activeCableTransitId && cablePickTarget) || cableEditPickTarget);
    return (
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          onClick={() => handleCopyLocationBlocks(locationKind, locationId, title)}
          className="inline-flex px-1.5 py-0.5 rounded border border-white/15 text-[7px] text-zinc-200 hover:bg-white/10 leading-tight"
          disabled={!!pasteBusyKey || slotBusy || cableSelectionActive}
        >
          Коп. все
        </button>
        {!selectingMultiple ? (
          <button
            type="button"
            onClick={() => handleStartMultiCopySelection(locationKind, locationId)}
            className="inline-flex px-1.5 py-0.5 rounded border border-indigo-400/40 text-[7px] text-indigo-200 hover:bg-indigo-900/30 leading-tight"
            disabled={!!pasteBusyKey || slotBusy || blockCount === 0 || cableSelectionActive}
          >
            Коп. выбор
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => handleCopySelectedBlocks(locationKind, locationId, title)}
              className="inline-flex px-1.5 py-0.5 rounded border border-indigo-300/60 text-[7px] text-indigo-100 hover:bg-indigo-900/40 disabled:opacity-40 leading-tight"
              disabled={!!pasteBusyKey || slotBusy || selectedCount === 0 || cableSelectionActive}
            >
              Коп. ({selectedCount})
            </button>
            <button
              type="button"
              onClick={handleCancelMultiCopySelection}
              className="inline-flex px-1.5 py-0.5 rounded border border-white/20 text-[7px] text-zinc-300 hover:bg-white/10 leading-tight"
              disabled={!!pasteBusyKey || slotBusy || cableSelectionActive}
            >
              Снять выбор
            </button>
          </>
        )}
        {canPaste && (
          <button
            type="button"
            onClick={() => handlePasteLocationBlocks(locationKind, locationId, title)}
            className="inline-flex px-1.5 py-0.5 rounded border border-sky-400/40 text-[7px] text-sky-200 hover:bg-sky-900/30 leading-tight"
            disabled={!!pasteBusyKey || slotBusy || cableSelectionActive}
          >
            {locationBusy ? 'Вставка…' : 'Вставить'}
          </button>
        )}
        <button
          type="button"
          onClick={() => handleDeleteLocationBlocks(locationKind, locationId, title)}
          className="inline-flex px-1.5 py-0.5 rounded border border-rose-400/40 text-[7px] text-rose-200 hover:bg-rose-900/30 disabled:opacity-40 leading-tight"
          disabled={!!pasteBusyKey || slotBusy || blockCount === 0 || cableSelectionActive}
        >
          Удалить
        </button>
      </div>
    );
  };

  const renderSystemSquares = (locationKind, locationId, title, options = {}) => {
    const key = `${locationKind}:${locationId}`;
    const bypassFilters = Boolean(options.selectionMode && options.selectionTone === 'cable');
    const allSlots = slotsByLocation.get(key) || [];
    const slots = bypassFilters
      ? allSlots
      : allSlots.filter((slot) => (
        slotMatchesFilters(slot) || cableEndpointSlotIdSet.has(Number(slot.id))
      ));
    const sortedSlotCards = slots
      .map((slot) => {
        const entries = getSlotEntries(slot.id);
        const entryNames = entries.map((row) => row.name);
        const completeness = slotCompleteness(slot, entryNames);
        return { slot, entries, entryNames, completeness };
      })
      .sort((a, b) => (
        naturalCompare(a.slot.system_name, b.slot.system_name)
        || naturalCompare(a.entries[0]?.name || '', b.entries[0]?.name || '')
        || naturalCompare(a.slot.category_name || '', b.slot.category_name || '')
        || (a.slot.id - b.slot.id)
      ));
    const isPastingHere = pasteBusyKey === `slot:${key}`;
    const selectingMultiple = multiCopyLocationKey === key && !options.selectionMode;
    const isCustomSelectionMode = Boolean(options.selectionMode);
    const selectedSet = options.selectedSlotIds instanceof Set
      ? options.selectedSlotIds
      : new Set((options.selectedSlotIds || []).map((id) => String(id)));
    const selectionTone = options.selectionTone || 'default';
    if (!sortedSlotCards.length && hasSlotFilters && !bypassFilters) return null;

    const groupedBySystem = sortedSlotCards.reduce((acc, item) => {
      const systemName = String(item.slot.system_name || '').trim() || 'Без системы';
      const systemKey = `${String(item.slot.system_id || 'none')}::${normalizeNameKey(systemName) || 'none'}`;
      if (!acc.has(systemKey)) {
        acc.set(systemKey, {
          systemKey,
          systemName,
          categories: new Map(),
        });
      }
      const systemBucket = acc.get(systemKey);
      const categoryName = String(item.slot.category_name || '').trim() || 'Без категории';
      const categoryKey = `${String(item.slot.category_id ?? 'none')}::${normalizeNameKey(categoryName) || 'none'}`;
      if (!systemBucket.categories.has(categoryKey)) {
        systemBucket.categories.set(categoryKey, {
          categoryName,
          items: [],
        });
      }
      systemBucket.categories.get(categoryKey).items.push(item);
      return acc;
    }, new Map());

    const groupedRows = [...groupedBySystem.values()]
      .map((systemRow) => ({
        ...systemRow,
        categories: [...systemRow.categories.values()]
          .map((categoryRow) => ({
            ...categoryRow,
            items: [...categoryRow.items].sort((a, b) => a.slot.id - b.slot.id),
          }))
          .sort((a, b) => naturalCompare(a.categoryName, b.categoryName)),
      }))
      .sort((a, b) => naturalCompare(a.systemName, b.systemName));

    return (
      <div className="space-y-1.5">
        <div className="space-y-1.5">
          {groupedRows.map((systemRow) => (
            <div key={systemRow.systemKey} className="rounded-md border border-white/10 bg-black/25 p-1.5 space-y-1 shadow-[0_4px_12px_rgba(0,0,0,0.2)]">
              <p className="text-[10px] text-zinc-200 font-semibold tracking-wide">{systemRow.systemName}</p>
              {systemRow.categories.map((categoryRow) => (
                <div key={`${systemRow.systemName}:${categoryRow.categoryName}`} className="space-y-0.5">
                  <p className="text-[9px] text-zinc-400">{categoryRow.categoryName}</p>
                  <div
                    className="grid gap-0.5"
                    style={{
                      gridTemplateColumns: `repeat(auto-fill, minmax(${
                        categoryRow.items.length > 16
                          ? '2.05rem'
                          : (categoryRow.items.length > 10 ? '2.2rem' : '2.35rem')
                      }, 1fr))`,
                    }}
                  >
                    {categoryRow.items.map(({ slot, entries, entryNames, completeness }) => {
                      const selectedForMultiCopy = selectingMultiple && multiCopySelectedSlotIds.includes(String(slot.id));
                      const selectedForCustomSelection = isCustomSelectionMode && selectedSet.has(String(slot.id));
                      const selectableForCustom = isCustomSelectionMode
                        ? (typeof options.isSlotSelectable === 'function' ? options.isSlotSelectable(slot) : true)
                        : true;
                      return (
                        <SystemSquare
                          key={slot.id}
                          slot={{
                            ...slot,
                            locationTitle: title,
                            entryNames,
                            missingFieldsText: completeness.missing.join(', '),
                          }}
                          onOpen={handleSystemSquareOpen}
                          totals={{ positions: entries.length }}
                          incomplete={completeness.isIncomplete}
                          selectionMode={selectingMultiple || isCustomSelectionMode}
                          selected={selectedForMultiCopy || selectedForCustomSelection}
                          selectionEnabled={selectableForCustom}
                          selectionTone={selectionTone}
                          onToggleSelect={isCustomSelectionMode ? options.onSelectSlot : handleToggleMultiCopySlot}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => openCreateSlotModal(locationKind, locationId, title)}
            className="w-[2.45rem] h-[2.45rem] rounded-md border border-dashed border-white/20 bg-black/20 hover:bg-white/10 text-zinc-300 text-[6px] shadow-[0_3px_8px_rgba(0,0,0,0.18)]"
            disabled={Boolean((activeCableTransitId && cablePickTarget) || cableEditPickTarget)}
          >
            +Сист.
          </button>
          {copiedSlotTemplate && (
            <button
              type="button"
              onClick={() => handlePasteSlotToLocation(locationKind, locationId, title)}
              className="w-[2.45rem] h-[2.45rem] rounded-md border border-dashed border-sky-400/40 bg-sky-900/20 hover:bg-sky-800/30 text-sky-100 text-[6px] shadow-[0_3px_8px_rgba(0,0,0,0.18)]"
              disabled={!!pasteBusyKey || slotBusy || Boolean((activeCableTransitId && cablePickTarget) || cableEditPickTarget)}
              title={`Вставить блок: ${copiedSlotTemplate.systemName}`}
            >
              {isPastingHere ? '…' : 'Встав.'}
            </button>
          )}
        </div>
      </div>
    );
  };

  const toggleFloor = (floorId) => {
    const key = String(floorId);
    setCollapsedFloors((prev) => (prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]));
  };

  const buildCableSelectionOptions = (locationKind) => {
    if (!['room', 'apartment'].includes(locationKind)) return null;
    if (cableEditDraft && cableEditPickTarget) {
      return {
        selectionMode: true,
        selectionTone: 'cable',
        selectedSlotIds: cableEditSelectedSlotIds,
        onSelectSlot: handlePickCableEditSlot,
        isSlotSelectable: (slot) => cableEditSelectableSlotIdSet.has(String(slot.id)),
      };
    }
    if (!activeCableTransit || !cablePickTarget) return null;
    return {
      selectionMode: true,
      selectionTone: 'cable',
      selectedSlotIds: cableSelectedSlotIds,
      onSelectSlot: handlePickCableSlot,
      isSlotSelectable: (slot) => Boolean(cablePickTarget) && isSlotEligibleForCableDraft(slot),
    };
  };

  const getSelectableTransitSlots = useCallback((transitRow, criteria = {}) => {
    const criteriaSystemId = criteria.systemId ?? cableDraft.systemId;
    const criteriaCategoryId = criteria.categoryId ?? cableDraft.categoryId;
    const routeMode = criteria.routeMode ?? cableDraft.routeMode;
    const anchorTransit = criteria.anchorTransit ?? activeCableTransit;
    return [...data.locationSystems]
      .filter((slot) => ['apartment', 'room'].includes(slot.location_kind))
      .filter((slot) => (
        transitRow
          ? isSlotEligibleForTransitWithCriteria(slot, transitRow, criteriaSystemId, criteriaCategoryId)
          : (() => {
            const requiredSystemId = Number.parseInt(criteriaSystemId, 10);
            const requiredCategoryId = criteriaCategoryId === '' || criteriaCategoryId == null
              ? null
              : Number.parseInt(criteriaCategoryId, 10);
            if (requiredSystemId && Number(slot.system_id || 0) !== requiredSystemId) return false;
            if (requiredCategoryId && Number(slot.category_id || 0) !== requiredCategoryId) return false;
            if (routeMode !== 'direct' || !anchorTransit) return true;
            const placement = slotPlacementById.get(slot.id);
            if (!placement?.location) return false;
            const location = placement.location;
            return (
              Number(location.object_id || 0) === Number(anchorTransit.object_id || 0)
              && Number(location.entrance_id || 0) === Number(anchorTransit.entrance_id || 0)
            );
          })()
      ))
      .sort((a, b) => {
        const placementA = slotPlacementById.get(a.id);
        const placementB = slotPlacementById.get(b.id);
        const rankA = floorSortRank({ sort_order: placementA?.location?.floor_sort_order });
        const rankB = floorSortRank({ sort_order: placementB?.location?.floor_sort_order });
        return (
          (rankA - rankB)
          || naturalCompare(placementA?.location?.apartment_name || '', placementB?.location?.apartment_name || '')
          || naturalCompare(placementA?.location?.name || '', placementB?.location?.name || '')
          || naturalCompare(a.system_name || '', b.system_name || '')
          || (a.id - b.id)
        );
      });
  }, [
    data.locationSystems,
    isSlotEligibleForTransitWithCriteria,
    slotPlacementById,
    cableDraft.systemId,
    cableDraft.categoryId,
    cableDraft.routeMode,
    activeCableTransit,
  ]);

  const setEntranceGridRef = useCallback((entranceId, node) => {
    if (!entranceId) return;
    if (node) entranceGridRefs.current.set(entranceId, node);
    else entranceGridRefs.current.delete(entranceId);
  }, []);

  const overlayCableLines = useMemo(() => {
    const base = (data.transitCableLines || [])
      .filter(lineMatchesActiveFilters)
      .map((line) => ({
      ...line,
      __overlay_preview: false,
      }));
    const fromId = Number.parseInt(cableDraft.fromSlotId, 10);
    const toId = Number.parseInt(cableDraft.toSlotId, 10);
    const routeMode = cableDraft.routeMode === 'direct' ? 'direct' : 'transit';
    const selectedTransitId = Number.parseInt(cableDraft.transitId || activeCableTransitId, 10) || null;
    const transitId = routeMode === 'transit' ? selectedTransitId : null;
    if (fromId && toId && (routeMode === 'direct' || transitId)) {
      const previewLine = {
        id: `draft-${routeMode}-${transitId || 'none'}-${fromId}-${toId}`,
        route_mode: routeMode,
        transit_id: transitId,
        from_location_system_id: fromId,
        to_location_system_id: toId,
        system_id: Number.parseInt(cableDraft.systemId, 10) || null,
        category_id: cableDraft.categoryId === '' ? null : (Number.parseInt(cableDraft.categoryId, 10) || null),
        __overlay_preview: true,
      };
      if (lineMatchesActiveFilters(previewLine)) base.push(previewLine);
    }
    return base;
  }, [
    data.transitCableLines,
    lineMatchesActiveFilters,
    cableDraft.fromSlotId,
    cableDraft.toSlotId,
    cableDraft.systemId,
    cableDraft.categoryId,
    cableDraft.routeMode,
    cableDraft.transitId,
    activeCableTransitId,
  ]);

  useEffect(() => {
    let rafId = 0;
    const recompute = () => {
      const next = {};
      const nextFloorHeights = {};
      const linesByEntrance = new Map();
      entranceGridRefs.current.forEach((gridEl, entranceIdKey) => {
        if (!(gridEl instanceof HTMLElement)) return;
        const entranceId = Number.parseInt(String(entranceIdKey), 10);
        if (!entranceId) return;
        const heights = {};
        gridEl.querySelectorAll('[data-floor-id]').forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          const floorId = Number.parseInt(node.dataset.floorId || '', 10);
          if (!floorId) return;
          heights[floorId] = node.getBoundingClientRect().height;
        });
        nextFloorHeights[entranceId] = heights;
      });
      overlayCableLines.forEach((line) => {
        const transit = transitById.get(Number(line.transit_id));
        const fromPlacement = slotPlacementById.get(Number(line.from_location_system_id));
        const entranceId = Number(transit?.entrance_id || fromPlacement?.location?.entrance_id || 0);
        if (!entranceId) return;
        const list = linesByEntrance.get(entranceId) || [];
        list.push(line);
        linesByEntrance.set(entranceId, list);
      });

      linesByEntrance.forEach((lines, entranceId) => {
        const gridEl = entranceGridRefs.current.get(entranceId);
        if (!gridEl) return;
        const gridRect = gridEl.getBoundingClientRect();
        if (!gridRect.width || !gridRect.height) return;
        const rectToAnchor = (rect) => ({
          center: {
            x: rect.left - gridRect.left + (rect.width / 2),
            y: rect.top - gridRect.top + (rect.height / 2),
          },
          left: rect.left - gridRect.left,
          right: rect.right - gridRect.left,
          top: rect.top - gridRect.top,
          bottom: rect.bottom - gridRect.top,
        });
        const clampX = (value) => Math.max(2, Math.min(gridRect.width - 2, value));
        const clampY = (value) => Math.max(2, Math.min(gridRect.height - 2, value));
        const getTerminalPoint = (anchor, edge) => {
          if (edge === 'top') return { x: anchor.center.x, y: anchor.top };
          if (edge === 'bottom') return { x: anchor.center.x, y: anchor.bottom };
          if (edge === 'left') return { x: anchor.left, y: anchor.center.y };
          return { x: anchor.right, y: anchor.center.y };
        };
        const getJunctionPoint = (terminalPoint, edge) => {
          if (edge === 'top') return { x: terminalPoint.x, y: terminalPoint.y - 2 };
          if (edge === 'bottom') return { x: terminalPoint.x, y: terminalPoint.y + 2 };
          if (edge === 'left') return { x: terminalPoint.x - 2, y: terminalPoint.y };
          return { x: terminalPoint.x + 2, y: terminalPoint.y };
        };
        const getVerticalPreference = (edge, fromAnchor, toAnchor) => {
          if (edge === 'top') return 'up';
          if (edge === 'bottom') return 'down';
          return toAnchor.center.y >= fromAnchor.center.y ? 'down' : 'up';
        };
        const chooseAdaptiveEdge = ({
          anchor,
          otherAnchor,
          laneXHint,
          fallbackToVertical = false,
        }) => {
          const dxOther = otherAnchor.center.x - anchor.center.x;
          const dyOther = otherAnchor.center.y - anchor.center.y;
          const horizontalTowardOther = dxOther >= 0 ? 'right' : 'left';
          const verticalTowardOther = dyOther >= 0 ? 'bottom' : 'top';
          const laneSide = laneXHint >= anchor.center.x ? 'right' : 'left';
          const dxLane = Math.abs(laneXHint - anchor.center.x);
          const dyOtherAbs = Math.abs(dyOther);
          if (dxLane > (dyOtherAbs * 0.8)) return laneSide;
          if (Math.abs(dxOther) > (Math.abs(dyOther) * 1.1)) return horizontalTowardOther;
          if (fallbackToVertical) return verticalTowardOther;
          return anchor.center.y <= (gridRect.height / 2) ? 'top' : 'bottom';
        };
        const slotObstacles = Array.from(gridEl.querySelectorAll('[data-slot-id]'))
          .map((node) => {
            if (!(node instanceof HTMLElement)) return null;
            const slotId = Number.parseInt(node.dataset.slotId || '', 10);
            if (!slotId) return null;
            const rect = node.getBoundingClientRect();
            return {
              slotId,
              left: rect.left - gridRect.left,
              right: rect.right - gridRect.left,
              top: rect.top - gridRect.top,
              bottom: rect.bottom - gridRect.top,
            };
          })
          .filter(Boolean);
        const intersectsHorizontal = (rect, x1, x2, y) => (
          y > rect.top - 1
          && y < rect.bottom + 1
          && Math.max(x1, x2) > rect.left - 1
          && Math.min(x1, x2) < rect.right + 1
        );
        const intersectsVertical = (rect, x, y1, y2) => (
          x > rect.left - 1
          && x < rect.right + 1
          && Math.max(y1, y2) > rect.top - 1
          && Math.min(y1, y2) < rect.bottom + 1
        );
        const findSafeHorizontalY = ({
          initialY,
          x1,
          x2,
          preferredDirection = 'up',
          excludeSlotIds = null,
        }) => {
          let y = clampY(initialY);
          let direction = preferredDirection;
          for (let attempt = 0; attempt < 12; attempt += 1) {
            const conflicts = slotObstacles.filter((rect) => (
              !(excludeSlotIds?.has(rect.slotId))
              && intersectsHorizontal(rect, x1, x2, y)
            ));
            if (!conflicts.length) return y;
            const nextY = direction === 'up'
              ? clampY(Math.min(...conflicts.map((rect) => rect.top)) - 4)
              : clampY(Math.max(...conflicts.map((rect) => rect.bottom)) + 4);
            if (Math.abs(nextY - y) < 0.5) {
              direction = direction === 'up' ? 'down' : 'up';
            } else {
              y = nextY;
            }
          }
          return y;
        };
        const findSafeVerticalX = ({
          initialX,
          y1,
          y2,
          preferredDirection = 'right',
          excludeSlotIds = null,
        }) => {
          let x = clampX(initialX);
          let direction = preferredDirection;
          for (let attempt = 0; attempt < 12; attempt += 1) {
            const conflicts = slotObstacles.filter((rect) => (
              !(excludeSlotIds?.has(rect.slotId))
              && intersectsVertical(rect, x, y1, y2)
            ));
            if (!conflicts.length) return x;
            const nextX = direction === 'left'
              ? clampX(Math.min(...conflicts.map((rect) => rect.left)) - 4)
              : clampX(Math.max(...conflicts.map((rect) => rect.right)) + 4);
            if (Math.abs(nextX - x) < 0.5) {
              direction = direction === 'left' ? 'right' : 'left';
            } else {
              x = nextX;
            }
          }
          return x;
        };
        const pushPoint = (collection, point) => {
          const normalized = { x: clampX(point.x), y: clampY(point.y) };
          const prev = collection[collection.length - 1];
          if (prev && Math.abs(prev.x - normalized.x) < 0.01 && Math.abs(prev.y - normalized.y) < 0.01) return;
          collection.push(normalized);
        };
        const resolveSlotAnchor = (slotIdValue, transitPoint) => {
          const slotId = Number.parseInt(slotIdValue, 10);
          if (!slotId) return null;
          const slotEl = gridEl.querySelector(`[data-slot-id="${slotId}"]`);
          if (slotEl instanceof HTMLElement) {
            return rectToAnchor(slotEl.getBoundingClientRect());
          }
          const placement = slotPlacementById.get(slotId);
          const floorId = Number.parseInt(placement?.location?.floor_id, 10);
          if (!floorId) return null;
          const floorEl = gridEl.querySelector(`[data-floor-id="${floorId}"]`);
          if (!(floorEl instanceof HTMLElement)) return null;
          const floorRect = floorEl.getBoundingClientRect();
          const floorCenterX = floorRect.left - gridRect.left + (floorRect.width / 2);
          const floorCenterY = floorRect.top - gridRect.top + (floorRect.height / 2);
          const floorLeft = floorRect.left - gridRect.left;
          const floorRight = floorLeft + floorRect.width;
          const fallbackX = transitPoint && transitPoint.x > floorLeft
            ? Math.max(floorLeft + 8, floorRight - 12)
            : floorLeft + 12;
          return {
            center: { x: floorCenterX, y: floorCenterY },
            left: fallbackX - 1,
            right: fallbackX + 1,
            top: floorCenterY - 1,
            bottom: floorCenterY + 1,
          };
        };
        const describeLineEndpoint = (slotIdValue) => {
          const slotId = Number.parseInt(slotIdValue, 10);
          if (!slotId) return 'Блок не выбран';
          const placement = slotPlacementById.get(slotId);
          if (!placement?.slot || !placement?.location) return `Блок #${slotId}`;
          const { slot, location } = placement;
          if (slot.location_kind === 'apartment') {
            return `Кв. ${location.name} · эт. ${location.floor_name} · ${slot.system_name}${slot.category_name ? ` / ${slot.category_name}` : ''}`;
          }
          if (slot.location_kind === 'room') {
            const apartmentName = location.apartment_name ? ` · кв. ${location.apartment_name}` : '';
            return `Пом. ${location.name}${apartmentName} · эт. ${location.floor_name} · ${slot.system_name}${slot.category_name ? ` / ${slot.category_name}` : ''}`;
          }
          return `${getLocationKindTitle(slot.location_kind)} ${location.name || ''} · ${slot.system_name || 'Без системы'}`;
        };
        const buildSegments = (points) => points.slice(0, -1).map((point, idx) => {
          const nextPoint = points[idx + 1];
          const horizontal = Math.abs(nextPoint.y - point.y) < 0.01;
          return {
            x1: point.x,
            y1: point.y,
            x2: nextPoint.x,
            y2: nextPoint.y,
            horizontal,
          };
        });
        const segmentContains = (segment, x, y) => (
          x >= Math.min(segment.x1, segment.x2) - 0.01
          && x <= Math.max(segment.x1, segment.x2) + 0.01
          && y >= Math.min(segment.y1, segment.y2) - 0.01
          && y <= Math.max(segment.y1, segment.y2) + 0.01
        );
        const farFromEndpoints = (segment, x, y, minDistance = 1.1) => {
          const d1 = Math.hypot(x - segment.x1, y - segment.y1);
          const d2 = Math.hypot(x - segment.x2, y - segment.y2);
          return d1 > minDistance && d2 > minDistance;
        };

        const itemsByTransit = new Map();
        lines.forEach((line) => {
          const transitId = Number.parseInt(line.transit_id, 10);
          let transitAnchor = null;
          if (transitId) {
            const transitEl = gridEl.querySelector(`[data-transit-id="${transitId}"]`);
            if (transitEl instanceof HTMLElement) {
              transitAnchor = rectToAnchor(transitEl.getBoundingClientRect());
            }
          }
          const fromAnchor = resolveSlotAnchor(line.from_location_system_id, transitAnchor?.center || null);
          const toAnchor = resolveSlotAnchor(line.to_location_system_id, transitAnchor?.center || null);
          if (!fromAnchor || !toAnchor) return;

          const groupKey = transitAnchor ? `transit:${transitId}` : 'direct';
          const list = itemsByTransit.get(groupKey) || [];
          list.push({
            key: String(line.id),
            line,
            from: fromAnchor,
            to: toAnchor,
            transit: transitAnchor,
            fromSlotId: Number.parseInt(line.from_location_system_id, 10) || null,
            toSlotId: Number.parseInt(line.to_location_system_id, 10) || null,
          });
          itemsByTransit.set(groupKey, list);
        });

        const paths = [];
        const committedSegments = [];
        const laneSpacing = 2.8;
        const minLaneGap = 2.05;
        const usedVerticalLanes = [];
        const usedHorizontalLanes = [];
        const rangesOverlap = (a1, a2, b1, b2) => (
          Math.max(Math.min(a1, a2), Math.min(b1, b2))
          <= (Math.min(Math.max(a1, a2), Math.max(b1, b2)) + 0.01)
        );
        const hasVerticalLaneNear = (xValue, y1, y2) => usedVerticalLanes.some((used) => (
          Math.abs(used.x - xValue) < minLaneGap
          && rangesOverlap(used.y1, used.y2, y1, y2)
        ));
        const hasHorizontalLaneNear = (yValue, x1, x2) => usedHorizontalLanes.some((used) => (
          Math.abs(used.y - yValue) < minLaneGap
          && rangesOverlap(used.x1, used.x2, x1, x2)
        ));
        const reserveLaneX = ({
          initialX,
          y1,
          y2,
          preferredDirection,
          excludeSlotIds,
        }) => {
          for (let attempt = 0; attempt < 18; attempt += 1) {
            const ring = Math.floor(attempt / 2) + 1;
            const sign = attempt === 0 ? 0 : (attempt % 2 === 1 ? 1 : -1);
            const probeX = attempt === 0 ? initialX : (initialX + (sign * ring * minLaneGap));
            const safeX = findSafeVerticalX({
              initialX: probeX,
              y1,
              y2,
              preferredDirection,
              excludeSlotIds,
            });
            if (!hasVerticalLaneNear(safeX, y1, y2)) {
              usedVerticalLanes.push({ x: safeX, y1, y2 });
              return safeX;
            }
          }
          const fallback = findSafeVerticalX({
            initialX,
            y1,
            y2,
            preferredDirection,
            excludeSlotIds,
          });
          usedVerticalLanes.push({ x: fallback, y1, y2 });
          return fallback;
        };
        const reserveHorizontalY = ({
          initialY,
          x1,
          x2,
          preferredDirection,
          excludeSlotIds,
        }) => {
          for (let attempt = 0; attempt < 18; attempt += 1) {
            const ring = Math.floor(attempt / 2) + 1;
            const sign = attempt === 0 ? 0 : (attempt % 2 === 1 ? 1 : -1);
            const baseY = attempt === 0 ? initialY : (initialY + (sign * ring * minLaneGap));
            const safeY = findSafeHorizontalY({
              initialY: baseY,
              x1,
              x2,
              preferredDirection,
              excludeSlotIds,
            });
            if (!hasHorizontalLaneNear(safeY, x1, x2)) {
              usedHorizontalLanes.push({ y: safeY, x1, x2 });
              return safeY;
            }
          }
          const fallback = findSafeHorizontalY({
            initialY,
            x1,
            x2,
            preferredDirection,
            excludeSlotIds,
          });
          usedHorizontalLanes.push({ y: fallback, x1, x2 });
          return fallback;
        };
        itemsByTransit.forEach((items) => {
          if (!items.length) return;
          const fromOrdered = [...items].sort((a, b) => (a.from.center.y - b.from.center.y) || naturalCompare(a.key, b.key));
          const toOrdered = [...items].sort((a, b) => (a.to.center.y - b.to.center.y) || naturalCompare(a.key, b.key));
          const fromOrder = new Map(fromOrdered.map((item, index) => [item.key, index]));
          const toOrder = new Map(toOrdered.map((item, index) => [item.key, index]));
          const baseArranged = [...items].sort((a, b) => {
            const aFrom = fromOrder.get(a.key) ?? 0;
            const aTo = toOrder.get(a.key) ?? 0;
            const bFrom = fromOrder.get(b.key) ?? 0;
            const bTo = toOrder.get(b.key) ?? 0;
            return (
              (((aFrom + aTo) / 2) - ((bFrom + bTo) / 2))
              || (Math.abs(aFrom - aTo) - Math.abs(bFrom - bTo))
              || (a.from.center.y - b.from.center.y)
            );
          });
          const estimateCrossingScore = (order) => {
            let score = 0;
            for (let i = 0; i < order.length; i += 1) {
              for (let j = i + 1; j < order.length; j += 1) {
                const a = order[i];
                const b = order[j];
                const fromDelta = a.from.center.y - b.from.center.y;
                const toDelta = a.to.center.y - b.to.center.y;
                if (fromDelta === 0 || toDelta === 0) {
                  score += 0.12;
                } else if ((fromDelta > 0 && toDelta < 0) || (fromDelta < 0 && toDelta > 0)) {
                  score += 1;
                }
              }
            }
            return score;
          };
          const optimizeOrderBySwaps = (seedOrder) => {
            if (seedOrder.length < 3) return seedOrder;
            let best = [...seedOrder];
            let bestScore = estimateCrossingScore(best);
            // Adjacent-swap hill climbing: actively "swap places" where it reduces crossings.
            for (let pass = 0; pass < Math.min(10, best.length * 2); pass += 1) {
              let improved = false;
              for (let i = 0; i < best.length - 1; i += 1) {
                const candidate = [...best];
                [candidate[i], candidate[i + 1]] = [candidate[i + 1], candidate[i]];
                const candidateScore = estimateCrossingScore(candidate);
                if (candidateScore + 0.001 < bestScore) {
                  best = candidate;
                  bestScore = candidateScore;
                  improved = true;
                }
              }
              if (!improved) break;
            }
            const reversed = [...best].reverse();
            const reversedScore = estimateCrossingScore(reversed);
            return reversedScore + 0.001 < bestScore ? reversed : best;
          };
          const arranged = optimizeOrderBySwaps(baseArranged);
          const duplicateGroup = new Map();
          arranged.forEach((item) => {
            const a = Number(item.fromSlotId || 0);
            const b = Number(item.toSlotId || 0);
            const left = Math.min(a, b);
            const right = Math.max(a, b);
            const routeKey = `${item.line.route_mode || (item.transit ? 'transit' : 'direct')}:${Number(item.line.transit_id || 0)}`;
            const pairKey = `${routeKey}:${left}:${right}`;
            const list = duplicateGroup.get(pairKey) || [];
            list.push(item);
            duplicateGroup.set(pairKey, list);
          });
          const duplicateOffsetByKey = new Map();
          duplicateGroup.forEach((groupItems) => {
            if (groupItems.length <= 1) return;
            const sortedGroup = [...groupItems].sort((a, b) => naturalCompare(a.key, b.key));
            sortedGroup.forEach((item, index) => {
              const offset = (index - ((sortedGroup.length - 1) / 2)) * 0.9;
              duplicateOffsetByKey.set(item.key, offset);
            });
          });

          const hasTransitRoute = Boolean(arranged[0]?.transit);
          const globalRight = slotObstacles.length ? Math.max(...slotObstacles.map((rect) => rect.right)) : (gridRect.width - 2);
          const globalLeft = slotObstacles.length ? Math.min(...slotObstacles.map((rect) => rect.left)) : 2;
          const preferredRankByKey = new Map(arranged.map((item, index) => [item.key, index]));
          const scoreSegmentsAgainst = (segments, againstSegments) => {
            let score = 0;
            segments.forEach((segmentA) => {
              againstSegments.forEach((segmentB) => {
                if (segmentA.horizontal === segmentB.horizontal) {
                  if (segmentA.horizontal) {
                    if (Math.abs(segmentA.y1 - segmentB.y1) > 0.8) return;
                    const overlap = Math.min(
                      Math.max(segmentA.x1, segmentA.x2),
                      Math.max(segmentB.x1, segmentB.x2),
                    ) - Math.max(
                      Math.min(segmentA.x1, segmentA.x2),
                      Math.min(segmentB.x1, segmentB.x2),
                    );
                    if (overlap > 0.2) score += (0.8 + (overlap * 0.18));
                  } else {
                    if (Math.abs(segmentA.x1 - segmentB.x1) > 0.8) return;
                    const overlap = Math.min(
                      Math.max(segmentA.y1, segmentA.y2),
                      Math.max(segmentB.y1, segmentB.y2),
                    ) - Math.max(
                      Math.min(segmentA.y1, segmentA.y2),
                      Math.min(segmentB.y1, segmentB.y2),
                    );
                    if (overlap > 0.2) score += (0.8 + (overlap * 0.18));
                  }
                  return;
                }
                const horizontal = segmentA.horizontal ? segmentA : segmentB;
                const vertical = segmentA.horizontal ? segmentB : segmentA;
                const x = vertical.x1;
                const y = horizontal.y1;
                if (!segmentContains(horizontal, x, y) || !segmentContains(vertical, x, y)) return;
                if (!farFromEndpoints(horizontal, x, y, 2.2) || !farFromEndpoints(vertical, x, y, 2.2)) return;
                score += 1.6;
              });
            });
            return score;
          };
          const buildCandidateSegments = (item, laneRank) => {
            const excludeSlotIds = new Set([item.fromSlotId, item.toSlotId].filter(Boolean));
            const duplicateOffset = duplicateOffsetByKey.get(item.key) || 0;
            const laneShift = (laneRank - ((arranged.length - 1) / 2)) * laneSpacing;
            const points = [];
            if (hasTransitRoute && item.transit) {
              const averageX = (item.from.center.x + item.to.center.x) / 2;
              const useRightTransitSide = averageX >= item.transit.center.x;
              const laneBase = useRightTransitSide ? (item.transit.right - 6) : (item.transit.left + 6);
              const laneXHint = laneBase + laneShift;
              const fromEdge = chooseAdaptiveEdge({
                anchor: item.from,
                otherAnchor: item.to,
                laneXHint,
                fallbackToVertical: true,
              });
              const toEdge = chooseAdaptiveEdge({
                anchor: item.to,
                otherAnchor: item.from,
                laneXHint,
                fallbackToVertical: true,
              });
              const fromTerminal = getTerminalPoint(item.from, fromEdge);
              const toTerminal = getTerminalPoint(item.to, toEdge);
              const fromJunction = getJunctionPoint(fromTerminal, fromEdge);
              const toJunction = getJunctionPoint(toTerminal, toEdge);
              const fromY = findSafeHorizontalY({
                initialY: fromJunction.y + duplicateOffset,
                x1: fromJunction.x,
                x2: laneXHint,
                preferredDirection: getVerticalPreference(fromEdge, item.from, item.to),
                excludeSlotIds,
              });
              const toY = findSafeHorizontalY({
                initialY: toJunction.y + duplicateOffset,
                x1: laneXHint,
                x2: toJunction.x,
                preferredDirection: getVerticalPreference(toEdge, item.to, item.from),
                excludeSlotIds,
              });
              const laneX = findSafeVerticalX({
                initialX: laneXHint,
                y1: fromY,
                y2: toY,
                preferredDirection: useRightTransitSide ? 'right' : 'left',
                excludeSlotIds,
              });
              pushPoint(points, fromTerminal);
              pushPoint(points, fromJunction);
              if (Math.abs(fromY - fromJunction.y) > 0.5) pushPoint(points, { x: fromJunction.x, y: fromY });
              pushPoint(points, { x: laneX, y: fromY });
              if (Math.abs(toY - fromY) > 0.5) pushPoint(points, { x: laneX, y: toY });
              pushPoint(points, { x: toJunction.x, y: toY });
              if (Math.abs(toY - toJunction.y) > 0.5) pushPoint(points, { x: toJunction.x, y: toJunction.y });
              pushPoint(points, toTerminal);
            } else {
              const directionRight = item.to.center.x >= item.from.center.x;
              const freeRight = gridRect.width - globalRight;
              const freeLeft = globalLeft;
              let useRight = directionRight;
              if (useRight && freeRight < 10 && freeLeft > freeRight) useRight = false;
              if (!useRight && freeLeft < 10 && freeRight > freeLeft) useRight = true;
              const rightBase = Math.min(gridRect.width - 6, globalRight + 8);
              const leftBase = Math.max(6, globalLeft - 8);
              const laneBase = (useRight ? rightBase : leftBase) + laneShift;
              const fromEdge = chooseAdaptiveEdge({
                anchor: item.from,
                otherAnchor: item.to,
                laneXHint: laneBase,
                fallbackToVertical: false,
              });
              const toEdge = chooseAdaptiveEdge({
                anchor: item.to,
                otherAnchor: item.from,
                laneXHint: laneBase,
                fallbackToVertical: false,
              });
              const fromTerminal = getTerminalPoint(item.from, fromEdge);
              const toTerminal = getTerminalPoint(item.to, toEdge);
              const fromJunction = getJunctionPoint(fromTerminal, fromEdge);
              const toJunction = getJunctionPoint(toTerminal, toEdge);
              const fromY = findSafeHorizontalY({
                initialY: fromJunction.y + duplicateOffset,
                x1: fromJunction.x,
                x2: laneBase,
                preferredDirection: getVerticalPreference(fromEdge, item.from, item.to),
                excludeSlotIds,
              });
              const toY = findSafeHorizontalY({
                initialY: toJunction.y + duplicateOffset,
                x1: laneBase,
                x2: toJunction.x,
                preferredDirection: getVerticalPreference(toEdge, item.to, item.from),
                excludeSlotIds,
              });
              const laneX = findSafeVerticalX({
                initialX: laneBase,
                y1: fromY,
                y2: toY,
                preferredDirection: useRight ? 'right' : 'left',
                excludeSlotIds,
              });
              pushPoint(points, fromTerminal);
              pushPoint(points, fromJunction);
              if (Math.abs(fromY - fromJunction.y) > 0.5) pushPoint(points, { x: fromJunction.x, y: fromY });
              pushPoint(points, { x: laneX, y: fromY });
              if (Math.abs(toY - fromY) > 0.5) pushPoint(points, { x: laneX, y: toY });
              pushPoint(points, { x: toJunction.x, y: toY });
              if (Math.abs(toY - toJunction.y) > 0.5) pushPoint(points, { x: toJunction.x, y: toJunction.y });
              pushPoint(points, toTerminal);
            }
            return buildSegments(points);
          };
          const laneRankByKey = new Map();
          const availableLaneRanks = new Set(arranged.map((_, index) => index));
          const groupPreviewSegments = [];
          const lanePickOrder = [...arranged].sort((a, b) => (
            Math.abs(b.from.center.y - b.to.center.y) - Math.abs(a.from.center.y - a.to.center.y)
          ) || naturalCompare(a.key, b.key));
          lanePickOrder.forEach((item) => {
            let bestRank = null;
            let bestScore = Number.POSITIVE_INFINITY;
            let bestSegments = null;
            availableLaneRanks.forEach((laneRank) => {
              const candidateSegments = buildCandidateSegments(item, laneRank);
              const crossingScore = scoreSegmentsAgainst(candidateSegments, [...committedSegments, ...groupPreviewSegments]);
              const distancePenalty = Math.abs((preferredRankByKey.get(item.key) ?? laneRank) - laneRank) * 0.09;
              const score = crossingScore + distancePenalty;
              if (score + 0.0001 < bestScore) {
                bestScore = score;
                bestRank = laneRank;
                bestSegments = candidateSegments;
              }
            });
            if (bestRank == null) return;
            laneRankByKey.set(item.key, bestRank);
            availableLaneRanks.delete(bestRank);
            if (bestSegments?.length) groupPreviewSegments.push(...bestSegments);
          });
          const evaluateLaneMapScore = (rankMap) => {
            const itemSegments = arranged.map((item, idx) => (
              buildCandidateSegments(item, rankMap.get(item.key) ?? idx)
            ));
            let score = 0;
            for (let i = 0; i < itemSegments.length; i += 1) {
              score += scoreSegmentsAgainst(itemSegments[i], committedSegments);
              for (let j = i + 1; j < itemSegments.length; j += 1) {
                score += scoreSegmentsAgainst(itemSegments[i], itemSegments[j]);
              }
            }
            return score;
          };
          let laneScore = evaluateLaneMapScore(laneRankByKey);
          for (let pass = 0; pass < Math.min(8, arranged.length + 1); pass += 1) {
            let improved = false;
            const rankedItems = [...arranged].sort((a, b) => (
              (laneRankByKey.get(a.key) ?? 0) - (laneRankByKey.get(b.key) ?? 0)
            ));
            for (let i = 0; i < rankedItems.length - 1; i += 1) {
              const left = rankedItems[i];
              const right = rankedItems[i + 1];
              const leftRank = laneRankByKey.get(left.key);
              const rightRank = laneRankByKey.get(right.key);
              if (leftRank == null || rightRank == null) continue;
              const candidateMap = new Map(laneRankByKey);
              candidateMap.set(left.key, rightRank);
              candidateMap.set(right.key, leftRank);
              const candidateScore = evaluateLaneMapScore(candidateMap);
              if (candidateScore + 0.001 < laneScore) {
                laneRankByKey.set(left.key, rightRank);
                laneRankByKey.set(right.key, leftRank);
                laneScore = candidateScore;
                improved = true;
              }
            }
            if (!improved) break;
          }
          arranged.forEach((item, index) => {
            const laneRank = laneRankByKey.get(item.key) ?? index;
            const excludeSlotIds = new Set([item.fromSlotId, item.toSlotId].filter(Boolean));
            const duplicateOffset = duplicateOffsetByKey.get(item.key) || 0;
            const points = [];
            if (hasTransitRoute && item.transit) {
              const laneShift = (laneRank - ((arranged.length - 1) / 2)) * laneSpacing;
              const averageX = (item.from.center.x + item.to.center.x) / 2;
              const useRightTransitSide = averageX >= item.transit.center.x;
              const laneBase = useRightTransitSide ? (item.transit.right - 6) : (item.transit.left + 6);
              const laneXHint = laneBase + laneShift;
              const fromEdge = chooseAdaptiveEdge({
                anchor: item.from,
                otherAnchor: item.to,
                laneXHint,
                fallbackToVertical: true,
              });
              const toEdge = chooseAdaptiveEdge({
                anchor: item.to,
                otherAnchor: item.from,
                laneXHint,
                fallbackToVertical: true,
              });
              const fromTerminal = getTerminalPoint(item.from, fromEdge);
              const toTerminal = getTerminalPoint(item.to, toEdge);
              const fromJunction = getJunctionPoint(fromTerminal, fromEdge);
              const toJunction = getJunctionPoint(toTerminal, toEdge);
              const fromYBase = findSafeHorizontalY({
                initialY: fromJunction.y + duplicateOffset,
                x1: fromJunction.x,
                x2: laneXHint,
                preferredDirection: getVerticalPreference(fromEdge, item.from, item.to),
                excludeSlotIds,
              });
              const toYBase = findSafeHorizontalY({
                initialY: toJunction.y + duplicateOffset,
                x1: laneXHint,
                x2: toJunction.x,
                preferredDirection: getVerticalPreference(toEdge, item.to, item.from),
                excludeSlotIds,
              });
              const laneXProbe = findSafeVerticalX({
                initialX: laneXHint,
                y1: fromYBase,
                y2: toYBase,
                preferredDirection: useRightTransitSide ? 'right' : 'left',
                excludeSlotIds,
              });
              const fromY = reserveHorizontalY({
                initialY: fromYBase,
                x1: fromJunction.x,
                x2: laneXProbe,
                preferredDirection: getVerticalPreference(fromEdge, item.from, item.to),
                excludeSlotIds,
              });
              const toY = reserveHorizontalY({
                initialY: toYBase,
                x1: laneXProbe,
                x2: toJunction.x,
                preferredDirection: getVerticalPreference(toEdge, item.to, item.from),
                excludeSlotIds,
              });
              const laneX = reserveLaneX({
                initialX: laneXProbe,
                y1: fromY,
                y2: toY,
                preferredDirection: useRightTransitSide ? 'right' : 'left',
                excludeSlotIds,
              });
              pushPoint(points, fromTerminal);
              pushPoint(points, fromJunction);
              if (Math.abs(fromY - fromJunction.y) > 0.5) {
                pushPoint(points, { x: fromJunction.x, y: fromY });
              }
              pushPoint(points, { x: laneX, y: fromY });
              if (Math.abs(toY - fromY) > 0.5) {
                pushPoint(points, { x: laneX, y: toY });
              }
              pushPoint(points, { x: toJunction.x, y: toY });
              if (Math.abs(toY - toJunction.y) > 0.5) {
                pushPoint(points, { x: toJunction.x, y: toJunction.y });
              }
              pushPoint(points, toTerminal);
            } else {
              const directionRight = item.to.center.x >= item.from.center.x;
              const freeRight = gridRect.width - globalRight;
              const freeLeft = globalLeft;
              let useRight = directionRight;
              if (useRight && freeRight < 10 && freeLeft > freeRight) useRight = false;
              if (!useRight && freeLeft < 10 && freeRight > freeLeft) useRight = true;
              const rightBase = Math.min(gridRect.width - 6, globalRight + 8);
              const leftBase = Math.max(6, globalLeft - 8);
              const preferredBase = useRight ? rightBase : leftBase;
              const laneShift = (laneRank - ((arranged.length - 1) / 2)) * laneSpacing;
              const laneBase = preferredBase + laneShift;
              const fromEdge = chooseAdaptiveEdge({
                anchor: item.from,
                otherAnchor: item.to,
                laneXHint: laneBase,
                fallbackToVertical: false,
              });
              const toEdge = chooseAdaptiveEdge({
                anchor: item.to,
                otherAnchor: item.from,
                laneXHint: laneBase,
                fallbackToVertical: false,
              });
              const fromTerminal = getTerminalPoint(item.from, fromEdge);
              const toTerminal = getTerminalPoint(item.to, toEdge);
              const fromJunction = getJunctionPoint(fromTerminal, fromEdge);
              const toJunction = getJunctionPoint(toTerminal, toEdge);
              const fromYBase = findSafeHorizontalY({
                initialY: fromJunction.y + duplicateOffset,
                x1: fromJunction.x,
                x2: laneBase,
                preferredDirection: getVerticalPreference(fromEdge, item.from, item.to),
                excludeSlotIds,
              });
              const toYBase = findSafeHorizontalY({
                initialY: toJunction.y + duplicateOffset,
                x1: laneBase,
                x2: toJunction.x,
                preferredDirection: getVerticalPreference(toEdge, item.to, item.from),
                excludeSlotIds,
              });
              const corridorXProbe = findSafeVerticalX({
                initialX: laneBase,
                y1: fromYBase,
                y2: toYBase,
                preferredDirection: useRight ? 'right' : 'left',
                excludeSlotIds,
              });
              const fromY = reserveHorizontalY({
                initialY: fromYBase,
                x1: fromJunction.x,
                x2: corridorXProbe,
                preferredDirection: getVerticalPreference(fromEdge, item.from, item.to),
                excludeSlotIds,
              });
              const toY = reserveHorizontalY({
                initialY: toYBase,
                x1: corridorXProbe,
                x2: toJunction.x,
                preferredDirection: getVerticalPreference(toEdge, item.to, item.from),
                excludeSlotIds,
              });
              const corridorX = reserveLaneX({
                initialX: corridorXProbe,
                y1: fromY,
                y2: toY,
                preferredDirection: useRight ? 'right' : 'left',
                excludeSlotIds,
              });
              pushPoint(points, fromTerminal);
              pushPoint(points, fromJunction);
              if (Math.abs(fromY - fromJunction.y) > 0.5) {
                pushPoint(points, { x: fromJunction.x, y: fromY });
              }
              pushPoint(points, { x: corridorX, y: fromY });
              if (Math.abs(toY - fromY) > 0.5) {
                pushPoint(points, { x: corridorX, y: toY });
              }
              pushPoint(points, { x: toJunction.x, y: toY });
              if (Math.abs(toY - toJunction.y) > 0.5) {
                pushPoint(points, { x: toJunction.x, y: toJunction.y });
              }
              pushPoint(points, toTerminal);
            }
            const d = points.map((point, idx) => `${idx === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
            const segments = buildSegments(points);
            if (segments.length) committedSegments.push(...segments);
            const optimistic = Boolean(item.line.__optimistic);
            const createdAtMs = Number(new Date(item.line.created_at || 0).getTime() || 0);
            const numericLineId = Number.parseInt(String(item.line.id || ''), 10);
            const priorityScore = Number.isFinite(numericLineId) && numericLineId > 0
              ? numericLineId
              : (createdAtMs > 0 ? createdAtMs : (index + 1));
            paths.push({
              key: `${item.key}:${item.line.transit_id}`,
              lineId: item.line.__overlay_preview || optimistic ? null : item.line.id,
              d,
              color: '#F8FAFC',
              preview: Boolean(item.line.__overlay_preview || optimistic),
              segments,
              priorityScore,
              name: String(item.line.name || '').trim() || 'Без названия',
              lengthM: Number(item.line.length_m || 0),
              fromLabel: describeLineEndpoint(item.fromSlotId),
              toLabel: describeLineEndpoint(item.toSlotId),
            });
          });
        });

        const jumps = [];
        const jumpSeen = new Set();
        for (let i = 0; i < paths.length; i += 1) {
          for (let j = i + 1; j < paths.length; j += 1) {
            const pathA = paths[i];
            const pathB = paths[j];
            if (pathA.preview || pathB.preview) continue;
            pathA.segments?.forEach((segmentA) => {
              pathB.segments?.forEach((segmentB) => {
                if (segmentA.horizontal === segmentB.horizontal) return;
                const horizontal = segmentA.horizontal ? segmentA : segmentB;
                const vertical = segmentA.horizontal ? segmentB : segmentA;
                const x = vertical.x1;
                const y = horizontal.y1;
                if (!segmentContains(horizontal, x, y) || !segmentContains(vertical, x, y)) return;
                if (!farFromEndpoints(horizontal, x, y, 2.2) || !farFromEndpoints(vertical, x, y, 2.2)) return;
                const jumperPath = (() => {
                  const scoreA = Number(pathA.priorityScore || 0);
                  const scoreB = Number(pathB.priorityScore || 0);
                  if (scoreA === scoreB) return segmentA.horizontal ? pathA : pathB;
                  return scoreA > scoreB ? pathA : pathB;
                })();
                const jumperSegment = jumperPath === pathA ? segmentA : segmentB;
                const orientation = jumperSegment.horizontal ? 'horizontal' : 'vertical';
                const key = `${jumperPath.key}:${x.toFixed(2)}:${y.toFixed(2)}:${orientation}`;
                if (jumpSeen.has(key)) return;
                jumpSeen.add(key);
                jumps.push({
                  key,
                  pathKey: jumperPath.key,
                  x,
                  y,
                  orientation,
                });
              });
            });
          }
        }

        next[entranceId] = {
          width: gridRect.width,
          height: gridRect.height,
          paths,
          jumps,
        };
      });
      setEntranceCableOverlay(next);
      setEntranceFloorHeights(nextFloorHeights);
    };

    const schedule = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(recompute);
    };
    schedule();
    window.addEventListener('resize', schedule);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('resize', schedule);
    };
  }, [
    overlayCableLines,
    transitById,
    slotPlacementById,
    collapsedFloors,
    selectedSystemIds,
    selectedCategoryIds,
    selectedApartmentScopes,
    selectedRoomNames,
    activeCableTransitId,
  ]);

  const renderLinearLocationSegments = (locationRow, locationTitle, entranceId) => {
    const spanFloors = Array.isArray(locationRow?.spanFloors) ? locationRow.spanFloors : [];
    if (!spanFloors.length) return null;
    const canPasteSlot = Boolean(copiedSlotTemplate);
    const actionsDisabled = !!pasteBusyKey || slotBusy || Boolean(
      (activeCableTransitId && cablePickTarget)
      || cableEditPickTarget,
    );
    const pasteTitle = copiedSlotTemplate ? `Вставить блок: ${copiedSlotTemplate.systemName}` : 'Вставить блок';
    const floorHeights = entranceFloorHeights[Number(entranceId)] || {};
    const resolveSegmentHeight = (floorId) => {
      const measured = floorId ? Number(floorHeights[floorId] || 0) : 0;
      if (!Number.isFinite(measured) || measured <= 0) return null;
      return measured;
    };

    if (locationRow._kind === 'transit') {
      return (
        <div className="space-y-0 rounded border border-cyan-300/20 bg-cyan-950/20 overflow-hidden">
            {spanFloors.map((floorRow, index) => {
              const floorId = Number.parseInt(floorRow?.id, 10);
              const isCollapsed = floorId ? collapsedFloorSet.has(floorId) : false;
              const segmentHeight = resolveSegmentHeight(floorId);
              return (
                <div
                  key={`transit-floor-segment-${locationRow.id}-${floorRow.id}-${index}`}
                  className={`rounded-none border-x border-b border-cyan-400/20 bg-black/25 p-1 overflow-hidden ${isCollapsed ? 'opacity-75' : ''}`}
                  style={segmentHeight ? { height: `${segmentHeight}px` } : undefined}
                >
                  <div className="h-full flex items-center justify-between gap-1">
                    <span className="text-[8px] text-zinc-200">Этаж {floorRow.name}</span>
                    {isCollapsed ? (
                      <span className="text-[8px] text-zinc-500">свернут</span>
                    ) : (
                      <div className="flex gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => openCreateSlotModal(locationRow._kind, locationRow.id, `${locationTitle} · эт. ${floorRow.name}`)}
                          className="px-1 py-0.5 rounded border border-cyan-300/35 text-[8px] text-cyan-100 hover:bg-cyan-900/35 disabled:opacity-50"
                          disabled={actionsDisabled}
                        >
                          +Блок
                        </button>
                        {canPasteSlot && (
                          <button
                            type="button"
                            onClick={() => handlePasteSlotToLocation(locationRow._kind, locationRow.id, `${locationTitle} · эт. ${floorRow.name}`)}
                            className="px-1 py-0.5 rounded border border-sky-400/35 text-[8px] text-sky-200 hover:bg-sky-900/30 disabled:opacity-50"
                            disabled={actionsDisabled}
                            title={pasteTitle}
                          >
                            Встав.
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      );
    }

    if (locationRow._kind === 'stairwell') {
      return (
        <div className="space-y-0 rounded border border-emerald-300/20 bg-emerald-950/20 overflow-hidden">
            {spanFloors.map((floorRow, index) => {
            const floorId = Number.parseInt(floorRow?.id, 10);
            const isCollapsed = floorId ? collapsedFloorSet.has(floorId) : false;
            const segmentHeight = resolveSegmentHeight(floorId);
            return (
              <div
                key={`stair-floor-segment-${locationRow.id}-${floorRow.id}-${index}`}
                className={`relative border-x border-b border-emerald-400/20 bg-black/25 overflow-hidden ${isCollapsed ? 'opacity-75' : ''}`}
                style={{
                  marginLeft: `${(index % 2) * 10}px`,
                  ...(segmentHeight ? { height: `${segmentHeight}px` } : {}),
                }}
              >
                <div className="h-full grid grid-rows-2">
                  <div className="border-b border-emerald-300/20 px-1 py-0.5 flex items-center justify-between gap-1">
                    <span className="text-[8px] text-zinc-200 truncate">Этаж {floorRow.name}</span>
                    {!isCollapsed && (
                      <button
                        type="button"
                        onClick={() => openCreateSlotModal(locationRow._kind, locationRow.id, `${locationTitle} · эт. ${floorRow.name} · этаж`)}
                        className="px-1 py-0.5 rounded border border-emerald-300/35 text-[8px] text-emerald-100 hover:bg-emerald-900/30 disabled:opacity-50"
                        disabled={actionsDisabled}
                      >
                        +Блок
                      </button>
                    )}
                  </div>
                  <div className="px-1 py-0.5 flex items-center justify-between gap-1">
                    <span className="text-[8px] text-zinc-400 truncate">Межэтаж</span>
                    {!isCollapsed ? (
                    <button
                      type="button"
                      onClick={() => openCreateSlotModal(locationRow._kind, locationRow.id, `${locationTitle} · эт. ${floorRow.name} · межэтаж`)}
                      className="px-1 py-0.5 rounded border border-emerald-200/25 text-[8px] text-emerald-50 hover:bg-emerald-900/25 disabled:opacity-50"
                      disabled={actionsDisabled}
                    >
                      +Блок
                    </button>
                    ) : (
                      <span className="text-[8px] text-zinc-500">свернут</span>
                    )}
                  </div>
                </div>
                {index < spanFloors.length - 1 && (
                  <div
                    className="pointer-events-none absolute -bottom-1 left-2 h-2.5 w-[calc(100%-1rem)] border-b border-dashed border-emerald-300/25"
                    style={{ transform: index % 2 === 0 ? 'skewX(18deg)' : 'skewX(-18deg)' }}
                  />
                )}
              </div>
            );
            })}
        </div>
      );
    }

    return null;
  };

  const renderTransitCablePanel = (transitRow) => {
    const transitId = transitRow.id;
    const transitLines = (transitCableLinesByTransit.get(transitId) || []).filter(lineMatchesActiveFilters);
    const directLines = (data.transitCableLines || []).filter((line) => {
      if (line.transit_id != null) return false;
      if (!lineMatchesActiveFilters(line)) return false;
      const fromPlacement = slotPlacementById.get(Number(line.from_location_system_id));
      if (!fromPlacement?.location) return false;
      return Number(fromPlacement.location.entrance_id || 0) === Number(transitRow.entrance_id || 0);
    });
    const lines = [
      ...transitLines,
      ...(Number(activeCableTransitId) === Number(transitId) ? directLines : []),
    ].sort((a, b) => (
      naturalCompare(a.name || '', b.name || '')
      || ((Number.parseInt(a.id, 10) || 0) - (Number.parseInt(b.id, 10) || 0))
    ));
    const isActive = Number(activeCableTransitId) === Number(transitId);
    const fromLabel = cableDraft.fromSlotId ? describeSlot(cableDraft.fromSlotId) : 'Не выбран';
    const toLabel = cableDraft.toSlotId ? describeSlot(cableDraft.toSlotId) : 'Не выбран';
    const entranceTransits = transitsByEntrance.get(transitRow.entrance_id) || [];
    const effectiveTransitId = cableDraft.transitId || String(transitId);
    const routeTransit = cableDraft.routeMode === 'transit'
      ? (transitById.get(Number.parseInt(effectiveTransitId, 10)) || null)
      : null;
    const selectableSlots = isActive
      ? getSelectableTransitSlots(routeTransit, {
        routeMode: cableDraft.routeMode,
        anchorTransit: activeCableTransit,
      })
      : [];
    const pickTargetTitle = cablePickTarget === 'from'
      ? 'Выбор блока: ОТ'
      : (cablePickTarget === 'to' ? 'Выбор блока: ДО' : '');
    return (
      <div className="relative z-30 rounded-md border border-cyan-400/25 bg-cyan-950/15 p-1.5 space-y-1.5">
        <div className="flex flex-wrap items-center gap-1">
          {!isActive ? (
            <button
              type="button"
              onClick={() => handleStartCableSelection(transitId)}
              className="px-2 py-0.5 rounded border border-cyan-300/40 text-[9px] text-cyan-100 hover:bg-cyan-900/35"
              disabled={cableBusy}
            >
              Добавить кабель
            </button>
          ) : (
            <button
              type="button"
              onClick={handleCancelCableSelection}
              className="px-2 py-0.5 rounded border border-white/25 text-[9px] text-zinc-100 hover:bg-white/10"
              disabled={cableBusy}
            >
              Закрыть выбор
            </button>
          )}
          {!!lines.length && (
            <span className="text-[9px] text-zinc-300 rounded-full border border-white/15 px-1.5 py-0.5">
              Линий: {lines.length}
            </span>
          )}
        </div>

        {isActive && (
          <form className="space-y-1.5" onSubmit={(e) => handleSaveCableLine(e, transitId, { keepOpen: true })}>
            <div className="grid grid-cols-1 gap-1.5">
              <select
                value={cableDraft.routeMode || 'transit'}
                onChange={(e) => {
                  const routeMode = e.target.value === 'direct' ? 'direct' : 'transit';
                  setCableDraft((prev) => ({
                    ...prev,
                    routeMode,
                    transitId: routeMode === 'transit' ? (prev.transitId || String(transitId)) : '',
                    fromSlotId: null,
                    toSlotId: null,
                  }));
                  setCablePickTarget('from');
                  setCableSelectedMaterial(null);
                }}
                className="input h-7 text-xs"
                disabled={cableBusy}
              >
                <option value="transit">Через транзит</option>
                <option value="direct">Прямая линия</option>
              </select>
              {cableDraft.routeMode !== 'direct' && (
                <select
                  value={effectiveTransitId}
                  onChange={(e) => {
                    const nextTransitId = e.target.value;
                    setCableDraft((prev) => ({
                      ...prev,
                      transitId: nextTransitId,
                      fromSlotId: null,
                      toSlotId: null,
                    }));
                    setCablePickTarget('from');
                    setCableSelectedMaterial(null);
                  }}
                  className="input h-7 text-xs"
                  disabled={cableBusy}
                  required
                >
                  <option value="">Название транзита</option>
                  {entranceTransits.map((transitOption) => (
                    <option key={`cable-transit-${transitOption.id}`} value={transitOption.id}>
                      {transitOption.name}
                    </option>
                  ))}
                </select>
              )}
              <select
                value={cableDraft.systemId}
                onChange={(e) => {
                  const nextValue = e.target.value;
                  setCableDraft((prev) => ({
                    ...prev,
                    systemId: nextValue,
                  }));
                  setCableSelectedMaterial(null);
                }}
                className="input h-7 text-xs"
                disabled={cableBusy}
              >
                <option value="">Система (не выбрана)</option>
                {data.systems.map((system) => (
                  <option key={system.id} value={system.id}>{system.name}</option>
                ))}
              </select>
              <select
                value={cableDraft.categoryId}
                onChange={(e) => {
                  const nextValue = e.target.value;
                  setCableDraft((prev) => ({
                    ...prev,
                    categoryId: nextValue,
                  }));
                  setCableSelectedMaterial(null);
                }}
                className="input h-7 text-xs"
                disabled={cableBusy}
              >
                <option value="">Категория (не выбрана)</option>
                {data.categories.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
            </div>
            <div className="rounded border border-cyan-300/25 bg-cyan-950/20 p-1.5 space-y-1">
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  onClick={() => setCablePickTarget('from')}
                  className={`px-2 py-0.5 rounded border text-[9px] ${cablePickTarget === 'from' ? 'border-cyan-200/70 text-cyan-100 bg-cyan-900/45' : 'border-white/20 text-zinc-200 hover:bg-white/10'}`}
                  disabled={cableBusy}
                >
                  От
                </button>
                <button
                  type="button"
                  onClick={() => setCablePickTarget('to')}
                  className={`px-2 py-0.5 rounded border text-[9px] ${cablePickTarget === 'to' ? 'border-cyan-200/70 text-cyan-100 bg-cyan-900/45' : 'border-white/20 text-zinc-200 hover:bg-white/10'}`}
                  disabled={cableBusy}
                >
                  До
                </button>
                {Boolean(cablePickTarget) && (
                  <button
                    type="button"
                    onClick={() => setCablePickTarget('')}
                    className="px-2 py-0.5 rounded border border-white/20 text-[9px] text-zinc-300 hover:bg-white/10"
                    disabled={cableBusy}
                  >
                    Снять выбор
                  </button>
                )}
              </div>
              {cablePickTarget && (
                <div className="space-y-1">
                  <p className="text-[9px] text-cyan-100">{pickTargetTitle}</p>
                  <div className="max-h-32 overflow-auto rounded border border-white/10 bg-black/25 p-1 space-y-0.5">
                    {selectableSlots.length === 0 ? (
                      <p className="text-[9px] text-zinc-400 px-1 py-0.5">Нет доступных блоков для выбранной системы/категории.</p>
                    ) : selectableSlots.map((slot) => (
                      <button
                        key={`pick-${slot.id}`}
                        type="button"
                        onClick={() => handlePickCableSlot(slot)}
                        className="w-full text-left rounded border border-white/10 px-1.5 py-1 text-[9px] text-zinc-200 hover:bg-white/10"
                        disabled={cableBusy}
                      >
                        {describeSlot(slot.id)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 gap-1.5">
              <input
                type="text"
                value={fromLabel}
                className="input h-7 text-xs"
                readOnly
                placeholder="От"
              />
              <input
                type="text"
                value={toLabel}
                className="input h-7 text-xs"
                readOnly
                placeholder="До"
              />
              <input
                type="text"
                value={cableDraft.name}
                onChange={(e) => {
                  const nextName = e.target.value;
                  setCableDraft((prev) => ({ ...prev, name: nextName }));
                  if (!nextName || normalizeNameKey(nextName) !== normalizeNameKey(cableSelectedMaterial?.name)) {
                    setCableSelectedMaterial(null);
                  }
                }}
                placeholder="Название кабеля"
                className="input h-7 text-xs"
                disabled={cableBusy}
                required
              />
              {String(cableDraft.name || '').trim().length > 0 && (
                <div className="rounded border border-white/10 bg-black/25 p-1.5 space-y-1">
                  {!cableDraft.systemId ? (
                    <p className="text-[9px] text-zinc-400">Для подсказок выберите систему кабеля.</p>
                  ) : cableStockSuggestionLoading ? (
                    <p className="text-[9px] text-zinc-400">Поиск материалов…</p>
                  ) : cableStockSuggestions.length ? (
                    <div className="max-h-28 overflow-auto space-y-0.5">
                      {cableStockSuggestions.map((material) => (
                        <button
                          key={`cable-material-${material.id}`}
                          type="button"
                          onClick={() => {
                            setCableDraft((prev) => ({ ...prev, name: material.name || '' }));
                            setCableSelectedMaterial(material);
                          }}
                          className={`w-full text-left rounded border px-1.5 py-1 text-[9px] hover:bg-white/10 ${
                            cableSelectedMaterial?.id === material.id
                              ? 'border-cyan-300/45 text-cyan-100 bg-cyan-900/25'
                              : 'border-white/10 text-zinc-200'
                          }`}
                          disabled={cableBusy}
                        >
                          <span className="truncate block">{material.name}</span>
                          <span className="text-zinc-500">{formatQty(material.quantity)} {material.unit || ''}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[9px] text-zinc-500">На складе нет совпадений по системе/категории.</p>
                  )}
                </div>
              )}
              <input
                type="text"
                inputMode="decimal"
                value={cableDraft.lengthM}
                onChange={(e) => setCableDraft((prev) => ({ ...prev, lengthM: e.target.value }))}
                placeholder="Длина, м"
                className="input h-7 text-xs"
                disabled={cableBusy}
                required
              />
            </div>
            <div className="grid grid-cols-1 gap-1">
              <button
                type="submit"
                className="w-full rounded border border-cyan-300/40 bg-cyan-900/35 px-2 py-1 text-[10px] font-medium text-cyan-100 hover:bg-cyan-800/35 disabled:opacity-50"
                disabled={cableBusy}
              >
                {cableBusy ? 'Сохранение…' : 'Добавить кабель'}
              </button>
              <button
                type="button"
                onClick={(e) => handleSaveCableLine(e, transitId, { keepOpen: false })}
                className="w-full rounded border border-white/20 bg-white/5 px-2 py-1 text-[10px] font-medium text-zinc-200 hover:bg-white/10 disabled:opacity-50"
                disabled={cableBusy}
              >
                {cableBusy ? 'Сохранение…' : 'Сохранить и закрыть'}
              </button>
            </div>
          </form>
        )}

        {!!lines.length && (
          <div className="space-y-1">
            <p className="text-[9px] text-zinc-300 uppercase tracking-wide">Линии транзита</p>
            <div className="space-y-1 max-h-44 overflow-auto pr-0.5">
              {lines.map((line) => {
                const fromLabelRow = describeSlot(line.from_location_system_id);
                const toLabelRow = describeSlot(line.to_location_system_id);
                const modeLabel = line.transit_id ? 'Через транзит' : 'Прямая';
                return (
                  <div
                    key={`line-card-${line.id}`}
                    className="rounded border border-white/10 bg-black/30 px-1.5 py-1 space-y-0.5"
                  >
                    <div className="flex items-start justify-between gap-1">
                      <p className="text-[9px] text-zinc-100 truncate">{line.name || 'Без названия'}</p>
                      <span className="text-[8px] text-zinc-400 whitespace-nowrap">{formatQty(line.length_m)} м</span>
                    </div>
                    <p className="text-[8px] text-zinc-400 truncate">{modeLabel}</p>
                    <p className="text-[8px] text-zinc-500 truncate">От: {fromLabelRow}</p>
                    <p className="text-[8px] text-zinc-500 truncate">До: {toLabelRow}</p>
                    <div className="grid grid-cols-2 gap-1 pt-0.5">
                      <button
                        type="button"
                        onClick={() => openCableEditModal(line)}
                        className="px-1 py-0.5 rounded border border-white/15 text-[8px] text-zinc-200 hover:bg-white/10"
                        disabled={cableBusy}
                      >
                        Ред.
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCloneCableLine(line, transitId)}
                        className="px-1 py-0.5 rounded border border-cyan-300/30 text-[8px] text-cyan-100 hover:bg-cyan-900/30"
                        disabled={cableBusy}
                      >
                        Копия
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  const activeSlotId = activeSlot?.id || null;
  const activeSlotEntries = activeSlotId ? getSlotEntries(activeSlotId) : [];
  const slotLocked = !activeSlot;
  const canAddEntry = !slotBusy && !slotLocked && String(entryQuery || '').trim().length > 0;
  const cableEditFromPlacement = cableEditDraft?.fromSlotId
    ? (slotPlacementById.get(Number(cableEditDraft.fromSlotId)) || null)
    : null;
  const cableEditAnchorTransit = cableEditFromPlacement?.location
    ? {
      object_id: cableEditFromPlacement.location.object_id,
      entrance_id: cableEditFromPlacement.location.entrance_id,
    }
    : null;
  const cableEditTransitOptions = cableEditAnchorTransit?.entrance_id
    ? (transitsByEntrance.get(cableEditAnchorTransit.entrance_id) || [])
    : sortedTransits;
  const cableEditTransit = cableEditDraft?.routeMode !== 'direct' && cableEditDraft?.transitId
    ? (transitById.get(Number(cableEditDraft.transitId)) || null)
    : null;
  const cableEditSelectableSlots = (cableEditTransit || cableEditDraft?.routeMode === 'direct')
    ? getSelectableTransitSlots(
      cableEditTransit ? {
        ...cableEditTransit,
        id: Number(cableEditDraft?.transitId),
      } : null,
      {
        systemId: cableEditDraft?.systemId ?? '',
        categoryId: cableEditDraft?.categoryId ?? '',
        routeMode: cableEditDraft?.routeMode ?? 'transit',
        anchorTransit: cableEditAnchorTransit,
      },
    )
    : [];
  const cableEditSlotOptions = useMemo(() => {
    const map = new Map();
    cableEditSelectableSlots.forEach((slot) => {
      map.set(String(slot.id), slot);
    });
    [cableEditDraft?.fromSlotId, cableEditDraft?.toSlotId].forEach((slotIdValue) => {
      const slotId = Number.parseInt(slotIdValue, 10);
      if (!slotId) return;
      const key = String(slotId);
      if (map.has(key)) return;
      const slot = slotById.get(slotId);
      if (!slot) return;
      map.set(key, slot);
    });
    return [...map.values()];
  }, [cableEditSelectableSlots, cableEditDraft?.fromSlotId, cableEditDraft?.toSlotId, slotById]);
  const cableEditSelectableSlotIdSet = useMemo(
    () => new Set(cableEditSlotOptions.map((slot) => String(slot.id))),
    [cableEditSlotOptions],
  );
  const cableEditSelectedSlotIds = useMemo(() => {
    const values = [cableEditDraft?.fromSlotId, cableEditDraft?.toSlotId]
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isInteger(value) && value > 0);
    return new Set(values.map(String));
  }, [cableEditDraft?.fromSlotId, cableEditDraft?.toSlotId]);
  const handlePickCableEditSlot = useCallback((slot) => {
    if (!cableEditDraft) return;
    if (!cableEditPickTarget) {
      setError('Нажмите «Выбрать От» или «Выбрать До».');
      return;
    }
    if (!cableEditSelectableSlotIdSet.has(String(slot.id))) {
      setError(cableEditDraft.routeMode === 'transit'
        ? 'Для маршрута через транзит выберите блок в том же подъезде и по текущим фильтрам.'
        : 'Для прямого маршрута блок недоступен по текущим фильтрам.');
      return;
    }
    const pickedId = Number(slot.id);
    setCableEditDraft((prev) => {
      if (!prev) return prev;
      if (cableEditPickTarget === 'from') {
        return {
          ...prev,
          fromSlotId: pickedId,
          toSlotId: Number(prev.toSlotId) === pickedId ? null : prev.toSlotId,
        };
      }
      return {
        ...prev,
        toSlotId: pickedId,
        fromSlotId: Number(prev.fromSlotId) === pickedId ? null : prev.fromSlotId,
      };
    });
    revealCableSlotFloor(slot.id);
    setCableEditPickTarget('');
    setCableEditModalOpen(true);
    setNotice(`Точка «${cableEditPickTarget === 'from' ? 'От' : 'До'}» выбрана. Проверьте и сохраните изменения.`);
    setError('');
  }, [
    cableEditDraft,
    cableEditPickTarget,
    cableEditSelectableSlotIdSet,
    revealCableSlotFloor,
  ]);
  const allFloorIds = useMemo(
    () => sortedFloors.map((floor) => String(floor.id)),
    [sortedFloors],
  );
  const areAllFloorsCollapsed = useMemo(() => {
    if (!allFloorIds.length) return false;
    const collapsedSet = new Set(collapsedFloors.map((id) => String(id)));
    return allFloorIds.every((id) => collapsedSet.has(id));
  }, [allFloorIds, collapsedFloors]);
  const handleToggleAllFloors = useCallback(() => {
    if (!allFloorIds.length) return;
    setCollapsedFloors((prev) => {
      const prevSet = new Set(prev.map((id) => String(id)));
      const allCollapsed = allFloorIds.every((id) => prevSet.has(id));
      if (allCollapsed) return [];
      return [...allFloorIds];
    });
  }, [allFloorIds]);

  if (loading) return <p className="text-zinc-500 text-sm">Загрузка настроек объектов…</p>;

  return (
    <div className="space-y-3.5">
      <div className="rounded-2xl border border-white/10 bg-zinc-900/65 p-3 shadow-[0_8px_24px_rgba(0,0,0,0.24)]">
        <p className="text-zinc-300 text-xs leading-relaxed">
          План монтажа по объектам: добавляйте системы в квартиры и помещения, затем в каждой системе фиксируйте нужные позиции и количество. Можно создавать одинаковые блоки, копировать отдельный блок, а также все блоки помещения или этажа.
        </p>
      </div>
      {error && <p className="text-rose-400 text-sm">{error}</p>}
      {notice && <p className="text-emerald-300 text-sm">{notice}</p>}
      {slotCablePlanPick?.fromSlotId && (
        <div className="rounded-lg border border-cyan-300/35 bg-cyan-950/25 px-3 py-2 flex items-center justify-between gap-2">
          <p className="text-cyan-100 text-xs">
            Выбор на плане активен: кликните по блоку, который нужно соединить с текущим.
          </p>
          <button
            type="button"
            className="px-2 py-0.5 rounded border border-white/20 text-[10px] text-zinc-200 hover:bg-white/10"
            onClick={handleCancelSlotCablePlanPick}
          >
            Отменить
          </button>
        </div>
      )}

      <div className="rounded-xl border border-white/10 bg-zinc-900/65 p-3 space-y-2 shadow-[0_8px_24px_rgba(0,0,0,0.2)]">
        <p className="text-zinc-200 text-xs font-semibold tracking-wide uppercase">Фильтры блоков</p>
        <div className="flex flex-wrap gap-1.5">
          <MultiSelectFilter
            label="Система"
            options={systemFilterOptions}
            selectedValues={selectedSystemIds}
            onToggle={(value) => setSelectedSystemIds((prev) => toggleSelection(prev, value))}
          />
          <MultiSelectFilter
            label="Категория"
            options={categoryFilterOptions}
            selectedValues={selectedCategoryIds}
            onToggle={(value) => setSelectedCategoryIds((prev) => toggleSelection(prev, value))}
          />
          <MultiSelectFilter
            label="Квартиры"
            options={apartmentFilterOptions}
            selectedValues={selectedApartmentScopes}
            onToggle={(value) => setSelectedApartmentScopes((prev) => toggleSelection(prev, value))}
          />
          <MultiSelectFilter
            label="Помещения"
            options={roomFilterOptions}
            selectedValues={selectedRoomNames}
            onToggle={(value) => setSelectedRoomNames((prev) => toggleSelection(prev, value))}
          />
          {allFloorIds.length > 0 && (
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={handleToggleAllFloors}
            >
              {areAllFloorsCollapsed ? 'Развернуть все этажи' : 'Свернуть все этажи'}
            </button>
          )}
          {hasSlotFilters && (
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => {
                setSelectedSystemIds([]);
                setSelectedCategoryIds([]);
                setSelectedApartmentScopes([]);
                setSelectedRoomNames([]);
              }}
            >
              Сбросить фильтры
            </button>
          )}
        </div>
      </div>

      <div className="space-y-3">
        {sortedObjects.map((obj) => {
          const objectEntrances = entrancesByObject.get(obj.id) || [];
          const objectSummary = objectSummaryById.get(obj.id) || { entries: [], totalQty: 0 };
          const summaryBySystem = objectSummary.entries.reduce((acc, row) => {
            const systemName = row.systems?.[0]?.name || 'Без системы';
            const list = acc.get(systemName) || [];
            list.push(row);
            acc.set(systemName, list);
            return acc;
          }, new Map());
          const summarySystemGroups = [...summaryBySystem.entries()]
            .map(([systemName, rows]) => ([
              systemName,
              [...rows].sort((a, b) => naturalCompare(a.name, b.name)),
            ]))
            .sort((a, b) => naturalCompare(a[0], b[0]));
          return (
            <article key={obj.id} className="rounded-2xl border border-sky-500/20 bg-gradient-to-br from-slate-900/95 via-sky-950/30 to-black/70 p-3 space-y-2.5 shadow-[0_10px_28px_rgba(0,0,0,0.26)]">
              <div className="space-y-1">
                <h3 className="text-white font-semibold text-sm tracking-wide">{obj.name}</h3>
                <p className="text-zinc-400 text-[11px]">
                  Позиции: {objectSummary.entries.length} / {formatQty(objectSummary.totalQty)}
                </p>
              </div>

              {!!objectSummary.entries.length && (
                <div className="rounded-lg border border-white/10 bg-black/25 p-2">
                  <p className="text-zinc-300 text-[11px] mb-1 font-medium">Позиции для завершения</p>
                  <div className="space-y-2 max-h-48 overflow-auto pr-1">
                    {summarySystemGroups.map(([systemName, rows]) => (
                      <div key={systemName} className="rounded border border-white/10 bg-white/[0.02] p-1.5 space-y-1">
                        <p className="text-zinc-300 text-[10px] font-semibold tracking-wide">{systemName}</p>
                        {rows.map((row) => (
                          <div key={row.key} className="text-[10px] text-zinc-200 flex items-center justify-between gap-2">
                            <span className="truncate">
                              {row.name} — <span className="text-zinc-400">{formatQty(row.quantity)}{row.unit ? ` ${row.unit}` : ''}</span>
                            </span>
                            {row.source === 'slot' && row.slotIds.length > 0 && (
                              <button
                                type="button"
                                onClick={() => openSummaryEditModal(obj.name, row)}
                                className="px-1.5 py-0.5 rounded border border-white/15 text-[10px] text-zinc-200 hover:bg-white/10 shrink-0"
                              >
                                Изменить
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {objectEntrances.length ? (
                <div className="space-y-2.5">
                  {objectEntrances.map((entrance) => {
                    const entranceFloors = floorsByEntrance.get(entrance.id) || [];
                    const entranceTransits = transitsByEntrance.get(entrance.id) || [];
                    const entranceStairwells = stairwellsByEntrance.get(entrance.id) || [];
                    const entranceLinearLocations = [
                      ...entranceTransits.map((row) => ({ ...row, _kind: 'transit' })),
                      ...entranceStairwells.map((row) => ({ ...row, _kind: 'stairwell' })),
                    ];
                    const entranceLinearLayoutRows = entranceLinearLocations
                      .map((row) => {
                        const fromRank = floorSortRank(row.from_floor_sort_order);
                        const toRank = floorSortRank(row.to_floor_sort_order);
                        const minRank = Math.min(fromRank, toRank);
                        const maxRank = Math.max(fromRank, toRank);
                        const spanFloors = entranceFloors.filter((floorRow) => {
                          const rank = floorSortRank(floorRow?.sort_order);
                          return rank >= minRank && rank <= maxRank;
                        });
                        const spanRows = getVisibleRangeSpanRows(entranceFloors, minRank, maxRank);
                        if (!spanRows || !spanFloors.length) return null;
                        return {
                          ...row,
                          ...spanRows,
                          spanFloors,
                        };
                      })
                      .filter(Boolean)
                      .filter((row) => {
                        if (!hasSlotFilters || activeCableTransitId) return true;
                        if (row._kind === 'transit') {
                          const hasTransitLines = (transitCableLinesByTransit.get(row.id) || []).some(lineMatchesActiveFilters);
                          const hasDirectEntranceLines = (data.transitCableLines || []).some((line) => {
                            if (line.transit_id != null) return false;
                            if (!lineMatchesActiveFilters(line)) return false;
                            const fromPlacement = slotPlacementById.get(Number(line.from_location_system_id));
                            if (!fromPlacement?.location) return false;
                            return Number(fromPlacement.location.entrance_id || 0) === Number(row.entrance_id || 0);
                          });
                          if (hasTransitLines || hasDirectEntranceLines) return true;
                        }
                        const slots = slotsByLocation.get(`${row._kind}:${row.id}`) || [];
                        return slots.some((slot) => slotMatchesFilters(slot));
                      });
                    const entranceOverlay = entranceCableOverlay[entrance.id] || null;
                    const linearColumnsTemplate = entranceLinearLayoutRows.map((row) => {
                      if (row._kind === 'transit') {
                        const lineCount = transitLaneDemandById.get(Number(row.id)) || 0;
                        const extra = Math.min(Math.max(lineCount - 1, 0), 40) * 0.07;
                        const minRem = (3.25 + extra).toFixed(2);
                        const maxRem = (3.95 + (extra * 1.05)).toFixed(2);
                        return `minmax(${minRem}rem, ${maxRem}rem)`;
                      }
                      return 'minmax(3.25rem, 3.85rem)';
                    }).join(' ');
                    return (
                      <section key={entrance.id} className="rounded-xl border border-emerald-500/20 bg-emerald-950/15 p-2.5 space-y-2 shadow-[0_8px_20px_rgba(0,0,0,0.22)]">
                        <p className="text-emerald-200 text-xs font-semibold tracking-wide">Подъезд {entrance.name}</p>
                        {entranceFloors.length ? (
                          <div className="min-w-0 overflow-x-auto">
                            <div className="relative w-max min-w-full">
                              <div
                                ref={(node) => setEntranceGridRef(entrance.id, node)}
                                className="grid gap-1.5 min-w-0 relative z-10"
                                style={{
                                  gridTemplateColumns: `${linearColumnsTemplate ? `${linearColumnsTemplate} ` : ''}minmax(18rem, 1fr)`,
                                  alignItems: 'stretch',
                                }}
                              >
                                {entranceLinearLayoutRows.map((locationRow, laneIndex) => {
                                  const isLinearColumn = locationRow._kind === 'transit' || locationRow._kind === 'stairwell';
                                  const prefix = locationRow._kind === 'transit' ? 'Транзит' : 'ЛК';
                                  const locationTitle = `${prefix} ${locationRow.name}`;
                                  const locationRange = `Этаж ${locationRow.from_floor_name}–${locationRow.to_floor_name}`;
                                  const squares = renderSystemSquares(locationRow._kind, locationRow.id, locationTitle);
                                  const hasTransitCableLines = locationRow._kind === 'transit' && (() => {
                                    const hasTransitLines = (transitCableLinesByTransit.get(locationRow.id) || []).some(lineMatchesActiveFilters);
                                    const hasDirectEntranceLines = (data.transitCableLines || []).some((line) => {
                                      if (line.transit_id != null) return false;
                                      if (!lineMatchesActiveFilters(line)) return false;
                                      const fromPlacement = slotPlacementById.get(Number(line.from_location_system_id));
                                      if (!fromPlacement?.location) return false;
                                      return Number(fromPlacement.location.entrance_id || 0) === Number(locationRow.entrance_id || 0);
                                    });
                                    return hasTransitLines || hasDirectEntranceLines;
                                  })();
                                  if (!squares && hasSlotFilters && !activeCableTransitId && !hasTransitCableLines) return null;
                                  const locationHasBlocks = hasLocationBlocks(locationRow._kind, locationRow.id);
                                  return (
                                    <div
                                      key={`${locationRow._kind}:${locationRow.id}`}
                                      data-transit-id={locationRow._kind === 'transit' ? locationRow.id : undefined}
                                      className={`relative rounded-lg border shadow-[0_6px_14px_rgba(0,0,0,0.2)] h-full min-h-0 overflow-hidden ${
                                        locationHasBlocks
                                          ? 'border-cyan-400/25 bg-gradient-to-b from-cyan-950/25 to-zinc-950/60'
                                          : 'border-rose-500/45 bg-rose-950/15'
                                      }`}
                                      style={{
                                        gridColumn: laneIndex + 1,
                                        gridRow: `${locationRow.startRow} / ${locationRow.endRow}`,
                                      }}
                                    >
                                      <div className="absolute inset-0 p-1 space-y-1 overflow-auto min-h-0 pr-0.5">
                                        <p className="text-zinc-100 text-[9px] font-semibold leading-tight break-words uppercase tracking-wide">{locationTitle}</p>
                                        <p className="text-zinc-400 text-[8px] leading-tight">{locationRange}</p>
                                        {renderLinearLocationSegments(locationRow, locationTitle, entrance.id)}
                                        {!isLinearColumn ? renderLocationActions(locationRow._kind, locationRow.id, locationTitle) : null}
                                        {locationRow._kind === 'transit' ? renderTransitCablePanel(locationRow) : null}
                                        {!isLinearColumn ? squares : null}
                                      </div>
                                    </div>
                                  );
                                })}

                                {entranceFloors.map((floor, floorIndex) => {
                                  const floorApartmentsRaw = apartmentsByFloor.get(floor.id) || [];
                                  const floorRoomsBucket = floorApartmentsRaw.find((x) => x.name === FLOOR_ROOMS_BUCKET_NAME);
                                  const floorApartments = floorApartmentsRaw.filter((x) => x.name !== FLOOR_ROOMS_BUCKET_NAME);
                                  const floorRooms = floorRoomsBucket ? (roomsByApartment.get(floorRoomsBucket.id) || []) : [];
                                  const floorApartmentRoomsCount = floorApartments.reduce(
                                    (acc, apartment) => acc + (roomsByApartment.get(apartment.id) || []).length,
                                    0,
                                  );
                                  const floorRoomsCount = floorRooms.length + floorApartmentRoomsCount;
                                  const collapsed = collapsedFloorSet.has(floor.id);
                                  const floorHasBlocks = (
                                    floorRooms.some((room) => hasLocationBlocks('room', room.id))
                                    || floorApartments.some((apartment) => (
                                      hasLocationBlocks('apartment', apartment.id)
                                      || (roomsByApartment.get(apartment.id) || []).some((room) => hasLocationBlocks('room', room.id))
                                    ))
                                  );
                                  return (
                                    <div
                                      key={floor.id}
                                      data-floor-id={floor.id}
                                      style={{
                                        gridColumn: entranceLinearLayoutRows.length + 1,
                                        gridRow: floorIndex + 1,
                                      }}
                                      className="min-w-0"
                                    >
                                      <div
                                        className={`rounded-lg border p-2.5 space-y-2 ${
                                          floorHasBlocks
                                            ? 'border-white/10 bg-zinc-900/75'
                                            : 'border-rose-500/50 bg-rose-950/20'
                                        }`}
                                      >
                                        <div className="flex flex-wrap items-center gap-1.5">
                                        <button
                                          type="button"
                                          onClick={() => toggleFloor(floor.id)}
                                          className="text-zinc-100 text-xs font-semibold hover:text-white tracking-wide"
                                        >
                                          Этаж {floor.name}
                                        </button>
                                        <span className="text-[10px] text-zinc-400 rounded-full border border-white/10 px-1.5 py-0.5">
                                          Квартир: {floorApartments.length} · Помещений: {floorRoomsCount}
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() => handleCopyFloorBlocks(floor)}
                                          className="px-2 py-0.5 rounded border border-white/15 text-[10px] text-zinc-200 hover:bg-white/10"
                                          disabled={!!pasteBusyKey || slotBusy || Boolean((activeCableTransitId && cablePickTarget) || cableEditPickTarget)}
                                        >
                                          Копировать этаж
                                        </button>
                                        {copiedFloorTemplate && (
                                          <button
                                            type="button"
                                            onClick={() => handlePasteFloorBlocks(floor)}
                                            className="px-2 py-0.5 rounded border border-sky-400/40 text-[10px] text-sky-200 hover:bg-sky-900/30"
                                            disabled={!!pasteBusyKey || slotBusy || Boolean((activeCableTransitId && cablePickTarget) || cableEditPickTarget)}
                                          >
                                            {pasteBusyKey === `floor:${floor.id}` ? 'Вставка…' : 'Вставить этаж'}
                                          </button>
                                        )}
                                        </div>
                                        {!collapsed && (
                                          <div className="space-y-2">
                                          {floorRooms.length ? (
                                            <div className="rounded-md border border-white/10 bg-black/25 px-2 py-1.5 space-y-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                                              <p className="text-zinc-200 text-[10px] font-semibold tracking-wide uppercase">Помещения на этаже</p>
                                              {floorRooms.map((room) => (
                                                (() => {
                                                  const roomSquares = renderSystemSquares('room', room.id, `Пом. ${room.name}`, buildCableSelectionOptions('room') || undefined);
                                                  if (!roomSquares) return null;
                                                  const roomHasBlocks = hasLocationBlocks('room', room.id);
                                                  return (
                                                    <div
                                                      key={room.id}
                                                      className={`rounded border px-2 py-1.5 space-y-1 ${
                                                        roomHasBlocks
                                                          ? 'border-white/10 bg-zinc-950/60'
                                                          : 'border-rose-500/50 bg-rose-950/20'
                                                      }`}
                                                    >
                                                      <p className="text-zinc-200 text-[10px] font-semibold tracking-wide">Пом. {room.name}</p>
                                                      {renderLocationActions('room', room.id, `Пом. ${room.name}`)}
                                                      {roomSquares}
                                                    </div>
                                                  );
                                                })()
                                              ))}
                                            </div>
                                          ) : null}

                                          {floorApartments.length ? (
                                            <div className="rounded-md border border-white/10 bg-black/25 px-2 py-1.5 space-y-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                                              <p className="text-zinc-200 text-[10px] font-semibold tracking-wide uppercase">Квартиры на этаже</p>
                                              {floorApartments.map((apartment) => (
                                                (() => {
                                                  const apartmentSquares = renderSystemSquares('apartment', apartment.id, `Кв. ${apartment.name}`, buildCableSelectionOptions('apartment') || undefined);
                                                  const apartmentRoomCards = (roomsByApartment.get(apartment.id) || []).map((room) => {
                                                    const roomSquares = renderSystemSquares('room', room.id, `Пом. ${room.name}`, buildCableSelectionOptions('room') || undefined);
                                                    if (!roomSquares) return null;
                                                    const roomHasBlocks = hasLocationBlocks('room', room.id);
                                                    return (
                                                      <div
                                                        key={room.id}
                                                        className={`rounded border px-2 py-1 space-y-1 ${
                                                          roomHasBlocks
                                                            ? 'border-white/10 bg-zinc-900/85'
                                                            : 'border-rose-500/50 bg-rose-950/30'
                                                        }`}
                                                      >
                                                        <p className="text-zinc-300 text-[10px] font-semibold">Пом. {room.name}</p>
                                                        {renderLocationActions('room', room.id, `Пом. ${room.name}`)}
                                                        {roomSquares}
                                                      </div>
                                                    );
                                                  }).filter(Boolean);
                                                  if (!apartmentSquares && apartmentRoomCards.length === 0) return null;
                                                  const apartmentHasBlocks = (
                                                    hasLocationBlocks('apartment', apartment.id)
                                                    || (roomsByApartment.get(apartment.id) || []).some((room) => hasLocationBlocks('room', room.id))
                                                  );
                                                  return (
                                                    <div
                                                      key={apartment.id}
                                                      className={`rounded border px-2 py-1.5 space-y-1 ${
                                                        apartmentHasBlocks
                                                          ? 'border-white/10 bg-zinc-950/60'
                                                          : 'border-rose-500/50 bg-rose-950/20'
                                                      }`}
                                                    >
                                                      <p className="text-zinc-200 text-[10px] font-semibold tracking-wide">Кв. {apartment.name}</p>
                                                      {apartmentSquares && (
                                                        <>
                                                          {renderLocationActions('apartment', apartment.id, `Кв. ${apartment.name}`)}
                                                          {apartmentSquares}
                                                        </>
                                                      )}
                                                      {!!apartmentRoomCards.length && (
                                                        <div className="mt-1 space-y-1">
                                                          {apartmentRoomCards}
                                                        </div>
                                                      )}
                                                    </div>
                                                  );
                                                })()
                                              ))}
                                            </div>
                                          ) : (
                                            <p className="text-zinc-500 text-2xs">Квартиры на этаже не добавлены</p>
                                          )}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                              {entranceOverlay?.paths?.length ? (
                                <svg
                                  className="absolute left-0 top-0 z-20"
                                  style={{ pointerEvents: 'none' }}
                                  width={entranceOverlay.width}
                                  height={entranceOverlay.height}
                                  viewBox={`0 0 ${entranceOverlay.width} ${entranceOverlay.height}`}
                                  preserveAspectRatio="none"
                                >
                                  {entranceOverlay.paths.map((pathItem) => (
                                    (() => {
                                      const interactive = Boolean(pathItem.lineId) && !pathItem.preview && !activeCableTransitId;
                                      const isHovered = hoveredCableLine?.pathKey === pathItem.key;
                                      return (
                                        <path
                                          key={pathItem.key}
                                          d={pathItem.d}
                                          fill="none"
                                          stroke={pathItem.color}
                                          strokeWidth={pathItem.preview ? 0.62 : (isHovered ? 0.98 : 0.62)}
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                          strokeDasharray={pathItem.preview ? '4 3' : undefined}
                                          opacity={pathItem.preview ? 0.75 : (isHovered ? 1 : 0.96)}
                                          className={interactive ? 'cursor-pointer' : ''}
                                          pointerEvents={interactive ? 'stroke' : 'none'}
                                          style={isHovered ? { filter: 'drop-shadow(0 0 4px rgba(248,250,252,0.55))' } : undefined}
                                          onMouseEnter={(event) => {
                                            if (!interactive) return;
                                            const svg = event.currentTarget.ownerSVGElement;
                                            if (!svg) return;
                                            const rect = svg.getBoundingClientRect();
                                            setHoveredCableLine({
                                              entranceId: entrance.id,
                                              pathKey: pathItem.key,
                                              x: event.clientX - rect.left,
                                              y: event.clientY - rect.top,
                                              name: pathItem.name || 'Без названия',
                                              lengthM: pathItem.lengthM,
                                              fromLabel: pathItem.fromLabel,
                                              toLabel: pathItem.toLabel,
                                            });
                                          }}
                                          onMouseMove={(event) => {
                                            if (!interactive) return;
                                            const svg = event.currentTarget.ownerSVGElement;
                                            if (!svg) return;
                                            const rect = svg.getBoundingClientRect();
                                            setHoveredCableLine((prev) => {
                                              if (!prev || prev.pathKey !== pathItem.key) return prev;
                                              return {
                                                ...prev,
                                                x: event.clientX - rect.left,
                                                y: event.clientY - rect.top,
                                              };
                                            });
                                          }}
                                          onMouseLeave={() => {
                                            setHoveredCableLine((prev) => (prev?.pathKey === pathItem.key ? null : prev));
                                          }}
                                          onClick={() => {
                                            if (!interactive) return;
                                            const line = transitCableLineById.get(String(pathItem.lineId));
                                            if (!line) return;
                                            openCableEditModal(line);
                                          }}
                                        />
                                      );
                                    })()
                                  ))}
                                  {(entranceOverlay.jumps || []).map((jump) => (
                                    <g key={`jump-${jump.key}`} pointerEvents="none">
                                      {jump.orientation === 'vertical' ? (
                                        <path
                                          d={`M ${jump.x} ${jump.y - 2.45} Q ${jump.x + 2.55} ${jump.y} ${jump.x} ${jump.y + 2.45}`}
                                          fill="none"
                                          stroke={hoveredCableLine?.pathKey === jump.pathKey ? '#FFFFFF' : '#F8FAFC'}
                                          strokeWidth={hoveredCableLine?.pathKey === jump.pathKey ? '0.86' : '0.72'}
                                          strokeLinecap="round"
                                        />
                                      ) : (
                                        <path
                                          d={`M ${jump.x - 2.45} ${jump.y} Q ${jump.x} ${jump.y - 2.55} ${jump.x + 2.45} ${jump.y}`}
                                          fill="none"
                                          stroke={hoveredCableLine?.pathKey === jump.pathKey ? '#FFFFFF' : '#F8FAFC'}
                                          strokeWidth={hoveredCableLine?.pathKey === jump.pathKey ? '0.86' : '0.72'}
                                          strokeLinecap="round"
                                        />
                                      )}
                                    </g>
                                  ))}
                                </svg>
                              ) : null}
                              {hoveredCableLine && hoveredCableLine.entranceId === entrance.id ? (
                                <div
                                  className="absolute z-30 pointer-events-none rounded-md border border-white/20 bg-zinc-950/95 px-2 py-1.5 shadow-[0_8px_20px_rgba(0,0,0,0.45)] max-w-[18rem]"
                                  style={{
                                    left: `${Math.max(8, Math.min((hoveredCableLine.x || 0) + 12, Math.max((entranceOverlay?.width || 0) - 288, 8)))}px`,
                                    top: `${Math.max(8, Math.min((hoveredCableLine.y || 0) + 12, Math.max((entranceOverlay?.height || 0) - 108, 8)))}px`,
                                  }}
                                >
                                  <p className="text-[10px] font-semibold text-white truncate">{hoveredCableLine.name || 'Без названия'}</p>
                                  <p className="text-[9px] text-zinc-300">Длина: {formatQty(hoveredCableLine.lengthM || 0)} м</p>
                                  <p className="text-[8px] text-zinc-400 mt-1 leading-tight">От: {hoveredCableLine.fromLabel || '—'}</p>
                                  <p className="text-[8px] text-zinc-400 leading-tight">До: {hoveredCableLine.toLabel || '—'}</p>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        ) : (
                          <p className="text-zinc-500 text-xs">Этажи еще не добавлены</p>
                        )}
                      </section>
                    );
                  })}
                </div>
              ) : (
                <p className="text-zinc-500 text-sm">Подъезды для объекта еще не добавлены</p>
              )}
            </article>
          );
        })}
      </div>

      {cableEditModalOpen && cableEditDraft && (
        <div
          className={`modal-backdrop z-50 ${cableEditPickTarget ? 'pointer-events-none' : ''}`}
          onClick={() => {
            if (cableEditPickTarget) return;
            closeCableEditModal();
          }}
          role="dialog"
          aria-modal="true"
        >
          <div className="card p-5 max-w-xl w-full pointer-events-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-white text-lg font-medium">Редактирование кабельной линии</h3>
            <form className="space-y-3 mt-4" onSubmit={handleSaveCableEdit}>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="label">Маршрут</label>
                  <select
                    value={cableEditDraft.routeMode || 'transit'}
                    onChange={(e) => {
                      const routeMode = e.target.value === 'direct' ? 'direct' : 'transit';
                      setCableEditDraft((prev) => ({
                        ...prev,
                        routeMode,
                        transitId: routeMode === 'transit'
                          ? (prev.transitId || String(cableEditTransitOptions[0]?.id || ''))
                          : '',
                      }));
                    }}
                    className="input"
                    disabled={cableEditBusy}
                  >
                    <option value="transit">Через транзит</option>
                    <option value="direct">Прямая линия</option>
                  </select>
                </div>
                {cableEditDraft.routeMode !== 'direct' && (
                  <div>
                    <label className="label">Транзит</label>
                    <select
                      value={cableEditDraft.transitId || ''}
                      onChange={(e) => {
                        const transitId = e.target.value;
                        setCableEditDraft((prev) => ({
                          ...prev,
                          transitId,
                        }));
                      }}
                      className="input"
                      disabled={cableEditBusy}
                      required
                    >
                      <option value="">— Выберите транзит —</option>
                      {cableEditTransitOptions.map((transit) => (
                        <option key={`edit-transit-${transit.id}`} value={transit.id}>{transit.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
              <div>
                <label className="label">Система</label>
                <select
                  value={cableEditDraft.systemId}
                  onChange={(e) => {
                    const systemId = e.target.value;
                    setCableEditDraft((prev) => ({
                      ...prev,
                      systemId,
                    }));
                  }}
                  className="input"
                  disabled={cableEditBusy}
                >
                  <option value="">Без системы</option>
                  {data.systems.map((system) => (
                    <option key={system.id} value={system.id}>{system.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Категория</label>
                <select
                  value={cableEditDraft.categoryId}
                  onChange={(e) => {
                    const categoryId = e.target.value;
                    setCableEditDraft((prev) => ({
                      ...prev,
                      categoryId,
                    }));
                  }}
                  className="input"
                  disabled={cableEditBusy}
                >
                  <option value="">Без категории</option>
                  {data.categories.map((category) => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  ))}
                </select>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="label">От</label>
                  <select
                    value={cableEditDraft.fromSlotId || ''}
                    onChange={(e) => setCableEditDraft((prev) => ({ ...prev, fromSlotId: e.target.value }))}
                    className="input"
                    disabled={cableEditBusy}
                    required
                  >
                    <option value="">— Выберите блок —</option>
                    {cableEditSlotOptions.map((slot) => (
                      <option key={`edit-from-${slot.id}`} value={slot.id}>{describeSlot(slot.id)}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => handleStartCableEditPlanPick('from')}
                    className={`mt-1 w-full px-2 py-1 rounded border text-xs ${
                      cableEditPickTarget === 'from'
                        ? 'border-cyan-300/70 text-cyan-100 bg-cyan-900/35'
                        : 'border-white/20 text-zinc-200 hover:bg-white/10'
                    }`}
                    disabled={cableEditBusy}
                  >
                    {cableEditPickTarget === 'from' ? 'Выбор От: активен' : 'Выбрать От на схеме'}
                  </button>
                </div>
                <div>
                  <label className="label">До</label>
                  <select
                    value={cableEditDraft.toSlotId || ''}
                    onChange={(e) => setCableEditDraft((prev) => ({ ...prev, toSlotId: e.target.value }))}
                    className="input"
                    disabled={cableEditBusy}
                    required
                  >
                    <option value="">— Выберите блок —</option>
                    {cableEditSlotOptions.map((slot) => (
                      <option key={`edit-to-${slot.id}`} value={slot.id}>{describeSlot(slot.id)}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => handleStartCableEditPlanPick('to')}
                    className={`mt-1 w-full px-2 py-1 rounded border text-xs ${
                      cableEditPickTarget === 'to'
                        ? 'border-cyan-300/70 text-cyan-100 bg-cyan-900/35'
                        : 'border-white/20 text-zinc-200 hover:bg-white/10'
                    }`}
                    disabled={cableEditBusy}
                  >
                    {cableEditPickTarget === 'to' ? 'Выбор До: активен' : 'Выбрать До на схеме'}
                  </button>
                </div>
              </div>
              {cableEditPickTarget && (
                <p className="text-xs text-cyan-200">
                  Режим выбора на схеме: <b>{cableEditPickTarget === 'from' ? 'От' : 'До'}</b>. Кликните по блоку в структуре объекта.
                </p>
              )}
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="label">Название</label>
                  <input
                    type="text"
                    className="input"
                    value={cableEditDraft.name}
                    onChange={(e) => setCableEditDraft((prev) => ({ ...prev, name: e.target.value }))}
                    disabled={cableEditBusy}
                    required
                  />
                </div>
                <div>
                  <label className="label">Длина, м</label>
                  <input
                    type="number"
                    min="0.001"
                    step="0.001"
                    className="input"
                    value={cableEditDraft.lengthM}
                    onChange={(e) => setCableEditDraft((prev) => ({ ...prev, lengthM: e.target.value }))}
                    disabled={cableEditBusy}
                    required
                  />
                </div>
              </div>
              <div className="flex flex-wrap justify-between gap-2 pt-2">
                <button
                  type="button"
                  className="btn-ghost text-rose-300 text-sm"
                  onClick={handleDeleteCableEdit}
                  disabled={cableEditBusy}
                >
                  Удалить линию
                </button>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn-secondary text-sm"
                    onClick={closeCableEditModal}
                    disabled={cableEditBusy}
                  >
                    Отмена
                  </button>
                  <button type="submit" className="btn-primary text-sm" disabled={cableEditBusy}>
                    {cableEditBusy ? 'Сохранение…' : 'Сохранить'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {summaryEditOpen && (
        <div className="modal-backdrop z-50" onClick={closeSummaryEditModal} role="dialog" aria-modal="true">
          <div className="card p-5 max-w-2xl w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-white text-lg font-medium">Изменить позицию для завершения</h3>
            <p className="text-zinc-400 text-sm mt-1">
              {summaryEditTarget?.objectName
                ? `${summaryEditTarget.objectName} · Найдено блоков: ${summaryEditTarget.slotIds.length}`
                : 'Выберите новые параметры позиции. Изменения применяются к отфильтрованным блокам.'}
            </p>

            <form className="space-y-3 mt-4" onSubmit={handleApplySummaryEdit}>
              <div>
                <label className="label">Название</label>
                <input
                  type="text"
                  className="input"
                  value={summaryEditName}
                  onChange={(e) => setSummaryEditName(e.target.value)}
                  required
                />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="label">Система</label>
                  <select
                    value={summaryEditSystemId}
                    onChange={(e) => setSummaryEditSystemId(e.target.value)}
                    className="input"
                    required
                  >
                    <option value="">— Выберите систему —</option>
                    {data.systems.map((system) => (
                      <option key={system.id} value={system.id}>{system.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Категория</label>
                  <select
                    value={summaryEditCategoryId}
                    onChange={(e) => setSummaryEditCategoryId(e.target.value)}
                    className="input"
                  >
                    <option value="">Без категории</option>
                    {data.categories.map((category) => (
                      <option key={category.id} value={category.id}>{category.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  className="btn-secondary text-sm"
                  onClick={closeSummaryEditModal}
                  disabled={summaryEditBusy}
                >
                  Отмена
                </button>
                <button type="submit" className="btn-primary text-sm" disabled={summaryEditBusy}>
                  {summaryEditBusy ? 'Применение…' : 'Применить'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {slotModalOpen && (
        <div className="modal-backdrop z-50" onClick={closeSlotModal} role="dialog" aria-modal="true">
          <div className="card p-5 max-w-3xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="text-white font-medium text-lg">
                  {activeSlot ? `Настройка системы: ${activeSlot.system_name}` : 'Добавить систему'}
                </h3>
                <p className="text-zinc-400 text-sm">
                  {slotDraft.title || getLocationKindTitle(activeSlot?.location_kind)}
                </p>
              </div>
              {activeSlot && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={openSlotCableModal}
                    className="btn-secondary text-sm"
                    disabled={slotBusy}
                  >
                    Соединить
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyActiveSlot}
                    className="btn-secondary text-sm"
                    disabled={slotBusy}
                  >
                    Копировать блок
                  </button>
                  <button type="button" onClick={handleDeleteSlot} className="btn-ghost text-rose-300 text-sm" disabled={slotBusy}>
                    Удалить блок
                  </button>
                </div>
              )}
            </div>

            <div className="space-y-4">
              <form onSubmit={handleSaveSlotMeta} className="grid gap-3 md:grid-cols-[1fr_1fr_auto] rounded-xl border border-white/10 p-3">
                <div>
                  <label className="label">Система</label>
                  <select
                    value={slotSystemId}
                    onChange={(e) => setSlotSystemId(e.target.value)}
                    className="input"
                    required
                  >
                    <option value="">— Выберите систему —</option>
                    {data.systems.map((system) => (
                      <option key={system.id} value={system.id}>{system.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Категория</label>
                  <select
                    value={slotCategoryId}
                    onChange={(e) => setSlotCategoryId(e.target.value)}
                    className="input"
                  >
                    <option value="">Без категории</option>
                    {data.categories.map((category) => (
                      <option key={category.id} value={category.id}>{category.name}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end">
                  <button type="submit" className="btn-primary text-sm w-full" disabled={slotBusy}>
                    {slotBusy ? 'Сохранение…' : (activeSlot ? 'Сохранить' : 'Создать')}
                  </button>
                </div>
              </form>

              {!activeSlot && (
                <p className="text-zinc-400 text-sm">
                  Сначала сохраните систему и категорию, затем добавляйте позиции.
                </p>
              )}

              <div className="space-y-3 rounded-xl border border-white/10 p-3">
                <p className="text-zinc-200 text-sm font-medium">Добавить позицию</p>
                <p className="text-zinc-400 text-xs">
                  Одна строка: введите название позиции и количество. Если выбрать подсказку со склада, позиция привяжется к материалу.
                </p>
                <form onSubmit={handleAddEntry} className="grid gap-3 md:grid-cols-[1fr_120px_auto]">
                  <input
                    type="text"
                    className="input"
                    placeholder="Введите материал, оборудование или работу…"
                    value={entryQuery}
                    disabled={slotLocked}
                    onChange={(e) => {
                      setEntryQuery(e.target.value);
                      setSelectedMaterial(null);
                    }}
                    required
                  />
                  <input
                    type="number"
                    min="0.0001"
                    step="0.0001"
                    value={entryQuantity}
                    disabled={slotLocked}
                    onChange={(e) => setEntryQuantity(e.target.value)}
                    className="input"
                    placeholder="Кол-во"
                    required
                  />
                  <button type="submit" className="btn-primary text-sm" disabled={!canAddEntry}>
                    Добавить
                  </button>
                </form>

                {stockSuggestionLoading && <p className="text-zinc-500 text-xs">Поиск материалов…</p>}

                {!stockSuggestionLoading && mergedSuggestions.length > 0 && (
                  <div className="max-h-52 overflow-auto rounded-lg border border-white/10 bg-zinc-950/95">
                    {mergedSuggestions.map((row) => (
                      <button
                        key={row.key}
                        type="button"
                        onClick={() => {
                          if (row.kind === 'stock') {
                            setSelectedMaterial(row.material);
                          } else {
                            setSelectedMaterial(null);
                          }
                          setEntryQuery(row.name);
                          setStockSuggestions([]);
                        }}
                        className="w-full text-left px-3 py-2 border-b border-white/5 hover:bg-white/10"
                      >
                        <p className="text-sm text-white">{row.name}</p>
                        {row.kind === 'stock' ? (
                          <p className="text-2xs text-zinc-400">Склад: остаток {row.quantity ?? 0} {row.unit || ''}</p>
                        ) : (
                          <p className="text-2xs text-zinc-400">Ранее вводили вручную · {row.usage || 0} раз</p>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {selectedMaterial && (
                  <p className="text-zinc-400 text-xs">
                    Выбрано со склада: {selectedMaterial.name} ({selectedMaterial.unit || 'ед.'})
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <p className="text-zinc-200 text-sm font-medium">Позиции в блоке</p>
                {activeSlotEntries.length ? (
                  <div className="table-wrap">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-white/10 text-zinc-300">
                          <th className="p-2 font-medium">Позиция</th>
                          <th className="p-2 font-medium w-36">Количество</th>
                          <th className="p-2 w-24" />
                        </tr>
                      </thead>
                      <tbody>
                        {activeSlotEntries.map((entry) => (
                          <tr key={entry.key} className="border-b border-white/5">
                            <td className="p-2 text-white">
                              <p>{entry.name}</p>
                              <p className="text-2xs text-zinc-500">
                                {entry.source === 'material' ? 'Источник: склад' : 'Источник: вручную'}
                              </p>
                            </td>
                            <td className="p-2 text-zinc-300">
                              {formatQty(entry.quantity)}{entry.unit ? ` ${entry.unit}` : ''}
                            </td>
                            <td className="p-2">
                              <button
                                type="button"
                                onClick={() => handleDeleteEntry(entry)}
                                className="text-rose-400 hover:text-rose-300 text-xs font-medium"
                              >
                                Удал.
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-zinc-500 text-sm">Позиции пока не добавлены.</p>
                )}
              </div>
            </div>

            <div className="flex justify-end mt-5">
              <button type="button" onClick={closeSlotModal} className="btn-secondary text-sm">Закрыть</button>
            </div>
          </div>
        </div>
      )}

      {slotCableModalOpen && slotCableDraft && (
        <div className="modal-backdrop z-[60]" onClick={closeSlotCableModal} role="dialog" aria-modal="true">
          <div className="card p-5 max-w-2xl w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-white text-lg font-medium">Соединить блок кабелем</h3>
            <p className="text-zinc-400 text-sm mt-1">
              От: {activeSlot ? describeSlot(activeSlot.id) : '—'}
            </p>
            <form className="space-y-3 mt-4" onSubmit={handleSaveSlotCableConnection}>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="label">Маршрут</label>
                  <select
                    value={slotCableDraft.routeMode || 'direct'}
                    onChange={(e) => {
                      const routeMode = e.target.value === 'transit' ? 'transit' : 'direct';
                      setSlotCableDraft((prev) => ({
                        ...prev,
                        routeMode,
                        transitId: routeMode === 'transit'
                          ? (prev.transitId || String(slotCableTransitOptions[0]?.id || ''))
                          : '',
                      }));
                    }}
                    className="input"
                    disabled={slotCableBusy}
                  >
                    <option value="direct">Напрямую</option>
                    <option value="transit">Через транзит</option>
                  </select>
                </div>
                {slotCableDraft.routeMode === 'transit' && (
                  <div>
                    <label className="label">Транзит</label>
                    <select
                      value={slotCableDraft.transitId || ''}
                      onChange={(e) => setSlotCableDraft((prev) => ({ ...prev, transitId: e.target.value }))}
                      className="input"
                      disabled={slotCableBusy}
                      required
                    >
                      <option value="">— Выберите транзит —</option>
                      {slotCableTransitOptions.map((transit) => (
                        <option key={`slot-cable-transit-${transit.id}`} value={transit.id}>{transit.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div>
                <label className="label">Блок «До»</label>
                <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                  <select
                    value={slotCableDraft.toSlotId || ''}
                    onChange={(e) => setSlotCableDraft((prev) => ({ ...prev, toSlotId: e.target.value }))}
                    className="input"
                    disabled={slotCableBusy}
                    required
                  >
                    <option value="">— Выберите второй блок —</option>
                    {slotCableSelectableSlots.map((slot) => (
                      <option key={`slot-cable-target-${slot.id}`} value={slot.id}>
                        {describeSlot(slot.id)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn-secondary text-sm whitespace-nowrap"
                    onClick={handleSlotCablePickOnPlanStart}
                    disabled={slotCableBusy}
                  >
                    Выбрать на плане
                  </button>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="label">Название кабеля</label>
                  <input
                    type="text"
                    value={slotCableDraft.name}
                    onChange={(e) => setSlotCableDraft((prev) => ({ ...prev, name: e.target.value }))}
                    className="input"
                    required
                    disabled={slotCableBusy}
                  />
                </div>
                <div>
                  <label className="label">Длина, м</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={slotCableDraft.lengthM}
                    onChange={(e) => setSlotCableDraft((prev) => ({ ...prev, lengthM: e.target.value }))}
                    className="input"
                    required
                    disabled={slotCableBusy}
                  />
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="label">Система (опц.)</label>
                  <select
                    value={slotCableDraft.systemId}
                    onChange={(e) => setSlotCableDraft((prev) => ({ ...prev, systemId: e.target.value }))}
                    className="input"
                    disabled={slotCableBusy}
                  >
                    <option value="">Без системы</option>
                    {data.systems.map((system) => (
                      <option key={`slot-cable-system-${system.id}`} value={system.id}>{system.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Категория (опц.)</label>
                  <select
                    value={slotCableDraft.categoryId}
                    onChange={(e) => setSlotCableDraft((prev) => ({ ...prev, categoryId: e.target.value }))}
                    className="input"
                    disabled={slotCableBusy}
                  >
                    <option value="">Без категории</option>
                    {data.categories.map((category) => (
                      <option key={`slot-cable-category-${category.id}`} value={category.id}>{category.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button type="button" className="btn-secondary text-sm" onClick={closeSlotCableModal} disabled={slotCableBusy}>
                  Отмена
                </button>
                <button
                  type="button"
                  className="btn-secondary text-sm"
                  onClick={(e) => handleSaveSlotCableConnection(e, { keepOpen: true })}
                  disabled={slotCableBusy}
                >
                  {slotCableBusy ? 'Сохранение…' : 'Сохранить и добавить ещё'}
                </button>
                <button type="submit" className="btn-primary text-sm" disabled={slotCableBusy}>
                  {slotCableBusy ? 'Сохранение…' : 'Сохранить и закрыть'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
