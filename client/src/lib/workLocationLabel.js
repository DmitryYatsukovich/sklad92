function namesByIds(catalog, key, ids) {
  const list = catalog?.[key] || [];
  return (ids || []).map((id) => list.find((x) => x.id === id || String(x.id) === String(id))?.name).filter(Boolean);
}

export function formatWorkLocationFromSelection(catalog, objectId, items) {
  if (!objectId) return '';
  const obj = (catalog?.objects || []).find((o) => o.id === objectId || String(o.id) === String(objectId));
  const parts = [];
  if (obj?.name) parts.push(obj.name);

  const ent = namesByIds(catalog, 'work_entrances', items?.entrance_ids || []);
  if (ent.length) parts.push(`подъезд: ${ent.join(', ')}`);
  const fl = namesByIds(catalog, 'work_floors', items?.floor_ids || []);
  if (fl.length) parts.push(`этаж: ${fl.join(', ')}`);
  const apt = namesByIds(catalog, 'work_apartments', items?.apartment_ids || []);
  if (apt.length) parts.push(`кв.: ${apt.join(', ')}`);
  const rm = namesByIds(catalog, 'work_rooms', items?.room_ids || []);
  if (rm.length) parts.push(`пом.: ${rm.join(', ')}`);

  return parts.join(' · ');
}

export function formatWorkLocationLabel(row) {
  if (!row) return '';
  const parts = [
    row.object_name || row.object_name_direct,
    row.entrance_name,
    row.floor_name,
    row.apartment_name,
    row.room_name,
  ].filter(Boolean);
  return parts.join(' → ');
}
