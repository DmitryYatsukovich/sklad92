/**
 * Заполняет UID в Excel-файле отчёта ПИК.
 *
 * Контроллер выдаёт UID из своей базы (при регистрации/сканировании), а не по формуле от номера карты.
 * По 51+ парам (card, uid) однозначной формулы не получается.
 *
 * Режимы:
 * 1) По умолчанию: подставляем UID только для карт из эталона (первые N строк с UID + data/pik-extra-reference.json).
 *    Остальные ячейки UID не заполняем — карты нужно отсканировать и добавить в pik-extra-reference.json.
 * 2) FILL_UNKNOWN=1: для карт вне эталона подставляем UID по интерполяции между ближайшими эталонными парами (по номеру карты), с разрешением коллизий.
 * 3) FILL_BY_ROW=1: неизвестные UID заполняются последовательно от последнего известного (предполагается, что контроллер присваивает UID по порядку регистрации строк).
 *
 * Запуск: node scripts/fill-xlsx-uids.js <путь_к_xlsx> [путь_выходного_файла]
 */
import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';

function getCellValue(cell) {
  if (cell == null) return '';
  const v = cell.v;
  if (v == null) return '';
  return String(v).trim();
}

function parseUidNum(val) {
  const s = String(val).replace(/\D/g, '');
  const n = parseInt(s, 10);
  return isNaN(n) ? 0 : n;
}

/** Единый ключ для поиска: только цифры, дополнено до 17 символов (Excel может вернуть число без ведущего нуля). */
function normalizeCardKey(cardStr) {
  return String(cardStr || '').replace(/\D/g, '').padStart(17, '0');
}

function interpolateUid(cardNum, sortedRef) {
  const card = typeof cardNum === 'bigint' ? cardNum : BigInt(cardNum);
  const exact = sortedRef.find((r) => r.cardNum === card);
  if (exact) return exact.uidNum;
  let i = 0;
  while (i < sortedRef.length && sortedRef[i].cardNum < card) i++;
  const after = sortedRef[i];
  const before = sortedRef[i - 1];
  if (!before) return after.uidNum;
  if (!after) return before.uidNum;
  const t = Number(card - before.cardNum) / Number(after.cardNum - before.cardNum);
  const uid = Math.round(before.uidNum + t * (after.uidNum - before.uidNum));
  return Math.max(0, Math.min(99999999, uid));
}

function run() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3] || inputPath.replace(/(\.xlsx?)?$/i, '-filled.xlsx');
  const cardCol = parseInt(process.env.CARD_COL, 10) || 1;
  const uidCol = parseInt(process.env.UID_COL, 10) || 2;
  const referenceRows = parseInt(process.env.REFERENCE_ROWS, 10) || 50;
  const fillUnknown = process.env.FILL_UNKNOWN === '1' || process.env.FILL_UNKNOWN === 'true';
  const fillByRow = process.env.FILL_BY_ROW === '1' || process.env.FILL_BY_ROW === 'true';

  if (!inputPath || !fs.existsSync(inputPath)) {
    console.error('Использование: node scripts/fill-xlsx-uids.js <файл.xlsx> [выход.xlsx]');
    console.error('Файл не найден:', inputPath);
    process.exit(1);
  }

  const wb = XLSX.readFile(inputPath, { cellDates: false });
  const firstSheet = wb.SheetNames[0];
  const ws = wb.Sheets[firstSheet];
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');

  const reference = [];
  const lookup = new Map();
  const reserved = new Set();
  const rowsToFill = [];

  const extraPath = path.resolve(process.cwd(), 'data/pik-extra-reference.json');
  if (fs.existsSync(extraPath)) {
    try {
      const extra = JSON.parse(fs.readFileSync(extraPath, 'utf8'));
      for (const p of extra) {
        const card = String(p.card || '').trim();
        const uid = String(p.uid || '').trim();
        if (card && uid) {
          const uidN = parseUidNum(uid);
          const key = normalizeCardKey(card);
          reference.push({ cardNum: BigInt(key), uidNum: uidN });
          lookup.set(key, uid);
          reserved.add(uidN);
        }
      }
    } catch (e) {
      console.warn('Не удалось загрузить data/pik-extra-reference.json:', e.message);
    }
  }

  for (let R = range.s.r; R <= range.e.r; R++) {
    const uidRef = XLSX.utils.encode_cell({ r: R, c: uidCol });
    const cardRef = XLSX.utils.encode_cell({ r: R, c: cardCol });
    const cardVal = getCellValue(ws[cardRef]);
    const uidVal = getCellValue(ws[uidRef]);
    if (!cardVal) continue;
    const cardNorm = cardVal.trim();
    const cardNum = BigInt(cardNorm.replace(/\D/g, ''));
    if (uidVal) {
      const uidN = parseUidNum(uidVal);
      lookup.set(normalizeCardKey(cardNorm), uidVal);
      reserved.add(uidN);
      if (R < referenceRows) reference.push({ cardNum, uidNum: uidN });
      continue;
    }
    rowsToFill.push({ R, card: cardNorm, cardNum, cardKey: normalizeCardKey(cardNorm) });
  }

  reference.sort((a, b) => (a.cardNum < b.cardNum ? -1 : a.cardNum > b.cardNum ? 1 : 0));
  const assigned = new Set(reserved);
  let filledKnown = 0;
  let filledInterpolated = 0;
  let leftEmpty = 0;

  let lastKnownRow = -1;
  let lastKnownUid = 0;
  for (let R = range.s.r; R <= range.e.r; R++) {
    const uidRef = XLSX.utils.encode_cell({ r: R, c: uidCol });
    const v = getCellValue(ws[uidRef]);
    if (v) {
      lastKnownRow = R;
      lastKnownUid = parseUidNum(v);
    }
  }
  if (fillByRow) {
    for (const row of rowsToFill) {
      const uid = lookup.get(row.cardKey ?? normalizeCardKey(row.card));
      if (uid != null) {
        const r = row.R;
        if (r > lastKnownRow) {
          lastKnownRow = r;
          lastKnownUid = parseUidNum(uid);
        }
      }
    }
  }

  if (fillByRow) rowsToFill.sort((a, b) => a.R - b.R);

  let nextSeqUid = lastKnownUid + 1;
  for (const row of rowsToFill) {
    const { R, card, cardNum, cardKey } = row;
    const knownUid = lookup.get(cardKey ?? normalizeCardKey(card));
    if (knownUid != null) {
      ws[XLSX.utils.encode_cell({ r: R, c: uidCol })] = { t: 's', v: knownUid };
      filledKnown++;
      continue;
    }
    if (fillByRow) {
      let uidNum = nextSeqUid;
      if (uidNum >= 100000000) uidNum %= 100000000;
      while (assigned.has(uidNum)) {
        uidNum++;
        if (uidNum >= 100000000) uidNum = 0;
      }
      assigned.add(uidNum);
      nextSeqUid = uidNum + 1;
      ws[XLSX.utils.encode_cell({ r: R, c: uidCol })] = { t: 's', v: String(uidNum).padStart(8, '0') };
      filledInterpolated++;
    } else if (fillUnknown) {
      let uidNum = interpolateUid(cardNum, reference);
      while (assigned.has(uidNum)) {
        uidNum++;
        if (uidNum >= 100000000) uidNum = 0;
      }
      assigned.add(uidNum);
      ws[XLSX.utils.encode_cell({ r: R, c: uidCol })] = { t: 's', v: String(uidNum).padStart(8, '0') };
      filledInterpolated++;
    } else {
      leftEmpty++;
    }
  }

  const outResolved = path.isAbsolute(outputPath) ? outputPath : path.resolve(process.cwd(), outputPath);
  XLSX.writeFile(wb, outResolved, { bookType: 'xlsx' });
  console.log('Подставлено UID по эталону:', filledKnown, 'строк.');
  if (fillByRow) console.log('Подставлено UID по порядку строк (последовательно от последнего известного):', filledInterpolated, 'строк.');
  else if (fillUnknown) console.log('Подставлено UID по интерполяции:', filledInterpolated, 'строк.');
  if (leftEmpty > 0) console.log('Оставлено пустыми:', leftEmpty, '— добавьте пары (card, uid) в data/pik-extra-reference.json после сканирования на контроллере.');
  console.log('Результат:', outResolved);
}

run();
