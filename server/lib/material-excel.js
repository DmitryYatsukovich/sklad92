import XLSX from 'xlsx';
import {
  createLandscapePdfDoc,
  pdfDocToBuffer,
  registerPdfFonts,
} from './pdf-cyrillic.js';

export const TEMPLATE_HEADERS = [
  'Код', 'Наименование', 'Ед.изм.', 'Цена', 'СМР', 'Количество',
  'Объект', 'Склад', 'Стеллаж', 'Категория',
];

export const EXPORT_HEADERS = [
  'Код', 'Наименование', 'Объект', 'Склад', 'Стеллаж', 'Категория',
  'Ед.изм.', 'Цена', 'СМР', 'Количество', 'Изменён',
];

const HEADER_ALIASES = {
  code: ['код', 'code'],
  name: ['наименование', 'наимен', 'name', 'название'],
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
    for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.some((a) => n === a || n.startsWith(a))) {
        if (colMap[key] === undefined) colMap[key] = idx;
      }
    }
  });
  return colMap;
}

function cellVal(row, idx) {
  if (idx === undefined || idx < 0) return '';
  const v = row[idx];
  if (v == null) return '';
  return String(v).trim();
}

export function buildTemplateBuffer() {
  const ws = XLSX.utils.aoa_to_sheet([
    TEMPLATE_HEADERS,
    ['', 'Цемент М500', 'шт', '3500', '1200', '100', 'Объект 1', 'Склад А', 'Стеллаж 1', 'Стройматериалы'],
  ]);
  ws['!cols'] = TEMPLATE_HEADERS.map((h) => ({ wch: Math.max(12, h.length + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Материалы');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

export function parseImportSheet(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error('Файл пустой');
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
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

    items.push({
      rowNum: i + 1,
      code: cellVal(row, colMap.code),
      name,
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

  if (items.length === 0) throw new Error('Нет заполненных строк для импорта');
  return items;
}

export function rowToExportArray(m) {
  const loc = [m.object_name, m.warehouse_name, m.rack_name].filter(Boolean);
  return [
    m.code || '',
    m.name || '',
    m.object_name || '',
    m.warehouse_name || '',
    m.rack_name || '',
    m.category_name || '',
    m.unit || '',
    Number(m.price ?? 0),
    Number(m.production_price ?? 0),
    Number(m.quantity ?? 0),
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

export function buildExportXlsx(rows) {
  const data = [EXPORT_HEADERS, ...rows.map(rowToExportArray)];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = EXPORT_HEADERS.map((h) => ({ wch: Math.max(10, h.length + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Склад');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

export function buildExportPdf(rows) {
  const doc = createLandscapePdfDoc();
  const bufferPromise = pdfDocToBuffer(doc);

  doc.font('DejaVu-Bold').fontSize(12).fillColor('#000000').text('Склад — выгрузка материалов', { align: 'left' });
  doc.font('DejaVu').fontSize(8).text(`Дата: ${new Date().toLocaleString('ru-RU')}`, { align: 'left' });
  doc.moveDown(0.5);

  const cols = EXPORT_HEADERS;
  const colWidths = [52, 90, 48, 48, 42, 48, 28, 36, 36, 36, 58];
  const startX = doc.page.margins.left;
  let y = doc.y;
  const rowH = 14;
  const pageBottom = doc.page.height - doc.page.margins.bottom;
  const tableWidth = colWidths.reduce((a, b) => a + b, 0);

  const drawHeader = () => {
    let x = startX;
    doc.font('DejaVu-Bold').fontSize(7).fillColor('#000000');
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
      doc.addPage({ layout: 'landscape', margin: 28 });
      registerPdfFonts(doc);
      y = doc.page.margins.top;
      drawHeader();
    }
    const cells = rowToExportArray(m);
    let x = startX;
    doc.font('DejaVu').fontSize(6.5).fillColor('#111111');
    cells.forEach((text, i) => {
      const font = i === 0 ? 'DejaVuMono' : 'DejaVu';
      doc.font(font);
      const t = String(text ?? '').slice(0, i === 1 ? 42 : 24);
      doc.text(t, x, y, { width: colWidths[i], lineBreak: false });
      x += colWidths[i];
    });
    y += rowH;
  });

  doc.end();
  return bufferPromise;
}

/** Поиск id справочника по имени (без учёта регистра) */
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
