import crypto from 'crypto';
import { Router } from 'express';
import pool from '../db/pool.js';
import { requireAuth, loadUser, requirePermission } from '../middleware/auth.js';
import { MATERIAL_SELECT, MATERIAL_FROM } from '../lib/material-select.js';

const router = Router();

router.use(requireAuth);
router.use(loadUser);

function parseId(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(v, 10);
  return n > 0 ? n : null;
}

async function validateLocation(client, { object_id, warehouse_id, rack_id }) {
  const oid = parseId(object_id);
  let wid = parseId(warehouse_id);
  let rid = parseId(rack_id);

  if (rid) {
    const rack = (await client.query(
      `SELECT r.id, r.warehouse_id, w.object_id
       FROM warehouse_racks r JOIN warehouses w ON w.id = r.warehouse_id WHERE r.id = $1`,
      [rid]
    )).rows[0];
    if (!rack) return { error: 'Стеллаж не найден' };
    wid = rack.warehouse_id;
    if (oid && rack.object_id !== oid) return { error: 'Стеллаж не относится к выбранному объекту' };
    return { object_id: rack.object_id, warehouse_id: wid, rack_id: rid };
  }

  if (wid) {
    const wh = (await client.query('SELECT id, object_id FROM warehouses WHERE id = $1', [wid])).rows[0];
    if (!wh) return { error: 'Склад не найден' };
    if (oid && wh.object_id !== oid) return { error: 'Склад не относится к выбранному объекту' };
    return { object_id: wh.object_id, warehouse_id: wid, rack_id: null };
  }

  if (oid) {
    const obj = (await client.query('SELECT id FROM warehouse_objects WHERE id = $1', [oid])).rows[0];
    if (!obj) return { error: 'Объект не найден' };
    return { object_id: oid, warehouse_id: null, rack_id: null };
  }

  return { object_id: null, warehouse_id: null, rack_id: null };
}

function generateCode() {
  return 'MAT-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

router.get('/', requirePermission('can_warehouse'), async (req, res) => {
  const r = await pool.query(
    `SELECT ${MATERIAL_SELECT} ${MATERIAL_FROM} ORDER BY m.name`
  );
  res.json(r.rows);
});

router.get('/by-code/:code', requirePermission('can_warehouse'), async (req, res) => {
  const code = (req.params.code || '').trim();
  const r = await pool.query(
    `SELECT ${MATERIAL_SELECT} ${MATERIAL_FROM} WHERE m.code = $1`,
    [code]
  );
  if (r.rows.length === 0) return res.status(404).json({ error: 'Материал не найден' });
  res.json(r.rows[0]);
});

router.post('/', requirePermission('can_warehouse'), async (req, res) => {
  const {
    name, unit, price, production_price, quantity,
    object_id, warehouse_id, rack_id, category_id,
  } = req.body || {};
  if (!name?.trim()) {
    return res.status(400).json({ error: 'Укажите наименование' });
  }
  const client = await pool.connect();
  try {
    const loc = await validateLocation(client, { object_id, warehouse_id, rack_id });
    if (loc.error) return res.status(400).json({ error: loc.error });

    const catId = parseId(category_id);
    if (catId) {
      const cat = (await client.query('SELECT id FROM material_categories WHERE id = $1', [catId])).rows[0];
      if (!cat) return res.status(400).json({ error: 'Категория не найдена' });
    }

    const qty = parseFloat(quantity) || 0;
    const priceVal = parseFloat(price) || 0;
    const prodPrice = parseFloat(production_price) || 0;
    let code = generateCode();
    for (let i = 0; i < 5; i++) {
      const exists = await client.query('SELECT 1 FROM materials WHERE code = $1', [code]);
      if (exists.rows.length === 0) break;
      code = generateCode();
    }

    const ins = await client.query(
      `INSERT INTO materials (
         code, name, unit, price, production_price, quantity,
         object_id, warehouse_id, rack_id, category_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        code, name.trim(), (unit || 'шт').trim(), priceVal, prodPrice, qty,
        loc.object_id, loc.warehouse_id, loc.rack_id, catId,
      ]
    );
    const id = ins.rows[0].id;
    const r = await client.query(
      `SELECT ${MATERIAL_SELECT} ${MATERIAL_FROM} WHERE m.id = $1`,
      [id]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Материал с таким кодом уже есть' });
    throw e;
  } finally {
    client.release();
  }
});

router.put('/:id', requirePermission('can_warehouse'), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Неверный id' });

  const {
    name, unit, price, production_price,
    object_id, warehouse_id, rack_id, category_id,
  } = req.body || {};

  const client = await pool.connect();
  try {
    const exists = (await client.query('SELECT id FROM materials WHERE id = $1', [id])).rows[0];
    if (!exists) return res.status(404).json({ error: 'Материал не найден' });

    const loc = await validateLocation(client, { object_id, warehouse_id, rack_id });
    if (loc.error) return res.status(400).json({ error: loc.error });

    const catId = category_id === null || category_id === ''
      ? null
      : parseId(category_id);
    if (catId) {
      const cat = (await client.query('SELECT id FROM material_categories WHERE id = $1', [catId])).rows[0];
      if (!cat) return res.status(400).json({ error: 'Категория не найдена' });
    }

    const fields = [];
    const vals = [];
    let i = 1;

    if (name !== undefined) {
      const n = (name || '').trim();
      if (!n) return res.status(400).json({ error: 'Укажите наименование' });
      fields.push(`name = $${i++}`);
      vals.push(n);
    }
    if (unit !== undefined) {
      fields.push(`unit = $${i++}`);
      vals.push((unit || 'шт').trim());
    }
    if (price !== undefined) {
      fields.push(`price = $${i++}`);
      vals.push(parseFloat(price) || 0);
    }
    if (production_price !== undefined) {
      fields.push(`production_price = $${i++}`);
      vals.push(parseFloat(production_price) || 0);
    }
    if (object_id !== undefined || warehouse_id !== undefined || rack_id !== undefined) {
      fields.push(`object_id = $${i++}`, `warehouse_id = $${i++}`, `rack_id = $${i++}`);
      vals.push(loc.object_id, loc.warehouse_id, loc.rack_id);
    }
    if (category_id !== undefined) {
      fields.push(`category_id = $${i++}`);
      vals.push(catId);
    }

    if (fields.length === 0) return res.status(400).json({ error: 'Нет данных для обновления' });

    fields.push('updated_at = NOW()');
    vals.push(id);
    await client.query(`UPDATE materials SET ${fields.join(', ')} WHERE id = $${i}`, vals);

    const r = await client.query(
      `SELECT ${MATERIAL_SELECT} ${MATERIAL_FROM} WHERE m.id = $1`,
      [id]
    );
    res.json(r.rows[0]);
  } finally {
    client.release();
  }
});

router.post('/:id/add', requirePermission('can_warehouse'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const amount = parseFloat(req.body?.amount) || 0;
  if (id <= 0 || amount <= 0) return res.status(400).json({ error: 'Укажите количество' });
  const r = await pool.query(
    `UPDATE materials SET quantity = quantity + $1, updated_at = NOW()
     WHERE id = $2 RETURNING id, code, name, unit, quantity`,
    [amount, id]
  );
  if (r.rowCount === 0) return res.status(404).json({ error: 'Материал не найден' });
  res.json(r.rows[0]);
});

router.get('/users-for-issuance', async (req, res) => {
  const r = await pool.query(
    'SELECT id, login, display_name FROM users ORDER BY COALESCE(display_name, login)'
  );
  res.json(r.rows);
});

export default router;
