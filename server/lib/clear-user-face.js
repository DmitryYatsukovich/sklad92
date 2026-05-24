import pool from '../db/pool.js';
import {
  resolveUserPermissionsForSave,
  upsertUserPermissions,
} from './sync-user-permissions-from-role.js';

/** Удаление шаблона лица и фото (доступ к отметке — только по роли). */
export async function clearUserFaceTemplate(userId) {
  const r = await pool.query(
    'SELECT role, role_id FROM users WHERE id = $1',
    [userId],
  );
  if (!r.rowCount) return false;

  const row = r.rows[0];

  await pool.query(
    `UPDATE users SET
       face_descriptor = NULL,
       face_photo = NULL,
       face_photo_data = NULL,
       face_photo_mime = NULL
     WHERE id = $1`,
    [userId],
  );

  const perms = await resolveUserPermissionsForSave(pool, {
    systemRole: row.role,
    role_id: row.role_id,
  });
  await upsertUserPermissions(pool, userId, perms);
  return true;
}
