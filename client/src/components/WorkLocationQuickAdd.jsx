import { useState } from 'react';
import { reports } from '../api';

const SUB_TABS = [
  { id: 'entrances', label: 'Подъезд' },
  { id: 'floors', label: 'Этаж' },
  { id: 'apartments', label: 'Квартира' },
  { id: 'rooms', label: 'Помещение' },
];

function entranceLabel(e, objects) {
  const obj = e.object_name || objects.find((o) => o.id === e.object_id)?.name;
  return obj ? `${obj} → ${e.name}` : e.name;
}

function floorLabel(f, catalog) {
  const ent = f.entrance_name
    || catalog.work_entrances.find((e) => e.id === f.entrance_id)?.name;
  const obj = f.object_name;
  if (obj && ent) return `${obj} → ${ent} → ${f.name}`;
  return ent ? `${ent} → ${f.name}` : f.name;
}

function apartmentLabel(a, catalog) {
  const parts = [a.object_name, a.entrance_name, a.floor_name, a.name].filter(Boolean);
  if (parts.length >= 2) return parts.join(' → ');
  const floor = catalog.work_floors.find((f) => f.id === a.floor_id);
  return floor ? `${floorLabel(floor, catalog)} → ${a.name}` : a.name;
}

export default function WorkLocationQuickAdd({ catalog, onRefresh, compact = false }) {
  const [subTab, setSubTab] = useState('entrances');
  const [name, setName] = useState('');
  const [objectId, setObjectId] = useState('');
  const [entranceId, setEntranceId] = useState('');
  const [floorId, setFloorId] = useState('');
  const [apartmentId, setApartmentId] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setName('');
    setError('');
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return setError('Укажите название');
    setSaving(true);
    setError('');
    try {
      if (subTab === 'entrances') {
        const oid = parseInt(objectId, 10);
        if (!oid) throw new Error('Выберите объект');
        await reports.addWorkEntrance({ object_id: oid, name: n });
      } else if (subTab === 'floors') {
        const eid = parseInt(entranceId, 10);
        if (!eid) throw new Error('Выберите подъезд');
        await reports.addWorkFloor({ entrance_id: eid, name: n });
      } else if (subTab === 'apartments') {
        const fid = parseInt(floorId, 10);
        if (!fid) throw new Error('Выберите этаж');
        await reports.addWorkApartment({ floor_id: fid, name: n });
      } else {
        const aid = parseInt(apartmentId, 10);
        if (!aid) throw new Error('Выберите квартиру');
        await reports.addWorkRoom({ apartment_id: aid, name: n });
      }
      reset();
      onRefresh?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={compact ? 'space-y-3' : 'rounded-xl border border-white/10 bg-surface-850 p-4 space-y-3'}>
      <p className={compact ? 'text-zinc-400 text-xs' : 'text-white text-sm font-medium'}>
        {compact ? 'Добавить в справочник' : 'Добавить место проведения работ'}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {SUB_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => { setSubTab(t.id); reset(); }}
            className={
              subTab === t.id
                ? 'px-2.5 py-1 rounded-md text-2xs font-semibold bg-emerald-600 text-white'
                : 'px-2.5 py-1 rounded-md text-2xs font-medium bg-zinc-800 text-zinc-100 border border-zinc-600 hover:bg-zinc-700'
            }
          >
            {t.label}
          </button>
        ))}
      </div>
      {error && <p className="text-rose-400 text-2xs">{error}</p>}
      <form onSubmit={handleAdd} className="space-y-2">
        {subTab === 'entrances' && (
          <select value={objectId} onChange={(e) => setObjectId(e.target.value)} className="input text-xs" required>
            <option value="">Объект</option>
            {catalog.objects.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        )}
        {subTab === 'floors' && (
          <select value={entranceId} onChange={(e) => setEntranceId(e.target.value)} className="input text-xs" required>
            <option value="">Подъезд</option>
            {catalog.work_entrances.map((ent) => (
              <option key={ent.id} value={ent.id}>{entranceLabel(ent, catalog.objects)}</option>
            ))}
          </select>
        )}
        {subTab === 'apartments' && (
          <select value={floorId} onChange={(e) => setFloorId(e.target.value)} className="input text-xs" required>
            <option value="">Этаж</option>
            {catalog.work_floors.map((f) => (
              <option key={f.id} value={f.id}>{floorLabel(f, catalog)}</option>
            ))}
          </select>
        )}
        {subTab === 'rooms' && (
          <select value={apartmentId} onChange={(e) => setApartmentId(e.target.value)} className="input text-xs" required>
            <option value="">Квартира</option>
            {catalog.work_apartments.map((a) => (
              <option key={a.id} value={a.id}>{apartmentLabel(a, catalog)}</option>
            ))}
          </select>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input text-xs flex-1"
            placeholder="Название"
            required
          />
          <button type="submit" disabled={saving} className="btn-primary text-2xs shrink-0">
            {saving ? '…' : 'Добавить'}
          </button>
        </div>
      </form>
    </div>
  );
}
