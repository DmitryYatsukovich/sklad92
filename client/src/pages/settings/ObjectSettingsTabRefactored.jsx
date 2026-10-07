import { useCallback, useEffect, useMemo, useState } from 'react';
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
    systems: asObjects(safe.systems),
    categories: asObjects(safe.categories),
    locationSystems: asObjects(safe.location_systems),
    locationSystemMaterials: asObjects(safe.location_system_materials),
    locationSystemEquipment: asObjects(safe.location_system_equipment),
    locationSystemWorks: asObjects(safe.location_system_works),
  };
}

function SystemSquare({
  slot,
  onOpen,
  totals,
  incomplete = false,
  selectionMode = false,
  selected = false,
  onToggleSelect,
}) {
  const entriesPreview = Array.isArray(slot.entryNames) ? slot.entryNames.filter(Boolean) : [];
  const previewText = entriesPreview.length ? entriesPreview.slice(0, 2).join(', ') : 'Позиции не добавлены';
  const tooltip = `${slot.system_name || 'Без системы'}${slot.category_name ? ` • ${slot.category_name}` : ''}${slot.missingFieldsText ? `\nНе заполнено: ${slot.missingFieldsText}` : ''}`;
  return (
    <button
      type="button"
      onClick={() => {
        if (selectionMode) {
          onToggleSelect?.(slot);
          return;
        }
        onOpen(slot);
      }}
      className={`relative w-20 h-20 rounded-md border p-1.5 text-left transition hover:bg-white/10 ${incomplete ? 'border-rose-500/70 bg-rose-950/35 text-rose-100' : 'border-white/15 bg-zinc-900/60 text-zinc-100'} ${selectionMode ? (selected ? 'ring-2 ring-white/70' : 'ring-1 ring-white/25') : ''}`}
      title={tooltip}
    >
      {selectionMode && (
        <span
          className={`absolute top-1 right-1 h-3.5 w-3.5 rounded-full border ${selected ? 'bg-white border-white' : 'bg-transparent border-white/60'}`}
          aria-hidden="true"
        />
      )}
      <div className="flex h-full flex-col justify-between">
        <div className="space-y-0.5">
          <p className="text-[9px] font-semibold leading-tight truncate">{slot.system_name}</p>
          <p className="text-[8px] text-zinc-400 leading-tight truncate">{slot.category_name || 'Без категории'}</p>
        </div>
        <div className="space-y-0.5">
          <p className="text-[8px] text-zinc-200/90 leading-tight overflow-hidden text-ellipsis">{previewText}</p>
          <p className="text-[8px] text-zinc-400 leading-tight">Позиций: {totals?.positions || 0}</p>
        </div>
      </div>
    </button>
  );
}

function MultiSelectFilter({ label, options, selectedValues, onToggle }) {
  const selectedCount = selectedValues.length;
  return (
    <details className="filter-field relative w-full sm:w-56">
      <summary className="input cursor-pointer list-none">
        <span className="inline-flex w-full items-center justify-between gap-2">
          <span className="truncate">{label}</span>
          <span className="text-zinc-500 text-2xs">{selectedCount ? `${selectedCount}` : '▼'}</span>
        </span>
      </summary>
      <div className="absolute z-30 mt-1 w-full max-h-64 overflow-y-auto rounded-lg border border-white/10 bg-surface-900 p-2 shadow-xl">
        {options.length === 0 && (
          <p className="px-1 py-1 text-2xs text-zinc-500">Нет вариантов</p>
        )}
        {options.map((option) => (
          <label
            key={option.value}
            className="flex items-center gap-2 px-1 py-1.5 text-2xs text-zinc-200 hover:bg-white/5 rounded"
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
      }
    }
    return true;
  }, [selectedSystemIds, selectedCategoryIds, selectedApartmentScopes, selectedRoomNames, roomNameById]);

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
      return null;
    };
    const pushEntry = (objectId, slot, name, quantity, unit = '') => {
      const target = ensureObject(objectId);
      if (!target) return;
      const nameKey = normalizeNameKey(name);
      if (!nameKey) return;
      const systemId = slot?.system_id ? String(slot.system_id) : '';
      const systemName = slot?.system_name || 'Без системы';
      const key = `${systemId}::${nameKey}`;
      const prev = target.entriesMap.get(key) || {
        key,
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
      if (slot?.id) prev.slotIdsSet.add(slot.id);
      const categoryKey = slot?.category_id == null ? '' : String(slot.category_id);
      if (!prev.categoriesMap.has(categoryKey)) {
        prev.categoriesMap.set(categoryKey, {
          id: categoryKey,
          name: slot?.category_name || 'Без категории',
        });
      }
      target.entriesMap.set(key, prev);
    };

    data.locationSystemMaterials.forEach((row) => {
      const slot = slotById.get(row.location_system_id);
      if (!slotMatchesFilters(slot)) return;
      const objectId = getSlotObjectId(slot);
      pushEntry(objectId, slot, row.material_name, row.quantity, row.material_unit || '');
    });
    data.locationSystemEquipment.forEach((row) => {
      const slot = slotById.get(row.location_system_id);
      if (!slotMatchesFilters(slot)) return;
      const objectId = getSlotObjectId(slot);
      pushEntry(objectId, slot, row.name, row.quantity);
    });
    data.locationSystemWorks.forEach((row) => {
      const slot = slotById.get(row.location_system_id);
      if (!slotMatchesFilters(slot)) return;
      const objectId = getSlotObjectId(slot);
      pushEntry(objectId, slot, row.name, row.quantity);
    });

    const prepared = new Map();
    summary.forEach((raw, objectId) => {
      const entries = [...raw.entriesMap.values()]
        .map((row) => ({
          key: row.key,
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
    slotById,
    apartmentById,
    roomById,
    slotMatchesFilters,
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
      title: slot.locationTitle || (slot.location_kind === 'room' ? 'Помещение' : 'Квартира'),
    });
    setSlotSystemId(String(slot.system_id || ''));
    setSlotCategoryId(slot.category_id == null ? '' : String(slot.category_id));
    setSlotModalOpen(true);
    resetEntryEditor();
  };

  const closeSlotModal = () => {
    setSlotModalOpen(false);
    setActiveSlot(null);
    setSlotDraft({ locationKind: '', locationId: null, title: '' });
    setSlotSystemId('');
    setSlotCategoryId('');
    resetEntryEditor();
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
    if (!slotModalOpen || !activeSlot?.id || !activeSlot?.system_id) return undefined;
    const query = entryQuery.trim();
    if (!query) {
      setStockSuggestions([]);
      setStockSuggestionLoading(false);
      return undefined;
    }
    const timer = setTimeout(() => {
      setStockSuggestionLoading(true);
      settingsApi.objectSettings.materialSuggestions(
        activeSlot.system_id,
        query,
        activeSlot.category_id || null,
      )
        .then((rows) => setStockSuggestions(Array.isArray(rows) ? rows : []))
        .catch(() => setStockSuggestions([]))
        .finally(() => setStockSuggestionLoading(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [slotModalOpen, activeSlot?.id, activeSlot?.system_id, activeSlot?.category_id, entryQuery]);

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
    return (
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          onClick={() => handleCopyLocationBlocks(locationKind, locationId, title)}
          className="px-2 py-0.5 rounded border border-white/15 text-[10px] text-zinc-200 hover:bg-white/10"
          disabled={!!pasteBusyKey || slotBusy}
        >
          Копировать все блоки
        </button>
        {!selectingMultiple ? (
          <button
            type="button"
            onClick={() => handleStartMultiCopySelection(locationKind, locationId)}
            className="px-2 py-0.5 rounded border border-indigo-400/40 text-[10px] text-indigo-200 hover:bg-indigo-900/30"
            disabled={!!pasteBusyKey || slotBusy || blockCount === 0}
          >
            Копировать несколько
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => handleCopySelectedBlocks(locationKind, locationId, title)}
              className="px-2 py-0.5 rounded border border-indigo-300/60 text-[10px] text-indigo-100 hover:bg-indigo-900/40 disabled:opacity-40"
              disabled={!!pasteBusyKey || slotBusy || selectedCount === 0}
            >
              Копировать ({selectedCount})
            </button>
            <button
              type="button"
              onClick={handleCancelMultiCopySelection}
              className="px-2 py-0.5 rounded border border-white/20 text-[10px] text-zinc-300 hover:bg-white/10"
              disabled={!!pasteBusyKey || slotBusy}
            >
              Отмена выбора
            </button>
          </>
        )}
        {canPaste && (
          <button
            type="button"
            onClick={() => handlePasteLocationBlocks(locationKind, locationId, title)}
            className="px-2 py-0.5 rounded border border-sky-400/40 text-[10px] text-sky-200 hover:bg-sky-900/30"
            disabled={!!pasteBusyKey || slotBusy}
          >
            {locationBusy ? 'Вставка…' : 'Вставить блоки'}
          </button>
        )}
        <button
          type="button"
          onClick={() => handleDeleteLocationBlocks(locationKind, locationId, title)}
          className="px-2 py-0.5 rounded border border-rose-400/40 text-[10px] text-rose-200 hover:bg-rose-900/30 disabled:opacity-40"
          disabled={!!pasteBusyKey || slotBusy || blockCount === 0}
        >
          Удалить блоки
        </button>
      </div>
    );
  };

  const renderSystemSquares = (locationKind, locationId, title) => {
    const key = `${locationKind}:${locationId}`;
    const slots = (slotsByLocation.get(key) || []).filter(slotMatchesFilters);
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
    const selectingMultiple = multiCopyLocationKey === key;
    if (!sortedSlotCards.length && hasSlotFilters) return null;

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
      <div className="space-y-2">
        <div className="space-y-2">
          {groupedRows.map((systemRow) => (
            <div key={systemRow.systemKey} className="rounded-md border border-white/10 bg-black/20 p-1.5 space-y-1.5">
              <p className="text-[10px] text-zinc-200 font-semibold">{systemRow.systemName}</p>
              {systemRow.categories.map((categoryRow) => (
                <div key={`${systemRow.systemName}:${categoryRow.categoryName}`} className="space-y-1">
                  <p className="text-[10px] text-zinc-400">{categoryRow.categoryName}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    {categoryRow.items.map(({ slot, entries, entryNames, completeness }) => {
                      const selectedForMultiCopy = selectingMultiple && multiCopySelectedSlotIds.includes(String(slot.id));
                      return (
                        <SystemSquare
                          key={slot.id}
                          slot={{
                            ...slot,
                            locationTitle: title,
                            entryNames,
                            missingFieldsText: completeness.missing.join(', '),
                          }}
                          onOpen={openSlotModal}
                          totals={{ positions: entries.length }}
                          incomplete={completeness.isIncomplete}
                          selectionMode={selectingMultiple}
                          selected={selectedForMultiCopy}
                          onToggleSelect={handleToggleMultiCopySlot}
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
            className="w-20 h-20 rounded-md border border-dashed border-white/20 bg-black/20 hover:bg-white/10 text-zinc-300 text-[11px]"
          >
            + Система
          </button>
          {copiedSlotTemplate && (
            <button
              type="button"
              onClick={() => handlePasteSlotToLocation(locationKind, locationId, title)}
              className="w-20 h-20 rounded-md border border-dashed border-sky-400/40 bg-sky-900/20 hover:bg-sky-800/30 text-sky-100 text-[11px]"
              disabled={!!pasteBusyKey || slotBusy}
              title={`Вставить блок: ${copiedSlotTemplate.systemName}`}
            >
              {isPastingHere ? 'Вставка…' : 'Вставить'}
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

  const activeSlotId = activeSlot?.id || null;
  const activeSlotEntries = activeSlotId ? getSlotEntries(activeSlotId) : [];
  const slotLocked = !activeSlot;
  const canAddEntry = !slotBusy && !slotLocked && String(entryQuery || '').trim().length > 0;

  if (loading) return <p className="text-zinc-500 text-sm">Загрузка настроек объектов…</p>;

  return (
    <div className="space-y-4">
      <p className="text-zinc-400 text-sm">
        План монтажа по объектам: добавляйте системы в квартиры и помещения, затем в каждой системе фиксируйте нужные позиции и количество. Можно создавать одинаковые блоки, копировать отдельный блок, а также все блоки помещения или этажа.
      </p>
      {error && <p className="text-rose-400 text-sm">{error}</p>}
      {notice && <p className="text-emerald-300 text-sm">{notice}</p>}

      <div className="rounded-xl border border-white/10 bg-black/20 p-3 space-y-2">
        <p className="text-zinc-200 text-sm font-medium">Фильтры блоков</p>
        <div className="flex flex-wrap gap-2">
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
          {hasSlotFilters && (
            <button
              type="button"
              className="btn-ghost text-sm"
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

      <div className="space-y-4">
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
            <article key={obj.id} className="rounded-2xl border border-sky-500/25 bg-sky-950/20 p-4 space-y-3">
              <div className="space-y-1">
                <h3 className="text-white font-semibold">{obj.name}</h3>
                <p className="text-zinc-400 text-xs">
                  Позиции: {objectSummary.entries.length} / {formatQty(objectSummary.totalQty)}
                </p>
              </div>

              {!!objectSummary.entries.length && (
                <div className="rounded-lg border border-white/10 bg-black/20 p-2">
                  <p className="text-zinc-300 text-xs mb-1">Позиции для завершения</p>
                  <div className="space-y-2 max-h-48 overflow-auto pr-1">
                    {summarySystemGroups.map(([systemName, rows]) => (
                      <div key={systemName} className="rounded border border-white/10 bg-white/[0.02] p-1.5 space-y-1">
                        <p className="text-zinc-300 text-2xs font-semibold">{systemName}</p>
                        {rows.map((row) => (
                          <div key={row.key} className="text-[11px] text-zinc-200 flex items-center justify-between gap-2">
                            <span className="truncate">
                              {row.name} — <span className="text-zinc-400">{formatQty(row.quantity)}{row.unit ? ` ${row.unit}` : ''}</span>
                            </span>
                            <button
                              type="button"
                              onClick={() => openSummaryEditModal(obj.name, row)}
                              className="px-1.5 py-0.5 rounded border border-white/15 text-[10px] text-zinc-200 hover:bg-white/10 shrink-0"
                            >
                              Изменить
                            </button>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {objectEntrances.length ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {objectEntrances.map((entrance) => {
                    const entranceFloors = floorsByEntrance.get(entrance.id) || [];
                    return (
                      <section key={entrance.id} className="rounded-xl border border-emerald-500/20 bg-emerald-950/15 p-3 space-y-2">
                        <p className="text-emerald-200 text-sm font-medium">Подъезд {entrance.name}</p>
                        {entranceFloors.length ? (
                          <div className="space-y-2">
                            {entranceFloors.map((floor) => {
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
                                  className={`rounded-lg border p-2.5 space-y-2 ${
                                    floorHasBlocks
                                      ? 'border-white/10 bg-black/20'
                                      : 'border-rose-500/50 bg-rose-950/20'
                                  }`}
                                >
                                  <div className="flex flex-wrap items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => toggleFloor(floor.id)}
                                      className="text-zinc-100 text-xs font-semibold hover:text-white"
                                    >
                                      Этаж {floor.name}
                                    </button>
                                    <span className="text-[10px] text-zinc-400">
                                      Квартир: {floorApartments.length} · Помещений: {floorRoomsCount}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => handleCopyFloorBlocks(floor)}
                                      className="px-2 py-0.5 rounded border border-white/15 text-[10px] text-zinc-200 hover:bg-white/10"
                                      disabled={!!pasteBusyKey || slotBusy}
                                    >
                                      Копировать этаж
                                    </button>
                                    {copiedFloorTemplate && (
                                      <button
                                        type="button"
                                        onClick={() => handlePasteFloorBlocks(floor)}
                                        className="px-2 py-0.5 rounded border border-sky-400/40 text-[10px] text-sky-200 hover:bg-sky-900/30"
                                        disabled={!!pasteBusyKey || slotBusy}
                                      >
                                        {pasteBusyKey === `floor:${floor.id}` ? 'Вставка…' : 'Вставить этаж'}
                                      </button>
                                    )}
                                  </div>
                                  {!collapsed && (
                                    <div className="space-y-2">
                                      {floorRooms.length ? (
                                        <div className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5 space-y-1.5">
                                          <p className="text-zinc-200 text-2xs font-medium">Помещения на этаже</p>
                                          {floorRooms.map((room) => (
                                            (() => {
                                              const roomSquares = renderSystemSquares('room', room.id, `Пом. ${room.name}`);
                                              if (!roomSquares) return null;
                                              const roomHasBlocks = hasLocationBlocks('room', room.id);
                                              return (
                                                <div
                                                  key={room.id}
                                                  className={`rounded border px-2 py-1.5 space-y-1.5 ${
                                                    roomHasBlocks
                                                      ? 'border-white/10 bg-black/20'
                                                      : 'border-rose-500/50 bg-rose-950/20'
                                                  }`}
                                                >
                                                  <p className="text-zinc-200 text-2xs font-medium">Пом. {room.name}</p>
                                                  {renderLocationActions('room', room.id, `Пом. ${room.name}`)}
                                                  {roomSquares}
                                                </div>
                                              );
                                            })()
                                          ))}
                                        </div>
                                      ) : null}

                                      {floorApartments.length ? (
                                        <div className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5 space-y-1.5">
                                          <p className="text-zinc-200 text-2xs font-medium">Квартиры на этаже</p>
                                          {floorApartments.map((apartment) => (
                                            (() => {
                                              const apartmentSquares = renderSystemSquares('apartment', apartment.id, `Кв. ${apartment.name}`);
                                              const apartmentRoomCards = (roomsByApartment.get(apartment.id) || []).map((room) => {
                                                const roomSquares = renderSystemSquares('room', room.id, `Пом. ${room.name}`);
                                                if (!roomSquares) return null;
                                                const roomHasBlocks = hasLocationBlocks('room', room.id);
                                                return (
                                                  <div
                                                    key={room.id}
                                                    className={`rounded border px-2 py-1 space-y-1 ${
                                                      roomHasBlocks
                                                        ? 'border-white/10 bg-zinc-800/70'
                                                        : 'border-rose-500/50 bg-rose-950/30'
                                                    }`}
                                                  >
                                                    <p className="text-zinc-300 text-[10px] font-medium">Пом. {room.name}</p>
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
                                                  className={`rounded border px-2 py-1.5 space-y-1.5 ${
                                                    apartmentHasBlocks
                                                      ? 'border-white/10 bg-black/20'
                                                      : 'border-rose-500/50 bg-rose-950/20'
                                                  }`}
                                                >
                                                  <p className="text-zinc-200 text-2xs font-medium">Кв. {apartment.name}</p>
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
                              );
                            })}
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
                  {slotDraft.title || (activeSlot?.location_kind === 'room' ? 'Помещение' : 'Квартира')}
                </p>
              </div>
              {activeSlot && (
                <div className="flex items-center gap-2">
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
    </div>
  );
}
