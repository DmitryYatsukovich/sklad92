import { Router } from 'express';
import pool from '../db/pool.js';
import { requireAuth, loadUser, requirePermission } from '../middleware/auth.js';
import { canViewAllActions } from '../lib/actions-access.js';

const router = Router();

router.use(requireAuth);
router.use(loadUser);
router.use(requirePermission('can_actions'));

router.get('/', async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 300, 1), 1000);
    const viewAll = canViewAllActions(req.user);
    const r = await pool.query(
      `SELECT a.id, a.client_id, a.user_id, a.kind, a.title, a.description, a.payload, a.created_at,
              u.display_name AS user_display_name, u.login AS user_login
       FROM app_action_log a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE ($1::boolean OR a.user_id = $2)
       ORDER BY a.created_at DESC
       LIMIT $3`,
      [viewAll, req.user.id, limit],
    );
    res.json({
      viewAll,
      items: r.rows.map((row) => ({
        id: row.id,
        clientId: row.client_id,
        userId: row.user_id,
        kind: row.kind,
        title: row.title,
        description: row.description,
        payload: row.payload,
        createdAt: row.created_at,
        userDisplayName: row.user_display_name || row.user_login,
        synced: true,
      })),
    });
  } catch (e) {
    console.error('actions list:', e);
    res.status(500).json({ error: 'Ошибка загрузки действий' });
  }
});

router.post('/sync', async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.json({ synced: [] });

    const viewAll = canViewAllActions(req.user);
    const synced = [];
    for (const item of items.slice(0, 200)) {
      const clientId = String(item.clientId || item.client_id || '').trim();
      if (!clientId) continue;
      const kind = String(item.kind || 'unknown').slice(0, 50);
      const title = String(item.title || 'Действие').slice(0, 300);
      const description = item.description != null ? String(item.description).slice(0, 4000) : null;
      const payload = item.payload != null ? item.payload : null;
      const createdAt = item.createdAt || item.created_at || new Date().toISOString();
      let userId = item.userId ?? item.user_id ?? req.user.id;
      if (!viewAll) userId = req.user.id;

      const ins = await pool.query(
        `INSERT INTO app_action_log (client_id, user_id, kind, title, description, payload, created_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::timestamptz)
         ON CONFLICT (client_id) DO NOTHING
         RETURNING client_id`,
        [clientId, userId, kind, title, description, payload ? JSON.stringify(payload) : null, createdAt],
      );
      if (ins.rowCount > 0) synced.push(clientId);
    }
    res.json({ synced });
  } catch (e) {
    console.error('actions sync:', e);
    res.status(500).json({ error: 'Ошибка синхронизации действий' });
  }
});

export default router;
