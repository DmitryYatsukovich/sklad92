import path from 'path';
import pool from '../db/pool.js';

export const HAS_LABOR_CONTRACT_SQL = `(
  EXISTS (SELECT 1 FROM user_labor_contract_files f WHERE f.user_id = u.id)
  OR u.labor_contract_data IS NOT NULL
)`;

export const LABOR_CONTRACT_COUNT_SQL = `(
  SELECT COUNT(*)::int FROM user_labor_contract_files f WHERE f.user_id = u.id
)`;

export const EMPLOYMENT_STATUSES = ['working', 'vacation', 'fired'];

const LABOR_CONTRACT_EXT = /\.(pdf|jpe?g|png|webp|gif|bmp|tiff?|heic|heif|docx?|xlsx?)$/i;

const LABOR_CONTRACT_MIMES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/tiff',
  'image/heic',
  'image/heif',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const EXT_TO_MIME = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** Допустимые типы: изображения, PDF, Word, Excel */
export function isAllowedLaborContractUpload(file) {
  const mime = (file?.mimetype || '').toLowerCase().split(';')[0].trim();
  if (mime.startsWith('image/')) return true;
  if (LABOR_CONTRACT_MIMES.has(mime)) return true;
  const name = decodeOriginalFilename(file?.originalname || '').toLowerCase();
  return LABOR_CONTRACT_EXT.test(name);
}

export const LABOR_CONTRACT_ACCEPT_HINT =
  'изображения (JPG, PNG, WEBP, GIF, BMP, HEIC), PDF, Word (.doc, .docx), Excel (.xls, .xlsx)';

/** Имя файла из multipart (UTF-8) */
export function decodeOriginalFilename(name) {
  if (!name) return '';
  const raw = String(name).trim();
  try {
    const decoded = Buffer.from(raw, 'latin1').toString('utf8');
    if (decoded && !decoded.includes('\uFFFD')) return decoded;
  } catch {
    /* ignore */
  }
  return raw;
}

function mimeFromFilename(filename) {
  const ext = path.extname(filename || '').toLowerCase();
  return EXT_TO_MIME[ext] || null;
}

/** Сохраняем исходное имя файла (без пути), только убираем опасные символы */
export function preserveOriginalFilename(name, userId) {
  let base = decodeOriginalFilename(name);
  base = base.replace(/^.*[/\\]/, '').replace(/\0/g, '').trim();
  base = base.replace(/[/\\:*?"<>|]/g, '_');
  if (!base || base === '.' || base === '..') {
    const ext = mimeFromFilename(name) ? path.extname(name) : '';
    base = `document-${userId}${ext || ''}`;
  }
  const ext = path.extname(base);
  const maxStem = 200 - ext.length;
  if (base.length > 200) {
    base = base.slice(0, Math.max(1, maxStem)) + ext;
  }
  return base;
}

async function resolveUniqueFilename(db, userId, desired) {
  const check = await db.query(
    'SELECT 1 FROM user_labor_contract_files WHERE user_id = $1 AND filename = $2 LIMIT 1',
    [userId, desired],
  );
  if (!check.rowCount) return desired;
  const ext = path.extname(desired);
  const stem = desired.slice(0, desired.length - ext.length) || 'document';
  for (let n = 2; n < 500; n += 1) {
    const candidate = `${stem} (${n})${ext}`;
    const r = await db.query(
      'SELECT 1 FROM user_labor_contract_files WHERE user_id = $1 AND filename = $2 LIMIT 1',
      [userId, candidate],
    );
    if (!r.rowCount) return candidate;
  }
  return `${stem} (${Date.now()})${ext}`;
}

export function normalizeEmploymentStatus(v) {
  const s = String(v || 'working').trim().toLowerCase();
  return EMPLOYMENT_STATUSES.includes(s) ? s : 'working';
}

export function normalizeProfileActive(v) {
  if (v === false || v === 'false' || v === 0 || v === '0') return false;
  return true;
}

function toBuffer(data) {
  if (!data) return null;
  return Buffer.isBuffer(data) ? data : Buffer.from(data);
}

/** @param {import('pg').Pool | import('pg').PoolClient} db */
export async function insertLaborContractFile(db, userId, buffer, mime, originalName) {
  const baseName = preserveOriginalFilename(originalName, userId);
  const filename = await resolveUniqueFilename(db, userId, baseName);
  const storedMime = (mime && mime !== 'application/octet-stream')
    ? mime.split(';')[0].trim()
    : (mimeFromFilename(filename) || 'application/octet-stream');
  const r = await db.query(
    `INSERT INTO user_labor_contract_files (user_id, filename, mime, file_data)
     VALUES ($1, $2, $3, $4)
     RETURNING id, user_id, filename, mime, created_at`,
    [userId, filename, storedMime, buffer],
  );
  return r.rows[0];
}

/** До 4 файлов на пользователя для миниатюр в таблице */
export async function attachLaborContractPreviews(rows) {
  if (!rows?.length) return rows || [];
  const ids = rows.filter((u) => (u.labor_contract_count || 0) > 0).map((u) => u.id);
  if (!ids.length) {
    return rows.map((u) => ({ ...u, labor_contract_previews: [] }));
  }
  const r = await pool.query(
    `SELECT user_id, id, mime, filename, created_at
     FROM user_labor_contract_files
     WHERE user_id = ANY($1::int[])
     ORDER BY user_id, created_at DESC, id DESC`,
    [ids],
  );
  const map = new Map();
  for (const f of r.rows) {
    if (!map.has(f.user_id)) map.set(f.user_id, []);
    const arr = map.get(f.user_id);
    if (arr.length < 4) {
      arr.push({ id: f.id, mime: f.mime, filename: f.filename });
    }
  }
  return rows.map((u) => ({
    ...u,
    labor_contract_previews: map.get(u.id) || [],
  }));
}

export async function listLaborContractFiles(userId) {
  const r = await pool.query(
    `SELECT id, user_id, filename, mime, created_at
     FROM user_labor_contract_files
     WHERE user_id = $1
     ORDER BY created_at DESC, id DESC`,
    [userId],
  );
  return r.rows;
}

export async function readLaborContractFile(userId, fileId) {
  const r = await pool.query(
    `SELECT id, user_id, filename, mime, file_data
     FROM user_labor_contract_files
     WHERE user_id = $1 AND id = $2`,
    [userId, fileId],
  );
  const row = r.rows[0];
  if (!row) return null;
  const buffer = toBuffer(row.file_data);
  if (!buffer?.length) return null;
  return {
    id: row.id,
    user_id: row.user_id,
    filename: row.filename,
    mime: row.mime || 'application/octet-stream',
    buffer,
  };
}

export async function deleteLaborContractFile(userId, fileId) {
  const r = await pool.query(
    `DELETE FROM user_labor_contract_files WHERE user_id = $1 AND id = $2 RETURNING id`,
    [userId, fileId],
  );
  return r.rowCount > 0;
}

export async function countLaborContractFiles(userId) {
  const r = await pool.query(
    'SELECT COUNT(*)::int AS c FROM user_labor_contract_files WHERE user_id = $1',
    [userId],
  );
  return r.rows[0]?.c ?? 0;
}

/** Перенос одного файла из колонок users → таблица файлов */
export async function migrateLaborContractsToTable(db = pool) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS user_labor_contract_files (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      filename VARCHAR(255) NOT NULL,
      mime VARCHAR(128) NOT NULL DEFAULT 'application/octet-stream',
      file_data BYTEA NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_user_labor_contract_files_user
    ON user_labor_contract_files(user_id)`);

  const { rows } = await db.query(
    `SELECT id, labor_contract_data, labor_contract_mime, labor_contract_filename
     FROM users
     WHERE labor_contract_data IS NOT NULL`,
  );
  let n = 0;
  for (const u of rows) {
    const cnt = (await db.query(
      'SELECT COUNT(*)::int AS c FROM user_labor_contract_files WHERE user_id = $1',
      [u.id],
    )).rows[0]?.c;
    if (cnt > 0) continue;
    const buf = toBuffer(u.labor_contract_data);
    if (!buf?.length) continue;
    await insertLaborContractFile(
      db,
      u.id,
      buf,
      u.labor_contract_mime,
      u.labor_contract_filename,
    );
    n += 1;
  }
  if (n > 0) console.log(`migrateLaborContractsToTable: ${n} file(s)`);
  return n;
}

/** @deprecated — используйте insertLaborContractFile */
export async function saveLaborContract(db, userId, buffer, mime, originalName) {
  const row = await insertLaborContractFile(db, userId, buffer, mime, originalName);
  return row.filename;
}
