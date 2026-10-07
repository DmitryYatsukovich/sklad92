import { Router } from 'express';
import pool from '../db/pool.js';
import { requireAuth, loadUser, requirePermission } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);
router.use(loadUser);

function parseId(value) {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

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
      blockStatuses,
      assignableUsers,
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
        `SELECT ls.id, ls.location_kind, ls.location_id, ls.system_id, ls.category_id, ls.status_id, ls.assigned_user_id, ls.created_at, ls.updated_at,
                s.name AS system_name,
                c.name AS category_name,
                bs.name AS status_name, bs.color AS status_color,
                u.full_name AS assigned_user_name, u.login AS assigned_user_login
         FROM work_location_systems ls
         LEFT JOIN material_systems s ON s.id = ls.system_id
         LEFT JOIN material_categories c ON c.id = ls.category_id
         LEFT JOIN work_block_statuses bs ON bs.id = ls.status_id
         LEFT JOIN users u ON u.id = ls.assigned_user_id
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
      pool.query(
        `SELECT id, name, color, sort_order, created_at, updated_at
         FROM work_block_statuses
         ORDER BY sort_order, name`,
      ),
      pool.query(
        `SELECT id, full_name, login
         FROM users
         WHERE COALESCE(profile_active, true) = true
         ORDER BY full_name NULLS LAST, login`,
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
      block_statuses: blockStatuses.rows,
      assignable_users: assignableUsers.rows,
    });
  } catch (e) {
    console.error('GET /objects/hierarchy:', e.message);
    res.status(500).json({ error: 'Ошибка загрузки схемы объектов' });
  }
});

router.put('/location-systems/:id/status-assignment', requirePermission('can_objects'), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Неверный id блока' });

  const hasStatus = Object.prototype.hasOwnProperty.call(req.body || {}, 'status_id');
  const hasAssignee = Object.prototype.hasOwnProperty.call(req.body || {}, 'assigned_user_id');
  if (!hasStatus && !hasAssignee) {
    return res.status(400).json({ error: 'Нет данных для обновления' });
  }

  const slot = (await pool.query('SELECT id, status_id, assigned_user_id FROM work_location_systems WHERE id = $1', [id])).rows[0];
  if (!slot) return res.status(404).json({ error: 'Блок не найден' });

  let nextStatusId = slot.status_id;
  if (hasStatus) {
    if (req.body?.status_id == null || req.body?.status_id === '') {
      nextStatusId = null;
    } else {
      const parsedStatusId = parseId(req.body?.status_id);
      if (!parsedStatusId) return res.status(400).json({ error: 'Неверный статус' });
      const statusExists = (await pool.query('SELECT id FROM work_block_statuses WHERE id = $1', [parsedStatusId])).rows[0];
      if (!statusExists) return res.status(400).json({ error: 'Статус не найден' });
      nextStatusId = parsedStatusId;
    }
  }

  let nextAssignedUserId = slot.assigned_user_id;
  if (hasAssignee) {
    if (req.body?.assigned_user_id == null || req.body?.assigned_user_id === '') {
      nextAssignedUserId = null;
    } else {
      const parsedAssigneeId = parseId(req.body?.assigned_user_id);
      if (!parsedAssigneeId) return res.status(400).json({ error: 'Неверный исполнитель' });
      const assigneeExists = (await pool.query('SELECT id FROM users WHERE id = $1', [parsedAssigneeId])).rows[0];
      if (!assigneeExists) return res.status(400).json({ error: 'Исполнитель не найден' });
      nextAssignedUserId = parsedAssigneeId;
    }
  }

  await pool.query(
    `UPDATE work_location_systems
     SET status_id = $1,
         assigned_user_id = $2,
         updated_at = NOW()
     WHERE id = $3`,
    [nextStatusId, nextAssignedUserId, id],
  );

  const updated = (await pool.query(
    `SELECT ls.id, ls.location_kind, ls.location_id, ls.system_id, ls.category_id, ls.status_id, ls.assigned_user_id, ls.created_at, ls.updated_at,
            s.name AS system_name,
            c.name AS category_name,
            bs.name AS status_name, bs.color AS status_color,
            u.full_name AS assigned_user_name, u.login AS assigned_user_login
     FROM work_location_systems ls
     LEFT JOIN material_systems s ON s.id = ls.system_id
     LEFT JOIN material_categories c ON c.id = ls.category_id
     LEFT JOIN work_block_statuses bs ON bs.id = ls.status_id
     LEFT JOIN users u ON u.id = ls.assigned_user_id
     WHERE ls.id = $1`,
    [id],
  )).rows[0];
  res.json(updated);
});

export default router;
