import { Router } from 'express';
import pool from '../db/pool.js';
import { requireAuth, loadUser } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);
router.use(loadUser);

router.get('/', async (req, res) => {
  try {
    const r = await pool.query('SELECT pg_database_size(current_database()) AS size');
    const sizeBytes = Number(r.rows[0]?.size ?? 0);
    res.json({ sizeBytes });
  } catch (e) {
    console.error('Stats db size:', e);
    res.status(500).json({ error: 'Ошибка получения размера БД' });
  }
});

export default router;
