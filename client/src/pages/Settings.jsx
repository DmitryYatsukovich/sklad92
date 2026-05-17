import { useState, useEffect, useCallback } from 'react';
import { settings as settingsApi } from '../api';

const TABS = [
  { id: 'objects', label: 'Объекты' },
  { id: 'warehouses', label: 'Склады' },
  { id: 'racks', label: 'Стеллажи' },
  { id: 'categories', label: 'Категории' },
];

function SimpleList({ items, onEdit, onDelete, extraCol }) {
  if (!items.length) return <p className="text-slate-500 text-sm py-4">Список пуст. Добавьте запись ниже.</p>;
  return (
    <div className="table-wrap">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-700 text-slate-400">
            <th className="p-3 font-medium">Название</th>
            {extraCol && <th className="p-3 font-medium">{extraCol}</th>}
            <th className="p-3 w-28" />
          </tr>
        </thead>
        <tbody>
          {items.map((row) => (
            <tr key={row.id} className="border-b border-slate-700/50">
              <td className="p-3 text-white">{row.name}</td>
              {extraCol && <td className="p-3 text-slate-400">{row._extra || '—'}</td>}
              <td className="p-3 text-right space-x-2">
                <button type="button" onClick={() => onEdit(row)} className="text-brand-400 hover:text-brand-300 text-sm">
                  Изм.
                </button>
                <button type="button" onClick={() => onDelete(row)} className="text-red-400 hover:text-red-300 text-sm">
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

export default function Settings() {
  const [tab, setTab] = useState('objects');
  const [catalog, setCatalog] = useState({ objects: [], warehouses: [], racks: [], categories: [] });
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [editing, setEditing] = useState(null);

  const load = useCallback(() => {
    settingsApi.catalog().then(setCatalog).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const resetForm = () => {
    setName('');
    setParentId('');
    setEditing(null);
    setError('');
  };

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
    return catalog.categories.map((c) => ({ ...c }));
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
      } else {
        if (editing) await settingsApi.categories.update(editing.id, { name: n });
        else await settingsApi.categories.create({ name: n });
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
    else setParentId('');
  };

  const handleDelete = async (row) => {
    if (!confirm(`Удалить «${row.name}»?`)) return;
    setError('');
    try {
      if (tab === 'objects') await settingsApi.objects.delete(row.id);
      else if (tab === 'warehouses') await settingsApi.warehouses.delete(row.id);
      else if (tab === 'racks') await settingsApi.racks.delete(row.id);
      else await settingsApi.categories.delete(row.id);
      if (editing?.id === row.id) resetForm();
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const extraLabel = tab === 'warehouses' ? 'Объект' : tab === 'racks' ? 'Склад' : null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="page-title">Настройка</h2>
        <p className="text-slate-400 text-sm mt-1">
          Справочники для размещения материалов: объекты, склады, стеллажи и категории.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => { setTab(t.id); resetForm(); }}
            className={
              'px-4 py-2 rounded-xl text-sm font-medium transition-colors ' +
              (tab === t.id ? 'bg-brand-600 text-white' : 'bg-slate-700/50 text-slate-300 hover:text-white')
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <SimpleList
        items={itemsForTab()}
        onEdit={startEdit}
        onDelete={handleDelete}
        extraCol={extraLabel}
      />

      <div className="rounded-xl border border-slate-700/50 bg-surface-800 p-5 max-w-lg">
        <h3 className="text-white font-medium mb-4">{editing ? 'Редактирование' : 'Добавить'}</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          {tab === 'warehouses' && (
            <div>
              <label className="label">Объект</label>
              <select
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
                className="input"
                required
              >
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
              <select
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
                className="input"
                required
              >
                <option value="">— Выберите —</option>
                {catalog.warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.object_name ? `${w.object_name} → ` : ''}{w.name}
                  </option>
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
              <button type="button" onClick={resetForm} className="px-4 py-2 rounded-xl text-slate-400 hover:text-white text-sm">
                Отмена
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
