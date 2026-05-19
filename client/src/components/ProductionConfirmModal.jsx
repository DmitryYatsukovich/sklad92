import { useState, useMemo, useEffect, useCallback } from 'react';
import { formatWorkLocationFromSelection } from '../lib/workLocationLabel';

function floorSortKey(name) {
  const m = String(name ?? '').match(/-?\d+/);
  return m ? parseInt(m[0], 10) : Number.POSITIVE_INFINITY;
}

function sortFloors(list) {
  return [...list].sort((a, b) => {
    const ka = floorSortKey(a.name);
    const kb = floorSortKey(b.name);
    if (ka !== kb) return ka - kb;
    return String(a.name).localeCompare(String(b.name), 'ru', { numeric: true });
  });
}

function MultiCheckList({ items, selectedIds, onChange, getLabel }) {
  const toggle = (id) => {
    const sid = String(id);
    if (selectedIds.includes(sid)) {
      onChange(selectedIds.filter((x) => x !== sid));
    } else {
      onChange([...selectedIds, sid]);
    }
  };

  if (!items.length) {
    return <p className="text-zinc-500 text-xs py-1">Нет записей в справочнике</p>;
  }

  return (
    <div className="max-h-36 overflow-y-auto rounded-lg border border-white/10 bg-black/20 p-2 space-y-1">
      {items.map((item) => (
        <label
          key={item.id}
          className="flex items-start gap-2 text-sm text-zinc-200 cursor-pointer hover:bg-white/5 rounded px-1 py-0.5"
        >
          <input
            type="checkbox"
            className="mt-0.5"
            checked={selectedIds.includes(String(item.id))}
            onChange={() => toggle(item.id)}
          />
          <span>{getLabel(item)}</span>
        </label>
      ))}
    </div>
  );
}

function initFromRow(row, catalog) {
  let objectId = row.work_object_id ? String(row.work_object_id) : '';
  let items = row.work_location_items;
  if (typeof items === 'string') {
    try {
      items = JSON.parse(items);
    } catch {
      items = {};
    }
  }
  items = items || {};

  if (!objectId && row.work_entrance_id && catalog?.work_entrances) {
    const ent = catalog.work_entrances.find((e) => e.id === row.work_entrance_id);
    if (ent?.object_id) objectId = String(ent.object_id);
  }

  const toStr = (arr) => (arr || []).map((id) => String(id));

  let entranceIds = toStr(items.entrance_ids);
  let floorIds = toStr(items.floor_ids);
  let apartmentIds = toStr(items.apartment_ids);
  let roomIds = toStr(items.room_ids);

  if (!entranceIds.length && row.work_entrance_id) entranceIds = [String(row.work_entrance_id)];
  if (!floorIds.length && row.work_floor_id) floorIds = [String(row.work_floor_id)];
  if (!apartmentIds.length && row.work_apartment_id) apartmentIds = [String(row.work_apartment_id)];
  if (!roomIds.length && row.work_room_id) roomIds = [String(row.work_room_id)];

  return { objectId, entranceIds, floorIds, apartmentIds, roomIds };
}

export default function ProductionConfirmModal({
  row,
  catalog,
  onSubmit,
  onClose,
  saving,
  mode = 'confirm',
}) {
  const isConfirm = mode === 'confirm';
  const [objectId, setObjectId] = useState('');
  const [entranceIds, setEntranceIds] = useState([]);
  const [floorIds, setFloorIds] = useState([]);
  const [apartmentIds, setApartmentIds] = useState([]);
  const [roomIds, setRoomIds] = useState([]);
  const [modalError, setModalError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const ids = initFromRow(row, catalog);
    setObjectId(ids.objectId);
    setEntranceIds(ids.entranceIds);
    setFloorIds(ids.floorIds);
    setApartmentIds(ids.apartmentIds);
    setRoomIds(ids.roomIds);
    setModalError('');
  }, [row, catalog]);

  const entrances = useMemo(() => {
    const oid = parseInt(objectId, 10);
    if (!oid) return [];
    return (catalog.work_entrances || []).filter((e) => e.object_id === oid);
  }, [catalog.work_entrances, objectId]);

  const floors = useMemo(() => {
    if (!entranceIds.length) return [];
    const eids = entranceIds.map(Number);
    const list = (catalog.work_floors || []).filter((f) => eids.includes(f.entrance_id));
    return sortFloors(list);
  }, [catalog.work_floors, entranceIds]);

  const apartments = useMemo(() => {
    if (!floorIds.length) return [];
    const fids = floorIds.map(Number);
    return (catalog.work_apartments || []).filter((a) => fids.includes(a.floor_id));
  }, [catalog.work_apartments, floorIds]);

  const rooms = useMemo(() => {
    if (!apartmentIds.length) return [];
    const aids = apartmentIds.map(Number);
    return (catalog.work_rooms || []).filter((r) => aids.includes(r.apartment_id));
  }, [catalog.work_rooms, apartmentIds]);

  const pruneChildSelections = useCallback((nextEntranceIds, nextFloorIds, nextApartmentIds) => {
    const eids = new Set(nextEntranceIds.map(Number));
    const validFloors = nextEntranceIds.length
      ? nextFloorIds.filter((fid) => {
        const f = catalog.work_floors?.find((x) => String(x.id) === fid);
        return f && eids.has(f.entrance_id);
      })
      : [];

    const fids = new Set(validFloors.map(Number));
    const validApartments = validFloors.length
      ? nextApartmentIds.filter((aid) => {
        const a = catalog.work_apartments?.find((x) => String(x.id) === aid);
        return a && fids.has(a.floor_id);
      })
      : [];

    const aids = new Set(validApartments.map(Number));
    const validRooms = validApartments.length
      ? roomIds.filter((rid) => {
        const r = catalog.work_rooms?.find((x) => String(x.id) === rid);
        return r && aids.has(r.apartment_id);
      })
      : [];

    return { validFloors, validApartments, validRooms };
  }, [catalog.work_floors, catalog.work_apartments, catalog.work_rooms, roomIds]);

  const handleEntranceChange = (ids) => {
    setEntranceIds(ids);
    const { validFloors, validApartments, validRooms } = pruneChildSelections(ids, floorIds, apartmentIds);
    setFloorIds(validFloors);
    setApartmentIds(validApartments);
    setRoomIds(validRooms);
  };

  const handleFloorChange = (ids) => {
    setFloorIds(ids);
    const fids = new Set(ids.map(Number));
    const validApartments = ids.length
      ? apartmentIds.filter((aid) => {
        const a = catalog.work_apartments?.find((x) => String(x.id) === aid);
        return a && fids.has(a.floor_id);
      })
      : [];
    const aids = new Set(validApartments.map(Number));
    const validRooms = validApartments.length
      ? roomIds.filter((rid) => {
        const r = catalog.work_rooms?.find((x) => String(x.id) === rid);
        return r && aids.has(r.apartment_id);
      })
      : [];
    setApartmentIds(validApartments);
    setRoomIds(validRooms);
  };

  const handleApartmentChange = (ids) => {
    setApartmentIds(ids);
    const aids = new Set(ids.map(Number));
    const validRooms = ids.length
      ? roomIds.filter((rid) => {
        const r = catalog.work_rooms?.find((x) => String(x.id) === rid);
        return r && aids.has(r.apartment_id);
      })
      : [];
    setRoomIds(validRooms);
  };

  const selectedLabel = useMemo(() => {
    if (!objectId) return '';
    return formatWorkLocationFromSelection(catalog, Number(objectId), {
      entrance_ids: entranceIds.map(Number),
      floor_ids: floorIds.map(Number),
      apartment_ids: apartmentIds.map(Number),
      room_ids: roomIds.map(Number),
    });
  }, [catalog, objectId, entranceIds, floorIds, apartmentIds, roomIds]);

  const buildPayload = () => ({
    object_id: Number(objectId),
    entrance_ids: entranceIds.map(Number),
    floor_ids: floorIds.map(Number),
    apartment_ids: apartmentIds.map(Number),
    room_ids: roomIds.map(Number),
  });

  const handleObjectChange = (e) => {
    setObjectId(e.target.value);
    setEntranceIds([]);
    setFloorIds([]);
    setApartmentIds([]);
    setRoomIds([]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!objectId) {
      setModalError('Выберите объект');
      return;
    }
    setModalError('');
    setSubmitting(true);
    try {
      await onSubmit(buildPayload());
    } catch (err) {
      setModalError(err.message || (isConfirm ? 'Ошибка подтверждения' : 'Ошибка сохранения'));
    } finally {
      setSubmitting(false);
    }
  };

  const busy = submitting || saving;
  const canSave = !!objectId;

  return (
    <div className="modal-backdrop z-[60]" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="card p-5 max-w-lg w-full max-h-[90vh] overflow-y-auto flex flex-col"
        onClick={(ev) => ev.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-white mb-1">
          {isConfirm ? 'Подтверждение выработки' : 'Место проведения работ'}
        </h3>
        <p className="text-zinc-400 text-xs mb-4">{row.material_name}</p>
        <p className="text-amber-400/90 text-xs mb-3">
          {isConfirm
            ? 'Выберите объект, затем по шагам отметьте подъезды, этажи, квартиры и помещения — каждый следующий уровень появляется после выбора предыдущего.'
            : 'Выберите объект. Следующий уровень (этажи, квартиры, помещения) отображается только после отметки галочек на предыдущем.'}
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="label">Объект <span className="text-red-400">*</span></label>
            <select
              value={objectId}
              onChange={handleObjectChange}
              className="input text-sm"
              required
            >
              <option value="">— Выберите объект —</option>
              {(catalog.objects || []).map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>

          {objectId && (
            <>
              <div>
                <label className="label">Подъезды</label>
                <MultiCheckList
                  items={entrances}
                  selectedIds={entranceIds}
                  onChange={handleEntranceChange}
                  getLabel={(e) => e.name}
                />
              </div>

              {entranceIds.length > 0 && (
                <div>
                  <label className="label">Этажи</label>
                  <MultiCheckList
                    items={floors}
                    selectedIds={floorIds}
                    onChange={handleFloorChange}
                    getLabel={(f) => f.name}
                  />
                </div>
              )}

              {floorIds.length > 0 && (
                <div>
                  <label className="label">Квартиры</label>
                  <MultiCheckList
                    items={apartments}
                    selectedIds={apartmentIds}
                    onChange={handleApartmentChange}
                    getLabel={(a) => a.name}
                  />
                </div>
              )}

              {apartmentIds.length > 0 && (
                <div>
                  <label className="label">Помещения</label>
                  <MultiCheckList
                    items={rooms}
                    selectedIds={roomIds}
                    onChange={setRoomIds}
                    getLabel={(r) => r.name}
                  />
                </div>
              )}
            </>
          )}

          {selectedLabel && (
            <p className="text-emerald-400/90 text-xs">Будет сохранено: {selectedLabel}</p>
          )}

          {modalError && <p className="alert-error text-xs">{modalError}</p>}

          <div className="flex flex-wrap gap-2 pt-1">
            <button type="submit" disabled={busy || !canSave} className="btn-primary text-sm">
              {busy ? '…' : (isConfirm ? 'Подтвердить' : 'Сохранить')}
            </button>
            <button type="button" onClick={onClose} className="btn-secondary text-sm">
              Отмена
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
