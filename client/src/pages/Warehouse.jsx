import { useState, useEffect } from 'react';
import { materials as materialsApi, settings as settingsApi } from '../api';
import QrScanner from '../components/QrScanner';
import { QRCodeSVG } from 'qrcode.react';
import { operations } from '../api';
import MaterialLocationFields from '../components/MaterialLocationFields';
import {
  UNITS, emptyMaterialForm, materialToForm, formToPayload, locationLabel,
} from '../lib/materialForm';

export default function Warehouse({ user }) {
  const [list, setList] = useState([]);
  const [catalog, setCatalog] = useState({ objects: [], warehouses: [], racks: [], categories: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyMaterialForm);
  const [showAddQty, setShowAddQty] = useState(null);
  const [showScan, setShowScan] = useState(false);
  const [addQtyAmount, setAddQtyAmount] = useState('');
  const [issueQty, setIssueQty] = useState('');
  const [issueToUserId, setIssueToUserId] = useState('');
  const [users, setUsers] = useState([]);
  const [scannedMaterial, setScannedMaterial] = useState(null);
  const [scanAction, setScanAction] = useState(null); // 'add' | 'issue'
  const [showQrMaterial, setShowQrMaterial] = useState(null);

  const load = () => {
    setLoading(true);
    materialsApi.list().then(setList).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };

  const loadCatalog = () => {
    settingsApi.catalog().then(setCatalog).catch(() => {});
  };

  useEffect(() => {
    load();
    loadCatalog();
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      materialsApi.list().then(setList).catch(() => {});
    }, 5000);
    return () => clearInterval(t);
  }, []);

  const loadUsers = () => {
    materialsApi.usersForIssuance().then(setUsers).catch(() => setUsers([]));
  };

  const openAdd = () => {
    setForm(emptyMaterialForm());
    setShowAdd(true);
    setEditing(null);
    setError('');
    loadCatalog();
  };

  const openEdit = (m) => {
    setForm(materialToForm(m));
    setEditing(m);
    setShowAdd(false);
    setError('');
    loadCatalog();
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await materialsApi.create(formToPayload(form, { includeQuantity: true }));
      setForm(emptyMaterialForm());
      setShowAdd(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleEdit = async (e) => {
    e.preventDefault();
    if (!editing) return;
    setError('');
    try {
      await materialsApi.update(editing.id, formToPayload(form));
      setEditing(null);
      setForm(emptyMaterialForm());
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleAddQuantity = async (e) => {
    e.preventDefault();
    if (!showAddQty) return;
    const amount = parseFloat(addQtyAmount);
    if (!(amount > 0)) return setError('Укажите количество');
    setError('');
    try {
      await materialsApi.addQuantity(showAddQty.id, amount);
      setAddQtyAmount('');
      setShowAddQty(null);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleScan = (decoded) => {
    const code = (decoded || '').trim();
    if (!code) return;
    materialsApi
      .byCode(code)
      .then((m) => {
        setScannedMaterial(m);
        loadUsers();
      })
      .catch(() => setScannedMaterial(null));
  };

  const handleAddQtyFromScan = async (e) => {
    e.preventDefault();
    if (!scannedMaterial) return;
    const amount = parseFloat(addQtyAmount);
    if (!(amount > 0)) return setError('Укажите количество');
    setError('');
    try {
      await materialsApi.addQuantity(scannedMaterial.id, amount);
      setAddQtyAmount('');
      setScannedMaterial(null);
      setScanAction(null);
      setShowScan(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleIssueFromScan = async (e) => {
    e.preventDefault();
    if (!scannedMaterial) return;
    const qty = parseFloat(issueQty);
    if (!(qty > 0)) return setError('Укажите количество');
    if (!issueToUserId) return setError('Выберите получателя');
    setError('');
    try {
      await operations.issue({
        material_id: scannedMaterial.id,
        issued_to_user_id: parseInt(issueToUserId, 10),
        quantity: qty,
      });
      setIssueQty('');
      setIssueToUserId('');
      setScannedMaterial(null);
      setScanAction(null);
      setShowScan(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const closeScan = () => {
    setShowScan(false);
    setScannedMaterial(null);
    setScanAction(null);
    setAddQtyAmount('');
    setIssueQty('');
    setIssueToUserId('');
    setError('');
  };

  if (loading) {
    return <div className="text-slate-400">Загрузка…</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-xl font-semibold text-white">Склад</h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => { setShowScan(true); setScannedMaterial(null); setScanAction(null); setError(''); }}
            className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium"
          >
            Сканировать QR
          </button>
          <button
            type="button"
            onClick={openAdd}
            className="px-4 py-2 rounded-xl bg-slate-600 hover:bg-slate-500 text-white text-sm font-medium"
          >
            Добавить материал
          </button>
        </div>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <div className="rounded-xl border border-slate-700/50 bg-surface-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-slate-700 text-slate-400 text-sm">
                <th className="p-3 font-medium">Код</th>
                <th className="p-3 font-medium">Наименование</th>
                <th className="p-3 font-medium">Размещение</th>
                <th className="p-3 font-medium">Категория</th>
                <th className="p-3 font-medium">Ед.</th>
                <th className="p-3 font-medium">Цена</th>
                <th className="p-3 font-medium">Цена выраб.</th>
                <th className="p-3 font-medium">Кол-во</th>
                <th className="p-3 font-medium w-36">Действия</th>
              </tr>
            </thead>
            <tbody>
              {list.map((m) => (
                <tr key={m.id} className="border-b border-slate-700/50 hover:bg-slate-800/30">
                  <td className="p-3">
                    <span className="font-mono text-brand-300 text-sm">{m.code}</span>
                  </td>
                  <td className="p-3 text-white">{m.name}</td>
                  <td className="p-3 text-slate-400 text-sm max-w-[10rem]" title={locationLabel(m)}>{locationLabel(m)}</td>
                  <td className="p-3 text-slate-400 text-sm">{m.category_name || '—'}</td>
                  <td className="p-3 text-slate-400">{m.unit}</td>
                  <td className="p-3 text-slate-400">{Number(m.price ?? 0).toFixed(2)}</td>
                  <td className="p-3 text-slate-400">{Number(m.production_price ?? 0).toFixed(2)}</td>
                  <td className="p-3 text-white font-medium">{Number(m.quantity)}</td>
                  <td className="p-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button type="button" onClick={() => openEdit(m)} className="text-slate-300 hover:text-white text-sm">Изм.</button>
                      <button
                        type="button"
                        onClick={() => { setShowAddQty(m); setAddQtyAmount(''); setError(''); }}
                        className="text-brand-400 hover:text-brand-300 text-sm"
                      >
                        Приход
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setShowQrMaterial(m); }}
                        className="inline-block p-1 rounded hover:bg-slate-700/50 transition-colors cursor-pointer"
                        title="Нажмите, чтобы увеличить QR"
                      >
                        <span className="block [&>svg]:pointer-events-none">
                          <QRCodeSVG value={m.code} size={32} level="M" className="rounded" />
                        </span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.length === 0 && (
          <p className="p-8 text-center text-slate-500">Нет материалов. Добавьте первый.</p>
        )}
      </div>

      {showQrMaterial && (
        <div
          className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4"
          onClick={() => setShowQrMaterial(null)}
          role="dialog"
          aria-modal="true"
          aria-label="QR-код"
        >
          <div
            className="bg-surface-800 rounded-2xl border border-slate-600 p-6 flex flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-white font-medium mb-2">{showQrMaterial.name}</p>
            <p className="text-slate-400 text-sm mb-4 font-mono">{showQrMaterial.code}</p>
            <QRCodeSVG value={showQrMaterial.code} size={256} level="M" className="rounded-lg bg-white p-2" />
            <button
              type="button"
              onClick={() => setShowQrMaterial(null)}
              className="mt-4 px-4 py-2 rounded-xl bg-slate-600 hover:bg-slate-500 text-white text-sm"
            >
              Закрыть
            </button>
          </div>
        </div>
      )}

      {(showAdd || editing) && (
        <div className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-surface-800 rounded-2xl border border-slate-600 p-6 max-w-lg w-full my-8 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-medium text-white mb-2">{editing ? 'Редактирование материала' : 'Новый материал'}</h3>
            {editing ? <p className="text-slate-500 text-sm mb-4 font-mono">{editing.code}</p> : <p className="text-slate-500 text-sm mb-4">QR-код создаётся автоматически.</p>}
            <form onSubmit={editing ? handleEdit : handleAdd} className="space-y-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">Наименование</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-slate-600 text-white"
                  required
                />
              </div>
              <MaterialLocationFields catalog={catalog} form={form} setForm={setForm} />
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Ед. изм.</label>
                  <select value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))} className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-slate-600 text-white">
                    {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                {!editing && (
                  <div>
                    <label className="block text-sm text-slate-400 mb-1">Количество</label>
                    <input type="number" step="any" min="0" value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-slate-600 text-white" />
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Цена</label>
                  <input type="number" step="0.01" min="0" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-slate-600 text-white" />
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Цена за выработку</label>
                  <input type="number" step="0.01" min="0" value={form.production_price} onChange={(e) => setForm((f) => ({ ...f, production_price: e.target.value }))} className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-slate-600 text-white" />
                </div>
              </div>
              {editing && <p className="text-slate-500 text-xs">Измените объект, склад и стеллаж для переноса на другое место.</p>}
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => { setShowAdd(false); setEditing(null); setForm(emptyMaterialForm()); }} className="px-4 py-2 rounded-xl text-slate-400 hover:text-white">Отмена</button>
                <button type="submit" className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white">{editing ? 'Сохранить' : 'Добавить'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showAddQty && (
        <div className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-surface-800 rounded-2xl border border-slate-600 p-6 max-w-md w-full">
            <h3 className="text-lg font-medium text-white mb-2">Приход: {showAddQty.name}</h3>
            <p className="text-slate-400 text-sm mb-4">Код: {showAddQty.code}</p>
            <form onSubmit={handleAddQuantity} className="space-y-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">Количество</label>
                <input
                  type="number"
                  step="any"
                  min="0.0001"
                  value={addQtyAmount}
                  onChange={(e) => setAddQtyAmount(e.target.value)}
                  className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-slate-600 text-white"
                  required
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => setShowAddQty(null)} className="px-4 py-2 rounded-xl text-slate-400 hover:text-white">
                  Отмена
                </button>
                <button type="submit" className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white">
                  Оформить приход
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showScan && (
        <>
          {!scannedMaterial ? (
            <QrScanner onScan={handleScan} onClose={closeScan} />
          ) : !scanAction ? (
            <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
              <div className="bg-surface-800 rounded-2xl border border-slate-600 p-6 max-w-md w-full">
                <h3 className="text-lg font-medium text-white mb-2">Материал найден</h3>
                <p className="text-slate-400 text-sm mb-4">
                  <strong className="text-white">{scannedMaterial.name}</strong> ({scannedMaterial.code}). На складе: {Number(scannedMaterial.quantity)} {scannedMaterial.unit}.
                </p>
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => setScanAction('add')}
                    className="w-full px-4 py-3 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-medium"
                  >
                    Приход
                  </button>
                  <button
                    type="button"
                    onClick={() => setScanAction('issue')}
                    className="w-full px-4 py-3 rounded-xl bg-slate-600 hover:bg-slate-500 text-white font-medium"
                  >
                    Выдача
                  </button>
                  <button type="button" onClick={() => setScannedMaterial(null)} className="w-full py-2 text-slate-400 hover:text-white text-sm">
                    Сканировать снова
                  </button>
                </div>
                <button type="button" onClick={closeScan} className="mt-4 w-full py-2 rounded-xl border border-slate-600 text-slate-400 hover:text-white">
                  Закрыть
                </button>
              </div>
            </div>
          ) : scanAction === 'add' ? (
            <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
              <div className="bg-surface-800 rounded-2xl border border-slate-600 p-6 max-w-md w-full">
                <h3 className="text-lg font-medium text-white mb-2">Приход: {scannedMaterial.name}</h3>
                <form onSubmit={handleAddQtyFromScan} className="space-y-4">
                  <div>
                    <label className="block text-sm text-slate-400 mb-1">Количество</label>
                    <input
                      type="number"
                      step="any"
                      min="0.0001"
                      value={addQtyAmount}
                      onChange={(e) => setAddQtyAmount(e.target.value)}
                      className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-slate-600 text-white"
                      required
                    />
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setScanAction(null)} className="px-4 py-2 rounded-xl text-slate-400 hover:text-white">
                      Назад
                    </button>
                    <button type="submit" className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white">
                      Оформить приход
                    </button>
                  </div>
                </form>
              </div>
            </div>
          ) : (
            <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
              <div className="bg-surface-800 rounded-2xl border border-slate-600 p-6 max-w-md w-full">
                <h3 className="text-lg font-medium text-white mb-2">Выдача: {scannedMaterial.name}</h3>
                <form onSubmit={handleIssueFromScan} className="space-y-4">
                  <div>
                    <label className="block text-sm text-slate-400 mb-1">Получатель</label>
                    <select
                      value={issueToUserId}
                      onChange={(e) => setIssueToUserId(e.target.value)}
                      className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-slate-600 text-white"
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
                      value={issueQty}
                      onChange={(e) => setIssueQty(e.target.value)}
                      className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-slate-600 text-white"
                      required
                    />
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setScanAction(null)} className="px-4 py-2 rounded-xl text-slate-400 hover:text-white">
                      Назад
                    </button>
                    <button type="submit" className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white">
                      Выдать
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
