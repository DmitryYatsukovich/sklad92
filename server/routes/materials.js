import crypto from 'crypto';
import { Router } from 'express';
import multer from 'multer';
import pool from '../db/pool.js';
import { requireAuth, loadUser, requirePermission } from '../middleware/auth.js';
import { MATERIAL_SELECT, MATERIAL_FROM } from '../lib/material-select.js';
import {
  buildTemplateBuffer,
  parseImportSheet,
  buildExportXlsx,
  buildExportPdf,
  buildCatalogLookups,
  resolveLocationFromNames,
} from '../lib/material-excel.js';
import { logQuantityChange } from '../lib/material-quantity-log.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.(xlsx|xls)$/i.test(file.originalname || '')
      || (file.mimetype || '').includes('spreadsheet')
      || file.mimetype === 'application/vnd.ms-excel';
    cb(null, ok);
  },
});

async function loadCatalog(client) {
  const [objects, warehouses, racks, categories] = await Promise.all([
    client.query('SELECT id, name FROM warehouse_objects ORDER BY name'),
    client.query('SELECT id, name, object_id FROM warehouses ORDER BY name'),
    client.query('SELECT id, name, warehouse_id FROM warehouse_racks ORDER BY name'),
    client.query('SELECT id, name FROM material_categories ORDER BY name'),
  ]);
  return {
    objects: objects.rows,
    warehouses: warehouses.rows,
    racks: racks.rows,
    categories: categories.rows,
  };
}

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
    if (qty > 0) {
      await logQuantityChange(client, {
        materialId: id,
        userId: req.session.userId,
        delta: qty,
        quantityAfter: qty,
        kind: 'create',
        note: 'Начальное количество',
      });
    }
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

router.get('/:id/quantity-history', requirePermission('can_warehouse'), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Неверный id' });
  const exists = (await pool.query('SELECT id, quantity, unit FROM materials WHERE id = $1', [id])).rows[0];
  if (!exists) return res.status(404).json({ error: 'Материал не найден' });

  const r = await pool.query(
    `SELECT l.id, l.delta, l.quantity_after, l.kind, l.note, l.created_at, l.issuance_id,
            u.login AS user_login, u.display_name AS user_name
     FROM material_quantity_log l
     LEFT JOIN users u ON u.id = l.user_id
     WHERE l.material_id = $1
     ORDER BY l.created_at DESC
     LIMIT 500`,
    [id],
  );
  res.json({
    material_id: id,
    quantity: exists.quantity,
    unit: exists.unit,
    entries: r.rows,
  });
});

router.post('/:id/add', requirePermission('can_warehouse'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const amount = parseFloat(req.body?.amount) || 0;
  if (id <= 0 || amount <= 0) return res.status(400).json({ error: 'Укажите количество' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `UPDATE materials SET quantity = quantity + $1, updated_at = NOW()
       WHERE id = $2 RETURNING id, code, name, unit, quantity`,
      [amount, id],
    );
    if (r.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Материал не найден' });
    }
    const row = r.rows[0];
    await logQuantityChange(client, {
      materialId: id,
      userId: req.session.userId,
      delta: amount,
      quantityAfter: parseFloat(row.quantity),
      kind: 'receipt',
      note: 'Приход на склад',
    });
    await client.query('COMMIT');
    res.json(row);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

router.get('/users-for-issuance', async (req, res) => {
  const r = await pool.query(
    'SELECT id, login, display_name FROM users ORDER BY COALESCE(display_name, login)'
  );
  res.json(r.rows);
});

router.get('/import-template', requirePermission('can_warehouse'), (_req, res) => {
  const buf = buildTemplateBuffer();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="materials-template.xlsx"');
  res.send(buf);
});

router.post('/import', requirePermission('can_warehouse'), upload.single('file'), async (req, res) => {
  if (!req.file?.buffer) {
    return res.status(400).json({ error: 'Выберите файл Excel (.xlsx)' });
  }
  let items;
  try {
    items = parseImportSheet(req.file.buffer);
  } catch (e) {
    return res.status(400).json({ error: e.message || 'Ошибка чтения файла' });
  }

  const client = await pool.connect();
  const result = { created: 0, updated: 0, errors: [] };
  try {
    const catalog = await loadCatalog(client);
    const lookups = buildCatalogLookups(catalog);

    for (const item of items) {
      try {
        const loc = resolveLocationFromNames(lookups, item);
        if (item.object_name && !loc.object_id) {
          throw new Error(`Объект «${item.object_name}» не найден`);
        }
        if (item.warehouse_name && !loc.warehouse_id) {
          throw new Error(`Склад «${item.warehouse_name}» не найден`);
        }
        if (item.rack_name && !loc.rack_id) {
          throw new Error(`Стеллаж «${item.rack_name}» не найден`);
        }

        const validated = await validateLocation(client, loc);
        if (validated.error) throw new Error(validated.error);

        let catId = null;
        if (item.category_name) {
          const ck = item.category_name.trim().toLowerCase();
          catId = lookups.categories.get(ck) ?? null;
          if (!catId) throw new Error(`Категория «${item.category_name}» не найдена`);
        }

        const priceVal = parseFloat(item.price) || 0;
        const prodPrice = parseFloat(item.production_price) || 0;
        const qty = parseFloat(item.quantity) || 0;

        const code = item.code?.trim();
        let existing = null;
        if (code) {
          existing = (await client.query('SELECT id FROM materials WHERE code = $1', [code])).rows[0];
        }

        if (existing) {
          const prev = (await client.query('SELECT quantity FROM materials WHERE id = $1', [existing.id])).rows[0];
          const oldQty = parseFloat(prev?.quantity || 0);
          await client.query(
            `UPDATE materials SET
              name = $1, unit = $2, price = $3, production_price = $4, quantity = $5,
              object_id = $6, warehouse_id = $7, rack_id = $8, category_id = $9, updated_at = NOW()
             WHERE id = $10`,
            [
              item.name, item.unit, priceVal, prodPrice, qty,
              validated.object_id, validated.warehouse_id, validated.rack_id, catId,
              existing.id,
            ]
          );
          const delta = qty - oldQty;
          if (Math.abs(delta) > 1e-9) {
            await logQuantityChange(client, {
              materialId: existing.id,
              userId: req.session.userId,
              delta,
              quantityAfter: qty,
              kind: 'import',
              note: 'Импорт Excel',
            });
          }
          result.updated += 1;
        } else {
          let newCode = code || generateCode();
          for (let i = 0; i < 5; i++) {
            const ex = await client.query('SELECT 1 FROM materials WHERE code = $1', [newCode]);
            if (ex.rows.length === 0) break;
            newCode = generateCode();
          }
          const ins = await client.query(
            `INSERT INTO materials (
              code, name, unit, price, production_price, quantity,
              object_id, warehouse_id, rack_id, category_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING id`,
            [
              newCode, item.name, item.unit, priceVal, prodPrice, qty,
              validated.object_id, validated.warehouse_id, validated.rack_id, catId,
            ]
          );
          if (qty > 0) {
            await logQuantityChange(client, {
              materialId: ins.rows[0].id,
              userId: req.session.userId,
              delta: qty,
              quantityAfter: qty,
              kind: 'import',
              note: 'Импорт Excel (новый)',
            });
          }
          result.created += 1;
        }
      } catch (e) {
        result.errors.push({ row: item.rowNum, error: e.message || 'Ошибка' });
      }
    }

    res.json(result);
  } finally {
    client.release();
  }
});

router.post('/export', requirePermission('can_warehouse'), async (req, res) => {
  const { format, rows } = req.body || {};
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'Нет данных для выгрузки' });
  }
  const fmt = String(format || 'xlsx').toLowerCase();
  try {
    if (fmt === 'pdf') {
      const buf = await buildExportPdf(rows);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="materials.pdf"');
      return res.send(buf);
    }
    const buf = buildExportXlsx(rows);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="materials.xlsx"');
    res.send(buf);
  } catch (e) {
    console.error('export error:', e);
    res.status(500).json({ error: 'Ошибка формирования файла' });
  }
});

export default router;
