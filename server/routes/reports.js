import { Router } from 'express';
import pool from '../db/pool.js';
import { requireAuth, loadUser, requirePermission, requireAdmin } from '../middleware/auth.js';
import { logProductionConfirmation } from '../lib/production-confirmation-log.js';
import {
  formatWorkLocationLabel,
  formatWorkLocationFromSelection,
  parseWorkLocationBody,
  workLocationItemsJson,
  WORK_LOCATION_JOIN,
  WORK_LOCATION_SELECT,
  WORK_LOCATION_JOIN_PCL,
  WORK_LOCATION_SELECT_PCL,
} from '../lib/work-location.js';

const router = Router();

function parseId(v) {
  const n = parseInt(v, 10);
  return n > 0 ? n : null;
}

async function loadWorkLocationCatalog() {
  const [objects, workEntrances, workFloors, workApartments, workRooms] = await Promise.all([
    pool.query('SELECT id, name FROM warehouse_objects ORDER BY name'),
    pool.query(
      `SELECT e.id, e.name, e.object_id, o.name AS object_name
       FROM work_entrances e
       LEFT JOIN warehouse_objects o ON o.id = e.object_id
       ORDER BY o.name NULLS LAST, e.name`,
    ),
    pool.query(
      `SELECT f.id, f.name, f.entrance_id, e.name AS entrance_name, e.object_id, o.name AS object_name
       FROM work_floors f
       JOIN work_entrances e ON e.id = f.entrance_id
       LEFT JOIN warehouse_objects o ON o.id = e.object_id
       ORDER BY o.name NULLS LAST, e.name, f.name`,
    ),
    pool.query(
      `SELECT a.id, a.name, a.floor_id, f.name AS floor_name, f.entrance_id,
              e.name AS entrance_name, e.object_id, o.name AS object_name
       FROM work_apartments a
       JOIN work_floors f ON f.id = a.floor_id
       JOIN work_entrances e ON e.id = f.entrance_id
       LEFT JOIN warehouse_objects o ON o.id = e.object_id
       ORDER BY o.name NULLS LAST, e.name, f.name, a.name`,
    ),
    pool.query(
      `SELECT r.id, r.name, r.apartment_id, a.name AS apartment_name,
              a.floor_id, f.name AS floor_name, f.entrance_id, e.name AS entrance_name,
              e.object_id, o.name AS object_name
       FROM work_rooms r
       JOIN work_apartments a ON a.id = r.apartment_id
       JOIN work_floors f ON f.id = a.floor_id
       JOIN work_entrances e ON e.id = f.entrance_id
       LEFT JOIN warehouse_objects o ON o.id = e.object_id
       ORDER BY o.name NULLS LAST, e.name, f.name, a.name, r.name`,
    ),
  ]);
  return {
    objects: objects.rows,
    work_entrances: workEntrances.rows,
    work_floors: workFloors.rows,
    work_apartments: workApartments.rows,
    work_rooms: workRooms.rows,
  };
}

router.use(requireAuth);
router.use(loadUser);
router.use(requirePermission('can_production'));

const PRODUCTION_SELECT = `
  SELECT i.id AS issuance_id,
         i.issued_at,
         i.production_confirmed,
         i.production_confirmed_at,
         u.id AS user_id,
         u.login,
         u.display_name,
         u.first_name,
         u.last_name,
         m.id AS material_id,
         m.name AS material_name,
         m.unit,
         COALESCE(m.production_price, 0) AS production_price,
         i.quantity AS total_issued,
         COALESCE(i.returned_quantity, 0) AS total_returned,
         GREATEST(i.quantity - COALESCE(i.returned_quantity, 0), 0) AS produced,
         ${WORK_LOCATION_SELECT}
  FROM issuances i
  JOIN users u ON u.id = i.issued_to_user_id
  JOIN materials m ON m.id = i.material_id
  ${WORK_LOCATION_JOIN}
`;

// История изменений выработки по пользователю и материалу
router.get('/production/history', async (req, res) => {
  const userId = parseInt(req.query.user_id, 10);
  const materialId = parseInt(req.query.material_id, 10);
  const issuanceId = parseInt(req.query.issuance_id, 10);
  const from = req.query.from || null;
  const to = req.query.to || null;

  if (!userId || !materialId) {
    return res.status(400).json({ error: 'Укажите user_id и material_id' });
  }

  const sessionUserId = Number(req.session.userId);
  const isAdmin = req.user.role === 'admin';
  if (!isAdmin && userId !== sessionUserId) {
    return res.status(403).json({ error: 'Нет доступа к выработке другого пользователя' });
  }

  const params = [userId, materialId];
  let dateFilter = '';
  let issuanceFilter = '';
  if (issuanceId) {
    params.push(issuanceId);
    issuanceFilter = ` AND i.id = $${params.length}`;
  }
  if (from) {
    params.push(from);
    dateFilter += ` AND i.issued_at::date >= $${params.length}::date`;
  }
  if (to) {
    params.push(to);
    dateFilter += ` AND i.issued_at::date <= $${params.length}::date`;
  }

  const meta = await pool.query(
    `SELECT u.id AS user_id, u.login, u.display_name, u.first_name, u.last_name,
            m.id AS material_id, m.name AS material_name, m.unit,
            COALESCE(m.production_price, 0) AS production_price
     FROM users u, materials m
     WHERE u.id = $1 AND m.id = $2`,
    [userId, materialId],
  );
  if (!meta.rows[0]) return res.status(404).json({ error: 'Пользователь или материал не найден' });

  const iss = await pool.query(
    `SELECT i.id, i.issued_at, i.quantity, i.returned_quantity,
            i.production_confirmed, i.production_confirmed_at,
            conf.login AS confirmed_by_login,
            conf.display_name AS confirmed_by_name
     FROM issuances i
     LEFT JOIN users conf ON conf.id = i.production_confirmed_by
     WHERE i.issued_to_user_id = $1 AND i.material_id = $2${issuanceFilter}${dateFilter}
     ORDER BY i.issued_at ASC`,
    params,
  );

  if (issuanceId && !iss.rows.length) {
    return res.status(404).json({ error: 'Выдача не найдена' });
  }

  const issuanceIds = iss.rows.map((r) => r.id);
  const issuanceById = new Map(iss.rows.map((i) => [i.id, i]));

  let logRows = [];
  let confirmLogRows = [];
  if (issuanceIds.length) {
    const [log, confirmLog] = await Promise.all([
      pool.query(
        `SELECT l.id, l.kind, l.delta, l.note, l.created_at, l.issuance_id,
                u.login AS user_login, u.display_name AS user_name
         FROM material_quantity_log l
         LEFT JOIN users u ON u.id = l.user_id
         WHERE l.issuance_id = ANY($1::int[])
         ORDER BY l.created_at ASC`,
        [issuanceIds],
      ),
      pool.query(
        `SELECT pcl.id, pcl.issuance_id, pcl.confirmed, pcl.event_type, pcl.created_at,
                u.login AS user_login, u.display_name AS user_name,
                ${WORK_LOCATION_SELECT_PCL}
         FROM production_confirmation_log pcl
         LEFT JOIN users u ON u.id = pcl.created_by
         ${WORK_LOCATION_JOIN_PCL}
         WHERE pcl.issuance_id = ANY($1::int[])
         ORDER BY pcl.created_at ASC`,
        [issuanceIds],
      ),
    ]);
    logRows = log.rows;
    confirmLogRows = confirmLog.rows;
  }

  const unitSmr = parseFloat(meta.rows[0].production_price) || 0;
  const entries = [];

  for (const i of iss.rows) {
    const issued = parseFloat(i.quantity) || 0;
    const returned = parseFloat(i.returned_quantity) || 0;
    const produced = Math.max(issued - returned, 0);

    entries.push({
      id: `issue-${i.id}`,
      at: i.issued_at,
      kind: 'issue',
      label: 'Выдача',
      issued,
      returned: 0,
      produced,
      smr_total: produced * unitSmr,
      issuance_id: i.id,
      note: null,
    });
  }

  const confirmLoggedIssuanceIds = new Set(confirmLogRows.map((r) => r.issuance_id));
  const historyCatalog = await loadWorkLocationCatalog();

  for (const c of confirmLogRows) {
    const i = issuanceById.get(c.issuance_id);
    if (!i) continue;
    const issued = parseFloat(i.quantity) || 0;
    const returned = parseFloat(i.returned_quantity) || 0;
    const produced = Math.max(issued - returned, 0);
    let locItems = c.work_location_items || {};
    if (typeof locItems === 'string') {
      try {
        locItems = JSON.parse(locItems);
      } catch {
        locItems = {};
      }
    }
    const eventType = c.event_type || (c.confirmed ? 'confirm' : 'unconfirm');
    const locLabel = (eventType === 'confirm' || eventType === 'location')
      ? formatWorkLocationFromSelection(historyCatalog, c.work_object_id, locItems)
      || formatWorkLocationLabel(c, historyCatalog)
      : '';
    const who = [c.user_name, c.user_login].filter(Boolean).join(' ');
    const eventMeta = {
      confirm: { kind: 'confirm', label: 'Подтверждено' },
      unconfirm: { kind: 'unconfirm', label: 'Снято подтверждение' },
      location: { kind: 'location', label: 'Место работ указано' },
    }[eventType] || { kind: 'unconfirm', label: 'Снято подтверждение' };
    entries.push({
      id: `pcl-${c.id}`,
      at: c.created_at,
      kind: eventMeta.kind,
      label: eventMeta.label,
      issued: null,
      returned: null,
      produced,
      smr_total: produced * unitSmr,
      issuance_id: c.issuance_id,
      note: [locLabel, who].filter(Boolean).join(' · ') || null,
    });
  }

  for (const i of iss.rows) {
    if (confirmLoggedIssuanceIds.has(i.id) || !i.production_confirmed_at) continue;
    const issued = parseFloat(i.quantity) || 0;
    const returned = parseFloat(i.returned_quantity) || 0;
    const produced = Math.max(issued - returned, 0);
    entries.push({
      id: `confirm-legacy-${i.id}`,
      at: i.production_confirmed_at,
      kind: i.production_confirmed ? 'confirm' : 'unconfirm',
      label: i.production_confirmed ? 'Подтверждено' : 'Снято подтверждение',
      issued: null,
      returned: null,
      produced,
      smr_total: produced * unitSmr,
      issuance_id: i.id,
      note: [i.confirmed_by_name, i.confirmed_by_login].filter(Boolean).join(' ') || null,
    });
  }

  const KIND_LABELS = {
    issue: 'Выдача на склад (лог)',
    return: 'Возврат на склад',
    return_adjust: 'Изменение возврата',
  };

  for (const l of logRows) {
    if (l.kind === 'issue') continue;
    const delta = parseFloat(l.delta) || 0;
    entries.push({
      id: `log-${l.id}`,
      at: l.created_at,
      kind: l.kind,
      label: KIND_LABELS[l.kind] || l.kind,
      issued: null,
      returned: Math.abs(delta),
      produced: null,
      smr_total: null,
      issuance_id: l.issuance_id,
      note: l.note || [l.user_name, l.user_login].filter(Boolean).join(' ') || null,
    });
  }

  entries.sort((a, b) => new Date(a.at) - new Date(b.at));

  const currentProduced = iss.rows.reduce((s, i) => {
    const issued = parseFloat(i.quantity) || 0;
    const returned = parseFloat(i.returned_quantity) || 0;
    return s + Math.max(issued - returned, 0);
  }, 0);

  res.json({
    ...meta.rows[0],
    production_price: unitSmr,
    current_produced: currentProduced,
    current_smr_total: currentProduced * unitSmr,
    entries: entries.reverse(),
  });
});

// Выработка по выдачам за период (пользователь — только свои; админ — все)
router.get('/production', async (req, res) => {
  const from = req.query.from || '';
  const to = req.query.to || '';
  if (!from || !to) {
    return res.status(400).json({ error: 'Укажите период: from и to (YYYY-MM-DD)' });
  }

  const isAdmin = req.user.role === 'admin';
  const params = [from, to];
  let where = `WHERE i.issued_at::date >= $1::date AND i.issued_at::date <= $2::date`;

  if (!isAdmin) {
    params.push(req.session.userId);
    where += ` AND i.issued_to_user_id = $${params.length}`;
  }

  let r;
  try {
    r = await pool.query(
      `${PRODUCTION_SELECT}
       ${where}
       ORDER BY i.issued_at DESC, u.login, m.name`,
      params,
    );
  } catch (e) {
    console.error('GET /reports/production:', e.message);
    if (e.code === '42703') {
      return res.status(500).json({
        error: 'Нужна миграция БД. Перезапустите сервер или выполните: node server/db/migrate-production-confirmed.js',
      });
    }
    return res.status(500).json({ error: e.message || 'Ошибка загрузки выработки' });
  }

  const catalog = await loadWorkLocationCatalog();
  const rows = r.rows.map((row) => {
    const produced = parseFloat(row.produced) || 0;
    const unitSmr = parseFloat(row.production_price) || 0;
    return {
      ...row,
      production_price: unitSmr,
      produced,
      smr_total: produced * unitSmr,
      production_confirmed: !!row.production_confirmed,
      work_location_label: formatWorkLocationLabel(row, catalog),
    };
  });

  res.json(rows);
});

router.get('/production/locations', async (_req, res) => {
  try {
    res.json(await loadWorkLocationCatalog());
  } catch (e) {
    console.error('GET /production/locations:', e.message);
    res.status(500).json({ error: 'Ошибка загрузки мест проведения работ' });
  }
});

router.post('/production/locations/entrances', async (req, res) => {
  const object_id = parseId(req.body?.object_id);
  const name = (req.body?.name || '').trim();
  if (!object_id || !name) return res.status(400).json({ error: 'Укажите объект и название подъезда' });
  try {
    const r = await pool.query(
      `INSERT INTO work_entrances (object_id, name) VALUES ($1, $2)
       RETURNING id, object_id, name`,
      [object_id, name],
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Такой подъезд уже есть на этом объекте' });
    if (e.code === '23503') return res.status(400).json({ error: 'Объект не найден' });
    throw e;
  }
});

router.post('/production/locations/floors', async (req, res) => {
  const entrance_id = parseId(req.body?.entrance_id);
  const name = (req.body?.name || '').trim();
  if (!entrance_id || !name) return res.status(400).json({ error: 'Укажите подъезд и название этажа' });
  try {
    const r = await pool.query(
      `INSERT INTO work_floors (entrance_id, name) VALUES ($1, $2)
       RETURNING id, entrance_id, name`,
      [entrance_id, name],
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Такой этаж уже есть в этом подъезде' });
    throw e;
  }
});

router.post('/production/locations/apartments', async (req, res) => {
  const floor_id = parseId(req.body?.floor_id);
  const name = (req.body?.name || '').trim();
  if (!floor_id || !name) return res.status(400).json({ error: 'Укажите этаж и название квартиры' });
  try {
    const r = await pool.query(
      `INSERT INTO work_apartments (floor_id, name) VALUES ($1, $2)
       RETURNING id, floor_id, name`,
      [floor_id, name],
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Такая квартира уже есть на этом этаже' });
    throw e;
  }
});

router.post('/production/locations/rooms', async (req, res) => {
  const apartment_id = parseId(req.body?.apartment_id);
  const name = (req.body?.name || '').trim();
  if (!apartment_id || !name) return res.status(400).json({ error: 'Укажите квартиру и название помещения' });
  try {
    const r = await pool.query(
      `INSERT INTO work_rooms (apartment_id, name) VALUES ($1, $2)
       RETURNING id, apartment_id, name`,
      [apartment_id, name],
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Такое помещение уже есть в этой квартире' });
    throw e;
  }
});

async function updateIssuanceWorkLocation(db, id, loc) {
  return db.query(
    `UPDATE issuances SET
       work_object_id = $2,
       work_location_items = $3::jsonb,
       work_room_id = NULL,
       work_apartment_id = NULL,
       work_floor_id = NULL,
       work_entrance_id = NULL
     WHERE id = $1`,
    [id, loc.object_id, workLocationItemsJson(loc)],
  );
}

async function fetchWorkLocationLabel(id) {
  const locRow = await pool.query(
    `SELECT ${WORK_LOCATION_SELECT}
     FROM issuances i ${WORK_LOCATION_JOIN} WHERE i.id = $1`,
    [id],
  );
  const catalog = await loadWorkLocationCatalog();
  return formatWorkLocationLabel(locRow.rows[0], catalog);
}

router.patch('/production/issuances/:id/location', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const loc = parseWorkLocationBody(req.body);
  if (!id) return res.status(400).json({ error: 'Неверный id' });
  if (!loc) {
    return res.status(400).json({ error: 'Выберите объект' });
  }

  const locErr = await validateWorkLocation(loc);
  if (locErr) return res.status(400).json({ error: locErr });

  const cur = await pool.query(
    'SELECT id, issued_to_user_id, production_confirmed FROM issuances WHERE id = $1',
    [id],
  );
  if (!cur.rowCount) return res.status(404).json({ error: 'Выдача не найдена' });

  const isAdmin = req.user.role === 'admin';
  if (!isAdmin && Number(cur.rows[0].issued_to_user_id) !== Number(req.session.userId)) {
    return res.status(403).json({ error: 'Нет доступа к чужой выдаче' });
  }
  if (cur.rows[0].production_confirmed) {
    return res.status(400).json({ error: 'Выработка уже подтверждена — место изменить нельзя' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await updateIssuanceWorkLocation(client, id, loc);
    await logProductionConfirmation(client, {
      issuanceId: id,
      eventType: 'location',
      userId: req.session.userId,
      workObjectId: loc.object_id,
      workLocationItems: workLocationItemsJson(loc),
    });
    await client.query('COMMIT');
    const catalog = await loadWorkLocationCatalog();
    res.json({
      work_location_label: formatWorkLocationFromSelection(catalog, loc.object_id, loc),
    });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('PATCH production location:', e.message);
    res.status(500).json({ error: e.message || 'Ошибка сохранения места' });
  } finally {
    client.release();
  }
});

async function validateWorkLocation(loc) {
  const obj = await pool.query('SELECT id FROM warehouse_objects WHERE id = $1', [loc.object_id]);
  if (!obj.rowCount) return 'Объект не найден';

  for (const eid of loc.entrance_ids) {
    const r = await pool.query(
      'SELECT id FROM work_entrances WHERE id = $1 AND object_id = $2',
      [eid, loc.object_id],
    );
    if (!r.rowCount) return 'Подъезд не найден или не относится к объекту';
  }
  for (const fid of loc.floor_ids) {
    const r = await pool.query(
      `SELECT f.id FROM work_floors f
       JOIN work_entrances e ON e.id = f.entrance_id
       WHERE f.id = $1 AND e.object_id = $2`,
      [fid, loc.object_id],
    );
    if (!r.rowCount) return 'Этаж не найден или не относится к объекту';
  }
  for (const aid of loc.apartment_ids) {
    const r = await pool.query(
      `SELECT a.id FROM work_apartments a
       JOIN work_floors f ON f.id = a.floor_id
       JOIN work_entrances e ON e.id = f.entrance_id
       WHERE a.id = $1 AND e.object_id = $2`,
      [aid, loc.object_id],
    );
    if (!r.rowCount) return 'Квартира не найдена или не относится к объекту';
  }
  for (const rid of loc.room_ids) {
    const r = await pool.query(
      `SELECT r.id FROM work_rooms r
       JOIN work_apartments a ON a.id = r.apartment_id
       JOIN work_floors f ON f.id = a.floor_id
       JOIN work_entrances e ON e.id = f.entrance_id
       WHERE r.id = $1 AND e.object_id = $2`,
      [rid, loc.object_id],
    );
    if (!r.rowCount) return 'Помещение не найдено или не относится к объекту';
  }
  return null;
}

router.patch('/production/issuances/:id/confirm', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const loc = parseWorkLocationBody(req.body);
  if (!id) return res.status(400).json({ error: 'Неверный id' });
  if (!loc) {
    return res.status(400).json({ error: 'Выберите объект' });
  }

  const locErr = await validateWorkLocation(loc);
  if (locErr) return res.status(400).json({ error: locErr });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await updateIssuanceWorkLocation(client, id, loc);
    const r = await client.query(
      `UPDATE issuances SET
         production_confirmed = true,
         production_confirmed_at = NOW(),
         production_confirmed_by = $2
       WHERE id = $1
       RETURNING id, production_confirmed, production_confirmed_at`,
      [id, req.session.userId],
    );
    if (!r.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Выдача не найдена' });
    }
    await logProductionConfirmation(client, {
      issuanceId: id,
      eventType: 'confirm',
      userId: req.session.userId,
      workObjectId: loc.object_id,
      workLocationItems: workLocationItemsJson(loc),
    });
    await client.query('COMMIT');
    const catalog = await loadWorkLocationCatalog();
    res.json({
      ...r.rows[0],
      work_location_label: formatWorkLocationFromSelection(catalog, loc.object_id, loc),
    });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('PATCH confirm production:', e.message);
    res.status(500).json({ error: e.message || 'Ошибка подтверждения' });
  } finally {
    client.release();
  }
});

router.patch('/production/issuances/:id/unconfirm', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Неверный id' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `UPDATE issuances SET
         production_confirmed = false,
         production_confirmed_at = NOW(),
         production_confirmed_by = $2,
         work_object_id = NULL,
         work_location_items = NULL,
         work_room_id = NULL,
         work_apartment_id = NULL,
         work_floor_id = NULL,
         work_entrance_id = NULL
       WHERE id = $1
       RETURNING id, production_confirmed, production_confirmed_at`,
      [id, req.session.userId],
    );
    if (!r.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Выдача не найдена' });
    }
    await logProductionConfirmation(client, {
      issuanceId: id,
      eventType: 'unconfirm',
      userId: req.session.userId,
      workObjectId: null,
      workLocationItems: null,
    });
    await client.query('COMMIT');
    res.json(r.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('PATCH unconfirm production:', e.message);
    res.status(500).json({ error: e.message || 'Ошибка снятия подтверждения' });
  } finally {
    client.release();
  }
});

export default router;
