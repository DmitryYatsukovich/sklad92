import { useCallback, useEffect, useMemo, useState } from 'react';
import { objectsView as objectsApi } from '../api';

const EMPTY_DATA = {
  objects: [],
  entrances: [],
  floors: [],
  apartments: [],
  rooms: [],
};

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
  };
}

function asIntSet(values) {
  return new Set(values.map((v) => Number.parseInt(v, 10)).filter((v) => Number.isInteger(v) && v > 0));
}

function toggleSelection(list, id) {
  const key = String(id);
  return list.includes(key) ? list.filter((x) => x !== key) : [...list, key];
}

function blockSizeClass(level, score) {
  if (level === 'object') {
    if (score >= 18) return 'xl:col-span-2 min-h-[24rem]';
    if (score >= 10) return 'min-h-[21rem]';
    return 'min-h-[18rem]';
  }
  if (level === 'entrance') {
    if (score >= 12) return 'md:col-span-2 min-h-[14rem]';
    if (score >= 6) return 'min-h-[12rem]';
    return 'min-h-[10rem]';
  }
  if (level === 'floor') {
    if (score >= 8) return 'md:col-span-2';
    return '';
  }
  return '';
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
                <div className="grid gap-3 md:grid-cols-2">
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
                          <h4 className="text-emerald-200 text-sm font-medium">Подъезд {entry.name}</h4>
                          <span className="text-2xs text-zinc-400">Этажей: {entranceFloors.length}</span>
                        </div>
                        {entranceFloors.length ? (
                          <div className="grid gap-2 md:grid-cols-2">
                            {entranceFloors.map((floor) => {
                              const floorApartments = apartmentsByFloor.get(floor.id) || [];
                              let floorRooms = 0;
                              floorApartments.forEach((apartment) => {
                                floorRooms += (roomsByApartment.get(apartment.id) || []).length;
                              });
                              const floorScore = floorApartments.length + (floorRooms * 0.4);
                              return (
                                <div
                                  key={floor.id}
                                  className={`rounded-lg border border-white/10 bg-black/20 p-2.5 space-y-2 ${blockSizeClass('floor', floorScore)}`}
                                >
                                  <p className="text-zinc-100 text-sm font-medium">Этаж {floor.name}</p>
                                  {floorApartments.length ? (
                                    <div className="space-y-1.5">
                                      {floorApartments.map((apartment) => {
                                        const apartmentRooms = roomsByApartment.get(apartment.id) || [];
                                        return (
                                          <div key={apartment.id} className="rounded-md border border-white/10 bg-white/[0.03] p-2">
                                            <div className="flex items-center justify-between gap-2">
                                              <span className="text-zinc-200 text-xs">Кв. {apartment.name}</span>
                                              <span className="text-zinc-500 text-2xs">{apartmentRooms.length} пом.</span>
                                            </div>
                                            {!!apartmentRooms.length && (
                                              <div className="mt-1 flex flex-wrap gap-1">
                                                {apartmentRooms.slice(0, 5).map((room) => (
                                                  <span
                                                    key={room.id}
                                                    className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 text-2xs"
                                                  >
                                                    {room.name}
                                                  </span>
                                                ))}
                                                {apartmentRooms.length > 5 && (
                                                  <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 text-2xs">
                                                    +{apartmentRooms.length - 5}
                                                  </span>
                                                )}
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  ) : (
                                    <p className="text-zinc-500 text-2xs">Квартиры ещё не добавлены</p>
                                  )}
                                </div>
                              );
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
    </div>
  );
}
