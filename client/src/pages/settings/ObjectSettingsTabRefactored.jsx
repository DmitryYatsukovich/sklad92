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

function SystemSquare({ slot, onOpen, totals }) {
  const entriesPreview = Array.isArray(slot.entryNames) ? slot.entryNames.filter(Boolean) : [];
  const previewText = entriesPreview.length ? entriesPreview.slice(0, 2).join(', ') : 'Позиции не добавлены';
  return (
    <button
      type="button"
      onClick={() => onOpen(slot)}
      className="w-20 h-20 rounded-md border border-white/15 p-1.5 text-left transition hover:bg-white/10 bg-zinc-900/60 text-zinc-100"
      title={`${slot.system_name}${slot.category_name ? ` • ${slot.category_name}` : ''}`}
    >
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

  const hasSlotFilters = selectedSystemIds.length > 0 || selectedCategoryIds.length > 0;

  const slotMatchesFilters = useCallback((slot) => {
    if (!slot) return false;
    if (selectedSystemIds.length && !selectedSystemIds.includes(String(slot.system_id || ''))) return false;
    if (selectedCategoryIds.length && !selectedCategoryIds.includes(String(slot.category_id || ''))) return false;
    return true;
  }, [selectedSystemIds, selectedCategoryIds]);

  const slotsByLocation = useMemo(() => {
    const map = new Map();
    data.locationSystems.forEach((slot) => {
      const key = `${slot.location_kind}:${slot.location_id}`;
      const list = map.get(key) || [];
      list.push(slot);
      map.set(key, list);
    });
    map.forEach((list, key) => {
      map.set(key, [...list].sort((a, b) => naturalCompare(a.system_name, b.system_name)));
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
    const pushEntry = (objectId, name, quantity, unit = '') => {
      const target = ensureObject(objectId);
      if (!target) return;
      const key = normalizeNameKey(name);
      if (!key) return;
      const prev = target.entriesMap.get(key) || { key, name: String(name || '').trim(), quantity: 0, unit: '' };
      prev.quantity += Number(quantity || 0);
      if (!prev.unit && unit) prev.unit = unit;
      target.entriesMap.set(key, prev);
    };

    data.locationSystemMaterials.forEach((row) => {
      const slot = slotById.get(row.location_system_id);
      if (!slotMatchesFilters(slot)) return;
      const objectId = getSlotObjectId(slot);
      pushEntry(objectId, row.material_name, row.quantity, row.material_unit || '');
    });
    data.locationSystemEquipment.forEach((row) => {
      const slot = slotById.get(row.location_system_id);
      if (!slotMatchesFilters(slot)) return;
      const objectId = getSlotObjectId(slot);
      pushEntry(objectId, row.name, row.quantity);
    });
    data.locationSystemWorks.forEach((row) => {
      const slot = slotById.get(row.location_system_id);
      if (!slotMatchesFilters(slot)) return;
      const objectId = getSlotObjectId(slot);
      pushEntry(objectId, row.name, row.quantity);
    });

    const prepared = new Map();
    summary.forEach((raw, objectId) => {
      const entries = [...raw.entriesMap.values()].sort((a, b) => naturalCompare(a.name, b.name));
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

  const renderLocationActions = (locationKind, locationId, title) => {
    const canPaste = copiedLocationTemplate && copiedLocationTemplate.locationKind === locationKind;
    const locationBusy = pasteBusyKey === `location:${locationKind}:${locationId}`;
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
      </div>
    );
  };

  const renderSystemSquares = (locationKind, locationId, title) => {
    const key = `${locationKind}:${locationId}`;
    const slots = (slotsByLocation.get(key) || []).filter(slotMatchesFilters);
    const isPastingHere = pasteBusyKey === `slot:${key}`;
    if (!slots.length && hasSlotFilters) return null;
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {slots.map((slot) => {
            const entries = getSlotEntries(slot.id);
            return (
              <SystemSquare
                key={slot.id}
                slot={{ ...slot, locationTitle: title, entryNames: entries.map((row) => row.name) }}
                onOpen={openSlotModal}
                totals={{ positions: entries.length }}
              />
            );
          })}
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
          {(selectedSystemIds.length > 0 || selectedCategoryIds.length > 0) && (
            <button
              type="button"
              className="btn-ghost text-sm"
              onClick={() => {
                setSelectedSystemIds([]);
                setSelectedCategoryIds([]);
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
                  <div className="space-y-1 max-h-40 overflow-auto pr-1">
                    {objectSummary.entries.map((row) => (
                      <div key={row.key} className="text-[11px] text-zinc-200 flex justify-between gap-2">
                        <span>{row.name}</span>
                        <span className="text-zinc-400 whitespace-nowrap">
                          {formatQty(row.quantity)}{row.unit ? ` ${row.unit}` : ''}
                        </span>
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
                              const collapsed = collapsedFloorSet.has(floor.id);
                              return (
                                <div key={floor.id} className="rounded-lg border border-white/10 bg-black/20 p-2.5 space-y-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => toggleFloor(floor.id)}
                                      className="text-zinc-100 text-xs font-semibold hover:text-white"
                                    >
                                      Этаж {floor.name}
                                    </button>
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
                                              return (
                                                <div key={room.id} className="rounded border border-white/10 bg-black/20 px-2 py-1.5 space-y-1.5">
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
                                                return (
                                                  <div key={room.id} className="rounded border border-white/10 bg-zinc-800/70 px-2 py-1 space-y-1">
                                                    <p className="text-zinc-300 text-[10px] font-medium">Пом. {room.name}</p>
                                                    {renderLocationActions('room', room.id, `Пом. ${room.name}`)}
                                                    {roomSquares}
                                                  </div>
                                                );
                                              }).filter(Boolean);
                                              if (!apartmentSquares && apartmentRoomCards.length === 0) return null;
                                              return (
                                                <div key={apartment.id} className="rounded border border-white/10 bg-black/20 px-2 py-1.5 space-y-1.5">
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
