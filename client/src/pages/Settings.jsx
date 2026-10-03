import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { settings as settingsApi } from '../api';
import Users from './Users';
import RolesTab from '../settings/RolesTab';
import OrganizationsTab from './settings/OrganizationsTab';
import {
  canAccessSettingsTab,
  getFirstSettingsTab,
  hasAnySettingsAccess,
  SETTINGS_TAB_PERMISSIONS,
} from '../lib/settingsPermissions.js';

const MAIN_TABS = [
  { id: 'organizations', label: 'Организации', perm: SETTINGS_TAB_PERMISSIONS.organizations },
  { id: 'warehouses', label: 'Склады', perm: SETTINGS_TAB_PERMISSIONS.warehouses },
  { id: 'categories', label: 'Категории', perm: SETTINGS_TAB_PERMISSIONS.categories },
  { id: 'systems', label: 'Система', perm: SETTINGS_TAB_PERMISSIONS.systems },
  { id: 'work', label: 'Место проведения работ', perm: SETTINGS_TAB_PERMISSIONS.work },
  { id: 'tools', label: 'Виды инструмента', perm: SETTINGS_TAB_PERMISSIONS.tools },
];

const WAREHOUSE_SUB_TABS = [
  { id: 'warehouses', label: 'Склады' },
  { id: 'storage', label: 'Место хранения' },
];

const WORK_SUB_TABS = [
  { id: 'objects', label: 'Объекты' },
  { id: 'entrances', label: 'Подъезды' },
  { id: 'floors', label: 'Этажи' },
  { id: 'apartments', label: 'Квартиры, помещения' },
];

const EMPTY_CATALOG = {
  objects: [],
  warehouses: [],
  racks: [],
  categories: [],
  systems: [],
  organizations: [],
  work_entrances: [],
  work_floors: [],
  work_apartments: [],
  work_rooms: [],
  tool_types: [],
};
const FLOOR_ROOMS_BUCKET_NAME = 'Помещения этажа';

function isRowObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asArrayOfObjects(value) {
  return Array.isArray(value)
    ? value.filter((row) => isRowObject(row))
    : [];
}

function normalizeCatalog(value) {
  const safe = isRowObject(value) ? value : {};
  return {
    objects: asArrayOfObjects(safe.objects),
    warehouses: asArrayOfObjects(safe.warehouses),
    racks: asArrayOfObjects(safe.racks),
    categories: asArrayOfObjects(safe.categories),
    systems: asArrayOfObjects(safe.systems),
    organizations: asArrayOfObjects(safe.organizations),
    work_entrances: asArrayOfObjects(safe.work_entrances),
    work_floors: asArrayOfObjects(safe.work_floors),
    work_apartments: asArrayOfObjects(safe.work_apartments),
    work_rooms: asArrayOfObjects(safe.work_rooms),
    tool_types: asArrayOfObjects(safe.tool_types),
  };
}

function tabButtonClass(active, variant = 'main') {
  if (variant === 'work' || variant === 'warehouse') {
    return active
      ? variant === 'work'
        ? 'px-3 py-1.5 rounded-lg text-sm font-semibold bg-emerald-600 text-white shadow-sm ring-1 ring-emerald-400/40'
        : 'px-3 py-1.5 rounded-lg text-sm font-semibold bg-sky-600 text-white shadow-sm ring-1 ring-sky-400/40'
      : 'px-3 py-1.5 rounded-lg text-sm font-medium bg-zinc-800 text-zinc-100 border border-zinc-600 hover:bg-zinc-700 hover:text-white';
  }
  return active
    ? 'px-4 py-2 rounded-xl text-sm font-semibold bg-sky-600 text-white shadow-sm ring-1 ring-sky-400/40'
    : 'px-4 py-2 rounded-xl text-sm font-medium bg-zinc-800 text-zinc-100 border border-zinc-600 hover:bg-zinc-700 hover:text-white';
}

function naturalCompare(a, b) {
  return String(a || '').localeCompare(String(b || ''), 'ru', { numeric: true, sensitivity: 'base' });
}

function sortByNaturalName(items) {
  return [...items].sort((a, b) => naturalCompare(a?.name, b?.name));
}

const CATEGORY_ICON_OPTIONS = [
  { key: 'electrical', label: 'Электромонтаж', hint: 'Кабели, щиты, питание' },
  { key: 'fire_alarm', label: 'Пожарная сигнализация', hint: 'Датчики, сирены, шлейфы' },
  { key: 'access_control', label: 'СКУД', hint: 'Контроллеры, замки, карты' },
  { key: 'video_surveillance', label: 'Видеонаблюдение', hint: 'Камеры и регистраторы' },
  { key: 'dispatching', label: 'Диспетчеризация', hint: 'Мониторинг и управление' },
];

const CATEGORY_ICON_META = {
  electrical: {
    label: 'Электромонтаж',
    badgeClass: 'bg-sky-500/15 text-sky-300 ring-sky-400/35',
  },
  fire_alarm: {
    label: 'Пожарная сигнализация',
    badgeClass: 'bg-rose-500/15 text-rose-300 ring-rose-400/35',
  },
  access_control: {
    label: 'СКУД',
    badgeClass: 'bg-violet-500/15 text-violet-300 ring-violet-400/35',
  },
  video_surveillance: {
    label: 'Видеонаблюдение',
    badgeClass: 'bg-cyan-500/15 text-cyan-300 ring-cyan-400/35',
  },
  dispatching: {
    label: 'Диспетчеризация',
    badgeClass: 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/35',
  },
  other: {
    label: 'Прочая категория',
    badgeClass: 'bg-zinc-500/20 text-zinc-200 ring-zinc-400/30',
  },
};

function inferCategoryIconKey(name) {
  const source = String(name || '').toLowerCase();
  if (/пожар|дым|огнет|сирен|оповещ|извещ/.test(source)) return 'fire_alarm';
  if (/скуд|доступ|турникет|замок|карта|контрол/.test(source)) return 'access_control';
  if (/видео|камер|cctv|наблюд|регистрат/.test(source)) return 'video_surveillance';
  if (/диспет|монитор|автоматизац|телеметр|управ/.test(source)) return 'dispatching';
  if (/элект|кабел|провод|щит|розет|питан|автомат|узо/.test(source)) return 'electrical';
  return 'other';
}

function resolveCategoryMiniature({ name, icon_key }) {
  const preferred = String(icon_key || '').trim();
  const key = CATEGORY_ICON_META[preferred] ? preferred : inferCategoryIconKey(name);
  const meta = CATEGORY_ICON_META[key] || CATEGORY_ICON_META.other;
  return {
    key,
    label: meta.label,
    badgeClass: meta.badgeClass,
  };
}

function CategoryGlyph({ iconKey, className = 'h-4 w-4' }) {
  if (iconKey === 'electrical') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
        <path d="M13 2L5 13h6l-1 9 9-13h-6l1-7z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    );
  }
  if (iconKey === 'fire_alarm') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
        <path d="M12 3c2 2 3 4 3 6 0 1.5-.5 2.7-1.6 3.8C12.2 14 12 15 12 16c0-1.2-.5-2.2-1.7-3.2C9.2 11.7 9 10.5 9 9c0-2 1-4 3-6z" stroke="currentColor" strokeWidth="1.7" />
        <path d="M7 16c0 2.8 2.2 5 5 5s5-2.2 5-5c0-1.1-.3-2.2-1-3.1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (iconKey === 'access_control') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
        <rect x="4" y="5" width="12" height="14" rx="2" stroke="currentColor" strokeWidth="1.7" />
        <path d="M8 9h4M8 12h5M8 15h3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M17 12h3m-1.5-1.5L20 12l-1.5 1.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (iconKey === 'video_surveillance') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
        <path d="M3 10h12l3 3v3H6l-3-3v-3z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        <path d="M15 10l4-2v2.5M8 16v2M12 16v2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (iconKey === 'dispatching') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
        <rect x="3" y="5" width="8" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
        <rect x="13" y="5" width="8" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
        <rect x="3" y="13" width="18" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
        <path d="M7 8h1M17 8h1M7 16h10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <path d="M4 8l8-4 8 4-8 4-8-4z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M4 8v8l8 4 8-4V8" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function SimpleList({ items, onEdit, onDelete, extraCol, renderActions, renderTitleLeading }) {
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
              <td className="p-3 text-white">
                <div className="flex items-center gap-2">
                  {renderTitleLeading?.(row)}
                  <span>{row._displayName || row.name}</span>
                </div>
              </td>
              {extraCol && <td className="p-3 text-zinc-300">{row._extra || '—'}</td>}
              <td className="p-3">
                <div className="flex items-center justify-end gap-2">
                  {renderActions?.(row)}
                <button type="button" onClick={() => onEdit(row)} className="text-sky-400 hover:text-sky-300 text-sm font-medium">
                  Изм.
                </button>
                <button type="button" onClick={() => onDelete(row)} className="text-rose-400 hover:text-rose-300 text-sm font-medium">
                  Удал.
                </button>
                </div>
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
  const canUsers = canAccessSettingsTab(user, SETTINGS_TAB_PERMISSIONS.users);
  const canRoles = canAccessSettingsTab(user, SETTINGS_TAB_PERMISSIONS.roles);
  const visibleMainTabs = MAIN_TABS.filter((t) => canAccessSettingsTab(user, t.perm));
  const canOrganizations = canAccessSettingsTab(user, SETTINGS_TAB_PERMISSIONS.organizations);

  const resolveInitialTab = () => {
    const loc = location.state?.tab;
    if (loc === 'users' && canUsers) return 'users';
    if (loc === 'roles' && canRoles) return 'roles';
    if (loc && MAIN_TABS.some((t) => t.id === loc) && canAccessSettingsTab(user, SETTINGS_TAB_PERMISSIONS[loc])) {
      return loc;
    }
    return getFirstSettingsTab(user) || 'users';
  };

  const [tab, setTab] = useState(resolveInitialTab);
  const [warehouseSubTab, setWarehouseSubTab] = useState('warehouses');
  const [workSubTab, setWorkSubTab] = useState('objects');
  const [catalog, setCatalog] = useState(EMPTY_CATALOG);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [categoryIconKey, setCategoryIconKey] = useState('');
  const [parentId, setParentId] = useState('');
  const [sortOrder, setSortOrder] = useState('');
  const [workItemKind, setWorkItemKind] = useState('apartment');
  const [workModalOpen, setWorkModalOpen] = useState(false);
  const [modalFloorId, setModalFloorId] = useState('');
  const [modalApartmentId, setModalApartmentId] = useState('');
  const [editing, setEditing] = useState(null);
  const formCardRef = useRef(null);
  const nameInputRef = useRef(null);

  const load = useCallback(() => {
    settingsApi.catalog()
      .then((data) => setCatalog(normalizeCatalog(data)))
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (tab !== 'users' && tab !== 'roles' && tab !== 'organizations') load();
  }, [load, tab]);

  useEffect(() => {
    const loc = location.state?.tab;
    if (loc === 'users' && canUsers) setTab('users');
    else if (loc === 'roles' && canRoles) setTab('roles');
    else if (loc && canAccessSettingsTab(user, SETTINGS_TAB_PERMISSIONS[loc])) setTab(loc);
  }, [location.state?.tab, canUsers, canRoles, user]);

  useEffect(() => {
    const allowed =
      (tab === 'users' && canUsers)
      || (tab === 'roles' && canRoles)
      || (tab === 'organizations' && canOrganizations)
      || visibleMainTabs.some((t) => t.id === tab);
    if (!allowed) {
      const next = getFirstSettingsTab(user);
      if (next) setTab(next);
    }
  }, [tab, user, canUsers, canRoles, canOrganizations, visibleMainTabs]);

  const resetForm = () => {
    setName('');
    setCategoryIconKey('');
    setParentId('');
    setSortOrder('');
    setWorkItemKind('apartment');
    setEditing(null);
    setError('');
  };

  const switchTab = (id) => {
    setTab(id);
    resetForm();
    if (id === 'warehouses') setWarehouseSubTab('warehouses');
    if (id === 'work') setWorkSubTab('objects');
  };

  const switchWarehouseSubTab = (id) => {
    setWarehouseSubTab(id);
    resetForm();
  };

  const switchWorkSubTab = (id) => {
    setWorkSubTab(id);
    resetForm();
  };

  const effectiveWarehouseTab = tab === 'warehouses' ? warehouseSubTab : null;
  const effectiveWorkTab = tab === 'work' ? workSubTab : null;

  const itemsForTab = () => {
    const sortedObjects = sortByNaturalName(catalog.objects);
    const sortedEntrances = [...catalog.work_entrances].sort((a, b) => (
      naturalCompare(a.object_name, b.object_name)
      || naturalCompare(a.name, b.name)
    ));
    const sortedFloors = [...catalog.work_floors].sort((a, b) => (
      naturalCompare(a.object_name, b.object_name)
      || naturalCompare(a.entrance_name, b.entrance_name)
      || ((a.sort_order ?? Number.MAX_SAFE_INTEGER) - (b.sort_order ?? Number.MAX_SAFE_INTEGER))
      || naturalCompare(a.name, b.name)
    ));
    const sortedApartments = [...catalog.work_apartments].sort((a, b) => (
      naturalCompare(a.object_name, b.object_name)
      || naturalCompare(a.entrance_name, b.entrance_name)
      || ((a.floor_sort_order ?? Number.MAX_SAFE_INTEGER) - (b.floor_sort_order ?? Number.MAX_SAFE_INTEGER))
      || naturalCompare(a.floor_name, b.floor_name)
      || naturalCompare(a.name, b.name)
    ));
    const sortedRooms = [...catalog.work_rooms].sort((a, b) => (
      naturalCompare(a.object_name, b.object_name)
      || naturalCompare(a.entrance_name, b.entrance_name)
      || ((a.floor_sort_order ?? Number.MAX_SAFE_INTEGER) - (b.floor_sort_order ?? Number.MAX_SAFE_INTEGER))
      || naturalCompare(a.floor_name, b.floor_name)
      || naturalCompare(a.apartment_name, b.apartment_name)
      || naturalCompare(a.name, b.name)
    ));

    if (effectiveWarehouseTab === 'warehouses') {
      return catalog.warehouses.map((w) => ({
        ...w,
        _extra: w.object_name || catalog.objects.find((o) => o.id === w.object_id)?.name,
      }));
    }
    if (effectiveWarehouseTab === 'storage') {
      return catalog.racks.map((r) => ({
        ...r,
        _extra: r.warehouse_name || catalog.warehouses.find((w) => w.id === r.warehouse_id)?.name,
      }));
    }
    if (tab === 'systems') return catalog.systems.map((s) => ({ ...s }));
    if (tab === 'tools') return catalog.tool_types.map((t) => ({ ...t }));
    if (tab === 'categories') return catalog.categories.map((c) => ({
      ...c,
      _miniature: resolveCategoryMiniature(c),
    }));

    if (effectiveWorkTab === 'objects') {
      return sortedObjects.map((o) => ({ ...o }));
    }
    if (effectiveWorkTab === 'entrances') {
      return sortedEntrances.map((x) => ({
        ...x,
        _extra: x.object_name || catalog.objects.find((o) => o.id === x.object_id)?.name,
      }));
    }
    if (effectiveWorkTab === 'floors') {
      return sortedFloors.map((f) => ({
        ...f,
        _extra: [f.object_name, f.entrance_name].filter(Boolean).join(' → ')
          || catalog.work_entrances.find((e) => e.id === f.entrance_id)?.name,
      }));
    }
    if (effectiveWorkTab === 'apartments') {
      return sortedApartments.map((a) => ({
        ...a,
        _extra: [a.object_name, a.entrance_name, a.floor_name].filter(Boolean).join(' → ')
          || catalog.work_floors.find((f) => f.id === a.floor_id)?.name,
      }));
    }
    return sortedRooms.map((r) => ({
      ...r,
      _extra: [r.object_name, r.entrance_name, r.floor_name, r.apartment_name].filter(Boolean).join(' → '),
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return setError('Укажите название');
    const sortRaw = sortOrder.trim();
    const sortValue = sortRaw ? Number.parseInt(sortRaw, 10) : null;
    if (sortRaw && (!Number.isFinite(sortValue) || sortValue <= 0)) {
      return setError('Порядок должен быть положительным числом');
    }
    setError('');
    try {
      if (effectiveWorkTab === 'objects') {
        if (editing) await settingsApi.objects.update(editing.id, { name: n });
        else await settingsApi.objects.create({ name: n });
      } else if (effectiveWarehouseTab === 'warehouses') {
        const oid = parseInt(parentId, 10);
        if (!oid) return setError('Выберите объект');
        if (editing) await settingsApi.warehouses.update(editing.id, { name: n, object_id: oid });
        else await settingsApi.warehouses.create({ name: n, object_id: oid });
      } else if (effectiveWarehouseTab === 'storage') {
        const wid = parseInt(parentId, 10);
        if (!wid) return setError('Выберите склад');
        if (editing) await settingsApi.racks.update(editing.id, { name: n, warehouse_id: wid });
        else await settingsApi.racks.create({ name: n, warehouse_id: wid });
      } else if (tab === 'categories') {
        const payload = { name: n, icon_key: categoryIconKey || null };
        if (editing) await settingsApi.categories.update(editing.id, payload);
        else await settingsApi.categories.create(payload);
      } else if (tab === 'systems') {
        if (editing) await settingsApi.systems.update(editing.id, { name: n });
        else await settingsApi.systems.create({ name: n });
      } else if (tab === 'tools') {
        if (editing) await settingsApi.toolTypes.update(editing.id, { name: n });
        else await settingsApi.toolTypes.create({ name: n });
      } else if (effectiveWorkTab === 'entrances') {
        const oid = parseInt(parentId, 10);
        if (!oid) return setError('Выберите объект');
        if (editing) await settingsApi.workEntrances.update(editing.id, { name: n, object_id: oid });
        else await settingsApi.workEntrances.create({ name: n, object_id: oid });
      } else if (effectiveWorkTab === 'floors') {
        const eid = parseInt(parentId, 10);
        if (!eid) return setError('Выберите подъезд');
        const payload = { name: n, entrance_id: eid, ...(sortValue ? { sort_order: sortValue } : {}) };
        if (editing) await settingsApi.workFloors.update(editing.id, payload);
        else await settingsApi.workFloors.create(payload);
      } else if (effectiveWorkTab === 'apartments') {
        if (workItemKind === 'room') {
          const floorId = parseInt(modalFloorId, 10);
          if (!floorId) return setError('Выберите этаж');
          let apartmentId = parseInt(modalApartmentId, 10);
          if (!apartmentId) {
            let bucket = catalog.work_apartments.find((a) => a.floor_id === floorId && a.name === FLOOR_ROOMS_BUCKET_NAME);
            if (!bucket) {
              bucket = await settingsApi.workApartments.create({ name: FLOOR_ROOMS_BUCKET_NAME, floor_id: floorId });
            }
            apartmentId = bucket?.id;
          }
          if (!apartmentId) return setError('Не удалось определить квартиру для помещения');
          if (editing) await settingsApi.workRooms.update(editing.id, { name: n, apartment_id: apartmentId });
          else await settingsApi.workRooms.create({ name: n, apartment_id: apartmentId });
        } else {
          const fid = parseInt(modalFloorId, 10);
          if (!fid) return setError('Выберите этаж');
          if (editing) await settingsApi.workApartments.update(editing.id, { name: n, floor_id: fid });
          else await settingsApi.workApartments.create({ name: n, floor_id: fid });
        }
      }
      if (effectiveWorkTab === 'apartments') closeWorkModal();
      else resetForm();
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const startEdit = (row) => {
    setEditing(row);
    setName(row.name || '');
    setSortOrder('');
    setCategoryIconKey('');
    if (effectiveWarehouseTab === 'warehouses') setParentId(String(row.object_id || ''));
    else if (effectiveWarehouseTab === 'storage') setParentId(String(row.warehouse_id || ''));
    else if (effectiveWorkTab === 'entrances') setParentId(String(row.object_id || ''));
    else if (effectiveWorkTab === 'floors') {
      setParentId(String(row.entrance_id || ''));
      setSortOrder(row.sort_order != null ? String(row.sort_order) : '');
    }
    else if (effectiveWorkTab === 'apartments') {
      if (row._kind === 'room' || row.apartment_id) {
        setWorkItemKind('room');
        setParentId(String(row.apartment_id || ''));
      } else {
        setWorkItemKind('apartment');
        setParentId(String(row.floor_id || ''));
      }
    }
    else if (tab === 'categories') {
      setParentId('');
      setCategoryIconKey(row.icon_key || '');
    }
    else setParentId('');
  };

  const handleDelete = async (row) => {
    if (!confirm(`Удалить «${row.name}»?`)) return;
    setError('');
    try {
      if (effectiveWorkTab === 'objects') await settingsApi.objects.delete(row.id);
      else if (effectiveWarehouseTab === 'warehouses') await settingsApi.warehouses.delete(row.id);
      else if (effectiveWarehouseTab === 'storage') await settingsApi.racks.delete(row.id);
      else if (tab === 'categories') await settingsApi.categories.delete(row.id);
      else if (tab === 'systems') await settingsApi.systems.delete(row.id);
      else if (tab === 'tools') await settingsApi.toolTypes.delete(row.id);
      else if (effectiveWorkTab === 'entrances') await settingsApi.workEntrances.delete(row.id);
      else if (effectiveWorkTab === 'floors') await settingsApi.workFloors.delete(row.id);
      else if (effectiveWorkTab === 'apartments') {
        if (row._kind === 'room' || row.apartment_id) await settingsApi.workRooms.delete(row.id);
        else await settingsApi.workApartments.delete(row.id);
      }
      if (editing?.id === row.id) resetForm();
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleMoveFloor = async (row, direction) => {
    setError('');
    try {
      await settingsApi.workFloors.move(row.id, direction);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const extraLabel = (() => {
    if (effectiveWarehouseTab === 'warehouses') return 'Объект';
    if (effectiveWarehouseTab === 'storage') return 'Склад';
    if (effectiveWorkTab === 'entrances') return 'Объект';
    if (effectiveWorkTab === 'floors') return 'Подъезд';
    if (effectiveWorkTab === 'apartments') return workItemKind === 'room' ? 'Квартира' : 'Этаж';
    return null;
  })();

  const formTitle = (() => {
    if (tab === 'warehouses') {
      const labels = { warehouses: 'склад', storage: 'место хранения' };
      const what = labels[effectiveWarehouseTab] || 'запись';
      return editing ? `Редактирование: ${what}` : `Добавить ${what}`;
    }
    if (tab === 'systems') return editing ? 'Редактирование: система' : 'Добавить систему';
    if (tab === 'tools') return editing ? 'Редактирование: вид инструмента' : 'Добавить вид инструмента';
    if (tab !== 'work') return editing ? 'Редактирование' : 'Добавить';
    const labels = {
      objects: 'объект',
      entrances: 'подъезд',
      floors: 'этаж',
      apartments: workItemKind === 'room' ? 'помещение' : 'квартиру',
    };
    const what = labels[effectiveWorkTab] || 'запись';
    return editing ? `Редактирование: ${what}` : `Добавить ${what}`;
  })();
  const categoryAutoMiniature = resolveCategoryMiniature({ name, icon_key: null });
  const categorySelectedMiniature = resolveCategoryMiniature({ name, icon_key: categoryIconKey || null });

  const entranceOptionLabel = (e) => {
    const obj = e.object_name || catalog.objects.find((o) => o.id === e.object_id)?.name;
    return obj ? `${obj} → ${e.name}` : e.name;
  };

  const floorOptionLabel = (f) => {
    const floorName = f.name;
    const ent = f.entrance_name || catalog.work_entrances.find((e) => e.id === f.entrance_id)?.name;
    const obj = f.object_name;
    if (obj && ent) return `${obj} → ${ent} → ${floorName}`;
    return ent ? `${ent} → ${floorName}` : floorName;
  };

  const apartmentOptionLabel = (a) => {
    const parts = [a.object_name, a.entrance_name, a.floor_name].filter(Boolean);
    const apartmentName = a._withPrefix ? `Кв. ${a.name}` : a.name;
    if (parts.length >= 1) return `${parts.join(' → ')} → ${apartmentName}`;
    const floor = catalog.work_floors.find((f) => f.id === a.floor_id);
    if (floor) return `${floorOptionLabel(floor)} → ${apartmentName}`;
    return apartmentName;
  };

  const sortedWorkObjects = sortByNaturalName(catalog.objects);
  const sortedWorkEntrances = [...catalog.work_entrances].sort((a, b) => (
    naturalCompare(a.object_name, b.object_name) || naturalCompare(a.name, b.name)
  ));
  const sortedWorkFloors = [...catalog.work_floors].sort((a, b) => (
    naturalCompare(a.object_name, b.object_name)
    || naturalCompare(a.entrance_name, b.entrance_name)
    || ((a.sort_order ?? Number.MAX_SAFE_INTEGER) - (b.sort_order ?? Number.MAX_SAFE_INTEGER))
    || naturalCompare(a.name, b.name)
  ));
  const sortedWorkApartments = [...catalog.work_apartments].sort((a, b) => (
    naturalCompare(a.object_name, b.object_name)
    || naturalCompare(a.entrance_name, b.entrance_name)
    || ((a.floor_sort_order ?? Number.MAX_SAFE_INTEGER) - (b.floor_sort_order ?? Number.MAX_SAFE_INTEGER))
    || naturalCompare(a.floor_name, b.floor_name)
    || naturalCompare(a.name, b.name)
  ));
  const sortedWorkRooms = [...catalog.work_rooms].sort((a, b) => (
    naturalCompare(a.object_name, b.object_name)
    || naturalCompare(a.entrance_name, b.entrance_name)
    || ((a.floor_sort_order ?? Number.MAX_SAFE_INTEGER) - (b.floor_sort_order ?? Number.MAX_SAFE_INTEGER))
    || naturalCompare(a.floor_name, b.floor_name)
    || naturalCompare(a.apartment_name, b.apartment_name)
    || naturalCompare(a.name, b.name)
  ));
  const floorsByEntrance = sortedWorkEntrances.map((entrance) => ({
    entrance,
    floors: sortedWorkFloors.filter((f) => f.entrance_id === entrance.id),
  }));
  const floorById = Object.fromEntries(sortedWorkFloors.map((f) => [f.id, f]));
  const apartmentFloorMap = Object.fromEntries(sortedWorkApartments.map((a) => [a.id, a.floor_id]));
  const apartmentsByFloorId = sortedWorkApartments.reduce((acc, apartment) => {
    const floorId = apartment.floor_id;
    if (!acc[floorId]) acc[floorId] = [];
    acc[floorId].push(apartment);
    return acc;
  }, {});
  const roomsByApartmentId = sortedWorkRooms.reduce((acc, room) => {
    const apartmentId = room.apartment_id;
    if (!acc[apartmentId]) acc[apartmentId] = [];
    acc[apartmentId].push(room);
    return acc;
  }, {});
  const modalRoomApartmentOptions = modalFloorId
    ? sortedWorkApartments.filter((a) => a.floor_id === parseInt(modalFloorId, 10) && a.name !== FLOOR_ROOMS_BUCKET_NAME)
    : [];

  useEffect(() => {
    if (!workModalOpen || workItemKind !== 'room') return;
    const selectedApartmentId = parseInt(modalApartmentId, 10);
    const selectedFloorId = parseInt(modalFloorId, 10);
    if (!selectedApartmentId || !selectedFloorId) return;
    if (apartmentFloorMap[selectedApartmentId] !== selectedFloorId) {
      setModalApartmentId('');
    }
  }, [workModalOpen, workItemKind, modalApartmentId, modalFloorId, apartmentFloorMap]);

  const focusForm = () => {
    if (typeof window === 'undefined') return;
    window.requestAnimationFrame(() => {
      formCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      nameInputRef.current?.focus();
    });
  };

  const closeWorkModal = () => {
    setWorkModalOpen(false);
    setWorkItemKind('apartment');
    setEditing(null);
    setName('');
    setModalFloorId('');
    setModalApartmentId('');
    setError('');
  };

  const startAddFloorForEntrance = (entranceId, floorsCount = 0) => {
    setEditing(null);
    setName('');
    setSortOrder(String((floorsCount || 0) + 1));
    setParentId(String(entranceId || ''));
    setError('');
    focusForm();
  };

  const startAddApartmentForFloor = (floorId) => {
    setWorkModalOpen(true);
    setWorkItemKind('apartment');
    setEditing(null);
    setName('');
    setSortOrder('');
    setModalFloorId(String(floorId || ''));
    setModalApartmentId('');
    setError('');
  };

  const startAddRoomForFloor = (floorId) => {
    setWorkModalOpen(true);
    setWorkItemKind('room');
    setEditing(null);
    setName('');
    setSortOrder('');
    setModalFloorId(String(floorId || ''));
    setModalApartmentId('');
    setError('');
  };

  const startAddRoomForApartment = (apartmentId, floorIdFromRow = null) => {
    const floorId = floorIdFromRow || apartmentFloorMap[apartmentId] || '';
    setWorkModalOpen(true);
    setWorkItemKind('room');
    setEditing(null);
    setName('');
    setSortOrder('');
    setModalFloorId(String(floorId || ''));
    setModalApartmentId(String(apartmentId || ''));
    setError('');
  };

  const startEditApartmentOrRoom = (row, kind) => {
    setWorkModalOpen(true);
    setEditing({ ...row, _kind: kind });
    setWorkItemKind(kind);
    setName(row.name || '');
    setSortOrder('');
    if (kind === 'room') {
      const apartmentId = row.apartment_id || '';
      const floorId = row.floor_id || apartmentFloorMap[apartmentId] || '';
      setModalFloorId(String(floorId || ''));
      setModalApartmentId(String(apartmentId || ''));
    } else {
      setModalFloorId(String(row.floor_id || ''));
      setModalApartmentId('');
    }
    setError('');
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
      {canRoles && (
        <button
          type="button"
          onClick={() => setTab('roles')}
          className={tabButtonClass(tab === 'roles')}
        >
          Роли
        </button>
      )}
      {visibleMainTabs.map((t) => (
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

  if (tab === 'roles' && canRoles) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="page-title">Настройка</h2>
        </div>
        {settingsTabs}
        <RolesTab />
      </div>
    );
  }

  if (tab === 'organizations' && canOrganizations) {
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

  if (!hasAnySettingsAccess(user) || !visibleMainTabs.some((t) => t.id === tab)) {
    return (
      <div className="space-y-6">
        <h2 className="page-title">Настройка</h2>
        {settingsTabs}
        {!hasAnySettingsAccess(user) && (
          <p className="text-zinc-500 text-sm">Нет доступа к разделам настройки.</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="page-title">Настройка</h2>
        <p className="text-zinc-400 text-sm mt-1">
          Справочники склада и мест проведения работ: склады и места хранения, категории и системы; объекты, подъезды, этажи, квартиры и помещения — во вкладке «Место проведения работ».
        </p>
      </div>

      {settingsTabs}

      {tab === 'warehouses' && (
        <div className="rounded-xl border border-sky-500/25 bg-sky-950/20 p-4 space-y-3">
          <p className="text-sky-100/90 text-sm font-medium">Склады</p>
          <div className="flex flex-wrap gap-2">
            {WAREHOUSE_SUB_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => switchWarehouseSubTab(t.id)}
                className={tabButtonClass(warehouseSubTab === t.id, 'warehouse')}
              >
                {t.label}
              </button>
            ))}
          </div>
          <p className="text-zinc-400 text-xs">
            Сначала склады (привязка к объекту), затем места хранения внутри склада.
          </p>
        </div>
      )}

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
            Сначала объекты, затем подъезды, этажи, квартиры и помещения — каждый уровень привязан к родительскому.
          </p>
        </div>
      )}

      {error && <p className="text-rose-400 text-sm">{error}</p>}

      {effectiveWorkTab === 'floors' ? (
        floorsByEntrance.length ? (
          <div className="space-y-4">
            {floorsByEntrance.map(({ entrance, floors }) => (
              <div
                key={entrance.id}
                className="rounded-xl border border-emerald-500/25 bg-emerald-950/20 p-4 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-white font-medium">{entranceOptionLabel(entrance)}</p>
                    <p className="text-zinc-400 text-xs">
                      {floors.length ? `Этажей: ${floors.length}` : 'Этажи пока не добавлены'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => startAddFloorForEntrance(entrance.id, floors.length)}
                    className="btn-secondary text-xs"
                  >
                    Добавить этаж
                  </button>
                </div>
                {floors.length ? (
                  <div className="table-wrap">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-white/10 text-zinc-300">
                          <th className="p-3 font-medium">Этаж</th>
                          <th className="p-3 w-40" />
                        </tr>
                      </thead>
                      <tbody>
                        {floors.map((row) => (
                          <tr key={row.id} className="border-b border-white/5">
                            <td className="p-3 text-white">{row.name}</td>
                            <td className="p-3">
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleMoveFloor(row, 'up')}
                                  className="px-2 py-1 rounded border border-white/20 text-zinc-200 hover:bg-white/10"
                                  title="Поднять этаж"
                                >
                                  ↑
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleMoveFloor(row, 'down')}
                                  className="px-2 py-1 rounded border border-white/20 text-zinc-200 hover:bg-white/10"
                                  title="Опустить этаж"
                                >
                                  ↓
                                </button>
                                <button
                                  type="button"
                                  onClick={() => startEdit(row)}
                                  className="text-sky-400 hover:text-sky-300 text-sm font-medium"
                                >
                                  Изм.
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDelete(row)}
                                  className="text-rose-400 hover:text-rose-300 text-sm font-medium"
                                >
                                  Удал.
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-zinc-500 text-sm py-2">Для этого подъезда этажи пока не добавлены.</p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-zinc-500 text-sm py-4">Сначала добавьте подъезды во вкладке «Подъезды».</p>
        )
      ) : effectiveWorkTab === 'apartments' ? (
        floorsByEntrance.length ? (
          <div className="space-y-4">
            {floorsByEntrance.map(({ entrance, floors }) => (
              <div
                key={entrance.id}
                className="rounded-xl border border-emerald-500/25 bg-emerald-950/20 p-4 space-y-3"
              >
                <p className="text-white font-medium">{entranceOptionLabel(entrance)}</p>
                {floors.length ? (
                  <div className="space-y-3">
                    {floors.map((floor) => {
                      const floorApartmentsRaw = apartmentsByFloorId[floor.id] || [];
                      const floorRoomsBucket = floorApartmentsRaw.find((a) => a.name === FLOOR_ROOMS_BUCKET_NAME);
                      const floorRooms = floorRoomsBucket ? (roomsByApartmentId[floorRoomsBucket.id] || []) : [];
                      const floorApartments = floorApartmentsRaw.filter((a) => a.name !== FLOOR_ROOMS_BUCKET_NAME);
                      return (
                        <div
                          key={floor.id}
                          className="rounded-lg border border-white/10 bg-black/10 p-3 space-y-2"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-zinc-100 text-sm font-medium">Этаж: {floor.name}</p>
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => startAddApartmentForFloor(floor.id)}
                                className="btn-secondary text-xs"
                              >
                                Добавить квартиру
                              </button>
                              <button
                                type="button"
                                onClick={() => startAddRoomForFloor(floor.id)}
                                className="btn-secondary text-xs"
                              >
                                Добавить помещение
                              </button>
                            </div>
                          </div>
                          {(floorApartments.length || floorRooms.length) ? (
                            <div className="space-y-2">
                              {floorApartments.map((apartment) => {
                                const apartmentRooms = roomsByApartmentId[apartment.id] || [];
                                return (
                                <div
                                  key={apartment.id}
                                  className="rounded-lg border border-white/10 bg-surface-850 px-3 py-2 space-y-2"
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="text-white text-sm">Кв. {apartment.name}</span>
                                    <div className="flex items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={() => startAddRoomForApartment(apartment.id, floor.id)}
                                        className="text-emerald-400 hover:text-emerald-300 text-xs font-medium"
                                      >
                                        + Пом.
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => startEditApartmentOrRoom(apartment, 'apartment')}
                                        className="text-sky-400 hover:text-sky-300 text-xs font-medium"
                                      >
                                        Изм.
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleDelete({ ...apartment, _kind: 'apartment' })}
                                        className="text-rose-400 hover:text-rose-300 text-xs font-medium"
                                      >
                                        Удал.
                                      </button>
                                    </div>
                                  </div>
                                  {apartmentRooms.length ? (
                                    <div className="space-y-1 pl-2 border-l border-white/10">
                                      {apartmentRooms.map((room) => (
                                        <div key={room.id} className="flex flex-wrap items-center justify-between gap-2">
                                          <span className="text-zinc-300 text-xs">Пом. {room.name}</span>
                                          <div className="flex items-center gap-2">
                                            <button
                                              type="button"
                                              onClick={() => startEditApartmentOrRoom({ ...room, floor_id: floor.id }, 'room')}
                                              className="text-sky-400 hover:text-sky-300 text-xs font-medium"
                                            >
                                              Изм.
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => handleDelete({ ...room, _kind: 'room' })}
                                              className="text-rose-400 hover:text-rose-300 text-xs font-medium"
                                            >
                                              Удал.
                                            </button>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <p className="text-zinc-500 text-xs">Помещения пока не добавлены</p>
                                  )}
                                </div>
                                );
                              })}
                              {floorRooms.length ? (
                                <div className="rounded-lg border border-white/10 bg-surface-850 px-3 py-2 space-y-1">
                                  <p className="text-zinc-400 text-xs">Помещения этажа</p>
                                  {floorRooms.map((room) => (
                                    <div key={room.id} className="flex flex-wrap items-center justify-between gap-2">
                                      <span className="text-zinc-300 text-xs">Пом. {room.name}</span>
                                      <div className="flex items-center gap-2">
                                        <button
                                          type="button"
                                          onClick={() => startEditApartmentOrRoom({ ...room, floor_id: floor.id, apartment_id: floorRoomsBucket?.id }, 'room')}
                                          className="text-sky-400 hover:text-sky-300 text-xs font-medium"
                                        >
                                          Изм.
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleDelete({ ...room, _kind: 'room' })}
                                          className="text-rose-400 hover:text-rose-300 text-xs font-medium"
                                        >
                                          Удал.
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <p className="text-zinc-500 text-sm">На этом этаже квартиры и помещения пока не добавлены.</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-zinc-500 text-sm">В этом подъезде пока нет этажей.</p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-zinc-500 text-sm py-4">Сначала добавьте подъезды и этажи.</p>
        )
      ) : (
        <SimpleList
          items={itemsForTab()}
          onEdit={startEdit}
          onDelete={handleDelete}
          extraCol={extraLabel}
          renderTitleLeading={tab === 'categories'
            ? (row) => (
              <span
                className={`inline-flex h-7 w-7 items-center justify-center rounded-lg ring-1 ${row._miniature?.badgeClass || 'bg-zinc-700 text-zinc-200 ring-zinc-500/40'}`}
                title={row._miniature?.label || 'Категория'}
                aria-label={row._miniature?.label || 'Категория'}
              >
                <CategoryGlyph iconKey={row._miniature?.key} />
              </span>
            )
            : null}
        />
      )}

      {effectiveWorkTab !== 'apartments' && (
        <div ref={formCardRef} className="rounded-xl border border-white/10 bg-surface-850 p-5 max-w-lg">
          <h3 className="text-white font-medium mb-4">{formTitle}</h3>
          <form onSubmit={handleSubmit} className="space-y-4">
          {effectiveWarehouseTab === 'warehouses' && (
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
          {effectiveWarehouseTab === 'storage' && (
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
                {sortedWorkObjects.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>
          )}
          {effectiveWorkTab === 'floors' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Подъезд</label>
                <select value={parentId} onChange={(e) => setParentId(e.target.value)} className="input" required>
                  <option value="">— Выберите —</option>
                  {sortedWorkEntrances.map((e) => (
                    <option key={e.id} value={e.id}>{entranceOptionLabel(e)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Порядок</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value)}
                  className="input"
                  placeholder="По умолчанию в конец"
                />
              </div>
            </div>
          )}
          <div>
            <label className="label">Название</label>
            <input
              ref={nameInputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input"
              required
            />
          </div>
          {tab === 'categories' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <label className="label">Иконка категории</label>
                <span className="text-xs text-zinc-400">
                  Текущая: {categorySelectedMiniature.label}
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setCategoryIconKey('')}
                  className={`rounded-lg border px-3 py-2 text-left transition ${
                    !categoryIconKey
                      ? 'border-sky-400/70 bg-sky-500/10 ring-1 ring-sky-400/30'
                      : 'border-white/10 bg-zinc-900/50 hover:bg-zinc-800/70'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span className={`inline-flex h-7 w-7 items-center justify-center rounded-lg ring-1 ${categoryAutoMiniature.badgeClass}`}>
                      <CategoryGlyph iconKey={categoryAutoMiniature.key} />
                    </span>
                    <span>
                      <span className="block text-sm text-white">Автоопределение</span>
                      <span className="block text-xs text-zinc-400">По названию категории</span>
                    </span>
                  </div>
                </button>
                {CATEGORY_ICON_OPTIONS.map((option) => {
                  const meta = CATEGORY_ICON_META[option.key] || CATEGORY_ICON_META.other;
                  const selected = categoryIconKey === option.key;
                  return (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => setCategoryIconKey(option.key)}
                      className={`rounded-lg border px-3 py-2 text-left transition ${
                        selected
                          ? 'border-sky-400/70 bg-sky-500/10 ring-1 ring-sky-400/30'
                          : 'border-white/10 bg-zinc-900/50 hover:bg-zinc-800/70'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <span className={`inline-flex h-7 w-7 items-center justify-center rounded-lg ring-1 ${meta.badgeClass}`}>
                          <CategoryGlyph iconKey={option.key} />
                        </span>
                        <span>
                          <span className="block text-sm text-white">{option.label}</span>
                          <span className="block text-xs text-zinc-400">{option.hint}</span>
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
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
      )}

      {effectiveWorkTab === 'apartments' && workModalOpen && (
        <div
          className="modal-backdrop z-50"
          onClick={closeWorkModal}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="card p-5 max-w-lg w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-white font-medium text-lg mb-4">
              {editing ? `Редактирование: ${workItemKind === 'room' ? 'помещение' : 'квартира'}` : `Добавить ${workItemKind === 'room' ? 'помещение' : 'квартиру'}`}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="label">Этаж</label>
                <select
                  value={modalFloorId}
                  onChange={(e) => {
                    setModalFloorId(e.target.value);
                    if (workItemKind === 'room') setModalApartmentId('');
                  }}
                  className="input"
                  required
                >
                  <option value="">— Выберите —</option>
                  {sortedWorkEntrances.map((entrance) => {
                    const entranceFloors = sortedWorkFloors.filter((f) => f.entrance_id === entrance.id);
                    if (!entranceFloors.length) return null;
                    return (
                      <optgroup key={entrance.id} label={entranceOptionLabel(entrance)}>
                        {entranceFloors.map((f) => (
                          <option key={f.id} value={f.id}>{f.name}</option>
                        ))}
                      </optgroup>
                    );
                  })}
                </select>
              </div>

              {workItemKind === 'room' && (
                <div>
                  <label className="label">Квартира (необязательно)</label>
                  <select
                    value={modalApartmentId}
                    onChange={(e) => setModalApartmentId(e.target.value)}
                    className="input"
                  >
                    <option value="">— Добавить на этаж (без квартиры) —</option>
                    {modalRoomApartmentOptions.map((a) => (
                      <option key={a.id} value={a.id}>
                        {apartmentOptionLabel({ ...a, _withPrefix: true })}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="label">Название</label>
                <div className="flex">
                  <span className="inline-flex items-center px-3 rounded-l-lg border border-r-0 border-zinc-600 bg-zinc-800 text-zinc-300 text-sm">
                    {workItemKind === 'room' ? 'Пом.' : 'Кв.'}
                  </span>
                  <input
                    autoFocus
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="input rounded-l-none"
                    required
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={closeWorkModal} className="btn-ghost text-sm">
                  Отмена
                </button>
                <button type="submit" className="btn-primary text-sm">
                  {editing ? 'Сохранить' : 'Добавить'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
