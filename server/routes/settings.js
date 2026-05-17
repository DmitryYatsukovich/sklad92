import { Router } from 'express';
import pool from '../db/pool.js';
import { requireAuth, loadUser, requirePermission } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);
router.use(loadUser);
router.use(requirePermission('can_warehouse'));

function parseId(v) {
  const n = parseInt(v, 10);
  return n > 0 ? n : null;
}

/** Все справочники для форм склада */
router.get('/catalog', async (_req, res) => {
  try {
    const [objects, warehouses, racks, categories] = await Promise.all([
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
    ]);
    res.json({
      objects: objects.rows,
      warehouses: warehouses.rows,
      racks: racks.rows,
      categories: categories.rows,
    });
  } catch (e) {
    console.error('GET /settings/catalog:', e.message);
    res.status(500).json({ error: 'Ошибка загрузки справочников' });
  }
});

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

export default router;
