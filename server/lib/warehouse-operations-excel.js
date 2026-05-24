import XLSX from 'xlsx';
import { logQuantityChange } from './material-quantity-log.js';
import { logProductionConfirmation } from './production-confirmation-log.js';
import {
  formatWorkLocationLabel,
  WORK_LOCATION_JOIN,
  WORK_LOCATION_SELECT,
} from './work-location.js';

export const ISSUANCE_EXPORT_HEADERS = [
  'ID',
  'Дата',
  'QR',
  'Материал',
  'Логин получателя',
  'Получатель',
  'Выдано',
  'Возвращено',
  'Ед.',
  'Примечание',
];

export const PRODUCTION_EXPORT_HEADERS = [
  'ID выдачи',
  'Дата',
  'QR',
  'Материал',
  'Логин',
  'Пользователь',
  'Выдано',
  'Возвращено',
  'Выработка',
  'СМР/ед.',
  'СМР',
  'Подтверждено',
  'Дата подтверждения',
  'Место работ',
];

const ISSUANCE_ALIASES = {
  id: ['id', 'ид', '№', 'номер'],
  issued_at: ['дата', 'дата выдачи', 'issued_at', 'date'],
  material_code: ['qr', 'код', 'code', 'material_code'],
  material_name: ['материал', 'наименование', 'material', 'material_name'],
  recipient_login: ['логин получателя', 'логин', 'login', 'recipient_login', 'issued_to_login'],
  recipient_name: ['получатель', 'кому выдан', 'recipient', 'issued_to_name', 'display_name'],
  quantity: ['выдано', 'количество', 'quantity', 'qty'],
  returned_quantity: ['возвращено', 'returned', 'returned_quantity'],
  unit: ['ед', 'ед.', 'ед.изм', 'unit'],
  note: ['примечание', 'note', 'комментарий'],
};

const PRODUCTION_ALIASES = {
  issuance_id: ['id выдачи', 'id', 'issuance_id', '№ выдачи'],
  issued_at: ['дата', 'issued_at', 'date'],
  material_code: ['qr', 'код', 'code', 'material_code'],
  material_name: ['материал', 'material_name', 'наименование'],
  user_login: ['логин', 'login', 'user_login'],
  user_name: ['пользователь', 'user', 'display_name'],
  quantity: ['выдано', 'quantity'],
  returned_quantity: ['возвращено', 'returned_quantity'],
  produced: ['выработка', 'produced', 'нетто'],
  production_price: ['смр/ед', 'смр/ед.', 'production_price', 'цена смр'],
  smr_total: ['смр', 'smr_total', 'смр всего'],
  production_confirmed: ['подтверждено', 'confirmed', 'статус'],
  production_confirmed_at: ['дата подтверждения', 'confirmed_at'],
  work_location: ['место работ', 'место', 'work_location', 'локация'],
};

function normHeader(h) {
  return String(h ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function mapHeaders(headerRow, aliases) {
  const colMap = {};
  headerRow.forEach((h, idx) => {
    const n = normHeader(h);
    if (!n) return;
    let bestKey = null;
    let bestLen = 0;
    for (const [key, list] of Object.entries(aliases)) {
      for (const a of list) {
        if (n === a && a.length > bestLen) {
          bestKey = key;
          bestLen = a.length;
        }
      }
    }
    if (bestKey && colMap[bestKey] === undefined) colMap[bestKey] = idx;
  });
  return colMap;
}

function cellVal(row, idx) {
  if (idx === undefined || idx < 0) return '';
  const v = row[idx];
  if (v == null) return '';
  return String(v).trim();
}

function parseNum(raw) {
  if (raw === '' || raw == null) return null;
  const n = parseFloat(String(raw).replace(/\s/g, '').replace(',', '.'));
  return Number.isNaN(n) ? null : n;
}

function parseBool(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return null;
  if (['да', 'yes', 'true', '1', 'подтверждено', 'confirmed', '+'].includes(s)) return true;
  if (['нет', 'no', 'false', '0', 'не подтверждено', '-'].includes(s)) return false;
  return null;
}

function excelSerialToDate(serial) {
  if (typeof serial === 'number' && XLSX.SSF?.parse_date_code) {
    const dc = XLSX.SSF.parse_date_code(serial);
    if (dc) {
      const d = new Date(dc.y, dc.m - 1, dc.d, dc.H, dc.M, Math.floor(dc.S || 0));
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  const epoch = new Date(1899, 11, 30, 0, 0, 0, 0);
  const d = new Date(epoch.getTime() + serial * 86400000);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Значение ячейки с сохранением даты/времени Excel. */
function readSheetCell(sheet, rowIndex, colIndex) {
  if (colIndex === undefined || colIndex < 0) return '';
  const ref = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
  const cell = sheet[ref];
  if (!cell || cell.v === undefined || cell.v === null) return '';
  if (cell.v instanceof Date) return cell.v;
  if (cell.t === 'n' && typeof cell.v === 'number') return cell.v;
  if (cell.w != null && String(cell.w).trim() !== '') return cell.w;
  return cell.v;
}

/** Date-объект для ячейки Excel (сохраняет время при открытии в Excel). */
function toExcelDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d;
}

function parseDateTime(raw) {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw;
  if (typeof raw === 'number') {
    return excelSerialToDate(raw);
  }
  const s = String(raw).trim();
  if (!s) return null;

  const iso = s.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (iso) {
    const [, yyyy, mm, dd, hh = '0', min = '0', sec = '0'] = iso;
    const d = new Date(
      Number(yyyy), Number(mm) - 1, Number(dd),
      Number(hh), Number(min), Number(sec),
    );
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const ru = s.match(
    /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (ru) {
    const [, dd, mm, yyyy, hh = '0', min = '0', sec = '0'] = ru;
    const d = new Date(
      Number(yyyy), Number(mm) - 1, Number(dd),
      Number(hh), Number(min), Number(sec),
    );
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Дата и время для Excel (с секундами, для импорта/экспорта). */
function formatDateTimeExport(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} `
    + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function cellRaw(row, idx) {
  if (idx === undefined || idx < 0) return '';
  const v = row[idx];
  if (v == null) return '';
  return v;
}

function sheetByNames(wb, names) {
  const want = names.map((n) => normHeader(n));
  const key = (wb.SheetNames || []).find((s) => want.includes(normHeader(s)));
  return key ? wb.Sheets[key] : null;
}

function rowsFromSheet(sheet) {
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
}

export function parseIssuanceSheet(sheet) {
  const rows = rowsFromSheet(sheet);
  if (rows.length < 2) return [];
  const colMap = mapHeaders(rows[0], ISSUANCE_ALIASES);
  const hasMaterial = colMap.material_code !== undefined || colMap.material_name !== undefined;
  const hasRecipient = colMap.recipient_login !== undefined || colMap.recipient_name !== undefined;
  if (!hasMaterial || !hasRecipient) {
    throw new Error('Лист «Выдача»: нужны столбцы QR/Материал и Логин получателя/Получатель');
  }

  const items = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c) => c === '' || c == null)) continue;
    const material_code = cellVal(row, colMap.material_code);
    const material_name = cellVal(row, colMap.material_name);
    const recipient_login = cellVal(row, colMap.recipient_login);
    const recipient_name = cellVal(row, colMap.recipient_name);
    if (!material_code && !material_name) continue;
    if (!recipient_login && !recipient_name) continue;

    const id = parseInt(cellVal(row, colMap.id), 10) || null;
    const qty = parseNum(cellVal(row, colMap.quantity));
    if (!id && (qty == null || qty <= 0)) continue;

    items.push({
      rowNum: i + 1,
      sheet: 'Выдача',
      id,
      issued_at: parseDateTime(readSheetCell(sheet, i, colMap.issued_at)),
      material_code,
      material_name,
      recipient_login,
      recipient_name,
      quantity: qty,
      returned_quantity: parseNum(cellVal(row, colMap.returned_quantity)) ?? 0,
      unit: cellVal(row, colMap.unit),
      note: cellVal(row, colMap.note),
    });
  }
  return items;
}

export function parseProductionSheet(sheet) {
  const rows = rowsFromSheet(sheet);
  if (rows.length < 2) return [];
  const colMap = mapHeaders(rows[0], PRODUCTION_ALIASES);
  const hasLink = colMap.issuance_id !== undefined
    || colMap.material_code !== undefined
    || colMap.user_login !== undefined;
  if (!hasLink) {
    throw new Error('Лист «Выработка»: укажите ID выдачи или QR + логин');
  }

  const items = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c) => c === '' || c == null)) continue;

    const issuance_id = parseInt(cellVal(row, colMap.issuance_id), 10) || null;
    const material_code = cellVal(row, colMap.material_code);
    const user_login = cellVal(row, colMap.user_login);
    const confirmedRaw = cellVal(row, colMap.production_confirmed);

    if (!issuance_id && !material_code && !user_login) continue;
    if (confirmedRaw === '' && !issuance_id) continue;

    items.push({
      rowNum: i + 1,
      sheet: 'Выработка',
      issuance_id,
      issued_at: parseDateTime(readSheetCell(sheet, i, colMap.issued_at)),
      material_code,
      material_name: cellVal(row, colMap.material_name),
      user_login,
      user_name: cellVal(row, colMap.user_name),
      quantity: parseNum(cellVal(row, colMap.quantity)),
      returned_quantity: parseNum(cellVal(row, colMap.returned_quantity)),
      produced: parseNum(cellVal(row, colMap.produced)),
      production_price: parseNum(cellVal(row, colMap.production_price)),
      smr_total: parseNum(cellVal(row, colMap.smr_total)),
      production_confirmed: parseBool(confirmedRaw),
      production_confirmed_at: parseDateTime(readSheetCell(sheet, i, colMap.production_confirmed_at)),
      work_location: cellVal(row, colMap.work_location),
    });
  }
  return items;
}

export function findWorkbookSheet(wb, ...names) {
  return sheetByNames(wb, names);
}

export function issuanceToExportArray(row) {
  return [
    row.id ?? '',
    toExcelDate(row.issued_at),
    row.material_code || '',
    row.material_name || '',
    row.issued_to_login || '',
    row.issued_to_name || '',
    Number(row.quantity) || 0,
    Number(row.returned_quantity) || 0,
    row.unit || '',
    row.note || '',
  ];
}

export function productionToExportArray(row, catalog) {
  const produced = Number(row.produced ?? (
    Math.max(Number(row.quantity) - Number(row.returned_quantity || 0), 0)
  )) || 0;
  const unitSmr = Number(row.production_price) || 0;
  const smrTotal = Number(row.smr_total) ?? produced * unitSmr;
  const label = row.work_location_label || formatWorkLocationLabel(row, catalog);
  return [
    row.issuance_id ?? row.id ?? '',
    toExcelDate(row.issued_at),
    row.material_code || '',
    row.material_name || '',
    row.login || row.issued_to_login || '',
    row.display_name || row.issued_to_name || '',
    Number(row.quantity) || 0,
    Number(row.returned_quantity) || 0,
    produced,
    unitSmr,
    smrTotal,
    row.production_confirmed ? 'да' : 'нет',
    toExcelDate(row.production_confirmed_at),
    label || '',
  ];
}

const EXCEL_DATETIME_FMT = 'dd.mm.yyyy hh:mm:ss';

function applyDateColumnFormat(ws, colIndex, rowCount) {
  for (let r = 1; r <= rowCount; r += 1) {
    const ref = XLSX.utils.encode_cell({ r, c: colIndex });
    const cell = ws[ref];
    if (cell && (cell.t === 'n' || cell.v instanceof Date)) {
      cell.z = EXCEL_DATETIME_FMT;
    }
  }
}

function appendAoASheet(wb, name, headers, dataRows, dateColumnIndexes = []) {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
  ws['!cols'] = headers.map((h) => ({ wch: Math.max(12, String(h).length + 2) }));
  for (const col of dateColumnIndexes) {
    applyDateColumnFormat(ws, col, dataRows.length);
  }
  XLSX.utils.book_append_sheet(wb, ws, name);
}

export function appendOperationsSheets(wb, { issuances = [], production = [] }, catalog = null) {
  appendAoASheet(
    wb,
    'Выдача',
    ISSUANCE_EXPORT_HEADERS,
    issuances.map(issuanceToExportArray),
    [1],
  );
  appendAoASheet(
    wb,
    'Выработка',
    PRODUCTION_EXPORT_HEADERS,
    production.map((r) => productionToExportArray(r, catalog)),
    [1, 12],
  );
}

async function findUser(client, { login, name }) {
  const ln = String(login || '').trim().toLowerCase();
  if (ln) {
    const r = await client.query(
      'SELECT id, login, display_name FROM users WHERE LOWER(TRIM(login)) = $1',
      [ln],
    );
    if (r.rows[0]) return r.rows[0];
  }
  const dn = String(name || '').trim().toLowerCase();
  if (dn) {
    const r = await client.query(
      `SELECT id, login, display_name FROM users
       WHERE LOWER(TRIM(display_name)) = $1
          OR LOWER(TRIM(COALESCE(first_name,'') || ' ' || COALESCE(last_name,''))) = $1
       LIMIT 1`,
      [dn],
    );
    if (r.rows[0]) return r.rows[0];
  }
  return null;
}

async function findMaterialByCode(client, code) {
  if (!code?.trim()) return null;
  return (await client.query(
    'SELECT id, code, name, quantity, unit FROM materials WHERE code = $1',
    [code.trim()],
  )).rows[0] || null;
}

function normCode(code) {
  return String(code || '').trim().toLowerCase();
}

/** Материал из листа «Склад» того же файла (ещё не в БД при предпросмотре). */
function findMaterialInPending(pendingMaterials, code) {
  const key = normCode(code);
  if (!key || !pendingMaterials?.length) return null;
  return pendingMaterials.find((row) => normCode(row.code) === key) || null;
}

async function resolveMaterialForIssuance(client, code, pendingMaterials = []) {
  const mat = await findMaterialByCode(client, code);
  if (mat) return { mat, pending: false };
  const row = findMaterialInPending(pendingMaterials, code);
  if (row) {
    return {
      mat: {
        code: String(row.code || '').trim(),
        name: row.name || '',
        unit: row.unit || 'шт',
        _pending: true,
      },
      pending: true,
    };
  }
  return null;
}

async function findIssuance(client, id) {
  if (!id) return null;
  return (await client.query(
    'SELECT * FROM issuances WHERE id = $1',
    [id],
  )).rows[0] || null;
}

function localDateKey(d) {
  if (!d) return null;
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return null;
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function findIssuanceByKey(client, { material_id, user_id, issued_at }) {
  if (!material_id || !user_id) return null;
  if (issued_at) {
    const exact = await client.query(
      `SELECT * FROM issuances
       WHERE material_id = $1 AND issued_to_user_id = $2
         AND ABS(EXTRACT(EPOCH FROM (issued_at - $3::timestamptz))) < 90
       ORDER BY ABS(EXTRACT(EPOCH FROM (issued_at - $3::timestamptz)))
       LIMIT 1`,
      [material_id, user_id, issued_at],
    );
    if (exact.rows[0]) return exact.rows[0];

    const day = localDateKey(issued_at);
    if (day) {
      const r = await client.query(
        `SELECT * FROM issuances
         WHERE material_id = $1 AND issued_to_user_id = $2
           AND issued_at::date = $3::date
         ORDER BY ABS(EXTRACT(EPOCH FROM (issued_at - $4::timestamptz)))
         LIMIT 1`,
        [material_id, user_id, day, issued_at],
      );
      if (r.rows[0]) return r.rows[0];
    }
  }
  const r = await client.query(
    `SELECT * FROM issuances
     WHERE material_id = $1 AND issued_to_user_id = $2
     ORDER BY issued_at DESC, id DESC LIMIT 1`,
    [material_id, user_id],
  );
  return r.rows[0] || null;
}

async function resolveIssuanceForProduction(client, item, pendingMaterials = []) {
  if (item.issuance_id) {
    const byId = await findIssuance(client, item.issuance_id);
    if (byId) return byId;
  }
  const resolved = await resolveMaterialForIssuance(client, item.material_code, pendingMaterials);
  if (!resolved) {
    throw new Error(
      `Материал с QR «${item.material_code || '—'}» не найден. Добавьте его на лист «Склад»`,
    );
  }
  const { mat, pending } = resolved;
  if (pending) {
    throw new Error(
      `Материал «${item.material_code}» будет создан со склада — выдача импортируется после него`,
    );
  }
  const user = await findUser(client, { login: item.user_login, name: item.user_name });
  if (!user) throw new Error(`Пользователь «${item.user_login || item.user_name || '—'}» не найден`);
  const iss = await findIssuanceByKey(client, {
    material_id: mat.id,
    user_id: user.id,
    issued_at: item.issued_at,
  });
  if (!iss) {
    throw new Error(
      'Выдача не найдена. Импортируйте лист «Выдача» или укажите ID, QR, логин и дату',
    );
  }
  return iss;
}

async function resolveIssuanceForImport(client, item, pendingMaterials = []) {
  if (item.id) {
    const byId = await findIssuance(client, item.id);
    if (byId) return { iss: byId, isNew: false };
  }

  const resolved = await resolveMaterialForIssuance(
    client,
    item.material_code,
    pendingMaterials,
  );
  if (!resolved) {
    const label = item.material_code || item.material_name || '—';
    throw new Error(
      `Материал «${label}» не найден. Добавьте строку с этим QR на лист «Склад» в этом файле`,
    );
  }
  const { mat, pending } = resolved;

  const user = await findUser(client, {
    login: item.recipient_login,
    name: item.recipient_name,
  });
  if (!user) {
    throw new Error(`Получатель «${item.recipient_login || item.recipient_name}» не найден`);
  }

  if (!pending && mat.id) {
    const existing = await findIssuanceByKey(client, {
      material_id: mat.id,
      user_id: user.id,
      issued_at: item.issued_at,
    });
    if (existing) return { iss: existing, isNew: false, mat, user };
  }

  if (item.quantity == null || item.quantity <= 0) {
    throw new Error('Укажите количество для новой выдачи');
  }
  return { iss: null, isNew: true, mat, user, materialPending: pending };
}

function sameDay(a, b) {
  const ka = localDateKey(a);
  const kb = localDateKey(b);
  return ka && kb && ka === kb;
}

/** Строка выдачи из того же файла (ещё нет в БД на этапе предпросмотра). */
function findPendingIssuance(pendingItems, item) {
  if (!pendingItems?.length) return null;
  for (const p of pendingItems) {
    if (item.issuance_id && p.id && item.issuance_id === p.id) return p;
    const codeA = String(item.material_code || '').trim().toLowerCase();
    const codeB = String(p.material_code || '').trim().toLowerCase();
    if (!codeA || codeA !== codeB) continue;
    const loginA = String(item.user_login || '').trim().toLowerCase();
    const loginB = String(p.recipient_login || '').trim().toLowerCase();
    if (loginA && loginB && loginA !== loginB) continue;
    if (item.issued_at && p.issued_at && !sameDay(item.issued_at, p.issued_at)) continue;
    return p;
  }
  return null;
}

async function setReturnedQuantity(client, {
  issuanceId, materialId, oldReturned, newReturned, userId, syncStock = false,
}) {
  const issued = parseFloat((await client.query(
    'SELECT quantity FROM issuances WHERE id = $1',
    [issuanceId],
  )).rows[0]?.quantity) || 0;
  if (newReturned > issued + 1e-9) {
    throw new Error('Возврат не может превышать выданное');
  }
  if (syncStock) {
    await client.query(
      `UPDATE issuances SET
         returned_quantity = $1::numeric,
         returned_at = CASE WHEN $1::numeric > 0 THEN COALESCE(returned_at, NOW()) ELSE NULL END
       WHERE id = $2`,
      [newReturned, issuanceId],
    );
    return;
  }
  const stockDelta = newReturned - oldReturned;
  if (Math.abs(stockDelta) > 1e-9) {
    const upd = await client.query(
      `UPDATE materials SET quantity = quantity + $1, updated_at = NOW()
       WHERE id = $2 RETURNING quantity`,
      [stockDelta, materialId],
    );
    const qtyAfter = parseFloat(upd.rows[0].quantity);
    if (qtyAfter < -1e-9) throw new Error('Недостаточно на складе для уменьшения возврата');
    await logQuantityChange(client, {
      materialId,
      userId,
      delta: stockDelta,
      quantityAfter: qtyAfter,
      kind: 'return_adjust',
      issuanceId,
      note: `Импорт: возврат ${oldReturned} → ${newReturned}`,
    });
  }
  await client.query(
    `UPDATE issuances SET
       returned_quantity = $1::numeric,
       returned_at = CASE WHEN $1::numeric > 0 THEN COALESCE(returned_at, NOW()) ELSE NULL END
     WHERE id = $2`,
    [newReturned, issuanceId],
  );
}

async function adjustIssuanceQuantity(client, {
  issuanceId, materialId, oldQty, newQty, userId, syncStock = false,
}) {
  const delta = newQty - oldQty;
  if (Math.abs(delta) <= 1e-9) return;
  if (syncStock) {
    await client.query('UPDATE issuances SET quantity = $1 WHERE id = $2', [newQty, issuanceId]);
    return;
  }
  if (delta > 0) {
    const mat = (await client.query(
      'SELECT quantity FROM materials WHERE id = $1 FOR UPDATE',
      [materialId],
    )).rows[0];
    if (parseFloat(mat?.quantity) < delta - 1e-9) {
      throw new Error('Недостаточно на складе для увеличения выдачи');
    }
    const upd = await client.query(
      `UPDATE materials SET quantity = quantity - $1, updated_at = NOW()
       WHERE id = $2 RETURNING quantity`,
      [delta, materialId],
    );
    await logQuantityChange(client, {
      materialId,
      userId,
      delta: -delta,
      quantityAfter: parseFloat(upd.rows[0].quantity),
      kind: 'issue',
      issuanceId,
      note: `Импорт: выдача ${oldQty} → ${newQty}`,
    });
  } else {
    const upd = await client.query(
      `UPDATE materials SET quantity = quantity + $1, updated_at = NOW()
       WHERE id = $2 RETURNING quantity`,
      [-delta, materialId],
    );
    await logQuantityChange(client, {
      materialId,
      userId,
      delta: -delta,
      quantityAfter: parseFloat(upd.rows[0].quantity),
      kind: 'issue_adjust',
      issuanceId,
      note: `Импорт: выдача ${oldQty} → ${newQty}`,
    });
  }
  await client.query('UPDATE issuances SET quantity = $1 WHERE id = $2', [newQty, issuanceId]);
}

async function createIssuance(client, { mat, user, item, userId, syncStock = false }) {
  const qty = item.quantity;
  const issuedAt = item.issued_at || new Date();
  const ret = Math.max(0, item.returned_quantity || 0);
  const confirmedBy = parseUserId(userId);

  if (!syncStock) {
    const matRow = (await client.query(
      'SELECT id, quantity FROM materials WHERE id = $1 FOR UPDATE',
      [mat.id],
    )).rows[0];
    if (parseFloat(matRow.quantity) < qty - 1e-9) {
      throw new Error('Недостаточно на складе');
    }
    const upd = await client.query(
      `UPDATE materials SET quantity = quantity - $1, updated_at = NOW()
       WHERE id = $2 RETURNING quantity`,
      [qty, mat.id],
    );
    const ins = await client.query(
      `INSERT INTO issuances (
         material_id, issued_by_user_id, issued_to_user_id, quantity, note, issued_at,
         returned_quantity
       ) VALUES ($1, $2, $3, $4, $5, $6, 0)
       RETURNING id`,
      [mat.id, confirmedBy, user.id, qty, item.note || null, issuedAt],
    );
    const issuanceId = ins.rows[0].id;
    await logQuantityChange(client, {
      materialId: mat.id,
      userId: confirmedBy,
      delta: -qty,
      quantityAfter: parseFloat(upd.rows[0].quantity),
      kind: 'issue',
      issuanceId,
      note: `Импорт Excel: ${user.display_name || user.login}`,
    });
    if (ret > 0) {
      await setReturnedQuantity(client, {
        issuanceId,
        materialId: mat.id,
        oldReturned: 0,
        newReturned: ret,
        userId: confirmedBy,
        syncStock: false,
      });
    }
    return issuanceId;
  }

  const ins = await client.query(
    `INSERT INTO issuances (
       material_id, issued_by_user_id, issued_to_user_id, quantity, note, issued_at,
       returned_quantity, returned_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $7::numeric > 0 THEN NOW() ELSE NULL END)
     RETURNING id`,
    [
      mat.id,
      confirmedBy,
      user.id,
      qty,
      item.note || null,
      issuedAt,
      ret,
    ],
  );
  return ins.rows[0].id;
}

export async function previewIssuancesImport(client, items, pendingMaterials = []) {
  const warnings = [];
  let toCreate = 0;
  let toUpdate = 0;
  for (const item of items) {
    try {
      const { iss, isNew } = await resolveIssuanceForImport(client, item, pendingMaterials);
      if (isNew) toCreate += 1;
      else toUpdate += 1;
      const qtyCheck = item.quantity ?? (iss ? parseFloat(iss.quantity) : 0);
      const retCheck = item.returned_quantity ?? (iss ? parseFloat(iss.returned_quantity || 0) : 0);
      if (qtyCheck != null && retCheck > qtyCheck + 1e-9) {
        throw new Error('Возврат больше выданного');
      }
    } catch (e) {
      warnings.push({
        row: item.rowNum,
        sheet: item.sheet,
        code: item.material_code,
        error: e.message,
      });
    }
  }
  return { total: items.length, toCreate, toUpdate, warnings };
}

export async function previewProductionImport(
  client,
  items,
  pendingIssuances = [],
  pendingMaterials = [],
) {
  const warnings = [];
  let toUpdate = 0;
  for (const item of items) {
    try {
      if (item.production_confirmed === null && !item.issuance_id) {
        throw new Error('Укажите «Подтверждено» или ID выдачи');
      }
      if (findPendingIssuance(pendingIssuances, item)) {
        toUpdate += 1;
        continue;
      }
      if (findMaterialInPending(pendingMaterials, item.material_code)
        && !await findMaterialByCode(client, item.material_code)) {
        toUpdate += 1;
        continue;
      }
      await resolveIssuanceForProduction(client, item, pendingMaterials);
      toUpdate += 1;
    } catch (e) {
      warnings.push({
        row: item.rowNum,
        sheet: item.sheet,
        code: item.material_code || String(item.issuance_id || ''),
        error: e.message,
      });
    }
  }
  return { total: items.length, toUpdate, warnings };
}

export async function importIssuancesFromExcel(client, items, userId, options = {}) {
  const syncStock = options.syncStock === true;
  const result = { created: 0, updated: 0, errors: [] };
  for (const item of items) {
    try {
      const resolved = await resolveIssuanceForImport(client, item);
      if (resolved.materialPending) {
        const mat = await findMaterialByCode(client, item.material_code);
        if (!mat) {
          throw new Error(
            `Материал «${item.material_code}» не найден после импорта склада. Проверьте лист «Склад»`,
          );
        }
        resolved.mat = mat;
      }
      if (resolved.isNew) {
        await createIssuance(client, {
          mat: resolved.mat,
          user: resolved.user,
          item,
          userId,
          syncStock,
        });
        result.created += 1;
      } else {
        const iss = resolved.iss;
        const oldQty = parseFloat(iss.quantity);
        const oldRet = parseFloat(iss.returned_quantity || 0);
        if (item.quantity != null && item.quantity > 0 && Math.abs(item.quantity - oldQty) > 1e-9) {
          await adjustIssuanceQuantity(client, {
            issuanceId: iss.id,
            materialId: iss.material_id,
            oldQty,
            newQty: item.quantity,
            userId,
            syncStock,
          });
        }
        if (item.returned_quantity != null && Math.abs(item.returned_quantity - oldRet) > 1e-9) {
          await setReturnedQuantity(client, {
            issuanceId: iss.id,
            materialId: iss.material_id,
            oldReturned: oldRet,
            newReturned: item.returned_quantity,
            userId,
            syncStock,
          });
        }
        if (item.note) {
          await client.query('UPDATE issuances SET note = $1 WHERE id = $2', [item.note, iss.id]);
        }
        if (item.issued_at) {
          await client.query(
            'UPDATE issuances SET issued_at = $1::timestamptz WHERE id = $2',
            [item.issued_at, iss.id],
          );
        }
        result.updated += 1;
      }
    } catch (e) {
      result.errors.push({
        row: item.rowNum,
        sheet: item.sheet,
        code: item.material_code,
        error: e.message || 'Ошибка',
      });
    }
  }
  return result;
}

function parseUserId(userId) {
  const n = parseInt(userId, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function importProductionFromExcel(client, items, userId) {
  const result = { updated: 0, errors: [] };
  const confirmedBy = parseUserId(userId);
  for (const item of items) {
    try {
      const iss = await resolveIssuanceForProduction(client, item);
      const confirmed = item.production_confirmed;
      if (confirmed === null && !item.production_confirmed_at) continue;

      const wasConfirmed = !!iss.production_confirmed;
      const nextConfirmed = confirmed !== null ? confirmed : wasConfirmed;
      const confirmedAt = item.production_confirmed_at != null
        ? item.production_confirmed_at
        : (nextConfirmed ? (iss.production_confirmed_at || new Date()) : null);

      await client.query(
        `UPDATE issuances SET
           production_confirmed = $1,
           production_confirmed_at = $2,
           production_confirmed_by = $3
         WHERE id = $4`,
        [nextConfirmed, confirmedAt, nextConfirmed ? confirmedBy : null, iss.id],
      );

      if (item.issued_at) {
        await client.query(
          'UPDATE issuances SET issued_at = $1::timestamptz WHERE id = $2',
          [item.issued_at, iss.id],
        );
      }

      if (wasConfirmed !== nextConfirmed) {
        await logProductionConfirmation(client, {
          issuanceId: iss.id,
          userId: confirmedBy,
          confirmed: nextConfirmed,
          eventType: nextConfirmed ? 'confirm' : 'unconfirm',
        });
      }
      result.updated += 1;
    } catch (e) {
      result.errors.push({
        row: item.rowNum,
        sheet: item.sheet,
        code: item.material_code || String(item.issuance_id || ''),
        error: e.message || 'Ошибка',
      });
    }
  }
  return result;
}

export async function loadIssuancesForExport(client, materialIds) {
  if (!materialIds?.length) return [];
  const r = await client.query(
    `SELECT i.id, i.issued_at, i.quantity, i.returned_quantity, i.note,
            m.code AS material_code, m.name AS material_name, m.unit,
            u.login AS issued_to_login,
            COALESCE(u.display_name, u.login) AS issued_to_name
     FROM issuances i
     JOIN materials m ON m.id = i.material_id
     JOIN users u ON u.id = i.issued_to_user_id
     WHERE i.material_id = ANY($1::int[])
     ORDER BY i.issued_at DESC`,
    [materialIds],
  );
  return r.rows;
}

export async function loadProductionForExport(client, materialIds, catalog) {
  if (!materialIds?.length) return [];
  const r = await client.query(
    `SELECT i.id AS issuance_id, i.issued_at, i.quantity, i.returned_quantity,
            i.production_confirmed, i.production_confirmed_at,
            GREATEST(i.quantity - COALESCE(i.returned_quantity, 0), 0) AS produced,
            m.code AS material_code, m.name AS material_name,
            COALESCE(m.production_price, 0) AS production_price,
            u.login, COALESCE(u.display_name, u.login) AS display_name,
            ${WORK_LOCATION_SELECT}
     FROM issuances i
     JOIN materials m ON m.id = i.material_id
     JOIN users u ON u.id = i.issued_to_user_id
     ${WORK_LOCATION_JOIN}
     WHERE i.material_id = ANY($1::int[])
     ORDER BY i.issued_at DESC`,
    [materialIds],
  );
  return r.rows.map((row) => {
    const produced = parseFloat(row.produced) || 0;
    const unitSmr = parseFloat(row.production_price) || 0;
    return {
      ...row,
      smr_total: produced * unitSmr,
      work_location_label: formatWorkLocationLabel(row, catalog),
    };
  });
}

export function collectMaterialIdsFromExpanded(expandedRows) {
  const ids = new Set();
  for (const m of expandedRows || []) {
    if (m.id) ids.add(m.id);
  }
  return [...ids];
}
