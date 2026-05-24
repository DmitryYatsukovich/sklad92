import crypto from 'crypto';
import { Router } from 'express';
import multer from 'multer';
import pool from '../db/pool.js';
import { requireAuth, loadUser, requirePermission, requireAdmin } from '../middleware/auth.js';
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
import { buildMaterialQrPdf } from '../lib/material-qr-pdf.js';
import {
  loadMaterialGroup,
  listMaterialsWhereClause,
  MATERIAL_GROUP_SELECT_EXTRA,
  MATERIAL_GROUP_JOINS,
  resolveGroupParentId,
} from '../lib/material-parts.js';

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

async function uniqueCode(client) {
  let code = generateCode();
  for (let i = 0; i < 8; i++) {
    const exists = await client.query('SELECT 1 FROM materials WHERE code = $1', [code]);
    if (exists.rows.length === 0) return code;
    code = generateCode();
  }
  return code;
}

async function fetchMaterialRow(client, id) {
  const r = await client.query(
    `SELECT ${MATERIAL_SELECT}${MATERIAL_GROUP_SELECT_EXTRA}
     ${MATERIAL_FROM}
     ${MATERIAL_GROUP_JOINS}
     WHERE m.id = $1`,
    [id],
  );
  return r.rows[0] || null;
}

async function insertMaterial(client, {
  code, name, unit, price, production_price, quantity,
  object_id, warehouse_id, rack_id, category_id,
  parent_material_id, part_index, part_label,
}) {
  const ins = await client.query(
    `INSERT INTO materials (
       code, name, unit, price, production_price, quantity,
       object_id, warehouse_id, rack_id, category_id,
       parent_material_id, part_index, part_label
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING id`,
    [
      code, name.trim(), (unit || 'шт').trim(), price, production_price, quantity,
      object_id, warehouse_id, rack_id, category_id,
      parent_material_id || null, part_index ?? null, part_label || null,
    ],
  );
  return ins.rows[0].id;
}

router.get('/', requirePermission('can_warehouse'), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT ${MATERIAL_SELECT}${MATERIAL_GROUP_SELECT_EXTRA}
       ${MATERIAL_FROM}
       ${MATERIAL_GROUP_JOINS}
       ${listMaterialsWhereClause()}
       ORDER BY COALESCE(pmap.name, m.name), m.part_index NULLS FIRST, m.name`,
    );
    res.json(r.rows);
  } catch (e) {
    console.error('GET /materials:', e.message);
    res.status(500).json({ error: 'Ошибка загрузки материалов. Перезапустите приложение или выполните миграции БД.' });
  }
});

router.get('/by-code/:code', requirePermission('can_warehouse'), async (req, res) => {
  const code = (req.params.code || '').trim();
  const r = await pool.query(
    `SELECT ${MATERIAL_SELECT}${MATERIAL_GROUP_SELECT_EXTRA}
     ${MATERIAL_FROM}
     ${MATERIAL_GROUP_JOINS}
     WHERE m.code = $1`,
    [code],
  );
  if (r.rows.length === 0) return res.status(404).json({ error: 'Материал не найден' });
  res.json(r.rows[0]);
});

router.get('/:id/parts', requirePermission('can_warehouse'), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Неверный id' });
  const client = await pool.connect();
  try {
    const group = await loadMaterialGroup(client, id);
    if (!group) return res.status(404).json({ error: 'Материал не найден' });
    if (!group.isGroup) {
      return res.json({ isGroup: false, parent: group.standalone, parts: [] });
    }
    res.json({
      isGroup: true,
      parent: group.parent,
      parts: group.parts,
    });
  } finally {
    client.release();
  }
});

router.post('/', requirePermission('can_warehouse'), async (req, res) => {
  const {
    name, unit, price, production_price, quantity,
    object_id, warehouse_id, rack_id, category_id,
    parts,
  } = req.body || {};
  if (!name?.trim()) {
    return res.status(400).json({ error: 'Укажите наименование' });
  }

  const splitParts = Array.isArray(parts) ? parts : [];
  if (splitParts.length > 0) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const priceVal = parseFloat(price) || 0;
      const prodPrice = parseFloat(production_price) || 0;
      const unitVal = (unit || 'шт').trim();
      const catId = parseId(category_id);
      if (catId) {
        const cat = (await client.query('SELECT id FROM material_categories WHERE id = $1', [catId])).rows[0];
        if (!cat) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Категория не найдена' });
        }
      }

      let totalQty = 0;
      const normalized = [];
      for (let i = 0; i < splitParts.length; i++) {
        const p = splitParts[i] || {};
        const loc = await validateLocation(client, {
          object_id: p.object_id ?? object_id,
          warehouse_id: p.warehouse_id ?? warehouse_id,
          rack_id: p.rack_id ?? rack_id,
        });
        if (loc.error) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: `Часть ${i + 1}: ${loc.error}` });
        }
        const q = parseFloat(p.quantity);
        if (!q || q <= 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: `Часть ${i + 1}: укажите количество > 0` });
        }
        totalQty += q;
        normalized.push({
          quantity: q,
          loc,
          part_label: (p.part_label || p.label || `Часть ${i + 1}`).trim(),
        });
      }

      const parentCode = await uniqueCode(client);
      const parentId = await insertMaterial(client, {
        code: parentCode,
        name: name.trim(),
        unit: unitVal,
        price: priceVal,
        production_price: prodPrice,
        quantity: 0,
        object_id: null,
        warehouse_id: null,
        rack_id: null,
        category_id: catId,
      });

      const createdParts = [];
      for (let i = 0; i < normalized.length; i++) {
        const p = normalized[i];
        const childCode = await uniqueCode(client);
        const childId = await insertMaterial(client, {
          code: childCode,
          name: name.trim(),
          unit: unitVal,
          price: priceVal,
          production_price: prodPrice,
          quantity: p.quantity,
          object_id: p.loc.object_id,
          warehouse_id: p.loc.warehouse_id,
          rack_id: p.loc.rack_id,
          category_id: catId,
          parent_material_id: parentId,
          part_index: i + 1,
          part_label: p.part_label,
        });
        await logQuantityChange(client, {
          materialId: childId,
          userId: req.session.userId,
          delta: p.quantity,
          quantityAfter: p.quantity,
          kind: 'create',
          note: `Часть ${i + 1} из ${normalized.length}`,
        });
        createdParts.push(await fetchMaterialRow(client, childId));
      }

      await client.query('COMMIT');
      const parentRow = await fetchMaterialRow(client, parentId);
      return res.status(201).json({
        parent: parentRow,
        parts: createdParts,
        totalQuantity: totalQty,
      });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      if (e.code === '23505') return res.status(400).json({ error: 'Материал с таким кодом уже есть' });
      throw e;
    } finally {
      client.release();
    }
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
    const code = await uniqueCode(client);

    const id = await insertMaterial(client, {
      code,
      name: name.trim(),
      unit: (unit || 'шт').trim(),
      price: priceVal,
      production_price: prodPrice,
      quantity: qty,
      ...loc,
      category_id: catId,
    });
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
    res.status(201).json(await fetchMaterialRow(client, id));
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Материал с таким кодом уже есть' });
    throw e;
  } finally {
    client.release();
  }
});

/** Разделить существующий одиночный материал на части */
router.post('/:id/split', requirePermission('can_warehouse'), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Неверный id' });

  const {
    parts,
    name, unit, price, production_price, category_id,
  } = req.body || {};
  const splitParts = Array.isArray(parts) ? parts : [];
  if (splitParts.length < 1) {
    return res.status(400).json({ error: 'Укажите хотя бы одну часть' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = (await client.query(
      `SELECT id, parent_material_id, quantity, name, unit, price, production_price, category_id
       FROM materials WHERE id = $1 FOR UPDATE`,
      [id],
    )).rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Материал не найден' });
    }
    if (row.parent_material_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Нельзя разделить дочернюю часть' });
    }
    const hasChildren = (await client.query(
      'SELECT 1 FROM materials WHERE parent_material_id = $1 LIMIT 1',
      [id],
    )).rowCount > 0;
    if (hasChildren) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Материал уже разделён на части' });
    }

    const currentQty = parseFloat(row.quantity) || 0;
    if (currentQty <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Нет количества на складе для разделения' });
    }

    const unitVal = (unit !== undefined ? (unit || 'шт') : row.unit || 'шт').trim();
    const priceVal = price !== undefined ? (parseFloat(price) || 0) : (parseFloat(row.price) || 0);
    const prodPrice = production_price !== undefined
      ? (parseFloat(production_price) || 0)
      : (parseFloat(row.production_price) || 0);
    const nameVal = (name !== undefined ? (name || '').trim() : row.name) || row.name;
    if (!nameVal) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Укажите наименование' });
    }

    const catId = category_id === undefined
      ? row.category_id
      : (category_id === null || category_id === '' ? null : parseId(category_id));
    if (catId) {
      const cat = (await client.query('SELECT id FROM material_categories WHERE id = $1', [catId])).rows[0];
      if (!cat) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Категория не найдена' });
      }
    }

    let totalQty = 0;
    const normalized = [];
    for (let i = 0; i < splitParts.length; i++) {
      const p = splitParts[i] || {};
      const loc = await validateLocation(client, {
        object_id: p.object_id,
        warehouse_id: p.warehouse_id,
        rack_id: p.rack_id,
      });
      if (loc.error) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Часть ${i + 1}: ${loc.error}` });
      }
      const q = parseFloat(p.quantity);
      if (!q || q <= 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Часть ${i + 1}: укажите количество > 0` });
      }
      totalQty += q;
      normalized.push({
        quantity: q,
        loc,
        part_label: (p.part_label || `Часть ${i + 1}`).trim(),
      });
    }

    if (Math.abs(totalQty - currentQty) > 0.0001) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Сумма частей (${totalQty}) не совпадает с количеством на складе (${currentQty})`,
      });
    }

    await client.query(
      `UPDATE materials SET
        name = $1, unit = $2, price = $3, production_price = $4, category_id = $5,
        quantity = 0, object_id = NULL, warehouse_id = NULL, rack_id = NULL,
        updated_at = NOW()
       WHERE id = $6`,
      [nameVal, unitVal, priceVal, prodPrice, catId, id],
    );

    await logQuantityChange(client, {
      materialId: id,
      userId: req.session.userId,
      delta: -currentQty,
      quantityAfter: 0,
      kind: 'adjust',
      note: 'Разделение на части',
    });

    const createdParts = [];
    for (let i = 0; i < normalized.length; i++) {
      const p = normalized[i];
      const childCode = await uniqueCode(client);
      const childId = await insertMaterial(client, {
        code: childCode,
        name: nameVal,
        unit: unitVal,
        price: priceVal,
        production_price: prodPrice,
        quantity: p.quantity,
        object_id: p.loc.object_id,
        warehouse_id: p.loc.warehouse_id,
        rack_id: p.loc.rack_id,
        category_id: catId,
        parent_material_id: id,
        part_index: i + 1,
        part_label: p.part_label,
      });
      await logQuantityChange(client, {
        materialId: childId,
        userId: req.session.userId,
        delta: p.quantity,
        quantityAfter: p.quantity,
        kind: 'create',
        note: `Часть ${i + 1} из ${normalized.length} (разделение)`,
      });
      createdParts.push(await fetchMaterialRow(client, childId));
    }

    await client.query('COMMIT');
    res.json({
      parent: await fetchMaterialRow(client, id),
      parts: createdParts,
      totalQuantity: totalQty,
    });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
});

router.post('/:id/parts', requirePermission('can_warehouse'), async (req, res) => {
  const refId = parseId(req.params.id);
  if (!refId) return res.status(400).json({ error: 'Неверный id' });

  const {
    quantity, object_id, warehouse_id, rack_id, part_label,
  } = req.body || {};
  const qty = parseFloat(quantity);
  if (!qty || qty <= 0) return res.status(400).json({ error: 'Укажите количество > 0' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const parentId = await resolveGroupParentId(client, refId);
    if (!parentId) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Материал не найден' });
    }

    const parent = (await client.query(
      'SELECT id, name, unit, price, production_price, category_id, parent_material_id FROM materials WHERE id = $1',
      [parentId],
    )).rows[0];
    if (!parent) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Материал не найден' });
    }

    let groupParentId = parent.parent_material_id ? parent.parent_material_id : parent.id;
    let base = parent;
    if (parent.parent_material_id) {
      base = (await client.query(
        'SELECT id, name, unit, price, production_price, category_id FROM materials WHERE id = $1',
        [groupParentId],
      )).rows[0];
    } else {
      const childCount = (await client.query(
        'SELECT COUNT(*)::int AS c FROM materials WHERE parent_material_id = $1',
        [groupParentId],
      )).rows[0].c;
      if (childCount === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Материал не разделён на части. Используйте «Разделить» при добавлении.' });
      }
    }

    const loc = await validateLocation(client, { object_id, warehouse_id, rack_id });
    if (loc.error) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: loc.error });
    }

    const nextIndex = (await client.query(
      'SELECT COALESCE(MAX(part_index), 0) + 1 AS n FROM materials WHERE parent_material_id = $1',
      [groupParentId],
    )).rows[0].n;

    const childCode = await uniqueCode(client);
    const childId = await insertMaterial(client, {
      code: childCode,
      name: base.name,
      unit: base.unit,
      price: parseFloat(base.price) || 0,
      production_price: parseFloat(base.production_price) || 0,
      quantity: qty,
      object_id: loc.object_id,
      warehouse_id: loc.warehouse_id,
      rack_id: loc.rack_id,
      category_id: base.category_id,
      parent_material_id: groupParentId,
      part_index: nextIndex,
      part_label: (part_label || `Часть ${nextIndex}`).trim(),
    });

    await logQuantityChange(client, {
      materialId: childId,
      userId: req.session.userId,
      delta: qty,
      quantityAfter: qty,
      kind: 'create',
      note: `Добавлена часть ${nextIndex}`,
    });

    await client.query('COMMIT');
    res.status(201).json(await fetchMaterialRow(client, childId));
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
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
    name, unit, price, production_price, quantity, part_label,
    object_id, warehouse_id, rack_id, category_id,
  } = req.body || {};

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const exists = (await client.query(
      'SELECT id, parent_material_id, quantity FROM materials WHERE id = $1',
      [id],
    )).rows[0];
    if (!exists) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Материал не найден' });
    }

    const hasChildren = (await client.query(
      'SELECT 1 FROM materials WHERE parent_material_id = $1 LIMIT 1',
      [id],
    )).rowCount > 0;
    if (hasChildren && (object_id !== undefined || warehouse_id !== undefined || rack_id !== undefined)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'У группового материала место хранения задаётся для каждой части отдельно',
      });
    }
    if (hasChildren && quantity !== undefined) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Количество задаётся для каждой части отдельно',
      });
    }
    if (part_label !== undefined && !exists.parent_material_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Подпись части только для дочерних материалов' });
    }

    const loc = await validateLocation(client, { object_id, warehouse_id, rack_id });
    if (loc.error) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: loc.error });
    }

    const catId = category_id === null || category_id === ''
      ? null
      : parseId(category_id);
    if (catId) {
      const cat = (await client.query('SELECT id FROM material_categories WHERE id = $1', [catId])).rows[0];
      if (!cat) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Категория не найдена' });
      }
    }

    const fields = [];
    const vals = [];
    let i = 1;

    let newName;
    if (name !== undefined) {
      const n = (name || '').trim();
      if (!n) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Укажите наименование' });
      }
      newName = n;
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

    if (part_label !== undefined) {
      const label = (part_label || '').trim() || null;
      fields.push(`part_label = $${i++}`);
      vals.push(label);
    }

    let quantityAfter = null;
    if (quantity !== undefined) {
      const newQty = parseFloat(quantity);
      if (!Number.isFinite(newQty) || newQty < 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Укажите количество ≥ 0' });
      }
      const oldQty = parseFloat(exists.quantity) || 0;
      fields.push(`quantity = $${i++}`);
      vals.push(newQty);
      quantityAfter = { oldQty, newQty };
    }

    if (fields.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Нет данных для обновления' });
    }

    fields.push('updated_at = NOW()');
    vals.push(id);
    await client.query(`UPDATE materials SET ${fields.join(', ')} WHERE id = $${i}`, vals);

    if (quantityAfter) {
      const delta = quantityAfter.newQty - quantityAfter.oldQty;
      if (delta !== 0) {
        await logQuantityChange(client, {
          materialId: id,
          userId: req.session.userId,
          delta,
          quantityAfter: quantityAfter.newQty,
          kind: 'adjust',
          note: 'Редактирование количества',
        });
      }
    }

    if (newName && (hasChildren || exists.parent_material_id)) {
      const parentId = exists.parent_material_id || id;
      await client.query(
        'UPDATE materials SET name = $1, updated_at = NOW() WHERE id = $2 OR parent_material_id = $2',
        [newName, parentId],
      );
    }

    if (
      price !== undefined
      || production_price !== undefined
      || unit !== undefined
      || category_id !== undefined
    ) {
      const parentId = exists.parent_material_id || (hasChildren ? id : null);
      if (parentId) {
        const childFields = [];
        const childVals = [];
        let ci = 1;
        if (unit !== undefined) {
          childFields.push(`unit = $${ci++}`);
          childVals.push((unit || 'шт').trim());
        }
        if (price !== undefined) {
          childFields.push(`price = $${ci++}`);
          childVals.push(parseFloat(price) || 0);
        }
        if (production_price !== undefined) {
          childFields.push(`production_price = $${ci++}`);
          childVals.push(parseFloat(production_price) || 0);
        }
        if (category_id !== undefined) {
          childFields.push(`category_id = $${ci++}`);
          childVals.push(catId);
        }
        if (childFields.length) {
          childFields.push('updated_at = NOW()');
          childVals.push(parentId);
          await client.query(
            `UPDATE materials SET ${childFields.join(', ')} WHERE parent_material_id = $${ci}`,
            childVals,
          );
        }
      }
    }

    await client.query('COMMIT');
    res.json(await fetchMaterialRow(client, id));
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Неверный id' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const mat = (await client.query(
      'SELECT id, name, quantity, parent_material_id FROM materials WHERE id = $1 FOR UPDATE',
      [id],
    )).rows[0];
    if (!mat) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Материал не найден' });
    }

    const deleteIds = [id];
    const children = (await client.query(
      'SELECT id FROM materials WHERE parent_material_id = $1',
      [id],
    )).rows;
    for (const c of children) deleteIds.push(c.id);

    if (mat.parent_material_id) {
      const sibs = (await client.query(
        'SELECT id FROM materials WHERE parent_material_id = $1',
        [mat.parent_material_id],
      )).rows;
      if (sibs.length === 1 && sibs[0].id === id) {
        deleteIds.push(mat.parent_material_id);
      }
    }

    const issRows = (await client.query(
      'SELECT id, material_id, quantity, returned_quantity FROM issuances WHERE material_id = ANY($1::int[])',
      [deleteIds],
    )).rows;

    const restoreByMaterial = new Map();
    for (const iss of issRows) {
      const issued = parseFloat(iss.quantity);
      const returned = parseFloat(iss.returned_quantity || 0);
      const delta = issued - returned;
      if (delta > 1e-9) {
        restoreByMaterial.set(
          iss.material_id,
          (restoreByMaterial.get(iss.material_id) || 0) + delta,
        );
      }
    }

    for (const [mid, restoreTotal] of restoreByMaterial) {
      const upd = await client.query(
        `UPDATE materials SET quantity = quantity + $1, updated_at = NOW()
         WHERE id = $2 RETURNING quantity`,
        [restoreTotal, mid],
      );
      if (upd.rowCount) {
        await logQuantityChange(client, {
          materialId: mid,
          userId: req.session.userId,
          delta: restoreTotal,
          quantityAfter: parseFloat(upd.rows[0].quantity),
          kind: 'delete_restore',
          note: 'Отмена выдач перед удалением',
        });
      }
    }

    if (issRows.length) {
      await client.query('DELETE FROM issuances WHERE material_id = ANY($1::int[])', [deleteIds]);
    }

    const del = await client.query(
      'DELETE FROM materials WHERE id = ANY($1::int[]) RETURNING id',
      [deleteIds],
    );
    if (!del.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Материал не найден' });
    }

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
});

router.get('/:id/quantity-history', requirePermission('can_warehouse'), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Неверный id' });

  const mat = (await pool.query(
    `SELECT m.id, m.quantity, m.unit, m.name, m.parent_material_id,
      (SELECT COUNT(*)::int FROM materials c WHERE c.parent_material_id = m.id) AS parts_count,
      (SELECT COALESCE(SUM(c.quantity), 0) FROM materials c WHERE c.parent_material_id = m.id) AS group_total_quantity
     FROM materials m WHERE m.id = $1`,
    [id],
  )).rows[0];
  if (!mat) return res.status(404).json({ error: 'Материал не найден' });

  const isGroupParent = !mat.parent_material_id && Number(mat.parts_count) > 0;
  let materialIds = [id];
  let displayQuantity = parseFloat(mat.quantity) || 0;

  if (isGroupParent) {
    const children = (await pool.query(
      'SELECT id FROM materials WHERE parent_material_id = $1 ORDER BY part_index NULLS LAST, id',
      [id],
    )).rows;
    materialIds = [id, ...children.map((c) => c.id)];
    displayQuantity = parseFloat(mat.group_total_quantity) || 0;
  }

  const r = await pool.query(
    `SELECT l.id, l.material_id, l.delta, l.quantity_after, l.kind, l.note, l.created_at, l.issuance_id,
            u.login AS user_login, u.display_name AS user_name,
            m.part_index, m.part_label, m.parent_material_id,
            CASE
              WHEN m.parent_material_id IS NULL THEN NULL
              ELSE COALESCE(NULLIF(TRIM(m.part_label), ''), 'Часть ' || m.part_index::text)
            END AS part_title
     FROM material_quantity_log l
     JOIN materials m ON m.id = l.material_id
     LEFT JOIN users u ON u.id = l.user_id
     WHERE l.material_id = ANY($1::int[])
     ORDER BY l.created_at DESC
     LIMIT 500`,
    [materialIds],
  );

  res.json({
    material_id: id,
    quantity: displayQuantity,
    unit: mat.unit,
    is_group: isGroupParent,
    parts_count: Number(mat.parts_count) || 0,
    entries: r.rows,
  });
});

router.post('/:id/add', requirePermission('can_warehouse'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const amount = parseFloat(req.body?.amount) || 0;
  if (id <= 0 || amount <= 0) return res.status(400).json({ error: 'Укажите количество' });

  const client = await pool.connect();
  try {
    const hasChildren = (await client.query(
      'SELECT 1 FROM materials WHERE parent_material_id = $1 LIMIT 1',
      [id],
    )).rowCount > 0;
    if (hasChildren) {
      return res.status(400).json({
        error: 'Приход добавляйте к отдельной части материала (откройте состав материала)',
      });
    }

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

router.post('/qr-pdf', requirePermission('can_warehouse'), async (req, res) => {
  const body = req.body || {};
  const { name, code, location } = body;
  if (!code) {
    return res.status(400).json({ error: 'Нет кода материала' });
  }
  try {
    const buf = await buildMaterialQrPdf(body);
    const safeName = String(code).replace(/[^\w.-]+/g, '_').slice(0, 80) || 'material';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="qr-${safeName}.pdf"`);
    res.send(buf);
  } catch (e) {
    console.error('qr-pdf error:', e);
    res.status(500).json({ error: 'Ошибка формирования PDF' });
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
