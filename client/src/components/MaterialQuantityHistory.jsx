import { useState, useEffect } from 'react';
import { materials as materialsApi } from '../api';
import {
  materialDisplayName,
  isMaterialGroupRow,
  isMaterialPart,
  materialRowQuantity,
} from '../lib/materialDisplay';

const KIND_LABELS = {
  receipt: 'Приход',
  issue: 'Выдача',
  return: 'Возврат',
  return_adjust: 'Корректировка возврата',
  create: 'Создание',
  import: 'Импорт',
  adjust: 'Корректировка',
};

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatDelta(delta) {
  const n = Number(delta);
  if (n > 0) return `+${n}`;
  return String(n);
}

export default function MaterialQuantityHistory({ material, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!material?.id) return;
    setLoading(true);
    setError('');
    materialsApi.quantityHistory(material.id)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [material?.id]);

  const unit = data?.unit || material?.unit || '';
  const isGroup = data?.is_group ?? isMaterialGroupRow(material);
  const currentQty = data != null
    ? Number(data.quantity)
    : materialRowQuantity(material);
  const title = materialDisplayName(material) || material?.name || '';

  return (
    <div className="modal-backdrop z-[60]" onClick={onClose} role="dialog" aria-modal="true">
      <HistoryPanel>
        <h3 className="text-base font-semibold text-white mb-1">История количества</h3>
        <p className="text-zinc-400 text-xs mb-1">{title}</p>
        <p className="text-zinc-500 text-xs font-mono mb-3">{material.code}</p>
        <p className="text-xs text-zinc-400 mb-1">
          {isGroup ? 'Всего на складе сейчас' : 'На складе сейчас'}:{' '}
          <span className="text-white font-medium tabular-nums">
            {currentQty.toLocaleString('ru-RU', { maximumFractionDigits: 4 })} {unit}
          </span>
        </p>
        {isGroup && (
          <p className="text-2xs text-zinc-500 mb-4">
            Показаны все операции по материалу и его {data?.parts_count ?? material?.parts_count ?? ''} частям,
            включая разделение.
          </p>
        )}
        {!isGroup && isMaterialPart(material) && (
          <p className="text-2xs text-zinc-500 mb-4">
            История этой части. Полная история материала — по кнопке количества в строке группы.
          </p>
        )}

        {error && <p className="alert-error mb-3">{error}</p>}

        {loading ? (
          <p className="text-zinc-500 text-xs py-4">Загрузка…</p>
        ) : data?.entries?.length === 0 ? (
          <p className="text-zinc-500 text-xs py-4 text-center">Записей пока нет</p>
        ) : (
          <div className="overflow-y-auto flex-1 min-h-0 border border-white/10 rounded-lg">
            <table className="table-compact w-full">
              <thead className="sticky top-0 bg-surface-900">
                <tr>
                  <th>Дата</th>
                  {isGroup && <th>Часть</th>}
                  <th>Операция</th>
                  <th className="text-right">Δ</th>
                  <th className="text-right">Остаток</th>
                  <th>Пользователь</th>
                </tr>
              </thead>
              <tbody>
                {(data?.entries || []).map((e) => {
                  const delta = Number(e.delta);
                  const isNeg = delta < 0;
                  const partCell = e.part_title
                    || (e.parent_material_id ? `Часть ${e.part_index || '?'}` : '—');
                  return (
                    <tr key={e.id}>
                      <td className="text-2xs text-zinc-500 whitespace-nowrap">{formatDate(e.created_at)}</td>
                      {isGroup && (
                        <td className="text-2xs text-zinc-400 max-w-[7rem] truncate" title={partCell}>
                          {e.parent_material_id ? partCell : 'Группа'}
                        </td>
                      )}
                      <td className="text-xs">
                        <div className="text-zinc-300">{KIND_LABELS[e.kind] || e.kind}</div>
                        {e.note && (
                          <div className="text-2xs text-zinc-500 truncate max-w-[10rem]" title={e.note}>
                            {e.note}
                          </div>
                        )}
                      </td>
                      <td className={`text-right tabular-nums font-medium ${isNeg ? 'text-red-400' : 'text-emerald-400'}`}>
                        {formatDelta(delta)} {unit}
                      </td>
                      <td className="text-right tabular-nums text-white">
                        {Number(e.quantity_after).toLocaleString('ru-RU', { maximumFractionDigits: 4 })} {unit}
                      </td>
                      <td className="text-2xs text-zinc-400 max-w-[6rem] truncate" title={e.user_name || e.user_login || ''}>
                        {e.user_name || e.user_login || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 flex justify-end shrink-0">
          <button type="button" onClick={onClose} className="btn-secondary">
            Закрыть
          </button>
        </div>
      </HistoryPanel>
    </div>
  );
}

function HistoryPanel({ children }) {
  return (
    <div
      className="card p-5 max-w-2xl w-full max-h-[85vh] flex flex-col"
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
}
