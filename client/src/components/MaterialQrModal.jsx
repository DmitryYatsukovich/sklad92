import { useRef, useCallback, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { materials as materialsApi } from '../api';
import { locationLabel } from '../lib/materialForm';
import { formatStockMoney, materialStockTotals } from '../lib/materialStock';
import MaterialStockSummary from './MaterialStockSummary';

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export default function MaterialQrModal({ material, onClose }) {
  const qrRef = useRef(null);
  const [downloading, setDownloading] = useState(false);
  const [actionError, setActionError] = useState('');

  const buildPrintHtml = useCallback((svgEl) => {
    const loc = locationLabel(material);
    const title = material.name || material.code;
    const locHtml = loc ? `<p class="loc">${escapeHtml(loc)}</p>` : '';
    const stock = materialStockTotals(material);
    const stockHtml = material.quantity != null || material.price != null || material.production_price != null
      ? `<div class="stock">
  <p><strong>На складе:</strong> ${stock.qty} ${escapeHtml(stock.unit)}</p>
  <p>Стоимость за ед.: ${escapeHtml(formatStockMoney(stock.unitPrice))}</p>
  <p>Стоимость: ${escapeHtml(formatStockMoney(stock.costTotal))}</p>
  <p>СМР за ед.: ${escapeHtml(formatStockMoney(stock.unitSmr))}</p>
  <p>СМР: ${escapeHtml(formatStockMoney(stock.smrTotal))}</p>
</div>`
      : '';
    const svgClone = svgEl.cloneNode(true);
    svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    if (!svgClone.getAttribute('width')) svgClone.setAttribute('width', '220');
    if (!svgClone.getAttribute('height')) svgClone.setAttribute('height', '220');
    return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>QR — ${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 32px 24px;
      font-family: system-ui, -apple-system, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      color: #111;
    }
    h1 { font-size: 18px; font-weight: 600; margin: 0 0 8px; max-width: 320px; line-height: 1.3; }
    .code { font-family: ui-monospace, monospace; font-size: 13px; color: #555; margin-bottom: 6px; }
    .loc { font-size: 12px; color: #777; margin-bottom: 12px; max-width: 300px; }
    .stock { font-size: 12px; color: #333; margin-bottom: 16px; text-align: left; max-width: 280px; }
    .stock p { margin: 4px 0; }
    .qr {
      padding: 16px;
      background: #fff;
      border: 1px solid #e5e5e5;
      border-radius: 12px;
      display: inline-block;
    }
    .qr svg { display: block; width: 220px; height: 220px; }
    @media print { body { padding: 16px; } }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p class="code">${escapeHtml(material.code)}</p>
  ${locHtml}
  ${stockHtml}
  <div class="qr">${svgClone.outerHTML}</div>
</body>
</html>`;
  }, [material]);

  const handlePrint = useCallback(() => {
    const svg = qrRef.current?.querySelector('svg');
    if (!svg || !material?.code) return;
    setActionError('');
    const html = buildPrintHtml(svg);
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.appendChild(iframe);
    const win = iframe.contentWindow;
    if (!win) {
      iframe.remove();
      setActionError('Не удалось открыть печать');
      return;
    }
    const cleanup = () => {
      setTimeout(() => iframe.remove(), 400);
    };
    try {
      const doc = win.document;
      doc.open();
      doc.write(html);
      doc.close();
      win.addEventListener('afterprint', cleanup, { once: true });
      setTimeout(() => {
        win.focus();
        win.print();
      }, 200);
    } catch {
      cleanup();
      setActionError('Не удалось открыть печать');
    }
  }, [material, buildPrintHtml]);

  const handleDownloadPdf = useCallback(async () => {
    if (!material?.code) return;
    setDownloading(true);
    setActionError('');
    try {
      const stock = materialStockTotals(material);
      await materialsApi.downloadQrPdf({
        name: material.name,
        code: material.code,
        location: locationLabel(material) || undefined,
        quantity: stock.qty,
        unit: stock.unit,
        price: stock.unitPrice,
        production_price: stock.unitSmr,
        cost_total: stock.costTotal,
        smr_total: stock.smrTotal,
      });
    } catch (e) {
      setActionError(e.message || 'Не удалось скачать PDF');
    } finally {
      setDownloading(false);
    }
  }, [material]);

  if (!material?.code) return null;

  const loc = locationLabel(material);

  return (
    <div
      className="modal-backdrop z-[100]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="qr-modal-title"
    >
      <div
        className="relative w-full max-w-sm rounded-xl border border-white/15 bg-surface-850 shadow-[0_24px_80px_rgba(0,0,0,0.65)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-1 w-full bg-gradient-to-r from-zinc-600 via-white/40 to-zinc-600" aria-hidden />
        <div className="p-6 flex flex-col items-center text-center">
          <p className="text-2xs uppercase tracking-widest text-zinc-500 mb-2">QR-код материала</p>
          <h2 id="qr-modal-title" className="text-base font-semibold text-white leading-snug mb-1">
            {material.name}
          </h2>
          <span className="inline-block font-mono text-xs text-zinc-400 bg-white/5 border border-white/10 rounded px-2 py-0.5 mb-1">
            {material.code}
          </span>
          {loc && (
            <p className="text-2xs text-zinc-500 mb-3 max-w-[16rem]">{loc}</p>
          )}
          <MaterialStockSummary material={material} className="mb-4" />
          <div
            ref={qrRef}
            className="rounded-xl bg-white p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_8px_32px_rgba(0,0,0,0.4)]"
          >
            <QRCodeSVG value={material.code} size={220} level="M" />
          </div>
          {actionError && (
            <p className="text-red-400 text-2xs mt-4 w-full">{actionError}</p>
          )}
          <div className="flex flex-wrap gap-2 justify-center w-full mt-6 pt-5 border-t border-white/10">
            <button type="button" onClick={handlePrint} className="btn-primary min-w-[6.5rem]">
              Печать
            </button>
            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={downloading}
              className="btn-secondary min-w-[6.5rem] disabled:opacity-50"
            >
              {downloading ? '…' : 'Скачать'}
            </button>
            <button type="button" onClick={onClose} className="btn-ghost min-w-[6.5rem]">
              Закрыть
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
