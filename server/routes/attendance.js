import { Router } from 'express';
import pool from '../db/pool.js';
import { requireAuth, loadUser, requirePermission } from '../middleware/auth.js';
import { parseFaceImageBase64, saveUserFacePhoto } from '../lib/face-photo.js';
import { parseHourlyRate, calcEarnedAmount } from '../lib/hourly-rate.js';

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

  const faceBuf = parseFaceImageBase64(req.body?.face_image);
  let facePhoto = null;
  if (faceBuf) {
    facePhoto = await saveUserFacePhoto(targetId, faceBuf, 'jpg');
  }

  const permRow = await pool.query(
    'SELECT user_id FROM user_permissions WHERE user_id = $1',
    [targetId],
  );
  if (permRow.rowCount) {
    await pool.query('UPDATE user_permissions SET can_face = true WHERE user_id = $1', [targetId]);
  } else {
    await pool.query(
      `INSERT INTO user_permissions (user_id, can_warehouse, can_issuance, can_production, can_users, can_attendance, can_settings, can_face)
       VALUES ($1, false, false, false, false, false, false, true)`,
      [targetId],
    );
  }

  res.json({
    ok: true,
    user_id: targetId,
    has_face: true,
    face_photo: facePhoto,
  });
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

    const upd = await client.query(
      `UPDATE attendance_records SET check_out_at = $1 WHERE id = $2
       RETURNING id, user_id, visit_date, check_in_at, check_out_at`,
      [now, row.id],
    );
    await client.query('COMMIT');
    return res.json({
      action: row.check_out_at ? 'check_out_update' : 'check_out',
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

/** Ключ даты YYYY-MM-DD без сдвига UTC */
function toDateKey(val) {
  if (val == null) return null;
  if (typeof val === 'string') {
    const m = val.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  const d = val instanceof Date ? val : new Date(val);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

function workedMinutes(checkIn, checkOut) {
  if (!checkIn || !checkOut) return null;
  const a = new Date(checkIn).getTime();
  const b = new Date(checkOut).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return null;
  return Math.round((b - a) / 60000);
}

/** Фактически отработанное время: «8 ч 30 мин» */
function formatWorkedHours(mins) {
  if (mins == null || mins <= 0) return null;
  const total = Math.round(mins);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} мин`;
  if (m === 0) return `${h} ч`;
  return `${h} ч ${m} мин`;
}

function enumerateDays(fromStr, toStr) {
  const days = [];
  const [y1, m1, d1] = fromStr.split('-').map((x) => parseInt(x, 10));
  const [y2, m2, d2] = toStr.split('-').map((x) => parseInt(x, 10));
  if (!y1 || !m1 || !d1 || !y2 || !m2 || !d2) return days;
  const cur = new Date(y1, m1 - 1, d1);
  const end = new Date(y2, m2 - 1, d2);
  while (cur <= end) {
    days.push(toDateKey(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

/** Табель посещений за период */
router.get('/timesheet', requirePermission('can_attendance'), async (req, res) => {
  let from = req.query.from || null;
  let to = req.query.to || null;

  if (!from || !to) {
    const r = await pool.query(
      `SELECT
         date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Moscow')::date)::date AS month_start,
         ((date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Moscow')::date) + interval '1 month') - interval '1 day')::date AS month_end`,
    );
    from = from || r.rows[0]?.month_start;
    to = to || r.rows[0]?.month_end;
  }

  const fromStr = toDateKey(from);
  const toStr = toDateKey(to);
  if (!fromStr || !toStr) {
    return res.status(400).json({ error: 'Некорректный период' });
  }
  const days = enumerateDays(fromStr, toStr);

  const recR = await pool.query(
    `SELECT a.user_id, a.visit_date, a.check_in_at, a.check_out_at,
            CASE
              WHEN a.check_in_at IS NOT NULL AND a.check_out_at IS NOT NULL
                   AND a.check_out_at > a.check_in_at
              THEN ROUND(EXTRACT(EPOCH FROM (a.check_out_at - a.check_in_at)) / 60.0)
              ELSE NULL
            END AS worked_minutes
     FROM attendance_records a
     WHERE a.visit_date >= $1::date AND a.visit_date <= $2::date
     ORDER BY a.user_id, a.visit_date`,
    [fromStr, toStr],
  );

  const userIds = [...new Set(recR.rows.map((r) => r.user_id))];
  let usersR = { rows: [] };
  if (userIds.length) {
    usersR = await pool.query(
      `SELECT u.id, u.login, u.display_name, u.first_name, u.last_name, u.hourly_rate
       FROM users u
       WHERE u.id = ANY($1::int[])
       ORDER BY u.last_name NULLS LAST, u.first_name NULLS LAST, u.login`,
      [userIds],
    );
  }

  const byUserDate = new Map();
  for (const rec of recR.rows) {
    const d = toDateKey(rec.visit_date);
    if (!d) continue;
    if (!byUserDate.has(rec.user_id)) byUserDate.set(rec.user_id, new Map());
    byUserDate.get(rec.user_id).set(d, rec);
  }

  const employees = usersR.rows.map((u) => {
    const name = u.display_name || [u.first_name, u.last_name].filter(Boolean).join(' ') || u.login;
    const dayMap = byUserDate.get(u.id) || new Map();
    let totalMins = 0;
    const cells = {};

    for (const d of days) {
      const rec = dayMap.get(d);
      if (!rec) {
        cells[d] = { status: 'empty', worked_minutes: null, worked_label: null };
        continue;
      }
      let mins = rec.worked_minutes != null ? Math.round(Number(rec.worked_minutes)) : null;
      if (mins == null) mins = workedMinutes(rec.check_in_at, rec.check_out_at);
      if (mins != null && mins > 0) totalMins += mins;

      const checkIn = rec.check_in_at
        ? new Date(rec.check_in_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
        : null;
      const checkOut = rec.check_out_at
        ? new Date(rec.check_out_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
        : null;

      cells[d] = {
        status: mins != null && mins > 0 ? 'ok' : rec.check_in_at ? 'partial' : 'empty',
        worked_minutes: mins,
        worked_hours: mins != null ? Math.round((mins / 60) * 100) / 100 : null,
        worked_label: formatWorkedHours(mins),
        check_in: checkIn,
        check_out: checkOut,
      };
    }

    const hourlyRate = u.hourly_rate != null ? Number(u.hourly_rate) : null;
    const earnedAmount = calcEarnedAmount(hourlyRate, totalMins);

    return {
      user_id: u.id,
      name,
      hourly_rate: hourlyRate,
      total_minutes: totalMins,
      total_hours: Math.round((totalMins / 60) * 100) / 100,
      total_label: formatWorkedHours(totalMins) || '0 ч',
      earned_amount: earnedAmount,
      days: cells,
    };
  });

  res.json({
    from: fromStr,
    to: toStr,
    days,
    employees,
  });
});

/** Обновить ставку сотрудника из табеля */
router.patch('/timesheet/rate', requirePermission('can_attendance'), async (req, res) => {
  const userId = parseInt(req.body?.user_id, 10);
  if (!userId) return res.status(400).json({ error: 'Укажите сотрудника' });
  if (!Object.prototype.hasOwnProperty.call(req.body || {}, 'hourly_rate')) {
    return res.status(400).json({ error: 'Укажите ставку' });
  }
  const rate = parseHourlyRate(req.body.hourly_rate);
  try {
    const r = await pool.query(
      'UPDATE users SET hourly_rate = $2 WHERE id = $1 RETURNING id, hourly_rate',
      [userId, rate],
    );
    if (!r.rowCount) return res.status(404).json({ error: 'Пользователь не найден' });
    const hourlyRate = r.rows[0].hourly_rate != null ? Number(r.rows[0].hourly_rate) : null;
    res.json({ user_id: userId, hourly_rate: hourlyRate });
  } catch (e) {
    console.error('PATCH timesheet/rate:', e);
    res.status(500).json({ error: e.message || 'Ошибка сохранения ставки' });
  }
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
