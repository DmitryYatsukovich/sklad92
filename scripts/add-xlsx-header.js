/**
 * Добавляет строку заголовков в первый лист xlsx: №, Номер карты, UID.
 * Запуск: node scripts/add-xlsx-header.js <файл.xlsx> [выход.xlsx]
 */
import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';

const HEADER_ROW = ['№', 'Номер карты', 'UID'];

function run() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3] || inputPath;

  if (!inputPath || !fs.existsSync(inputPath)) {
    console.error('Использование: node scripts/add-xlsx-header.js <файл.xlsx> [выход.xlsx]');
    process.exit(1);
  }

  const wb = XLSX.readFile(inputPath, { cellDates: false });
  const name = wb.SheetNames[0];
  const ws = wb.Sheets[name];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  data.unshift(HEADER_ROW);
  const newWs = XLSX.utils.aoa_to_sheet(data);
  wb.Sheets[name] = newWs;

  const out = path.isAbsolute(outputPath) ? outputPath : path.resolve(process.cwd(), outputPath);
  XLSX.writeFile(wb, out, { bookType: 'xlsx' });
  console.log('Добавлена строка заголовков. Результат:', out);
}

run();
