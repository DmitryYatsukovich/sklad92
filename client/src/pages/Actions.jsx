import { useState, useEffect, useCallback, useMemo } from 'react';
import { actions as actionsApi } from '../api';
import {
  listLocalActions,
  syncActionLogToServer,
  subscribeActionLog,
  getActionLogCounts,
} from '../lib/actionLog';

function formatWhen(iso) {
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

function kindLabel(kind) {
  const map = {
    issue: 'Выдача',
    return: 'Возврат',
    return_adjust: 'Возврат',
    material_create: 'Склад',
    material_update: 'Склад',
    material_add_qty: 'Склад',
    material_split: 'Склад',
    material_delete: 'Склад',
    production_confirm: 'Выраб.',
    production_location: 'Выраб.',
    attendance_check_in: 'Посещ.',
    attendance_check_out: 'Посещ.',
    attendance_register_face: 'Посещ.',
    attendance_timesheet_day: 'Посещ.',
    attendance_timesheet_hours: 'Посещ.',
    attendance_timesheet_times: 'Посещ.',
    attendance_timesheet_rates: 'Посещ.',
    attendance_timesheet_member: 'Посещ.',
    api_mutation: 'API',
  };
  return map[kind] || kind || '—';
}

function mergeActions(local, serverItems) {
  const byClient = new Map();
  for (const a of local) {
    byClient.set(a.clientId, {
      ...a,
      source: 'local',
    });
  }
  for (const s of serverItems) {
    const existing = byClient.get(s.clientId);
    if (existing) {
      byClient.set(s.clientId, {
        ...existing,
        ...s,
        synced: true,
        id: s.id ?? existing.id,
      });
    } else {
      byClient.set(s.clientId, { ...s, source: 'server' });
    }
  }
  return [...byClient.values()].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
  );
}

function canViewAllActions(user) {
  return user?.role === 'admin' || !!user?.can_actions_all;
}

export default function Actions({ user }) {
  const viewAll = canViewAllActions(user);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [counts, setCounts] = useState({ unsynced: 0, pending: 0 });
  const [filter, setFilter] = useState('all');

  const refreshCounts = useCallback(() => {
    getActionLogCounts().then(setCounts).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setError('');
    try {
      const [local, serverRes] = await Promise.all([
        listLocalActions(),
        actionsApi.list(400).catch(() => ({ items: [] })),
      ]);
      setItems(mergeActions(local, serverRes.items || []));
      refreshCounts();
    } catch (e) {
      setError(e.message || 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [refreshCounts, viewAll, user?.id]);

  useEffect(() => {
    load();
    const unsub = subscribeActionLog(() => {
      load();
    });
    return unsub;
  }, [load]);

  useEffect(() => {
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  const handleSync = async () => {
    setSyncing(true);
    setError('');
    try {
      await syncActionLogToServer();
      await load();
    } catch (e) {
      setError(e.message || 'Ошибка синхронизации');
    } finally {
      setSyncing(false);
    }
  };

  const filtered = useMemo(() => {
    if (filter === 'unsynced') return items.filter((i) => !i.synced);
    if (filter === 'synced') return items.filter((i) => i.synced);
    return items;
  }, [items, filter]);

  const unsyncedCount = items.filter((i) => !i.synced).length;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-base font-semibold text-white">Действия</h1>
          <p className="text-2xs text-zinc-500 mt-0.5">
            Журнал операций в приложении. Без сети записи сохраняются на устройстве и отправляются на сервер при подключении.
            {' '}
            {viewAll ? 'Показаны действия всех пользователей.' : 'Показаны только ваши действия.'}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {(counts.pending > 0 || counts.unsynced > 0) && (
            <span className="text-2xs text-amber-400/90 px-2 py-0.5 rounded border border-amber-500/30 bg-amber-500/10">
              Очередь: {counts.pending} запр.
              {counts.unsynced > 0 ? ` · ${counts.unsynced} не в БД` : ''}
            </span>
          )}
          <button
            type="button"
            className="btn-secondary text-2xs"
            disabled={syncing || !navigator.onLine}
            onClick={handleSync}
          >
            {syncing ? 'Синхронизация…' : 'Синхронизировать'}
          </button>
        </div>
      </div>

      {error && (
        <div className="text-2xs text-red-400 border border-red-500/30 rounded px-2 py-1">{error}</div>
      )}

      <div className="flex flex-wrap gap-1">
        {[
          { id: 'all', label: 'Все' },
          { id: 'unsynced', label: `Не загружено (${unsyncedCount})` },
          { id: 'synced', label: 'Загружено' },
        ].map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={filter === f.id ? 'btn-primary text-2xs' : 'btn-ghost text-2xs'}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th className="w-[8.5rem]">Дата</th>
              <th className="w-[4.5rem]">Тип</th>
              <th>Действие</th>
              <th className="w-[6rem]">Статус</th>
              {viewAll ? <th className="w-[5rem] hidden sm:table-cell">Кто</th> : null}
            </tr>
          </thead>
          <tbody>
            {loading && !items.length ? (
              <tr>
                <td colSpan={viewAll ? 5 : 4} className="text-center text-zinc-500 py-6 text-2xs">
                  Загрузка…
                </td>
              </tr>
            ) : null}
            {!loading && !filtered.length ? (
              <tr>
                <td colSpan={viewAll ? 5 : 4} className="text-center text-zinc-500 py-6 text-2xs">
                  Нет записей
                </td>
              </tr>
            ) : null}
            {filtered.map((row) => (
              <tr key={row.clientId || row.id}>
                <td className="text-zinc-500 text-2xs whitespace-nowrap">{formatWhen(row.createdAt)}</td>
                <td className="text-2xs text-zinc-400">{kindLabel(row.kind)}</td>
                <td>
                  <div className="text-2xs text-white font-medium">{row.title}</div>
                  {row.description ? (
                    <div className="text-2xs text-zinc-500 mt-0.5 line-clamp-2">{row.description}</div>
                  ) : null}
                </td>
                <td>
                  {row.synced ? (
                    <span className="inline-flex items-center gap-1 text-2xs text-emerald-400/90">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" aria-hidden />
                      Загружено
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-2xs text-amber-400/90">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400" aria-hidden />
                      Не загружено
                    </span>
                  )}
                </td>
                {viewAll ? (
                  <td className="text-2xs text-zinc-500 hidden sm:table-cell truncate max-w-[5rem]" title={row.userDisplayName}>
                    {row.userDisplayName || (row.userId === user?.id ? 'Вы' : '—')}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
