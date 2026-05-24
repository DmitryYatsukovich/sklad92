import fs from 'fs';
import XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import bcrypt from 'bcryptjs';
import pool from '../db/pool.js';
import { PERMISSIONS_SELECT } from './permissions-sql.js';
import {
  resolveUserPermissionsForSave,
  upsertUserPermissions,
} from './sync-user-permissions-from-role.js';
import { PERMISSION_KEYS } from './app-permissions.js';
import { parseHourlyRate } from './hourly-rate.js';
import {
  parseFaceImageBase64,
  saveUserFacePhotoWithClient,
  facePhotoBufferFromRow,
  extFromMime,
} from './user-images.js';

export const TEMPLATE_HEADERS = [
  'Логин',
  'Пароль',
  'Имя',
  'Фамилия',
  'Дата рождения',
  'Паспорт',
  'СНИЛС',
  'ИНН',
  'Дата трудоустройства',
  'Организация',
  'Телефон',
  'Ставка',
  'Системная роль',
  'Роль (справочник)',
  'UID',
  'Профиль активен',
  'Статус работы',
  'Договор',
  'Склад',
  'Выдача',
  'Выработка',
  'Пользователи',
  'Журнал посещений',
  'Настройка',
  'Отметка по лицу',
  'Фото лица',
  'Фото (base64)',
  'Шаблон лица (JSON)',
  'Шаблон: чисел',
  'Шаблон: контроль',
];

export const FACE_PHOTO_HEADER = 'Фото лица';

export const EXPORT_HEADERS = [
  'id',
  ...TEMPLATE_HEADERS,
];

const HEADER_ALIASES = {
  id: ['id', '№', 'код'],
  login: ['логин', 'login'],
  password: ['пароль', 'password'],
  first_name: ['имя', 'first_name', 'first name'],
  last_name: ['фамилия', 'last_name', 'last name'],
  birth_date: ['дата рождения', 'birth_date', 'birth'],
  passport: ['паспорт', 'passport'],
  snils: ['снилс', 'snils'],
  inn: ['инн', 'inn'],
  employment_date: ['дата трудоустройства', 'employment_date', 'трудоустройство'],
  organization: ['организация', 'organization', 'employment_org', 'трудоустройство орг'],
  phone: ['телефон', 'phone', 'тел'],
  hourly_rate: ['ставка', 'hourly_rate', 'часовая'],
  system_role: ['системная роль', 'system_role', 'role', 'роль системная'],
  role_name: ['роль (справочник)', 'роль справочник', 'role_name', 'профиль роли'],
  internal_uid: ['uid', 'internal_uid', 'внутренний uid'],
  profile_active: ['профиль активен', 'profile_active', 'активен профиль', 'профиль'],
  employment_status: ['статус работы', 'employment_status', 'статус', 'трудовой статус'],
  has_labor_contract: ['договор', 'has_labor_contract', 'трудовой договор', 'документы договора'],
  can_warehouse: ['склад', 'can_warehouse'],
  can_issuance: ['выдача', 'can_issuance'],
  can_production: ['выработка', 'can_production', 'production'],
  can_users: ['пользователи', 'can_users', 'users'],
  can_attendance: ['журнал посещений', 'can_attendance', 'посещения', 'табель'],
  can_settings: ['настройка', 'can_settings', 'settings'],
  can_face: ['отметка по лицу', 'can_face', 'лицо', 'face'],
  face_photo_b64: ['фото (base64)', 'фото base64', 'face_photo_base64', 'face photo base64'],
  face_descriptor: ['шаблон лица (json)', 'шаблон лица', 'face_descriptor', 'face descriptor', 'дескриптор'],
  face_descriptor_count: ['шаблон: чисел', 'шаблон чисел', 'face count', 'descriptor count'],
  face_descriptor_checksum: ['шаблон: контроль', 'шаблон контроль', 'face checksum', 'descriptor checksum'],
};

function normHeader(h) {
  return String(h ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function mapHeaders(headerRow) {
  const colMap = {};
  headerRow.forEach((h, idx) => {
    const n = normHeader(h);
    for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.some((a) => n === a || n.startsWith(a))) {
        if (colMap[key] === undefined) colMap[key] = idx;
      }
    }
  });
  return colMap;
}

function cellVal(row, idx) {
  if (idx === undefined || idx < 0) return '';
  const v = row[idx];
  if (v == null) return '';
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(v).trim();
}

function parseBool(val) {
  const s = String(val ?? '').trim().toLowerCase();
  if (s === '' || s === '-') return null;
  if (['да', 'yes', 'y', '1', 'true', '+', 'истина', 'активный', 'активен'].includes(s)) return true;
  if (['нет', 'no', 'n', '0', 'false', '-', 'ложь', 'неактивный', 'неактивен'].includes(s)) return false;
  return null;
}

function parseEmploymentStatus(val) {
  const s = String(val ?? '').trim().toLowerCase();
  if (!s) return null;
  if (['working', 'работает', 'work', 'на работе'].includes(s)) return 'working';
  if (['vacation', 'отпуск', 'в отпуске', 'отпуске'].includes(s)) return 'vacation';
  if (['fired', 'уволен', 'уволенный', 'увольнение', 'уволена'].includes(s)) return 'fired';
  return null;
}

function employmentStatusLabel(status) {
  if (status === 'vacation') return 'В отпуске';
  if (status === 'fired') return 'Уволен';
  return 'Работает';
}

function mergePermsFromExcelItem(basePerms, item) {
  let any = false;
  const merged = { ...basePerms };
  for (const k of PERMISSION_KEYS) {
    if (item[k] !== undefined && item[k] !== null) {
      merged[k] = Boolean(item[k]);
      any = true;
    }
  }
  return any ? merged : basePerms;
}

function boolLabel(v) {
  return v ? 'да' : 'нет';
}

function parseDescriptorArray(fd) {
  if (fd == null) return null;
  let arr = fd;
  if (typeof fd === 'string') {
    try {
      arr = JSON.parse(fd);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(arr) || arr.length < 128) return null;
  const nums = arr.map((x) => Number(x));
  if (nums.some((x) => Number.isNaN(x))) return null;
  return nums;
}

function serializeFaceDescriptor(fd) {
  const nums = parseDescriptorArray(fd);
  if (!nums) return '';
  return JSON.stringify(nums);
}

function faceTemplateMeta(fd) {
  const nums = parseDescriptorArray(fd);
  if (!nums) {
    return { json: '', count: 0, checksum: '' };
  }
  const checksum = nums.slice(0, 16).reduce((s, x) => s + x, 0);
  return {
    json: JSON.stringify(nums),
    count: nums.length,
    checksum: Number(checksum.toFixed(6)),
  };
}

function photoToExportBase64(u) {
  const buf = facePhotoBufferFromRow(u);
  if (!buf?.length) return '';
  if (buf.length > 24000) return '';
  return buf.toString('base64');
}

function imageExtensionFromBuffer(buf) {
  if (!buf || buf.length < 4) return 'jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpeg';
  return 'jpeg';
}

function parseFaceDescriptor(str) {
  const t = String(str ?? '').trim();
  if (!t) return undefined;
  let arr;
  try {
    arr = JSON.parse(t);
  } catch {
    throw new Error('Шаблон лица: неверный JSON (нужен массив из 128 чисел)');
  }
  if (!Array.isArray(arr) || arr.length < 128) {
    throw new Error('Шаблон лица: массив должен содержать не менее 128 чисел');
  }
  const nums = arr.map((x) => Number(x));
  if (nums.some((x) => Number.isNaN(x))) {
    throw new Error('Шаблон лица: все элементы должны быть числами');
  }
  return nums;
}

function parseDateKey(val) {
  const s = cellVal([val], 0);
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const dm = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (dm) {
    return `${dm[3]}-${String(dm[2]).padStart(2, '0')}-${String(dm[1]).padStart(2, '0')}`;
  }
  return s.slice(0, 10) || null;
}

export function buildTemplateBuffer() {
  const ws = XLSX.utils.aoa_to_sheet([
    TEMPLATE_HEADERS,
    [
      'ivanov',
      'пароль123',
      'Иван',
      'Иванов',
      '1990-05-15',
      '',
      '',
      '',
      '2020-01-10',
      'ООО Пример',
      '+79001234567',
      '350',
      'user',
      '',
      '',
      'да',
      'Работает',
      'нет',
      'да',
      'да',
      'да',
      'нет',
      'да',
      'нет',
      'да',
      '',
      '',
      '',
      '',
      '',
    ],
  ]);
  ws['!cols'] = TEMPLATE_HEADERS.map((h) => ({ wch: Math.max(14, h.length + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Пользователи');
  const help = XLSX.utils.aoa_to_sheet([
    ['Поле', 'Описание'],
    ['Логин', 'Обязателен. При импорте: существующий логин — обновление, новый — создание'],
    ['Пароль', 'Обязателен для новых. При обновлении пусто = не менять'],
    ['Системная роль', 'user или admin'],
    ['Роль (справочник)', 'Название роли из настроек (необязательно)'],
    ['Фото лица', 'При экспорте — миниатюра. При импорте можно вставить изображение в ячейку'],
    ['Фото (base64)', 'Резервная копия фото (экспорт заполняет). Для импорта без картинки в ячейке'],
    ['Шаблон лица (JSON)', 'Массив из 128 чисел — обязателен для отметки по лицу'],
    ['Шаблон: чисел / контроль', 'Служебные поля для проверки целостности шаблона'],
    ['Профиль активен', 'да / нет — доступ в приложение'],
    ['Статус работы', 'Работает / В отпуске / Уволен (или working / vacation / fired)'],
    ['Договор', 'Только при экспорте: да/нет. Файлы договора загружаются в карточке пользователя'],
    ['Права (да/нет)', 'Склад, Выдача, Выработка, Пользователи, Журнал, Настройка, Отметка — переопределяют роль, если указаны'],
  ]);
  help['!cols'] = [{ wch: 28 }, { wch: 70 }];
  XLSX.utils.book_append_sheet(wb, help, 'Справка');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

const USERS_EXPORT_SQL = `
  SELECT u.id, u.login, u.password_plain, u.first_name, u.last_name, u.birth_date,
         u.passport_number, u.snils, u.inn, u.employment_date, u.employment_org, u.phone,
         u.hourly_rate, u.role, u.role_id, u.internal_uid, u.face_descriptor, u.face_photo,
         u.face_photo_data, u.face_photo_mime,
         COALESCE(u.profile_active, true) AS profile_active,
         COALESCE(u.employment_status, 'working') AS employment_status,
         (SELECT COUNT(*)::int FROM user_labor_contract_files lc WHERE lc.user_id = u.id) AS labor_contract_count,
         COALESCE(o.name, NULLIF(TRIM(u.employment_org), '')) AS organization_name,
         r.name AS role_profile_name,
         ${PERMISSIONS_SELECT}
  FROM users u
  LEFT JOIN user_permissions p ON p.user_id = u.id
  LEFT JOIN roles r ON r.id = u.role_id
  LEFT JOIN organizations o ON o.id = u.organization_id`;

export async function fetchUsersForExport() {
  const r = await pool.query(`${USERS_EXPORT_SQL} ORDER BY u.login`);
  return r.rows;
}

export async function fetchUsersForExportByIds(ids) {
  const clean = [...new Set(ids.map((id) => parseInt(id, 10)).filter((n) => !Number.isNaN(n) && n > 0))];
  if (!clean.length) return [];
  const r = await pool.query(
    `${USERS_EXPORT_SQL} WHERE u.id = ANY($1::int[]) ORDER BY u.login`,
    [clean],
  );
  return r.rows;
}

export function userToExportRow(u) {
  const face = faceTemplateMeta(u.face_descriptor);
  return [
    u.id,
    u.login || '',
    u.password_plain || '',
    u.first_name || '',
    u.last_name || '',
    u.birth_date ? String(u.birth_date).slice(0, 10) : '',
    u.passport_number || '',
    u.snils || '',
    u.inn || '',
    u.employment_date ? String(u.employment_date).slice(0, 10) : '',
    u.organization_name || u.employment_org || '',
    u.phone || '',
    u.hourly_rate != null ? u.hourly_rate : '',
    u.role === 'admin' ? 'admin' : 'user',
    u.role_profile_name || '',
    u.internal_uid || '',
    boolLabel(u.profile_active !== false),
    employmentStatusLabel(u.employment_status),
    (u.labor_contract_count || 0) > 0 ? 'да' : 'нет',
    boolLabel(u.can_warehouse),
    boolLabel(u.can_issuance),
    boolLabel(u.can_production),
    boolLabel(u.can_users),
    boolLabel(u.can_attendance),
    boolLabel(u.can_settings),
    boolLabel(u.can_face),
    '',
    photoToExportBase64(u),
    face.json,
    face.count || '',
    face.checksum !== '' ? face.checksum : '',
  ];
}

function collectImagesBySheetRow(sheet, workbook) {
  const map = new Map();
  const images = sheet.getImages?.() || [];
  for (const img of images) {
    const tl = img.range?.tl;
    if (!tl) continue;
    const sheetRow = (tl.nativeRow ?? Math.floor(tl.row ?? 0)) + 1;
    const media = workbook.getImage(img.imageId);
    if (media?.buffer?.length) {
      map.set(sheetRow, { buffer: media.buffer, ext: imageExtensionFromBuffer(media.buffer) });
    }
  }
  return map;
}

function excelRowToArray(row) {
  const raw = row?.values;
  if (!raw) return [];
  return raw.slice(1).map((c) => {
    if (c == null) return '';
    if (c instanceof Date) {
      const y = c.getFullYear();
      const m = String(c.getMonth() + 1).padStart(2, '0');
      const d = String(c.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    if (typeof c === 'object' && c.text != null) return String(c.text).trim();
    if (typeof c === 'object' && c.result != null) return String(c.result).trim();
    return String(c).trim();
  });
}

function buildItemFromRow(row, colMap, rowNum, imagesBySheetRow) {
  const login = cellVal(row, colMap.login);
  if (!login) return null;

  const img = imagesBySheetRow.get(rowNum);
  let facePhotoBuffer = img?.buffer ?? null;
  let facePhotoExt = img?.ext ?? 'jpeg';
  if (!facePhotoBuffer && colMap.face_photo_b64 !== undefined) {
    const b64 = cellVal(row, colMap.face_photo_b64);
    facePhotoBuffer = parseFaceImageBase64(b64);
  }

  const faceDescriptorRaw = colMap.face_descriptor !== undefined ? cellVal(row, colMap.face_descriptor) : undefined;

  return {
    rowNum,
    id: colMap.id !== undefined ? cellVal(row, colMap.id) : '',
    login,
    password: colMap.password !== undefined ? cellVal(row, colMap.password) : '',
    first_name: colMap.first_name !== undefined ? cellVal(row, colMap.first_name) : undefined,
    last_name: colMap.last_name !== undefined ? cellVal(row, colMap.last_name) : undefined,
    birth_date: colMap.birth_date !== undefined ? parseDateKey(cellVal(row, colMap.birth_date)) : undefined,
    passport_number: colMap.passport !== undefined ? cellVal(row, colMap.passport) : undefined,
    snils: colMap.snils !== undefined ? cellVal(row, colMap.snils) : undefined,
    inn: colMap.inn !== undefined ? cellVal(row, colMap.inn) : undefined,
    employment_date: colMap.employment_date !== undefined ? parseDateKey(cellVal(row, colMap.employment_date)) : undefined,
    organization: colMap.organization !== undefined ? cellVal(row, colMap.organization) : undefined,
    phone: colMap.phone !== undefined ? cellVal(row, colMap.phone) : undefined,
    hourly_rate: colMap.hourly_rate !== undefined ? cellVal(row, colMap.hourly_rate) : undefined,
    system_role: colMap.system_role !== undefined ? cellVal(row, colMap.system_role) : undefined,
    role_name: colMap.role_name !== undefined ? cellVal(row, colMap.role_name) : undefined,
    internal_uid: colMap.internal_uid !== undefined ? cellVal(row, colMap.internal_uid) : undefined,
    profile_active: colMap.profile_active !== undefined ? parseBool(cellVal(row, colMap.profile_active)) : undefined,
    employment_status: colMap.employment_status !== undefined
      ? parseEmploymentStatus(cellVal(row, colMap.employment_status))
      : undefined,
    can_warehouse: colMap.can_warehouse !== undefined ? parseBool(cellVal(row, colMap.can_warehouse)) : undefined,
    can_issuance: colMap.can_issuance !== undefined ? parseBool(cellVal(row, colMap.can_issuance)) : undefined,
    can_production: colMap.can_production !== undefined ? parseBool(cellVal(row, colMap.can_production)) : undefined,
    can_users: colMap.can_users !== undefined ? parseBool(cellVal(row, colMap.can_users)) : undefined,
    can_attendance: colMap.can_attendance !== undefined ? parseBool(cellVal(row, colMap.can_attendance)) : undefined,
    can_settings: colMap.can_settings !== undefined ? parseBool(cellVal(row, colMap.can_settings)) : undefined,
    can_face: colMap.can_face !== undefined ? parseBool(cellVal(row, colMap.can_face)) : undefined,
    face_descriptor: faceDescriptorRaw,
    face_descriptor_count: colMap.face_descriptor_count !== undefined ? cellVal(row, colMap.face_descriptor_count) : undefined,
    face_descriptor_checksum: colMap.face_descriptor_checksum !== undefined ? cellVal(row, colMap.face_descriptor_checksum) : undefined,
    face_photo_buffer: facePhotoBuffer,
    face_photo_ext: facePhotoExt,
  };
}

async function parseImportSheetExcelJs(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet('Пользователи') || workbook.worksheets[0];
  if (!sheet) throw new Error('Файл пустой');

  const headerRow = excelRowToArray(sheet.getRow(1));
  if (headerRow.length < 2) throw new Error('Нет строк данных (нужна шапка и хотя бы одна строка)');

  const colMap = mapHeaders(headerRow);
  if (colMap.login === undefined) {
    throw new Error('Не найден столбец «Логин» в первой строке');
  }

  const imagesBySheetRow = collectImagesBySheetRow(sheet, workbook);
  const items = [];

  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = excelRowToArray(sheet.getRow(r));
    if (!row.length || row.every((c) => c === '')) continue;
    const item = buildItemFromRow(row, colMap, r, imagesBySheetRow);
    if (item) items.push(item);
  }

  if (items.length === 0) throw new Error('Нет заполненных строк для импорта');
  return items;
}

function parseImportSheetXlsx(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error('Файл пустой');
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (rows.length < 2) throw new Error('Нет строк данных (нужна шапка и хотя бы одна строка)');

  const colMap = mapHeaders(rows[0]);
  if (colMap.login === undefined) {
    throw new Error('Не найден столбец «Логин» в первой строке');
  }

  const items = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c) => c === '' || c == null)) continue;
    const item = buildItemFromRow(row, colMap, i + 1, new Map());
    if (item) items.push(item);
  }

  if (items.length === 0) throw new Error('Нет заполненных строк для импорта');
  return items;
}

export async function parseImportSheet(buffer) {
  try {
    return await parseImportSheetExcelJs(buffer);
  } catch (e) {
    const msg = String(e.message || '');
    if (msg.includes('Логин') || msg.includes('пуст') || msg.includes('Нет строк') || msg.includes('заполненных')) {
      throw e;
    }
    try {
      return parseImportSheetXlsx(buffer);
    } catch {
      throw e;
    }
  }
}

async function applyImportedFacePhoto(client, userId, item) {
  if (item.face_photo_buffer?.length) {
    await saveUserFacePhotoWithClient(
      client,
      userId,
      item.face_photo_buffer,
      item.face_photo_ext || 'jpeg',
    );
  }
}

export async function buildExportBuffer(rows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Пользователи', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  const photoColIdx = EXPORT_HEADERS.indexOf(FACE_PHOTO_HEADER);

  const headerRow = sheet.addRow(EXPORT_HEADERS);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: 'middle', wrapText: true };

  for (const u of rows) {
    const data = userToExportRow(u);
    const row = sheet.addRow(data);
    const faceBuf = facePhotoBufferFromRow(u);
    row.height = faceBuf?.length ? 78 : 22;

    if (photoColIdx >= 0 && faceBuf?.length) {
      const ext = extFromMime(u.face_photo_mime || 'image/jpeg');
      const imageId = workbook.addImage({ buffer: faceBuf, extension: ext === 'png' ? 'png' : 'jpeg' });
      sheet.addImage(imageId, {
        tl: { col: photoColIdx + 0.2, row: row.number - 1 + 0.15 },
        ext: { width: 96, height: 72 },
      });
    }
  }

  sheet.columns = EXPORT_HEADERS.map((h) => {
    if (h === FACE_PHOTO_HEADER) return { width: 16 };
    if (h === 'Фото (base64)') return { width: 14 };
    if (h === 'Шаблон лица (JSON)') return { width: 28 };
    if (h === 'id') return { width: 8 };
    return { width: Math.max(12, h.length + 2) };
  });

  const help = workbook.addWorksheet('Справка');
  help.addRow(['Поле', 'Описание']);
  help.addRow(['Фото лица', 'Миниатюра для просмотра']);
  help.addRow(['Фото (base64)', 'Резерв для импорта, если изображение в ячейке потерялось']);
  help.addRow(['Шаблон лица (JSON)', '128 чисел — нужен для отметки по лицу после импорта']);
  help.addRow(['Профиль активен', 'да / нет']);
  help.addRow(['Статус работы', 'Работает / В отпуске / Уволен']);
  help.addRow(['Договор', 'Только экспорт; файлы — в интерфейсе пользователя']);
  help.columns = [{ width: 22 }, { width: 72 }];

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function resolveOrganizationByName(client, name) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return { organization_id: null, employment_org: null };
  const r = await client.query(
    'SELECT id, name FROM organizations WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))',
    [trimmed],
  );
  if (r.rows[0]) {
    return { organization_id: r.rows[0].id, employment_org: r.rows[0].name };
  }
  return { organization_id: null, employment_org: trimmed };
}

async function resolveRoleId(client, roleName) {
  if (!roleName) return null;
  const r = await client.query(
    'SELECT id FROM roles WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))',
    [roleName],
  );
  return r.rows[0]?.id ?? null;
}

async function findUserByLoginOrId(client, item) {
  if (item.id) {
    const id = parseInt(item.id, 10);
    if (!Number.isNaN(id)) {
      const r = await client.query('SELECT id, login FROM users WHERE id = $1', [id]);
      if (r.rowCount) return r.rows[0];
    }
  }
  const r = await client.query('SELECT id, login FROM users WHERE LOWER(login) = LOWER($1)', [item.login.trim()]);
  return r.rows[0] || null;
}

async function upsertUserRow(client, item, editorSession) {
  const existing = await findUserByLoginOrId(client, item);
  const isCreate = !existing;

  if (isCreate && !item.password) {
    throw new Error('Для нового пользователя укажите пароль');
  }

  let faceDescriptor;
  if (item.face_descriptor !== undefined && String(item.face_descriptor).trim() !== '') {
    faceDescriptor = parseFaceDescriptor(item.face_descriptor);
  }

  let roleId = null;
  if (item.role_name !== undefined && item.role_name !== '') {
    roleId = await resolveRoleId(client, item.role_name);
    if (!roleId) throw new Error(`Роль «${item.role_name}» не найдена в справочнике`);
  } else if (item.role_name === '') {
    roleId = null;
  }

  let systemRole = item.system_role !== undefined
    ? (String(item.system_role).trim().toLowerCase() === 'admin' ? 'admin' : 'user')
    : undefined;

  if (isCreate) {
    const hash = await bcrypt.hash(item.password, 10);
    const displayName = [
      item.first_name !== undefined ? item.first_name : '',
      item.last_name !== undefined ? item.last_name : '',
    ].filter(Boolean).join(' ').trim() || null;

    let employment = null;
    if (item.organization !== undefined) {
      employment = await resolveOrganizationByName(client, item.organization);
    }

    const faceJson = faceDescriptor ? JSON.stringify(faceDescriptor) : null;

    const profileActive = item.profile_active !== undefined && item.profile_active !== null
      ? item.profile_active
      : true;
    const employmentStatus = item.employment_status || 'working';

    const u = await client.query(
      `INSERT INTO users (login, password_hash, password_plain, display_name, first_name, last_name,
         birth_date, passport_number, snils, inn, employment_date, organization_id, employment_org,
         phone, hourly_rate, role, role_id, internal_uid, face_descriptor, profile_active, employment_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20,$21)
       RETURNING id`,
      [
        item.login.trim(),
        hash,
        item.password,
        displayName,
        (item.first_name || '').trim() || null,
        (item.last_name || '').trim() || null,
        item.birth_date ?? null,
        (item.passport_number || '').trim() || null,
        (item.snils || '').trim() || null,
        (item.inn || '').trim() || null,
        item.employment_date ?? null,
        employment?.organization_id ?? null,
        employment?.employment_org ?? null,
        (item.phone || '').trim() || null,
        item.hourly_rate !== undefined ? parseHourlyRate(item.hourly_rate) : null,
        systemRole ?? 'user',
        roleId,
        (item.internal_uid || '').trim() || null,
        faceJson,
        profileActive,
        employmentStatus,
      ],
    );
    const userId = u.rows[0].id;
    let perms = await resolveUserPermissionsForSave(client, {
      systemRole: systemRole ?? 'user',
      role_id: roleId,
    });
    perms = mergePermsFromExcelItem(perms, item);
    await upsertUserPermissions(client, userId, perms);
    await applyImportedFacePhoto(client, userId, item);
    return { action: 'created', userId };
  }

  const userId = existing.id;
  const target = (await client.query(
    'SELECT id, role, (face_descriptor IS NOT NULL) AS has_face FROM users WHERE id = $1',
    [userId],
  )).rows[0];

  if (item.login.trim().toLowerCase() !== existing.login.toLowerCase()) {
    const dup = await client.query(
      'SELECT id FROM users WHERE LOWER(login) = LOWER($1) AND id <> $2',
      [item.login.trim(), userId],
    );
    if (dup.rowCount) throw new Error('Логин уже занят другим пользователем');
    await client.query('UPDATE users SET login = $1 WHERE id = $2', [item.login.trim(), userId]);
  }

  if (item.password) {
    const hash = await bcrypt.hash(item.password, 10);
    await client.query(
      'UPDATE users SET password_hash = $2, password_plain = $3 WHERE id = $1',
      [userId, hash, item.password],
    );
  }

  const fieldUpdates = [
    ['first_name', item.first_name],
    ['last_name', item.last_name],
    ['birth_date', item.birth_date],
    ['passport_number', item.passport_number],
    ['snils', item.snils],
    ['inn', item.inn],
    ['employment_date', item.employment_date],
    ['phone', item.phone],
    ['internal_uid', item.internal_uid],
  ];
  for (const [col, val] of fieldUpdates) {
    if (val === undefined) continue;
    const v = typeof val === 'string' ? (val.trim() || null) : val;
    await client.query(`UPDATE users SET ${col} = $2 WHERE id = $1`, [userId, v]);
  }

  if (item.hourly_rate !== undefined) {
    await client.query('UPDATE users SET hourly_rate = $2 WHERE id = $1', [
      userId,
      parseHourlyRate(item.hourly_rate),
    ]);
  }

  if (item.organization !== undefined) {
    const employment = await resolveOrganizationByName(client, item.organization);
    await client.query(
      'UPDATE users SET organization_id = $2, employment_org = $3 WHERE id = $1',
      [userId, employment.organization_id, employment.employment_org],
    );
  }

  if (systemRole !== undefined && editorSession?.role === 'admin') {
    await client.query('UPDATE users SET role = $2 WHERE id = $1', [userId, systemRole]);
  }

  if (item.role_name !== undefined) {
    await client.query('UPDATE users SET role_id = $2 WHERE id = $1', [userId, roleId]);
  }

  if (faceDescriptor) {
    await client.query('UPDATE users SET face_descriptor = $2::jsonb WHERE id = $1', [
      userId,
      JSON.stringify(faceDescriptor),
    ]);
  }

  if (
    item.first_name !== undefined
    || item.last_name !== undefined
  ) {
    const { rows: [u] } = await client.query(
      'SELECT first_name, last_name FROM users WHERE id = $1',
      [userId],
    );
    const displayName = [u?.first_name, u?.last_name].filter(Boolean).join(' ').trim() || null;
    await client.query('UPDATE users SET display_name = $2 WHERE id = $1', [userId, displayName]);
  }

  const effectiveRole = systemRole !== undefined && editorSession?.role === 'admin'
    ? systemRole
    : target.role;
  const cr = (await client.query('SELECT role_id FROM users WHERE id = $1', [userId])).rows[0];
  const effectiveRoleId = item.role_name !== undefined ? roleId : cr?.role_id;
  let perms = await resolveUserPermissionsForSave(client, {
    systemRole: effectiveRole,
    role_id: effectiveRoleId,
  });
  perms = mergePermsFromExcelItem(perms, item);
  await upsertUserPermissions(client, userId, perms);

  if (item.profile_active !== undefined && item.profile_active !== null) {
    await client.query('UPDATE users SET profile_active = $2 WHERE id = $1', [userId, item.profile_active]);
  }
  if (item.employment_status) {
    await client.query('UPDATE users SET employment_status = $2 WHERE id = $1', [userId, item.employment_status]);
  }

  await applyImportedFacePhoto(client, userId, item);
  return { action: 'updated', userId };
}

/** Предпросмотр импорта без записи в БД */
export async function previewUsersImport(buffer) {
  const items = await parseImportSheet(buffer);
  const client = await pool.connect();
  const warnings = [];
  const seenLogins = new Set();
  let toCreate = 0;
  let toUpdate = 0;

  try {
    for (const item of items) {
      const lk = item.login.trim().toLowerCase();
      if (seenLogins.has(lk)) {
        warnings.push({ row: item.rowNum, login: item.login, error: 'Дублирующийся логин в файле' });
      } else {
        seenLogins.add(lk);
      }

      const existing = await findUserByLoginOrId(client, item);
      if (existing) {
        toUpdate += 1;
      } else {
        toCreate += 1;
        if (!item.password) {
          warnings.push({
            row: item.rowNum,
            login: item.login,
            error: 'Укажите пароль для нового пользователя',
          });
        }
      }

      if (item.face_descriptor && String(item.face_descriptor).trim()) {
        try {
          const nums = parseFaceDescriptor(item.face_descriptor);
          const meta = faceTemplateMeta(nums);
          if (item.face_descriptor_checksum !== undefined && item.face_descriptor_checksum !== '') {
            const expected = parseFloat(String(item.face_descriptor_checksum).replace(',', '.'));
            if (!Number.isNaN(expected) && meta.checksum !== '' && Math.abs(expected - meta.checksum) > 0.0001) {
              warnings.push({
                row: item.rowNum,
                login: item.login,
                error: 'Контрольная сумма шаблона лица не совпадает с JSON',
              });
            }
          }
        } catch (e) {
          warnings.push({ row: item.rowNum, login: item.login, error: e.message });
        }
      } else if (item.face_photo_buffer?.length) {
        warnings.push({
          row: item.rowNum,
          login: item.login,
          error: 'Есть фото, но нет шаблона (JSON) — отметка по лицу работать не будет',
        });
      }
    }

    return {
      total: items.length,
      toCreate,
      toUpdate,
      warnings,
      canImport: warnings.length === 0,
    };
  } finally {
    client.release();
  }
}

/** @param {Array} items @param {{ userId: number, role: string }} editor */
export async function applyUsersImport(items, editor) {
  const client = await pool.connect();
  const result = { total: items.length, created: 0, updated: 0, errors: [] };

  try {
    await client.query('BEGIN');
    for (const item of items) {
      try {
        const r = await upsertUserRow(client, item, editor);
        if (r.action === 'created') result.created += 1;
        else result.updated += 1;
      } catch (e) {
        if (e.code === '23505') {
          result.errors.push({ row: item.rowNum, error: 'Такой логин уже существует' });
        } else {
          result.errors.push({ row: item.rowNum, error: e.message || 'Ошибка' });
        }
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  return result;
}
