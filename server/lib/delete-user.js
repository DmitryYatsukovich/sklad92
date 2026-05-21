import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../db/pool.js';
import { facePhotoFilePath } from './face-photo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.resolve(__dirname, '../uploads/avatars');

function unlinkSafe(filepath) {
  try {
    if (filepath && fs.existsSync(filepath)) fs.unlinkSync(filepath);
  } catch {
    /* ignore */
  }
}

/** Удаление пользователя и связанных данных (выдачи, посещения, права). */
export async function deleteUserById(userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const u = (await client.query(
      'SELECT id, avatar, face_photo FROM users WHERE id = $1',
      [userId],
    )).rows[0];
    if (!u) {
      await client.query('ROLLBACK');
      return null;
    }

    await client.query(
      'DELETE FROM issuances WHERE issued_by_user_id = $1 OR issued_to_user_id = $1',
      [userId],
    );

    const del = await client.query('DELETE FROM users WHERE id = $1 RETURNING id', [userId]);
    if (del.rowCount === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    await client.query('COMMIT');

    if (u.avatar) unlinkSafe(path.join(uploadsDir, u.avatar));
    if (u.face_photo) unlinkSafe(facePhotoFilePath(u.face_photo));

    return del.rows[0];
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
