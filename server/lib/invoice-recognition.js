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
const TABLE_END_RE = /(руководитель|бухгалтер|индивидуальн|подпись|уполномоч|доверенн)/i;
const MATERIAL_NAME_HINT_RE = /(кабел|провод|короб|щит|труб|датчик|изолятор|модул|розет|муфт|креп|шкаф|канал|гофр|реле|автомат|блок)/i;

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
    is_estimated: false,
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
        is_estimated: false,
        source_text: line,
      });
    }
  }
  return items;
}

function fallbackNameOnlyParse(lines) {
  const items = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = String(lines[i] || '').trim();
    if (!line || USELESS_ROW_RE.test(line)) continue;
    let candidate = line;
    const numbered = line.match(/^\d{1,3}[.)]?\s+(.+)$/);
    if (numbered) candidate = numbered[1];
    if (!MATERIAL_NAME_HINT_RE.test(candidate.toLowerCase())) continue;
    const next = String(lines[i + 1] || '').trim();
    const withNext = /^\(?(ту|гост)\b/i.test(next) ? `${candidate} ${next}` : candidate;
    const name = cleanupName(withNext);
    if (!name || name.length < 4) continue;
    items.push({
      name,
      unit: 'шт',
      quantity: 1,
      price: 0,
      is_estimated: true,
      source_text: line,
    });
  }
  return items;
}

function mergeItems(items) {
  const map = new Map();
  for (const item of items) {
    const key = `${item.name.toLowerCase()}|${item.unit}|${item.price ?? 0}`;
    const existing = map.get(key);
    if (existing) {
      if (existing.is_estimated && !item.is_estimated) {
        map.set(key, {
          ...item,
          quantity: Number(item.quantity.toFixed(4)),
        });
        continue;
      }
      if (!existing.is_estimated && item.is_estimated) continue;
      if (existing.is_estimated && item.is_estimated) {
        if (item.quantity > existing.quantity) {
          existing.quantity = Number(item.quantity.toFixed(4));
        }
        continue;
      }
      existing.quantity = Number((existing.quantity + item.quantity).toFixed(4));
      continue;
    }
    map.set(key, { ...item });
  }
  return [...map.values()];
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function normalizeWordToken(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-zа-я0-9.-]/gi, '');
}

function flattenOcrWords(blocks = []) {
  const words = [];
  for (const block of blocks) {
    for (const paragraph of block?.paragraphs || []) {
      for (const line of paragraph?.lines || []) {
        for (const word of line?.words || []) {
          const text = String(word?.text || '').trim();
          if (!text) continue;
          const x0 = Number(word?.bbox?.x0);
          const x1 = Number(word?.bbox?.x1);
          const y0 = Number(word?.bbox?.y0);
          const y1 = Number(word?.bbox?.y1);
          if (![x0, x1, y0, y1].every(Number.isFinite)) continue;
          words.push({
            text,
            token: normalizeWordToken(text),
            x0,
            x1,
            y0,
            y1,
            y: (y0 + y1) / 2,
          });
        }
      }
    }
  }
  return words;
}

function inferTableColumns(words) {
  const nameXs = [];
  const unitXs = [];
  const qtyXs = [];
  const headerYs = [];

  for (const word of words) {
    const token = word.token;
    if (!token) continue;
    if (/^наимен/.test(token) || /^товар/.test(token)) {
      nameXs.push(word.x0);
      headerYs.push(word.y);
      continue;
    }
    if (/^един/.test(token) || /^измер/.test(token) || token === 'ед' || token === 'ед.') {
      unitXs.push(word.x0);
      headerYs.push(word.y);
      continue;
    }
    if (/^колич/.test(token) || /^кол-?во/.test(token) || /^колво/.test(token)) {
      qtyXs.push(word.x0);
      headerYs.push(word.y);
    }
  }

  const nameX = median(nameXs);
  const unitX = median(unitXs);
  let qtyX = median(qtyXs);
  const headerY = median(headerYs);
  if (!Number.isFinite(unitX) || !Number.isFinite(headerY)) return null;
  if (!Number.isFinite(qtyX)) qtyX = unitX + 140;
  return { nameX: Number.isFinite(nameX) ? nameX : 0, unitX, qtyX, headerY };
}

function extractNameFromRowWords(words, unitX) {
  const textParts = words
    .filter((word) => word.x0 < unitX - 20)
    .map((word) => word.text)
    .filter(Boolean);
  if (!textParts.length) return '';
  const cleaned = cleanupName(textParts.join(' ')
    .replace(/^\d{1,3}[.)]?\s*/u, '')
    .replace(/\b\d{2,6}\b/g, ' ')
    .replace(/\s{2,}/g, ' '));
  return cleaned;
}

function extractUnitAndQtyFromRowWords(words, unitX, qtyX) {
  let unit = null;
  let quantity = null;

  const byX = [...words].sort((a, b) => a.x0 - b.x0);
  for (const word of byX) {
    if (!unit && word.x0 >= unitX - 40 && word.x0 <= qtyX + 40) {
      unit = normalizeUnitToken(word.text) || unit;
    }
    if (quantity == null && word.x0 >= qtyX - 60) {
      const parsed = parseLocaleNumber(word.text);
      if (parsed != null && parsed > 0 && parsed < 100000) {
        quantity = parsed;
      }
    }
  }

  if (quantity == null) {
    for (const word of byX) {
      const parsed = parseLocaleNumber(word.text);
      if (parsed != null && parsed > 0 && parsed < 100000 && word.x0 >= unitX) {
        quantity = parsed;
        break;
      }
    }
  }

  return { unit, quantity };
}

function parseStructuredRowsFromWords(words) {
  if (!words.length) return [];
  const table = inferTableColumns(words);
  if (!table) return [];

  const { unitX, qtyX, headerY } = table;
  const footerCandidates = words
    .filter((word) => word.y > headerY + 20 && TABLE_END_RE.test(word.token))
    .map((word) => word.y);
  const footerY = footerCandidates.length ? Math.min(...footerCandidates) : Number.POSITIVE_INFINITY;
  const rowMarkers = words
    .filter((word) => word.y > headerY + 8 && word.y < footerY - 6 && word.x0 < unitX - 40)
    .filter((word) => /^\d{1,3}[а-яa-z]?[.)]?$/i.test(word.token))
    .sort((a, b) => a.y - b.y);

  if (!rowMarkers.length) return [];

  const rows = [];
  for (let i = 0; i < rowMarkers.length; i += 1) {
    const marker = rowMarkers[i];
    const next = rowMarkers[i + 1];
    const yMin = marker.y - 8;
    const yMax = next ? next.y - 6 : marker.y + 90;
    const rowWords = words
      .filter((word) => word.y >= yMin && word.y <= Math.min(yMax, footerY - 4))
      .sort((a, b) => (a.y - b.y) || (a.x0 - b.x0));
    if (!rowWords.length) continue;

    const name = extractNameFromRowWords(rowWords, unitX);
    if (!name || name.length < 3) continue;
    const lowerName = name.toLowerCase();
    if (USELESS_ROW_RE.test(lowerName) || TABLE_END_RE.test(lowerName)) continue;
    const tokens = name.split(/\s+/).filter(Boolean);
    const lettersCount = (name.match(/[a-zа-я]/gi) || []).length;
    const compactLength = name.replace(/\s+/g, '').length || 1;
    const oneCharTokens = tokens.filter((token) => token.length === 1).length;
    if (lettersCount < 4) continue;
    if ((lettersCount / compactLength) < 0.35) continue;
    if (oneCharTokens > Math.floor(tokens.length / 2)) continue;

    const { unit, quantity } = extractUnitAndQtyFromRowWords(rowWords, unitX, qtyX);
    const hasReliableQty = quantity != null && quantity > 0;
    const hasReliableUnit = !!unit;
    if (!hasReliableQty && !MATERIAL_NAME_HINT_RE.test(lowerName)) continue;
    const normalizedUnit = hasReliableUnit ? unit : 'шт';
    const normalizedQty = hasReliableQty ? quantity : 1;

    rows.push({
      name,
      unit: normalizedUnit,
      quantity: Number(normalizedQty.toFixed(4)),
      price: 0,
      is_estimated: !(hasReliableQty && hasReliableUnit),
      source_text: rowWords.map((word) => word.text).join(' '),
    });
  }
  return rows;
}

function parseInvoiceOcrResult(data = {}) {
  const text = String(data?.text || '');
  const words = flattenOcrWords(data?.blocks || []);
  const structured = parseStructuredRowsFromWords(words);
  const textParsed = parseInvoiceTextToItems(text);
  if (!structured.length) return textParsed;
  const merged = mergeItems([...structured, ...textParsed]);
  return merged;
}

function scoreRecognizedItems(items = []) {
  return items.reduce((score, item) => {
    const hasReliableQty = Number(item.quantity) > 1 || item.unit !== 'шт';
    const nameBonus = Math.min(String(item.name || '').length, 40) / 10;
    return score + (hasReliableQty ? 8 : 2) + nameBonus;
  }, 0);
}

export function parseInvoiceTextToItems(rawText) {
  const lines = normalizeText(rawText);
  if (!lines.length) return [];
  const blocks = extractBlocks(lines);
  const fromBlocks = blocks
    .map((block) => parseRowBlock(block))
    .filter(Boolean);
  if (fromBlocks.length > 0) return mergeItems(fromBlocks);
  const parsed = mergeItems(fallbackParse(lines));
  if (parsed.length > 0) return parsed;
  return mergeItems(fallbackNameOnlyParse(lines));
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

async function recognizeImageData(buffer, psmMode = '4') {
  const worker = await getWorker();
  const result = await worker.recognize(
    buffer,
    {
      tessedit_pageseg_mode: String(psmMode),
      preserve_interword_spaces: '1',
    },
    {
      blocks: true,
      lines: true,
      words: true,
      tsv: true,
      hocr: false,
    },
  );
  return result?.data || {};
}

export async function recognizeImageText(buffer) {
  const data = await recognizeImageData(buffer, '4');
  return data?.text || '';
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
      let text = '';
      let items = [];
      if (isPdfFile(file)) {
        text = await extractPdfText(file.buffer);
        items = parseInvoiceTextToItems(text);
      } else {
        const attempts = ['4', '3', '6'];
        let best = { text: '', items: [], score: -1 };
        for (const psm of attempts) {
          const data = await recognizeImageData(file.buffer, psm);
          const attemptItems = parseInvoiceOcrResult(data);
          const attemptText = String(data?.text || '');
          const attemptScore = scoreRecognizedItems(attemptItems);
          if (attemptScore > best.score) {
            best = { text: attemptText, items: attemptItems, score: attemptScore };
          } else if (attemptScore === best.score && attemptText.length > best.text.length) {
            best = { text: attemptText, items: attemptItems, score: attemptScore };
          }
          if (attemptItems.length >= 2) break;
        }
        text = best.text;
        items = best.items;
      }
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
