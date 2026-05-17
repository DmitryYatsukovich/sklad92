/** Сохраняемые права: из формы, при необходимости — из роли; минимум одно право (кроме admin). */
export async function resolvePermissionsForSave(client, {
  role,
  role_id,
  can_warehouse,
  can_issuance,
  can_production,
  can_users,
  can_attendance,
}) {
  let cw = !!can_warehouse;
  let ci = !!can_issuance;
  let cp = !!can_production;
  let cu = role === 'admin' || !!can_users;
  let ca = !!can_attendance;

  const rid = role_id && !Number.isNaN(Number(role_id)) ? parseInt(role_id, 10) : null;
  if (rid && !cw && !ci && !cp && !cu && !ca) {
    const { rows } = await client.query(
      `SELECT can_warehouse, can_issuance, can_production, can_users,
              COALESCE(can_attendance, false) AS can_attendance
       FROM roles WHERE id = $1`,
      [rid]
    );
    if (rows[0]) {
      cw = !!rows[0].can_warehouse;
      ci = !!rows[0].can_issuance;
      cp = !!rows[0].can_production;
      cu = !!rows[0].can_users;
      ca = !!rows[0].can_attendance;
    }
  }

  if (role !== 'admin' && !cw && !ci && !cp && !cu && !ca) {
    cw = true;
  }

  return { can_warehouse: cw, can_issuance: ci, can_production: cp, can_users: cu, can_attendance: ca };
}
