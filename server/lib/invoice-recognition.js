const UNIT_ALIASES = new Map([
  ['шт', 'шт'],
  ['шг', 'шт'],
  ['шт.', 'шт'],
  ['м', 'м'],
  ['м.', 'м'],
  ['п.м', 'м'],
  ['пм', 'м'],
  ['км', 'км'],
  ['кг', 'кг'],
  ['л', 'л'],
  ['м2', 'м2'],
  ['м²', 'м2'],
  ['м3', 'м3'],
  ['м³', 'м3'],
  ['компл', 'компл'],
  ['компл.', 'компл'],
  ['комплект', 'компл'],
  ['уп', 'уп'],
  ['уп.', 'уп'],
  ['упак', 'уп'],
  ['упак.', 'уп'],
]);

const MATERIAL_ROW_START_RE = /^(\d{1,3})[.)]?\s+(.+)$/;
const USELESS_ROW_RE = /^(счет|сч[eё]т|продавец|покупатель|адрес|инн|кпп|договор|код|наименование|единица|колич|цена|стоим|итого|руководитель|главный бухгалтер|универсальный передаточный)/i;

let workerPromise = null;

function parseLocaleNumber(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const compact = raw.replace(/\s+/g, '');
  if (!compact) return null;

  const hasComma = compact.includes(',');
  const hasDot = compact.includes('.');
  if (hasComma && hasDot) {
    const lastComma = compact.lastIndexOf(',');
    const lastDot = compact.lastIndexOf('.');
    const decimalSeparator = lastComma > lastDot ? ',' : '.';
    const normalized = compact
      .replace(decimalSeparator === ',' ? /\./g : /,/g, '')
      .replace(decimalSeparator, '.');
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  const normalized = compact.replace(',', '.');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeUnitToken(value) {
  const key = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[()]/g, '');
  return UNIT_ALIASES.get(key) || null;
}

function normalizeText(rawText) {
  return String(rawText || '')
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[|]/g, ' ')
    .replace(/\t/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseUnitAndQuantity(tokens) {
  for (let i = 0; i < tokens.length; i += 1) {
    const unit = normalizeUnitToken(tokens[i]);
    if (unit) {
      const qty = parseLocaleNumber(tokens[i + 1]);
      if (qty != null && qty > 0) return { unit, quantity: qty, unitIndex: i, qtyIndex: i + 1 };
    }
  }
  for (let i = 0; i < tokens.length; i += 1) {
    const qty = parseLocaleNumber(tokens[i]);
    if (qty == null || qty <= 0) continue;
    const unit = normalizeUnitToken(tokens[i + 1]);
    if (unit) return { unit, quantity: qty, unitIndex: i + 1, qtyIndex: i };
  }
  return null;
}

function parsePriceAfterQty(tokens, qtyIndex) {
  if (qtyIndex == null) return null;
  for (let i = qtyIndex + 1; i < tokens.length; i += 1) {
    const current = tokens[i];
    if (!current) continue;
    if (/^\d{1,3}$/.test(current) && i + 1 < tokens.length && /^\d{1,3}[.,]\d{2}$/.test(tokens[i + 1])) {
      const merged = `${current} ${tokens[i + 1]}`;
      const mergedValue = parseLocaleNumber(merged);
      if (mergedValue != null && mergedValue > 0) return mergedValue;
    }
    if (/^\d+[.,]\d{2}$/.test(current) || /^\d{1,3}(?: \d{3})+[.,]\d{2}$/.test(current)) {
      const parsed = parseLocaleNumber(current);
      if (parsed != null && parsed > 0) return parsed;
    }
  }
  return null;
}

function extractNameTokens(tokens, unitInfo) {
  const withoutIndex = [...tokens];
  if (/^\d{1,3}$/.test(withoutIndex[0])) withoutIndex.shift();
  if (!unitInfo) return withoutIndex;
  let stop = unitInfo.unitIndex;
  if (stop > 0 && /^\d{2,5}$/.test(withoutIndex[stop - 1])) {
    stop -= 1;
  }
  return withoutIndex.slice(0, Math.max(stop, 1));
}

function cleanupName(value) {
  return String(value || '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[;,:]+$/g, '')
    .trim();
}

function parseRowBlock(blockText) {
  const tokens = blockText.split(/\s+/).filter(Boolean);
  if (tokens.length < 3) return null;
  const unitInfo = parseUnitAndQuantity(tokens);
  if (!unitInfo) return null;

  const nameTokens = extractNameTokens(tokens, unitInfo);
  const name = cleanupName(nameTokens.join(' '));
  if (!name || name.length < 3) return null;

  const price = parsePriceAfterQty(tokens, unitInfo.qtyIndex);
  return {
    name,
    unit: unitInfo.unit,
    quantity: Number(unitInfo.quantity.toFixed(4)),
    price: price != null ? Number(price.toFixed(2)) : 0,
    source_text: blockText,
  };
}

function extractBlocks(lines) {
  const blocks = [];
  let current = [];
  for (const line of lines) {
    if (USELESS_ROW_RE.test(line)) continue;
    if (MATERIAL_ROW_START_RE.test(line)) {
      if (current.length) blocks.push(current.join(' '));
      current = [line];
      continue;
    }
    if (current.length) {
      current.push(line);
    }
  }
  if (current.length) blocks.push(current.join(' '));
  return blocks;
}

function fallbackParse(lines) {
  const items = [];
  const regex = /([A-Za-zА-Яа-я0-9()\-+/.,\s]{5,}?)\s+(шт|м2|м3|м²|м³|м|км|кг|л|компл|уп)\.?\s+(\d+(?:[.,]\d+)?)/gi;
  for (const line of lines) {
    let match;
    while ((match = regex.exec(line)) !== null) {
      const name = cleanupName(match[1]);
      const unit = normalizeUnitToken(match[2]);
      const quantity = parseLocaleNumber(match[3]);
      if (!name || !unit || quantity == null || quantity <= 0) continue;
      items.push({
        name,
        unit,
        quantity: Number(quantity.toFixed(4)),
        price: 0,
        source_text: line,
      });
    }
  }
  return items;
}

function mergeItems(items) {
  const map = new Map();
  for (const item of items) {
    const key = `${item.name.toLowerCase()}|${item.unit}|${item.price ?? 0}`;
    const existing = map.get(key);
    if (existing) {
      existing.quantity = Number((existing.quantity + item.quantity).toFixed(4));
      continue;
    }
    map.set(key, { ...item });
  }
  return [...map.values()];
}

export function parseInvoiceTextToItems(rawText) {
  const lines = normalizeText(rawText);
  if (!lines.length) return [];
  const blocks = extractBlocks(lines);
  const fromBlocks = blocks
    .map((block) => parseRowBlock(block))
    .filter(Boolean);
  if (fromBlocks.length > 0) return mergeItems(fromBlocks);
  return mergeItems(fallbackParse(lines));
}

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      return createWorker('rus+eng', 1, {
        cachePath: '/tmp/tesseract-cache',
      });
    })();
  }
  return workerPromise;
}

export async function recognizeImageText(buffer) {
  const worker = await getWorker();
  const result = await worker.recognize(buffer);
  return result?.data?.text || '';
}

export async function extractPdfText(buffer) {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const textResult = await parser.getText();
    if (typeof textResult === 'string') return textResult;
    if (textResult?.text) return textResult.text;
    if (Array.isArray(textResult?.pages)) {
      return textResult.pages.map((p) => p?.text || '').join('\n');
    }
    return '';
  } finally {
    await parser.destroy().catch(() => {});
  }
}

function isPdfFile(file) {
  const name = String(file?.originalname || '').toLowerCase();
  return file?.mimetype === 'application/pdf' || name.endsWith('.pdf');
}

export async function recognizeInvoiceFiles(files = []) {
  const pages = [];
  const warnings = [];
  const allItems = [];

  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    const pageNumber = i + 1;
    try {
      const text = isPdfFile(file)
        ? await extractPdfText(file.buffer)
        : await recognizeImageText(file.buffer);
      const items = parseInvoiceTextToItems(text);
      pages.push({
        page_number: pageNumber,
        file_name: file.originalname || `page-${pageNumber}`,
        mime_type: file.mimetype || '',
        text_preview: String(text || '').slice(0, 3000),
        items_count: items.length,
      });
      items.forEach((item) => {
        allItems.push({
          ...item,
          source_page: pageNumber,
        });
      });
    } catch (error) {
      warnings.push({
        page_number: pageNumber,
        file_name: file?.originalname || `page-${pageNumber}`,
        error: error?.message || 'Ошибка распознавания файла',
      });
    }
  }

  return {
    pages,
    items: mergeItems(allItems),
    warnings,
  };
}
