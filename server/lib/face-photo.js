import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import pool from '../db/pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const facePhotosDir = path.resolve(__dirname, '../uploads/face-photos');

export function ensureFacePhotosDir() {
  if (!fs.existsSync(facePhotosDir)) fs.mkdirSync(facePhotosDir, { recursive: true });
}

/** @param {Buffer} buffer */
export async function saveUserFacePhoto(userId, buffer, ext = 'jpg') {
  ensureFacePhotosDir();
  const safeExt = (ext || 'jpg').toLowerCase().replace(/[^a-z]/g, '') || 'jpg';
  const filename = `${userId}.${safeExt}`;
  fs.writeFileSync(path.join(facePhotosDir, filename), buffer);
  await pool.query('UPDATE users SET face_photo = $1 WHERE id = $2', [filename, userId]);
  return filename;
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

export function facePhotoFilePath(filename) {
  return path.join(facePhotosDir, filename);
}
