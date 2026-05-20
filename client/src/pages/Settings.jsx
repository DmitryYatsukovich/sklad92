import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { settings as settingsApi } from '../api';
import Users from './Users';
import OrganizationsTab from './settings/OrganizationsTab';

const MAIN_TABS = [
  { id: 'organizations', label: 'Организации' },
  { id: 'objects', label: 'Объекты' },
  { id: 'warehouses', label: 'Склады' },
  { id: 'racks', label: 'Стеллажи' },
  { id: 'categories', label: 'Категории' },
  { id: 'work', label: 'Место проведения работ' },
];

const WORK_SUB_TABS = [
  { id: 'entrances', label: 'Подъезды' },
  { id: 'floors', label: 'Этажи' },
  { id: 'apartments', label: 'Квартиры' },
  { id: 'rooms', label: 'Помещения' },
];

const EMPTY_CATALOG = {
  objects: [],
  warehouses: [],
  racks: [],
  categories: [],
  work_entrances: [],
  work_floors: [],
  work_apartments: [],
  work_rooms: [],
};

function tabButtonClass(active, variant = 'main') {
  if (variant === 'work') {
    return active
      ? 'px-3 py-1.5 rounded-lg text-sm font-semibold bg-emerald-600 text-white shadow-sm ring-1 ring-emerald-400/40'
      : 'px-3 py-1.5 rounded-lg text-sm font-medium bg-zinc-800 text-zinc-100 border border-zinc-600 hover:bg-zinc-700 hover:text-white';
  }
  return active
    ? 'px-4 py-2 rounded-xl text-sm font-semibold bg-sky-600 text-white shadow-sm ring-1 ring-sky-400/40'
    : 'px-4 py-2 rounded-xl text-sm font-medium bg-zinc-800 text-zinc-100 border border-zinc-600 hover:bg-zinc-700 hover:text-white';
}

function SimpleList({ items, onEdit, onDelete, extraCol }) {
  if (!items.length) return <p className="text-zinc-500 text-sm py-4">Список пуст. Добавьте запись ниже.</p>;
  return (
    <div className="table-wrap">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-white/10 text-zinc-300">
            <th className="p-3 font-medium">Название</th>
            {extraCol && <th className="p-3 font-medium">{extraCol}</th>}
            <th className="p-3 w-28" />
          </tr>
        </thead>
        <tbody>
          {items.map((row) => (
            <tr key={row.id} className="border-b border-white/5">
              <td className="p-3 text-white">{row.name}</td>
              {extraCol && <td className="p-3 text-zinc-300">{row._extra || '—'}</td>}
              <td className="p-3 text-right space-x-2">
                <button type="button" onClick={() => onEdit(row)} className="text-sky-400 hover:text-sky-300 text-sm font-medium">
                  Изм.
                </button>
                <button type="button" onClick={() => onDelete(row)} className="text-rose-400 hover:text-rose-300 text-sm font-medium">
                  Удал.
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Settings({ user }) {
  const location = useLocation();
  const canCatalog = user?.role === 'admin' || !!user?.can_settings;
  const canUsers = user?.role === 'admin' || !!user?.can_users;
  const initialTab = location.state?.tab === 'users' && canUsers
    ? 'users'
    : (canCatalog ? 'objects' : 'users');
  const [tab, setTab] = useState(initialTab);
  const [workSubTab, setWorkSubTab] = useState('entrances');
  const [catalog, setCatalog] = useState(EMPTY_CATALOG);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [editing, setEditing] = useState(null);

  const load = useCallback(() => {
    settingsApi.catalog().then(setCatalog).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (tab !== 'users' && tab !== 'organizations') load();
  }, [load, tab]);

  useEffect(() => {
    if (location.state?.tab === 'users' && canUsers) setTab('users');
  }, [location.state?.tab, canUsers]);

  const resetForm = () => {
    setName('');
    setParentId('');
    setEditing(null);
    setError('');
  };

  const switchTab = (id) => {
    setTab(id);
    resetForm();
    if (id === 'work') setWorkSubTab('entrances');
  };

  const switchWorkSubTab = (id) => {
    setWorkSubTab(id);
    resetForm();
  };

  const effectiveWorkTab = tab === 'work' ? workSubTab : null;

  const itemsForTab = () => {
    if (tab === 'objects') return catalog.objects.map((o) => ({ ...o }));
    if (tab === 'warehouses') {
      return catalog.warehouses.map((w) => ({
        ...w,
        _extra: w.object_name || catalog.objects.find((o) => o.id === w.object_id)?.name,
      }));
    }
    if (tab === 'racks') {
      return catalog.racks.map((r) => ({
        ...r,
        _extra: r.warehouse_name || catalog.warehouses.find((w) => w.id === r.warehouse_id)?.name,
      }));
    }
    if (tab === 'categories') return catalog.categories.map((c) => ({ ...c }));

    if (effectiveWorkTab === 'entrances') {
      return catalog.work_entrances.map((x) => ({
        ...x,
        _extra: x.object_name || catalog.objects.find((o) => o.id === x.object_id)?.name,
      }));
    }
    if (effectiveWorkTab === 'floors') {
      return catalog.work_floors.map((f) => ({
        ...f,
        _extra: [f.object_name, f.entrance_name].filter(Boolean).join(' → ')
          || catalog.work_entrances.find((e) => e.id === f.entrance_id)?.name,
      }));
    }
    if (effectiveWorkTab === 'apartments') {
      return catalog.work_apartments.map((a) => ({
        ...a,
        _extra: [a.object_name, a.entrance_name, a.floor_name].filter(Boolean).join(' → ')
          || catalog.work_floors.find((f) => f.id === a.floor_id)?.name,
      }));
    }
    return catalog.work_rooms.map((r) => ({
      ...r,
      _extra: [r.object_name, r.entrance_name, r.floor_name, r.apartment_name].filter(Boolean).join(' → '),
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return setError('Укажите название');
    setError('');
    try {
      if (tab === 'objects') {
        if (editing) await settingsApi.objects.update(editing.id, { name: n });
        else await settingsApi.objects.create({ name: n });
      } else if (tab === 'warehouses') {
        const oid = parseInt(parentId, 10);
        if (!oid) return setError('Выберите объект');
        if (editing) await settingsApi.warehouses.update(editing.id, { name: n, object_id: oid });
        else await settingsApi.warehouses.create({ name: n, object_id: oid });
      } else if (tab === 'racks') {
        const wid = parseInt(parentId, 10);
        if (!wid) return setError('Выберите склад');
        if (editing) await settingsApi.racks.update(editing.id, { name: n, warehouse_id: wid });
        else await settingsApi.racks.create({ name: n, warehouse_id: wid });
      } else if (tab === 'categories') {
        if (editing) await settingsApi.categories.update(editing.id, { name: n });
        else await settingsApi.categories.create({ name: n });
      } else if (effectiveWorkTab === 'entrances') {
        const oid = parseInt(parentId, 10);
        if (!oid) return setError('Выберите объект');
        if (editing) await settingsApi.workEntrances.update(editing.id, { name: n, object_id: oid });
        else await settingsApi.workEntrances.create({ name: n, object_id: oid });
      } else if (effectiveWorkTab === 'floors') {
        const eid = parseInt(parentId, 10);
        if (!eid) return setError('Выберите подъезд');
        if (editing) await settingsApi.workFloors.update(editing.id, { name: n, entrance_id: eid });
        else await settingsApi.workFloors.create({ name: n, entrance_id: eid });
      } else if (effectiveWorkTab === 'apartments') {
        const fid = parseInt(parentId, 10);
        if (!fid) return setError('Выберите этаж');
        if (editing) await settingsApi.workApartments.update(editing.id, { name: n, floor_id: fid });
        else await settingsApi.workApartments.create({ name: n, floor_id: fid });
      } else if (effectiveWorkTab === 'rooms') {
        const aid = parseInt(parentId, 10);
        if (!aid) return setError('Выберите квартиру');
        if (editing) await settingsApi.workRooms.update(editing.id, { name: n, apartment_id: aid });
        else await settingsApi.workRooms.create({ name: n, apartment_id: aid });
      }
      resetForm();
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const startEdit = (row) => {
    setEditing(row);
    setName(row.name || '');
    if (tab === 'warehouses') setParentId(String(row.object_id || ''));
    else if (tab === 'racks') setParentId(String(row.warehouse_id || ''));
    else if (effectiveWorkTab === 'entrances') setParentId(String(row.object_id || ''));
    else if (effectiveWorkTab === 'floors') setParentId(String(row.entrance_id || ''));
    else if (effectiveWorkTab === 'apartments') setParentId(String(row.floor_id || ''));
    else if (effectiveWorkTab === 'rooms') setParentId(String(row.apartment_id || ''));
    else setParentId('');
  };

  const handleDelete = async (row) => {
    if (!confirm(`Удалить «${row.name}»?`)) return;
    setError('');
    try {
      if (tab === 'objects') await settingsApi.objects.delete(row.id);
      else if (tab === 'warehouses') await settingsApi.warehouses.delete(row.id);
      else if (tab === 'racks') await settingsApi.racks.delete(row.id);
      else if (tab === 'categories') await settingsApi.categories.delete(row.id);
      else if (effectiveWorkTab === 'entrances') await settingsApi.workEntrances.delete(row.id);
      else if (effectiveWorkTab === 'floors') await settingsApi.workFloors.delete(row.id);
      else if (effectiveWorkTab === 'apartments') await settingsApi.workApartments.delete(row.id);
      else if (effectiveWorkTab === 'rooms') await settingsApi.workRooms.delete(row.id);
      if (editing?.id === row.id) resetForm();
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const extraLabel = (() => {
    if (tab === 'warehouses') return 'Объект';
    if (tab === 'racks') return 'Склад';
    if (effectiveWorkTab === 'entrances') return 'Объект';
    if (effectiveWorkTab === 'floors') return 'Подъезд';
    if (effectiveWorkTab === 'apartments') return 'Этаж';
    if (effectiveWorkTab === 'rooms') return 'Квартира';
    return null;
  })();

  const formTitle = (() => {
    if (tab !== 'work') return editing ? 'Редактирование' : 'Добавить';
    const labels = { entrances: 'подъезд', floors: 'этаж', apartments: 'квартиру', rooms: 'помещение' };
    const what = labels[effectiveWorkTab] || 'запись';
    return editing ? `Редактирование: ${what}` : `Добавить ${what}`;
  })();

  const entranceOptionLabel = (e) => {
    const obj = e.object_name || catalog.objects.find((o) => o.id === e.object_id)?.name;
    return obj ? `${obj} → ${e.name}` : e.name;
  };

  const floorOptionLabel = (f) => {
    const ent = f.entrance_name || catalog.work_entrances.find((e) => e.id === f.entrance_id)?.name;
    const obj = f.object_name;
    if (obj && ent) return `${obj} → ${ent} → ${f.name}`;
    return ent ? `${ent} → ${f.name}` : f.name;
  };

  const apartmentOptionLabel = (a) => {
    const parts = [a.object_name, a.entrance_name, a.floor_name, a.name].filter(Boolean);
    if (parts.length >= 2) return parts.join(' → ');
    const floor = catalog.work_floors.find((f) => f.id === a.floor_id);
    if (floor) return `${floorOptionLabel(floor)} → ${a.name}`;
    return a.name;
  };

  const settingsTabs = (
    <div className="flex flex-wrap gap-2">
      {canUsers && (
        <button
          type="button"
          onClick={() => setTab('users')}
          className={tabButtonClass(tab === 'users')}
        >
          Пользователи
        </button>
      )}
      {canCatalog && MAIN_TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => switchTab(t.id)}
          className={tabButtonClass(tab === t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  if (tab === 'users' && canUsers) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="page-title">Настройка</h2>
        </div>
        {settingsTabs}
        <Users user={user} embedded />
      </div>
    );
  }

  if (tab === 'organizations' && canCatalog) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="page-title">Настройка</h2>
        </div>
        {settingsTabs}
        <OrganizationsTab />
      </div>
    );
  }

  if (!canCatalog) {
    return (
      <div className="space-y-6">
        <h2 className="page-title">Настройка</h2>
        {settingsTabs}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="page-title">Настройка</h2>
        <p className="text-zinc-400 text-sm mt-1">
          Справочники склада и мест проведения работ: объекты, склады, стеллажи, категории, подъезды, этажи, квартиры, помещения.
        </p>
      </div>

      {settingsTabs}

      {tab === 'work' && (
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-950/20 p-4 space-y-3">
          <p className="text-emerald-100/90 text-sm font-medium">Место проведения работ</p>
          <div className="flex flex-wrap gap-2">
            {WORK_SUB_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => switchWorkSubTab(t.id)}
                className={tabButtonClass(workSubTab === t.id, 'work')}
              >
                {t.label}
              </button>
            ))}
          </div>
          <p className="text-zinc-400 text-xs">
            Подъезды привязываются к объекту, затем этажи, квартиры и помещения — каждый уровень к родительскому.
          </p>
        </div>
      )}

      {error && <p className="text-rose-400 text-sm">{error}</p>}

      <SimpleList
        items={itemsForTab()}
        onEdit={startEdit}
        onDelete={handleDelete}
        extraCol={extraLabel}
      />

      <div className="rounded-xl border border-white/10 bg-surface-850 p-5 max-w-lg">
        <h3 className="text-white font-medium mb-4">{formTitle}</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          {tab === 'warehouses' && (
            <div>
              <label className="label">Объект</label>
              <select value={parentId} onChange={(e) => setParentId(e.target.value)} className="input" required>
                <option value="">— Выберите —</option>
                {catalog.objects.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>
          )}
          {tab === 'racks' && (
            <div>
              <label className="label">Склад</label>
              <select value={parentId} onChange={(e) => setParentId(e.target.value)} className="input" required>
                <option value="">— Выберите —</option>
                {catalog.warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.object_name ? `${w.object_name} → ` : ''}{w.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {effectiveWorkTab === 'entrances' && (
            <div>
              <label className="label">Объект</label>
              <select value={parentId} onChange={(e) => setParentId(e.target.value)} className="input" required>
                <option value="">— Выберите —</option>
                {catalog.objects.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>
          )}
          {effectiveWorkTab === 'floors' && (
            <div>
              <label className="label">Подъезд</label>
              <select value={parentId} onChange={(e) => setParentId(e.target.value)} className="input" required>
                <option value="">— Выберите —</option>
                {catalog.work_entrances.map((e) => (
                  <option key={e.id} value={e.id}>{entranceOptionLabel(e)}</option>
                ))}
              </select>
            </div>
          )}
          {effectiveWorkTab === 'apartments' && (
            <div>
              <label className="label">Этаж</label>
              <select value={parentId} onChange={(e) => setParentId(e.target.value)} className="input" required>
                <option value="">— Выберите —</option>
                {catalog.work_floors.map((f) => (
                  <option key={f.id} value={f.id}>{floorOptionLabel(f)}</option>
                ))}
              </select>
            </div>
          )}
          {effectiveWorkTab === 'rooms' && (
            <div>
              <label className="label">Квартира</label>
              <select value={parentId} onChange={(e) => setParentId(e.target.value)} className="input" required>
                <option value="">— Выберите —</option>
                {catalog.work_apartments.map((a) => (
                  <option key={a.id} value={a.id}>{apartmentOptionLabel(a)}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="label">Название</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input"
              required
            />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary text-sm">
              {editing ? 'Сохранить' : 'Добавить'}
            </button>
            {editing && (
              <button type="button" onClick={resetForm} className="btn-secondary text-sm">
                Отмена
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
