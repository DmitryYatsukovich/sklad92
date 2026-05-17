/** SELECT материала с названиями объекта, склада, стеллажа и категории */
export const MATERIAL_SELECT = `
  m.id, m.code, m.name, m.unit, m.price, m.production_price, m.quantity,
  m.object_id, m.warehouse_id, m.rack_id, m.category_id,
  m.created_at, m.updated_at,
  o.name AS object_name,
  w.name AS warehouse_name,
  r.name AS rack_name,
  c.name AS category_name`;

export const MATERIAL_FROM = `
  FROM materials m
  LEFT JOIN warehouse_objects o ON o.id = m.object_id
  LEFT JOIN warehouses w ON w.id = m.warehouse_id
  LEFT JOIN warehouse_racks r ON r.id = m.rack_id
  LEFT JOIN material_categories c ON c.id = m.category_id`;
