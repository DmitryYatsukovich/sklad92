import { Router } from 'express';
import pool from '../db/pool.js';
import { requireAuth, loadUser, requirePermission, requireAdmin } from '../middleware/auth.js';
import { logQuantityChange } from '../lib/material-quantity-log.js';
import { buildExportXlsx, buildExportPdf } from '../lib/issuance-export.js';

const router = Router();

router.use(requireAuth);
router.use(loadUser);
router.use(requirePermission('can_issuance'));

function parseVersion(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
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
      await client.query('ROLLBACK');
      return sendServerWinsConflict(res, {
        issuance_id: iss.id,
        updated_at: iss.updated_at,
        quantity: iss.quantity,
        returned_quantity: iss.returned_quantity,
      });
    }
    const already = parseFloat(iss.returned_quantity || 0);
    const total = parseFloat(iss.quantity);
    if (already + retQty > total + 1e-9) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Количество возврата превышает выданное' });
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

    const available = Number(iss.quantity) - Number(iss.returned_quantity || 0);
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
      await client.query('ROLLBACK');
      return sendServerWinsConflict(res, {
        issuance_id: iss.id,
        updated_at: iss.updated_at,
        quantity: iss.quantity,
        returned_quantity: iss.returned_quantity,
      });
    }

    const issued = parseFloat(iss.quantity);
    const oldReturned = parseFloat(iss.returned_quantity || 0);
    if (newReturned > issued + 1e-9) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Возврат не может превышать выданное количество' });
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
      await client.query('ROLLBACK');
      return sendServerWinsConflict(res, {
        issuance_id: iss.id,
        updated_at: iss.updated_at,
        quantity: iss.quantity,
        returned_quantity: iss.returned_quantity,
      });
    }

    const issued = parseFloat(iss.quantity);
    const returned = parseFloat(iss.returned_quantity || 0);
    const restore = issued - returned;

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

    const restoreByMaterial = new Map();
    for (const iss of issuances) {
      const issued = parseFloat(iss.quantity) || 0;
      const returned = parseFloat(iss.returned_quantity || 0) || 0;
      const restore = issued - returned;
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
            u.login AS issued_to_login, u.display_name AS issued_to_name,
            ub.login AS issued_by_login, ub.display_name AS issued_by_name
     FROM issuances i
     JOIN materials m ON m.id = i.material_id
     JOIN users u ON u.id = i.issued_to_user_id
     LEFT JOIN users ub ON ub.id = i.issued_by_user_id
     ${whereSql}
     ORDER BY i.issued_at DESC
     LIMIT 1000`,
    params,
  );
  res.json(r.rows);
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
