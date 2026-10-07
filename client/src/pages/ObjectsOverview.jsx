import { useCallback, useEffect, useMemo, useState } from 'react';
import { objectsView as objectsApi } from '../api';

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
};
const FLOOR_ROOMS_BUCKET_NAME = 'Помещения этажа';
const FLOOR_ROOMS_DISPLAY_TITLE = 'Помещения на этаже';

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
  };
}

function asIntSet(values) {
  return new Set(values.map((v) => Number.parseInt(v, 10)).filter((v) => Number.isInteger(v) && v > 0));
}

function toggleSelection(list, id) {
  const key = String(id);
  return list.includes(key) ? list.filter((x) => x !== key) : [...list, key];
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
    isIncomplete: missing.length > 0,
    missing,
  };
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

function LocationSlotChip({ slot, entries }) {
  const entryNames = entries.map((row) => row.name).filter(Boolean);
  const completeness = slotCompleteness(slot, entryNames);
  const previewText = entryNames.length ? entryNames.slice(0, 2).join(', ') : 'Позиции не добавлены';
  const title = [
    `Система: ${slot.system_name || '—'}`,
    `Категория: ${slot.category_name || '—'}`,
    `Позиций: ${entries.length}`,
    `Список: ${entryNames.length ? entryNames.join(', ') : '—'}`,
    completeness.isIncomplete ? `Не заполнено: ${completeness.missing.join(', ')}` : '',
  ].filter(Boolean).join('\n');
  return (
    <div
      className={`w-[3.8rem] h-[3.8rem] rounded border p-1 text-left ${completeness.isIncomplete ? 'border-rose-500/70 bg-rose-950/35 text-rose-100' : 'border-white/15 bg-zinc-900/70 text-zinc-100'}`}
      title={title}
    >
      <p className="text-[9px] font-semibold leading-tight truncate">{slot.system_name || 'Без системы'}</p>
      <p className="text-[8px] text-zinc-400 leading-tight truncate">{slot.category_name || 'Без категории'}</p>
      <p className="mt-0.5 text-[8px] leading-tight truncate">{previewText}</p>
    </div>
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
  const [data, setData] = useState(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedObjects, setSelectedObjects] = useState([]);
  const [selectedEntrances, setSelectedEntrances] = useState([]);
  const [collapsedFloors, setCollapsedFloors] = useState([]);
  const [expandedEntrance, setExpandedEntrance] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    objectsApi.hierarchy()
      .then((payload) => setData(normalizeHierarchy(payload)))
      .catch((e) => setError(e.message || 'Ошибка загрузки схемы объектов'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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

  const objectIdSet = useMemo(() => asIntSet(selectedObjects), [selectedObjects]);
  const entranceIdSet = useMemo(() => asIntSet(selectedEntrances), [selectedEntrances]);
  const collapsedFloorSet = useMemo(() => asIntSet(collapsedFloors), [collapsedFloors]);

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

  const renderLocationBlocks = (locationKind, locationId) => {
    const slots = slotsByLocation.get(`${locationKind}:${locationId}`) || [];
    if (!slots.length) return null;
    return (
      <div className="mt-1 flex flex-wrap gap-1">
        {slots.map((slot) => (
          <LocationSlotChip
            key={slot.id}
            slot={slot}
            entries={entriesBySlot.get(slot.id) || []}
          />
        ))}
      </div>
    );
  };

  const renderFloorCard = (floor, floorApartments, floorRooms, compact = false) => {
    const isCollapsed = collapsedFloorSet.has(floor.id);
    const floorRoomsBucket = floorApartments.find((apartment) => apartment.name === FLOOR_ROOMS_BUCKET_NAME);
    const regularApartments = floorApartments.filter((apartment) => apartment.name !== FLOOR_ROOMS_BUCKET_NAME);
    const floorOnlyRooms = floorRoomsBucket ? (roomsByApartment.get(floorRoomsBucket.id) || []) : [];
    return (
      <div
        key={floor.id}
        className={`rounded-lg border border-white/10 bg-black/20 ${compact ? 'p-2.5' : 'p-2'} space-y-1.5`}
      >
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => toggleFloorCollapse(floor.id)}
            className="text-zinc-100 text-xs font-semibold hover:text-white text-left"
            title={isCollapsed ? 'Развернуть этаж' : 'Свернуть этаж'}
          >
            Этаж {floor.name}
          </button>
          <span className="text-2xs text-zinc-500">
            {regularApartments.length} / {floorRooms}
          </span>
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
                    const apartmentRooms = roomsByApartment.get(apartment.id) || [];
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
          const objectEntrances = (entrancesByObject.get(objectRow.id) || [])
            .filter((entry) => !entranceIdSet.size || entranceIdSet.has(entry.id));
          let floorCount = 0;
          let apartmentCount = 0;
          let roomCount = 0;
          objectEntrances.forEach((entry) => {
            const entranceFloors = floorsByEntrance.get(entry.id) || [];
            floorCount += entranceFloors.length;
            entranceFloors.forEach((floor) => {
              const floorApartments = apartmentsByFloor.get(floor.id) || [];
              apartmentCount += floorApartments.length;
              floorApartments.forEach((apartment) => {
                roomCount += (roomsByApartment.get(apartment.id) || []).length;
              });
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

              {objectEntrances.length ? (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {objectEntrances.map((entry) => {
                    const entranceFloors = floorsByEntrance.get(entry.id) || [];
                    let entranceApartments = 0;
                    let entranceRooms = 0;
                    entranceFloors.forEach((floor) => {
                      const floorApartments = apartmentsByFloor.get(floor.id) || [];
                      entranceApartments += floorApartments.length;
                      floorApartments.forEach((apartment) => {
                        entranceRooms += (roomsByApartment.get(apartment.id) || []).length;
                      });
                    });
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
                          <span className="text-2xs text-zinc-400">Этажей: {entranceFloors.length}</span>
                        </div>
                        {entranceFloors.length ? (
                          <div className="space-y-2">
                            {entranceFloors.map((floor) => {
                              const floorApartments = apartmentsByFloor.get(floor.id) || [];
                              let floorRooms = 0;
                              floorApartments.forEach((apartment) => {
                                floorRooms += (roomsByApartment.get(apartment.id) || []).length;
                              });
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

  return (
    <div className="space-y-5">
      <div>
        <h2 className="page-title">Объекты</h2>
        <p className="text-zinc-400 text-sm mt-1">
          Схема размещения по объектам: подъезды, этажи, квартиры и помещения. Блоки автоматически меняют размер по насыщенности структуры.
        </p>
      </div>

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
                let floorRooms = 0;
                floorApartments.forEach((apartment) => {
                  floorRooms += (roomsByApartment.get(apartment.id) || []).length;
                });
                return renderFloorCard(floor, floorApartments, floorRooms, true);
              })}
              {!((floorsByEntrance.get(expandedEntrance.id) || []).length) && (
                <p className="text-zinc-500 text-sm">Для этого подъезда этажи ещё не добавлены</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
