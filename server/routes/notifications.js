import { Router } from 'express';
import { requireAuth, loadUser } from '../middleware/auth.js';
import {
  deletePushSubscription,
  getPushPublicKey,
  upsertPushSubscription,
} from '../lib/push-notifications.js';

const router = Router();

router.use(requireAuth);
router.use(loadUser);

router.get('/push-public-key', (req, res) => {
  if (!req.user?.can_task_notifications && req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Нет доступа' });
  }
  const publicKey = getPushPublicKey();
  res.json({
    enabled: !!publicKey,
    publicKey: publicKey || null,
  });
});

router.post('/push-subscription', async (req, res) => {
  if (!req.user?.can_task_notifications && req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Нет доступа' });
  }
  const subscription = req.body?.subscription || req.body;
  try {
    await upsertPushSubscription(req.user.id, subscription, req.get('user-agent') || '');
    res.json({ ok: true });
  } catch (e) {
    const statusCode = Number(e?.statusCode || 500);
    res.status(statusCode).json({ error: e?.message || 'Ошибка сохранения push-подписки' });
  }
});

router.delete('/push-subscription', async (req, res) => {
  try {
    const deleted = await deletePushSubscription({
      userId: req.user.id,
      endpoint: req.body?.endpoint || '',
    });
    res.json({ ok: true, deleted });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка удаления push-подписки' });
  }
});

export default router;
