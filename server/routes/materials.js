import crypto from 'crypto';
import { Router } from 'express';
import pool from '../db/pool.js';
import { requireAuth, loadUser, requirePermission } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);
router.use(loadUser);

router.get('/', requirePermission('can_warehouse'), async (req, res) => {
  const r = await pool.query(
    'SELECT id, code, name, unit, price, quantity, created_at, updated_at FROM materials ORDER BY name'
  );
  res.json(r.rows);
});

// Поиск по коду (для QR)
router.get('/by-code/:code', requirePermission('can_warehouse'), async (req, res) => {
  const code = (req.params.code || '').trim();
  const r = await pool.query(
    'SELECT id, code, name, unit, price, quantity FROM materials WHERE code = $1',
    [code]
  );
  if (r.rows.length === 0) return res.status(404).json({ error: 'Материал не найден' });
  res.json(r.rows[0]);
});

function generateCode() {
  return 'MAT-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

router.post('/', requirePermission('can_warehouse'), async (req, res) => {
  const { name, unit, price, quantity } = req.body || {};
  if (!name?.trim()) {
    return res.status(400).json({ error: 'Укажите наименование' });
  }
  const qty = parseFloat(quantity) || 0;
  const priceVal = parseFloat(price) || 0;
  let code = generateCode();
  for (let i = 0; i < 5; i++) {
    const exists = await pool.query('SELECT 1 FROM materials WHERE code = $1', [code]);
    if (exists.rows.length === 0) break;
    code = generateCode();
  }
  try {
    const r = await pool.query(
      `INSERT INTO materials (code, name, unit, price, quantity)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, code, name, unit, price, quantity, created_at, updated_at`,
      [code, name.trim(), (unit || 'шт').trim(), priceVal, qty]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Материал с таким кодом уже есть' });
    throw e;
  }
});

// Добавить количество на склад (поступление)
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

// Список пользователей для выдачи (все, у кого есть доступ)
router.get('/users-for-issuance', async (req, res) => {
  const r = await pool.query(
    'SELECT id, login, display_name FROM users ORDER BY COALESCE(display_name, login)'
  );
  res.json(r.rows);
});

export default router;
