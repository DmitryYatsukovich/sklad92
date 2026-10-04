import { useCallback, useEffect, useMemo, useState } from 'react';
import { settings as settingsApi } from '../../api';

const FLOOR_ROOMS_BUCKET_NAME = 'Помещения этажа';

function naturalCompare(a, b) {
  return String(a || '').localeCompare(String(b || ''), 'ru', { numeric: true, sensitivity: 'base' });
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
  const equipmentPreview = Array.isArray(slot.equipmentNames) ? slot.equipmentNames.filter(Boolean) : [];
  const previewText = equipmentPreview.length
    ? equipmentPreview.slice(0, 2).join(', ')
    : 'Оборудование не добавлено';
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
          <p className="text-[8px] text-zinc-400 leading-tight">
            M:{totals?.materials || 0} E:{totals?.equipment || 0} W:{totals?.works || 0}
          </p>
        </div>
      </div>
    </button>
  );
}

export default function ObjectSettingsTab() {
  const [data, setData] = useState(normalizePayload({}));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [collapsedFloors, setCollapsedFloors] = useState([]);

  const [slotModalOpen, setSlotModalOpen] = useState(false);
  const [activeSlot, setActiveSlot] = useState(null);
  const [slotDraft, setSlotDraft] = useState({ locationKind: '', locationId: null, title: '' });
  const [slotSystemId, setSlotSystemId] = useState('');
  const [slotCategoryId, setSlotCategoryId] = useState('');
  const [entryKind, setEntryKind] = useState('material');
  const [entryQuery, setEntryQuery] = useState('');
  const [entrySuggestions, setEntrySuggestions] = useState([]);
  const [entrySuggestionLoading, setEntrySuggestionLoading] = useState(false);
  const [selectedMaterial, setSelectedMaterial] = useState(null);
  const [entryQuantity, setEntryQuantity] = useState('1');
  const [slotBusy, setSlotBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    settingsApi.objectSettings.layout()
      .then((payload) => setData(normalizePayload(payload)))
      .catch((e) => setError(e.message || 'Ошибка загрузки настроек объектов'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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

  const objectSummaryById = useMemo(() => {
    const summary = new Map();
    const ensureObject = (objectId) => {
      if (!objectId) return null;
      if (!summary.has(objectId)) {
        summary.set(objectId, {
          materialsMap: new Map(),
          equipmentMap: new Map(),
          worksMap: new Map(),
        });
      }
      return summary.get(objectId);
    };
    const getSlotObjectId = (slot) => {
      if (!slot) return null;
      if (slot.location_kind === 'apartment') {
        return apartmentById.get(slot.location_id)?.object_id || null;
      }
      if (slot.location_kind === 'room') {
        return roomById.get(slot.location_id)?.object_id || null;
      }
      return null;
    };

    data.locationSystemMaterials.forEach((row) => {
      const slot = slotById.get(row.location_system_id);
      const objectId = getSlotObjectId(slot);
      const target = ensureObject(objectId);
      if (!target) return;
      const key = String(row.material_id);
      const prev = target.materialsMap.get(key) || {
        key,
        name: row.material_name,
        unit: row.material_unit,
        quantity: 0,
      };
      prev.quantity += Number(row.quantity || 0);
      target.materialsMap.set(key, prev);
    });
    data.locationSystemEquipment.forEach((row) => {
      const slot = slotById.get(row.location_system_id);
      const objectId = getSlotObjectId(slot);
      const target = ensureObject(objectId);
      if (!target) return;
      const key = String(row.name || '').trim().toLowerCase();
      const prev = target.equipmentMap.get(key) || {
        key,
        name: row.name,
        quantity: 0,
      };
      prev.quantity += Number(row.quantity || 0);
      target.equipmentMap.set(key, prev);
    });
    data.locationSystemWorks.forEach((row) => {
      const slot = slotById.get(row.location_system_id);
      const objectId = getSlotObjectId(slot);
      const target = ensureObject(objectId);
      if (!target) return;
      const key = String(row.name || '').trim().toLowerCase();
      const prev = target.worksMap.get(key) || {
        key,
        name: row.name,
        quantity: 0,
      };
      prev.quantity += Number(row.quantity || 0);
      target.worksMap.set(key, prev);
    });

    const prepared = new Map();
    summary.forEach((raw, objectId) => {
      const materials = [...raw.materialsMap.values()].sort((a, b) => naturalCompare(a.name, b.name));
      const equipment = [...raw.equipmentMap.values()].sort((a, b) => naturalCompare(a.name, b.name));
      const works = [...raw.worksMap.values()].sort((a, b) => naturalCompare(a.name, b.name));
      prepared.set(objectId, {
        materials,
        equipment,
        works,
        materialsTotalQty: materials.reduce((acc, row) => acc + Number(row.quantity || 0), 0),
        equipmentTotalQty: equipment.reduce((acc, row) => acc + Number(row.quantity || 0), 0),
        worksTotalQty: works.reduce((acc, row) => acc + Number(row.quantity || 0), 0),
      });
    });
    return prepared;
  }, [
    data.locationSystems,
    data.locationSystemMaterials,
    data.locationSystemEquipment,
    data.locationSystemWorks,
    slotById,
    apartmentById,
    roomById,
  ]);

  const openCreateSlotModal = (locationKind, locationId, title) => {
    setActiveSlot(null);
    setSlotDraft({ locationKind, locationId, title });
    setSlotSystemId('');
    setSlotCategoryId('');
    setSlotModalOpen(true);
    setEntryKind('material');
    setEntryQuery('');
    setEntrySuggestions([]);
    setSelectedMaterial(null);
    setEntryQuantity('1');
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
    setEntryKind('material');
    setEntryQuery('');
    setEntrySuggestions([]);
    setSelectedMaterial(null);
    setEntryQuantity('1');
  };

  const closeSlotModal = () => {
    setSlotModalOpen(false);
    setActiveSlot(null);
    setSlotDraft({ locationKind: '', locationId: null, title: '' });
    setSlotSystemId('');
    setSlotCategoryId('');
    setEntryKind('material');
    setEntryQuery('');
    setEntrySuggestions([]);
    setSelectedMaterial(null);
    setEntryQuantity('1');
  };

  const handleSaveSlotMeta = async (e) => {
    e.preventDefault();
    const systemId = Number.parseInt(slotSystemId, 10);
    const categoryId = slotCategoryId ? Number.parseInt(slotCategoryId, 10) : null;
    if (!systemId) {
      setError('Выберите систему');
      return;
    }
    if (slotCategoryId && !categoryId) {
      setError('Неверная категория');
      return;
    }
    if (!slotDraft.locationKind || !slotDraft.locationId) {
      setError('Локация не выбрана');
      return;
    }
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
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSlotBusy(false);
    }
  };

  useEffect(() => {
    if (!slotModalOpen || !activeSlot?.id || !activeSlot?.system_id || entryKind !== 'material') return undefined;
    if (!entryQuery.trim()) {
      setEntrySuggestions([]);
      return undefined;
    }
    const timer = setTimeout(() => {
      setEntrySuggestionLoading(true);
      settingsApi.objectSettings.materialSuggestions(
        activeSlot.system_id,
        entryQuery.trim(),
        activeSlot.category_id || null,
      )
        .then((rows) => {
          setEntrySuggestions(Array.isArray(rows) ? rows : []);
        })
        .catch(() => setEntrySuggestions([]))
        .finally(() => setEntrySuggestionLoading(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [slotModalOpen, activeSlot?.id, activeSlot?.system_id, activeSlot?.category_id, entryKind, entryQuery]);

  useEffect(() => {
    setSelectedMaterial(null);
    setEntrySuggestions([]);
    setEntrySuggestionLoading(false);
    setEntryQuery('');
    setEntryQuantity('1');
  }, [entryKind]);

  const handleDeleteSlot = async () => {
    if (!activeSlot?.id) return;
    if (!confirm(`Удалить блок системы «${activeSlot.system_name}»?`)) return;
    setSlotBusy(true);
    setError('');
    try {
      await settingsApi.objectSettings.deleteLocationSystem(activeSlot.id);
      closeSlotModal();
      await load();
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
    if (!Number.isFinite(qty) || qty <= 0) {
      setError('Количество должно быть больше нуля');
      return;
    }
    const textName = String(entryQuery || '').trim();
    setSlotBusy(true);
    setError('');
    try {
      if (entryKind === 'material') {
        if (!selectedMaterial?.id) {
          setError('Выберите материал из подсказок');
          return;
        }
        await settingsApi.objectSettings.addMaterial(activeSlot.id, {
          material_id: selectedMaterial.id,
          quantity: qty,
        });
      } else if (entryKind === 'equipment') {
        if (!textName) {
          setError('Введите название оборудования');
          return;
        }
        await settingsApi.objectSettings.addEquipment(activeSlot.id, { name: textName, quantity: qty });
      } else {
        if (!textName) {
          setError('Введите название работы');
          return;
        }
        await settingsApi.objectSettings.addWork(activeSlot.id, { name: textName, quantity: qty });
      }
      setEntryQuery('');
      setEntrySuggestions([]);
      setSelectedMaterial(null);
      setEntryQuantity('1');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSlotBusy(false);
    }
  };

  const handleDeleteMaterial = async (row) => {
    if (!row?.id) return;
    if (!confirm(`Удалить материал «${row.material_name}» из блока?`)) return;
    setSlotBusy(true);
    setError('');
    try {
      await settingsApi.objectSettings.deleteMaterial(row.id);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSlotBusy(false);
    }
  };

  const handleDeleteEquipment = async (row) => {
    if (!row?.id) return;
    if (!confirm(`Удалить оборудование «${row.name}»?`)) return;
    setSlotBusy(true);
    setError('');
    try {
      await settingsApi.objectSettings.deleteEquipment(row.id);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSlotBusy(false);
    }
  };

  const handleDeleteWork = async (row) => {
    if (!row?.id) return;
    if (!confirm(`Удалить работу «${row.name}»?`)) return;
    setSlotBusy(true);
    setError('');
    try {
      await settingsApi.objectSettings.deleteWork(row.id);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSlotBusy(false);
    }
  };

  const renderSystemSquares = (locationKind, locationId, title) => {
    const key = `${locationKind}:${locationId}`;
    const slots = slotsByLocation.get(key) || [];
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {slots.map((slot) => (
            <SystemSquare
              key={slot.id}
              slot={{
                ...slot,
                locationTitle: title,
                equipmentNames: (equipmentBySlot.get(slot.id) || []).map((row) => row.name),
              }}
              onOpen={openSlotModal}
              totals={{
                materials: (materialsBySlot.get(slot.id) || []).length,
                equipment: (equipmentBySlot.get(slot.id) || []).length,
                works: (worksBySlot.get(slot.id) || []).length,
              }}
            />
          ))}
          <button
            type="button"
            onClick={() => openCreateSlotModal(locationKind, locationId, title)}
            className="w-20 h-20 rounded-md border border-dashed border-white/20 bg-black/20 hover:bg-white/10 text-zinc-300 text-[11px]"
          >
            + Система
          </button>
        </div>
      </div>
    );
  };

  const toggleFloor = (floorId) => {
    const key = String(floorId);
    setCollapsedFloors((prev) => (
      prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]
    ));
  };

  const activeSlotId = activeSlot?.id || null;
  const activeSlotMaterials = activeSlotId ? (materialsBySlot.get(activeSlotId) || []) : [];
  const activeSlotEquipment = activeSlotId ? (equipmentBySlot.get(activeSlotId) || []) : [];
  const activeSlotWorks = activeSlotId ? (worksBySlot.get(activeSlotId) || []) : [];
  const slotLocked = !activeSlot;
  const isMaterialEntry = entryKind === 'material';
  const entryPlaceholder = isMaterialEntry
    ? 'Начните печатать название материала…'
    : entryKind === 'equipment'
      ? 'Введите название оборудования…'
      : 'Введите название работы…';
  const canAddEntry = !slotBusy && !slotLocked && (
    isMaterialEntry ? !!selectedMaterial : String(entryQuery || '').trim().length > 0
  );

  if (loading) return <p className="text-zinc-500 text-sm">Загрузка настроек объектов…</p>;

  return (
    <div className="space-y-4">
      <p className="text-zinc-400 text-sm">
        План монтажа по объектам: добавляйте системы в квартиры и помещения, выбирайте категорию и привязывайте материалы с количеством.
      </p>
      {error && <p className="text-rose-400 text-sm">{error}</p>}

      <div className="space-y-4">
        {sortedObjects.map((obj) => {
          const objectEntrances = entrancesByObject.get(obj.id) || [];
          const objectSummary = objectSummaryById.get(obj.id) || {
            materials: [],
            equipment: [],
            works: [],
            materialsTotalQty: 0,
            equipmentTotalQty: 0,
            worksTotalQty: 0,
          };
          return (
            <article key={obj.id} className="rounded-2xl border border-sky-500/25 bg-sky-950/20 p-4 space-y-3">
              <div className="space-y-1">
                <h3 className="text-white font-semibold">{obj.name}</h3>
                <p className="text-zinc-400 text-xs">
                  Материалы: {objectSummary.materials.length} поз. / {objectSummary.materialsTotalQty.toLocaleString('ru-RU', { maximumFractionDigits: 4 })}
                  {' · '}
                  Оборудование: {objectSummary.equipment.length} поз. / {objectSummary.equipmentTotalQty.toLocaleString('ru-RU', { maximumFractionDigits: 4 })}
                  {' · '}
                  Работы: {objectSummary.works.length} поз. / {objectSummary.worksTotalQty.toLocaleString('ru-RU', { maximumFractionDigits: 4 })}
                </p>
              </div>
              {!!(objectSummary.materials.length || objectSummary.equipment.length || objectSummary.works.length) && (
                <div className="grid gap-2 lg:grid-cols-3">
                  <div className="rounded-lg border border-white/10 bg-black/20 p-2">
                    <p className="text-zinc-300 text-xs mb-1">Материалы для завершения</p>
                    <div className="space-y-1 max-h-40 overflow-auto pr-1">
                      {objectSummary.materials.map((row) => (
                        <div key={row.key} className="text-[11px] text-zinc-200 flex justify-between gap-2">
                          <span>{row.name}</span>
                          <span className="text-zinc-400 whitespace-nowrap">
                            {row.quantity.toLocaleString('ru-RU', { maximumFractionDigits: 4 })} {row.unit || ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-black/20 p-2">
                    <p className="text-zinc-300 text-xs mb-1">Оборудование для завершения</p>
                    <div className="space-y-1 max-h-40 overflow-auto pr-1">
                      {objectSummary.equipment.map((row) => (
                        <div key={row.key} className="text-[11px] text-zinc-200 flex justify-between gap-2">
                          <span>{row.name}</span>
                          <span className="text-zinc-400 whitespace-nowrap">
                            {row.quantity.toLocaleString('ru-RU', { maximumFractionDigits: 4 })}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-black/20 p-2">
                    <p className="text-zinc-300 text-xs mb-1">Работы для завершения</p>
                    <div className="space-y-1 max-h-40 overflow-auto pr-1">
                      {objectSummary.works.map((row) => (
                        <div key={row.key} className="text-[11px] text-zinc-200 flex justify-between gap-2">
                          <span>{row.name}</span>
                          <span className="text-zinc-400 whitespace-nowrap">
                            {row.quantity.toLocaleString('ru-RU', { maximumFractionDigits: 4 })}
                          </span>
                        </div>
                      ))}
                    </div>
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
                                  <button
                                    type="button"
                                    onClick={() => toggleFloor(floor.id)}
                                    className="text-zinc-100 text-xs font-semibold hover:text-white"
                                  >
                                    Этаж {floor.name}
                                  </button>
                                  {!collapsed && (
                                    <div className="space-y-2">
                                      {floorRooms.length ? (
                                        <div className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5 space-y-1.5">
                                          <p className="text-zinc-200 text-2xs font-medium">Помещения на этаже</p>
                                          {floorRooms.map((room) => (
                                            <div key={room.id} className="rounded border border-white/10 bg-black/20 px-2 py-1.5 space-y-1.5">
                                              <p className="text-zinc-200 text-2xs font-medium">Пом. {room.name}</p>
                                              {renderSystemSquares('room', room.id, `Пом. ${room.name}`)}
                                            </div>
                                          ))}
                                        </div>
                                      ) : null}

                                      {floorApartments.length ? (
                                        <div className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5 space-y-1.5">
                                          <p className="text-zinc-200 text-2xs font-medium">Квартиры на этаже</p>
                                          {floorApartments.map((apartment) => (
                                            <div key={apartment.id} className="rounded border border-white/10 bg-black/20 px-2 py-1.5 space-y-1.5">
                                              <p className="text-zinc-200 text-2xs font-medium">Кв. {apartment.name}</p>
                                              {renderSystemSquares('apartment', apartment.id, `Кв. ${apartment.name}`)}
                                              {(roomsByApartment.get(apartment.id) || []).length ? (
                                                <div className="mt-1 space-y-1">
                                                  {(roomsByApartment.get(apartment.id) || []).map((room) => (
                                                    <div key={room.id} className="rounded border border-white/10 bg-zinc-800/70 px-2 py-1 space-y-1">
                                                      <p className="text-zinc-300 text-[10px] font-medium">Пом. {room.name}</p>
                                                      {renderSystemSquares('room', room.id, `Пом. ${room.name}`)}
                                                    </div>
                                                  ))}
                                                </div>
                                              ) : null}
                                            </div>
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
                <button type="button" onClick={handleDeleteSlot} className="btn-ghost text-rose-300 text-sm" disabled={slotBusy}>
                  Удалить блок
                </button>
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
                  Сначала сохраните систему и категорию, затем добавляйте материалы, оборудование и работы.
                </p>
              )}

              <div className="space-y-3 rounded-xl border border-white/10 p-3">
                <p className="text-zinc-200 text-sm font-medium">Добавить позицию</p>
                <p className="text-zinc-400 text-xs">
                  Одна строка: выберите тип, укажите название/материал и количество.
                </p>
                <form onSubmit={handleAddEntry} className="grid gap-3 md:grid-cols-[170px_1fr_120px_auto]">
                  <select
                    value={entryKind}
                    onChange={(e) => setEntryKind(e.target.value)}
                    className="input"
                    disabled={slotLocked}
                  >
                    <option value="material">Материал</option>
                    <option value="equipment">Оборудование</option>
                    <option value="work">Работа</option>
                  </select>
                  <input
                    type="text"
                    className="input"
                    placeholder={entryPlaceholder}
                    value={entryQuery}
                    disabled={slotLocked}
                    onChange={(e) => {
                      setEntryQuery(e.target.value);
                      if (entryKind === 'material') setSelectedMaterial(null);
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
                {isMaterialEntry && entrySuggestionLoading && <p className="text-zinc-500 text-xs">Поиск материалов…</p>}
                {isMaterialEntry && !entrySuggestionLoading && entrySuggestions.length > 0 && (
                  <div className="max-h-52 overflow-auto rounded-lg border border-white/10 bg-zinc-950/95">
                    {entrySuggestions.map((row) => (
                      <button
                        key={row.id}
                        type="button"
                        onClick={() => {
                          setSelectedMaterial(row);
                          setEntryQuery(row.name);
                          setEntrySuggestions([]);
                        }}
                        className="w-full text-left px-3 py-2 border-b border-white/5 hover:bg-white/10"
                      >
                        <p className="text-sm text-white">{row.name}</p>
                        <p className="text-2xs text-zinc-400">Остаток: {row.quantity ?? 0} {row.unit || ''}</p>
                      </button>
                    ))}
                  </div>
                )}
                {isMaterialEntry && selectedMaterial && (
                  <p className="text-zinc-400 text-xs">
                    Выбрано: {selectedMaterial.name} ({selectedMaterial.unit || 'ед.'})
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <p className="text-zinc-200 text-sm font-medium">Материалы в блоке</p>
                {activeSlotMaterials.length ? (
                  <div className="table-wrap">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-white/10 text-zinc-300">
                          <th className="p-2 font-medium">Материал</th>
                          <th className="p-2 font-medium w-36">Количество</th>
                          <th className="p-2 w-24" />
                        </tr>
                      </thead>
                      <tbody>
                        {activeSlotMaterials.map((row) => (
                          <tr key={row.id} className="border-b border-white/5">
                            <td className="p-2 text-white">{row.material_name}</td>
                            <td className="p-2 text-zinc-300">{row.quantity} {row.material_unit || ''}</td>
                            <td className="p-2">
                              <button
                                type="button"
                                onClick={() => handleDeleteMaterial(row)}
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
                  <p className="text-zinc-500 text-sm">Материалы пока не добавлены.</p>
                )}
              </div>

              <div className="space-y-3 rounded-xl border border-white/10 p-3">
                <p className="text-zinc-200 text-sm font-medium">Оборудование в блоке</p>
                <p className="text-zinc-400 text-xs">
                  Можно добавлять оборудование вручную, даже если его нет в позициях склада.
                </p>
                {activeSlotEquipment.length ? (
                  <div className="space-y-1">
                    {activeSlotEquipment.map((row) => (
                      <div key={row.id} className="rounded border border-white/10 px-2 py-1.5 flex items-center justify-between gap-2">
                        <p className="text-sm text-zinc-200">{row.name}</p>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-zinc-400">
                            {Number(row.quantity || 0).toLocaleString('ru-RU', { maximumFractionDigits: 4 })}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleDeleteEquipment(row)}
                            className="text-rose-400 hover:text-rose-300 text-xs font-medium"
                          >
                            Удал.
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-zinc-500 text-sm">Оборудование пока не добавлено.</p>
                )}
              </div>

              <div className="space-y-3 rounded-xl border border-white/10 p-3">
                <p className="text-zinc-200 text-sm font-medium">Работы в блоке</p>
                {activeSlotWorks.length ? (
                  <div className="space-y-1">
                    {activeSlotWorks.map((row) => (
                      <div key={row.id} className="rounded border border-white/10 px-2 py-1.5 flex items-center justify-between gap-2">
                        <p className="text-sm text-zinc-200">{row.name}</p>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-zinc-400">
                            {Number(row.quantity || 0).toLocaleString('ru-RU', { maximumFractionDigits: 4 })}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleDeleteWork(row)}
                            className="text-rose-400 hover:text-rose-300 text-xs font-medium"
                          >
                            Удал.
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-zinc-500 text-sm">Работы пока не добавлены.</p>
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
