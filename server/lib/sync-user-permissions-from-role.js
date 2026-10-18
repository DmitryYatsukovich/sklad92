import {
  PERMISSION_KEYS,
  permissionsFromBody,
} from './app-permissions.js';

/** Права пользователя: только из выбранной роли в справочнике. */
export async function resolveUserPermissionsForSave(client, { role_id }) {
  const rid = role_id != null && role_id !== '' && !Number.isNaN(Number(role_id))
    ? parseInt(role_id, 10)
    : null;

  if (rid) {
    const { rows } = await client.query(
      `SELECT ${PERMISSION_KEYS.join(', ')} FROM roles WHERE id = $1`,
      [rid],
    );
    if (rows[0]) {
      return permissionsFromBody(rows[0]);
    }
  }

  return Object.fromEntries(PERMISSION_KEYS.map((k) => [k, false]));
}

export async function upsertUserPermissions(client, userId, perms) {
  const cols = PERMISSION_KEYS.join(', ');
  const placeholders = PERMISSION_KEYS.map((_, i) => `$${i + 2}`).join(', ');
  const updates = [
    ...PERMISSION_KEYS.map((k, i) => `${k} = $${i + 2}`),
    `warehouse_permissions_customized = $${PERMISSION_KEYS.length + 2}`,
  ].join(', ');
  await client.query(
    `INSERT INTO user_permissions (user_id, ${cols}, warehouse_permissions_customized)
     VALUES ($1, ${placeholders}, $${PERMISSION_KEYS.length + 2})
     ON CONFLICT (user_id) DO UPDATE SET ${updates}`,
    [userId, ...PERMISSION_KEYS.map((k) => perms[k]), true],
  );
}

/** Синхронизировать user_permissions у всех пользователей с данной ролью */
export async function syncUsersPermissionsFromRole(client, roleId, rolePerms) {
  const { rows } = await client.query(
    'SELECT id FROM users WHERE role_id = $1',
    [roleId],
  );
  for (const u of rows) {
    await upsertUserPermissions(client, u.id, { ...rolePerms });
  }
}

/** Выравнивание прав всех пользователей по их ролям */
export async function syncAllUsersPermissionsFromRoles(pool) {
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT id, role, role_id FROM users');
    for (const u of rows) {
      const perms = await resolveUserPermissionsForSave(client, {
        systemRole: u.role,
        role_id: u.role_id,
      });
      await upsertUserPermissions(client, u.id, perms);
    }
    console.log(`syncAllUsersPermissionsFromRoles: ${rows.length} users`);
  } finally {
    client.release();
  }
}
