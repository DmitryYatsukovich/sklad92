import { useState, useEffect, useMemo, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { materials as materialsApi, operations as operationsApi } from '../api';

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function remainingQty(i) {
  return parseFloat(i.quantity) - parseFloat(i.returned_quantity || 0);
}

export default function Issuance() {
  const location = useLocation();
  const [issuances, setIssuances] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [returnRow, setReturnRow] = useState(null);
  const [returnQuantity, setReturnQuantity] = useState('');
  const [submitting, setSubmitting] = useState(false);

  /** Актуальные цены со склада — пересчёт при каждом изменении материала */
  const materialPrices = useMemo(() => {
    const map = new Map();
    for (const m of materials) {
      map.set(m.id, {
        price: Number(m.price ?? 0),
        production_price: Number(m.production_price ?? 0),
      });
    }
    return map;
  }, [materials]);

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    Promise.all([operationsApi.issuances(), materialsApi.list()])
      .then(([iss, mats]) => {
        setIssuances(iss);
        setMaterials(mats);
      })
      .catch((e) => setError(e.message))
      .finally(() => { if (!silent) setLoading(false); });
  }, []);

  useEffect(() => {
    if (location.pathname !== '/issuance') return undefined;
    load();
    const t = setInterval(() => load(true), 5000);
    const onVisible = () => {
      if (document.visibilityState === 'visible' && location.pathname === '/issuance') {
        load(true);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [location.pathname, load]);

  const sortedIssuances = useMemo(
    () => [...issuances].sort((a, b) => new Date(b.issued_at) - new Date(a.issued_at)),
    [issuances],
  );

  const openReturn = (row) => {
    const returned = Number(row.returned_quantity || 0);
    setReturnRow(row);
    setReturnQuantity(returned > 0 ? String(returned) : '');
    setError('');
  };

  const closeReturn = () => {
    setReturnRow(null);
    setReturnQuantity('');
  };

  const handleReturn = async (e) => {
    e.preventDefault();
    if (!returnRow) return;
    const totalReturned = parseFloat(returnQuantity);
    const issued = Number(returnRow.quantity);
    if (Number.isNaN(totalReturned) || totalReturned < 0) {
      return setError('Укажите корректное количество');
    }
    if (totalReturned > issued) {
      return setError(`Не больше выданного: ${issued} ${returnRow.unit}`);
    }
    setSubmitting(true);
    setError('');
    try {
      await operationsApi.setReturnedQuantity(returnRow.id, totalReturned);
      closeReturn();
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="text-zinc-500 text-xs">Загрузка…</div>;
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="page-title">Выдача</h2>
        <div className="flex items-center gap-2">
          <span className="text-2xs text-zinc-500">Записей: {sortedIssuances.length}</span>
          <button type="button" onClick={() => load()} className="btn-ghost text-2xs">
            Обновить
          </button>
        </div>
      </div>

      {error && <p className="alert-error">{error}</p>}

      <div className="table-wrap">
        <div className="overflow-x-auto max-h-[calc(100vh-6rem)] overflow-y-auto">
          <table className="table-compact">
            <thead className="sticky top-0 bg-surface-900 z-10">
              <tr>
                <th>Дата</th>
                <th>Материал</th>
                <th>Кому выдан</th>
                <th className="text-right">Кол-во</th>
                <th className="text-right">Стоимость</th>
                <th className="text-right">СМР</th>
                <th className="w-24 text-right" />
              </tr>
            </thead>
            <tbody>
              {sortedIssuances.map((i) => {
                const qty = Number(i.quantity);
                const returned = Number(i.returned_quantity || 0);
                const left = remainingQty(i);
                const mp = materialPrices.get(i.material_id);
                const unitPrice = mp?.price ?? Number(i.price ?? 0);
                const unitSmr = mp?.production_price ?? Number(i.production_price ?? 0);
                const netQty = left > 0 ? left : 0;
                const cost = netQty * unitPrice;
                const smr = netQty * unitSmr;
                const canReturn = left > 0.000001;

                return (
                  <tr key={i.id}>
                    <td className="text-zinc-500 text-2xs whitespace-nowrap">{formatDate(i.issued_at)}</td>
                    <td className="text-white max-w-[10rem]">
                      <div className="truncate font-medium" title={i.material_name}>{i.material_name}</div>
                      <div className="text-2xs text-zinc-500 font-mono truncate">{i.material_code}</div>
                    </td>
                    <td className="text-zinc-300 max-w-[8rem] truncate" title={i.issued_to_name || i.issued_to_login}>
                      {i.issued_to_name || i.issued_to_login}
                    </td>
                    <td className="text-right tabular-nums">
                      <span className="text-white">{qty}</span>
                      <span className="text-zinc-500 text-2xs"> {i.unit}</span>
                      {returned > 0 && (
                        <div className="text-2xs text-zinc-500">верн. {returned}</div>
                      )}
                    </td>
                    <td className="text-right text-zinc-400 tabular-nums">{cost.toFixed(2)}</td>
                    <td className="text-right text-zinc-400 tabular-nums">{smr.toFixed(2)}</td>
                    <td className="text-right">
                      {canReturn || returned > 0 ? (
                        <button type="button" onClick={() => openReturn(i)} className="btn-ghost px-1 text-xs">
                          {returned > 0 ? 'Изменить' : 'Возврат'}
                        </button>
                      ) : (
                        <span className="text-2xs text-zinc-600">закрыто</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {sortedIssuances.length === 0 && (
          <p className="p-6 text-center text-zinc-500 text-xs">Выдач пока нет</p>
        )}
      </div>

      {returnRow && (
        <div className="modal-backdrop z-50" onClick={closeReturn}>
          <div className="card p-5 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-white mb-1">Возврат на склад</h3>
            <p className="text-zinc-400 text-xs mb-3">
              {returnRow.material_name} → {returnRow.issued_to_name || returnRow.issued_to_login}
            </p>
            <p className="text-zinc-500 text-xs mb-4">
              Выдано: {Number(returnRow.quantity)} {returnRow.unit}, возвращено: {Number(returnRow.returned_quantity || 0)} {returnRow.unit},
              осталось: <span className="text-white">{remainingQty(returnRow)} {returnRow.unit}</span>
            </p>
            {error && <p className="alert-error mb-3">{error}</p>}
            <form onSubmit={handleReturn} className="space-y-3">
              <div>
                <label className="label">Всего возвращено на склад</label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  max={Number(returnRow.quantity)}
                  value={returnQuantity}
                  onChange={(e) => setReturnQuantity(e.target.value)}
                  className="input"
                  autoFocus
                  required
                />
                <p className="text-2xs text-zinc-500 mt-1">
                  Итоговое количество на складе (0 — без возврата). У получателя остаётся: {remainingQty(returnRow)} {returnRow.unit}
                </p>
              </div>
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={closeReturn} className="btn-ghost" disabled={submitting}>
                  Отмена
                </button>
                <button type="submit" className="btn-primary" disabled={submitting}>
                  {submitting ? '…' : 'Сохранить'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
