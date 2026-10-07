import { useCallback, useEffect, useState } from 'react';
import { settings as settingsApi } from '../../api';

const COLOR_PALETTE = [
  '#64748B', '#2563EB', '#0EA5E9', '#06B6D4', '#14B8A6',
  '#22C55E', '#84CC16', '#EAB308', '#F59E0B', '#F97316',
  '#EF4444', '#F43F5E', '#EC4899', '#A855F7', '#8B5CF6',
];

function normalizeRows(value) {
  return Array.isArray(value) ? value.filter((row) => row && typeof row === 'object') : [];
}

function sortRows(rows) {
  return [...rows].sort((a, b) => (
    Number(a.sort_order || 0) - Number(b.sort_order || 0)
    || String(a.name || '').localeCompare(String(b.name || ''), 'ru', { numeric: true, sensitivity: 'base' })
  ));
}

export default function ObjectBlockStatusesTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLOR_PALETTE[0]);
  const [isForProduction, setIsForProduction] = useState(false);
  const [countsAsProduced, setCountsAsProduced] = useState(false);
  const [sortOrder, setSortOrder] = useState('0');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await settingsApi.blockStatuses.list();
      setRows(sortRows(normalizeRows(data)));
    } catch (e) {
      setError(e.message || 'Ошибка загрузки статусов');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
    setName('');
    setColor(COLOR_PALETTE[0]);
    setIsForProduction(false);
    setCountsAsProduced(false);
    setSortOrder('0');
    setBusy(false);
  };

  const openCreate = () => {
    setEditing(null);
    setName('');
    setColor(COLOR_PALETTE[0]);
    setIsForProduction(false);
    setCountsAsProduced(false);
    setSortOrder(String(rows.length));
    setModalOpen(true);
    setError('');
  };

  const openEdit = (row) => {
    setEditing(row);
    setName(row.name || '');
    setColor(row.color || COLOR_PALETTE[0]);
    setIsForProduction(!!row.is_for_production);
    setCountsAsProduced(!!row.counts_as_produced);
    setSortOrder(String(row.sort_order ?? 0));
    setModalOpen(true);
    setError('');
  };

  const handleSave = async (event) => {
    event.preventDefault();
    const nextName = String(name || '').trim();
    if (!nextName) return setError('Укажите название статуса');
    const parsedSortOrder = Number.parseInt(sortOrder, 10);
    if (!Number.isInteger(parsedSortOrder) || parsedSortOrder < 0) {
      return setError('Порядок должен быть целым числом 0 или больше');
    }
    setBusy(true);
    setError('');
    try {
      const payload = {
        name: nextName,
        color,
        is_for_production: !!isForProduction,
        counts_as_produced: !!countsAsProduced,
        sort_order: parsedSortOrder,
      };
      if (editing?.id) {
        await settingsApi.blockStatuses.update(editing.id, payload);
      } else {
        await settingsApi.blockStatuses.create(payload);
      }
      closeModal();
      await load();
    } catch (e) {
      setError(e.message || 'Не удалось сохранить статус');
      setBusy(false);
    }
  };

  const handleDelete = async (row) => {
    if (!row?.id) return;
    if (!window.confirm(`Удалить статус «${row.name}»?`)) return;
    setError('');
    try {
      await settingsApi.blockStatuses.delete(row.id);
      await load();
    } catch (e) {
      setError(e.message || 'Не удалось удалить статус');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-zinc-400 text-sm">
          Статусы используются во вкладке «Объекты» для окраски блоков и контроля этапа выполнения.
        </p>
        <button type="button" onClick={openCreate} className="btn-primary text-sm">
          Добавить статус
        </button>
      </div>

      {error && <p className="text-rose-400 text-sm">{error}</p>}
      {loading ? (
        <p className="text-zinc-500 text-sm">Загрузка статусов…</p>
      ) : rows.length ? (
        <div className="table-wrap">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-zinc-300">
                <th className="p-3 font-medium">Статус</th>
                <th className="p-3 font-medium">Цвет</th>
                <th className="p-3 font-medium">Для выработки</th>
                <th className="p-3 font-medium">В «Выработано»</th>
                <th className="p-3 font-medium">Порядок</th>
                <th className="p-3 w-28" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-white/5">
                  <td className="p-3 text-white">{row.name}</td>
                  <td className="p-3">
                    <span className="inline-flex items-center gap-2 text-zinc-300">
                      <span className="h-4 w-4 rounded-full border border-white/30" style={{ backgroundColor: row.color || '#64748B' }} />
                      {row.color}
                    </span>
                  </td>
                  <td className="p-3 text-zinc-300">
                    {row.is_for_production ? 'Да' : 'Нет'}
                  </td>
                  <td className="p-3 text-zinc-300">
                    {row.counts_as_produced ? 'Да' : 'Нет'}
                  </td>
                  <td className="p-3 text-zinc-300">{row.sort_order ?? 0}</td>
                  <td className="p-3 text-right space-x-2 whitespace-nowrap">
                    <button type="button" onClick={() => openEdit(row)} className="text-sky-400 hover:text-sky-300 text-sm">
                      Изм.
                    </button>
                    <button type="button" onClick={() => handleDelete(row)} className="text-rose-400 hover:text-rose-300 text-sm">
                      Удал.
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-zinc-500 text-sm">Статусы пока не добавлены.</p>
      )}

      {modalOpen && (
        <div className="modal-backdrop z-50" onClick={closeModal} role="dialog" aria-modal="true">
          <div className="card p-5 max-w-2xl w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-white font-medium text-lg mb-4">
              {editing ? 'Редактирование статуса' : 'Добавить статус'}
            </h3>

            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid gap-3 md:grid-cols-[1fr_160px]">
                <div>
                  <label className="label">Название</label>
                  <input
                    autoFocus
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="input"
                    required
                  />
                </div>
                <div>
                  <label className="label">Порядок</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={sortOrder}
                    onChange={(e) => setSortOrder(e.target.value)}
                    className="input"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="label">Цвет статуса</label>
                <div className="flex flex-wrap gap-2">
                  {COLOR_PALETTE.map((hex) => {
                    const selected = color === hex;
                    return (
                      <button
                        key={hex}
                        type="button"
                        onClick={() => setColor(hex)}
                        className={`h-8 w-8 rounded-full border ${selected ? 'border-white ring-2 ring-white/60' : 'border-white/25'}`}
                        style={{ backgroundColor: hex }}
                        title={hex}
                        aria-label={`Выбрать цвет ${hex}`}
                      />
                    );
                  })}
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => setColor(String(e.target.value || '').toUpperCase())}
                    className="h-8 w-12 cursor-pointer rounded border border-white/25 bg-transparent"
                    title="Пользовательский цвет"
                    aria-label="Выбрать пользовательский цвет"
                  />
                </div>
                <p className="text-zinc-400 text-xs">Выбранный цвет: {color}</p>
              </div>

              <label className="inline-flex items-center gap-2 text-sm text-zinc-200">
                <input
                  type="checkbox"
                  checked={isForProduction}
                  onChange={(e) => setIsForProduction(e.target.checked)}
                />
                Статус для выработки
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-zinc-200">
                <input
                  type="checkbox"
                  checked={countsAsProduced}
                  onChange={(e) => setCountsAsProduced(e.target.checked)}
                />
                Учитывать блок в столбце «Выработано»
              </label>

              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={busy}>
                  Отмена
                </button>
                <button type="submit" className="btn-primary text-sm" disabled={busy}>
                  {busy ? 'Сохранение…' : (editing ? 'Сохранить' : 'Добавить')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
