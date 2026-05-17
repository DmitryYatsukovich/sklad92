import { Router } from 'express';
import { requireAuth, loadUser } from '../middleware/auth.js';
import { getUidByCard, getCardByUid, getUserByCard } from '../db/card-uid.js';

const router = Router();

router.use(requireAuth);
router.use(loadUser);

/** По номеру карты вернуть internal_uid */
router.get('/by-card/:cardNumber', async (req, res) => {
  const uid = await getUidByCard(req.params.cardNumber);
  if (uid == null) return res.status(404).json({ error: 'Карта не найдена' });
  res.json({ card_number: req.params.cardNumber, internal_uid: uid });
});

/** По internal_uid вернуть номер карты */
router.get('/by-uid/:uid', async (req, res) => {
  const cardNumber = await getCardByUid(req.params.uid);
  if (cardNumber == null) return res.status(404).json({ error: 'UID не найден' });
  res.json({ internal_uid: req.params.uid, card_number: cardNumber });
});

/** По номеру карты вернуть пользователя (если у пользователя заполнен internal_uid) */
router.get('/user-by-card/:cardNumber', async (req, res) => {
  const user = await getUserByCard(req.params.cardNumber);
  if (!user) return res.status(404).json({ error: 'Пользователь по карте не найден' });
  res.json(user);
});

export default router;
