import { useState, useEffect } from 'react';
import { materials as materialsApi, operations as operationsApi } from '../api';
import QrScanner from '../components/QrScanner';

export default function Issuance({ user }) {
  const [materials, setMaterials] = useState([]);
  const [users, setUsers] = useState([]);
  const [issuances, setIssuances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mode, setMode] = useState('issue'); // issue | return
  const [showScanIssue, setShowScanIssue] = useState(false);
  const [showScanReturn, setShowScanReturn] = useState(false);
  const [scannedMaterial, setScannedMaterial] = useState(null);
  const [selectedMaterialId, setSelectedMaterialId] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [returnIssuanceId, setReturnIssuanceId] = useState('');
  const [returnQuantity, setReturnQuantity] = useState('');
  const [issuancesForMaterial, setIssuancesForMaterial] = useState([]);
  const [showReturnForm, setShowReturnForm] = useState(false);

  const load = () => {
    materialsApi.list().then(setMaterials).catch(() => setMaterials([]));
    materialsApi.usersForIssuance().then(setUsers).catch(() => setUsers([]));
    operationsApi.issuances().then(setIssuances).catch(() => setIssuances([]));
  };

  useEffect(() => {
    setLoading(true);
    load();
    setLoading(false);
  }, []);

  useEffect(() => {
    const refresh = () => {
      materialsApi.list().then(setMaterials).catch(() => {});
      materialsApi.usersForIssuance().then(setUsers).catch(() => {});
      operationsApi.issuances().then(setIssuances).catch(() => {});
    };
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, []);

  const handleIssue = async (e) => {
    e.preventDefault();
    setError('');
    const matId = selectedMaterialId || scannedMaterial?.id;
    if (!matId || !selectedUserId || !(parseFloat(quantity) > 0)) {
      return setError('Укажите материал, получателя и количество');
    }
    try {
      await operationsApi.issue({
        material_id: parseInt(matId, 10),
        issued_to_user_id: parseInt(selectedUserId, 10),
        quantity: parseFloat(quantity),
        note: note.trim() || undefined,
      });
      setQuantity('');
      setNote('');
      setSelectedMaterialId('');
      setScannedMaterial(null);
      setShowScanIssue(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleScanForIssue = (decoded) => {
    const code = (decoded || '').trim();
    if (!code) return;
    materialsApi.byCode(code).then((m) => {
      setScannedMaterial(m);
    }).catch(() => setScannedMaterial(null));
  };

  const handleScanForReturn = (decoded) => {
    const code = (decoded || '').trim();
    if (!code) return;
    materialsApi.byCode(code).then((m) => {
      setScannedMaterial(m);
      const list = issuances.filter(
        (i) => i.material_id === m.id && (parseFloat(i.returned_quantity || 0) < parseFloat(i.quantity))
      );
      setIssuancesForMaterial(list);
    }).catch(() => {
      setScannedMaterial(null);
      setIssuancesForMaterial([]);
    });
  };

  const handleReturn = async (e) => {
    e.preventDefault();
    setError('');
    const issId = returnIssuanceId;
    const qty = parseFloat(returnQuantity);
    if (!issId || !(qty > 0)) return setError('Укажите выдачу и количество возврата');
    try {
      await operationsApi.return({ issuance_id: parseInt(issId, 10), returned_quantity: qty });
      setReturnIssuanceId('');
      setReturnQuantity('');
      setScannedMaterial(null);
      setIssuancesForMaterial([]);
      setShowScanReturn(false);
      setShowReturnForm(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const openReturnForIssuance = (iss) => {
    setReturnIssuanceId(String(iss.id));
    const left = parseFloat(iss.quantity) - parseFloat(iss.returned_quantity || 0);
    setReturnQuantity(String(left));
    setShowReturnForm(true);
  };

  const pendingIssuances = issuances.filter(
    (i) => parseFloat(i.returned_quantity || 0) < parseFloat(i.quantity)
  );

  if (loading) return <div className="text-slate-400">Загрузка…</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-xl font-semibold text-white">Выдача</h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => { setShowScanIssue(true); setScannedMaterial(null); setError(''); }}
            className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium"
          >
            Выдать по QR
          </button>
          <button
            type="button"
            onClick={() => { setShowScanReturn(true); setScannedMaterial(null); setIssuancesForMaterial([]); setError(''); }}
            className="px-4 py-2 rounded-xl bg-slate-600 hover:bg-slate-500 text-white text-sm font-medium"
          >
            Возврат по QR
          </button>
        </div>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {/* Форма выдачи */}
      <div className="bg-surface-800 rounded-xl border border-slate-700/50 p-6">
        <h3 className="text-lg font-medium text-white mb-4">Выдать материал</h3>
        {(showScanIssue && scannedMaterial) ? (
          <div className="space-y-4">
            <p className="text-slate-400">
              По QR: <strong className="text-white">{scannedMaterial.name}</strong> ({scannedMaterial.code})
            </p>
            <form onSubmit={handleIssue} className="space-y-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">Получатель</label>
                <select
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-slate-600 text-white"
                  required
                >
                  <option value="">— Выберите —</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>{u.display_name || u.login}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Количество</label>
                <input
                  type="number"
                  step="any"
                  min="0.0001"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-slate-600 text-white"
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Примечание</label>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-slate-600 text-white"
                />
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => { setScannedMaterial(null); }} className="px-4 py-2 rounded-xl text-slate-400 hover:text-white">
                  Сканировать снова
                </button>
                <button type="submit" className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white">
                  Выдать
                </button>
                <button type="button" onClick={() => { setShowScanIssue(false); setScannedMaterial(null); }} className="px-4 py-2 rounded-xl border border-slate-600 text-slate-400 hover:text-white">
                  Закрыть
                </button>
              </div>
            </form>
          </div>
        ) : showScanIssue ? (
          <QrScanner onScan={handleScanForIssue} onClose={() => { setShowScanIssue(false); setError(''); }} />
        ) : (
          <form onSubmit={handleIssue} className="space-y-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Материал</label>
              <select
                value={selectedMaterialId}
                onChange={(e) => setSelectedMaterialId(e.target.value)}
                className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-slate-600 text-white"
                required
              >
                <option value="">— Выберите —</option>
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>{m.name} ({m.code}) — {Number(m.quantity)} {m.unit}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Получатель</label>
              <select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-slate-600 text-white"
                required
              >
                <option value="">— Выберите —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.display_name || u.login}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Количество</label>
              <input
                type="number"
                step="any"
                min="0.0001"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-slate-600 text-white"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Примечание</label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-slate-600 text-white"
              />
            </div>
            <button type="submit" className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white">
              Выдать
            </button>
          </form>
        )}
      </div>

      {/* Возврат по QR */}
      {showReturnForm && returnIssuanceId && (() => {
        const iss = pendingIssuances.find((i) => String(i.id) === returnIssuanceId);
        return (
        <div className="bg-surface-800 rounded-xl border border-slate-700/50 p-6">
          <h3 className="text-lg font-medium text-white mb-4">Возврат на склад</h3>
          {iss && (
            <p className="text-slate-400 text-sm mb-4">
              {iss.material_name} → {iss.issued_to_name || iss.issued_to_login}, выдано {Number(iss.quantity)} {iss.unit}, возвращено {Number(iss.returned_quantity || 0)} {iss.unit}.
            </p>
          )}
          <form onSubmit={handleReturn} className="space-y-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Количество возврата</label>
              <input
                type="number"
                step="any"
                min="0.0001"
                value={returnQuantity}
                onChange={(e) => setReturnQuantity(e.target.value)}
                className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-slate-600 text-white"
                required
              />
            </div>
            <div className="flex gap-2">
              <button type="submit" className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white">
                Вернуть
              </button>
              <button type="button" onClick={() => { setShowReturnForm(false); setReturnIssuanceId(''); setReturnQuantity(''); }} className="px-4 py-2 rounded-xl border border-slate-600 text-slate-400 hover:text-white">
                Отмена
              </button>
            </div>
          </form>
        </div>
        );
      })()}

      {showScanReturn && scannedMaterial && issuancesForMaterial.length > 0 && (
        <div className="bg-surface-800 rounded-xl border border-slate-700/50 p-6">
          <h3 className="text-lg font-medium text-white mb-2">Возврат на склад</h3>
          <p className="text-slate-400 text-sm mb-4">Материал: {scannedMaterial.name}. Выберите выдачу и укажите количество возврата.</p>
          <form onSubmit={handleReturn} className="space-y-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Выдача</label>
              <select
                value={returnIssuanceId}
                onChange={(e) => {
                  const id = e.target.value;
                  setReturnIssuanceId(id);
                  const iss = issuancesForMaterial.find((i) => String(i.id) === id);
                  if (iss) {
                    const left = parseFloat(iss.quantity) - parseFloat(iss.returned_quantity || 0);
                    setReturnQuantity(String(left));
                  }
                }}
                className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-slate-600 text-white"
                required
              >
                <option value="">— Выберите —</option>
                {issuancesForMaterial.map((i) => {
                  const left = parseFloat(i.quantity) - parseFloat(i.returned_quantity || 0);
                  return (
                    <option key={i.id} value={i.id}>
                      {i.issued_to_name || i.issued_to_login} — выдано {Number(i.quantity)}, возвращено {Number(i.returned_quantity || 0)}, осталось {left}
                    </option>
                  );
                })}
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Количество возврата</label>
              <input
                type="number"
                step="any"
                min="0.0001"
                value={returnQuantity}
                onChange={(e) => setReturnQuantity(e.target.value)}
                className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-slate-600 text-white"
                required
              />
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => { setScannedMaterial(null); setIssuancesForMaterial([]); }} className="px-4 py-2 rounded-xl text-slate-400 hover:text-white">
                Сканировать снова
              </button>
              <button type="submit" className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white">
                Вернуть на склад
              </button>
              <button type="button" onClick={() => { setShowScanReturn(false); setScannedMaterial(null); setIssuancesForMaterial([]); }} className="px-4 py-2 rounded-xl border border-slate-600 text-slate-400 hover:text-white">
                Закрыть
              </button>
            </div>
          </form>
        </div>
      )}

      {showScanReturn && !scannedMaterial && (
        <QrScanner onScan={handleScanForReturn} onClose={() => { setShowScanReturn(false); setError(''); }} />
      )}

      {showScanReturn && scannedMaterial && issuancesForMaterial.length === 0 && (
        <div className="bg-surface-800 rounded-xl border border-slate-700/50 p-6">
          <p className="text-slate-400">По материалу «{scannedMaterial.name}» нет открытых выдач для возврата.</p>
          <button type="button" onClick={() => { setScannedMaterial(null); }} className="mt-4 px-4 py-2 rounded-xl text-brand-400 hover:text-brand-300">
            Сканировать другой
          </button>
        </div>
      )}

      {/* Список выдач */}
      <div className="rounded-xl border border-slate-700/50 bg-surface-800 overflow-hidden">
        <h3 className="p-4 text-lg font-medium text-white border-b border-slate-700">Последние выдачи</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-slate-700 text-slate-400 text-sm">
                <th className="p-4 font-medium">Дата</th>
                <th className="p-4 font-medium">Материал</th>
                <th className="p-4 font-medium">Кому</th>
                <th className="p-4 font-medium">Кол-во</th>
                <th className="p-4 font-medium">Возврат</th>
                <th className="p-4 font-medium">Действие</th>
              </tr>
            </thead>
            <tbody>
              {pendingIssuances.slice(0, 50).map((i) => {
                const left = parseFloat(i.quantity) - parseFloat(i.returned_quantity || 0);
                return (
                  <tr key={i.id} className="border-b border-slate-700/50 hover:bg-slate-800/30">
                    <td className="p-4 text-slate-400 text-sm">{new Date(i.issued_at).toLocaleString('ru')}</td>
                    <td className="p-4 text-white">{i.material_name} ({i.material_code})</td>
                    <td className="p-4 text-white">{i.issued_to_name || i.issued_to_login}</td>
                    <td className="p-4 text-white">{Number(i.quantity)} {i.unit}</td>
                    <td className="p-4 text-slate-400">{Number(i.returned_quantity || 0)} {i.unit}</td>
                    <td className="p-4">
                      {left > 0 && (
                        <button
                          type="button"
                          onClick={() => openReturnForIssuance(i)}
                          className="text-brand-400 hover:text-brand-300 text-sm"
                        >
                          Возврат
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {pendingIssuances.length === 0 && (
          <p className="p-8 text-center text-slate-500">Нет открытых выдач</p>
        )}
      </div>
    </div>
  );
}
