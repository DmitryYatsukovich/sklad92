import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { tools as toolsApi } from '../api';
import QrScanner from '../components/QrScanner';
import { useAutoRefreshOnVisible } from '../hooks/useAutoRefreshOnVisible';

function parseId(value) {
  const id = Number.parseInt(value, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function statusLabel(status) {
  if (status === 'in_use') return 'В работе';
  if (status === 'in_repair') return 'В ремонте';
  if (status === 'in_stock') return 'На складе';
  return 'Новый';
}

function statusClass(status) {
  if (status === 'in_use') return 'text-amber-300 bg-amber-500/10 border-amber-500/30';
  if (status === 'in_repair') return 'text-rose-300 bg-rose-500/10 border-rose-500/30';
  if (status === 'in_stock') return 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30';
  return 'text-sky-300 bg-sky-500/10 border-sky-500/30';
}

const STATUS_FILTERS = [
  { id: 'all', label: 'Все' },
  { id: 'new', label: 'Новый' },
  { id: 'in_use', label: 'В работе' },
  { id: 'in_repair', label: 'В ремонте' },
  { id: 'in_stock', label: 'На складе' },
];

function statusFilterButtonClass(active, status) {
  const tone = statusClass(status || 'new');
  return active
    ? `rounded-md border px-2 py-1 text-2xs font-medium ${tone}`
    : 'rounded-md border border-white/10 px-2 py-1 text-2xs text-zinc-300 bg-white/[0.02] hover:bg-white/[0.04]';
}

function actionLabel(action) {
  if (action === 'create') return 'Создан';
  if (action === 'update') return 'Изменение карточки';
  if (action === 'issue') return 'Выдача пользователю';
  if (action === 'receive') return 'Возврат на склад';
  if (action === 'repair') return 'Отправка в ремонт';
  if (action === 'move') return 'Перемещение';
  return action || 'Действие';
}

function formatDate(value, withTime = false) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  if (withTime) {
    return date.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  return date.toLocaleDateString('ru-RU');
}

function formatMoney(value) {
  const amount = Number(value || 0);
  return `${amount.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`;
}

function locationText(row) {
  const parts = [row.object_name, row.warehouse_name, row.rack_name].filter(Boolean);
  return parts.length ? parts.join(' → ') : '—';
}

function toolStatusInfoText(row) {
  if (!row) return 'Статус неизвестен';
  if (row.status === 'in_use') {
    return `Статус: В работе · Выдан: ${row.holder_user_name || '—'}`;
  }
  if (row.status === 'in_stock') {
    return `Статус: На складе · Склад: ${locationText(row)}`;
  }
  if (row.status === 'in_repair') {
    return `Статус: В ремонте · Ответственный: ${row.repair_by_user_name || '—'}`;
  }
  return `Статус: ${statusLabel(row.status)}`;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildToolQrPrintHtml(tool, svgEl) {
  const svgClone = svgEl.cloneNode(true);
  svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  if (!svgClone.getAttribute('width')) svgClone.setAttribute('width', '280');
  if (!svgClone.getAttribute('height')) svgClone.setAttribute('height', '280');
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>QR — ${escapeHtml(tool?.name || '')}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 28px;
      font-family: system-ui, -apple-system, sans-serif;
      color: #111;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    h1 { font-size: 20px; margin: 0 0 8px; }
    .code { margin: 0 0 16px; color: #444; font-family: ui-monospace, monospace; font-size: 13px; }
    .qr {
      border: 1px solid #ddd;
      border-radius: 14px;
      padding: 16px;
      background: #fff;
    }
    .qr svg { width: 280px; height: 280px; display: block; }
  </style>
</head>
<body>
  <h1>${escapeHtml(tool?.name || 'Инструмент')}</h1>
  <p class="code">${escapeHtml(tool?.code || '')}</p>
  <div class="qr">${svgClone.outerHTML}</div>
</body>
</html>`;
}

function defaultForm(meta) {
  const firstObjectId = meta.objects[0]?.id ? String(meta.objects[0].id) : '';
  const firstWarehouse = meta.warehouses.find((row) => String(row.object_id) === firstObjectId);
  const firstRack = meta.racks.find((row) => String(row.warehouse_id) === String(firstWarehouse?.id || ''));
  return {
    name: '',
    type_id: meta.types[0]?.id ? String(meta.types[0].id) : '',
    serial_number: '',
    purchase_date: '',
    warranty_date: '',
    cost: '0',
    status: 'new',
    object_id: firstObjectId,
    warehouse_id: firstWarehouse?.id ? String(firstWarehouse.id) : '',
    rack_id: firstRack?.id ? String(firstRack.id) : '',
  };
}

function actionDefault(tool) {
  return {
    action: 'issue',
    target_user_id: '',
    user_query: '',
    object_id: tool?.object_id ? String(tool.object_id) : '',
    warehouse_id: tool?.warehouse_id ? String(tool.warehouse_id) : '',
    rack_id: tool?.rack_id ? String(tool.rack_id) : '',
    repair_description: '',
    note: '',
  };
}

function normalizeMeta(raw = {}) {
  return {
    types: Array.isArray(raw.types) ? raw.types : [],
    users: Array.isArray(raw.users) ? raw.users : [],
    objects: Array.isArray(raw.objects) ? raw.objects : [],
    warehouses: Array.isArray(raw.warehouses) ? raw.warehouses : [],
    racks: Array.isArray(raw.racks) ? raw.racks : [],
  };
}

export default function Tools({ user }) {
  const [meta, setMeta] = useState(() => normalizeMeta({}));
  const [items, setItems] = useState([]);
  const [summaryByType, setSummaryByType] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [sortBy, setSortBy] = useState('updated_at');
  const [sortDir, setSortDir] = useState('desc');

  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanError, setScanError] = useState('');
  const [scanInfo, setScanInfo] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(() => defaultForm(normalizeMeta({})));

  const [actionTool, setActionTool] = useState(null);
  const [actionForm, setActionForm] = useState(() => actionDefault(null));
  const [actionSaving, setActionSaving] = useState(false);
  const [issueUserDropdownOpen, setIssueUserDropdownOpen] = useState(false);

  const [historyTool, setHistoryTool] = useState(null);
  const [historyItems, setHistoryItems] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [qrPreviewTool, setQrPreviewTool] = useState(null);
  const [qrPrintError, setQrPrintError] = useState('');
  const qrPreviewRef = useRef(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [listData, metaData] = await Promise.all([toolsApi.list(), toolsApi.meta()]);
      const safeMeta = normalizeMeta(metaData);
      setMeta(safeMeta);
      setItems(Array.isArray(listData?.items) ? listData.items : []);
      setSummaryByType(Array.isArray(listData?.summary_by_type) ? listData.summary_by_type : []);
      setForm((prev) => {
        const base = defaultForm(safeMeta);
        return {
          ...base,
          ...prev,
          type_id: safeMeta.types.some((row) => String(row.id) === String(prev.type_id))
            ? prev.type_id
            : base.type_id,
        };
      });
      setError('');
    } catch (e) {
      setError(e.message || 'Ошибка загрузки инструмента');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useAutoRefreshOnVisible(() => load(true), { intervalMs: 10000 });

  const objectWarehouses = useMemo(
    () => meta.warehouses.filter((row) => String(row.object_id) === String(form.object_id || '')),
    [meta.warehouses, form.object_id],
  );

  const warehouseRacks = useMemo(
    () => meta.racks.filter((row) => String(row.warehouse_id) === String(form.warehouse_id || '')),
    [meta.racks, form.warehouse_id],
  );

  const actionWarehouses = useMemo(
    () => meta.warehouses.filter((row) => String(row.object_id) === String(actionForm.object_id || '')),
    [meta.warehouses, actionForm.object_id],
  );

  const actionRacks = useMemo(
    () => meta.racks.filter((row) => String(row.warehouse_id) === String(actionForm.warehouse_id || '')),
    [meta.racks, actionForm.warehouse_id],
  );

  const searchedUsers = useMemo(() => {
    const q = actionForm.user_query.trim().toLowerCase();
    if (!q) return meta.users;
    return meta.users.filter((row) => {
      const name = (row.display_name || row.login || '').toLowerCase();
      return name.includes(q);
    });
  }, [actionForm.user_query, meta.users]);

  const selectedIssueUser = useMemo(() => {
    const id = parseId(actionForm.target_user_id);
    if (!id) return null;
    return meta.users.find((row) => Number(row.id) === Number(id)) || null;
  }, [actionForm.target_user_id, meta.users]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = items.filter((row) => {
      if (statusFilter !== 'all' && row.status !== statusFilter) return false;
      if (typeFilter !== 'all' && String(row.type_id) !== String(typeFilter)) return false;
      if (!q) return true;
      const text = [
        row.name,
        row.code,
        row.serial_number,
        row.type_name,
        row.holder_user_name,
        row.issued_by_user_name,
        row.warehouse_name,
        row.rack_name,
        row.object_name,
      ].join(' ').toLowerCase();
      return text.includes(q);
    });
    const sorted = [...list];
    sorted.sort((a, b) => {
      let av;
      let bv;
      if (sortBy === 'cost') {
        av = Number(a.cost || 0);
        bv = Number(b.cost || 0);
      } else {
        av = String(a[sortBy] || '').toLowerCase();
        bv = String(b[sortBy] || '').toLowerCase();
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [items, search, statusFilter, typeFilter, sortBy, sortDir]);

  const typeButtons = useMemo(() => {
    const base = [{ id: 'all', label: 'Все виды', count: items.length }];
    return base.concat(summaryByType.map((row) => ({
      id: String(row.type_id),
      label: row.type_name,
      count: Number(row.count || 0),
    })));
  }, [items.length, summaryByType]);

  const statusButtons = useMemo(() => {
    const counts = {
      all: items.length,
      new: 0,
      in_use: 0,
      in_repair: 0,
      in_stock: 0,
    };
    for (const row of items) {
      if (counts[row.status] != null) counts[row.status] += 1;
    }
    return STATUS_FILTERS.map((cfg) => ({
      ...cfg,
      count: counts[cfg.id] || 0,
    }));
  }, [items]);

  const resetForm = useCallback(() => {
    setEditingId(null);
    setForm(defaultForm(meta));
  }, [meta]);

  const openCreate = () => {
    setError('');
    resetForm();
    setFormOpen(true);
  };

  const openEdit = (row) => {
    setEditingId(row.id);
    setError('');
    setForm({
      name: row.name || '',
      type_id: row.type_id ? String(row.type_id) : '',
      serial_number: row.serial_number || '',
      purchase_date: row.purchase_date ? String(row.purchase_date).slice(0, 10) : '',
      warranty_date: row.warranty_date ? String(row.warranty_date).slice(0, 10) : '',
      cost: String(row.cost ?? 0),
      status: row.status || 'new',
      object_id: row.object_id ? String(row.object_id) : '',
      warehouse_id: row.warehouse_id ? String(row.warehouse_id) : '',
      rack_id: row.rack_id ? String(row.rack_id) : '',
    });
    setFormOpen(true);
  };

  const closeForm = () => {
    if (saving) return;
    setFormOpen(false);
    resetForm();
  };

  const submitForm = async (event) => {
    event.preventDefault();
    const payload = {
      name: form.name.trim(),
      type_id: parseId(form.type_id),
      serial_number: form.serial_number.trim(),
      purchase_date: form.purchase_date || null,
      warranty_date: form.warranty_date || null,
      cost: Number.parseFloat(form.cost || '0'),
      status: form.status || 'new',
      object_id: parseId(form.object_id),
      warehouse_id: parseId(form.warehouse_id),
      rack_id: parseId(form.rack_id),
    };
    if (!payload.name) return setError('Укажите название инструмента');
    if (!payload.type_id) return setError('Выберите вид инструмента');
    if (!payload.serial_number) return setError('Укажите серийный номер');
    if (!payload.object_id || !payload.warehouse_id) {
      return setError('Укажите объект и склад хранения');
    }
    if (!Number.isFinite(payload.cost) || payload.cost < 0) {
      return setError('Укажите корректную стоимость');
    }
    setSaving(true);
    setError('');
    try {
      if (editingId) {
        await toolsApi.update(editingId, payload);
      } else {
        await toolsApi.create(payload);
      }
      setFormOpen(false);
      resetForm();
      await load(true);
    } catch (e) {
      setError(e.message || 'Ошибка сохранения инструмента');
    } finally {
      setSaving(false);
    }
  };

  const openActionModal = (tool, options = {}) => {
    const base = actionDefault(tool);
    if (options.forceAction) base.action = options.forceAction;
    setActionTool(tool);
    setActionForm(base);
    setIssueUserDropdownOpen(false);
    setScanError('');
  };

  const closeActionModal = () => {
    if (actionSaving) return;
    setIssueUserDropdownOpen(false);
    setActionTool(null);
  };

  const submitAction = async (event) => {
    event.preventDefault();
    if (!actionTool) return;
    const action = actionForm.action;
    const payload = {
      action,
      note: actionForm.note.trim(),
    };
    if (action === 'issue') {
      payload.target_user_id = parseId(actionForm.target_user_id);
      if (!payload.target_user_id) {
        setError('Выберите пользователя для выдачи');
        return;
      }
    } else if (action === 'repair') {
      payload.repair_description = actionForm.repair_description.trim();
    } else if (action === 'receive' || action === 'move') {
      payload.object_id = parseId(actionForm.object_id);
      payload.warehouse_id = parseId(actionForm.warehouse_id);
      payload.rack_id = parseId(actionForm.rack_id);
      if (!payload.object_id || !payload.warehouse_id) {
        setError('Укажите объект и склад');
        return;
      }
    }
    setActionSaving(true);
    setError('');
    try {
      await toolsApi.action(actionTool.id, payload);
      setIssueUserDropdownOpen(false);
      setActionTool(null);
      await load(true);
    } catch (e) {
      setError(e.message || 'Ошибка операции с инструментом');
    } finally {
      setActionSaving(false);
    }
  };

  const openHistory = async (tool) => {
    setHistoryTool(tool);
    setHistoryLoading(true);
    try {
      const rows = await toolsApi.history(tool.id);
      setHistoryItems(Array.isArray(rows) ? rows : []);
    } catch (e) {
      setHistoryItems([]);
      setError(e.message || 'Ошибка загрузки истории');
    } finally {
      setHistoryLoading(false);
    }
  };

  const closeHistory = () => {
    setHistoryTool(null);
    setHistoryItems([]);
  };

  const openQrPreview = (tool) => {
    setQrPreviewTool(tool);
    setQrPrintError('');
  };

  const closeQrPreview = () => {
    setQrPreviewTool(null);
    setQrPrintError('');
  };

  const printQrPreview = useCallback(() => {
    if (!qrPreviewTool) return;
    const svg = qrPreviewRef.current?.querySelector('svg');
    if (!svg) {
      setQrPrintError('Не удалось подготовить QR для печати');
      return;
    }
    setQrPrintError('');
    const html = buildToolQrPrintHtml(qrPreviewTool, svg);
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.appendChild(iframe);
    const win = iframe.contentWindow;
    if (!win) {
      iframe.remove();
      setQrPrintError('Не удалось открыть печать');
      return;
    }
    const cleanup = () => setTimeout(() => iframe.remove(), 400);
    try {
      const doc = win.document;
      doc.open();
      doc.write(html);
      doc.close();
      win.addEventListener('afterprint', cleanup, { once: true });
      setTimeout(() => {
        win.focus();
        win.print();
      }, 180);
    } catch {
      cleanup();
      setQrPrintError('Не удалось открыть печать');
    }
  }, [qrPreviewTool]);

  const onScan = async (decoded) => {
    const code = String(decoded || '').trim();
    if (!code || scanBusy) return;
    setScanBusy(true);
    setScanError('');
    setScanInfo('');
    try {
      const tool = await toolsApi.byCode(code);
      setScannerOpen(false);
      setScanInfo(`${tool.name} · ${tool.code}. ${toolStatusInfoText(tool)}`);

      if (tool.status === 'in_stock' && user?.id) {
        const updated = await toolsApi.action(tool.id, {
          action: 'issue',
          target_user_id: Number(user.id),
          note: 'Автовыдача по сканированию QR',
        });
        setScanInfo(`${updated.name} · ${updated.code}. ${toolStatusInfoText(updated)}`);
        await load(true);
        return;
      }

      if (tool.status === 'in_use') {
        openActionModal(tool, { forceAction: 'receive' });
        return;
      }

      openActionModal(tool);
    } catch (e) {
      setScanError(e.message || 'Инструмент по QR не найден');
    } finally {
      setScanBusy(false);
    }
  };

  const statusInfo = (row) => {
    if (row.status === 'in_use') {
      return `Кому: ${row.holder_user_name || '—'} · Выдал: ${row.issued_by_user_name || '—'} · ${formatDate(row.issued_at, true)}`;
    }
    if (row.status === 'in_repair') {
      const desc = row.repair_description ? ` · Поломка: ${row.repair_description}` : '';
      return `Отправил: ${row.repair_by_user_name || '—'} · ${formatDate(row.repair_at, true)}${desc}`;
    }
    if (row.status === 'in_stock') {
      return `Хранение: ${locationText(row)} · Принял: ${row.received_by_user_name || '—'} ${row.received_at ? `· ${formatDate(row.received_at, true)}` : ''}`;
    }
    return `Хранение: ${locationText(row)}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-base font-semibold text-white">Инструмент</h1>
          <p className="text-2xs text-zinc-500 mt-0.5">Учёт инструмента по QR-кодам и операциям жизненного цикла.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn-ghost text-sm" onClick={() => setScannerOpen(true)}>
            Сканировать QR
          </button>
          <button type="button" className="btn-primary text-sm" onClick={openCreate}>
            Добавить инструмент
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input"
          placeholder="Поиск: название, QR, серийный, склад, пользователь…"
        />
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="input"
        >
          <option value="updated_at">Сортировка: обновление</option>
          <option value="name">Название</option>
          <option value="type_name">Вид инструмента</option>
          <option value="status">Статус</option>
          <option value="serial_number">Серийный номер</option>
          <option value="cost">Стоимость</option>
        </select>
        <select
          value={sortDir}
          onChange={(e) => setSortDir(e.target.value)}
          className="input"
        >
          <option value="desc">По убыванию</option>
          <option value="asc">По возрастанию</option>
        </select>
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {statusButtons.map((row) => (
          <button
            key={row.id}
            type="button"
            onClick={() => setStatusFilter(row.id)}
            className={`shrink-0 ${statusFilterButtonClass(String(statusFilter) === String(row.id), row.id === 'all' ? '' : row.id)}`}
          >
            {row.label} · {row.count}
          </button>
        ))}
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {typeButtons.map((row) => (
          <button
            key={row.id}
            type="button"
            onClick={() => setTypeFilter(String(row.id))}
            className={`shrink-0 rounded-md border px-2 py-1 text-2xs ${
              String(typeFilter) === String(row.id)
                ? 'border-sky-400/50 bg-sky-500/15 text-sky-200'
                : 'border-white/10 bg-white/[0.02] text-zinc-300'
            }`}
          >
            {row.label} · {row.count}
          </button>
        ))}
      </div>

      {scanError && (
        <div className="rounded border border-rose-500/30 bg-rose-500/10 text-rose-300 px-2.5 py-1.5 text-2xs">
          {scanError}
        </div>
      )}
      {scanInfo && (
        <div className="rounded border border-sky-500/30 bg-sky-500/10 text-sky-200 px-2.5 py-1.5 text-2xs">
          {scanInfo}
        </div>
      )}
      {error && (
        <div className="rounded border border-rose-500/30 bg-rose-500/10 text-rose-300 px-2.5 py-1.5 text-2xs">
          {error}
        </div>
      )}

      <div className="table-wrap hidden md:block">
        <table className="data-table">
          <thead>
            <tr>
              <th className="w-[14rem]">Инструмент</th>
              <th className="w-[11rem]">Вид</th>
              <th className="w-[10rem]">Серийный номер</th>
              <th className="w-[6rem]">Стоимость</th>
              <th className="w-[7rem]">Статус</th>
              <th>Состояние</th>
              <th className="w-[11rem]">Действия</th>
            </tr>
          </thead>
          <tbody>
            {loading && !items.length && (
              <tr>
                <td colSpan={7} className="text-center text-zinc-500 py-6 text-2xs">Загрузка…</td>
              </tr>
            )}
            {!loading && !filteredItems.length && (
              <tr>
                <td colSpan={7} className="text-center text-zinc-500 py-6 text-2xs">Инструменты не найдены</td>
              </tr>
            )}
            {filteredItems.map((row) => (
              <tr key={row.id}>
                <td>
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      onClick={() => openQrPreview(row)}
                      className="rounded-md bg-white p-1 border border-white/10 hover:border-sky-400/50 shrink-0"
                      title="Открыть увеличенный QR"
                    >
                      <QRCodeSVG value={row.code || `tool-${row.id}`} size={40} level="M" />
                    </button>
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => openHistory(row)}
                        className="text-left text-white hover:text-sky-300 text-sm font-medium"
                        title="Открыть историю действий"
                      >
                        {row.name}
                      </button>
                      <div className="text-zinc-500 text-2xs mt-0.5">QR: {row.code}</div>
                      <div className="text-zinc-500 text-2xs">Покупка: {formatDate(row.purchase_date)} · Гарантия: {formatDate(row.warranty_date)}</div>
                    </div>
                  </div>
                </td>
                <td className="text-zinc-300 text-2xs">{row.type_name || '—'}</td>
                <td className="text-zinc-300 text-2xs">{row.serial_number || '—'}</td>
                <td className="text-zinc-300 text-2xs tabular-nums">{formatMoney(row.cost)}</td>
                <td>
                  <button
                    type="button"
                    className={`inline-flex items-center rounded border px-2 py-0.5 text-2xs ${statusClass(row.status)}`}
                    onClick={() => setStatusFilter(row.status)}
                    title="Фильтровать по этому статусу"
                  >
                    {statusLabel(row.status)}
                  </button>
                </td>
                <td className="text-zinc-300 text-2xs">{statusInfo(row)}</td>
                <td>
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" className="btn-ghost text-2xs" onClick={() => openActionModal(row)}>
                      Операция
                    </button>
                    <button type="button" className="btn-ghost text-2xs" onClick={() => openEdit(row)}>
                      Изм.
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="md:hidden space-y-2">
        {loading && !items.length && <div className="text-center text-zinc-500 py-6 text-2xs">Загрузка…</div>}
        {!loading && !filteredItems.length && <div className="text-center text-zinc-500 py-6 text-2xs">Инструменты не найдены</div>}
        {filteredItems.map((row) => (
          <div key={row.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2 min-w-0">
                <button
                  type="button"
                  onClick={() => openQrPreview(row)}
                  className="rounded-md bg-white p-1 border border-white/10 hover:border-sky-400/50 shrink-0"
                  title="Открыть увеличенный QR"
                >
                  <QRCodeSVG value={row.code || `tool-${row.id}`} size={36} level="M" />
                </button>
                <button
                  type="button"
                  onClick={() => openHistory(row)}
                  className="text-left text-white hover:text-sky-300 text-sm font-medium"
                >
                  {row.name}
                </button>
              </div>
              <button
                type="button"
                className={`inline-flex items-center rounded border px-2 py-0.5 text-2xs ${statusClass(row.status)}`}
                onClick={() => setStatusFilter(row.status)}
                title="Фильтровать по этому статусу"
              >
                {statusLabel(row.status)}
              </button>
            </div>
            <div className="text-2xs text-zinc-500">QR: {row.code}</div>
            <div className="grid grid-cols-2 gap-2 text-2xs text-zinc-300">
              <div>Вид: {row.type_name || '—'}</div>
              <div>Серийный: {row.serial_number || '—'}</div>
              <div>Стоимость: {formatMoney(row.cost)}</div>
              <div>Гарантия: {formatDate(row.warranty_date)}</div>
            </div>
            <div className="text-2xs text-zinc-300">{statusInfo(row)}</div>
            <div className="grid grid-cols-2 gap-1.5">
              <button type="button" className="btn-ghost text-2xs" onClick={() => openActionModal(row)}>
                Операция
              </button>
              <button type="button" className="btn-ghost text-2xs" onClick={() => openEdit(row)}>
                Изм.
              </button>
            </div>
          </div>
        ))}
      </div>

      {scannerOpen && (
        <QrScanner
          onScan={onScan}
          onClose={() => {
            if (scanBusy) return;
            setScannerOpen(false);
          }}
        />
      )}

      {formOpen && (
        <div className="modal-backdrop z-[75]" onClick={closeForm} role="dialog" aria-modal="true">
          <div className="card p-5 max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-white text-sm font-medium mb-3">{editingId ? 'Редактирование инструмента' : 'Новый инструмент'}</h3>
            <form onSubmit={submitForm} className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="label">Название</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  className="input"
                  required
                />
              </div>
              <div>
                <label className="label">Вид инструмента</label>
                <select
                  value={form.type_id}
                  onChange={(e) => setForm((prev) => ({ ...prev, type_id: e.target.value }))}
                  className="input"
                  required
                >
                  <option value="">— Выберите —</option>
                  {meta.types.map((row) => (
                    <option key={row.id} value={row.id}>{row.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Серийный номер</label>
                <input
                  value={form.serial_number}
                  onChange={(e) => setForm((prev) => ({ ...prev, serial_number: e.target.value }))}
                  className="input"
                  required
                />
              </div>
              <div>
                <label className="label">Стоимость</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.cost}
                  onChange={(e) => setForm((prev) => ({ ...prev, cost: e.target.value }))}
                  className="input"
                  required
                />
              </div>
              <div>
                <label className="label">Дата покупки</label>
                <input
                  type="date"
                  value={form.purchase_date}
                  onChange={(e) => setForm((prev) => ({ ...prev, purchase_date: e.target.value }))}
                  className="input"
                />
              </div>
              <div>
                <label className="label">Дата гарантии</label>
                <input
                  type="date"
                  value={form.warranty_date}
                  onChange={(e) => setForm((prev) => ({ ...prev, warranty_date: e.target.value }))}
                  className="input"
                />
              </div>
              <div>
                <label className="label">Статус инструмента</label>
                <div className="flex flex-wrap gap-1.5">
                  {STATUS_FILTERS.filter((row) => row.id !== 'all').map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => setForm((prev) => ({ ...prev, status: row.id }))}
                      className={statusFilterButtonClass(form.status === row.id, row.id)}
                    >
                      {row.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="label">Объект</label>
                <select
                  value={form.object_id}
                  onChange={(e) => {
                    const objectId = e.target.value;
                    const firstWarehouse = meta.warehouses.find((row) => String(row.object_id) === String(objectId));
                    const firstRack = meta.racks.find((row) => String(row.warehouse_id) === String(firstWarehouse?.id || ''));
                    setForm((prev) => ({
                      ...prev,
                      object_id: objectId,
                      warehouse_id: firstWarehouse?.id ? String(firstWarehouse.id) : '',
                      rack_id: firstRack?.id ? String(firstRack.id) : '',
                    }));
                  }}
                  className="input"
                  required
                >
                  <option value="">— Выберите —</option>
                  {meta.objects.map((row) => (
                    <option key={row.id} value={row.id}>{row.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Склад</label>
                <select
                  value={form.warehouse_id}
                  onChange={(e) => {
                    const warehouseId = e.target.value;
                    const firstRack = meta.racks.find((row) => String(row.warehouse_id) === String(warehouseId));
                    setForm((prev) => ({
                      ...prev,
                      warehouse_id: warehouseId,
                      rack_id: firstRack?.id ? String(firstRack.id) : '',
                    }));
                  }}
                  className="input"
                  required
                >
                  <option value="">— Выберите —</option>
                  {objectWarehouses.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.object_name ? `${row.object_name} → ` : ''}{row.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Стеллаж</label>
                <select
                  value={form.rack_id}
                  onChange={(e) => setForm((prev) => ({ ...prev, rack_id: e.target.value }))}
                  className="input"
                >
                  <option value="">— Не указан —</option>
                  {warehouseRacks.map((row) => (
                    <option key={row.id} value={row.id}>{row.name}</option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2 flex flex-wrap gap-2 pt-1">
                <button type="submit" className="btn-primary text-sm" disabled={saving}>
                  {saving ? 'Сохранение…' : (editingId ? 'Сохранить' : 'Добавить')}
                </button>
                <button type="button" className="btn-ghost text-sm" onClick={closeForm} disabled={saving}>
                  Отмена
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {actionTool && (
        <div className="modal-backdrop z-[80]" onClick={closeActionModal} role="dialog" aria-modal="true">
          <div className="card p-5 max-w-xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-white text-sm font-medium mb-1">Операция с инструментом</h3>
            <p className="text-zinc-500 text-2xs mb-3">{actionTool.name} · {actionTool.code}</p>
            <div className="rounded border border-white/10 bg-white/[0.02] px-2.5 py-2 text-2xs text-zinc-300 mb-3">
              {toolStatusInfoText(actionTool)}
            </div>
            <form onSubmit={submitAction} className="space-y-3">
              <div>
                <label className="label">Действие</label>
                <select
                  value={actionForm.action}
                  onChange={(e) => {
                    const nextAction = e.target.value;
                    setActionForm((prev) => ({ ...prev, action: nextAction }));
                    if (nextAction !== 'issue') {
                      setIssueUserDropdownOpen(false);
                    }
                  }}
                  className="input"
                >
                  <option value="issue">Выдать пользователю</option>
                  <option value="receive">Вернуть на склад</option>
                  <option value="repair">Отправить в ремонт</option>
                  <option value="move">Переместить</option>
                </select>
              </div>

              {actionForm.action === 'issue' && (
                <div className="space-y-2">
                  <label className="label">Пользователь</label>
                  <div className="relative">
                    <button
                      type="button"
                      className="input text-left flex items-center justify-between"
                      onClick={() => setIssueUserDropdownOpen((prev) => !prev)}
                    >
                      <span className={selectedIssueUser ? 'text-zinc-100' : 'text-zinc-500'}>
                        {selectedIssueUser ? (selectedIssueUser.display_name || selectedIssueUser.login) : '— Выберите пользователя —'}
                      </span>
                      <span className="text-zinc-500 text-xs">{issueUserDropdownOpen ? '▲' : '▼'}</span>
                    </button>
                    {issueUserDropdownOpen && (
                      <div className="absolute z-20 mt-1 w-full rounded-lg border border-white/10 bg-surface-900 shadow-xl p-2 space-y-2">
                        <input
                          value={actionForm.user_query}
                          onChange={(e) => setActionForm((prev) => ({ ...prev, user_query: e.target.value }))}
                          className="input"
                          placeholder="Поиск по имени или логину"
                          autoFocus
                        />
                        <div className="max-h-52 overflow-y-auto space-y-1">
                          {searchedUsers.length === 0 && (
                            <div className="text-zinc-500 text-2xs px-2 py-1">Пользователи не найдены</div>
                          )}
                          {searchedUsers.map((row) => (
                            <button
                              key={row.id}
                              type="button"
                              onClick={() => {
                                setActionForm((prev) => ({ ...prev, target_user_id: String(row.id) }));
                                setIssueUserDropdownOpen(false);
                              }}
                              className={`w-full text-left rounded px-2 py-1.5 text-2xs ${
                                String(actionForm.target_user_id) === String(row.id)
                                  ? 'bg-sky-500/20 text-sky-200'
                                  : 'hover:bg-white/5 text-zinc-200'
                              }`}
                            >
                              {row.display_name || row.login}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {(actionForm.action === 'receive' || actionForm.action === 'move') && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <div>
                    <label className="label">Объект</label>
                    <select
                      value={actionForm.object_id}
                      onChange={(e) => {
                        const objectId = e.target.value;
                        const firstWarehouse = meta.warehouses.find((row) => String(row.object_id) === String(objectId));
                        const firstRack = meta.racks.find((row) => String(row.warehouse_id) === String(firstWarehouse?.id || ''));
                        setActionForm((prev) => ({
                          ...prev,
                          object_id: objectId,
                          warehouse_id: firstWarehouse?.id ? String(firstWarehouse.id) : '',
                          rack_id: firstRack?.id ? String(firstRack.id) : '',
                        }));
                      }}
                      className="input"
                      required
                    >
                      <option value="">— Выберите —</option>
                      {meta.objects.map((row) => (
                        <option key={row.id} value={row.id}>{row.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">Склад</label>
                    <select
                      value={actionForm.warehouse_id}
                      onChange={(e) => {
                        const warehouseId = e.target.value;
                        const firstRack = meta.racks.find((row) => String(row.warehouse_id) === String(warehouseId));
                        setActionForm((prev) => ({
                          ...prev,
                          warehouse_id: warehouseId,
                          rack_id: firstRack?.id ? String(firstRack.id) : '',
                        }));
                      }}
                      className="input"
                      required
                    >
                      <option value="">— Выберите —</option>
                      {actionWarehouses.map((row) => (
                        <option key={row.id} value={row.id}>{row.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">Стеллаж</label>
                    <select
                      value={actionForm.rack_id}
                      onChange={(e) => setActionForm((prev) => ({ ...prev, rack_id: e.target.value }))}
                      className="input"
                    >
                      <option value="">— Не указан —</option>
                      {actionRacks.map((row) => (
                        <option key={row.id} value={row.id}>{row.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {actionForm.action === 'repair' && (
                <div>
                  <label className="label">Описание поломки</label>
                  <textarea
                    value={actionForm.repair_description}
                    onChange={(e) => setActionForm((prev) => ({ ...prev, repair_description: e.target.value }))}
                    className="input min-h-[88px]"
                    placeholder="Укажите, какая неисправность выявлена"
                  />
                </div>
              )}

              <div>
                <label className="label">Комментарий</label>
                <input
                  value={actionForm.note}
                  onChange={(e) => setActionForm((prev) => ({ ...prev, note: e.target.value }))}
                  className="input"
                  placeholder="Необязательно"
                />
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <button type="submit" className="btn-primary text-sm" disabled={actionSaving}>
                  {actionSaving ? 'Выполняем…' : 'Применить'}
                </button>
                <button type="button" className="btn-ghost text-sm" onClick={closeActionModal} disabled={actionSaving}>
                  Отмена
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {historyTool && (
        <div className="modal-backdrop z-[85]" onClick={closeHistory} role="dialog" aria-modal="true">
          <div className="card p-5 max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-white text-sm font-medium mb-1">История инструмента</h3>
            <p className="text-zinc-500 text-2xs mb-3">{historyTool.name} · {historyTool.code}</p>
            {historyLoading ? (
              <div className="text-zinc-500 text-2xs py-6 text-center">Загрузка истории…</div>
            ) : (
              <div className="space-y-2">
                {!historyItems.length && (
                  <div className="text-zinc-500 text-2xs py-4 text-center">История пуста</div>
                )}
                {historyItems.map((eventRow) => (
                  <div key={eventRow.id} className="rounded-lg border border-white/10 bg-white/[0.02] p-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-zinc-100 text-xs">{actionLabel(eventRow.action)}</div>
                      <div className="text-zinc-500 text-2xs">{formatDate(eventRow.created_at, true)}</div>
                    </div>
                    <div className="text-zinc-400 text-2xs mt-1">
                      Выполнил: {eventRow.performed_by_name || '—'}
                    </div>
                    {eventRow.target_user_name ? (
                      <div className="text-zinc-400 text-2xs">Пользователь: {eventRow.target_user_name}</div>
                    ) : null}
                    {eventRow.object_name || eventRow.warehouse_name || eventRow.rack_name ? (
                      <div className="text-zinc-400 text-2xs">
                        Локация: {[eventRow.object_name, eventRow.warehouse_name, eventRow.rack_name].filter(Boolean).join(' → ')}
                      </div>
                    ) : null}
                    {(eventRow.from_status || eventRow.to_status) ? (
                      <div className="text-zinc-400 text-2xs">
                        Статус: {eventRow.from_status ? statusLabel(eventRow.from_status) : '—'}
                        {' '}→{' '}
                        {eventRow.to_status ? statusLabel(eventRow.to_status) : '—'}
                      </div>
                    ) : null}
                    {eventRow.repair_description ? (
                      <div className="text-zinc-300 text-2xs mt-1">Поломка: {eventRow.repair_description}</div>
                    ) : null}
                    {eventRow.note ? (
                      <div className="text-zinc-300 text-2xs mt-1">Комментарий: {eventRow.note}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
            <div className="pt-3">
              <button type="button" className="btn-ghost text-sm" onClick={closeHistory}>Закрыть</button>
            </div>
          </div>
        </div>
      )}

      {qrPreviewTool && (
        <div className="modal-backdrop z-[88]" onClick={closeQrPreview} role="dialog" aria-modal="true">
          <div className="card p-5 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-white text-sm font-medium mb-1">QR-код инструмента</h3>
            <p className="text-zinc-300 text-xs">{qrPreviewTool.name}</p>
            <p className="text-zinc-500 text-2xs mb-3">{qrPreviewTool.code}</p>
            <div className="flex justify-center">
              <div ref={qrPreviewRef} className="rounded-xl bg-white p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.08)]">
                <QRCodeSVG value={qrPreviewTool.code || `tool-${qrPreviewTool.id}`} size={260} level="M" />
              </div>
            </div>
            {qrPrintError && (
              <p className="text-rose-300 text-2xs mt-3">{qrPrintError}</p>
            )}
            <div className="flex gap-2 mt-4">
              <button type="button" className="btn-primary text-sm" onClick={printQrPreview}>
                Распечатать QR
              </button>
              <button type="button" className="btn-ghost text-sm" onClick={closeQrPreview}>
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
