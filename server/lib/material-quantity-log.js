/** @param {import('pg').PoolClient} client */
export async function logQuantityChange(client, {
  materialId,
  userId,
  delta,
  quantityAfter,
  kind,
  issuanceId = null,
  note = null,
}) {
  await client.query(
    `INSERT INTO material_quantity_log (
       material_id, user_id, delta, quantity_after, kind, issuance_id, note
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [materialId, userId ?? null, delta, quantityAfter, kind, issuanceId, note],
  );
}

export const KIND_LABELS = {
  receipt: 'Приход',
  issue: 'Выдача',
  return: 'Возврат',
  return_adjust: 'Корректировка возврата',
  create: 'Создание',
  import: 'Импорт',
  adjust: 'Корректировка',
};
