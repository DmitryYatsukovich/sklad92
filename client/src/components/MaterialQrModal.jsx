import { useRef, useCallback, useState, useEffect } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { materials as materialsApi } from '../api';
import { locationLabel } from '../lib/materialForm';
import { materialStockTotals } from '../lib/materialStock';
import {
  materialGroupSummary,
  materialDisplayName,
  materialGroupParentId,
  isMaterialPart,
} from '../lib/materialDisplay';
import MaterialStockSummary from './MaterialStockSummary';

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatQty(n) {
  return (Number(n) || 0).toLocaleString('ru-RU', { maximumFractionDigits: 4 });
}

const LABEL_WIDTH_MM = 29;
const LABEL_PAGE_HEIGHT_MM = 89;
const LABEL_CONTENT_HEIGHT_MM = 78;
const LABEL_PIXELS_PER_MM = 16;
const QR_BOX_MM = 26.9;
const QR_QUIET_ZONE_MM = 0.65;
const QR_TOP_MM = 4;

function mmToPx(mm) {
  return Math.max(1, Math.round(mm * LABEL_PIXELS_PER_MM));
}

function loadImageFromSrc(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Image load failed'));
    image.src = src;
  });
}

function canvasToPngDataUrl(canvasEl) {
  if (!canvasEl || typeof canvasEl.toDataURL !== 'function') {
    throw new Error('Canvas unavailable');
  }
  return canvasEl.toDataURL('image/png');
}

function wrapTextLines(ctx, text, maxWidthPx, maxLines = 2) {
  const source = String(text || '').trim();
  if (!source) return [];
  const words = source.split(/\s+/);
  const lines = [];
  let line = '';

  const pushLine = (value) => {
    if (!value) return;
    if (lines.length < maxLines) lines.push(value);
  };

  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidthPx) {
      line = next;
      continue;
    }
    if (!line) {
      let chunk = '';
      for (const ch of word) {
        const test = chunk + ch;
        if (ctx.measureText(test).width <= maxWidthPx) {
          chunk = test;
        } else {
          pushLine(chunk);
          chunk = ch;
          if (lines.length >= maxLines) break;
        }
      }
      line = chunk;
      if (lines.length >= maxLines) break;
      continue;
    }
    pushLine(line);
    line = word;
    if (lines.length >= maxLines) break;
  }

  if (lines.length < maxLines && line) pushLine(line);
  return lines.slice(0, maxLines);
}

async function buildMaterialLabelImageDataUrl(title, qrImageSrc) {
  const labelWidthPx = mmToPx(LABEL_WIDTH_MM);
  const labelHeightPx = mmToPx(LABEL_CONTENT_HEIGHT_MM);
  const canvas = document.createElement('canvas');
  canvas.width = labelWidthPx;
  canvas.height = labelHeightPx;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas context unavailable');

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const qrImage = await loadImageFromSrc(qrImageSrc);
  const qrBoxPx = mmToPx(QR_BOX_MM);
  const qrInsetPx = mmToPx(QR_QUIET_ZONE_MM);
  const qrContentPx = Math.max(1, qrBoxPx - (qrInsetPx * 2));
  const qrX = Math.round((labelWidthPx - qrBoxPx) / 2);
  const qrY = mmToPx(QR_TOP_MM);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(qrImage, qrX + qrInsetPx, qrY + qrInsetPx, qrContentPx, qrContentPx);

  const nameTopPx = qrY + qrBoxPx + mmToPx(1.0);
  const horizontalPadPx = mmToPx(1.2);
  const maxTextWidthPx = labelWidthPx - (horizontalPadPx * 2);
  const fontSizePx = mmToPx(2.2);
  const lineHeightPx = Math.round(fontSizePx * 1.12);
  ctx.fillStyle = '#111';
  ctx.font = `600 ${fontSizePx}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const lines = wrapTextLines(ctx, title, maxTextWidthPx, 2);
  lines.forEach((line, index) => {
    ctx.fillText(line, Math.round(labelWidthPx / 2), nameTopPx + (lineHeightPx * index), maxTextWidthPx);
  });

  return canvas.toDataURL('image/png');
}

function buildMaterialPrintHtml(title, labelImageSrc) {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>Этикетка — ${escapeHtml(title)}</title>
  <style>
    @page { size: ${LABEL_WIDTH_MM}mm ${LABEL_PAGE_HEIGHT_MM}mm; margin: 0; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html, body {
      margin: 0;
      padding: 0;
      width: ${LABEL_WIDTH_MM}mm;
      background: #fff;
      font-size: 0;
      line-height: 0;
      overflow: hidden;
    }
    .page {
      width: ${LABEL_WIDTH_MM}mm;
      height: ${LABEL_CONTENT_HEIGHT_MM}mm;
      overflow: hidden;
      margin: 0;
      padding: 0;
      break-inside: avoid;
      page-break-inside: avoid;
      break-after: avoid-page;
      page-break-after: avoid;
    }
    .sheet {
      display: block;
      width: ${LABEL_WIDTH_MM}mm;
      height: ${LABEL_CONTENT_HEIGHT_MM}mm;
      margin: 0;
      padding: 0;
      border: 0;
      object-fit: fill;
      vertical-align: top;
    }
  </style>
</head>
<body>
  <div class="page"><img class="sheet" src="${labelImageSrc}" alt="${escapeHtml(title)}" /></div>
</body>
</html>`;
}

export default function MaterialQrModal({ material, groupInfo: groupInfoProp, onClose }) {
  const groupInfo = groupInfoProp || materialGroupSummary(material);
  const groupParentId = materialGroupParentId(material);
  const qrRef = useRef(null);
  const [downloading, setDownloading] = useState(false);
  const [actionError, setActionError] = useState('');
  const [partsList, setPartsList] = useState([]);
  const [loadingParts, setLoadingParts] = useState(false);

  useEffect(() => {
    if (!groupParentId) {
      setPartsList([]);
      return undefined;
    }
    let cancelled = false;
    setLoadingParts(true);
    materialsApi.getParts(groupParentId)
      .then((data) => {
        if (!cancelled) setPartsList(data.parts || []);
      })
      .catch(() => {
        if (!cancelled) setPartsList([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingParts(false);
      });
    return () => { cancelled = true; };
  }, [groupParentId, material?.id]);

  const displayTitle = materialDisplayName(material) || material?.name || material?.code;
  const isPart = isMaterialPart(material);

  const handlePrint = useCallback(async () => {
    const qrCanvas = qrRef.current?.querySelector('canvas');
    if (!qrCanvas || !material?.code) return;
    setActionError('');
    let labelImageSrc = '';
    try {
      const qrImageSrc = canvasToPngDataUrl(qrCanvas);
      labelImageSrc = await buildMaterialLabelImageDataUrl(displayTitle, qrImageSrc);
    } catch {
      setActionError('Не удалось подготовить QR для печати');
      return;
    }
    const html = buildMaterialPrintHtml(displayTitle, labelImageSrc);
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:fixed;left:-10000px;top:0;width:420px;height:920px;border:0;opacity:0;pointer-events:none;';
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
      const runPrint = () => setTimeout(() => {
        win.focus();
        win.print();
      }, 140);
      const sheet = doc.querySelector('.sheet');
      if (sheet && !sheet.complete) {
        sheet.addEventListener('load', runPrint, { once: true });
        sheet.addEventListener('error', () => setActionError('Не удалось подготовить QR для печати'), { once: true });
      } else {
        runPrint();
      }
    } catch {
      cleanup();
      setActionError('Не удалось открыть печать');
    }
  }, [material, displayTitle]);

  const handleDownloadPdf = useCallback(async () => {
    if (!material?.code) return;
    setDownloading(true);
    setActionError('');
    try {
      const stock = materialStockTotals(material);
      await materialsApi.downloadQrPdf({
        name: displayTitle,
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
  }, [material, displayTitle]);

  if (!material?.code) return null;

  const loc = locationLabel(material);
  const stockLabel = isPart ? 'Количество этой части' : 'На складе';

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
        <div className="p-6 flex flex-col items-center text-center max-h-[90vh] overflow-y-auto">
          <p className="text-2xs uppercase tracking-widest text-zinc-500 mb-2">QR-код материала</p>
          <h2 id="qr-modal-title" className="text-base font-semibold text-white leading-snug mb-1">
            {displayTitle}
          </h2>
          <span className="inline-block font-mono text-xs text-zinc-400 bg-white/5 border border-white/10 rounded px-2 py-0.5 mb-1">
            {material.code}
          </span>
          {loc && (
            <p className="text-2xs text-zinc-500 mb-1 max-w-[16rem]">{loc}</p>
          )}
          {groupInfo && (
            <div className="text-2xs text-zinc-300 mb-3 max-w-[20rem] w-full text-left px-1 space-y-2 border border-white/10 rounded-lg p-3 bg-white/5">
              <p>
                <span className="text-zinc-500">Всего на складе:</span>{' '}
                <span className="text-white font-medium tabular-nums">
                  {formatQty(groupInfo.totalQty)} {groupInfo.unit}
                </span>
              </p>
              <p>
                <span className="text-zinc-500">Частей:</span>{' '}
                <span className="text-white tabular-nums">{groupInfo.partsCount}</span>
              </p>
              {isPart && groupInfo.partIndex != null && (
                <p>
                  <span className="text-zinc-500">Эта часть:</span>{' '}
                  <span className="text-white">
                    {groupInfo.partLabel || `Часть ${groupInfo.partIndex}`}
                    {' — '}
                    <span className="tabular-nums">{formatQty(groupInfo.partQty)} {groupInfo.unit}</span>
                  </span>
                </p>
              )}
              {(loadingParts || partsList.length > 0) && (
                <div className="pt-2 border-t border-white/10">
                  <p className="text-zinc-500 mb-1.5">Состав:</p>
                  {loadingParts && (
                    <p className="text-zinc-500">Загрузка…</p>
                  )}
                  {!loadingParts && partsList.length > 0 && (
                    <ul className="space-y-1 max-h-32 overflow-y-auto">
                      {partsList.map((p) => (
                        <li
                          key={p.id}
                          className={`tabular-nums ${p.id === material.id ? 'text-brand-300' : 'text-zinc-400'}`}
                        >
                          {p.part_label || `Часть ${p.part_index}`}
                          : {formatQty(p.quantity)} {material.unit || groupInfo.unit}
                          <span className="text-zinc-500"> · {locationLabel(p)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
          <MaterialStockSummary material={material} stockLabel={stockLabel} className="mb-4" />
          <div
            ref={qrRef}
            className="rounded-xl bg-white p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_8px_32px_rgba(0,0,0,0.4)]"
          >
            <QRCodeCanvas value={material.code} size={220} level="M" includeMargin={false} />
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
