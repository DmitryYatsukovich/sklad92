export function parseId(v) {
  const n = parseInt(v, 10);
  return n > 0 ? n : null;
}

function parseIdArray(val) {
  if (!Array.isArray(val)) return [];
  return [...new Set(val.map((x) => parseId(x)).filter(Boolean))];
}

/** Требуется object_id; подъезды/этажи/квартиры/помещения — массивы id */
export function parseWorkLocationBody(body) {
  const object_id = parseId(body?.object_id);
  if (!object_id) return null;

  return {
    object_id,
    entrance_ids: parseIdArray(body?.entrance_ids),
    floor_ids: parseIdArray(body?.floor_ids),
    apartment_ids: parseIdArray(body?.apartment_ids),
    room_ids: parseIdArray(body?.room_ids),
  };
}

export function workLocationItemsJson(loc) {
  return JSON.stringify({
    entrance_ids: loc.entrance_ids,
    floor_ids: loc.floor_ids,
    apartment_ids: loc.apartment_ids,
    room_ids: loc.room_ids,
  });
}

function namesByIds(catalog, key, ids) {
  const list = catalog?.[key] || [];
  return ids.map((id) => list.find((x) => x.id === id)?.name).filter(Boolean);
}

/** @param {object} catalog — справочник с objects, work_entrances, … */
export function formatWorkLocationFromSelection(catalog, objectId, items) {
  if (!objectId) return '';
  const obj = (catalog?.objects || []).find((o) => o.id === objectId);
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

/** @param {{ object_name?, entrance_name?, …, work_object_id?, work_location_items? }} row */
export function formatWorkLocationLabel(row, catalog = null) {
  if (!row) return '';

  if (row.work_location_items && catalog) {
    const items = typeof row.work_location_items === 'string'
      ? JSON.parse(row.work_location_items)
      : row.work_location_items;
    const oid = row.work_object_id || items?.object_id;
    const label = formatWorkLocationFromSelection(catalog, oid, items);
    if (label) return label;
  }
  if (row.work_object_id && catalog) {
    const label = formatWorkLocationFromSelection(catalog, row.work_object_id, {});
    if (label) return label;
  }

  const parts = [
    row.object_name,
    row.entrance_name,
    row.floor_name,
    row.apartment_name,
    row.room_name || row.name,
  ].filter(Boolean);
  return parts.join(' → ');
}

export const WORK_LOCATION_SELECT = `
  i.work_object_id,
  i.work_location_items,
  i.work_room_id,
  i.work_apartment_id,
  i.work_floor_id,
  i.work_entrance_id,
  wo2.name AS object_name_direct,
  wr.name AS room_name,
  wa.name AS apartment_name,
  wf.name AS floor_name,
  we.name AS entrance_name,
  wo.name AS object_name
`;

export const WORK_LOCATION_JOIN = `
  LEFT JOIN warehouse_objects wo2 ON wo2.id = i.work_object_id
  LEFT JOIN work_rooms wr ON wr.id = i.work_room_id
  LEFT JOIN work_apartments wa ON wa.id = COALESCE(wr.apartment_id, i.work_apartment_id)
  LEFT JOIN work_floors wf ON wf.id = COALESCE(wa.floor_id, i.work_floor_id)
  LEFT JOIN work_entrances we ON we.id = COALESCE(wf.entrance_id, i.work_entrance_id)
  LEFT JOIN warehouse_objects wo ON wo.id = COALESCE(we.object_id, i.work_object_id)
`;

export const WORK_LOCATION_SELECT_PCL = `
  pcl.work_object_id,
  pcl.work_location_items,
  pcl.work_room_id,
  pcl.work_apartment_id,
  pcl.work_floor_id,
  pcl.work_entrance_id,
  wo2.name AS object_name_direct,
  wr.name AS room_name,
  wa.name AS apartment_name,
  wf.name AS floor_name,
  we.name AS entrance_name,
  wo.name AS object_name
`;

export const WORK_LOCATION_JOIN_PCL = `
  LEFT JOIN warehouse_objects wo2 ON wo2.id = pcl.work_object_id
  LEFT JOIN work_rooms wr ON wr.id = pcl.work_room_id
  LEFT JOIN work_apartments wa ON wa.id = COALESCE(wr.apartment_id, pcl.work_apartment_id)
  LEFT JOIN work_floors wf ON wf.id = COALESCE(wa.floor_id, pcl.work_floor_id)
  LEFT JOIN work_entrances we ON we.id = COALESCE(wf.entrance_id, pcl.work_entrance_id)
  LEFT JOIN warehouse_objects wo ON wo.id = COALESCE(we.object_id, pcl.work_object_id)
`;
