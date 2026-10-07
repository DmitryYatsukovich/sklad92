import { Router } from 'express';
import pool from '../db/pool.js';
import { requireAuth, loadUser, requirePermission } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);
router.use(loadUser);

let ensureObjectStatusSchemaPromise = null;

function parseId(value) {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function appendIssuanceEventTag(note, tag) {
  const base = String(note || '').trim();
  if (!base) return tag;
  return `${base}\n${tag}`;
}

function makeIssuanceEventTag(type, data = {}) {
  const payload = Object.entries(data)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join(';');
  return `[[evt:${type};${payload}]]`;
}

async function ensureObjectStatusSchema() {
  if (!ensureObjectStatusSchemaPromise) {
    ensureObjectStatusSchemaPromise = (async () => {
      await pool.query(
        `CREATE TABLE IF NOT EXISTS work_block_statuses (
          id SERIAL PRIMARY KEY,
          name VARCHAR(200) NOT NULL UNIQUE,
          color VARCHAR(16) NOT NULL,
          is_for_production BOOLEAN NOT NULL DEFAULT false,
          counts_as_produced BOOLEAN NOT NULL DEFAULT false,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )`,
      );
      await pool.query(
        'ALTER TABLE work_block_statuses ADD COLUMN IF NOT EXISTS is_for_production BOOLEAN NOT NULL DEFAULT false',
      );
      await pool.query(
        'ALTER TABLE work_block_statuses ADD COLUMN IF NOT EXISTS counts_as_produced BOOLEAN NOT NULL DEFAULT false',
      );
      await pool.query(
        'ALTER TABLE work_location_systems ADD COLUMN IF NOT EXISTS status_id INTEGER REFERENCES work_block_statuses(id) ON DELETE SET NULL',
      );
      await pool.query(
        'ALTER TABLE work_location_systems ADD COLUMN IF NOT EXISTS assigned_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL',
      );
      await pool.query(
        'CREATE INDEX IF NOT EXISTS idx_wls_status ON work_location_systems(status_id)',
      );
      await pool.query(
        'CREATE INDEX IF NOT EXISTS idx_wls_assigned_user ON work_location_systems(assigned_user_id)',
      );
      await pool.query(
        `CREATE TABLE IF NOT EXISTS issuance_production_allocations (
          id SERIAL PRIMARY KEY,
          issuance_id INTEGER NOT NULL REFERENCES issuances(id) ON DELETE CASCADE,
          location_system_id INTEGER NOT NULL REFERENCES work_location_systems(id) ON DELETE RESTRICT,
          worker_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          status_id INTEGER REFERENCES work_block_statuses(id) ON DELETE SET NULL,
          quantity DECIMAL(18,4) NOT NULL DEFAULT 0,
          created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          CHECK (quantity > 0)
        )`,
      );
      await pool.query(
        'CREATE INDEX IF NOT EXISTS idx_ipa_issuance ON issuance_production_allocations(issuance_id, created_at DESC)',
      );
      await pool.query(
        'CREATE INDEX IF NOT EXISTS idx_ipa_location_system ON issuance_production_allocations(location_system_id, created_at DESC)',
      );
    })().catch((error) => {
      ensureObjectStatusSchemaPromise = null;
      throw error;
    });
  }
  await ensureObjectStatusSchemaPromise;
}

router.get('/hierarchy', requirePermission('can_objects'), async (_req, res) => {
  try {
    await ensureObjectStatusSchema();
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
      materialBalances,
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
                COALESCE(NULLIF(TRIM(u.display_name), ''), NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.login) AS assigned_user_name,
                u.login AS assigned_user_login
         FROM work_location_systems ls
         LEFT JOIN material_systems s ON s.id = ls.system_id
         LEFT JOIN material_categories c ON c.id = ls.category_id
         LEFT JOIN work_block_statuses bs ON bs.id = ls.status_id
         LEFT JOIN users u ON u.id = ls.assigned_user_id
         ORDER BY ls.location_kind, ls.location_id, s.name NULLS LAST, c.name NULLS LAST, ls.id`,
      ),
      pool.query(
        `SELECT lm.id, lm.location_system_id, lm.material_id, lm.quantity, lm.created_at, lm.updated_at,
                m.name AS material_name, m.unit AS material_unit,
                m.system_id AS material_system_id, m.category_id AS material_category_id,
                ms.name AS material_system_name, mc.name AS material_category_name
         FROM work_location_system_materials lm
         LEFT JOIN materials m ON m.id = lm.material_id
         LEFT JOIN material_systems ms ON ms.id = m.system_id
         LEFT JOIN material_categories mc ON mc.id = m.category_id
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
        `WITH produced_by_issuance AS (
           SELECT issuance_id, COALESCE(SUM(quantity), 0)::numeric AS produced_qty
           FROM issuance_production_allocations
           GROUP BY issuance_id
         ),
         on_hands_by_material AS (
           SELECT i.material_id,
                  COALESCE(SUM(GREATEST(i.quantity - COALESCE(i.returned_quantity, 0) - COALESCE(pbi.produced_qty, 0), 0)), 0)::numeric AS on_hands_quantity
           FROM issuances i
           LEFT JOIN produced_by_issuance pbi ON pbi.issuance_id = i.id
           GROUP BY i.material_id
         )
         SELECT m.id,
                m.name,
                m.unit,
                m.system_id,
                m.category_id,
                ms.name AS system_name,
                mc.name AS category_name,
                COALESCE(m.quantity, 0)::numeric AS warehouse_quantity,
                COALESCE(oh.on_hands_quantity, 0)::numeric AS on_hands_quantity
         FROM materials m
         LEFT JOIN material_systems ms ON ms.id = m.system_id
         LEFT JOIN material_categories mc ON mc.id = m.category_id
         LEFT JOIN on_hands_by_material oh ON oh.material_id = m.id
         ORDER BY ms.name NULLS LAST, mc.name NULLS LAST, m.name`,
      ),
      pool.query(
        `SELECT id, name, color, is_for_production, counts_as_produced, sort_order, created_at, updated_at
         FROM work_block_statuses
         ORDER BY sort_order, name`,
      ),
      pool.query(
        `SELECT id,
                COALESCE(NULLIF(TRIM(display_name), ''), NULLIF(TRIM(CONCAT_WS(' ', first_name, last_name)), ''), login) AS full_name,
                login
         FROM users
         ORDER BY 2, login`,
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
      material_balances: materialBalances.rows,
      block_statuses: blockStatuses.rows,
      assignable_users: assignableUsers.rows,
    });
  } catch (e) {
    console.error('GET /objects/hierarchy:', e.message);
    res.status(500).json({ error: 'Ошибка загрузки схемы объектов' });
  }
});

router.put('/location-systems/:id/status-assignment', requirePermission('can_objects'), async (req, res) => {
  await ensureObjectStatusSchema();
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
            COALESCE(NULLIF(TRIM(u.display_name), ''), NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.login) AS assigned_user_name,
            u.login AS assigned_user_login
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

router.get('/location-systems/:id/production', requirePermission('can_objects'), async (req, res) => {
  await ensureObjectStatusSchema();
  const slotId = parseId(req.params.id);
  if (!slotId) return res.status(400).json({ error: 'Неверный id блока' });

  const slot = (await pool.query('SELECT id FROM work_location_systems WHERE id = $1', [slotId])).rows[0];
  if (!slot) return res.status(404).json({ error: 'Блок не найден' });

  const rows = (await pool.query(
    `SELECT ipa.issuance_id,
            MAX(ipa.created_at) AS last_created_at,
            COALESCE(SUM(ipa.quantity), 0)::numeric AS quantity,
            ARRAY_AGG(DISTINCT ipa.worker_user_id) AS worker_user_ids,
            ARRAY_AGG(DISTINCT COALESCE(NULLIF(TRIM(u.display_name), ''), NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.login)) AS worker_names,
            ARRAY_AGG(DISTINCT ipa.status_id) FILTER (WHERE ipa.status_id IS NOT NULL) AS status_ids,
            ARRAY_AGG(DISTINCT bs.name) FILTER (WHERE bs.name IS NOT NULL) AS status_names,
            ARRAY_AGG(DISTINCT bs.color) FILTER (WHERE bs.color IS NOT NULL) AS status_colors,
            m.id AS material_id,
            m.name AS material_name,
            m.code AS material_code,
            m.unit AS material_unit
     FROM issuance_production_allocations ipa
     JOIN issuances i ON i.id = ipa.issuance_id
     JOIN materials m ON m.id = i.material_id
     LEFT JOIN users u ON u.id = ipa.worker_user_id
     LEFT JOIN work_block_statuses bs ON bs.id = ipa.status_id
     WHERE ipa.location_system_id = $1
     GROUP BY ipa.issuance_id, m.id, m.name, m.code, m.unit
     ORDER BY MAX(ipa.created_at) DESC, ipa.issuance_id DESC`,
    [slotId],
  )).rows.map((row) => ({
    issuance_id: Number(row.issuance_id),
    last_created_at: row.last_created_at,
    quantity: Number(row.quantity || 0),
    worker_user_ids: Array.isArray(row.worker_user_ids) ? row.worker_user_ids.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0) : [],
    worker_names: Array.isArray(row.worker_names) ? row.worker_names.filter(Boolean) : [],
    status_ids: Array.isArray(row.status_ids) ? row.status_ids.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0) : [],
    status_names: Array.isArray(row.status_names) ? row.status_names.filter(Boolean) : [],
    status_colors: Array.isArray(row.status_colors) ? row.status_colors.filter(Boolean) : [],
    material_id: Number(row.material_id),
    material_name: row.material_name || '',
    material_code: row.material_code || '',
    material_unit: row.material_unit || '',
  }));

  res.json(rows);
});

router.delete('/location-systems/:id/production', requirePermission('can_objects'), async (req, res) => {
  await ensureObjectStatusSchema();
  const slotId = parseId(req.params.id);
  const requestedIssuanceId = parseId(req.body?.issuance_id);
  if (!slotId) return res.status(400).json({ error: 'Неверный id блока' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const slot = (await client.query(
      'SELECT id FROM work_location_systems WHERE id = $1 FOR UPDATE',
      [slotId],
    )).rows[0];
    if (!slot) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Блок не найден' });
    }

    let issuanceId = requestedIssuanceId;
    if (!issuanceId) {
      const latest = (await client.query(
        `SELECT issuance_id
         FROM issuance_production_allocations
         WHERE location_system_id = $1
         ORDER BY created_at DESC, id DESC
         LIMIT 1`,
        [slotId],
      )).rows[0];
      issuanceId = latest ? Number(latest.issuance_id) : null;
    }
    if (!issuanceId) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Для этого блока нет проведённой выработки' });
    }

    const issuance = (await client.query(
      `SELECT id, note
       FROM issuances
       WHERE id = $1
       FOR UPDATE`,
      [issuanceId],
    )).rows[0];
    if (!issuance) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Выдача не найдена' });
    }

    const deleted = await client.query(
      `DELETE FROM issuance_production_allocations
       WHERE location_system_id = $1
         AND issuance_id = $2
       RETURNING quantity`,
      [slotId, issuanceId],
    );
    if (!deleted.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'По этому блоку нет выработки для отмены' });
    }
    const restoredQty = deleted.rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);

    const latestSlotAllocation = (await client.query(
      `SELECT status_id, worker_user_id
       FROM issuance_production_allocations
       WHERE location_system_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [slotId],
    )).rows[0] || null;

    await client.query(
      `UPDATE work_location_systems
       SET status_id = $1,
           assigned_user_id = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [
        latestSlotAllocation?.status_id ?? null,
        latestSlotAllocation?.worker_user_id ?? null,
        slotId,
      ],
    );

    const cancelTag = makeIssuanceEventTag('production_cancel', {
      qty: restoredQty,
      blocks: 1,
      at: new Date().toISOString(),
    });
    const nextNote = appendIssuanceEventTag(issuance.note, cancelTag);
    await client.query(
      `UPDATE issuances
       SET note = $2,
           updated_at = NOW()
       WHERE id = $1`,
      [issuanceId, nextNote],
    );

    await client.query('COMMIT');
    res.json({
      ok: true,
      location_system_id: slotId,
      issuance_id: issuanceId,
      restored_quantity: restoredQty,
    });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('DELETE /objects/location-systems/:id/production:', e.message);
    res.status(500).json({ error: e.message || 'Ошибка отмены выработки по блоку' });
  } finally {
    client.release();
  }
});

export default router;
