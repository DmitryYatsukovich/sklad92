import { Router } from 'express';
import pool from '../db/pool.js';
import { requireAuth, loadUser, requirePermission } from '../middleware/auth.js';

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
    const mat = (await client.query('SELECT id, quantity FROM materials WHERE id = $1', [material_id])).rows[0];
    if (!mat) return res.status(404).json({ error: 'Материал не найден' });
    if (parseFloat(mat.quantity) < qty) {
      return res.status(400).json({ error: 'Недостаточно на складе' });
    }
    await client.query('UPDATE materials SET quantity = quantity - $1, updated_at = NOW() WHERE id = $2', [qty, material_id]);
    const ins = await client.query(
      `INSERT INTO issuances (material_id, issued_by_user_id, issued_to_user_id, quantity, note)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, material_id, issued_to_user_id, quantity, issued_at, note`,
      [material_id, req.session.userId, issued_to_user_id, qty, note || null]
    );
    res.status(201).json(ins.rows[0]);
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
    const iss = (await client.query(
      'SELECT id, material_id, quantity, returned_quantity FROM issuances WHERE id = $1',
      [issuance_id]
    )).rows[0];
    if (!iss) return res.status(404).json({ error: 'Выдача не найдена' });
    const already = parseFloat(iss.returned_quantity || 0);
    const total = parseFloat(iss.quantity);
    if (already + retQty > total) {
      return res.status(400).json({ error: 'Количество возврата превышает выданное' });
    }
    await client.query(
      'UPDATE materials SET quantity = quantity + $1, updated_at = NOW() WHERE id = $2',
      [retQty, iss.material_id]
    );
    const newReturned = already + retQty;
    await client.query(
      `UPDATE issuances SET returned_quantity = $1, returned_at = COALESCE(returned_at, NOW()) WHERE id = $2`,
      [newReturned, issuance_id]
    );
    res.json({ ok: true, returned_quantity: newReturned });
  } finally {
    client.release();
  }
});

// Список выдач (для вкладки выдачи и возвратов)
router.get('/issuances', async (req, res) => {
  const r = await pool.query(
    `SELECT i.id, i.material_id, i.issued_to_user_id, i.quantity, i.issued_at, i.returned_at, i.returned_quantity, i.note,
            m.code AS material_code, m.name AS material_name, m.unit,
            u.login AS issued_to_login, u.display_name AS issued_to_name
     FROM issuances i
     JOIN materials m ON m.id = i.material_id
     JOIN users u ON u.id = i.issued_to_user_id
     ORDER BY i.issued_at DESC
     LIMIT 500`
  );
  res.json(r.rows);
});

export default router;
