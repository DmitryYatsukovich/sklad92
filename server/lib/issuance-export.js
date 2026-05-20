import XLSX from 'xlsx';
import QRCode from 'qrcode';
import {
  createLandscapePdfDoc,
  pdfDocToBuffer,
  registerPdfFonts,
} from './pdf-cyrillic.js';

export const EXPORT_HEADERS = [
  'Дата',
  'QR',
  'Материал',
  'Кому выдан',
  'Выдано',
  'Возвращено',
  'Ед.',
  'Стоимость',
  'СМР',
  'Статус',
];

function formatIssuedAt(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatMoney(n) {
  return (Number(n) || 0).toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function rowStatus(row) {
  if (row.status) return row.status;
  const net = Number(row.net_qty ?? row._netQty);
  if (!Number.isNaN(net)) return net > 0.000001 ? 'Не закрыто' : 'Закрыто';
  const qty = Number(row.quantity ?? row._qty) || 0;
  const ret = Number(row.returned_quantity ?? row._returned) || 0;
  return qty - ret > 0.000001 ? 'Не закрыто' : 'Закрыто';
}

function materialCode(row) {
  return String(row.material_code || '').trim();
}

export function rowToExportArray(row) {
  const qty = Number(row.quantity ?? row._qty) || 0;
  const returned = Number(row.returned_quantity ?? row._returned) || 0;
  const cost = Number(row.cost ?? row._cost) || 0;
  const smr = Number(row.smr ?? row._smr) || 0;
  return [
    formatIssuedAt(row.issued_at),
    materialCode(row),
    row.material_name || '',
    row.recipient || row.issued_to_name || row.issued_to_login || '',
    qty,
    returned,
    row.unit || '',
    formatMoney(cost),
    formatMoney(smr),
    rowStatus(row),
  ];
}

function periodLabel(meta) {
  if (!meta) return '';
  const from = meta.date_from || meta.dateFrom;
  const to = meta.date_to || meta.dateTo;
  if (from && to) return `Период: ${from} — ${to}`;
  if (from) return `С ${from}`;
  if (to) return `По ${to}`;
  return '';
}

export function buildExportXlsx(rows, meta) {
  const data = [EXPORT_HEADERS, ...rows.map(rowToExportArray)];
  const period = periodLabel(meta);
  if (period) data.splice(1, 0, [period]);
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [52, 14, 28, 22, 14, 12, 8, 12, 12, 12].map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Выдача');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

const PDF_COL_WIDTHS = [52, 34, 72, 58, 30, 30, 18, 40, 40, 38];
const QR_CELL = 30;
const TEXT_ROW_H = 14;

async function loadQrPng(code, cache) {
  const key = String(code || '').trim();
  if (!key) return null;
  if (cache.has(key)) return cache.get(key);
  const buf = await QRCode.toBuffer(key, { width: 120, margin: 1, errorCorrectionLevel: 'M' });
  cache.set(key, buf);
  return buf;
}

export async function buildExportPdf(rows, meta) {
  const qrCache = new Map();
  const doc = createLandscapePdfDoc();
  const bufferPromise = pdfDocToBuffer(doc);

  const period = periodLabel(meta);
  const subtitle = [period].filter(Boolean).join(' · ');

  doc.font('DejaVu-Bold').fontSize(12).fillColor('#000000').text('Выдача — выгрузка', { align: 'left' });
  if (subtitle) doc.font('DejaVu').fontSize(8).text(subtitle, { align: 'left' });
  doc.font('DejaVu').fontSize(8).text(
    `Дата формирования: ${new Date().toLocaleString('ru-RU')}`,
    { align: 'left' },
  );
  doc.moveDown(0.5);

  const startX = doc.page.margins.left;
  let y = doc.y;
  const pageBottom = doc.page.height - doc.page.margins.bottom;
  const tableWidth = PDF_COL_WIDTHS.reduce((a, b) => a + b, 0);

  const drawHeader = () => {
    let x = startX;
    doc.font('DejaVu-Bold').fontSize(7).fillColor('#000000');
    EXPORT_HEADERS.forEach((label, i) => {
      doc.text(label, x, y, { width: PDF_COL_WIDTHS[i], lineBreak: false });
      x += PDF_COL_WIDTHS[i];
    });
    y += TEXT_ROW_H;
    doc.moveTo(startX, y).lineTo(startX + tableWidth, y).stroke('#cccccc');
    y += 2;
  };

  drawHeader();

  for (const row of rows) {
    const rowH = Math.max(TEXT_ROW_H, QR_CELL + 2);
    if (y > pageBottom - rowH) {
      doc.addPage({ layout: 'landscape', margin: 28 });
      registerPdfFonts(doc);
      y = doc.page.margins.top;
      drawHeader();
    }

    const cells = rowToExportArray(row);
    const code = materialCode(row);
    const qrPng = await loadQrPng(code, qrCache);
    let x = startX;

    doc.font('DejaVu').fontSize(6.5).fillColor('#111111');

    // Дата
    doc.text(String(cells[0] ?? '').slice(0, 24), x, y + 2, { width: PDF_COL_WIDTHS[0], lineBreak: false });
    x += PDF_COL_WIDTHS[0];

    // QR
    if (qrPng) {
      doc.image(qrPng, x + 1, y, { width: QR_CELL, height: QR_CELL });
    }
    x += PDF_COL_WIDTHS[1];

    // Остальные текстовые колонки
    for (let i = 2; i < cells.length; i += 1) {
      const maxLen = i === 2 ? 40 : 22;
      doc.text(String(cells[i] ?? '').slice(0, maxLen), x, y + 2, {
        width: PDF_COL_WIDTHS[i],
        lineBreak: false,
      });
      x += PDF_COL_WIDTHS[i];
    }

    y += rowH;
  }

  doc.end();
  return bufferPromise;
}
