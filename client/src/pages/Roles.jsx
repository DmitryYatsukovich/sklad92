import { useState, useEffect } from 'react';
import { roles as rolesApi } from '../api';

const PERM_LABELS = {
  can_warehouse: 'Склад',
  can_issuance: 'Выдача',
  can_production: 'Выработка',
  can_users: 'Пользователи и роли',
  can_attendance: 'Журнал посещений',
};

const emptyForm = () => ({
  name: '',
  can_warehouse: true,
  can_issuance: true,
  can_production: true,
  can_users: false,
  can_attendance: false,
});

export default function Roles({ user }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);

  const load = () =>
    rolesApi
      .list()
      .then(setList)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));

  useEffect(() => {
    setLoading(true);
    load();
  }, []);

  useEffect(() => {
    const t = setInterval(() => rolesApi.list().then(setList).catch(() => {}), 5000);
    return () => clearInterval(t);
  }, []);

  const openCreate = () => {
    setForm(emptyForm());
    setShowCreate(true);
    setError('');
  };

  const openEdit = (r) => {
    setEditing(r.id);
    setForm({
      name: r.name || '',
      can_warehouse: !!r.can_warehouse,
      can_issuance: !!r.can_issuance,
      can_production: !!r.can_production,
      can_users: !!r.can_users,
      can_attendance: !!r.can_attendance,
    });
    setError('');
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return setError('Укажите название роли');
    setError('');
    setSaving(true);
    try {
      await rolesApi.create(form);
      setShowCreate(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (e) => {
    e.preventDefault();
    if (!editing || saving) return;
    if (!form.name?.trim()) {
      setError('Укажите название роли');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await rolesApi.update(editing, form);
      setEditing(null);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Удалить роль?')) return;
    try {
      await rolesApi.delete(id);
      setEditing(null);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) return <div className="text-slate-400">Загрузка…</div>;

  const permKeys = Object.keys(PERM_LABELS);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="page-title">Роли</h2>
        <button
          type="button"
          onClick={openCreate}
          className="btn-primary text-sm font-medium"
        >
          Добавить роль
        </button>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <div className="table-wrap">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-slate-700 text-slate-400 text-sm">
                <th className="p-4 font-medium">Название</th>
                <th className="p-4 font-medium">Склад</th>
                <th className="p-4 font-medium">Выдача</th>
                <th className="p-4 font-medium">Выработка</th>
                <th className="p-4 font-medium">Пользователи</th>
                <th className="p-4 font-medium">Посещения</th>
                <th className="p-4 font-medium w-24">Действия</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id} className="border-b border-slate-700/50 hover:bg-slate-800/30">
                  <td className="p-4 font-medium text-white">{r.name}</td>
                  <td className="p-4 text-slate-400">{r.can_warehouse ? '✓' : '—'}</td>
                  <td className="p-4 text-slate-400">{r.can_issuance ? '✓' : '—'}</td>
                  <td className="p-4 text-slate-400">{r.can_production ? '✓' : '—'}</td>
                  <td className="p-4 text-slate-400">{r.can_users ? '✓' : '—'}</td>
                  <td className="p-4 text-slate-400">{r.can_attendance ? '✓' : '—'}</td>
                  <td className="p-4">
                    {editing === r.id ? (
                      <span className="text-brand-400 text-sm">Редактирование</span>
                    ) : (
                      <>
                        <button type="button" onClick={() => openEdit(r)} className="text-brand-400 hover:text-brand-300 text-sm">
                          Редактировать
                        </button>
                        <button type="button" onClick={() => handleDelete(r.id)} className="ml-2 text-red-400 hover:text-red-300 text-sm">
                          Удалить
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {list.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-500">
                    Нет ролей
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="card p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-medium text-white mb-4">Новая роль</h3>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="label">Название</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="input"
                  placeholder="Например: Оператор склада"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-2">Возможности</label>
                <div className="space-y-2">
                  {permKeys.map((key) => (
                    <label key={key} className="flex items-center gap-2 text-slate-300 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form[key]}
                        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.checked }))}
                        className="rounded border-slate-600 text-brand-600 focus:ring-brand-500"
                      />
                      {PERM_LABELS[key]}
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-xl text-slate-400 hover:text-white">
                  Отмена
                </button>
                <button type="submit" disabled={saving} className="btn-primary disabled:opacity-50">
                  {saving ? 'Создание…' : 'Создать'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="card p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-medium text-white mb-4">Редактирование роли</h3>
            {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
            <form onSubmit={handleUpdate} className="space-y-4">
              <div>
                <label className="label">Название</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="input"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-2">Возможности (что может делать пользователь с этой ролью)</label>
                <div className="space-y-2">
                  {permKeys.map((key) => (
                    <label key={key} className="flex items-center gap-2 text-slate-300 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form[key]}
                        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.checked }))}
                        className="rounded border-slate-600 text-brand-600 focus:ring-brand-500"
                      />
                      {PERM_LABELS[key]}
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button type="button" onClick={() => { setEditing(null); setError(''); }} className="px-4 py-2 rounded-xl text-slate-400 hover:text-white">
                  Отмена
                </button>
                <button type="submit" disabled={saving} className="btn-primary disabled:opacity-50">
                  {saving ? 'Сохранение…' : 'Сохранить'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
