import { Router } from 'express';
import pool from '../db/pool.js';
import { requireAuth, loadUser, requirePermission } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);
router.use(loadUser);

router.get('/hierarchy', requirePermission('can_objects'), async (_req, res) => {
  try {
    const [
      objects,
      entrances,
      floors,
      apartments,
      rooms,
      locationSystems,
      locationSystemMaterials,
      locationSystemEquipment,
      locationSystemWorks,
    ] = await Promise.all([
      pool.query(
        `SELECT o.id, o.name,
                COALESCE(equipment.equipment_count, 0)::int AS equipment_count,
                COALESCE(workload.works_count, 0)::int AS works_count
         FROM warehouse_objects o
         LEFT JOIN (
           SELECT object_id, COUNT(*)::int AS equipment_count
           FROM tools
           WHERE object_id IS NOT NULL
           GROUP BY object_id
         ) equipment ON equipment.object_id = o.id
         LEFT JOIN (
           SELECT object_id, COUNT(*)::int AS works_count
           FROM tasks
           WHERE object_id IS NOT NULL
             AND status <> 'completed'
           GROUP BY object_id
         ) workload ON workload.object_id = o.id
         ORDER BY o.name`,
      ),
      pool.query(
        `SELECT id, name, object_id
         FROM work_entrances
         ORDER BY object_id, name`,
      ),
      pool.query(
        `SELECT id, name, entrance_id, sort_order
         FROM work_floors
         ORDER BY entrance_id, COALESCE(sort_order, 2147483647), name`,
      ),
      pool.query(
        `SELECT id, name, floor_id
         FROM work_apartments
         ORDER BY floor_id, name`,
      ),
      pool.query(
        `SELECT id, name, apartment_id
         FROM work_rooms
         ORDER BY apartment_id, name`,
      ),
      pool.query(
        `SELECT ls.id, ls.location_kind, ls.location_id, ls.system_id, ls.category_id, ls.created_at, ls.updated_at,
                s.name AS system_name,
                c.name AS category_name
         FROM work_location_systems ls
         LEFT JOIN material_systems s ON s.id = ls.system_id
         LEFT JOIN material_categories c ON c.id = ls.category_id
         ORDER BY ls.location_kind, ls.location_id, s.name NULLS LAST, c.name NULLS LAST, ls.id`,
      ),
      pool.query(
        `SELECT lm.id, lm.location_system_id, lm.material_id, lm.quantity, lm.created_at, lm.updated_at,
                m.name AS material_name, m.unit AS material_unit
         FROM work_location_system_materials lm
         LEFT JOIN materials m ON m.id = lm.material_id
         ORDER BY lm.location_system_id, m.name NULLS LAST, lm.id`,
      ),
      pool.query(
        `SELECT id, location_system_id, name, quantity, created_at, updated_at
         FROM work_location_system_equipment
         ORDER BY location_system_id, name, id`,
      ),
      pool.query(
        `SELECT id, location_system_id, name, quantity, created_at, updated_at
         FROM work_location_system_works
         ORDER BY location_system_id, name, id`,
      ),
    ]);

    res.json({
      objects: objects.rows,
      entrances: entrances.rows,
      floors: floors.rows,
      apartments: apartments.rows,
      rooms: rooms.rows,
      location_systems: locationSystems.rows,
      location_system_materials: locationSystemMaterials.rows,
      location_system_equipment: locationSystemEquipment.rows,
      location_system_works: locationSystemWorks.rows,
    });
  } catch (e) {
    console.error('GET /objects/hierarchy:', e.message);
    res.status(500).json({ error: 'Ошибка загрузки схемы объектов' });
  }
});

export default router;
