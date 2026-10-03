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
  };
}

function groupColorByIconKey(iconKey) {
  const key = String(iconKey || '').toLowerCase();
  if (key.includes('fire') || key.includes('smoke') || key.includes('heat') || key.includes('siren')) {
    return 'bg-rose-500/15 text-rose-300 ring-rose-400/35';
  }
  if (key.includes('access') || key.includes('lock') || key.includes('card') || key.includes('turnstile') || key.includes('intercom')) {
    return 'bg-violet-500/15 text-violet-300 ring-violet-400/35';
  }
  if (key.includes('video') || key.includes('camera') || key.includes('recorder') || key.includes('monitor')) {
    return 'bg-cyan-500/15 text-cyan-300 ring-cyan-400/35';
  }
  if (key.includes('dispatch') || key.includes('automation') || key.includes('controller') || key.includes('network') || key.includes('server')) {
    return 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/35';
  }
  if (key.includes('electrical') || key.includes('cable') || key.includes('panel') || key.includes('socket') || key.includes('switch') || key.includes('lighting')) {
    return 'bg-sky-500/15 text-sky-300 ring-sky-400/35';
  }
  return 'bg-zinc-500/20 text-zinc-200 ring-zinc-400/30';
}

function CategoryGlyph({ iconKey, className = 'h-4 w-4' }) {
  const key = String(iconKey || '').toLowerCase();
  if (key.includes('fire') || key.includes('smoke') || key.includes('heat') || key.includes('siren')) {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
        <path d="M12 3c2 2 3 4 3 6 0 1.5-.5 2.7-1.6 3.8C12.2 14 12 15 12 16c0-1.2-.5-2.2-1.7-3.2C9.2 11.7 9 10.5 9 9c0-2 1-4 3-6z" stroke="currentColor" strokeWidth="1.7" />
        <path d="M7 16c0 2.8 2.2 5 5 5s5-2.2 5-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (key.includes('access') || key.includes('lock') || key.includes('card') || key.includes('turnstile') || key.includes('intercom')) {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
        <rect x="6" y="11" width="12" height="9" rx="2" stroke="currentColor" strokeWidth="1.7" />
        <path d="M9 11V8a3 3 0 0 1 6 0v3" stroke="currentColor" strokeWidth="1.7" />
      </svg>
    );
  }
  if (key.includes('video') || key.includes('camera') || key.includes('recorder') || key.includes('monitor')) {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
        <path d="M3 10h12l3 3v3H6l-3-3v-3z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        <path d="M15 10l4-2v2.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (key.includes('dispatch') || key.includes('automation') || key.includes('controller') || key.includes('network') || key.includes('server')) {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
        <rect x="3" y="5" width="8" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
        <rect x="13" y="5" width="8" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
        <rect x="3" y="13" width="18" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <path d="M13 2L5 13h6l-1 9 9-13h-6l1-7z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function SystemSquare({ slot, onOpen }) {
  const hasCategory = !!slot.category_id;
  const color = hasCategory
    ? groupColorByIconKey(slot.category_icon_key)
    : 'bg-zinc-500/15 text-zinc-300 ring-zinc-500/35';
  return (
    <button
      type="button"
      onClick={() => onOpen(slot)}
      className={`w-24 h-24 rounded-lg border border-white/15 p-2 text-left transition hover:bg-white/10 ${color}`}
      title={`${slot.system_name}${slot.category_name ? ` • ${slot.category_name}` : ''}`}
    >
      <div className="flex h-full flex-col justify-between">
        <div className="flex items-start justify-between gap-2">
          <span className="text-[10px] font-medium leading-tight">{slot.system_name}</span>
          {hasCategory ? (
            <span className={`inline-flex h-6 w-6 items-center justify-center rounded-md ring-1 ${color}`}>
              <CategoryGlyph iconKey={slot.category_icon_key} className="h-4 w-4" />
            </span>
          ) : (
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-md ring-1 ring-white/20 bg-black/20 text-white/70 text-sm">
              ?
            </span>
          )}
        </div>
        <div className="text-[10px] text-zinc-200/90 leading-tight">
          {slot.category_name || 'Выбрать категорию'}
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

  const [addSystemModal, setAddSystemModal] = useState({ open: false, locationKind: '', locationId: null, title: '' });
  const [selectedSystemId, setSelectedSystemId] = useState('');

  const [slotModalOpen, setSlotModalOpen] = useState(false);
  const [activeSlot, setActiveSlot] = useState(null);
  const [materialQuery, setMaterialQuery] = useState('');
  const [materialSuggestions, setMaterialSuggestions] = useState([]);
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [selectedMaterial, setSelectedMaterial] = useState(null);
  const [materialQuantity, setMaterialQuantity] = useState('1');
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

  const openAddSystemModal = (locationKind, locationId, title) => {
    setSelectedSystemId('');
    setAddSystemModal({ open: true, locationKind, locationId, title });
  };

  const closeAddSystemModal = () => {
    setAddSystemModal({ open: false, locationKind: '', locationId: null, title: '' });
    setSelectedSystemId('');
  };

  const handleAddSystem = async (e) => {
    e.preventDefault();
    const systemId = Number.parseInt(selectedSystemId, 10);
    if (!systemId || !addSystemModal.locationId || !addSystemModal.locationKind) return;
    setSlotBusy(true);
    setError('');
    try {
      await settingsApi.objectSettings.createLocationSystem({
        location_kind: addSystemModal.locationKind,
        location_id: addSystemModal.locationId,
        system_id: systemId,
      });
      closeAddSystemModal();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSlotBusy(false);
    }
  };

  const openSlotModal = (slot) => {
    setActiveSlot(slot);
    setSlotModalOpen(true);
    setMaterialQuery('');
    setMaterialSuggestions([]);
    setSelectedMaterial(null);
    setMaterialQuantity('1');
  };

  const closeSlotModal = () => {
    setSlotModalOpen(false);
    setActiveSlot(null);
    setMaterialQuery('');
    setMaterialSuggestions([]);
    setSelectedMaterial(null);
    setMaterialQuantity('1');
  };

  useEffect(() => {
    if (!slotModalOpen || !activeSlot?.id || !activeSlot?.system_id) return undefined;
    if (!materialQuery.trim()) {
      setMaterialSuggestions([]);
      return undefined;
    }
    const timer = setTimeout(() => {
      setSuggestionLoading(true);
      settingsApi.objectSettings.materialSuggestions(
        activeSlot.system_id,
        materialQuery.trim(),
        activeSlot.category_id || null,
      )
        .then((rows) => {
          setMaterialSuggestions(Array.isArray(rows) ? rows : []);
        })
        .catch(() => setMaterialSuggestions([]))
        .finally(() => setSuggestionLoading(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [slotModalOpen, activeSlot?.id, activeSlot?.system_id, activeSlot?.category_id, materialQuery]);

  const handleSelectCategory = async (categoryId) => {
    if (!activeSlot?.id) return;
    setSlotBusy(true);
    setError('');
    try {
      const updated = await settingsApi.objectSettings.updateLocationSystem(activeSlot.id, { category_id: categoryId || null });
      setActiveSlot(updated);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSlotBusy(false);
    }
  };

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

  const handleAddMaterial = async (e) => {
    e.preventDefault();
    if (!activeSlot?.id || !selectedMaterial?.id) return;
    const qty = Number.parseFloat(materialQuantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError('Количество должно быть больше нуля');
      return;
    }
    setSlotBusy(true);
    setError('');
    try {
      await settingsApi.objectSettings.addMaterial(activeSlot.id, {
        material_id: selectedMaterial.id,
        quantity: qty,
      });
      setMaterialQuery('');
      setMaterialSuggestions([]);
      setSelectedMaterial(null);
      setMaterialQuantity('1');
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

  const renderSystemSquares = (locationKind, locationId, title) => {
    const key = `${locationKind}:${locationId}`;
    const slots = slotsByLocation.get(key) || [];
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {slots.map((slot) => (
            <SystemSquare key={slot.id} slot={slot} onOpen={openSlotModal} />
          ))}
          <button
            type="button"
            onClick={() => openAddSystemModal(locationKind, locationId, title)}
            className="w-24 h-24 rounded-lg border border-dashed border-white/20 bg-black/20 hover:bg-white/10 text-zinc-300 text-xs"
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
          return (
            <article key={obj.id} className="rounded-2xl border border-sky-500/25 bg-sky-950/20 p-4 space-y-3">
              <h3 className="text-white font-semibold">{obj.name}</h3>
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

      {addSystemModal.open && (
        <div className="modal-backdrop z-50" onClick={closeAddSystemModal} role="dialog" aria-modal="true">
          <div className="card p-5 max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-white font-medium text-lg mb-4">Добавить систему</h3>
            <p className="text-zinc-400 text-sm mb-3">{addSystemModal.title}</p>
            <form onSubmit={handleAddSystem} className="space-y-4">
              <div>
                <label className="label">Система</label>
                <select
                  value={selectedSystemId}
                  onChange={(e) => setSelectedSystemId(e.target.value)}
                  className="input"
                  required
                >
                  <option value="">— Выберите систему —</option>
                  {data.systems.map((system) => (
                    <option key={system.id} value={system.id}>{system.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={closeAddSystemModal} className="btn-ghost text-sm">Отмена</button>
                <button type="submit" className="btn-primary text-sm" disabled={slotBusy}>
                  {slotBusy ? 'Сохранение…' : 'Добавить'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {slotModalOpen && activeSlot && (
        <div className="modal-backdrop z-50" onClick={closeSlotModal} role="dialog" aria-modal="true">
          <div className="card p-5 max-w-3xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="text-white font-medium text-lg">{activeSlot.system_name}</h3>
                <p className="text-zinc-400 text-sm">Выберите категорию и материалы для монтажа</p>
              </div>
              <button type="button" onClick={handleDeleteSlot} className="btn-ghost text-rose-300 text-sm" disabled={slotBusy}>
                Удалить блок
              </button>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-zinc-200 text-sm font-medium">Категория</p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => handleSelectCategory(null)}
                    className={`rounded-lg border px-3 py-2 text-left ${!activeSlot.category_id ? 'border-sky-400/70 bg-sky-500/10' : 'border-white/10 bg-zinc-900/50 hover:bg-zinc-800/70'}`}
                  >
                    Без категории
                  </button>
                  {data.categories.map((category) => {
                    const selected = Number(activeSlot.category_id) === Number(category.id);
                    const color = groupColorByIconKey(category.icon_key);
                    return (
                      <button
                        key={category.id}
                        type="button"
                        onClick={() => handleSelectCategory(category.id)}
                        className={`rounded-lg border px-3 py-2 text-left ${
                          selected ? 'border-sky-400/70 bg-sky-500/10' : 'border-white/10 bg-zinc-900/50 hover:bg-zinc-800/70'
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <span className={`inline-flex h-7 w-7 items-center justify-center rounded-md ring-1 ${color}`}>
                            <CategoryGlyph iconKey={category.icon_key} className="h-4 w-4" />
                          </span>
                          <span className="text-sm text-white">{category.name}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-3 rounded-xl border border-white/10 p-3">
                <p className="text-zinc-200 text-sm font-medium">Добавить материал</p>
                <form onSubmit={handleAddMaterial} className="grid gap-3 md:grid-cols-[1fr_120px_auto]">
                  <div className="space-y-2">
                    <input
                      type="text"
                      className="input"
                      placeholder="Начните печатать название материала…"
                      value={materialQuery}
                      onChange={(e) => {
                        setMaterialQuery(e.target.value);
                        setSelectedMaterial(null);
                      }}
                    />
                    {suggestionLoading && <p className="text-zinc-500 text-xs">Поиск материалов…</p>}
                    {!suggestionLoading && materialSuggestions.length > 0 && (
                      <div className="max-h-52 overflow-auto rounded-lg border border-white/10 bg-zinc-950/95">
                        {materialSuggestions.map((row) => (
                          <button
                            key={row.id}
                            type="button"
                            onClick={() => {
                              setSelectedMaterial(row);
                              setMaterialQuery(row.name);
                              setMaterialSuggestions([]);
                            }}
                            className="w-full text-left px-3 py-2 border-b border-white/5 hover:bg-white/10"
                          >
                            <p className="text-sm text-white">{row.name}</p>
                            <p className="text-2xs text-zinc-400">Остаток: {row.quantity ?? 0} {row.unit || ''}</p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <input
                    type="number"
                    min="0.0001"
                    step="0.0001"
                    value={materialQuantity}
                    onChange={(e) => setMaterialQuantity(e.target.value)}
                    className="input"
                    placeholder="Кол-во"
                    required
                  />
                  <button type="submit" className="btn-primary text-sm" disabled={slotBusy || !selectedMaterial}>
                    Добавить
                  </button>
                </form>
                {selectedMaterial && (
                  <p className="text-zinc-400 text-xs">
                    Выбрано: {selectedMaterial.name} ({selectedMaterial.unit || 'ед.'})
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <p className="text-zinc-200 text-sm font-medium">Материалы в блоке</p>
                {(materialsBySlot.get(activeSlot.id) || []).length ? (
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
                        {(materialsBySlot.get(activeSlot.id) || []).map((row) => (
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
