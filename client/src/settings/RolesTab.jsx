import { useState, useEffect, useCallback, useMemo } from 'react';
import { roles as rolesApi } from '../api';

const emptyPerms = (permissionDefs = []) => Object.fromEntries(
  permissionDefs.map((p) => [p.key, false]),
);

function roleToForm(row, permissionDefs) {
  if (!row) {
    return { name: '', ...emptyPerms(permissionDefs) };
  }
  const perms = emptyPerms(permissionDefs);
  permissionDefs.forEach((p) => {
    perms[p.key] = !!row[p.key];
  });
  return { name: row.name || '', ...perms };
}

export default function RolesTab() {
  const [list, setList] = useState([]);
  const [permissionDefs, setPermissionDefs] = useState([]);
  const [form, setForm] = useState({ name: '', ...emptyPerms() });
  const [editing, setEditing] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([rolesApi.list(), rolesApi.permissions()])
      .then(([roles, perms]) => {
        setList(roles);
        setPermissionDefs(perms);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const groups = useMemo(() => {
    const map = new Map();
    permissionDefs.forEach((p) => {
      const g = p.group || 'Прочее';
      if (!map.has(g)) map.set(g, []);
      map.get(g).push(p);
    });
    return [...map.entries()];
  }, [permissionDefs]);

  const closeForm = () => {
    setFormOpen(false);
    setForm({ name: '', ...emptyPerms(permissionDefs) });
    setEditing(null);
    setError('');
  };

  const openCreate = () => {
    setEditing(null);
    const base = emptyPerms(permissionDefs);
    setForm({
      name: '',
      ...base,
      can_warehouse: true,
      can_issuance: true,
      can_production: true,
    });
    setError('');
    setFormOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    setForm(roleToForm(row, permissionDefs));
    setError('');
    setFormOpen(true);
  };

  const setPerm = (key, value) => {
    if (editing?.is_admin_role) return;
    setForm((f) => {
      const next = { ...f, [key]: value };
      if (key === 'can_actions' && !value) {
        next.can_actions_all = false;
      }
      if (key === 'can_attendance' && !value) {
        next.can_attendance_all = false;
        next.can_attendance_edit = false;
        next.can_attendance_pay = false;
        next.can_attendance_edit_rates = false;
        next.can_attendance_add_member = false;
        next.can_attendance_export = false;
        next.can_attendance_import = false;
        next.can_attendance_change_month = false;
      }
      if (key === 'can_attendance_pay' && !value) next.can_attendance_edit_rates = false;
      if (key === 'can_attendance_all' && !value) {
        next.can_attendance_add_member = false;
        next.can_attendance_import = false;
      }
      return next;
    });
  };

  const setAttendanceScope = (allUsers) => {
    if (editing?.is_admin_role) return;
    setForm((f) => ({ ...f, can_attendance_all: allUsers }));
  };

  const setActionsScope = (allUsers) => {
    if (editing?.is_admin_role) return;
    setForm((f) => ({ ...f, can_actions_all: allUsers }));
  };

  const selectAllPerms = (value) => {
    if (editing?.is_admin_role) return;
    setForm((f) => {
      const next = { ...f };
      permissionDefs.forEach((p) => { next[p.key] = value; });
      return next;
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const name = form.name.trim();
    if (!name && !editing?.is_admin_role) return setError('Укажите название роли');
    setError('');
    const body = { name: editing?.is_admin_role ? 'Администратор' : name };
    permissionDefs.forEach((p) => {
      body[p.key] = editing?.is_admin_role ? true : !!form[p.key];
    });
    try {
      if (editing) await rolesApi.update(editing.id, body);
      else await rolesApi.create(body);
      closeForm();
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (row) => {
    if (row.is_admin_role) return setError('Роль «Администратор» нельзя удалить');
    if (!window.confirm(`Удалить роль «${row.name}»?`)) return;
    setError('');
    try {
      await rolesApi.delete(row.id);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const permSummary = (row) => {
    const labels = permissionDefs.filter((p) => row[p.key]).map((p) => p.label);
    return labels.length ? labels.join(', ') : '—';
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-slate-400 text-sm">
          Роли определяют доступ к разделам приложения. Роль «Администратор» всегда включает все возможности.
        </p>
        <button type="button" onClick={openCreate} className="btn-primary text-sm">
          Добавить роль
        </button>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {loading ? (
        <p className="text-slate-500 text-sm">Загрузка…</p>
      ) : (
        <div className="table-wrap">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-700 text-slate-400">
                <th className="p-3 font-medium">Название</th>
                <th className="p-3 font-medium">Возможности</th>
                <th className="p-3 w-28" />
              </tr>
            </thead>
            <tbody>
              {list.map((row) => (
                <tr key={row.id} className="border-b border-slate-700/50">
                  <td className="p-3 text-white font-medium">
                    {row.name}
                    {row.is_admin_role && (
                      <span className="ml-2 text-2xs text-amber-400">все разделы</span>
                    )}
                  </td>
                  <td className="p-3 text-slate-400 text-xs">{permSummary(row)}</td>
                  <td className="p-3 text-right space-x-2 whitespace-nowrap">
                    <button type="button" onClick={() => openEdit(row)} className="text-brand-400 hover:text-brand-300 text-sm">
                      Изм.
                    </button>
                    {!row.is_admin_role && (
                      <button type="button" onClick={() => handleDelete(row)} className="text-red-400 hover:text-red-300 text-sm">
                        Удал.
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {formOpen && (
        <div
          className="modal-backdrop z-50"
          onClick={closeForm}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="card p-5 max-w-lg w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-white font-medium text-lg mb-4">
              {editing ? `Роль: ${editing.name}` : 'Новая роль'}
            </h3>
            {error && <p className="text-rose-400 text-sm mb-3">{error}</p>}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="label">Название</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="input"
                  disabled={editing?.is_admin_role}
                  required={!editing?.is_admin_role}
                />
              </div>

              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <label className="label mb-0">Возможности приложения</label>
                  {!editing?.is_admin_role && (
                    <div className="flex gap-2 text-2xs">
                      <button type="button" className="text-brand-400 hover:text-brand-300" onClick={() => selectAllPerms(true)}>
                        Все
                      </button>
                      <button type="button" className="text-slate-400 hover:text-white" onClick={() => selectAllPerms(false)}>
                        Сброс
                      </button>
                    </div>
                  )}
                </div>
                {editing?.is_admin_role && (
                  <p className="text-amber-400/90 text-xs mb-3">
                    У роли «Администратор» включены все разделы и действия приложения.
                  </p>
                )}
                <div className="space-y-4 border border-white/10 rounded-xl p-4 bg-white/[0.02]">
                  {groups.map(([groupName, items]) => (
                    <div key={groupName}>
                      <p className="text-slate-500 text-2xs uppercase tracking-wide mb-2">{groupName}</p>
                      <div className="space-y-2">
                        {items
                          .filter((p) => !p.attendanceScopeOption && !p.attendanceEditOption && !p.attendancePayOption && !p.attendanceRatesOption && !p.attendanceToolsOption && !p.attendanceMonthOption && !p.actionsScopeOption)
                          .map((p) => (
                            <div key={p.key}>
                              <label
                                className={`flex items-start gap-3 p-2 rounded-lg border border-white/5 ${
                                  editing?.is_admin_role ? 'opacity-70' : 'hover:bg-white/5'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={editing?.is_admin_role ? true : !!form[p.key]}
                                  disabled={!!editing?.is_admin_role}
                                  onChange={(e) => setPerm(p.key, e.target.checked)}
                                  className="mt-1 rounded border-slate-600 text-brand-600"
                                />
                                <span>
                                  <span className="text-slate-200 text-sm block">{p.label}</span>
                                  <span className="text-slate-500 text-2xs">{p.description}</span>
                                </span>
                              </label>
                              {p.key === 'can_actions' && (editing?.is_admin_role || form.can_actions) && (
                                <div className="ml-9 mt-1 mb-2 space-y-1.5 pl-3 border-l border-white/10">
                                  <p className="text-slate-500 text-2xs">Область журнала</p>
                                  <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                                    <input
                                      type="radio"
                                      name="actions_scope"
                                      checked={editing?.is_admin_role ? true : !!form.can_actions_all}
                                      disabled={!!editing?.is_admin_role}
                                      onChange={() => setActionsScope(true)}
                                      className="border-slate-600 text-brand-600"
                                    />
                                    Действия всех пользователей
                                  </label>
                                  <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                                    <input
                                      type="radio"
                                      name="actions_scope"
                                      checked={editing?.is_admin_role ? false : !form.can_actions_all}
                                      disabled={!!editing?.is_admin_role}
                                      onChange={() => setActionsScope(false)}
                                      className="border-slate-600 text-brand-600"
                                    />
                                    Только свои действия
                                  </label>
                                </div>
                              )}
                              {p.key === 'can_attendance' && (editing?.is_admin_role || form.can_attendance) && (
                                <div className="ml-9 mt-1 mb-2 space-y-1.5 pl-3 border-l border-white/10">
                                  <p className="text-slate-500 text-2xs">Область табеля</p>
                                  <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                                    <input
                                      type="radio"
                                      name="attendance_scope"
                                      checked={editing?.is_admin_role ? true : !!form.can_attendance_all}
                                      disabled={!!editing?.is_admin_role}
                                      onChange={() => setAttendanceScope(true)}
                                      className="border-slate-600 text-brand-600"
                                    />
                                    Табель всех сотрудников
                                  </label>
                                  <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                                    <input
                                      type="radio"
                                      name="attendance_scope"
                                      checked={editing?.is_admin_role ? false : !form.can_attendance_all}
                                      disabled={!!editing?.is_admin_role}
                                      onChange={() => setAttendanceScope(false)}
                                      className="border-slate-600 text-brand-600"
                                    />
                                    Только свой табель
                                  </label>
                                  <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer pt-1">
                                    <input
                                      type="checkbox"
                                      checked={editing?.is_admin_role ? true : !!form.can_attendance_edit}
                                      disabled={!!editing?.is_admin_role}
                                      onChange={(e) => setPerm('can_attendance_edit', e.target.checked)}
                                      className="rounded border-slate-600 text-brand-600"
                                    />
                                    Редактирование табеля
                                  </label>
                                  <p className="text-slate-600 text-2xs pl-6">
                                    Правка ячеек, времени прихода/ухода и комментариев
                                  </p>
                                  <label
                                    className={`flex items-center gap-2 text-sm text-slate-300 cursor-pointer pt-1 ${
                                      !(editing?.is_admin_role || form.can_attendance_pay) ? 'opacity-50' : ''
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={editing?.is_admin_role ? true : !!form.can_attendance_edit_rates}
                                      disabled={!!editing?.is_admin_role || !(editing?.is_admin_role || form.can_attendance_pay)}
                                      onChange={(e) => setPerm('can_attendance_edit_rates', e.target.checked)}
                                      className="rounded border-slate-600 text-brand-600"
                                    />
                                    Редактирование ставок
                                  </label>
                                  <p className="text-slate-600 text-2xs pl-6">
                                    Ставка и ставка премии (нужен табель с расчётом)
                                  </p>
                                  <p className="text-slate-500 text-2xs pt-2">Отображение табеля</p>
                                  <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                                    <input
                                      type="radio"
                                      name="attendance_pay"
                                      checked={editing?.is_admin_role ? true : !!form.can_attendance_pay}
                                      disabled={!!editing?.is_admin_role}
                                      onChange={() => setPerm('can_attendance_pay', true)}
                                      className="border-slate-600 text-brand-600"
                                    />
                                    С расчётом (ставки, заработок, премии)
                                  </label>
                                  <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                                    <input
                                      type="radio"
                                      name="attendance_pay"
                                      checked={editing?.is_admin_role ? false : !form.can_attendance_pay}
                                      disabled={!!editing?.is_admin_role}
                                      onChange={() => setPerm('can_attendance_pay', false)}
                                      className="border-slate-600 text-brand-600"
                                    />
                                    Без расчёта (только часы и отметки)
                                  </label>
                                  <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer pt-1">
                                    <input
                                      type="checkbox"
                                      checked={editing?.is_admin_role ? true : !!form.can_attendance_change_month}
                                      disabled={!!editing?.is_admin_role}
                                      onChange={(e) => setPerm('can_attendance_change_month', e.target.checked)}
                                      className="rounded border-slate-600 text-brand-600"
                                    />
                                    Выбор месяца табеля
                                  </label>
                                  <p className="text-slate-600 text-2xs pl-6">
                                    Переход к другим месяцам (‹ ›, календарь, «Текущий месяц»)
                                  </p>
                                  <p className="text-slate-500 text-2xs pt-2">Функции табеля</p>
                                  <label
                                    className={`flex items-center gap-2 text-sm text-slate-300 cursor-pointer ${
                                      !(editing?.is_admin_role || form.can_attendance_all) ? 'opacity-50' : ''
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={editing?.is_admin_role ? true : !!form.can_attendance_add_member}
                                      disabled={!!editing?.is_admin_role || !(editing?.is_admin_role || form.can_attendance_all)}
                                      onChange={(e) => setPerm('can_attendance_add_member', e.target.checked)}
                                      className="rounded border-slate-600 text-brand-600"
                                    />
                                    Добавить сотрудника в табель
                                  </label>
                                  <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={editing?.is_admin_role ? true : !!form.can_attendance_export}
                                      disabled={!!editing?.is_admin_role}
                                      onChange={(e) => setPerm('can_attendance_export', e.target.checked)}
                                      className="rounded border-slate-600 text-brand-600"
                                    />
                                    Экспорт табеля в Excel
                                  </label>
                                  <label
                                    className={`flex items-center gap-2 text-sm text-slate-300 cursor-pointer ${
                                      !(editing?.is_admin_role || form.can_attendance_all) ? 'opacity-50' : ''
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={editing?.is_admin_role ? true : !!form.can_attendance_import}
                                      disabled={!!editing?.is_admin_role || !(editing?.is_admin_role || form.can_attendance_all)}
                                      onChange={(e) => setPerm('can_attendance_import', e.target.checked)}
                                      className="rounded border-slate-600 text-brand-600"
                                    />
                                    Импорт табеля из Excel
                                  </label>
                                  <p className="text-slate-600 text-2xs pl-6">
                                    Добавление и импорт — при табеле всех сотрудников
                                  </p>
                                </div>
                              )}
                            </div>
                          ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={closeForm} className="btn-ghost text-sm">
                  Отмена
                </button>
                <button type="submit" className="btn-primary text-sm">
                  {editing ? 'Сохранить' : 'Создать'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
