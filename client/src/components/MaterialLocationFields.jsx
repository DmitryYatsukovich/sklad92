export function warehousesForObject(catalog, objectId) {
  if (!objectId) return [];
  const oid = Number(objectId);
  return (catalog?.warehouses || []).filter((w) => w.object_id === oid);
}

export function racksForWarehouse(catalog, warehouseId) {
  if (!warehouseId) return [];
  const wid = Number(warehouseId);
  return (catalog?.racks || []).filter((r) => r.warehouse_id === wid);
}

export default function MaterialLocationFields({ catalog, form, setForm, showCategory = true }) {
  const warehouses = warehousesForObject(catalog, form.object_id);
  const racks = racksForWarehouse(catalog, form.warehouse_id);
  const selectCls = 'w-full px-4 py-2 rounded-xl bg-slate-800 border border-slate-600 text-white';

  const onObject = (v) => {
    const wh = warehousesForObject(catalog, v);
    const keepWh = wh.some((w) => String(w.id) === String(form.warehouse_id));
    const rackList = keepWh ? racksForWarehouse(catalog, form.warehouse_id) : [];
    const keepRack = rackList.some((r) => String(r.id) === String(form.rack_id));
    setForm((f) => ({
      ...f,
      object_id: v,
      warehouse_id: keepWh ? f.warehouse_id : '',
      rack_id: keepRack ? f.rack_id : '',
    }));
  };

  const onWarehouse = (v) => {
    const rackList = racksForWarehouse(catalog, v);
    const keepRack = rackList.some((r) => String(r.id) === String(form.rack_id));
    setForm((f) => ({
      ...f,
      warehouse_id: v,
      rack_id: keepRack ? f.rack_id : '',
    }));
  };

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm text-slate-400 mb-1">Объект</label>
          <select value={form.object_id} onChange={(e) => onObject(e.target.value)} className={selectCls}>
            <option value="">— Не указан —</option>
            {(catalog?.objects || []).map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm text-slate-400 mb-1">Склад</label>
          <select
            value={form.warehouse_id}
            onChange={(e) => onWarehouse(e.target.value)}
            className={selectCls}
            disabled={!form.object_id}
          >
            <option value="">— Не указан —</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm text-slate-400 mb-1">Стеллаж</label>
          <select
            value={form.rack_id}
            onChange={(e) => setForm((f) => ({ ...f, rack_id: e.target.value }))}
            className={selectCls}
            disabled={!form.warehouse_id}
          >
            <option value="">— Не указан —</option>
            {racks.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>
        {showCategory && (
          <div>
            <label className="block text-sm text-slate-400 mb-1">Категория</label>
            <select
              value={form.category_id}
              onChange={(e) => setForm((f) => ({ ...f, category_id: e.target.value }))}
              className={selectCls}
            >
              <option value="">— Не указана —</option>
              {(catalog?.categories || []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>
      {!catalog?.objects?.length && (
        <p className="text-amber-400/90 text-xs mt-2">
          Справочники пусты. Добавьте объекты и склады во вкладке «Настройка».
        </p>
      )}
    </>
  );
}
