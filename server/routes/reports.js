import { Router } from 'express';
import pool from '../db/pool.js';
import { requireAuth, loadUser, requirePermission } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);
router.use(loadUser);
router.use(requirePermission('can_production'));

// Выработка по пользователям за период (сколько взял каждый)
router.get('/production', async (req, res) => {
  const from = req.query.from || '';
  const to = req.query.to || '';
  if (!from || !to) {
    return res.status(400).json({ error: 'Укажите период: from и to (YYYY-MM-DD)' });
  }
  const r = await pool.query(
    `SELECT u.id AS user_id, u.login, u.display_name,
            i.material_id, m.code AS material_code, m.name AS material_name, m.unit,
            SUM(i.quantity) AS total_issued,
            SUM(COALESCE(i.returned_quantity, 0)) AS total_returned,
            SUM(i.quantity) - SUM(COALESCE(i.returned_quantity, 0)) AS produced
     FROM issuances i
     JOIN users u ON u.id = i.issued_to_user_id
     JOIN materials m ON m.id = i.material_id
     WHERE i.issued_at::date >= $1::date AND i.issued_at::date <= $2::date
     GROUP BY u.id, u.login, u.display_name, i.material_id, m.code, m.name, m.unit
     ORDER BY u.login, m.name`,
    [from, to]
  );
  res.json(r.rows);
});

export default router;
