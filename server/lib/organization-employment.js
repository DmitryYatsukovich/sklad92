/** Синхронизация organization_id и текстового employment_org при сохранении пользователя */
export async function resolveEmploymentForSave(client, { organization_id, employment_org }) {
  if (organization_id !== undefined) {
    const oid = organization_id != null && organization_id !== ''
      ? parseInt(organization_id, 10)
      : null;
    if (oid != null && (Number.isNaN(oid) || oid <= 0)) {
      return { error: 'Неверная организация' };
    }
    if (oid) {
      const r = await client.query('SELECT name FROM organizations WHERE id = $1', [oid]);
      if (!r.rowCount) return { error: 'Организация не найдена' };
      return { organization_id: oid, employment_org: r.rows[0].name };
    }
    return { organization_id: null, employment_org: null };
  }
  if (employment_org !== undefined) {
    return {
      organization_id: null,
      employment_org: (employment_org || '').trim() || null,
    };
  }
  return null;
}
