import fs from 'fs';
import pool from '../db/pool.js';
import { facePhotoFilePath } from './face-photo.js';
import {
  resolveUserPermissionsForSave,
  upsertUserPermissions,
} from './sync-user-permissions-from-role.js';

/** Удаление шаблона лица и фото (доступ к отметке — только по роли). */
export async function clearUserFaceTemplate(userId) {
  const r = await pool.query(
    'SELECT face_photo, role, role_id FROM users WHERE id = $1',
    [userId],
  );
  if (!r.rowCount) return false;

  const row = r.rows[0];
  if (row.face_photo) {
    try {
      const fp = facePhotoFilePath(row.face_photo);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    } catch {
      /* ignore */
    }
  }

  await pool.query(
    'UPDATE users SET face_descriptor = NULL, face_photo = NULL WHERE id = $1',
    [userId],
  );

  const perms = await resolveUserPermissionsForSave(pool, {
    systemRole: row.role,
    role_id: row.role_id,
  });
  await upsertUserPermissions(pool, userId, perms);
  return true;
}
