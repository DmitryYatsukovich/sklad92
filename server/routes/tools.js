import crypto from 'crypto';
import { Router } from 'express';
import pool from '../db/pool.js';
import { requireAuth, loadUser, requirePermission } from '../middleware/auth.js';

const TOOL_STATUSES = new Set(['new', 'in_use', 'in_repair', 'in_stock']);
const TOOL_ACTIONS = new Set(['create', 'update', 'issue', 'receive', 'repair', 'move']);

const TOOL_SELECT = `
  t.id,
  t.code,
  t.name,
  t.type_id,
  tt.name AS type_name,
  t.serial_number,
  t.purchase_date,
  t.warranty_date,
  t.cost,
  t.status,
  t.object_id,
  o.name AS object_name,
  t.warehouse_id,
  w.name AS warehouse_name,
  t.rack_id,
  r.name AS rack_name,
  t.holder_user_id,
  hu.display_name AS holder_display_name,
  hu.login AS holder_login,
  t.issued_by_user_id,
  ib.display_name AS issued_by_display_name,
  ib.login AS issued_by_login,
  t.issued_at,
  t.received_by_user_id,
  rb.display_name AS received_by_display_name,
  rb.login AS received_by_login,
  t.received_at,
  t.repair_by_user_id,
  pb.display_name AS repair_by_display_name,
  pb.login AS repair_by_login,
  t.repair_at,
  t.repair_description,
  t.created_at,
  t.updated_at
`;

const TOOL_JOINS = `
  FROM tools t
  LEFT JOIN tool_types tt ON tt.id = t.type_id
  LEFT JOIN warehouse_objects o ON o.id = t.object_id
  LEFT JOIN warehouses w ON w.id = t.warehouse_id
  LEFT JOIN warehouse_racks r ON r.id = t.rack_id
  LEFT JOIN users hu ON hu.id = t.holder_user_id
  LEFT JOIN users ib ON ib.id = t.issued_by_user_id
  LEFT JOIN users rb ON rb.id = t.received_by_user_id
  LEFT JOIN users pb ON pb.id = t.repair_by_user_id
`;

const router = Router();

router.use(requireAuth);
router.use(loadUser);
router.use(requirePermission('can_tools'));

function parseId(value) {
  const id = Number.parseInt(value, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function parseMoney(value) {
  if (value == null || value === '') return 0;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? Math.max(0, n) : null;
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function normalizeStatus(value, fallback = 'new') {
  const status = String(value || '').trim().toLowerCase();
  return TOOL_STATUSES.has(status) ? status : fallback;
}

function displayName(display, login) {
  return display || login || '';
}

function normalizeToolRow(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    type_id: row.type_id,
    type_name: row.type_name || '',
    serial_number: row.serial_number || '',
    purchase_date: row.purchase_date,
    warranty_date: row.warranty_date,
    cost: Number(row.cost || 0),
    status: row.status,
    object_id: row.object_id,
    object_name: row.object_name || '',
    warehouse_id: row.warehouse_id,
    warehouse_name: row.warehouse_name || '',
    rack_id: row.rack_id,
    rack_name: row.rack_name || '',
    holder_user_id: row.holder_user_id,
    holder_user_name: displayName(row.holder_display_name, row.holder_login),
    issued_by_user_id: row.issued_by_user_id,
    issued_by_user_name: displayName(row.issued_by_display_name, row.issued_by_login),
    issued_at: row.issued_at,
    received_by_user_id: row.received_by_user_id,
    received_by_user_name: displayName(row.received_by_display_name, row.received_by_login),
    received_at: row.received_at,
    repair_by_user_id: row.repair_by_user_id,
    repair_by_user_name: displayName(row.repair_by_display_name, row.repair_by_login),
    repair_at: row.repair_at,
    repair_description: row.repair_description || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function generateToolCode() {
  return `TOOL-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

async function uniqueToolCode(client) {
  for (let i = 0; i < 8; i += 1) {
    const code = generateToolCode();
    const exists = await client.query('SELECT 1 FROM tools WHERE code = $1', [code]);
    if (!exists.rows[0]) return code;
  }
  return generateToolCode();
}

async function resolveLocation(client, { objectId, warehouseId, rackId }, { allowEmpty = false } = {}) {
  const oid = parseId(objectId);
  const wid = parseId(warehouseId);
  const rid = parseId(rackId);

  if (!oid && !wid && !rid && allowEmpty) {
    return { object_id: null, warehouse_id: null, rack_id: null };
  }

  if (!oid || !wid) {
    return { error: 'Укажите объект и склад' };
  }

  const object = await client.query('SELECT id FROM warehouse_objects WHERE id = $1', [oid]);
  if (!object.rows[0]) return { error: 'Объект не найден' };

  const warehouse = await client.query('SELECT id, object_id FROM warehouses WHERE id = $1', [wid]);
  if (!warehouse.rows[0]) return { error: 'Склад не найден' };
  if (Number(warehouse.rows[0].object_id) !== oid) {
    return { error: 'Склад не относится к выбранному объекту' };
  }

  if (!rid) return { object_id: oid, warehouse_id: wid, rack_id: null };

  const rack = await client.query('SELECT id, warehouse_id FROM warehouse_racks WHERE id = $1', [rid]);
  if (!rack.rows[0]) return { error: 'Стеллаж не найден' };
  if (Number(rack.rows[0].warehouse_id) !== wid) {
    return { error: 'Стеллаж не относится к выбранному складу' };
  }
  return { object_id: oid, warehouse_id: wid, rack_id: rid };
}

async function ensureToolType(client, typeId) {
  const type = await client.query('SELECT id FROM tool_types WHERE id = $1', [typeId]);
  return !!type.rows[0];
}

async function ensureActiveUser(client, userId) {
  const user = await client.query(
    `SELECT id
     FROM users
     WHERE id = $1
       AND COALESCE(profile_active, true) = true
       AND COALESCE(employment_status, 'working') <> 'fired'`,
    [userId],
  );
  return !!user.rows[0];
}

async function readToolById(client, toolId) {
  const result = await client.query(
    `SELECT ${TOOL_SELECT}
     ${TOOL_JOINS}
     WHERE t.id = $1`,
    [toolId],
  );
  return result.rows[0] ? normalizeToolRow(result.rows[0]) : null;
}

async function addToolEvent(client, payload) {
  const action = String(payload.action || '').trim().toLowerCase();
  if (!TOOL_ACTIONS.has(action)) return;
  await client.query(
    `INSERT INTO tool_events (
       tool_id, action, from_status, to_status, performed_by_user_id, target_user_id,
       object_id, warehouse_id, rack_id, note, repair_description, created_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())`,
    [
      payload.tool_id,
      action,
      payload.from_status || null,
      payload.to_status || null,
      payload.performed_by_user_id || null,
      payload.target_user_id || null,
      payload.object_id || null,
      payload.warehouse_id || null,
      payload.rack_id || null,
      payload.note || null,
      payload.repair_description || null,
    ],
  );
}

router.get('/meta', async (_req, res) => {
  try {
    const [types, users, objects, warehouses, racks] = await Promise.all([
      pool.query('SELECT id, name FROM tool_types ORDER BY name'),
      pool.query(
        `SELECT id, login, display_name
         FROM users
         WHERE COALESCE(profile_active, true) = true
           AND COALESCE(employment_status, 'working') <> 'fired'
         ORDER BY display_name NULLS LAST, login`,
      ),
      pool.query('SELECT id, name FROM warehouse_objects ORDER BY name'),
      pool.query(
        `SELECT w.id, w.name, w.object_id, o.name AS object_name
         FROM warehouses w
         JOIN warehouse_objects o ON o.id = w.object_id
         ORDER BY o.name, w.name`,
      ),
      pool.query(
        `SELECT r.id, r.name, r.warehouse_id, w.object_id, w.name AS warehouse_name
         FROM warehouse_racks r
         JOIN warehouses w ON w.id = r.warehouse_id
         ORDER BY w.name, r.name`,
      ),
    ]);

    res.json({
      types: types.rows,
      users: users.rows.map((row) => ({
        id: row.id,
        login: row.login,
        display_name: row.display_name || row.login,
      })),
      objects: objects.rows,
      warehouses: warehouses.rows,
      racks: racks.rows,
    });
  } catch (e) {
    console.error('GET /api/tools/meta:', e);
    res.status(500).json({ error: 'Ошибка загрузки справочников инструмента' });
  }
});

router.get('/', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT ${TOOL_SELECT}
       ${TOOL_JOINS}
       ORDER BY t.updated_at DESC, t.id DESC`,
    );
    const items = result.rows.map(normalizeToolRow);
    const byType = {};
    for (const row of items) {
      const key = String(row.type_id || 0);
      if (!byType[key]) {
        byType[key] = {
          type_id: row.type_id,
          type_name: row.type_name || 'Без вида',
          count: 0,
        };
      }
      byType[key].count += 1;
    }
    res.json({
      items,
      summary_by_type: Object.values(byType).sort((a, b) => String(a.type_name).localeCompare(String(b.type_name), 'ru')),
    });
  } catch (e) {
    console.error('GET /api/tools:', e);
    res.status(500).json({ error: 'Ошибка загрузки инструмента' });
  }
});

router.get('/by-code/:code', async (req, res) => {
  const code = String(req.params.code || '').trim();
  if (!code) return res.status(400).json({ error: 'Неверный QR-код' });
  try {
    const result = await pool.query(
      `SELECT ${TOOL_SELECT}
       ${TOOL_JOINS}
       WHERE t.code = $1
       LIMIT 1`,
      [code],
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Инструмент не найден' });
    res.json(normalizeToolRow(result.rows[0]));
  } catch (e) {
    console.error('GET /api/tools/by-code/:code:', e);
    res.status(500).json({ error: 'Ошибка поиска инструмента по QR' });
  }
});

router.get('/:id/history', async (req, res) => {
  const toolId = parseId(req.params.id);
  if (!toolId) return res.status(400).json({ error: 'Неверный id инструмента' });
  try {
    const result = await pool.query(
      `SELECT e.id, e.action, e.from_status, e.to_status, e.note, e.repair_description, e.created_at,
              e.target_user_id, e.object_id, e.warehouse_id, e.rack_id,
              pu.display_name AS performed_by_display_name, pu.login AS performed_by_login,
              tu.display_name AS target_user_display_name, tu.login AS target_user_login,
              o.name AS object_name, w.name AS warehouse_name, r.name AS rack_name
       FROM tool_events e
       LEFT JOIN users pu ON pu.id = e.performed_by_user_id
       LEFT JOIN users tu ON tu.id = e.target_user_id
       LEFT JOIN warehouse_objects o ON o.id = e.object_id
       LEFT JOIN warehouses w ON w.id = e.warehouse_id
       LEFT JOIN warehouse_racks r ON r.id = e.rack_id
       WHERE e.tool_id = $1
       ORDER BY e.created_at DESC, e.id DESC`,
      [toolId],
    );
    res.json(result.rows.map((row) => ({
      id: row.id,
      action: row.action,
      from_status: row.from_status,
      to_status: row.to_status,
      note: row.note || '',
      repair_description: row.repair_description || '',
      created_at: row.created_at,
      target_user_id: row.target_user_id,
      target_user_name: displayName(row.target_user_display_name, row.target_user_login),
      performed_by_name: displayName(row.performed_by_display_name, row.performed_by_login),
      object_id: row.object_id,
      object_name: row.object_name || '',
      warehouse_id: row.warehouse_id,
      warehouse_name: row.warehouse_name || '',
      rack_id: row.rack_id,
      rack_name: row.rack_name || '',
    })));
  } catch (e) {
    console.error('GET /api/tools/:id/history:', e);
    res.status(500).json({ error: 'Ошибка загрузки истории инструмента' });
  }
});

router.post('/', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const serialNumber = String(req.body?.serial_number || '').trim();
  const typeId = parseId(req.body?.type_id);
  const purchaseDate = parseDate(req.body?.purchase_date);
  const warrantyDate = parseDate(req.body?.warranty_date);
  const cost = parseMoney(req.body?.cost);
  const status = normalizeStatus(req.body?.status, 'new');
  if (!name) return res.status(400).json({ error: 'Укажите название инструмента' });
  if (!serialNumber) return res.status(400).json({ error: 'Укажите серийный номер' });
  if (!typeId) return res.status(400).json({ error: 'Выберите вид инструмента' });
  if (cost == null) return res.status(400).json({ error: 'Некорректная стоимость' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (!(await ensureToolType(client, typeId))) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Вид инструмента не найден' });
    }
    const location = await resolveLocation(client, {
      objectId: req.body?.object_id,
      warehouseId: req.body?.warehouse_id,
      rackId: req.body?.rack_id,
    });
    if (location.error) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: location.error });
    }
    const code = await uniqueToolCode(client);
    const inserted = await client.query(
      `INSERT INTO tools (
         code, name, type_id, serial_number, purchase_date, warranty_date, cost, status,
         object_id, warehouse_id, rack_id, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, $5::date, $6::date, $7, $8, $9, $10, $11, NOW(), NOW())
       RETURNING id`,
      [
        code,
        name,
        typeId,
        serialNumber,
        purchaseDate,
        warrantyDate,
        cost,
        status,
        location.object_id,
        location.warehouse_id,
        location.rack_id,
      ],
    );
    const toolId = inserted.rows[0]?.id;
    await addToolEvent(client, {
      action: 'create',
      tool_id: toolId,
      from_status: null,
      to_status: status,
      performed_by_user_id: req.user.id,
      object_id: location.object_id,
      warehouse_id: location.warehouse_id,
      rack_id: location.rack_id,
      note: 'Создание инструмента',
    });
    const tool = await readToolById(client, toolId);
    await client.query('COMMIT');
    res.status(201).json(tool);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    if (e.code === '23505') {
      if (String(e.constraint || '').includes('serial')) {
        return res.status(400).json({ error: 'Инструмент с таким серийным номером уже существует' });
      }
      if (String(e.constraint || '').includes('code')) {
        return res.status(400).json({ error: 'Конфликт QR-кода, повторите попытку' });
      }
    }
    console.error('POST /api/tools:', e);
    res.status(500).json({ error: 'Ошибка создания инструмента' });
  } finally {
    client.release();
  }
});

router.put('/:id', async (req, res) => {
  const toolId = parseId(req.params.id);
  if (!toolId) return res.status(400).json({ error: 'Неверный id инструмента' });

  const name = String(req.body?.name || '').trim();
  const serialNumber = String(req.body?.serial_number || '').trim();
  const typeId = parseId(req.body?.type_id);
  const purchaseDate = parseDate(req.body?.purchase_date);
  const warrantyDate = parseDate(req.body?.warranty_date);
  const cost = parseMoney(req.body?.cost);
  const status = normalizeStatus(req.body?.status, '');
  if (!name) return res.status(400).json({ error: 'Укажите название инструмента' });
  if (!serialNumber) return res.status(400).json({ error: 'Укажите серийный номер' });
  if (!typeId) return res.status(400).json({ error: 'Выберите вид инструмента' });
  if (cost == null) return res.status(400).json({ error: 'Некорректная стоимость' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await readToolById(client, toolId);
    if (!current) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Инструмент не найден' });
    }
    if (!(await ensureToolType(client, typeId))) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Вид инструмента не найден' });
    }
    const location = await resolveLocation(client, {
      objectId: req.body?.object_id,
      warehouseId: req.body?.warehouse_id,
      rackId: req.body?.rack_id,
    });
    if (location.error) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: location.error });
    }
    const nextStatus = TOOL_STATUSES.has(status) ? status : current.status;
    await client.query(
      `UPDATE tools
       SET name = $1,
           type_id = $2,
           serial_number = $3,
           purchase_date = $4::date,
           warranty_date = $5::date,
           cost = $6,
           status = $7,
           object_id = $8,
           warehouse_id = $9,
           rack_id = $10,
           updated_at = NOW()
       WHERE id = $11`,
      [
        name,
        typeId,
        serialNumber,
        purchaseDate,
        warrantyDate,
        cost,
        nextStatus,
        location.object_id,
        location.warehouse_id,
        location.rack_id,
        toolId,
      ],
    );
    await addToolEvent(client, {
      action: 'update',
      tool_id: toolId,
      from_status: current.status,
      to_status: nextStatus,
      performed_by_user_id: req.user.id,
      object_id: location.object_id,
      warehouse_id: location.warehouse_id,
      rack_id: location.rack_id,
      note: 'Редактирование карточки инструмента',
    });
    const tool = await readToolById(client, toolId);
    await client.query('COMMIT');
    res.json(tool);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    if (e.code === '23505' && String(e.constraint || '').includes('serial')) {
      return res.status(400).json({ error: 'Инструмент с таким серийным номером уже существует' });
    }
    console.error('PUT /api/tools/:id:', e);
    res.status(500).json({ error: 'Ошибка сохранения инструмента' });
  } finally {
    client.release();
  }
});

router.post('/:id/action', async (req, res) => {
  const toolId = parseId(req.params.id);
  const action = String(req.body?.action || '').trim().toLowerCase();
  if (!toolId) return res.status(400).json({ error: 'Неверный id инструмента' });
  if (!TOOL_ACTIONS.has(action) || action === 'create' || action === 'update') {
    return res.status(400).json({ error: 'Неверное действие' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await readToolById(client, toolId);
    if (!current) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Инструмент не найден' });
    }

    let nextStatus = current.status;
    let targetUserId = null;
    let note = '';
    let repairDescription = '';
    let location = {
      object_id: current.object_id,
      warehouse_id: current.warehouse_id,
      rack_id: current.rack_id,
    };

    if (action === 'issue') {
      targetUserId = parseId(req.body?.target_user_id);
      if (!targetUserId) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Выберите сотрудника, которому выдаётся инструмент' });
      }
      if (!(await ensureActiveUser(client, targetUserId))) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Сотрудник не найден или неактивен' });
      }
      nextStatus = 'in_use';
      note = String(req.body?.note || '').trim();
      await client.query(
        `UPDATE tools
         SET status = 'in_use',
             holder_user_id = $1,
             issued_by_user_id = $2,
             issued_at = NOW(),
             updated_at = NOW()
         WHERE id = $3`,
        [targetUserId, req.user.id, toolId],
      );
    } else if (action === 'receive') {
      location = await resolveLocation(client, {
        objectId: req.body?.object_id,
        warehouseId: req.body?.warehouse_id,
        rackId: req.body?.rack_id,
      });
      if (location.error) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: location.error });
      }
      nextStatus = 'in_stock';
      note = String(req.body?.note || '').trim();
      await client.query(
        `UPDATE tools
         SET status = 'in_stock',
             holder_user_id = NULL,
             object_id = $1,
             warehouse_id = $2,
             rack_id = $3,
             received_by_user_id = $4,
             received_at = NOW(),
             updated_at = NOW()
         WHERE id = $5`,
        [location.object_id, location.warehouse_id, location.rack_id, req.user.id, toolId],
      );
    } else if (action === 'repair') {
      nextStatus = 'in_repair';
      repairDescription = String(req.body?.repair_description || '').trim();
      note = String(req.body?.note || '').trim();
      await client.query(
        `UPDATE tools
         SET status = 'in_repair',
             holder_user_id = NULL,
             repair_by_user_id = $1,
             repair_at = NOW(),
             repair_description = $2,
             updated_at = NOW()
         WHERE id = $3`,
        [req.user.id, repairDescription || null, toolId],
      );
    } else if (action === 'move') {
      location = await resolveLocation(client, {
        objectId: req.body?.object_id,
        warehouseId: req.body?.warehouse_id,
        rackId: req.body?.rack_id,
      });
      if (location.error) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: location.error });
      }
      nextStatus = 'in_stock';
      note = String(req.body?.note || '').trim();
      await client.query(
        `UPDATE tools
         SET status = 'in_stock',
             holder_user_id = NULL,
             object_id = $1,
             warehouse_id = $2,
             rack_id = $3,
             updated_at = NOW()
         WHERE id = $4`,
        [location.object_id, location.warehouse_id, location.rack_id, toolId],
      );
    }

    await addToolEvent(client, {
      action,
      tool_id: toolId,
      from_status: current.status,
      to_status: nextStatus,
      performed_by_user_id: req.user.id,
      target_user_id: targetUserId,
      object_id: location.object_id,
      warehouse_id: location.warehouse_id,
      rack_id: location.rack_id,
      note,
      repair_description: repairDescription,
    });

    const updated = await readToolById(client, toolId);
    await client.query('COMMIT');
    res.json(updated);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('POST /api/tools/:id/action:', e);
    res.status(500).json({ error: 'Ошибка выполнения операции с инструментом' });
  } finally {
    client.release();
  }
});

router.delete('/:id', requirePermission('can_tools_delete'), async (req, res) => {
  const toolId = parseId(req.params.id);
  if (!toolId) return res.status(400).json({ error: 'Неверный id инструмента' });
  try {
    const removed = await pool.query(
      'DELETE FROM tools WHERE id = $1 RETURNING id, name, code',
      [toolId],
    );
    if (!removed.rowCount) return res.status(404).json({ error: 'Инструмент не найден' });
    res.json({ ok: true, item: removed.rows[0] });
  } catch (e) {
    console.error('DELETE /api/tools/:id:', e);
    res.status(500).json({ error: 'Ошибка удаления инструмента' });
  }
});

export default router;
