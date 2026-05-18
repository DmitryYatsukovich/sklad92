import { Router } from 'express';
import pool from '../db/pool.js';
import { requireAuth, loadUser, requirePermission } from '../middleware/auth.js';

const router = Router();

const DIST_THRESHOLD = 0.6;

function euclideanDistance(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) return Infinity;
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s);
}

function normalizeDescriptor(raw) {
  if (!Array.isArray(raw) || raw.length < 128) return null;
  return raw.map((x) => Number(x));
}

/** Найти пользователя по дескриптору лица */
async function matchUserByDescriptor(descriptor) {
  const r = await pool.query(
    `SELECT id, login, display_name, first_name, last_name, face_descriptor
     FROM users
     WHERE face_descriptor IS NOT NULL`
  );
  let best = null;
  let bestDist = Infinity;
  for (const row of r.rows) {
    const stored = row.face_descriptor;
    if (!Array.isArray(stored)) continue;
    const d = euclideanDistance(descriptor, stored);
    if (d < bestDist) {
      bestDist = d;
      best = row;
    }
  }
  if (!best || bestDist > DIST_THRESHOLD) return null;
  return { user: best, distance: bestDist };
}

router.use(requireAuth);
router.use(loadUser);

/** Сохранить шаблон лица (себе или админом другому пользователю) */
router.post('/register-face', async (req, res) => {
  const descriptor = normalizeDescriptor(req.body?.descriptor);
  if (!descriptor) {
    return res.status(400).json({ error: 'Передайте массив descriptor (вектор лица)' });
  }
  let targetId = req.session.userId;
  const requestedId = req.body?.user_id != null ? parseInt(req.body.user_id, 10) : null;
  if (requestedId && requestedId !== req.session.userId) {
    if (req.user.role !== 'admin' && !req.user.can_users) {
      return res.status(403).json({ error: 'Нет прав на запись лица другого пользователя' });
    }
    targetId = requestedId;
  } else if (req.user.role !== 'admin' && !req.user.can_face) {
    return res.status(403).json({ error: 'Нет доступа к отметке' });
  }
  const exists = (await pool.query('SELECT id FROM users WHERE id = $1', [targetId])).rows[0];
  if (!exists) return res.status(404).json({ error: 'Пользователь не найден' });

  await pool.query('UPDATE users SET face_descriptor = $1::jsonb WHERE id = $2', [
    JSON.stringify(descriptor),
    targetId,
  ]);
  res.json({ ok: true, user_id: targetId });
});

/** Распознать лицо и отметить приход/уход за сегодня */
router.post('/scan', requirePermission('can_face'), async (req, res) => {
  const descriptor = normalizeDescriptor(req.body?.descriptor);
  if (!descriptor) {
    return res.status(400).json({ error: 'Передайте массив descriptor' });
  }
  const match = await matchUserByDescriptor(descriptor);
  if (!match) {
    return res.status(404).json({ error: 'Лицо не распознано. Зарегистрируйте шаблон в профиле или у администратора.' });
  }
  const userId = match.user.id;

  const today = (await pool.query(`SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Moscow')::date AS d`)).rows[0]?.d;
  const visitDate = today;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      `SELECT id, check_in_at, check_out_at FROM attendance_records
       WHERE user_id = $1 AND visit_date = $2
       FOR UPDATE`,
      [userId, visitDate]
    );
    const row = existing.rows[0];
    const now = new Date().toISOString();

    if (!row) {
      const ins = await client.query(
        `INSERT INTO attendance_records (user_id, visit_date, check_in_at, check_out_at)
         VALUES ($1, $2, $3, NULL)
         RETURNING id, user_id, visit_date, check_in_at, check_out_at`,
        [userId, visitDate, now]
      );
      await client.query('COMMIT');
      return res.json({
        action: 'check_in',
        user: {
          id: match.user.id,
          login: match.user.login,
          display_name: match.user.display_name,
          first_name: match.user.first_name,
          last_name: match.user.last_name,
        },
        record: ins.rows[0],
        distance: match.distance,
      });
    }

    if (!row.check_out_at) {
      const upd = await client.query(
        `UPDATE attendance_records SET check_out_at = $1 WHERE id = $2
         RETURNING id, user_id, visit_date, check_in_at, check_out_at`,
        [now, row.id]
      );
      await client.query('COMMIT');
      return res.json({
        action: 'check_out',
        user: {
          id: match.user.id,
          login: match.user.login,
          display_name: match.user.display_name,
          first_name: match.user.first_name,
          last_name: match.user.last_name,
        },
        record: upd.rows[0],
        distance: match.distance,
      });
    }

    await client.query('COMMIT');
    return res.status(409).json({
      error: 'Сегодня уже отмечены приход и уход',
      user: {
        id: match.user.id,
        login: match.user.login,
        display_name: match.user.display_name,
      },
      record: row,
    });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('attendance scan:', e);
    res.status(500).json({ error: 'Ошибка записи посещения' });
  } finally {
    client.release();
  }
});

/** Мои посещения */
router.get('/my', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 60, 200);
  const r = await pool.query(
    `SELECT id, visit_date, check_in_at, check_out_at
     FROM attendance_records
     WHERE user_id = $1
     ORDER BY visit_date DESC
     LIMIT $2`,
    [req.session.userId, limit]
  );
  res.json(r.rows);
});

/** Все посещения (нужно право can_attendance) */
router.get('/all', requirePermission('can_attendance'), async (req, res) => {
  const from = req.query.from || null;
  const to = req.query.to || null;
  let q = `
    SELECT a.id, a.user_id, a.visit_date, a.check_in_at, a.check_out_at,
           u.login, u.display_name, u.first_name, u.last_name
    FROM attendance_records a
    JOIN users u ON u.id = a.user_id
    WHERE 1=1
  `;
  const params = [];
  let n = 1;
  if (from) {
    q += ` AND a.visit_date >= $${n++}`;
    params.push(from);
  }
  if (to) {
    q += ` AND a.visit_date <= $${n++}`;
    params.push(to);
  }
  q += ` ORDER BY a.visit_date DESC, a.check_in_at DESC`;
  const r = await pool.query(q, params);
  res.json(r.rows);
});

export default router;
