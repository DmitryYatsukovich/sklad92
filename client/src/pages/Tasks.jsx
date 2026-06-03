import { useCallback, useEffect, useMemo, useState } from 'react';
import { tasks as tasksApi } from '../api';
import { useAutoRefreshOnVisible } from '../hooks/useAutoRefreshOnVisible';

function pad2(value) {
  return String(value).padStart(2, '0');
}

function toInputDateTimeParts(iso) {
  if (!iso) return { date: '', time: '' };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: '', time: '' };
  return {
    date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
    time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
  };
}

function buildDueAtIso(date, time) {
  if (!date) return null;
  const [yy, mm, dd] = String(date).split('-').map((v) => Number.parseInt(v, 10));
  const [hh, mi] = String(time || '00:00').split(':').map((v) => Number.parseInt(v, 10));
  if (!yy || !mm || !dd) return null;
  const local = new Date(yy, mm - 1, dd, hh || 0, mi || 0, 0, 0);
  if (Number.isNaN(local.getTime())) return null;
  return local.toISOString();
}

function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusLabel(status) {
  if (status === 'completed') return 'Выполнена';
  if (status === 'extended') return 'Продлена';
  if (status === 'overdue') return 'Просрочена';
  return 'К выполнению';
}

function statusClass(status) {
  if (status === 'completed') return 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30';
  if (status === 'extended') return 'text-sky-300 bg-sky-500/10 border-sky-500/30';
  if (status === 'overdue') return 'text-rose-300 bg-rose-500/10 border-rose-500/30';
  return 'text-amber-300 bg-amber-500/10 border-amber-500/30';
}

function emptySummary() {
  return {
    pending: 0,
    extended: 0,
    overdue: 0,
    completed: 0,
    total: 0,
  };
}

function defaultDueParts() {
  const due = new Date();
  due.setMinutes(0, 0, 0);
  due.setHours(due.getHours() + 1);
  return {
    date: `${due.getFullYear()}-${pad2(due.getMonth() + 1)}-${pad2(due.getDate())}`,
    time: `${pad2(due.getHours())}:${pad2(due.getMinutes())}`,
  };
}

function makeDefaultForm(objects = [], users = []) {
  const due = defaultDueParts();
  return {
    title: '',
    description: '',
    object_id: objects[0] ? String(objects[0].id) : '',
    assigned_user_id: users[0] ? String(users[0].id) : '',
    due_date: due.date,
    due_time: due.time,
  };
}

export default function Tasks({ user }) {
  const [items, setItems] = useState([]);
  const [assignableUsers, setAssignableUsers] = useState([]);
  const [objects, setObjects] = useState([]);
  const [viewAll, setViewAll] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [form, setForm] = useState(() => makeDefaultForm());

  const resetForm = useCallback(() => {
    setEditingId(null);
    setForm(makeDefaultForm(objects, assignableUsers));
  }, [objects, assignableUsers]);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const [listRes, metaRes] = await Promise.all([tasksApi.list(), tasksApi.meta()]);
      const listItems = Array.isArray(listRes?.items) ? listRes.items : [];
      const metaUsers = Array.isArray(metaRes?.users) ? metaRes.users : [];
      const metaObjects = Array.isArray(metaRes?.objects) ? metaRes.objects : [];

      setItems(listItems);
      setAssignableUsers(metaUsers);
      setObjects(metaObjects);
      setViewAll(Boolean(listRes?.viewAll || metaRes?.viewAll));

      setForm((prev) => ({
        ...prev,
        object_id: metaObjects.some((row) => String(row.id) === String(prev.object_id))
          ? prev.object_id
          : (metaObjects[0] ? String(metaObjects[0].id) : ''),
        assigned_user_id: metaUsers.some((row) => String(row.id) === String(prev.assigned_user_id))
          ? prev.assigned_user_id
          : (metaUsers[0] ? String(metaUsers[0].id) : ''),
      }));
      if (editingId && !listItems.some((row) => row.id === editingId)) {
        setEditingId(null);
        setFormOpen(false);
      }
    } catch (e) {
      setError(e.message || 'Ошибка загрузки задач');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [editingId]);

  useEffect(() => {
    load();
  }, [load]);

  useAutoRefreshOnVisible(() => load(true), { intervalMs: 10000 });

  const openCreate = () => {
    setError('');
    setEditingId(null);
    setForm(makeDefaultForm(objects, assignableUsers));
    setFormOpen(true);
  };

  const onStartEdit = (row) => {
    const parts = toInputDateTimeParts(row.due_at);
    setEditingId(row.id);
    setError('');
    setForm({
      title: row.title || '',
      description: row.description || '',
      object_id: row.object_id ? String(row.object_id) : '',
      assigned_user_id: row.assigned_user_id ? String(row.assigned_user_id) : '',
      due_date: parts.date,
      due_time: parts.time,
    });
    setFormOpen(true);
  };

  const closeForm = () => {
    if (saving) return;
    setFormOpen(false);
    resetForm();
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    const title = form.title.trim();
    const dueAt = buildDueAtIso(form.due_date, form.due_time);
    if (!title) return setError('Укажите название задачи');
    if (!form.object_id) return setError('Выберите объект');
    if (!form.assigned_user_id) return setError('Выберите исполнителя');
    if (!dueAt) return setError('Укажите корректные дату и время');

    const payload = {
      title,
      description: form.description.trim(),
      object_id: Number.parseInt(form.object_id, 10),
      assigned_user_id: Number.parseInt(form.assigned_user_id, 10),
      due_at: dueAt,
    };

    setSaving(true);
    setError('');
    try {
      if (editingId) {
        await tasksApi.update(editingId, payload);
      } else {
        await tasksApi.create(payload);
      }
      setFormOpen(false);
      resetForm();
      await load(true);
    } catch (err) {
      setError(err.message || 'Ошибка сохранения задачи');
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (row) => {
    if (!window.confirm(`Удалить задачу «${row.title}»?`)) return;
    setError('');
    try {
      await tasksApi.delete(row.id);
      if (editingId === row.id) {
        setFormOpen(false);
        resetForm();
      }
      await load(true);
    } catch (e) {
      setError(e.message || 'Ошибка удаления задачи');
    }
  };

  const onToggleCompleted = async (row) => {
    setError('');
    try {
      await tasksApi.setCompleted(row.id, row.visible_status !== 'completed');
      await load(true);
    } catch (e) {
      setError(e.message || 'Ошибка изменения статуса');
    }
  };

  const onQuickExtend = async (row) => {
    const parts = toInputDateTimeParts(row.due_at);
    if (!parts.date) return;
    const dueIso = buildDueAtIso(parts.date, parts.time || '09:00');
    if (!dueIso) return;
    const d = new Date(dueIso);
    d.setDate(d.getDate() + 1);

    setError('');
    try {
      await tasksApi.update(row.id, {
        title: row.title,
        description: row.description || '',
        object_id: row.object_id,
        assigned_user_id: row.assigned_user_id,
        due_at: d.toISOString(),
      });
      await load(true);
    } catch (e) {
      setError(e.message || 'Ошибка продления задачи');
    }
  };

  const tasksByUser = useMemo(() => {
    const map = new Map();
    for (const row of items) {
      const uid = Number(row.assigned_user_id);
      if (!Number.isFinite(uid) || uid <= 0) continue;
      map.set(uid, (map.get(uid) || 0) + 1);
    }
    return map;
  }, [items]);

  const myTaskCount = tasksByUser.get(Number(user?.id)) || 0;

  const userFilteredItems = useMemo(() => {
    if (assigneeFilter === 'all') return items;
    const uid = Number.parseInt(assigneeFilter, 10);
    if (!uid) return items;
    return items.filter((row) => Number(row.assigned_user_id) === uid);
  }, [items, assigneeFilter]);

  const statusSummary = useMemo(() => {
    const summary = emptySummary();
    summary.total = userFilteredItems.length;
    for (const row of userFilteredItems) {
      if (row.visible_status === 'completed') summary.completed += 1;
      else if (row.visible_status === 'extended') summary.extended += 1;
      else if (row.visible_status === 'overdue') summary.overdue += 1;
      else summary.pending += 1;
    }
    return summary;
  }, [userFilteredItems]);

  const filteredItems = useMemo(() => {
    if (statusFilter === 'all') return userFilteredItems;
    return userFilteredItems.filter((row) => row.visible_status === statusFilter);
  }, [statusFilter, userFilteredItems]);

  const cards = useMemo(() => ([
    { key: 'all', label: 'Все', value: statusSummary.total, cls: 'text-zinc-300 border-zinc-500/30 bg-zinc-500/10' },
    { key: 'pending', label: 'К выполнению', value: statusSummary.pending, cls: 'text-amber-300 border-amber-500/30 bg-amber-500/10' },
    { key: 'extended', label: 'Продлена', value: statusSummary.extended, cls: 'text-sky-300 border-sky-500/30 bg-sky-500/10' },
    { key: 'overdue', label: 'Просрочена', value: statusSummary.overdue, cls: 'text-rose-300 border-rose-500/30 bg-rose-500/10' },
    { key: 'completed', label: 'Выполнена', value: statusSummary.completed, cls: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10' },
  ]), [statusSummary]);

  const hasFilters = statusFilter !== 'all' || assigneeFilter !== 'all';
  const resetFilters = () => {
    setStatusFilter('all');
    setAssigneeFilter('all');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-base font-semibold text-white">Задачи</h1>
          <p className="text-2xs text-zinc-500 mt-0.5">
            Постановка и контроль задач по объектам.
            {' '}
            {viewAll ? 'Показаны все задачи.' : 'Показаны только ваши задачи.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-2xs text-zinc-400">
            Всего: <span className="text-white font-medium">{items.length}</span>
          </div>
          <button type="button" className="btn-primary text-sm" onClick={openCreate}>
            Новая задача
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <span className="text-2xs text-zinc-300 border border-white/10 rounded-lg px-2 py-1 bg-white/[0.03]">
          Мне поставлено задач: <span className="text-white font-semibold">{myTaskCount}</span>
        </span>
      </div>

      {viewAll && (
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-2.5">
          <p className="text-2xs text-zinc-400 mb-2">Количество задач по исполнителям</p>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => setAssigneeFilter('all')}
              className={`shrink-0 rounded-md border px-2 py-1 text-2xs ${
                assigneeFilter === 'all'
                  ? 'border-sky-400/50 bg-sky-500/15 text-sky-200'
                  : 'border-white/10 bg-white/[0.02] text-zinc-300'
              }`}
            >
              Все пользователи · {items.length}
            </button>
            {assignableUsers.map((row) => {
              const count = tasksByUser.get(Number(row.id)) || 0;
              const active = assigneeFilter === String(row.id);
              return (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => setAssigneeFilter(String(row.id))}
                  className={`shrink-0 rounded-md border px-2 py-1 text-2xs ${
                    active
                      ? 'border-sky-400/50 bg-sky-500/15 text-sky-200'
                      : 'border-white/10 bg-white/[0.02] text-zinc-300'
                  }`}
                  title="Фильтр по исполнителю"
                >
                  {row.display_name || row.login} · {count}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
        {cards.map((card) => (
          <button
            type="button"
            key={card.key}
            onClick={() => setStatusFilter(card.key)}
            className={`rounded-lg border p-2.5 text-left transition ${card.cls} ${
              statusFilter === card.key ? 'ring-1 ring-white/40 scale-[0.99]' : 'opacity-90 hover:opacity-100'
            }`}
            title="Нажмите, чтобы фильтровать список"
          >
            <div className="text-2xs opacity-90">{card.label}</div>
            <div className="text-lg font-semibold leading-6">{card.value}</div>
          </button>
        ))}
      </div>

      {hasFilters && (
        <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-1.5">
          <span className="text-2xs text-zinc-300">
            Фильтр: {statusFilter === 'all' ? 'все статусы' : statusLabel(statusFilter)}
            {assigneeFilter !== 'all' ? ' · по исполнителю' : ''}
            {' '}({filteredItems.length})
          </span>
          <button type="button" className="btn-ghost text-2xs" onClick={resetFilters}>
            Сбросить
          </button>
        </div>
      )}

      {error && <div className="text-2xs text-red-300 border border-red-500/30 rounded px-2 py-1.5">{error}</div>}

      <div className="md:hidden space-y-2">
        {loading && !items.length ? (
          <div className="text-center text-zinc-500 py-6 text-2xs">Загрузка…</div>
        ) : null}
        {!loading && !filteredItems.length ? (
          <div className="text-center text-zinc-500 py-6 text-2xs">Нет задач по выбранному фильтру</div>
        ) : null}
        {filteredItems.map((row) => (
          <div key={row.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="text-sm text-white font-medium leading-snug">{row.title}</div>
              <span className={`inline-flex shrink-0 items-center px-2 py-0.5 rounded border text-2xs ${statusClass(row.visible_status)}`}>
                {statusLabel(row.visible_status)}
              </span>
            </div>
            {row.description ? (
              <div className="text-2xs text-zinc-400 leading-relaxed">{row.description}</div>
            ) : null}
            <div className="grid grid-cols-2 gap-2 text-2xs">
              <div>
                <div className="text-zinc-500">Объект</div>
                <div className="text-zinc-200">{row.object_name || '—'}</div>
              </div>
              <div>
                <div className="text-zinc-500">Срок</div>
                <div className="text-zinc-200">{formatDateTime(row.due_at)}</div>
              </div>
              <div className="col-span-2">
                <div className="text-zinc-500">Исполнитель</div>
                <div className="text-zinc-200">
                  {row.assigned_user_name || '—'}
                  {' '}
                  <span className="text-zinc-500">
                    · задач: {tasksByUser.get(Number(row.assigned_user_id)) || 0}
                  </span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button type="button" className="btn-ghost text-2xs" onClick={() => onStartEdit(row)}>Изменить</button>
              <button type="button" className="btn-ghost text-2xs" onClick={() => onToggleCompleted(row)}>
                {row.visible_status === 'completed' ? 'Вернуть' : 'Выполнена'}
              </button>
              {row.visible_status !== 'completed' ? (
                <button type="button" className="btn-ghost text-2xs" onClick={() => onQuickExtend(row)}>
                  Продлить +1д
                </button>
              ) : <span />}
              <button type="button" className="btn-ghost text-2xs text-rose-300" onClick={() => onDelete(row)}>
                Удалить
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="table-wrap hidden md:block">
        <table className="data-table">
          <thead>
            <tr>
              <th>Задача</th>
              <th className="w-[10rem]">Объект</th>
              <th className="w-[10rem]">Исполнитель</th>
              <th className="w-[10rem]">Срок</th>
              <th className="w-[8rem]">Статус</th>
              <th className="w-[13rem]">Действия</th>
            </tr>
          </thead>
          <tbody>
            {loading && !items.length ? (
              <tr>
                <td colSpan={6} className="text-center text-zinc-500 py-6 text-2xs">Загрузка…</td>
              </tr>
            ) : null}
            {!loading && !filteredItems.length ? (
              <tr>
                <td colSpan={6} className="text-center text-zinc-500 py-6 text-2xs">Нет задач по выбранному фильтру</td>
              </tr>
            ) : null}
            {filteredItems.map((row) => (
              <tr key={row.id}>
                <td>
                  <div className="text-white text-sm font-medium">{row.title}</div>
                  {row.description ? (
                    <div className="text-zinc-500 text-2xs mt-0.5 line-clamp-2">{row.description}</div>
                  ) : null}
                </td>
                <td className="text-zinc-300 text-2xs">{row.object_name || '—'}</td>
                <td className="text-zinc-300 text-2xs">
                  <div>{row.assigned_user_name || '—'}</div>
                  <div className="text-zinc-500">Задач: {tasksByUser.get(Number(row.assigned_user_id)) || 0}</div>
                </td>
                <td className="text-zinc-300 text-2xs whitespace-nowrap">{formatDateTime(row.due_at)}</td>
                <td>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded border text-2xs ${statusClass(row.visible_status)}`}>
                    {statusLabel(row.visible_status)}
                  </span>
                </td>
                <td>
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" className="btn-ghost text-2xs" onClick={() => onStartEdit(row)}>
                      Изм.
                    </button>
                    {row.visible_status !== 'completed' && (
                      <button type="button" className="btn-ghost text-2xs" onClick={() => onQuickExtend(row)}>
                        Продлить +1д
                      </button>
                    )}
                    <button type="button" className="btn-ghost text-2xs" onClick={() => onToggleCompleted(row)}>
                      {row.visible_status === 'completed' ? 'Вернуть' : 'Выполнена'}
                    </button>
                    <button type="button" className="btn-ghost text-2xs text-rose-300" onClick={() => onDelete(row)}>
                      Удалить
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {formOpen && (
        <div
          className="modal-backdrop z-[75]"
          onClick={closeForm}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="card p-5 max-w-xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-white text-sm font-medium mb-3">{editingId ? 'Редактирование задачи' : 'Новая задача'}</h3>
            <form onSubmit={onSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="md:col-span-2">
                <label className="label">Задача</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  className="input"
                  placeholder="Например: Проверить выдачу материалов по объекту"
                  required
                />
              </div>
              <div>
                <label className="label">Объект</label>
                <select
                  value={form.object_id}
                  onChange={(e) => setForm((f) => ({ ...f, object_id: e.target.value }))}
                  className="input"
                  required
                >
                  <option value="">— Выберите —</option>
                  {objects.map((row) => (
                    <option key={row.id} value={row.id}>{row.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Исполнитель</label>
                <select
                  value={form.assigned_user_id}
                  onChange={(e) => setForm((f) => ({ ...f, assigned_user_id: e.target.value }))}
                  className="input"
                  required
                  disabled={!viewAll && assignableUsers.length <= 1}
                >
                  <option value="">— Выберите —</option>
                  {assignableUsers.map((row) => (
                    <option key={row.id} value={row.id}>
                      {(row.display_name || row.login)} · {tasksByUser.get(Number(row.id)) || 0}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Дата выполнения</label>
                <input
                  type="date"
                  value={form.due_date}
                  onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
                  className="input"
                  required
                />
              </div>
              <div>
                <label className="label">Время выполнения</label>
                <input
                  type="time"
                  value={form.due_time}
                  onChange={(e) => setForm((f) => ({ ...f, due_time: e.target.value }))}
                  className="input"
                  required
                />
              </div>
              <div className="md:col-span-2">
                <label className="label">Комментарий</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  className="input min-h-[84px]"
                  placeholder="Дополнительные детали задачи (необязательно)"
                />
              </div>
              <div className="md:col-span-2 flex flex-wrap gap-2 pt-1">
                <button type="submit" className="btn-primary text-sm" disabled={saving || loading}>
                  {saving ? 'Сохранение…' : (editingId ? 'Сохранить' : 'Поставить задачу')}
                </button>
                <button type="button" onClick={closeForm} className="btn-ghost text-sm" disabled={saving}>
                  Отмена
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
