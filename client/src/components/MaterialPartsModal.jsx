import { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { materials as materialsApi } from '../api';
import MaterialLocationFields from './MaterialLocationFields';
import MaterialQrModal from './MaterialQrModal';
import MaterialStockSummary from './MaterialStockSummary';
import { materialDisplayName, materialQrHoverTitle, materialGroupSummary } from '../lib/materialDisplay';
import { locationLabel, materialToForm, formToPayload, UNITS } from '../lib/materialForm';

export default function MaterialPartsModal({
  material,
  catalog,
  onClose,
  onUpdated,
  onOpenMenu,
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [parent, setParent] = useState(null);
  const [parts, setParts] = useState([]);
  const [qrPart, setQrPart] = useState(null);
  const [editingPart, setEditingPart] = useState(null);
  const [partForm, setPartForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [addPartOpen, setAddPartOpen] = useState(false);
  const [addForm, setAddForm] = useState({ quantity: '', object_id: '', warehouse_id: '', rack_id: '', part_label: '' });

  const load = () => {
    if (!material?.id) return;
    setLoading(true);
    setError('');
    materialsApi
      .getParts(material.id)
      .then((data) => {
        if (!data.isGroup) {
          onOpenMenu?.(data.parent || material);
          onClose();
          return;
        }
        setParent(data.parent);
        setParts(data.parts || []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [material?.id]);

  const openEditPart = (p) => {
    setEditingPart(p);
    setPartForm(materialToForm(p));
  };

  const savePartEdit = async (e) => {
    e.preventDefault();
    if (!editingPart || !partForm) return;
    setSaving(true);
    setError('');
    try {
      await materialsApi.update(editingPart.id, formToPayload(partForm, {
        includeQuantity: true,
        includePartLabel: true,
      }));
      setEditingPart(null);
      setPartForm(null);
      load();
      onUpdated?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const submitAddPart = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await materialsApi.addPart(parent?.id || material.id, {
        quantity: parseFloat(addForm.quantity) || 0,
        object_id: addForm.object_id || null,
        warehouse_id: addForm.warehouse_id || null,
        rack_id: addForm.rack_id || null,
        part_label: addForm.part_label.trim() || undefined,
      });
      setAddPartOpen(false);
      setAddForm({ quantity: '', object_id: '', warehouse_id: '', rack_id: '', part_label: '' });
      load();
      onUpdated?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const totalQty = parts.reduce((s, p) => s + (Number(p.quantity) || 0), 0);

  return (
    <>
      <div className="modal-backdrop z-[65]" onClick={onClose} role="dialog" aria-modal="true">
        <div
          className="card p-5 max-w-2xl w-full max-h-[90vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <h3 className="text-white font-medium text-lg mb-1">{parent?.name || material?.name}</h3>
          <p className="text-zinc-500 text-xs font-mono mb-2">{parent?.code}</p>
          {parent && (
            <div className="mb-4">
              <MaterialStockSummary
                material={{ ...parent, quantity: totalQty }}
                className="text-left"
              />
            </div>
          )}
          {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
          {loading ? (
            <p className="text-zinc-500 text-sm">Загрузка…</p>
          ) : (
            <>
              <div className="flex justify-between items-center gap-2 mb-2">
                <p className="text-zinc-400 text-xs">Частей: {parts.length}</p>
                <button type="button" className="btn-secondary text-xs" onClick={() => setAddPartOpen(true)}>
                  + Часть
                </button>
              </div>
              <ul className="space-y-2 overflow-y-auto flex-1 min-h-0 pr-1">
                {parts.map((p) => (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-center gap-3 p-3 rounded-xl bg-zinc-900/80 border border-zinc-700"
                  >
                    <button
                      type="button"
                      className="shrink-0 p-1 rounded hover:bg-white/10"
                      title={materialQrHoverTitle(p)}
                      onClick={() => setQrPart(p)}
                    >
                      <QRCodeSVG value={p.code} size={40} level="M" className="rounded bg-white p-0.5" />
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-white font-medium">{materialDisplayName(p)}</p>
                      <p className="text-2xs text-zinc-500 font-mono">{p.code}</p>
                      <p className="text-2xs text-zinc-400 mt-0.5">{locationLabel(p)}</p>
                      <p className="text-xs text-zinc-300 mt-1 tabular-nums">
                        {Number(p.quantity) || 0} {p.unit}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1 flex-wrap">
                      <button type="button" className="btn-ghost text-xs px-2" onClick={() => openEditPart(p)}>
                        Изм
                      </button>
                      <button type="button" className="btn-ghost text-xs px-2" onClick={() => onOpenMenu?.(p)}>
                        Действия
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-zinc-800">
            <button type="button" className="btn-ghost text-sm" onClick={onClose}>
              Закрыть
            </button>
          </div>
        </div>
      </div>

      {editingPart && partForm && (
        <div className="modal-backdrop z-[70]" onClick={() => { setEditingPart(null); setPartForm(null); }}>
          <div className="card p-5 max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h4 className="text-white font-medium mb-1">Редактирование части</h4>
            <p className="text-zinc-500 text-xs font-mono mb-3">{editingPart.code}</p>
            <form onSubmit={savePartEdit} className="space-y-4">
              <div>
                <label className="label">Наименование материала</label>
                <input type="text" value={partForm.name} className="input opacity-60" disabled />
              </div>
              <div>
                <label className="label">Подпись части</label>
                <input
                  type="text"
                  value={partForm.part_label}
                  onChange={(e) => setPartForm((f) => ({ ...f, part_label: e.target.value }))}
                  className="input"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Количество</label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    required
                    value={partForm.quantity}
                    onChange={(e) => setPartForm((f) => ({ ...f, quantity: e.target.value }))}
                    className="input"
                  />
                </div>
                <div>
                  <label className="label">Ед. изм.</label>
                  <select
                    value={partForm.unit}
                    onChange={(e) => setPartForm((f) => ({ ...f, unit: e.target.value }))}
                    className="input"
                  >
                    {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>
              <MaterialLocationFields catalog={catalog} form={partForm} setForm={setPartForm} />
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Стоимость за ед.</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={partForm.price}
                    onChange={(e) => setPartForm((f) => ({ ...f, price: e.target.value }))}
                    className="input"
                  />
                </div>
                <div>
                  <label className="label">СМР за ед.</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={partForm.production_price}
                    onChange={(e) => setPartForm((f) => ({ ...f, production_price: e.target.value }))}
                    className="input"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-ghost text-sm" onClick={() => { setEditingPart(null); setPartForm(null); }}>
                  Отмена
                </button>
                <button type="submit" className="btn-primary text-sm" disabled={saving}>
                  {saving ? '…' : 'Сохранить'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {addPartOpen && (
        <div className="modal-backdrop z-[70]" onClick={() => setAddPartOpen(false)}>
          <div className="card p-5 max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
            <h4 className="text-white font-medium mb-3">Добавить часть</h4>
            <form onSubmit={submitAddPart} className="space-y-4">
              <div>
                <label className="label">Количество</label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  required
                  value={addForm.quantity}
                  onChange={(e) => setAddForm((f) => ({ ...f, quantity: e.target.value }))}
                  className="input"
                />
              </div>
              <div>
                <label className="label">Подпись (необязательно)</label>
                <input
                  type="text"
                  value={addForm.part_label}
                  onChange={(e) => setAddForm((f) => ({ ...f, part_label: e.target.value }))}
                  className="input"
                  placeholder="Бухта 5"
                />
              </div>
              <MaterialLocationFields catalog={catalog} form={addForm} setForm={setAddForm} />
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-ghost text-sm" onClick={() => setAddPartOpen(false)}>
                  Отмена
                </button>
                <button type="submit" className="btn-primary text-sm" disabled={saving}>
                  {saving ? '…' : 'Добавить'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {qrPart && (
        <MaterialQrModal
          material={qrPart}
          groupInfo={materialGroupSummary(qrPart)}
          onClose={() => setQrPart(null)}
        />
      )}
    </>
  );
}
