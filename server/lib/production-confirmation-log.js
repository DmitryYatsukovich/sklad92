/** @param {import('pg').PoolClient} client */
export async function logProductionConfirmation(client, {
  issuanceId,
  confirmed,
  eventType,
  userId,
  workObjectId = null,
  workLocationItems = null,
}) {
  const type = eventType ?? (confirmed ? 'confirm' : 'unconfirm');
  const isConfirmed = type === 'confirm';

  await client.query(
    `INSERT INTO production_confirmation_log (
       issuance_id, confirmed, event_type, created_by,
       work_object_id, work_location_items,
       work_room_id, work_apartment_id, work_floor_id, work_entrance_id
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, NULL, NULL, NULL, NULL)`,
    [
      issuanceId,
      isConfirmed,
      type,
      userId ?? null,
      workObjectId,
      workLocationItems,
    ],
  );
}
