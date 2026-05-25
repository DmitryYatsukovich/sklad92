import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import pool from '../db/pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const avatarsDir = path.resolve(__dirname, '../uploads/avatars');
export const facePhotosDir = path.resolve(__dirname, '../uploads/face-photos');

export const HAS_FACE_PHOTO_SQL = '(u.face_photo_data IS NOT NULL)';
export const HAS_AVATAR_SQL = '(u.avatar_data IS NOT NULL)';

export function ensureAvatarDir() {
  if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir, { recursive: true });
}

export function ensureFacePhotosDir() {
  if (!fs.existsSync(facePhotosDir)) fs.mkdirSync(facePhotosDir, { recursive: true });
}

export function mimeFromExt(ext) {
  const e = (ext || 'jpg').toLowerCase().replace(/[^a-z]/g, '') || 'jpg';
  if (e === 'png') return 'image/png';
  if (e === 'webp') return 'image/webp';
  if (e === 'gif') return 'image/gif';
  return 'image/jpeg';
}

export function extFromMime(mime) {
  const m = (mime || '').toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('webp')) return 'webp';
  if (m.includes('gif')) return 'gif';
  return 'jpeg';
}

export function facePhotoFilePath(filename) {
  return path.join(facePhotosDir, filename);
}

export function avatarFilePath(filename) {
  return path.join(avatarsDir, filename);
}

export function parseFaceImageBase64(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const m = raw.match(/^data:image\/\w+;base64,(.+)$/);
  const b64 = m ? m[1] : raw;
  try {
    const buf = Buffer.from(b64, 'base64');
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}

function toBuffer(data) {
  if (!data) return null;
  return Buffer.isBuffer(data) ? data : Buffer.from(data);
}

export function sendImageBuffer(res, buffer, mime = 'image/jpeg') {
  res.setHeader('Content-Type', mime || 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.send(buffer);
}

function readLegacyFacePhotoFile(filename) {
  if (!filename) return null;
  const filepath = facePhotoFilePath(filename);
  if (!fs.existsSync(filepath)) return null;
  return fs.readFileSync(filepath);
}

function readLegacyAvatarFile(filename) {
  if (!filename) return null;
  const filepath = avatarFilePath(filename);
  if (!fs.existsSync(filepath)) return null;
  return fs.readFileSync(filepath);
}

/** @param {import('pg').Pool | import('pg').PoolClient} db */
async function saveAvatarToDb(db, userId, buffer, mime, marker) {
  await db.query(
    `UPDATE users SET avatar_data = $1, avatar_mime = $2, avatar = $3 WHERE id = $4`,
    [buffer, mime, marker, userId],
  );
}

/** @param {import('pg').Pool | import('pg').PoolClient} db */
async function saveFacePhotoToDb(db, userId, buffer, mime, marker) {
  await db.query(
    `UPDATE users SET face_photo_data = $1, face_photo_mime = $2, face_photo = $3 WHERE id = $4`,
    [buffer, mime, marker, userId],
  );
}

export async function saveUserAvatar(userId, buffer, ext = 'jpg') {
  const safeExt = (ext || 'jpg').toLowerCase().replace(/[^a-z]/g, '') || 'jpg';
  const mime = mimeFromExt(safeExt);
  const marker = `${userId}.${safeExt}`;
  await saveAvatarToDb(pool, userId, buffer, mime, marker);
  return marker;
}

export async function saveUserFacePhoto(userId, buffer, ext = 'jpg') {
  const safeExt = (ext || 'jpg').toLowerCase().replace(/[^a-z]/g, '') || 'jpg';
  const mime = mimeFromExt(safeExt);
  const marker = `${userId}.${safeExt}`;
  await saveFacePhotoToDb(pool, userId, buffer, mime, marker);
  return marker;
}

export async function saveUserFacePhotoWithClient(client, userId, buffer, ext = 'jpg') {
  const safeExt = (ext || 'jpg').toLowerCase().replace(/[^a-z]/g, '') || 'jpg';
  const mime = mimeFromExt(safeExt);
  const marker = `${userId}.${safeExt}`;
  await saveFacePhotoToDb(client, userId, buffer, mime, marker);
  return marker;
}

export async function readUserAvatar(userId) {
  const r = await pool.query(
    'SELECT avatar_data, avatar_mime, avatar FROM users WHERE id = $1',
    [userId],
  );
  const row = r.rows[0];
  if (!row) return null;
  const buf = toBuffer(row.avatar_data);
  if (buf?.length) {
    return { buffer: buf, mime: row.avatar_mime || 'image/jpeg' };
  }
  const legacy = readLegacyAvatarFile(row.avatar);
  if (legacy?.length) {
    const ext = (row.avatar || '').split('.').pop();
    return { buffer: legacy, mime: mimeFromExt(ext) };
  }
  return null;
}

export async function readUserFacePhoto(userId) {
  const r = await pool.query(
    'SELECT face_photo_data, face_photo_mime, face_photo FROM users WHERE id = $1',
    [userId],
  );
  const row = r.rows[0];
  if (!row) return null;
  const buf = toBuffer(row.face_photo_data);
  if (buf?.length) {
    return { buffer: buf, mime: row.face_photo_mime || 'image/jpeg' };
  }
  const legacy = readLegacyFacePhotoFile(row.face_photo);
  if (legacy?.length) {
    const ext = (row.face_photo || '').split('.').pop();
    return { buffer: legacy, mime: mimeFromExt(ext) };
  }
  return null;
}

export function facePhotoBufferFromRow(u) {
  const buf = toBuffer(u?.face_photo_data);
  if (buf?.length) return buf;
  return readLegacyFacePhotoFile(u?.face_photo);
}

/** Перенос старых файлов с диска в PostgreSQL (один раз при старте) */
export async function migrateUserImagesFromDisk(db = pool) {
  const { rows } = await db.query(
    `SELECT id, avatar, face_photo, avatar_data, face_photo_data
     FROM users
     WHERE (avatar IS NOT NULL AND avatar_data IS NULL)
        OR (face_photo IS NOT NULL AND face_photo_data IS NULL)`,
  );
  if (!rows.length) return 0;

  let n = 0;
  for (const u of rows) {
    if (u.avatar && !u.avatar_data) {
      const buf = readLegacyAvatarFile(u.avatar);
      if (buf?.length) {
        const ext = u.avatar.split('.').pop();
        await saveAvatarToDb(db, u.id, buf, mimeFromExt(ext), u.avatar);
        n += 1;
      }
    }
    if (u.face_photo && !u.face_photo_data) {
      const buf = readLegacyFacePhotoFile(u.face_photo);
      if (buf?.length) {
        const ext = u.face_photo.split('.').pop();
        await saveFacePhotoToDb(db, u.id, buf, mimeFromExt(ext), u.face_photo);
        n += 1;
      }
    }
  }
  if (n > 0) console.log(`migrateUserImagesFromDisk: ${n} image(s) → database`);
  return n;
}
