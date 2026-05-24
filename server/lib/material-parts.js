import { MATERIAL_SELECT, MATERIAL_FROM } from './material-select.js';

/** id группы: сам parent или parent дочерней части */
export async function resolveGroupParentId(client, materialId) {
  const row = (await client.query(
    'SELECT id, parent_material_id FROM materials WHERE id = $1',
    [materialId],
  )).rows[0];
  if (!row) return null;
  return row.parent_material_id || row.id;
}

export async function loadMaterialGroup(client, materialId) {
  const parentId = await resolveGroupParentId(client, materialId);
  if (!parentId) return null;

  const parent = (await client.query(
    `SELECT ${MATERIAL_SELECT},
      (SELECT COUNT(*)::int FROM materials c
       WHERE c.parent_material_id = m.id AND COALESCE(c.quantity, 0) > 0) AS parts_count,
      (SELECT COALESCE(SUM(c.quantity), 0) FROM materials c WHERE c.parent_material_id = m.id) AS group_total_quantity
     ${MATERIAL_FROM} WHERE m.id = $1`,
    [parentId],
  )).rows[0];

  if (!parent) return null;

  const parts = (await client.query(
    `SELECT ${MATERIAL_SELECT},
      m.parent_material_id,
      m.part_index,
      m.part_label,
      p.name AS group_name,
      p.code AS group_code
     ${MATERIAL_FROM}
     LEFT JOIN materials p ON p.id = m.parent_material_id
     WHERE m.parent_material_id = $1
     ${PARTS_IN_STOCK_WHERE}
     ORDER BY m.part_index NULLS LAST, m.id`,
    [parentId],
  )).rows;

  const isGroup = Number(parent.parts_count) > 0;
  if (!isGroup) {
    return { parent: null, parts: [], isGroup: false, standalone: parent };
  }

  for (const p of parts) {
    p.group_name = parent.name;
    p.group_code = parent.code;
    p.group_total_quantity = parent.group_total_quantity;
    p.parts_count = parent.parts_count;
  }

  return { parent, parts, isGroup: true, standalone: null };
}

/** В списке — головные строки с остатком на складе (> 0) */
export function listMaterialsWhereClause() {
  return `WHERE m.parent_material_id IS NULL
    AND (
      (
        NOT EXISTS (SELECT 1 FROM materials c WHERE c.parent_material_id = m.id LIMIT 1)
        AND COALESCE(m.quantity, 0) > 0
      )
      OR EXISTS (
        SELECT 1 FROM materials c
        WHERE c.parent_material_id = m.id AND COALESCE(c.quantity, 0) > 0
        LIMIT 1
      )
    )`;
}

/** Только части с ненулевым остатком (для раскрытия группы на складе) */
export const PARTS_IN_STOCK_WHERE = 'AND COALESCE(m.quantity, 0) > 0';

/** Подзапрос: уникальные места всех частей группы через « · » */
export const MATERIAL_GROUP_LOCATIONS_SUBQUERY = `
  (SELECT NULLIF(string_agg(DISTINCT loc, ' · ' ORDER BY loc), '')
   FROM (
     SELECT NULLIF(trim(concat_ws(' → ', o.name, w.name, r.name)), '') AS loc
     FROM materials c
     LEFT JOIN warehouse_objects o ON o.id = c.object_id
     LEFT JOIN warehouses w ON w.id = c.warehouse_id
     LEFT JOIN warehouse_racks r ON r.id = c.rack_id
     WHERE c.parent_material_id = m.id AND COALESCE(c.quantity, 0) > 0
   ) t
   WHERE loc IS NOT NULL)`;

export const MATERIAL_GROUP_SELECT_EXTRA = `,
  m.parent_material_id,
  m.part_index,
  m.part_label,
  pmap.name AS group_name,
  pmap.code AS group_code,
  (SELECT COUNT(*)::int FROM materials c
   WHERE c.parent_material_id = COALESCE(m.parent_material_id, m.id) AND COALESCE(c.quantity, 0) > 0) AS parts_count,
  (SELECT COALESCE(SUM(c.quantity), 0) FROM materials c
   WHERE c.parent_material_id = COALESCE(m.parent_material_id, m.id)) AS group_total_quantity,
  ${MATERIAL_GROUP_LOCATIONS_SUBQUERY} AS group_locations_label`;

export const MATERIAL_GROUP_JOINS = `
  LEFT JOIN materials pmap ON pmap.id = m.parent_material_id`;
