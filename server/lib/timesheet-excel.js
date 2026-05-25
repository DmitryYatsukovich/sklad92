import XLSX from 'xlsx-js-style';
import { orgLabel, groupEmployeesByOrg } from './timesheet-data.js';

const FIXED_HEADERS = ['user_id', 'Логин', 'Сотрудник', 'Организация'];
const PAY_HEADERS = ['Итого', 'Ставка', 'Ст. прем.', 'Зараб.', 'Премия', 'Всего'];

const WEEKDAYS_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

const BORDER_THIN = {
  top: { style: 'thin', color: { rgb: 'FF9CA3AF' } },
  bottom: { style: 'thin', color: { rgb: 'FF9CA3AF' } },
  left: { style: 'thin', color: { rgb: 'FF9CA3AF' } },
  right: { style: 'thin', color: { rgb: 'FF9CA3AF' } },
};

const META_ROW_IDX = 0;
const WEEKDAY_ROW_IDX = 1;
const DATE_ROW_IDX = 2;
const ISO_ROW_IDX = 3;

function parseIsoDate(isoDate) {
  const m = String(isoDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  const d = new Date(Date.UTC(y, mo - 1, day));
  if (Number.isNaN(d.getTime())) return null;
  return { y, mo, day, dow: d.getUTCDay() };
}

/** Заголовок дня: число + день недели (как в табеле на экране) */
export function dayHeaderParts(isoDate) {
  const p = parseIsoDate(isoDate);
  if (!p) return { dateLabel: isoDate, weekday: '', isWeekend: false };
  const isWeekend = p.dow === 0 || p.dow === 6;
  return {
    dateLabel: `${String(p.day).padStart(2, '0')}.${String(p.mo).padStart(2, '0')}`,
    weekday: WEEKDAYS_SHORT[p.dow],
    isWeekend,
  };
}

/** Значение ячейки дня — те же правила, что в UI (cell_label / часы / отметка) */
function cellExportValue(cell) {
  if (!cell || cell.status === 'empty') return '';
  if (cell.worked_minutes === 0) return 0;
  if (cell.cell_label) return cell.cell_label;
  if (cell.worked_hours != null && cell.worked_hours !== '') return cell.worked_hours;
  if (cell.worked_minutes != null && cell.worked_minutes > 0) {
    return Math.round((Number(cell.worked_minutes) / 60) * 100) / 100;
  }
  if (cell.status === 'partial' && cell.check_in) {
    return String(cell.check_in).slice(0, 5);
  }
  return cell.check_in || '';
}

function dayHeaderIso(isoDate) {
  return isoDate;
}

function empRow(emp, days) {
  const row = [
    emp.user_id,
    emp.login || '',
    emp.name || '',
    orgLabel(emp.organization_name),
  ];
  for (const d of days) {
    row.push(cellExportValue(emp.days?.[d]));
  }
  row.push(
    emp.total_label || emp.total_hours || 0,
    emp.hourly_rate ?? '',
    emp.bonus_rate ?? '',
    emp.earned_amount ?? '',
    emp.bonus_amount ?? '',
    emp.total_earned_all ?? '',
  );
  return row;
}

function sheetName(label, used) {
  let base = String(label || 'Лист').replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 28) || 'Лист';
  let name = base;
  let n = 1;
  while (used.has(name)) {
    n += 1;
    name = `${base.slice(0, 25)}_${n}`;
  }
  used.add(name);
  return name;
}

function buildSheetAoa(data, employees) {
  const { month, from, to, days } = data;
  const weekdayRow = [
    ...FIXED_HEADERS.map(() => ''),
    ...days.map((d) => dayHeaderParts(d).weekday),
    ...PAY_HEADERS.map(() => ''),
  ];
  const dateRow = [
    ...FIXED_HEADERS,
    ...days.map((d) => dayHeaderParts(d).dateLabel),
    ...PAY_HEADERS,
  ];
  const isoRow = [
    ...FIXED_HEADERS,
    ...days.map(dayHeaderIso),
    ...PAY_HEADERS,
  ];
  const aoa = [
    ['Месяц', month || '', 'С', from || '', 'По', to || ''],
    weekdayRow,
    dateRow,
    isoRow,
  ];
  for (const emp of employees) {
    aoa.push(empRow(emp, days));
  }
  return { aoa, days };
}

function setCellStyle(cell, style) {
  if (!cell) return;
  cell.s = { ...style, border: BORDER_THIN };
}

function ensureCell(ws, ref) {
  if (!ws[ref]) {
    ws[ref] = { t: 's', v: '' };
  }
  return ws[ref];
}

function formatTimesheetSheet(ws, days) {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  const fixedCols = FIXED_HEADERS.length;
  const dayCount = days.length;
  const payStart = fixedCols + dayCount;
  const weekendCols = new Set(
    days.map((d, i) => (dayHeaderParts(d).isWeekend ? fixedCols + i : -1)).filter((i) => i >= 0),
  );

  for (let R = range.s.r; R <= range.e.r; R++) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const ref = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = ensureCell(ws, ref);
      const isDayCol = C >= fixedCols && C < payStart;
      const isWeekendDay = isDayCol && weekendCols.has(C);

      if (R === META_ROW_IDX) {
        setCellStyle(cell, {
          font: { name: 'Calibri', sz: 9, color: { rgb: 'FF374151' } },
          alignment: { vertical: 'center', horizontal: 'left' },
          fill: { fgColor: { rgb: 'FFF3F4F6' } },
        });
        continue;
      }

      if (R === WEEKDAY_ROW_IDX) {
        setCellStyle(cell, {
          font: { name: 'Calibri', sz: 8, bold: true, color: { rgb: isWeekendDay ? 'FF6B7280' : 'FF4B5563' } },
          alignment: { vertical: 'center', horizontal: 'center' },
          fill: { fgColor: { rgb: isWeekendDay ? 'FFF3F4F6' : 'FFE5E7EB' } },
        });
        continue;
      }

      if (R === DATE_ROW_IDX) {
        setCellStyle(cell, {
          font: { name: 'Calibri', sz: 9, bold: true, color: { rgb: 'FF111827' } },
          alignment: { vertical: 'center', horizontal: 'center', wrapText: true },
          fill: { fgColor: { rgb: isWeekendDay ? 'FFF3F4F6' : 'FFE5E7EB' } },
        });
        continue;
      }

      if (R === ISO_ROW_IDX) {
        setCellStyle(cell, {
          font: { name: 'Calibri', sz: 8, color: { rgb: 'FF6B7280' } },
          alignment: { vertical: 'center', horizontal: 'center' },
          fill: { fgColor: { rgb: 'FFF9FAFB' } },
        });
        continue;
      }

      const isName = C === 2;
      const isOrg = C === 3;
      const isPay = C >= payStart;

      setCellStyle(cell, {
        font: { name: 'Calibri', sz: 9, color: { rgb: 'FF1F2937' } },
        alignment: {
          vertical: 'center',
          horizontal: isName || isOrg ? 'left' : 'center',
          wrapText: false,
        },
        fill: {
          fgColor: {
            rgb: isPay && C === payStart + 5
              ? 'FFECFDF5'
              : isWeekendDay
                ? 'FFFAFAFA'
                : 'FFFFFFFF',
          },
        },
      });

      if (isDayCol && cell.v !== '' && cell.v != null) {
        setCellStyle(cell, {
          font: { name: 'Calibri', sz: 9, color: { rgb: 'FF1F2937' } },
          alignment: { vertical: 'center', horizontal: 'center' },
          fill: { fgColor: { rgb: isWeekendDay ? 'FFF1F5F9' : 'FFEFF6FF' } },
        });
      }
    }
  }

  const cols = [];
  for (let C = range.s.c; C <= range.e.c; C++) {
    if (C === 0) cols.push({ wch: 8 });
    else if (C === 1) cols.push({ wch: 9 });
    else if (C === 2) cols.push({ wch: 18 });
    else if (C === 3) cols.push({ wch: 14 });
    else if (C < payStart) cols.push({ wch: 6 });
    else cols.push({ wch: 8 });
  }
  ws['!cols'] = cols;

  const rows = [];
  for (let R = range.s.r; R <= range.e.r; R++) {
    if (R === META_ROW_IDX) rows.push({ hpt: 16 });
    else if (R === ISO_ROW_IDX) rows.push({ hpt: 0, hidden: true });
    else if (R === WEEKDAY_ROW_IDX) rows.push({ hpt: 14 });
    else if (R === DATE_ROW_IDX) rows.push({ hpt: 18 });
    else rows.push({ hpt: 15 });
  }
  ws['!rows'] = rows;

  ws['!freeze'] = {
    xSplit: 3,
    ySplit: ISO_ROW_IDX + 1,
    topLeftCell: 'D5',
    activePane: 'bottomRight',
    state: 'frozen',
  };
}

function buildStyledSheet(data, employees) {
  const { aoa, days } = buildSheetAoa(data, employees);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  formatTimesheetSheet(ws, days);
  return ws;
}

/** @param {object} data — результат loadTimesheet */
export function buildTimesheetWorkbook(data, { organization } = {}) {
  const wb = XLSX.utils.book_new();
  const used = new Set();

  if (organization) {
    const label = orgLabel(organization);
    const group = groupEmployeesByOrg(data.employees).find((g) => g.label === label);
    const employees = group?.employees || [];
    XLSX.utils.book_append_sheet(wb, buildStyledSheet(data, employees), sheetName(label, used));
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: true });
  }

  XLSX.utils.book_append_sheet(wb, buildStyledSheet(data, data.employees), sheetName('Общий', used));

  for (const { label, employees } of groupEmployeesByOrg(data.employees)) {
    if (!employees.length) continue;
    XLSX.utils.book_append_sheet(wb, buildStyledSheet(data, employees), sheetName(label, used));
  }

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: true });
}

function normHeader(h) {
  return String(h ?? '').trim().toLowerCase();
}

function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const lower = row.map(normHeader);
    if (lower.includes('user_id') || lower.includes('сотрудник') || lower.includes('логин')) {
      return i;
    }
  }
  return -1;
}

function colIndex(headers, names) {
  const lower = headers.map(normHeader);
  for (const name of names) {
    const idx = lower.indexOf(name);
    if (idx >= 0) return idx;
  }
  return -1;
}

function isIsoDateHeader(h) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(h ?? '').trim());
}

function isWeekdayOnlyRow(row) {
  if (!Array.isArray(row)) return false;
  const tokens = row.map((v) => normHeader(v)).filter(Boolean);
  if (!tokens.length) return false;
  return tokens.every((t) => WEEKDAYS_SHORT.includes(t));
}

/** @returns {{ month: string|null, rows: Array }} */
export function parseTimesheetImport(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (!rows.length) {
    const err = new Error('Файл пуст');
    err.status = 400;
    throw err;
  }

  let month = null;
  const meta = rows[0];
  if (Array.isArray(meta)) {
    for (let i = 0; i < meta.length - 1; i++) {
      if (normHeader(meta[i]) === 'месяц' && /^\d{4}-\d{2}$/.test(String(meta[i + 1]).trim())) {
        month = String(meta[i + 1]).trim();
        break;
      }
    }
  }

  let headerIdx = findHeaderRow(rows);
  if (headerIdx < 0) {
    const err = new Error('Не найдена строка заголовков (нужны user_id или Сотрудник)');
    err.status = 400;
    throw err;
  }

  if (isWeekdayOnlyRow(rows[headerIdx])) {
    headerIdx += 1;
  }

  let headers = rows[headerIdx].map((h) => String(h ?? '').trim());

  const nextRow = rows[headerIdx + 1];
  if (Array.isArray(nextRow) && nextRow.some((h) => isIsoDateHeader(h))) {
    headers = nextRow.map((h) => String(h ?? '').trim());
    headerIdx += 1;
  }

  const idCol = colIndex(headers, ['user_id']);
  const loginCol = colIndex(headers, ['логин', 'login']);
  const hourlyCol = colIndex(headers, ['ставка']);
  const bonusCol = colIndex(headers, ['ст. прем.', 'ст прем', 'ставка премии']);

  const dayCols = [];
  for (let c = 0; c < headers.length; c++) {
    const h = headers[c];
    if (isIsoDateHeader(h)) dayCols.push({ c, date: h });
  }

  const parsed = [];
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!Array.isArray(row)) continue;
    const rowLower = row.map((v) => normHeader(v));
    if (rowLower.includes('user_id') || rowLower.includes('сотрудник')) continue;
    if (isWeekdayOnlyRow(row)) continue;
    if (row.some((v) => isIsoDateHeader(v))) continue;
    if (!row.some((v) => String(v ?? '').trim())) continue;

    const user_id = idCol >= 0 ? parseInt(row[idCol], 10) : null;
    const login = loginCol >= 0 ? String(row[loginCol] ?? '').trim() : '';
    if (!user_id && !login) continue;

    const days = {};
    for (const { c, date } of dayCols) {
      const val = row[c];
      if (val !== '' && val != null && String(val).trim() !== '') {
        days[date] = val;
      }
    }

    const entry = { user_id: user_id || null, login, days };
    if (hourlyCol >= 0 && row[hourlyCol] !== '' && row[hourlyCol] != null) {
      entry.hourly_rate = row[hourlyCol];
    }
    if (bonusCol >= 0 && row[bonusCol] !== '' && row[bonusCol] != null) {
      entry.bonus_rate = row[bonusCol];
    }
    parsed.push(entry);
  }

  if (!parsed.length) {
    const err = new Error('Нет строк сотрудников для импорта');
    err.status = 400;
    throw err;
  }

  return { month, rows: parsed };
}
