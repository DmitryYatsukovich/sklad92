/**
 * Подставляет UID для номеров карт, у которых UID не указан.
 * Формат входного файла: одна строка на запись, "номер_карты → UID" или "номер_карты" (без UID).
 * Для пустых UID подставляются последовательные номера, начиная с (макс. UID в файле + 1).
 *
 * Запуск: node server/db/fill-missing-uids.js <входной_файл> [выходной_файл]
 */
import fs from 'fs';
import path from 'path';

function parseLine(line) {
  const t = line.trim();
  if (!t) return null;
  const m = t.match(/^(.+?)\s*→\s*(.*)$/);
  if (m) {
    const card = m[1].trim();
    const uid = (m[2] || '').trim().replace(/^UID\s+/i, '');
    return { card, uid: uid || null };
  }
  return { card: t, uid: null };
}

function parseNumber(s) {
  const n = parseInt(String(s).replace(/\D/g, ''), 10);
  return isNaN(n) ? 0 : n;
}

function run() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3] || inputPath.replace(/(\.\w+)?$/, '-filled.txt');

  if (!inputPath || !fs.existsSync(inputPath)) {
    console.error('Использование: node server/db/fill-missing-uids.js <входной_файл> [выходной_файл]');
    console.error('Файл не найден:', inputPath);
    process.exit(1);
  }

  const content = fs.readFileSync(inputPath, 'utf8');
  const lines = content.split(/\r?\n/);
  const rows = [];
  let maxUidNum = 0;

  for (const line of lines) {
    const r = parseLine(line);
    if (!r) continue;
    rows.push(r);
    if (r.uid) {
      const n = parseNumber(r.uid);
      if (n > maxUidNum) maxUidNum = n;
    }
  }

  let nextUid = maxUidNum + 1;
  const out = [];
  for (const r of rows) {
    const uid = r.uid
      ? String(parseNumber(r.uid)).padStart(8, '0')
      : String(nextUid++).padStart(8, '0');
    out.push(`${r.card} → ${uid}`);
  }

  const outContent = out.join('\n') + '\n';
  const resolvedOut = path.isAbsolute(outputPath) ? outputPath : path.resolve(process.cwd(), outputPath);
  fs.writeFileSync(resolvedOut, outContent, 'utf8');
  console.log('Записано', out.length, 'записей в', resolvedOut);
  console.log('Подставлено UID для', rows.filter((r) => !r.uid).length, 'номеров карт.');
}

run();
