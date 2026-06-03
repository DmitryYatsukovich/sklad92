import { useCallback, useEffect, useMemo, useState } from 'react';
import { tasks as tasksApi } from '../api';

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

export default function Tasks({ user }) {
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState(emptySummary());
  const [assignableUsers, setAssignableUsers] = useState([]);
  const [objects, setObjects] = useState([]);
  const [viewAll, setViewAll] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({
    title: '',
    description: '',
    object_id: '',
    assigned_user_id: '',
    due_date: '',
    due_time: '',
  });

  const resetForm = useCallback(() => {
    setEditingId(null);
    setForm((prev) => ({
      title: '',
      description: '',
      object_id: prev.object_id || '',
      assigned_user_id: prev.assigned_user_id || '',
      due_date: '',
      due_time: '',
    }));
  }, []);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const [listRes, metaRes] = await Promise.all([tasksApi.list(), tasksApi.meta()]);
      const listItems = Array.isArray(listRes?.items) ? listRes.items : [];
      const summaryData = listRes?.summary && typeof listRes.summary === 'object'
        ? listRes.summary
        : emptySummary();
      const metaUsers = Array.isArray(metaRes?.users) ? metaRes.users : [];
      const metaObjects = Array.isArray(metaRes?.objects) ? metaRes.objects : [];

      setItems(listItems);
      setSummary({
        pending: Number(summaryData.pending || 0),
        extended: Number(summaryData.extended || 0),
        overdue: Number(summaryData.overdue || 0),
        completed: Number(summaryData.completed || 0),
        total: Number(summaryData.total || listItems.length || 0),
      });
      setAssignableUsers(metaUsers);
      setObjects(metaObjects);
      setViewAll(Boolean(listRes?.viewAll || metaRes?.viewAll));

      setForm((prev) => ({
        ...prev,
        object_id: prev.object_id || (metaObjects[0] ? String(metaObjects[0].id) : ''),
        assigned_user_id: prev.assigned_user_id || (metaUsers[0] ? String(metaUsers[0].id) : ''),
      }));
      if (editingId && !listItems.some((row) => row.id === editingId)) {
        setEditingId(null);
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

  const onStartEdit = (row) => {
    const parts = toInputDateTimeParts(row.due_at);
    setEditingId(row.id);
    setForm({
      title: row.title || '',
      description: row.description || '',
      object_id: row.object_id ? String(row.object_id) : '',
      assigned_user_id: row.assigned_user_id ? String(row.assigned_user_id) : '',
      due_date: parts.date,
      due_time: parts.time,
    });
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
      if (editingId === row.id) resetForm();
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

  const cards = useMemo(() => ([
    { key: 'pending', label: 'К выполнению', value: summary.pending, cls: 'text-amber-300 border-amber-500/30 bg-amber-500/10' },
    { key: 'extended', label: 'Продлена', value: summary.extended, cls: 'text-sky-300 border-sky-500/30 bg-sky-500/10' },
    { key: 'overdue', label: 'Просрочена', value: summary.overdue, cls: 'text-rose-300 border-rose-500/30 bg-rose-500/10' },
    { key: 'completed', label: 'Выполнена', value: summary.completed, cls: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10' },
  ]), [summary.completed, summary.extended, summary.overdue, summary.pending]);

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
        <div className="text-2xs text-zinc-400">
          Всего: <span className="text-white font-medium">{summary.total}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {cards.map((card) => (
          <div key={card.key} className={`rounded-lg border p-2.5 ${card.cls}`}>
            <div className="text-2xs opacity-90">{card.label}</div>
            <div className="text-lg font-semibold leading-6">{card.value}</div>
          </div>
        ))}
      </div>

      {error && <div className="text-2xs text-red-300 border border-red-500/30 rounded px-2 py-1.5">{error}</div>}

      <div className="card p-4">
        <h3 className="text-white text-sm font-medium mb-3">{editingId ? 'Редактирование задачи' : 'Новая задача'}</h3>
        <form onSubmit={onSubmit} className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          <div className="xl:col-span-2">
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
                  {row.display_name || row.login}
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
          <div className="md:col-span-2 xl:col-span-3">
            <label className="label">Комментарий</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className="input min-h-[84px]"
              placeholder="Дополнительные детали задачи (необязательно)"
            />
          </div>
          <div className="xl:col-span-3 flex flex-wrap gap-2">
            <button type="submit" className="btn-primary text-sm" disabled={saving || loading}>
              {saving ? 'Сохранение…' : (editingId ? 'Сохранить' : 'Поставить задачу')}
            </button>
            {editingId && (
              <button type="button" onClick={resetForm} className="btn-ghost text-sm" disabled={saving}>
                Отмена
              </button>
            )}
          </div>
        </form>
      </div>

      <div className="table-wrap">
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
            {!loading && !items.length ? (
              <tr>
                <td colSpan={6} className="text-center text-zinc-500 py-6 text-2xs">Задач пока нет</td>
              </tr>
            ) : null}
            {items.map((row) => (
              <tr key={row.id}>
                <td>
                  <div className="text-white text-sm font-medium">{row.title}</div>
                  {row.description ? (
                    <div className="text-zinc-500 text-2xs mt-0.5 line-clamp-2">{row.description}</div>
                  ) : null}
                </td>
                <td className="text-zinc-300 text-2xs">{row.object_name || '—'}</td>
                <td className="text-zinc-300 text-2xs">{row.assigned_user_name || '—'}</td>
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
    </div>
  );
}
