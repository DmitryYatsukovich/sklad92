import QRCode from 'qrcode';
import PDFDocument from 'pdfkit';
import { registerPdfFonts, pdfDocToBuffer } from './pdf-cyrillic.js';

function formatMoney(n) {
  return `${(Number(n) || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;
}

export async function buildMaterialQrPdf({
  name,
  code,
  location,
  quantity,
  unit,
  price,
  production_price,
  cost_total,
  smr_total,
}) {
  const qrPng = await QRCode.toBuffer(String(code), {
    width: 280,
    margin: 2,
    errorCorrectionLevel: 'M',
  });

  const doc = new PDFDocument({ size: 'A5', margin: 40 });
  registerPdfFonts(doc);
  const bufferPromise = pdfDocToBuffer(doc);

  const left = doc.page.margins.left;
  const pageWidth = doc.page.width - left - doc.page.margins.right;

  doc.fillColor('#000000');
  doc.font('DejaVu-Bold').fontSize(14).text(String(name || code), left, doc.y, {
    width: pageWidth,
    align: 'center',
  });
  doc.moveDown(0.35);
  doc.font('DejaVuMono').fontSize(10).fillColor('#444444').text(String(code), {
    width: pageWidth,
    align: 'center',
  });
  if (location) {
    doc.moveDown(0.25);
    doc.font('DejaVu').fontSize(9).fillColor('#666666').text(String(location), {
      width: pageWidth,
      align: 'center',
    });
  }

  if (quantity != null || price != null || production_price != null) {
    doc.moveDown(0.5);
    doc.font('DejaVu').fontSize(9).fillColor('#333333');
    const qty = Number(quantity) || 0;
    const u = unit || '';
    doc.text(`На складе: ${qty} ${u}`.trim(), left, doc.y, { width: pageWidth, align: 'center' });
    doc.text(`Стоимость за ед.: ${formatMoney(price)}`, { width: pageWidth, align: 'center' });
    doc.text(`Стоимость: ${formatMoney(cost_total ?? qty * Number(price ?? 0))}`, {
      width: pageWidth,
      align: 'center',
    });
    doc.text(`СМР за ед.: ${formatMoney(production_price)}`, { width: pageWidth, align: 'center' });
    doc.text(`СМР: ${formatMoney(smr_total ?? qty * Number(production_price ?? 0))}`, {
      width: pageWidth,
      align: 'center',
    });
  }

  doc.moveDown(1);

  const qrSize = 170;
  const qrX = left + (pageWidth - qrSize) / 2;
  doc.image(qrPng, qrX, doc.y, { width: qrSize, height: qrSize });
  doc.end();
  return bufferPromise;
}
