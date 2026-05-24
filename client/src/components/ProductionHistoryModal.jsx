import { useState, useEffect } from 'react';
import { reports } from '../api';

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatSumMoney(n) {
  if (n == null) return '—';
  return `${(Number(n) || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;
}

function formatQty(n, unit) {
  if (n == null) return '—';
  return `${(Number(n) || 0).toLocaleString('ru-RU', { maximumFractionDigits: 4 })} ${unit}`;
}

function userLabel(data) {
  return data.display_name
    || [data.first_name, data.last_name].filter(Boolean).join(' ')
    || data.login
    || '—';
}

export default function ProductionHistoryModal({
  row,
  currentUser,
  periodFrom,
  periodTo,
  onClose,
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const userId = row?.user_id ?? currentUser?.id;
  const materialId = row?.material_id;
  const issuanceId = row?.issuance_id;

  useEffect(() => {
    if (!userId || !materialId) {
      setLoading(false);
      setError('Не удалось определить выдачу для истории');
      setData(null);
      return;
    }

    setLoading(true);
    setError('');
    const q = new URLSearchParams({
      user_id: String(userId),
      material_id: String(materialId),
    });
    if (issuanceId) q.set('issuance_id', String(issuanceId));
    if (periodFrom) q.set('from', periodFrom);
    if (periodTo) q.set('to', periodTo);

    reports
      .productionHistory(q.toString())
      .then(setData)
      .catch((e) => {
        setError(e.message);
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [userId, materialId, issuanceId, periodFrom, periodTo]);

  const unit = data?.unit || row?.unit || '';
  const rowProduced = row?._produced ?? row?.produced;

  return (
    <div className="modal-backdrop z-[60]" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="card p-5 max-w-2xl w-full max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-white mb-1">История выработки</h3>
        <p className="text-zinc-400 text-xs mb-0.5">{data ? userLabel(data) : userLabel(row)}</p>
        <p className="text-white text-sm mb-1">{row.material_name}</p>
        {row.issued_at && (
          <p className="text-zinc-500 text-2xs mb-3">
            Выдача от {formatDate(row.issued_at)}
          </p>
        )}

        {data && (
          <p className="text-xs text-zinc-400 mb-4">
            Выработка по этой выдаче:{' '}
            <span className="text-white font-medium tabular-nums">
              {formatQty(data.current_produced ?? rowProduced, unit)}
            </span>
            {' · '}
            СМР:{' '}
            <span className="text-white font-medium">
              {formatSumMoney(data.current_smr_total ?? (Number(rowProduced) || 0) * (Number(data.production_price) || 0))}
            </span>
          </p>
        )}

        {error && <p className="alert-error mb-3">{error}</p>}

        {loading ? (
          <p className="text-zinc-500 text-xs py-4">Загрузка…</p>
        ) : !error && data?.entries?.length === 0 ? (
          <p className="text-zinc-500 text-xs py-4 text-center">Записей нет</p>
        ) : !error && data?.entries?.length > 0 ? (
          <div className="overflow-y-auto flex-1 min-h-0 border border-white/10 rounded-lg">
            <table className="table-compact w-full">
              <thead className="sticky top-0 bg-surface-900">
                <tr>
                  <th>Дата</th>
                  <th>Событие</th>
                  <th className="text-right">Выдано</th>
                  <th className="text-right">Возврат</th>
                  <th className="text-right">Выработка</th>
                  <th className="text-right">СМР</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((e) => (
                  <tr key={e.id}>
                    <td className="text-2xs text-zinc-500 whitespace-nowrap">{formatDate(e.at)}</td>
                    <td className="text-xs">
                      <div className={
                        e.kind === 'confirm' ? 'text-emerald-400'
                          : e.kind === 'unconfirm' ? 'text-amber-400'
                            : e.kind === 'location' ? 'text-sky-400'
                              : 'text-zinc-300'
                      }
                      >
                        {e.label}
                      </div>
                      {e.note && (
                        <div className="text-2xs text-zinc-500 max-w-[14rem]" title={e.note}>
                          {e.note}
                        </div>
                      )}
                    </td>
                    <td className="text-right tabular-nums text-zinc-300">
                      {e.issued != null ? formatQty(e.issued, unit) : '—'}
                    </td>
                    <td className="text-right tabular-nums text-zinc-400">
                      {e.returned != null ? formatQty(e.returned, unit) : '—'}
                    </td>
                    <td className="text-right tabular-nums text-brand-300">
                      {e.produced != null ? formatQty(e.produced, unit) : '—'}
                    </td>
                    <td className="text-right tabular-nums text-zinc-300">
                      {e.smr_total != null ? formatSumMoney(e.smr_total) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <div className="mt-4 flex justify-end shrink-0">
          <button type="button" onClick={onClose} className="btn-secondary">
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
