import { Router } from 'express';
import pool from '../db/pool.js';
import { requireAuth, loadUser, requirePermission } from '../middleware/auth.js';
import { logQuantityChange } from '../lib/material-quantity-log.js';

const router = Router();

router.use(requireAuth);
router.use(loadUser);
router.use(requirePermission('can_issuance'));

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
       RETURNING id, material_id, issued_to_user_id, quantity, issued_at, note`,
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
      'SELECT id, material_id, quantity, returned_quantity FROM issuances WHERE id = $1 FOR UPDATE',
      [issuance_id],
    )).rows[0];
    if (!iss) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Выдача не найдена' });
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

    await client.query(
      `UPDATE issuances SET returned_quantity = $1::numeric, returned_at = COALESCE(returned_at, NOW()) WHERE id = $2`,
      [newReturned, issuance_id],
    );

    await logQuantityChange(client, {
      materialId: iss.material_id,
      userId: req.session.userId,
      delta: retQty,
      quantityAfter: qtyAfter,
      kind: 'return',
      issuanceId: issuance_id,
      note: `Возврат +${retQty}`,
    });

    await client.query('COMMIT');
    res.json({ ok: true, returned_quantity: newReturned });
  } catch (e) {
    await client.query('ROLLBACK');
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
      'SELECT id, material_id, quantity, returned_quantity FROM issuances WHERE id = $1 FOR UPDATE',
      [issuanceId],
    )).rows[0];
    if (!iss) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Выдача не найдена' });
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

    await client.query(
      `UPDATE issuances SET
         returned_quantity = $1::numeric,
         returned_at = CASE WHEN $1::numeric > 0 THEN COALESCE(returned_at, NOW()) ELSE NULL END
       WHERE id = $2`,
      [newReturned, issuanceId],
    );

    await client.query('COMMIT');
    res.json({ ok: true, returned_quantity: newReturned });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('PATCH returned error:', e);
    res.status(500).json({ error: e.message || 'Ошибка сохранения возврата' });
  } finally {
    client.release();
  }
});

// Список выдач (для вкладки выдачи и возвратов)
router.get('/issuances', async (req, res) => {
  const r = await pool.query(
    `SELECT i.id, i.material_id, i.issued_to_user_id, i.quantity, i.issued_at, i.returned_at, i.returned_quantity, i.note,
            m.code AS material_code, m.name AS material_name, m.unit, m.price, m.production_price,
            u.login AS issued_to_login, u.display_name AS issued_to_name
     FROM issuances i
     JOIN materials m ON m.id = i.material_id
     JOIN users u ON u.id = i.issued_to_user_id
     ORDER BY i.issued_at DESC
     LIMIT 1000`,
  );
  res.json(r.rows);
});

export default router;
