import { Router } from 'express';
import pool from '../db/pool.js';
import { requireAuth, loadUser, requirePermission, requireAdmin } from '../middleware/auth.js';
import { logQuantityChange } from '../lib/material-quantity-log.js';
import { buildExportXlsx, buildExportPdf } from '../lib/issuance-export.js';

const router = Router();

router.use(requireAuth);
router.use(loadUser);
router.use(requirePermission('can_issuance'));

let ensureProductionAllocationSchemaPromise = null;

async function ensureProductionAllocationSchema() {
  if (!ensureProductionAllocationSchemaPromise) {
    ensureProductionAllocationSchemaPromise = (async () => {
      await pool.query(
        'ALTER TABLE work_block_statuses ADD COLUMN IF NOT EXISTS is_for_production BOOLEAN NOT NULL DEFAULT false',
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
        'CREATE INDEX IF NOT EXISTS idx_ipa_worker ON issuance_production_allocations(worker_user_id, created_at DESC)',
      );
      await pool.query(
        'CREATE INDEX IF NOT EXISTS idx_ipa_location_system ON issuance_production_allocations(location_system_id)',
      );
    })().catch((error) => {
      ensureProductionAllocationSchemaPromise = null;
      throw error;
    });
  }
  await ensureProductionAllocationSchemaPromise;
}

router.use(async (_req, _res, next) => {
  try {
    await ensureProductionAllocationSchema();
    next();
  } catch (error) {
    next(error);
  }
});

function parseVersion(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function parseId(value) {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function resolveLwwConflict(req, serverUpdatedAt) {
  const policy = String(req.get('x-sync-policy') || '').toLowerCase();
  if (policy !== 'lww') return null;
  const baseVersion = parseVersion(req.get('x-sync-base-version'));
  const clientVersion = parseVersion(req.get('x-sync-client-version'));
  const serverVersion = parseVersion(serverUpdatedAt);
  if (!baseVersion || !clientVersion || !serverVersion) return null;
  if (serverVersion <= baseVersion) return null;
  return clientVersion > serverVersion ? 'client_wins' : 'server_wins';
}

function sendServerWinsConflict(res, row) {
  return res.status(409).json({
    code: 'CONFLICT_SERVER_WINS',
    error: 'Конфликт синхронизации: на сервере есть более новая версия данных',
    server: row,
  });
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

async function getProducedQtyByIssuance(db, issuanceId) {
  const producedResult = await db.query(
    `SELECT COALESCE(SUM(quantity), 0)::numeric AS produced_qty
     FROM issuance_production_allocations
     WHERE issuance_id = $1`,
    [issuanceId],
  );
  return Number(producedResult.rows[0]?.produced_qty || 0);
}

// Выдать материал пользователю
router.post('/issue', async (req, res) => {
  const { material_id, issued_to_user_id, quantity, note } = req.body || {};
  const qty = parseFloat(quantity);
  if (!material_id || !issued_to_user_id || !(qty > 0)) {
    return res.status(400).json({ error: 'Укажите материал, получателя и количество' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const mat = (await client.query(
      'SELECT id, quantity, unit FROM materials WHERE id = $1 FOR UPDATE',
      [material_id],
    )).rows[0];
    if (!mat) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Материал не найден' });
    }
    if (parseFloat(mat.quantity) < qty) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Недостаточно на складе' });
    }

    const toUser = (await client.query(
      'SELECT login, display_name FROM users WHERE id = $1',
      [issued_to_user_id],
    )).rows[0];

    const upd = await client.query(
      `UPDATE materials SET quantity = quantity - $1, updated_at = NOW()
       WHERE id = $2 RETURNING quantity`,
      [qty, material_id],
    );
    const qtyAfter = parseFloat(upd.rows[0].quantity);

    const ins = await client.query(
      `INSERT INTO issuances (material_id, issued_by_user_id, issued_to_user_id, quantity, note)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, material_id, issued_to_user_id, quantity, issued_at, note, updated_at`,
      [material_id, req.session.userId, issued_to_user_id, qty, note || null],
    );

    const recipient = toUser?.display_name || toUser?.login || `#${issued_to_user_id}`;
    await logQuantityChange(client, {
      materialId: material_id,
      userId: req.session.userId,
      delta: -qty,
      quantityAfter: qtyAfter,
      kind: 'issue',
      issuanceId: ins.rows[0].id,
      note: `Выдача: ${recipient}`,
    });

    await client.query('COMMIT');
    res.status(201).json(ins.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

// Вернуть на склад (частичный или полный возврат)
router.post('/return', async (req, res) => {
  const { issuance_id, returned_quantity } = req.body || {};
  const retQty = parseFloat(returned_quantity);
  if (!issuance_id || !(retQty > 0)) {
    return res.status(400).json({ error: 'Укажите выдачу и количество возврата' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const iss = (await client.query(
      `SELECT i.id, i.material_id, i.quantity, i.returned_quantity, i.note, i.updated_at,
              i.issued_to_user_id, u.login AS issued_to_login, u.display_name AS issued_to_name
       FROM issuances i
       LEFT JOIN users u ON u.id = i.issued_to_user_id
       WHERE i.id = $1
       FOR UPDATE OF i`,
      [issuance_id],
    )).rows[0];
    if (!iss) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Выдача не найдена' });
    }
    const conflict = resolveLwwConflict(req, iss.updated_at);
    if (conflict === 'server_wins') {
      const produced = await getProducedQtyByIssuance(client, iss.id);
      await client.query('ROLLBACK');
      return sendServerWinsConflict(res, {
        issuance_id: iss.id,
        updated_at: iss.updated_at,
        quantity: iss.quantity,
        returned_quantity: iss.returned_quantity,
        produced_quantity: produced,
      });
    }
    const already = parseFloat(iss.returned_quantity || 0);
    const total = parseFloat(iss.quantity);
    const produced = await getProducedQtyByIssuance(client, iss.id);
    const maxReturnable = Math.max(total - produced, 0);
    if (already + retQty > maxReturnable + 1e-9) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Количество возврата превышает доступное к возврату (${maxReturnable})` });
    }

    const upd = await client.query(
      `UPDATE materials SET quantity = quantity + $1, updated_at = NOW()
       WHERE id = $2 RETURNING quantity`,
      [retQty, iss.material_id],
    );
    const qtyAfter = parseFloat(upd.rows[0].quantity);
    const newReturned = already + retQty;

    const returnEventTag = makeIssuanceEventTag('return', {
      qty: retQty,
      at: new Date().toISOString(),
    });
    const nextNote = appendIssuanceEventTag(iss.note, returnEventTag);

    const issUpd = await client.query(
      `UPDATE issuances
       SET returned_quantity = $1::numeric,
           note = $3,
           returned_at = COALESCE(returned_at, NOW()),
           updated_at = NOW()
       WHERE id = $2
       RETURNING returned_quantity, updated_at`,
      [newReturned, issuance_id, nextNote],
    );

    const returnFrom = iss.issued_to_name || iss.issued_to_login || `#${iss.issued_to_user_id}`;
    await logQuantityChange(client, {
      materialId: iss.material_id,
      userId: req.session.userId,
      delta: retQty,
      quantityAfter: qtyAfter,
      kind: 'return',
      issuanceId: issuance_id,
      note: `Возврат от ${returnFrom} +${retQty}`,
    });

    await client.query('COMMIT');
    res.json({
      ok: true,
      returned_quantity: newReturned,
      updated_at: issUpd.rows[0]?.updated_at || null,
    });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

// Передать материал от одного получателя другому (без изменения остатков склада)
router.post('/transfer', async (req, res) => {
  const { issuance_id, issued_to_user_id, quantity, note } = req.body || {};
  const issuanceId = Number(issuance_id);
  const toUserId = Number(issued_to_user_id);
  const qty = Number(quantity);
  if (!issuanceId || !toUserId || !(qty > 0)) {
    return res.status(400).json({ error: 'Укажите выдачу, нового получателя и количество' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const iss = (await client.query(
      `SELECT i.id, i.material_id, i.issued_to_user_id, i.quantity, i.returned_quantity, i.note, i.updated_at,
              m.name AS material_name, m.unit
       FROM issuances i
       JOIN materials m ON m.id = i.material_id
       WHERE i.id = $1
       FOR UPDATE`,
      [issuanceId],
    )).rows[0];
    if (!iss) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Выдача не найдена' });
    }
    if (
      req.user?.role !== 'admin'
      && !req.user?.can_issuance_all
      && Number(iss.issued_to_user_id) !== Number(req.user?.id)
    ) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Нет доступа к этой выдаче' });
    }
    if (Number(iss.issued_to_user_id) === toUserId) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Материал уже выдан этому пользователю' });
    }

    const produced = await getProducedQtyByIssuance(client, iss.id);
    const available = Number(iss.quantity) - Number(iss.returned_quantity || 0) - produced;
    if (!(available > 0)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Для передачи нет доступного количества' });
    }
    if (qty > available + 1e-9) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Можно передать не больше ${available}` });
    }

    const fromUser = (await client.query(
      'SELECT login, display_name FROM users WHERE id = $1',
      [iss.issued_to_user_id],
    )).rows[0];
    const toUser = (await client.query(
      'SELECT id, login, display_name FROM users WHERE id = $1',
      [toUserId],
    )).rows[0];
    if (!toUser) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Пользователь-получатель не найден' });
    }

    const toName = toUser.display_name || toUser.login || `#${toUser.id}`;
    const transferEventTag = makeIssuanceEventTag('transfer', {
      qty,
      to: toName,
      at: new Date().toISOString(),
    });
    const nextSourceNote = appendIssuanceEventTag(iss.note, transferEventTag);
    const nextReturned = Number(iss.returned_quantity || 0) + qty;
    const sourceUpd = await client.query(
      `UPDATE issuances
       SET returned_quantity = $1::numeric,
           note = $3,
           returned_at = COALESCE(returned_at, NOW()),
           updated_at = NOW()
       WHERE id = $2
       RETURNING returned_quantity, updated_at`,
      [nextReturned, issuanceId, nextSourceNote],
    );

    const fromName = fromUser?.display_name || fromUser?.login || `#${iss.issued_to_user_id}`;
    const transferNoteParts = [`Передача от ${fromName}`];
    const customNote = String(note || '').trim();
    if (customNote) transferNoteParts.push(customNote);
    const ins = await client.query(
      `INSERT INTO issuances (material_id, issued_by_user_id, issued_to_user_id, quantity, note)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, material_id, issued_to_user_id, quantity, issued_at, note, updated_at`,
      [iss.material_id, req.session.userId, toUserId, qty, transferNoteParts.join('. ')],
    );

    await client.query('COMMIT');
    res.status(201).json({
      transfer: {
        ...ins.rows[0],
        material_name: iss.material_name,
        unit: iss.unit,
        issued_to_name: toUser.display_name,
        issued_to_login: toUser.login,
      },
      source: {
        issuance_id: issuanceId,
        returned_quantity: sourceUpd.rows[0]?.returned_quantity ?? nextReturned,
        updated_at: sourceUpd.rows[0]?.updated_at || null,
      },
    });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
});

// Установить итоговое возвращённое количество (редактирование возврата)
router.patch('/issuances/:id/returned', async (req, res) => {
  const issuanceId = parseInt(req.params.id, 10);
  const newReturned = parseFloat(req.body?.returned_quantity);
  if (!issuanceId || Number.isNaN(newReturned) || newReturned < 0) {
    return res.status(400).json({ error: 'Укажите корректное количество возврата' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const iss = (await client.query(
      'SELECT id, material_id, quantity, returned_quantity, updated_at FROM issuances WHERE id = $1 FOR UPDATE',
      [issuanceId],
    )).rows[0];
    if (!iss) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Выдача не найдена' });
    }
    const conflict = resolveLwwConflict(req, iss.updated_at);
    if (conflict === 'server_wins') {
      const produced = await getProducedQtyByIssuance(client, iss.id);
      await client.query('ROLLBACK');
      return sendServerWinsConflict(res, {
        issuance_id: iss.id,
        updated_at: iss.updated_at,
        quantity: iss.quantity,
        returned_quantity: iss.returned_quantity,
        produced_quantity: produced,
      });
    }

    const issued = parseFloat(iss.quantity);
    const oldReturned = parseFloat(iss.returned_quantity || 0);
    const produced = await getProducedQtyByIssuance(client, iss.id);
    const maxReturnable = Math.max(issued - produced, 0);
    if (newReturned > maxReturnable + 1e-9) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Возврат не может превышать доступное к возврату (${maxReturnable})` });
    }

    const stockDelta = newReturned - oldReturned;
    if (Math.abs(stockDelta) > 1e-9) {
      if (stockDelta > 0) {
        const mat = (await client.query(
          'SELECT quantity FROM materials WHERE id = $1 FOR UPDATE',
          [iss.material_id],
        )).rows[0];
        if (!mat) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Материал не найден' });
        }
      }

      const upd = await client.query(
        `UPDATE materials SET quantity = quantity + $1, updated_at = NOW()
         WHERE id = $2 RETURNING quantity`,
        [stockDelta, iss.material_id],
      );
      const qtyAfter = parseFloat(upd.rows[0].quantity);
      if (qtyAfter < -1e-9) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Недостаточно на складе для уменьшения возврата' });
      }

      await logQuantityChange(client, {
        materialId: iss.material_id,
        userId: req.session.userId,
        delta: stockDelta,
        quantityAfter: qtyAfter,
        kind: 'return_adjust',
        issuanceId: issuanceId,
        note: `Возврат: ${oldReturned} → ${newReturned}`,
      });
    }

    const issUpd = await client.query(
      `UPDATE issuances SET
         returned_quantity = $1::numeric,
         returned_at = CASE WHEN $1::numeric > 0 THEN COALESCE(returned_at, NOW()) ELSE NULL END,
         updated_at = NOW()
       WHERE id = $2
       RETURNING updated_at`,
      [newReturned, issuanceId],
    );

    await client.query('COMMIT');
    res.json({
      ok: true,
      returned_quantity: newReturned,
      updated_at: issUpd.rows[0]?.updated_at || null,
    });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('PATCH returned error:', e);
    res.status(500).json({ error: e.message || 'Ошибка сохранения возврата' });
  } finally {
    client.release();
  }
});

router.delete('/issuances/:id(\\d+)', requireAdmin, async (req, res) => {
  const issuanceId = parseInt(req.params.id, 10);
  if (!issuanceId) return res.status(400).json({ error: 'Неверный id' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const iss = (await client.query(
      'SELECT id, material_id, quantity, returned_quantity, updated_at FROM issuances WHERE id = $1 FOR UPDATE',
      [issuanceId],
    )).rows[0];
    if (!iss) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Выдача не найдена' });
    }
    const conflict = resolveLwwConflict(req, iss.updated_at);
    if (conflict === 'server_wins') {
      const produced = await getProducedQtyByIssuance(client, iss.id);
      await client.query('ROLLBACK');
      return sendServerWinsConflict(res, {
        issuance_id: iss.id,
        updated_at: iss.updated_at,
        quantity: iss.quantity,
        returned_quantity: iss.returned_quantity,
        produced_quantity: produced,
      });
    }

    const issued = parseFloat(iss.quantity);
    const returned = parseFloat(iss.returned_quantity || 0);
    const produced = await getProducedQtyByIssuance(client, iss.id);
    const restore = issued - returned - produced;

    if (restore > 1e-9) {
      const upd = await client.query(
        `UPDATE materials SET quantity = quantity + $1, updated_at = NOW()
         WHERE id = $2 RETURNING quantity`,
        [restore, iss.material_id],
      );
      if (!upd.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Материал не найден' });
      }
      const qtyAfter = parseFloat(upd.rows[0].quantity);
      await logQuantityChange(client, {
        materialId: iss.material_id,
        userId: req.session.userId,
        delta: restore,
        quantityAfter: qtyAfter,
        kind: 'issuance_delete',
        issuanceId,
        note: 'Удаление выдачи',
      });
    }

    await client.query('DELETE FROM issuances WHERE id = $1', [issuanceId]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
});

router.delete('/issuances/all', requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: issuances } = await client.query(
      'SELECT id, material_id, quantity, returned_quantity FROM issuances FOR UPDATE',
    );

    if (!issuances.length) {
      await client.query('COMMIT');
      return res.json({ ok: true, deleted: 0, restored: 0 });
    }

    const issuanceIds = issuances.map((row) => row.id);
    const producedByIssuanceRows = await client.query(
      `SELECT issuance_id, COALESCE(SUM(quantity), 0)::numeric AS produced_qty
       FROM issuance_production_allocations
       WHERE issuance_id = ANY($1::int[])
       GROUP BY issuance_id`,
      [issuanceIds],
    );
    const producedByIssuance = new Map(
      producedByIssuanceRows.rows.map((row) => [Number(row.issuance_id), Number(row.produced_qty || 0)]),
    );

    const restoreByMaterial = new Map();
    for (const iss of issuances) {
      const issued = parseFloat(iss.quantity) || 0;
      const returned = parseFloat(iss.returned_quantity || 0) || 0;
      const produced = producedByIssuance.get(Number(iss.id)) || 0;
      const restore = issued - returned - produced;
      if (restore <= 1e-9) continue;
      restoreByMaterial.set(
        iss.material_id,
        (restoreByMaterial.get(iss.material_id) || 0) + restore,
      );
    }

    let restored = 0;
    for (const [materialId, delta] of restoreByMaterial.entries()) {
      const upd = await client.query(
        `UPDATE materials SET quantity = quantity + $1, updated_at = NOW()
         WHERE id = $2 RETURNING quantity`,
        [delta, materialId],
      );
      if (!upd.rowCount) continue;
      const qtyAfter = parseFloat(upd.rows[0].quantity);
      restored += delta;
      await logQuantityChange(client, {
        materialId,
        userId: req.session.userId,
        delta,
        quantityAfter: qtyAfter,
        kind: 'issuance_delete_all',
        note: 'Удаление всех выдач',
      });
    }

    await client.query('DELETE FROM issuances');
    await client.query('COMMIT');
    res.json({ ok: true, deleted: issuances.length, restored });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
});

// Список выдач (для вкладки выдачи и возвратов)
router.get('/issuances', async (req, res) => {
  const canViewAllByIssued = req.user?.role === 'admin'
    || !!req.user?.can_issuance_all
    || !!req.user?.can_issuance_all_issued;
  const canViewAllByReceived = req.user?.role === 'admin'
    || !!req.user?.can_issuance_all
    || !!req.user?.can_issuance_all_received;
  const viewerUserId = Number(req.user?.id || req.session?.userId || 0);
  let whereSql = '';
  let params = [];
  if (!canViewAllByIssued && !canViewAllByReceived) {
    whereSql = 'WHERE (i.issued_by_user_id = $1 OR i.issued_to_user_id = $1)';
    params = [viewerUserId];
  } else if (!canViewAllByIssued && canViewAllByReceived) {
    whereSql = 'WHERE i.issued_by_user_id = $1';
    params = [viewerUserId];
  } else if (canViewAllByIssued && !canViewAllByReceived) {
    whereSql = 'WHERE i.issued_to_user_id = $1';
    params = [viewerUserId];
  }
  const r = await pool.query(
    `SELECT i.id, i.material_id, i.issued_to_user_id, i.issued_by_user_id,
            i.quantity, i.issued_at, i.returned_at, i.returned_quantity, i.note, i.updated_at,
            m.code AS material_code, m.name AS material_name, m.unit, m.price, m.production_price,
            COALESCE(ipa.produced_quantity, 0)::numeric AS produced_quantity,
            u.login AS issued_to_login, u.display_name AS issued_to_name,
            ub.login AS issued_by_login, ub.display_name AS issued_by_name
     FROM issuances i
     JOIN materials m ON m.id = i.material_id
     JOIN users u ON u.id = i.issued_to_user_id
     LEFT JOIN users ub ON ub.id = i.issued_by_user_id
     LEFT JOIN (
       SELECT issuance_id, COALESCE(SUM(quantity), 0)::numeric AS produced_quantity
       FROM issuance_production_allocations
       GROUP BY issuance_id
     ) ipa ON ipa.issuance_id = i.id
     ${whereSql}
     ORDER BY i.issued_at DESC
     LIMIT 1000`,
    params,
  );
  res.json(r.rows);
});

router.get('/issuances/:id/production-distribution', async (req, res) => {
  const issuanceId = parseId(req.params.id);
  if (!issuanceId) return res.status(400).json({ error: 'Неверный id выдачи' });

  const issuance = (await pool.query(
    `SELECT id, issued_to_user_id
     FROM issuances
     WHERE id = $1`,
    [issuanceId],
  )).rows[0];
  if (!issuance) return res.status(404).json({ error: 'Выдача не найдена' });
  if (
    req.user?.role !== 'admin'
    && !req.user?.can_issuance_all
    && Number(issuance.issued_to_user_id) !== Number(req.user?.id)
  ) {
    return res.status(403).json({ error: 'Нет доступа к этой выдаче' });
  }

  const rows = (await pool.query(
    `SELECT ipa.location_system_id,
            ipa.status_id,
            bs.name AS status_name,
            bs.color AS status_color,
            ARRAY_AGG(DISTINCT ipa.worker_user_id) AS worker_user_ids,
            ARRAY_AGG(DISTINCT COALESCE(NULLIF(TRIM(u.display_name), ''), NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.login)) AS worker_names,
            COALESCE(SUM(ipa.quantity), 0)::numeric AS quantity
     FROM issuance_production_allocations ipa
     LEFT JOIN work_block_statuses bs ON bs.id = ipa.status_id
     LEFT JOIN users u ON u.id = ipa.worker_user_id
     WHERE ipa.issuance_id = $1
     GROUP BY ipa.location_system_id, ipa.status_id, bs.name, bs.color
     ORDER BY ipa.location_system_id`,
    [issuanceId],
  )).rows.map((row) => ({
    location_system_id: Number(row.location_system_id),
    status_id: row.status_id == null ? null : Number(row.status_id),
    status_name: row.status_name || null,
    status_color: row.status_color || null,
    worker_user_ids: Array.isArray(row.worker_user_ids) ? row.worker_user_ids.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0) : [],
    worker_names: Array.isArray(row.worker_names) ? row.worker_names.filter(Boolean) : [],
    quantity: Number(row.quantity || 0),
  }));

  res.json(rows);
});

router.post('/issuances/:id/production-distribution', async (req, res) => {
  const issuanceId = parseId(req.params.id);
  if (!issuanceId) return res.status(400).json({ error: 'Неверный id выдачи' });

  const rawAssignments = Array.isArray(req.body?.assignments) ? req.body.assignments : [];
  const assignmentsMap = new Map();
  for (const row of rawAssignments) {
    const locationSystemId = parseId(row?.location_system_id);
    const workerUserIdsRaw = Array.isArray(row?.worker_user_ids)
      ? row.worker_user_ids
      : [row?.worker_user_id];
    const workerUserIds = [...new Set(
      workerUserIdsRaw.map((value) => parseId(value)).filter(Boolean),
    )];
    const statusId = parseId(row?.status_id);
    if (!locationSystemId || !workerUserIds.length || !statusId) {
      return res.status(400).json({ error: 'В каждом блоке нужно выбрать статус и хотя бы одного сотрудника' });
    }
    assignmentsMap.set(locationSystemId, { locationSystemId, workerUserIds, statusId });
  }
  const assignments = [...assignmentsMap.values()];
  if (!assignments.length) {
    return res.status(400).json({ error: 'Добавьте хотя бы один блок для выработки' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const issuance = (await client.query(
      `SELECT id, material_id, issued_to_user_id, quantity, returned_quantity, note
       FROM issuances
       WHERE id = $1
       FOR UPDATE`,
      [issuanceId],
    )).rows[0];
    if (!issuance) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Выдача не найдена' });
    }

    if (
      req.user?.role !== 'admin'
      && !req.user?.can_issuance_all
      && Number(issuance.issued_to_user_id) !== Number(req.user?.id)
    ) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Нет доступа к этой выдаче' });
    }

    const producedBefore = await getProducedQtyByIssuance(client, issuanceId);
    const issuedQty = Number(issuance.quantity || 0);
    const returnedQty = Number(issuance.returned_quantity || 0);
    const availableOnHands = Math.max(issuedQty - returnedQty - producedBefore, 0);
    if (!(availableOnHands > 0)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'На руках нет доступного материала для выработки' });
    }

    const materialMeta = (await client.query(
      `SELECT id, name, system_id, category_id
       FROM materials
       WHERE id = $1`,
      [issuance.material_id],
    )).rows[0];
    if (!materialMeta) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Материал выдачи не найден' });
    }

    const statusIds = [...new Set(assignments.map((row) => row.statusId))];
    const validStatuses = await client.query(
      `SELECT id, name
       FROM work_block_statuses
       WHERE id = ANY($1::int[])
         AND is_for_production = true`,
      [statusIds],
    );
    const statusMap = new Map(validStatuses.rows.map((row) => [Number(row.id), row]));
    const invalidStatus = assignments.find((row) => !statusMap.has(row.statusId));
    if (invalidStatus) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Выбран статус, который не отмечен как статус для выработки' });
    }

    const workerIds = [...new Set(
      assignments.flatMap((row) => row.workerUserIds),
    )];
    const workers = await client.query(
      `SELECT id,
              COALESCE(NULLIF(TRIM(display_name), ''), NULLIF(TRIM(CONCAT_WS(' ', first_name, last_name)), ''), login) AS worker_name
       FROM users
       WHERE id = ANY($1::int[])`,
      [workerIds],
    );
    const workerMap = new Map(workers.rows.map((row) => [Number(row.id), row.worker_name]));
    const missingWorker = assignments.find((row) => row.workerUserIds.some((userId) => !workerMap.has(userId)));
    if (missingWorker) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Сотрудник для выработки не найден' });
    }

    const slotIds = assignments.map((row) => row.locationSystemId);
    const slotsResult = await client.query(
      `SELECT ls.id AS location_system_id,
              ls.location_kind,
              ls.location_id,
              ls.system_id,
              ls.category_id
       FROM work_location_systems ls
       WHERE ls.id = ANY($1::int[])
       FOR UPDATE OF ls`,
      [slotIds],
    );
    const slotMap = new Map(slotsResult.rows.map((row) => [Number(row.location_system_id), row]));
    const missingSlot = assignments.find((row) => !slotMap.has(row.locationSystemId));
    if (missingSlot) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Часть выбранных блоков не найдена' });
    }

    const slotWithWrongSystemOrCategory = assignments.find((row) => {
      const slot = slotMap.get(row.locationSystemId);
      if (!slot) return true;
      const sameSystem = Number(slot.system_id || 0) === Number(materialMeta.system_id || 0);
      const sameCategory = (
        (slot.category_id == null && materialMeta.category_id == null)
        || Number(slot.category_id || 0) === Number(materialMeta.category_id || 0)
      );
      return !sameSystem || !sameCategory;
    });
    if (slotWithWrongSystemOrCategory) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Блок не соответствует системе или категории выбранного материала' });
    }

    const slotQuantitiesRows = await client.query(
      `SELECT ls.id AS location_system_id,
              COALESCE(SUM(CASE WHEN lm.material_id = $2 THEN lm.quantity ELSE 0 END), 0)::numeric AS exact_material_quantity,
              COALESCE(SUM(CASE
                WHEN LOWER(TRIM(m.name)) = LOWER(TRIM($3))
                  AND (($4::int IS NULL AND m.system_id IS NULL) OR m.system_id = $4)
                  AND (($5::int IS NULL AND m.category_id IS NULL) OR m.category_id = $5)
                THEN lm.quantity
                ELSE 0
              END), 0)::numeric AS fallback_material_quantity
              ,COALESCE((
                SELECT SUM(eq.quantity)
                FROM work_location_system_equipment eq
                WHERE eq.location_system_id = ls.id
                  AND LOWER(TRIM(eq.name)) = LOWER(TRIM($3))
              ), 0)::numeric AS equipment_quantity
              ,COALESCE((
                SELECT SUM(w.quantity)
                FROM work_location_system_works w
                WHERE w.location_system_id = ls.id
                  AND LOWER(TRIM(w.name)) = LOWER(TRIM($3))
              ), 0)::numeric AS works_quantity
       FROM work_location_systems ls
       LEFT JOIN work_location_system_materials lm ON lm.location_system_id = ls.id
       LEFT JOIN materials m ON m.id = lm.material_id
       WHERE ls.id = ANY($1::int[])
       GROUP BY ls.id`,
      [slotIds, issuance.material_id, materialMeta.name || '', materialMeta.system_id, materialMeta.category_id],
    );
    const slotQuantityMap = new Map(
      slotQuantitiesRows.rows.map((row) => {
        const exactQty = Number(row.exact_material_quantity || 0);
        const fallbackQty = Number(row.fallback_material_quantity || 0);
        const equipmentQty = Number(row.equipment_quantity || 0);
        const worksQty = Number(row.works_quantity || 0);
        let qty = 0;
        if (exactQty > 0) qty = exactQty;
        else if (fallbackQty > 0) qty = fallbackQty;
        else if (equipmentQty > 0) qty = equipmentQty;
        else if (worksQty > 0) qty = worksQty;
        return [Number(row.location_system_id), qty];
      }),
    );

    const slotWithoutMaterialQuantity = assignments.find((row) => {
      const qty = slotQuantityMap.get(row.locationSystemId) || 0;
      return !(qty > 0);
    });
    if (slotWithoutMaterialQuantity) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'В одном из блоков не найдено количество этого материала' });
    }

    let totalProducedNow = 0;
    for (const assignment of assignments) {
      totalProducedNow += Number(slotQuantityMap.get(assignment.locationSystemId) || 0);
    }
    if (totalProducedNow <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Количество в выбранных блоках должно быть больше нуля' });
    }
    if (totalProducedNow > availableOnHands + 1e-9) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Недостаточно материала на руках. Доступно: ${availableOnHands}, требуется: ${totalProducedNow}`,
      });
    }

    let totalAllocations = 0;
    for (const assignment of assignments) {
      const slotQty = Number(slotQuantityMap.get(assignment.locationSystemId) || 0);
      const workersCount = assignment.workerUserIds.length;
      const perWorkerQty = workersCount > 0 ? (slotQty / workersCount) : slotQty;
      let distributedQty = 0;
      for (let idx = 0; idx < assignment.workerUserIds.length; idx += 1) {
        const workerUserId = assignment.workerUserIds[idx];
        const isLast = idx === assignment.workerUserIds.length - 1;
        const qtyForWorker = isLast ? Math.max(slotQty - distributedQty, 0) : perWorkerQty;
        distributedQty += qtyForWorker;
        if (!(qtyForWorker > 0)) continue;
        await client.query(
          `INSERT INTO issuance_production_allocations
            (issuance_id, location_system_id, worker_user_id, status_id, quantity, created_by_user_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            issuanceId,
            assignment.locationSystemId,
            workerUserId,
            assignment.statusId,
            qtyForWorker,
            req.session.userId,
          ],
        );
        totalAllocations += 1;
      }
      await client.query(
        `UPDATE work_location_systems
         SET status_id = $1,
             assigned_user_id = $2,
             updated_at = NOW()
         WHERE id = $3`,
        [assignment.statusId, assignment.workerUserIds[0], assignment.locationSystemId],
      );
    }

    const workersSummary = [...new Set(
      assignments.flatMap((assignment) => assignment.workerUserIds.map((userId) => workerMap.get(userId) || `#${userId}`)),
    )]
      .join(', ');
    const productionEventTag = makeIssuanceEventTag('production', {
      qty: totalProducedNow,
      workers: workersSummary,
      blocks: assignments.length,
      at: new Date().toISOString(),
    });
    const nextNote = appendIssuanceEventTag(issuance.note, productionEventTag);
    await client.query(
      `UPDATE issuances
       SET note = $2,
           updated_at = NOW()
       WHERE id = $1`,
      [issuanceId, nextNote],
    );

    await client.query('COMMIT');
    res.status(201).json({
      ok: true,
      issuance_id: issuanceId,
      allocations_count: assignments.length,
      workers_allocations_count: totalAllocations,
      produced_quantity: totalProducedNow,
      remaining_on_hands: Math.max(availableOnHands - totalProducedNow, 0),
    });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('POST /operations/issuances/:id/production-distribution:', e.message);
    res.status(500).json({ error: e.message || 'Ошибка сохранения выработки' });
  } finally {
    client.release();
  }
});

router.delete('/issuances/:id/production-distribution', async (req, res) => {
  const issuanceId = parseId(req.params.id);
  const locationSystemId = parseId(req.body?.location_system_id);
  if (!issuanceId || !locationSystemId) {
    return res.status(400).json({ error: 'Нужно указать выдачу и блок для отмены выработки' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const issuance = (await client.query(
      `SELECT id, issued_to_user_id, note
       FROM issuances
       WHERE id = $1
       FOR UPDATE`,
      [issuanceId],
    )).rows[0];
    if (!issuance) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Выдача не найдена' });
    }
    if (
      req.user?.role !== 'admin'
      && !req.user?.can_issuance_all
      && Number(issuance.issued_to_user_id) !== Number(req.user?.id)
    ) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Нет доступа к этой выдаче' });
    }

    const deleted = await client.query(
      `DELETE FROM issuance_production_allocations
       WHERE issuance_id = $1
         AND location_system_id = $2
       RETURNING id, quantity`,
      [issuanceId, locationSystemId],
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
      [locationSystemId],
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
        locationSystemId,
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
      issuance_id: issuanceId,
      location_system_id: locationSystemId,
      restored_quantity: restoredQty,
    });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('DELETE /operations/issuances/:id/production-distribution:', e.message);
    res.status(500).json({ error: e.message || 'Ошибка отмены выработки' });
  } finally {
    client.release();
  }
});

router.post('/export', async (req, res) => {
  const { format, rows, meta } = req.body || {};
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'Нет данных для выгрузки' });
  }
  const fmt = String(format || 'xlsx').toLowerCase();
  try {
    if (fmt === 'pdf') {
      const buf = await buildExportPdf(rows, meta);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="issuances.pdf"');
      return res.send(buf);
    }
    const buf = buildExportXlsx(rows, meta);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="issuances.xlsx"');
    res.send(buf);
  } catch (e) {
    console.error('issuance export error:', e);
    res.status(500).json({ error: 'Ошибка формирования файла' });
  }
});

export default router;
