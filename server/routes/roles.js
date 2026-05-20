import { Router } from 'express';
import pool from '../db/pool.js';
import { requireAuth, loadUser, requirePermission } from '../middleware/auth.js';

const PERMISSIONS = [
  { key: 'can_warehouse', label: 'Склад' },
  { key: 'can_issuance', label: 'Выдача' },
  { key: 'can_production', label: 'Выработка' },
  { key: 'can_users', label: 'Пользователи и роли' },
  { key: 'can_attendance', label: 'Журнал посещений (все сотрудники)' },
];

const router = Router();
router.use(requireAuth);
router.use(loadUser);
router.use(requirePermission('can_users'));

router.get('/', async (req, res) => {
  const r = await pool.query(
    'SELECT id, name, can_warehouse, can_issuance, can_production, can_users, can_attendance, created_at FROM roles ORDER BY name'
  );
  res.json(r.rows);
});

router.get('/permissions', (req, res) => {
  res.json(PERMISSIONS);
});

router.post('/', async (req, res) => {
  const { name, can_warehouse, can_issuance, can_production, can_users, can_attendance } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Укажите название роли' });
  try {
    const r = await pool.query(
      `INSERT INTO roles (name, can_warehouse, can_issuance, can_production, can_users, can_attendance)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, can_warehouse, can_issuance, can_production, can_users, can_attendance, created_at`,
      [name.trim(), !!can_warehouse, !!can_issuance, !!can_production, !!can_users, !!can_attendance]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Роль с таким названием уже есть' });
    throw e;
  }
});

router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { name, can_warehouse, can_issuance, can_production, can_users, can_attendance } = req.body || {};
  if (!id) return res.status(400).json({ error: 'Неверный id' });
  try {
    await pool.query(
      `UPDATE roles SET name = $1, can_warehouse = $2, can_issuance = $3, can_production = $4, can_users = $5, can_attendance = $6 WHERE id = $7`,
      [name?.trim() || '', !!can_warehouse, !!can_issuance, !!can_production, !!can_users, !!can_attendance, id]
    );
    const r = await pool.query(
      'SELECT id, name, can_warehouse, can_issuance, can_production, can_users, can_attendance, created_at FROM roles WHERE id = $1',
      [id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Роль не найдена' });
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Роль с таким названием уже есть' });
    throw e;
  }
});

router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const r = await pool.query('DELETE FROM roles WHERE id = $1 RETURNING id', [id]);
  if (r.rowCount === 0) return res.status(404).json({ error: 'Роль не найдена' });
  res.json({ ok: true });
});

export default router;
