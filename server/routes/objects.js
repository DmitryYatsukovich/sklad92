import { Router } from 'express';
import pool from '../db/pool.js';
import { requireAuth, loadUser, requirePermission } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);
router.use(loadUser);

router.get('/hierarchy', requirePermission('can_objects'), async (_req, res) => {
  try {
    const [objects, entrances, floors, apartments, rooms] = await Promise.all([
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
    ]);

    res.json({
      objects: objects.rows,
      entrances: entrances.rows,
      floors: floors.rows,
      apartments: apartments.rows,
      rooms: rooms.rows,
    });
  } catch (e) {
    console.error('GET /objects/hierarchy:', e.message);
    res.status(500).json({ error: 'Ошибка загрузки схемы объектов' });
  }
});

export default router;
