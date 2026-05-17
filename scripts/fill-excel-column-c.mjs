#!/usr/bin/env node
/**
 * Заполняет столбец C в Excel по зависимости B -> C.
 * 1. Строит таблицу B->C (индексы shared strings) по строкам, где C уже заполнен.
 * 2. Для строк с пустым C подставляет C по значению B (из таблицы или C = B).
 *
 * Использование: node scripts/fill-excel-column-c.mjs /path/to/file.xlsx
 * Результат: /path/to/file_filled.xlsx
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const inputPath = process.argv[2] || '/Users/dmitry/Downloads/Копия PIK454_report.xlsx';
const outputPath = inputPath.replace(/\.xlsx$/i, '_filled.xlsx');
const workDir = path.join(path.dirname(inputPath), '.xlsx_fill_work');

function run() {
  if (!fs.existsSync(inputPath)) {
    console.error('Файл не найден:', inputPath);
    process.exit(1);
  }

  if (fs.existsSync(workDir)) fs.rmSync(workDir, { recursive: true });
  fs.mkdirSync(workDir, { recursive: true });
  execSync(`unzip -q -o "${inputPath}" -d "${workDir}"`, { stdio: 'inherit' });

  const sheetPath = path.join(workDir, 'xl', 'worksheets', 'sheet1.xml');
  const xml = fs.readFileSync(sheetPath, 'utf8');

  // Строим B->C по строкам, где есть и B, и C (индексы shared string в ячейках)
  const bToC = {};
  const rowRegex = /<row r="(\d+)"[^>]*>(.*?)<\/row>/gs;
  let m;
  while ((m = rowRegex.exec(xml)) !== null) {
    const rowNum = m[1];
    const rowContent = m[2];
    const bMatch = rowContent.match(new RegExp('<c r="B' + rowNum + '"[^>]*>\\s*<v>([^<]+)<\\/v>'));
    const cMatch = rowContent.match(new RegExp('<c r="C' + rowNum + '"[^>]*>\\s*<v>([^<]+)<\\/v>'));
    if (bMatch && cMatch) {
      bToC[bMatch[1].trim()] = cMatch[1].trim();
    }
  }

  console.log('Найдено пар B->C:', Object.keys(bToC).length);

  let newXml = xml.replace(rowRegex, (full, rowNum, rowContent) => {
    const hasC = new RegExp('<c r="C' + rowNum + '"').test(rowContent);
    if (hasC) return full;

    const bMatch = rowContent.match(new RegExp('<c r="B' + rowNum + '"([^>]*)>\\s*<v>([^<]+)<\\/v>'));
    if (!bMatch) return full;

    const bVal = bMatch[2].trim();
    const cVal = bToC[bVal] !== undefined ? bToC[bVal] : bVal;
    const bCellStart = rowContent.indexOf('<c r="B' + rowNum + '"');
    const bCellEnd = rowContent.indexOf('</c>', bCellStart) + 4;
    const insert = '<c r="C' + rowNum + '" s="5" t="s"><v>' + cVal + '</v></c>';
    const newRowContent = rowContent.slice(0, bCellEnd) + insert + rowContent.slice(bCellEnd);
    const openTag = full.slice(0, full.indexOf('>') + 1);
    return openTag + newRowContent + '</row>';
  });

  fs.writeFileSync(sheetPath, newXml, 'utf8');

  const prevCwd = process.cwd();
  process.chdir(workDir);
  const zipName = 'output.xlsx';
  execSync(`zip -q -r "${zipName}" .`, { stdio: 'inherit' });
  process.chdir(prevCwd);

  const zipPath = path.join(workDir, zipName);
  if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
  fs.copyFileSync(zipPath, outputPath);
  fs.rmSync(workDir, { recursive: true });
  console.log('Готово. Результат:', outputPath);
}

run();
