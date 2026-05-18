import { Router } from 'express';
import pool from '../db/pool.js';
import { requireAuth, loadUser, requirePermission, requireAnyPermission } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);
router.use(loadUser);

function parseId(v) {
  const n = parseInt(v, 10);
  return n > 0 ? n : null;
}

/** Все справочники для форм склада */
router.get('/catalog', requireAnyPermission('can_warehouse', 'can_settings'), async (_req, res) => {
  try {
    const [
      objects, warehouses, racks, categories,
      workEntrances, workFloors, workApartments, workRooms,
    ] = await Promise.all([
      pool.query('SELECT id, name FROM warehouse_objects ORDER BY name'),
      pool.query(
        `SELECT w.id, w.name, w.object_id, o.name AS object_name
         FROM warehouses w JOIN warehouse_objects o ON o.id = w.object_id ORDER BY o.name, w.name`
      ),
      pool.query(
        `SELECT r.id, r.name, r.warehouse_id, w.name AS warehouse_name, w.object_id
         FROM warehouse_racks r JOIN warehouses w ON w.id = r.warehouse_id ORDER BY w.name, r.name`
      ),
      pool.query('SELECT id, name FROM material_categories ORDER BY name'),
      pool.query(
        `SELECT e.id, e.name, e.object_id, o.name AS object_name
         FROM work_entrances e
         LEFT JOIN warehouse_objects o ON o.id = e.object_id
         ORDER BY o.name NULLS LAST, e.name`
      ),
      pool.query(
        `SELECT f.id, f.name, f.entrance_id, e.name AS entrance_name, e.object_id, o.name AS object_name
         FROM work_floors f
         JOIN work_entrances e ON e.id = f.entrance_id
         LEFT JOIN warehouse_objects o ON o.id = e.object_id
         ORDER BY o.name NULLS LAST, e.name, f.name`
      ),
      pool.query(
        `SELECT a.id, a.name, a.floor_id, f.name AS floor_name, f.entrance_id,
                e.name AS entrance_name, e.object_id, o.name AS object_name
         FROM work_apartments a
         JOIN work_floors f ON f.id = a.floor_id
         JOIN work_entrances e ON e.id = f.entrance_id
         LEFT JOIN warehouse_objects o ON o.id = e.object_id
         ORDER BY o.name NULLS LAST, e.name, f.name, a.name`
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
         ORDER BY o.name NULLS LAST, e.name, f.name, a.name, r.name`
      ),
    ]);
    res.json({
      objects: objects.rows,
      warehouses: warehouses.rows,
      racks: racks.rows,
      categories: categories.rows,
      work_entrances: workEntrances.rows,
      work_floors: workFloors.rows,
      work_apartments: workApartments.rows,
      work_rooms: workRooms.rows,
    });
  } catch (e) {
    console.error('GET /settings/catalog:', e.message);
    res.status(500).json({ error: 'Ошибка загрузки справочников' });
  }
});

router.use(requirePermission('can_settings'));

// ——— Объекты ———
router.get('/objects', async (_req, res) => {
  const r = await pool.query('SELECT id, name, created_at FROM warehouse_objects ORDER BY name');
  res.json(r.rows);
});

router.post('/objects', async (req, res) => {
  const name = (req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Укажите название объекта' });
  try {
    const r = await pool.query(
      'INSERT INTO warehouse_objects (name) VALUES ($1) RETURNING id, name, created_at',
      [name]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Такой объект уже есть' });
    throw e;
  }
});

router.put('/objects/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const name = (req.body?.name || '').trim();
  if (!id || !name) return res.status(400).json({ error: 'Неверные данные' });
  try {
    const r = await pool.query(
      'UPDATE warehouse_objects SET name = $1 WHERE id = $2 RETURNING id, name, created_at',
      [name, id]
    );
    if (!r.rowCount) return res.status(404).json({ error: 'Не найдено' });
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Такое название уже есть' });
    throw e;
  }
});

router.delete('/objects/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Неверный id' });
  const used = await pool.query('SELECT 1 FROM materials WHERE object_id = $1 LIMIT 1', [id]);
  if (used.rowCount) return res.status(400).json({ error: 'Объект используется в материалах' });
  const usedEntrances = await pool.query('SELECT 1 FROM work_entrances WHERE object_id = $1 LIMIT 1', [id]);
  if (usedEntrances.rowCount) return res.status(400).json({ error: 'Объект используется в подъездах' });
  const r = await pool.query('DELETE FROM warehouse_objects WHERE id = $1 RETURNING id', [id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Не найдено' });
  res.json({ ok: true });
});

// ——— Склады ———
router.get('/warehouses', async (req, res) => {
  const objectId = parseId(req.query.object_id);
  const params = [];
  let where = '';
  if (objectId) {
    where = 'WHERE w.object_id = $1';
    params.push(objectId);
  }
  const r = await pool.query(
    `SELECT w.id, w.name, w.object_id, o.name AS object_name, w.created_at
     FROM warehouses w JOIN warehouse_objects o ON o.id = w.object_id
     ${where} ORDER BY o.name, w.name`,
    params
  );
  res.json(r.rows);
});

router.post('/warehouses', async (req, res) => {
  const object_id = parseId(req.body?.object_id);
  const name = (req.body?.name || '').trim();
  if (!object_id || !name) return res.status(400).json({ error: 'Укажите объект и название склада' });
  try {
    const r = await pool.query(
      `INSERT INTO warehouses (object_id, name) VALUES ($1, $2)
       RETURNING id, object_id, name, created_at`,
      [object_id, name]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Такой склад уже есть на этом объекте' });
    if (e.code === '23503') return res.status(400).json({ error: 'Объект не найден' });
    throw e;
  }
});

router.put('/warehouses/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const object_id = req.body?.object_id != null ? parseId(req.body.object_id) : undefined;
  const name = req.body?.name != null ? (req.body.name || '').trim() : undefined;
  if (!id) return res.status(400).json({ error: 'Неверный id' });
  const cur = (await pool.query('SELECT object_id, name FROM warehouses WHERE id = $1', [id])).rows[0];
  if (!cur) return res.status(404).json({ error: 'Не найдено' });
  const oid = object_id ?? cur.object_id;
  const nm = name ?? cur.name;
  if (!nm) return res.status(400).json({ error: 'Укажите название' });
  try {
    const r = await pool.query(
      'UPDATE warehouses SET object_id = $1, name = $2 WHERE id = $3 RETURNING id, object_id, name, created_at',
      [oid, nm, id]
    );
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Такой склад уже есть на объекте' });
    throw e;
  }
});

router.delete('/warehouses/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Неверный id' });
  const used = await pool.query('SELECT 1 FROM materials WHERE warehouse_id = $1 LIMIT 1', [id]);
  if (used.rowCount) return res.status(400).json({ error: 'Склад используется в материалах' });
  const r = await pool.query('DELETE FROM warehouses WHERE id = $1 RETURNING id', [id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Не найдено' });
  res.json({ ok: true });
});

// ——— Стеллажи ———
router.get('/racks', async (req, res) => {
  const warehouseId = parseId(req.query.warehouse_id);
  const params = [];
  let where = '';
  if (warehouseId) {
    where = 'WHERE r.warehouse_id = $1';
    params.push(warehouseId);
  }
  const r = await pool.query(
    `SELECT r.id, r.name, r.warehouse_id, w.name AS warehouse_name, w.object_id, r.created_at
     FROM warehouse_racks r JOIN warehouses w ON w.id = r.warehouse_id
     ${where} ORDER BY w.name, r.name`,
    params
  );
  res.json(r.rows);
});

router.post('/racks', async (req, res) => {
  const warehouse_id = parseId(req.body?.warehouse_id);
  const name = (req.body?.name || '').trim();
  if (!warehouse_id || !name) return res.status(400).json({ error: 'Укажите склад и название стеллажа' });
  try {
    const r = await pool.query(
      `INSERT INTO warehouse_racks (warehouse_id, name) VALUES ($1, $2)
       RETURNING id, warehouse_id, name, created_at`,
      [warehouse_id, name]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Такой стеллаж уже есть на этом складе' });
    if (e.code === '23503') return res.status(400).json({ error: 'Склад не найден' });
    throw e;
  }
});

router.put('/racks/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const warehouse_id = req.body?.warehouse_id != null ? parseId(req.body.warehouse_id) : undefined;
  const name = req.body?.name != null ? (req.body.name || '').trim() : undefined;
  if (!id) return res.status(400).json({ error: 'Неверный id' });
  const cur = (await pool.query('SELECT warehouse_id, name FROM warehouse_racks WHERE id = $1', [id])).rows[0];
  if (!cur) return res.status(404).json({ error: 'Не найдено' });
  const wid = warehouse_id ?? cur.warehouse_id;
  const nm = name ?? cur.name;
  if (!nm) return res.status(400).json({ error: 'Укажите название' });
  try {
    const r = await pool.query(
      'UPDATE warehouse_racks SET warehouse_id = $1, name = $2 WHERE id = $3 RETURNING id, warehouse_id, name, created_at',
      [wid, nm, id]
    );
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Такой стеллаж уже есть на складе' });
    throw e;
  }
});

router.delete('/racks/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Неверный id' });
  const used = await pool.query('SELECT 1 FROM materials WHERE rack_id = $1 LIMIT 1', [id]);
  if (used.rowCount) return res.status(400).json({ error: 'Стеллаж используется в материалах' });
  const r = await pool.query('DELETE FROM warehouse_racks WHERE id = $1 RETURNING id', [id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Не найдено' });
  res.json({ ok: true });
});

// ——— Категории ———
router.get('/categories', async (_req, res) => {
  const r = await pool.query('SELECT id, name, created_at FROM material_categories ORDER BY name');
  res.json(r.rows);
});

router.post('/categories', async (req, res) => {
  const name = (req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Укажите название категории' });
  try {
    const r = await pool.query(
      'INSERT INTO material_categories (name) VALUES ($1) RETURNING id, name, created_at',
      [name]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Такая категория уже есть' });
    throw e;
  }
});

router.put('/categories/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const name = (req.body?.name || '').trim();
  if (!id || !name) return res.status(400).json({ error: 'Неверные данные' });
  try {
    const r = await pool.query(
      'UPDATE material_categories SET name = $1 WHERE id = $2 RETURNING id, name, created_at',
      [name, id]
    );
    if (!r.rowCount) return res.status(404).json({ error: 'Не найдено' });
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Такое название уже есть' });
    throw e;
  }
});

router.delete('/categories/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Неверный id' });
  const used = await pool.query('SELECT 1 FROM materials WHERE category_id = $1 LIMIT 1', [id]);
  if (used.rowCount) return res.status(400).json({ error: 'Категория используется в материалах' });
  const r = await pool.query('DELETE FROM material_categories WHERE id = $1 RETURNING id', [id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Не найдено' });
  res.json({ ok: true });
});

// ——— Место проведения работ: подъезды ———
router.get('/work-entrances', async (req, res) => {
  const objectId = parseId(req.query.object_id);
  const params = [];
  let where = '';
  if (objectId) {
    where = 'WHERE e.object_id = $1';
    params.push(objectId);
  }
  const r = await pool.query(
    `SELECT e.id, e.name, e.object_id, o.name AS object_name, e.created_at
     FROM work_entrances e
     LEFT JOIN warehouse_objects o ON o.id = e.object_id
     ${where} ORDER BY o.name NULLS LAST, e.name`,
    params,
  );
  res.json(r.rows);
});

router.post('/work-entrances', async (req, res) => {
  const object_id = parseId(req.body?.object_id);
  const name = (req.body?.name || '').trim();
  if (!object_id || !name) return res.status(400).json({ error: 'Укажите объект и название подъезда' });
  try {
    const r = await pool.query(
      `INSERT INTO work_entrances (object_id, name) VALUES ($1, $2)
       RETURNING id, object_id, name, created_at`,
      [object_id, name],
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Такой подъезд уже есть на этом объекте' });
    if (e.code === '23503') return res.status(400).json({ error: 'Объект не найден' });
    throw e;
  }
});

router.put('/work-entrances/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const object_id = req.body?.object_id != null ? parseId(req.body.object_id) : undefined;
  const name = req.body?.name != null ? (req.body.name || '').trim() : undefined;
  if (!id) return res.status(400).json({ error: 'Неверный id' });
  const cur = (await pool.query('SELECT object_id, name FROM work_entrances WHERE id = $1', [id])).rows[0];
  if (!cur) return res.status(404).json({ error: 'Не найдено' });
  const oid = object_id ?? cur.object_id;
  const nm = name ?? cur.name;
  if (!oid || !nm) return res.status(400).json({ error: 'Укажите объект и название' });
  try {
    const r = await pool.query(
      'UPDATE work_entrances SET object_id = $1, name = $2 WHERE id = $3 RETURNING id, object_id, name, created_at',
      [oid, nm, id],
    );
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Такой подъезд уже есть на объекте' });
    throw e;
  }
});

router.delete('/work-entrances/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Неверный id' });
  const used = await pool.query('SELECT 1 FROM work_floors WHERE entrance_id = $1 LIMIT 1', [id]);
  if (used.rowCount) return res.status(400).json({ error: 'В подъезде есть этажи — сначала удалите их' });
  const r = await pool.query('DELETE FROM work_entrances WHERE id = $1 RETURNING id', [id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Не найдено' });
  res.json({ ok: true });
});

// ——— Этажи ———
router.get('/work-floors', async (req, res) => {
  const entranceId = parseId(req.query.entrance_id);
  const params = [];
  let where = '';
  if (entranceId) {
    where = 'WHERE f.entrance_id = $1';
    params.push(entranceId);
  }
  const r = await pool.query(
    `SELECT f.id, f.name, f.entrance_id, e.name AS entrance_name, f.created_at
     FROM work_floors f JOIN work_entrances e ON e.id = f.entrance_id
     ${where} ORDER BY e.name, f.name`,
    params,
  );
  res.json(r.rows);
});

router.post('/work-floors', async (req, res) => {
  const entrance_id = parseId(req.body?.entrance_id);
  const name = (req.body?.name || '').trim();
  if (!entrance_id || !name) return res.status(400).json({ error: 'Укажите подъезд и название этажа' });
  try {
    const r = await pool.query(
      `INSERT INTO work_floors (entrance_id, name) VALUES ($1, $2)
       RETURNING id, entrance_id, name, created_at`,
      [entrance_id, name],
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Такой этаж уже есть в этом подъезде' });
    if (e.code === '23503') return res.status(400).json({ error: 'Подъезд не найден' });
    throw e;
  }
});

router.put('/work-floors/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const entrance_id = req.body?.entrance_id != null ? parseId(req.body.entrance_id) : undefined;
  const name = req.body?.name != null ? (req.body.name || '').trim() : undefined;
  if (!id) return res.status(400).json({ error: 'Неверный id' });
  const cur = (await pool.query('SELECT entrance_id, name FROM work_floors WHERE id = $1', [id])).rows[0];
  if (!cur) return res.status(404).json({ error: 'Не найдено' });
  const eid = entrance_id ?? cur.entrance_id;
  const nm = name ?? cur.name;
  if (!nm) return res.status(400).json({ error: 'Укажите название' });
  try {
    const r = await pool.query(
      'UPDATE work_floors SET entrance_id = $1, name = $2 WHERE id = $3 RETURNING id, entrance_id, name, created_at',
      [eid, nm, id],
    );
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Такой этаж уже есть в подъезде' });
    throw e;
  }
});

router.delete('/work-floors/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Неверный id' });
  const used = await pool.query('SELECT 1 FROM work_apartments WHERE floor_id = $1 LIMIT 1', [id]);
  if (used.rowCount) return res.status(400).json({ error: 'На этаже есть квартиры — сначала удалите их' });
  const r = await pool.query('DELETE FROM work_floors WHERE id = $1 RETURNING id', [id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Не найдено' });
  res.json({ ok: true });
});

// ——— Квартиры ———
router.get('/work-apartments', async (req, res) => {
  const floorId = parseId(req.query.floor_id);
  const params = [];
  let where = '';
  if (floorId) {
    where = 'WHERE a.floor_id = $1';
    params.push(floorId);
  }
  const r = await pool.query(
    `SELECT a.id, a.name, a.floor_id, f.name AS floor_name, f.entrance_id, e.name AS entrance_name, a.created_at
     FROM work_apartments a
     JOIN work_floors f ON f.id = a.floor_id
     JOIN work_entrances e ON e.id = f.entrance_id
     ${where} ORDER BY e.name, f.name, a.name`,
    params,
  );
  res.json(r.rows);
});

router.post('/work-apartments', async (req, res) => {
  const floor_id = parseId(req.body?.floor_id);
  const name = (req.body?.name || '').trim();
  if (!floor_id || !name) return res.status(400).json({ error: 'Укажите этаж и название квартиры' });
  try {
    const r = await pool.query(
      `INSERT INTO work_apartments (floor_id, name) VALUES ($1, $2)
       RETURNING id, floor_id, name, created_at`,
      [floor_id, name],
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Такая квартира уже есть на этом этаже' });
    if (e.code === '23503') return res.status(400).json({ error: 'Этаж не найден' });
    throw e;
  }
});

router.put('/work-apartments/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const floor_id = req.body?.floor_id != null ? parseId(req.body.floor_id) : undefined;
  const name = req.body?.name != null ? (req.body.name || '').trim() : undefined;
  if (!id) return res.status(400).json({ error: 'Неверный id' });
  const cur = (await pool.query('SELECT floor_id, name FROM work_apartments WHERE id = $1', [id])).rows[0];
  if (!cur) return res.status(404).json({ error: 'Не найдено' });
  const fid = floor_id ?? cur.floor_id;
  const nm = name ?? cur.name;
  if (!nm) return res.status(400).json({ error: 'Укажите название' });
  try {
    const r = await pool.query(
      'UPDATE work_apartments SET floor_id = $1, name = $2 WHERE id = $3 RETURNING id, floor_id, name, created_at',
      [fid, nm, id],
    );
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Такая квартира уже есть на этаже' });
    throw e;
  }
});

router.delete('/work-apartments/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Неверный id' });
  const used = await pool.query('SELECT 1 FROM work_rooms WHERE apartment_id = $1 LIMIT 1', [id]);
  if (used.rowCount) return res.status(400).json({ error: 'В квартире есть помещения — сначала удалите их' });
  const r = await pool.query('DELETE FROM work_apartments WHERE id = $1 RETURNING id', [id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Не найдено' });
  res.json({ ok: true });
});

// ——— Помещения ———
router.get('/work-rooms', async (req, res) => {
  const apartmentId = parseId(req.query.apartment_id);
  const params = [];
  let where = '';
  if (apartmentId) {
    where = 'WHERE r.apartment_id = $1';
    params.push(apartmentId);
  }
  const r = await pool.query(
    `SELECT r.id, r.name, r.apartment_id, a.name AS apartment_name,
            a.floor_id, f.name AS floor_name, f.entrance_id, e.name AS entrance_name, r.created_at
     FROM work_rooms r
     JOIN work_apartments a ON a.id = r.apartment_id
     JOIN work_floors f ON f.id = a.floor_id
     JOIN work_entrances e ON e.id = f.entrance_id
     ${where} ORDER BY e.name, f.name, a.name, r.name`,
    params,
  );
  res.json(r.rows);
});

router.post('/work-rooms', async (req, res) => {
  const apartment_id = parseId(req.body?.apartment_id);
  const name = (req.body?.name || '').trim();
  if (!apartment_id || !name) return res.status(400).json({ error: 'Укажите квартиру и название помещения' });
  try {
    const r = await pool.query(
      `INSERT INTO work_rooms (apartment_id, name) VALUES ($1, $2)
       RETURNING id, apartment_id, name, created_at`,
      [apartment_id, name],
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Такое помещение уже есть в этой квартире' });
    if (e.code === '23503') return res.status(400).json({ error: 'Квартира не найдена' });
    throw e;
  }
});

router.put('/work-rooms/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const apartment_id = req.body?.apartment_id != null ? parseId(req.body.apartment_id) : undefined;
  const name = req.body?.name != null ? (req.body.name || '').trim() : undefined;
  if (!id) return res.status(400).json({ error: 'Неверный id' });
  const cur = (await pool.query('SELECT apartment_id, name FROM work_rooms WHERE id = $1', [id])).rows[0];
  if (!cur) return res.status(404).json({ error: 'Не найдено' });
  const aid = apartment_id ?? cur.apartment_id;
  const nm = name ?? cur.name;
  if (!nm) return res.status(400).json({ error: 'Укажите название' });
  try {
    const r = await pool.query(
      'UPDATE work_rooms SET apartment_id = $1, name = $2 WHERE id = $3 RETURNING id, apartment_id, name, created_at',
      [aid, nm, id],
    );
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Такое помещение уже есть в квартире' });
    throw e;
  }
});

router.delete('/work-rooms/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Неверный id' });
  const r = await pool.query('DELETE FROM work_rooms WHERE id = $1 RETURNING id', [id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Не найдено' });
  res.json({ ok: true });
});

export default router;
