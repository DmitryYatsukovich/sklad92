import XLSX from 'xlsx';
import {
  createLandscapePdfDoc,
  pdfDocToBuffer,
  registerPdfFonts,
} from './pdf-cyrillic.js';
import { MATERIAL_SELECT, MATERIAL_FROM } from './material-select.js';
import { MATERIAL_GROUP_JOINS, MATERIAL_GROUP_SELECT_EXTRA } from './material-parts.js';
import {
  appendOperationsSheets,
  findWorkbookSheet,
  parseIssuanceSheet,
  parseProductionSheet,
} from './warehouse-operations-excel.js';

export const TEMPLATE_HEADERS = [
  'Тип',
  'Код группы',
  'Код',
  'Наименование',
  'Метка части',
  '№ части',
  'Ед.изм.',
  'Цена',
  'СМР',
  'Количество',
  'Объект',
  'Склад',
  'Стеллаж',
  'Категория',
];

export const EXPORT_HEADERS = [
  'Тип',
  'Код группы',
  'Код',
  'Наименование',
  'Метка части',
  '№ части',
  'Объект',
  'Склад',
  'Стеллаж',
  'Категория',
  'Ед.изм.',
  'Цена',
  'СМР',
  'Количество',
  'Изменён',
];

const HEADER_ALIASES = {
  row_type: ['тип', 'тип строки', 'type', 'row_type'],
  group_code: ['код группы', 'код группы', 'group_code', 'кодгруппы'],
  code: ['код', 'code', 'qr'],
  name: ['наименование', 'наимен', 'name', 'название'],
  part_label: ['метка части', 'часть', 'part_label', 'метка'],
  part_index: ['№ части', '№', 'номер части', 'part_index', 'part_no'],
  unit: ['ед.изм', 'ед.изм.', 'ед', 'unit', 'единица'],
  price: ['цена', 'price'],
  smr: ['смр', 'production_price', 'цена выраб', 'выработка', 'выраб'],
  quantity: ['количество', 'кол', 'кол-во', 'quantity', 'остаток'],
  object: ['объект', 'object', 'object_name'],
  warehouse: ['склад', 'warehouse', 'warehouse_name'],
  rack: ['стеллаж', 'rack', 'rack_name'],
  category: ['категория', 'кат', 'category', 'category_name'],
};

function normHeader(h) {
  return String(h ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function mapHeaders(headerRow) {
  const colMap = {};
  headerRow.forEach((h, idx) => {
    const n = normHeader(h);
    if (!n) return;
    let bestKey = null;
    let bestLen = 0;
    for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
      for (const a of aliases) {
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

export function normalizeRowType(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (['группа', 'group', 'гр'].includes(s)) return 'group';
  if (['часть', 'part', 'ч'].includes(s)) return 'part';
  if (['одиночный', 'single', 'материал', ''].includes(s) || !s) return 'single';
  return 'single';
}

/** Уточнить тип строки, если в файле нет столбца «Тип» или он пустой. */
export function inferImportRowType({ rowType, group_code, code, part_label, part_index }) {
  const explicit = normalizeRowType(rowType);
  if (explicit === 'group' || explicit === 'part') return explicit;
  const gc = String(group_code || '').trim();
  const c = String(code || '').trim();
  if (!gc) return 'single';
  if (c && c.toLowerCase() !== gc.toLowerCase()) return 'part';
  if (part_label || part_index != null) return 'part';
  if (!c || c.toLowerCase() === gc.toLowerCase()) return 'group';
  return 'single';
}

export function rowTypeLabel(type) {
  if (type === 'group') return 'группа';
  if (type === 'part') return 'часть';
  return 'одиночный';
}

export function buildTemplateBuffer() {
  const ws = XLSX.utils.aoa_to_sheet([
    TEMPLATE_HEADERS,
    [
      'группа', 'GRP-CEM-01', 'GRP-CEM-01', 'Цемент М500', '', '',
      'шт', '3500', '1200', '0',
      'Объект 1', 'Склад А', '', 'Стройматериалы',
    ],
    [
      'часть', 'GRP-CEM-01', 'GRP-CEM-01-P1', 'Цемент М500', 'Часть 1', '1',
      'шт', '3500', '1200', '60',
      'Объект 1', 'Склад А', 'Стеллаж 1', 'Стройматериалы',
    ],
    [
      'часть', 'GRP-CEM-01', 'GRP-CEM-01-P2', 'Цемент М500', 'Часть 2', '2',
      'шт', '3500', '1200', '40',
      'Объект 1', 'Склад А', 'Стеллаж 2', 'Стройматериалы',
    ],
    [
      'одиночный', '', 'MAT-KIRP-01', 'Кирпич керамический', '', '',
      'шт', '25', '8', '500',
      'Объект 1', 'Склад Б', 'Стеллаж 1', 'Стройматериалы',
    ],
  ]);
  ws['!cols'] = TEMPLATE_HEADERS.map((h) => ({ wch: Math.max(14, h.length + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Склад');
  appendOperationsSheets(wb, { issuances: [], production: [] });
  const instr = XLSX.utils.aoa_to_sheet([
    ['Подсказка'],
    ['Тип: одиночный — обычный материал; группа — заголовок разделённого; часть — строка части (нужен код группы).'],
    ['Для группы количество в файле не используется — сумма считается по частям.'],
    ['Код группы у частей должен совпадать с кодом строки «группа».'],
    ['Код QR у каждой части должен быть уникальным.'],
    ['Лист «Выдача»: ID пустой — новая выдача; с ID — обновление.'],
    ['Лист «Выработка»: ID выдачи или QR + логин + дата; колонка «Подтверждено» — да/нет.'],
  ]);
  XLSX.utils.book_append_sheet(wb, instr, 'Справка');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

const SKIP_FIRST_SHEET_NAMES = new Set(['справка', 'выдача', 'выработка', 'help']);

function parseMaterialsFromRows(rows) {
  if (rows.length < 2) throw new Error('Нет строк данных (нужна шапка и хотя бы одна строка)');

  const colMap = mapHeaders(rows[0]);
  if (colMap.name === undefined) {
    throw new Error('Не найден столбец «Наименование» в первой строке');
  }

  const items = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c) => c === '' || c == null)) continue;

    const name = cellVal(row, colMap.name);
    if (!name) continue;

    const groupCode = cellVal(row, colMap.group_code);
    const code = cellVal(row, colMap.code);
    const part_label = cellVal(row, colMap.part_label);

    let partIndex = null;
    const piRaw = cellVal(row, colMap.part_index);
    if (piRaw !== '') {
      const n = parseInt(piRaw, 10);
      if (!Number.isNaN(n) && n > 0) partIndex = n;
    }

    const rowType = inferImportRowType({
      rowType: cellVal(row, colMap.row_type),
      group_code: groupCode,
      code,
      part_label,
      part_index: partIndex,
    });

    if (rowType === 'part' && !groupCode) {
      throw new Error(`Строка ${i + 1}: для типа «часть» укажите «Код группы»`);
    }
    if (rowType === 'group' && !code && !groupCode) {
      throw new Error(`Строка ${i + 1}: для типа «группа» укажите «Код»`);
    }

    items.push({
      rowNum: i + 1,
      rowType,
      group_code: groupCode || (rowType === 'group' ? code : ''),
      code,
      name,
      part_label,
      part_index: partIndex,
      unit: cellVal(row, colMap.unit) || 'шт',
      price: cellVal(row, colMap.price),
      production_price: cellVal(row, colMap.smr),
      quantity: cellVal(row, colMap.quantity),
      object_name: cellVal(row, colMap.object),
      warehouse_name: cellVal(row, colMap.warehouse),
      rack_name: cellVal(row, colMap.rack),
      category_name: cellVal(row, colMap.category),
    });
  }

  return items;
}

export function parseImportWorkbook(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  if (!wb.SheetNames?.length) throw new Error('Файл пустой');

  let materialsSheet = findWorkbookSheet(wb, 'склад', 'материалы', 'materials');
  if (!materialsSheet) {
    const firstName = wb.SheetNames[0];
    const firstNorm = normHeader(firstName);
    if (!SKIP_FIRST_SHEET_NAMES.has(firstNorm)) {
      materialsSheet = wb.Sheets[firstName];
    } else if (wb.SheetNames[1]) {
      const secondNorm = normHeader(wb.SheetNames[1]);
      if (!SKIP_FIRST_SHEET_NAMES.has(secondNorm)) {
        materialsSheet = wb.Sheets[wb.SheetNames[1]];
      }
    }
  }

  const issuanceSheet = findWorkbookSheet(wb, 'выдача', 'issuances');
  const productionSheet = findWorkbookSheet(wb, 'выработка', 'production');

  let materials = [];
  if (materialsSheet) {
    const rows = XLSX.utils.sheet_to_json(materialsSheet, { header: 1, defval: '' });
    if (rows.length >= 2) {
      materials = parseMaterialsFromRows(rows);
    }
  }

  const issuances = issuanceSheet ? parseIssuanceSheet(issuanceSheet) : [];
  const production = productionSheet ? parseProductionSheet(productionSheet) : [];

  if (!materials.length && !issuances.length && !production.length) {
    throw new Error('Нет данных для импорта (листы Склад, Выдача или Выработка)');
  }

  return { materials, issuances, production };
}

/** @deprecated use parseImportWorkbook — только материалы с первого листа */
export function parseImportSheet(buffer) {
  const { materials } = parseImportWorkbook(buffer);
  if (!materials.length) {
    throw new Error('Нет заполненных строк материалов для импорта');
  }
  return materials;
}

function exportRowType(m) {
  if (m.row_type === 'group' || m.row_type === 'part' || m.row_type === 'single') return m.row_type;
  if (m.parent_material_id) return 'part';
  if (Number(m.parts_count) > 0) return 'group';
  return 'single';
}

export function rowToExportArray(m) {
  const t = exportRowType(m);
  const qty = t === 'group'
    ? Number(m.group_total_quantity ?? m.quantity ?? 0)
    : Number(m.quantity ?? 0);
  const groupCodeCol = t === 'part'
    ? (m.group_code || m.group_code_export || '')
    : (t === 'group' ? (m.code || '') : '');
  return [
    rowTypeLabel(t),
    groupCodeCol,
    m.code || '',
    m.name || '',
    m.part_label || '',
    m.part_index != null && m.part_index !== '' ? m.part_index : '',
    m.object_name || '',
    m.warehouse_name || '',
    m.rack_name || '',
    m.category_name || '',
    m.unit || '',
    Number(m.price ?? 0),
    Number(m.production_price ?? 0),
    qty,
    formatUpdatedAt(m.updated_at),
  ];
}

export function formatUpdatedAt(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/** Развернуть группы в строки для выгрузки (группа + все части). */
export async function expandExportRows(client, rows) {
  const out = [];
  for (const m of rows || []) {
    if (m.parent_material_id) continue;
    const childCnt = (await client.query(
      'SELECT COUNT(*)::int AS c FROM materials WHERE parent_material_id = $1',
      [m.id],
    )).rows[0]?.c || 0;
    if (childCnt > 0) {
      out.push({
        ...m,
        row_type: 'group',
        quantity: Number(m.group_total_quantity) || 0,
      });
      const parts = (await client.query(
        `SELECT ${MATERIAL_SELECT}${MATERIAL_GROUP_SELECT_EXTRA}
         ${MATERIAL_FROM}
         ${MATERIAL_GROUP_JOINS}
         WHERE m.parent_material_id = $1
         ORDER BY m.part_index NULLS LAST, m.id`,
        [m.id],
      )).rows;
      for (const p of parts) {
        out.push({
          ...p,
          row_type: 'part',
          group_code: m.code || p.group_code,
          name: m.name,
        });
      }
    } else {
      out.push({ ...m, row_type: 'single' });
    }
  }
  return out;
}

export function buildExportXlsx(rows, operations = {}) {
  const data = [EXPORT_HEADERS, ...rows.map(rowToExportArray)];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = EXPORT_HEADERS.map((h) => ({ wch: Math.max(10, h.length + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Склад');
  appendOperationsSheets(wb, {
    issuances: operations.issuances || [],
    production: operations.production || [],
  }, operations.catalog || null);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

export function buildExportPdf(rows) {
  const doc = createLandscapePdfDoc();
  const bufferPromise = pdfDocToBuffer(doc);

  doc.font('DejaVu-Bold').fontSize(12).fillColor('#000000').text('Склад — выгрузка материалов', { align: 'left' });
  doc.font('DejaVu').fontSize(8).text(`Дата: ${new Date().toLocaleString('ru-RU')}`, { align: 'left' });
  doc.moveDown(0.5);

  const cols = EXPORT_HEADERS;
  const colWidths = [28, 40, 44, 72, 36, 22, 40, 40, 34, 34, 22, 30, 30, 28, 48];
  const startX = doc.page.margins.left;
  let y = doc.y;
  const rowH = 14;
  const pageBottom = doc.page.height - doc.page.margins.bottom;
  const tableWidth = colWidths.reduce((a, b) => a + b, 0);

  const drawHeader = () => {
    let x = startX;
    doc.font('DejaVu-Bold').fontSize(6).fillColor('#000000');
    cols.forEach((label, i) => {
      doc.text(label, x, y, { width: colWidths[i], lineBreak: false });
      x += colWidths[i];
    });
    y += rowH;
    doc.moveTo(startX, y).lineTo(startX + tableWidth, y).stroke('#cccccc');
    y += 2;
  };

  drawHeader();

  rows.forEach((m) => {
    if (y > pageBottom - rowH) {
      doc.addPage({ layout: 'landscape', margin: 22 });
      registerPdfFonts(doc);
      y = doc.page.margins.top;
      drawHeader();
    }
    const cells = rowToExportArray(m);
    let x = startX;
    doc.font('DejaVu').fontSize(5.5).fillColor('#111111');
    cells.forEach((text, i) => {
      const font = i === 3 ? 'DejaVu' : (i === 2 || i === 1 ? 'DejaVuMono' : 'DejaVu');
      doc.font(font);
      const t = String(text ?? '').slice(0, i === 3 ? 36 : 18);
      doc.text(t, x, y, { width: colWidths[i], lineBreak: false });
      x += colWidths[i];
    });
    y += rowH;
  });

  doc.end();
  return bufferPromise;
}

export function buildCatalogLookups(catalog) {
  const byName = (list) => {
    const m = new Map();
    for (const item of list || []) {
      const k = String(item.name || '').trim().toLowerCase();
      if (k) m.set(k, item.id);
    }
    return m;
  };
  return {
    objects: byName(catalog.objects),
    warehouses: (catalog.warehouses || []).map((w) => ({
      id: w.id,
      object_id: w.object_id,
      key: String(w.name || '').trim().toLowerCase(),
    })),
    racks: (catalog.racks || []).map((r) => ({
      id: r.id,
      warehouse_id: r.warehouse_id,
      key: String(r.name || '').trim().toLowerCase(),
    })),
    categories: byName(catalog.categories),
  };
}

export function resolveLocationFromNames(lookups, { object_name, warehouse_name, rack_name }) {
  let object_id = null;
  let warehouse_id = null;
  let rack_id = null;

  const on = String(object_name || '').trim().toLowerCase();
  const wn = String(warehouse_name || '').trim().toLowerCase();
  const rn = String(rack_name || '').trim().toLowerCase();

  if (on) object_id = lookups.objects.get(on) ?? null;
  if (wn) {
    const wh = lookups.warehouses.find((w) => w.key === wn);
    if (wh) {
      warehouse_id = wh.id;
      if (!object_id) object_id = wh.object_id;
    }
  }
  if (rn) {
    const rack = lookups.racks.find((r) => r.key === rn);
    if (rack) {
      rack_id = rack.id;
      if (!warehouse_id) warehouse_id = rack.warehouse_id;
    }
  }

  return { object_id, warehouse_id, rack_id };
}
