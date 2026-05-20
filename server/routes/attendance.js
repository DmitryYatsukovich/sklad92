import { Router } from 'express';
import multer from 'multer';
import pool from '../db/pool.js';
import { requireAuth, loadUser, requirePermission, requireAdmin } from '../middleware/auth.js';
import { parseFaceImageBase64, saveUserFacePhoto } from '../lib/face-photo.js';
import { parseHourlyRate } from '../lib/hourly-rate.js';
import {
  monthKeyFromDateStr,
  buildPayTotals,
  ensureUserMonthRate,
  upsertMonthRates,
} from '../lib/timesheet-month-rates.js';
import {
  formatTimeMoscowFull,
  buildTimesheetCellLabel,
  parseWorkedHoursInput,
  parseMoscowDateTime,
  formatDateTimeMoscow,
  userMarkedByPayload,
} from '../lib/attendance-time.js';
import { loadTimesheet, toDateKey } from '../lib/timesheet-data.js';
import { buildTimesheetWorkbook, parseTimesheetImport } from '../lib/timesheet-excel.js';
import { applyTimesheetImport } from '../lib/timesheet-import.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.(xlsx|xls)$/i.test(file.originalname || '')
      || (file.mimetype || '').includes('spreadsheet')
      || file.mimetype === 'application/vnd.ms-excel';
    cb(null, ok);
  },
});

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

    const markedById = req.session.userId || null;

    if (!row) {
      const ins = await client.query(
        `INSERT INTO attendance_records (user_id, visit_date, check_in_at, check_out_at, marked_by_user_id)
         VALUES ($1, $2, $3, NULL, $4)
         RETURNING id, user_id, visit_date, check_in_at, check_out_at, marked_by_user_id`,
        [userId, visitDate, now, markedById]
      );
      await client.query('COMMIT');
      const monthKeyScan = monthKeyFromDateStr(toDateKey(visitDate));
      if (monthKeyScan) await ensureUserMonthRate(pool, userId, monthKeyScan);
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
      `UPDATE attendance_records SET check_out_at = $1, marked_by_user_id = $2 WHERE id = $3
       RETURNING id, user_id, visit_date, check_in_at, check_out_at, marked_by_user_id`,
      [now, markedById, row.id],
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

/** Мои посещения; у администратора — последние отметки всех сотрудников */
router.get('/my', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 60, 200);
  if (req.user.role === 'admin') {
    const r = await pool.query(
      `SELECT a.id, a.user_id, a.visit_date, a.check_in_at, a.check_out_at,
              u.login, u.display_name, u.first_name, u.last_name
       FROM attendance_records a
       JOIN users u ON u.id = a.user_id
       ORDER BY a.visit_date DESC, a.check_in_at DESC NULLS LAST
       LIMIT $1`,
      [limit],
    );
    return res.json(r.rows);
  }
  const r = await pool.query(
    `SELECT id, visit_date, check_in_at, check_out_at
     FROM attendance_records
     WHERE user_id = $1
     ORDER BY visit_date DESC
     LIMIT $2`,
    [req.session.userId, limit],
  );
  res.json(r.rows);
});

function workedMinutes(checkIn, checkOut) {
  if (!checkIn || !checkOut) return null;
  const a = new Date(checkIn).getTime();
  const b = new Date(checkOut).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return null;
  return Math.round((b - a) / 60000);
}

function resolveWorkedMinutes(rec) {
  if (rec.manual_worked_minutes != null && rec.manual_worked_minutes !== '') {
    const m = Math.round(Number(rec.manual_worked_minutes));
    if (!Number.isNaN(m) && m >= 0) return m;
  }
  let mins = rec.worked_minutes != null ? Math.round(Number(rec.worked_minutes)) : null;
  if (mins == null) mins = workedMinutes(rec.check_in_at, rec.check_out_at);
  return mins != null && mins > 0 ? mins : null;
}

function joinUserPayload(rec, userIdField, prefix) {
  const id = rec[userIdField];
  if (!id) return null;
  return userMarkedByPayload({
    id,
    login: rec[`${prefix}_login`],
    first_name: rec[`${prefix}_first_name`],
    last_name: rec[`${prefix}_last_name`],
    display_name: rec[`${prefix}_display_name`],
  });
}

function buildTimesheetDayPatch(rec) {
  const autoMins = workedMinutes(rec.check_in_at, rec.check_out_at);
  const mins = resolveWorkedMinutes({ ...rec, worked_minutes: autoMins });
  const hasOut = !!rec.check_out_at;
  const isManual = rec.manual_worked_minutes != null;
  const manualMins = isManual ? Math.round(Number(rec.manual_worked_minutes)) : null;
  let status = 'empty';
  if (isManual && manualMins === 0) {
    status = 'ok';
  } else if (rec.check_in_at) {
    if ((mins != null && mins > 0) || hasOut) status = 'ok';
    else status = 'partial';
  } else if (isManual && mins != null && mins > 0) {
    status = 'ok';
  }
  return {
    record_id: rec.id,
    status,
    worked_minutes: mins,
    manual_worked_minutes: isManual ? Math.round(Number(rec.manual_worked_minutes)) : null,
    worked_hours: mins != null ? Math.round((mins / 60) * 100) / 100 : null,
    worked_label: formatWorkedHours(mins),
    cell_label: buildTimesheetCellLabel(rec.check_in_at, rec.check_out_at, mins),
    check_in_at: rec.check_in_at,
    check_out_at: rec.check_out_at,
    check_in: formatTimeMoscowFull(rec.check_in_at),
    check_out: hasOut ? formatTimeMoscowFull(rec.check_out_at) : null,
    marked_by: joinUserPayload(rec, 'marked_by_user_id', 'mb'),
    edited_by: joinUserPayload(rec, 'edited_by_user_id', 'eb'),
    edited_at: rec.edited_at || null,
    edited_at_label: rec.edited_at ? formatDateTimeMoscow(rec.edited_at) : null,
  };
}

const ATTENDANCE_DAY_SELECT = `
  SELECT a.id, a.user_id, a.visit_date, a.check_in_at, a.check_out_at,
         a.marked_by_user_id, a.manual_worked_minutes, a.edited_by_user_id, a.edited_at,
         CASE
           WHEN a.check_in_at IS NOT NULL AND a.check_out_at IS NOT NULL
                AND a.check_out_at > a.check_in_at
           THEN ROUND(EXTRACT(EPOCH FROM (a.check_out_at - a.check_in_at)) / 60.0)
           ELSE NULL
         END AS worked_minutes,
         mb.login AS mb_login, mb.first_name AS mb_first_name, mb.last_name AS mb_last_name,
         mb.display_name AS mb_display_name,
         eb.login AS eb_login, eb.first_name AS eb_first_name, eb.last_name AS eb_last_name,
         eb.display_name AS eb_display_name
  FROM attendance_records a
  LEFT JOIN users mb ON mb.id = a.marked_by_user_id
  LEFT JOIN users eb ON eb.id = a.edited_by_user_id`;

async function fetchAttendanceDayRecord(userId, dateStr) {
  const r = await pool.query(
    `${ATTENDANCE_DAY_SELECT} WHERE a.user_id = $1 AND a.visit_date = $2::date`,
    [userId, dateStr],
  );
  return r.rows[0] || null;
}

/** Фактически отработанное время: «8 ч 30 мин» */
function formatWorkedHours(mins) {
  if (mins == null) return null;
  if (mins <= 0) return '0 ч';
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
  const cur = new Date(Date.UTC(y1, m1 - 1, d1));
  const end = new Date(Date.UTC(y2, m2 - 1, d2));
  while (cur <= end) {
    days.push(toDateKey(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

/** Табель: администратор — все сотрудники; остальные — только своя строка */
router.get('/timesheet', requirePermission('can_attendance'), async (req, res) => {
  try {
    const data = await loadTimesheet({
      from: req.query.from || null,
      to: req.query.to || null,
      isAdmin: req.user.role === 'admin',
      selfUserId: Number(req.user.id),
    });
    res.json(data);
  } catch (e) {
    if (e.status === 400) return res.status(400).json({ error: e.message });
    throw e;
  }
});

function safeFilenamePart(s) {
  return String(s || '')
    .replace(/[\\/?*[\]:]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 60) || 'tabel';
}

/** Экспорт табеля в Excel (только администратор) */
router.get('/timesheet/export', requireAdmin, async (req, res) => {
  try {
    const data = await loadTimesheet({
      from: req.query.from || null,
      to: req.query.to || null,
      isAdmin: true,
      selfUserId: Number(req.user.id),
    });
    const organization = req.query.organization ? String(req.query.organization) : null;
    const buf = buildTimesheetWorkbook(data, { organization });
    const month = data.month || 'period';
    const name = organization
      ? `tabel-${month}-${safeFilenamePart(organization)}.xlsx`
      : `tabel-${month}-obshiy.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(name)}"`);
    res.send(buf);
  } catch (e) {
    if (e.status === 400) return res.status(400).json({ error: e.message });
    console.error('GET timesheet/export:', e);
    res.status(500).json({ error: 'Ошибка экспорта' });
  }
});

/** Импорт табеля из Excel */
router.post('/timesheet/import', requireAdmin, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Ошибка загрузки файла' });
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ error: 'Выберите файл Excel (.xlsx)' });
    }
    const monthParam = typeof req.query.month === 'string' ? req.query.month.trim() : '';
    const parsed = parseTimesheetImport(req.file.buffer);
    const monthKey = monthParam || parsed.month;
    if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) {
      return res.status(400).json({ error: 'Укажите месяц (YYYY-MM) в параметре или в файле' });
    }
    const result = await applyTimesheetImport({
      monthKey,
      rows: parsed.rows,
      editorId: req.session.userId || null,
    });
    res.json({
      ok: true,
      month: monthKey,
      applied: result.applied,
      errors: result.errors,
    });
  } catch (e) {
    if (e.status === 400) return res.status(400).json({ error: e.message });
    console.error('POST timesheet/import:', e);
    res.status(500).json({ error: e.message || 'Ошибка импорта' });
  }
});

/** Пользователи, которых можно добавить в табель месяца */
router.get('/timesheet/candidates', requireAdmin, async (req, res) => {
  try {
    const monthKey = typeof req.query.month === 'string' ? req.query.month.trim() : '';
    if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) {
      return res.status(400).json({ error: 'Укажите месяц (YYYY-MM)' });
    }
    const [y, m] = monthKey.split('-').map((x) => parseInt(x, 10));
    const fromStr = `${monthKey}-01`;
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const toStr = `${monthKey}-${String(lastDay).padStart(2, '0')}`;

    const data = await loadTimesheet({
      from: fromStr,
      to: toStr,
      isAdmin: true,
      selfUserId: Number(req.user.id),
    });
    const inSheet = new Set(data.employees.map((e) => e.user_id));
    const all = await pool.query(
      `SELECT u.id, u.login, u.display_name, u.first_name, u.last_name,
              COALESCE(o.name, NULLIF(TRIM(u.employment_org), '')) AS organization_name
       FROM users u
       LEFT JOIN organizations o ON o.id = u.organization_id
       ORDER BY u.last_name NULLS LAST, u.first_name NULLS LAST, u.login`,
    );
    const candidates = all.rows
      .filter((u) => !inSheet.has(u.id))
      .map((u) => ({
        id: u.id,
        login: u.login,
        name: u.display_name || [u.first_name, u.last_name].filter(Boolean).join(' ') || u.login,
        organization_name: u.organization_name || null,
      }));
    res.json(candidates);
  } catch (e) {
    console.error('GET timesheet/candidates:', e);
    res.status(500).json({ error: 'Ошибка загрузки списка' });
  }
});

/** Добавить сотрудника в табель месяца вручную */
router.post('/timesheet/members', requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.body?.user_id, 10);
    const monthKey = typeof req.body?.month === 'string' ? req.body.month.trim() : '';
    if (!userId) return res.status(400).json({ error: 'Выберите сотрудника' });
    if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) {
      return res.status(400).json({ error: 'Укажите месяц (YYYY-MM)' });
    }
    const exists = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (!exists.rowCount) return res.status(404).json({ error: 'Пользователь не найден' });

    await ensureUserMonthRate(pool, userId, monthKey);

    const [y, m] = monthKey.split('-').map((x) => parseInt(x, 10));
    const fromStr = `${monthKey}-01`;
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const toStr = `${monthKey}-${String(lastDay).padStart(2, '0')}`;

    const data = await loadTimesheet({
      from: fromStr,
      to: toStr,
      isAdmin: true,
      selfUserId: Number(req.user.id),
    });
    const employee = data.employees.find((e) => e.user_id === userId);
    if (!employee) {
      return res.status(500).json({ error: 'Не удалось добавить в табель' });
    }
    res.status(201).json({ employee });
  } catch (e) {
    console.error('POST timesheet/members:', e);
    res.status(500).json({ error: e.message || 'Ошибка добавления' });
  }
});

/** Ручная правка отработанных часов за день (только администратор) */
router.patch('/timesheet/hours', requireAdmin, async (req, res) => {
  const userId = parseInt(req.body?.user_id, 10);
  const dateStr = toDateKey(req.body?.date);
  if (!userId || !dateStr) {
    return res.status(400).json({ error: 'Укажите сотрудника и дату' });
  }
  if (!Object.prototype.hasOwnProperty.call(req.body || {}, 'worked_hours')
    && !Object.prototype.hasOwnProperty.call(req.body || {}, 'worked_minutes')) {
    return res.status(400).json({ error: 'Укажите часы' });
  }

  const manualMins = Object.prototype.hasOwnProperty.call(req.body || {}, 'worked_minutes')
    ? (req.body.worked_minutes === null || req.body.worked_minutes === ''
      ? null
      : Math.round(Number(req.body.worked_minutes)))
    : parseWorkedHoursInput(req.body.worked_hours);

  if (manualMins != null && (Number.isNaN(manualMins) || manualMins < 0)) {
    return res.status(400).json({ error: 'Некорректное значение часов' });
  }

  try {
    const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (!userCheck.rowCount) {
      return res.status(404).json({ error: 'Сотрудник не найден' });
    }

    const existing = await pool.query(
      `SELECT id FROM attendance_records WHERE user_id = $1 AND visit_date = $2::date`,
      [userId, dateStr],
    );
    const editorId = req.session.userId || null;

    if (!existing.rowCount) {
      if (manualMins == null) {
        return res.status(400).json({ error: 'Укажите отработанные часы' });
      }
      await pool.query(
        `INSERT INTO attendance_records
           (user_id, visit_date, manual_worked_minutes, edited_by_user_id, edited_at)
         VALUES ($1, $2::date, $3, $4, NOW())`,
        [userId, dateStr, manualMins, editorId],
      );
    } else {
      const r = await pool.query(
        `UPDATE attendance_records
         SET manual_worked_minutes = $3, edited_by_user_id = $4, edited_at = NOW()
         WHERE user_id = $1 AND visit_date = $2::date
         RETURNING id`,
        [userId, dateStr, manualMins, editorId],
      );
      if (!r.rowCount) {
        return res.status(404).json({ error: 'Запись посещения за этот день не найдена' });
      }
    }
    const monthKeyPatch = monthKeyFromDateStr(dateStr);
    if (monthKeyPatch) await ensureUserMonthRate(pool, userId, monthKeyPatch);
    const rec = await fetchAttendanceDayRecord(userId, dateStr);
    res.json({
      user_id: userId,
      date: dateStr,
      ...buildTimesheetDayPatch(rec),
    });
  } catch (e) {
    console.error('PATCH timesheet/hours:', e);
    res.status(500).json({ error: e.message || 'Ошибка сохранения часов' });
  }
});

/** Ручная правка времени прихода и ухода (только администратор) */
router.patch('/timesheet/times', requireAdmin, async (req, res) => {
  const userId = parseInt(req.body?.user_id, 10);
  const dateStr = toDateKey(req.body?.date);
  if (!userId || !dateStr) {
    return res.status(400).json({ error: 'Укажите сотрудника и дату' });
  }
  const hasIn = Object.prototype.hasOwnProperty.call(req.body || {}, 'check_in');
  const hasOut = Object.prototype.hasOwnProperty.call(req.body || {}, 'check_out');
  if (!hasIn && !hasOut) {
    return res.status(400).json({ error: 'Укажите время прихода или ухода' });
  }

  try {
    const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (!userCheck.rowCount) {
      return res.status(404).json({ error: 'Сотрудник не найден' });
    }

    const existing = await pool.query(
      `SELECT id, check_in_at, check_out_at, manual_worked_minutes
       FROM attendance_records WHERE user_id = $1 AND visit_date = $2::date`,
      [userId, dateStr],
    );
    const row = existing.rows[0];

    let checkInAt = row?.check_in_at ?? null;
    let checkOutAt = row?.check_out_at ?? null;

    if (hasIn) {
      const t = parseMoscowDateTime(dateStr, req.body.check_in);
      if (!t) return res.status(400).json({ error: 'Некорректное время прихода' });
      checkInAt = t;
    }
    if (hasOut) {
      if (req.body.check_out === null || req.body.check_out === '') {
        checkOutAt = null;
      } else {
        const t = parseMoscowDateTime(dateStr, req.body.check_out);
        if (!t) return res.status(400).json({ error: 'Некорректное время ухода' });
        checkOutAt = t;
      }
    }

    if (!checkInAt) {
      return res.status(400).json({ error: 'Укажите время прихода' });
    }
    if (checkOutAt && new Date(checkOutAt) <= new Date(checkInAt)) {
      return res.status(400).json({ error: 'Время ухода должно быть позже прихода' });
    }

    const editorId = req.session.userId || null;
    if (!row) {
      await pool.query(
        `INSERT INTO attendance_records
           (user_id, visit_date, check_in_at, check_out_at, edited_by_user_id, edited_at)
         VALUES ($1, $2::date, $3, $4, $5, NOW())`,
        [userId, dateStr, checkInAt, checkOutAt, editorId],
      );
    } else {
      const r = await pool.query(
        `UPDATE attendance_records
         SET check_in_at = $3, check_out_at = $4, manual_worked_minutes = NULL,
             edited_by_user_id = $5, edited_at = NOW()
         WHERE user_id = $1 AND visit_date = $2::date
         RETURNING id`,
        [userId, dateStr, checkInAt, checkOutAt, editorId],
      );
      if (!r.rowCount) {
        return res.status(404).json({ error: 'Запись посещения за этот день не найдена' });
      }
    }
    const monthKeyPatch = monthKeyFromDateStr(dateStr);
    if (monthKeyPatch) await ensureUserMonthRate(pool, userId, monthKeyPatch);
    const rec = await fetchAttendanceDayRecord(userId, dateStr);
    res.json({
      user_id: userId,
      date: dateStr,
      ...buildTimesheetDayPatch(rec),
    });
  } catch (e) {
    console.error('PATCH timesheet/times:', e);
    res.status(500).json({ error: e.message || 'Ошибка сохранения времени' });
  }
});

/** Ставки за месяц из табеля (только администратор) */
router.patch('/timesheet/rates', requireAdmin, async (req, res) => {
  const userId = parseInt(req.body?.user_id, 10);
  const monthKey = typeof req.body?.month === 'string' ? req.body.month.trim() : null;
  if (!userId) return res.status(400).json({ error: 'Укажите сотрудника' });
  if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) {
    return res.status(400).json({ error: 'Укажите месяц (YYYY-MM)' });
  }
  const hasHourly = Object.prototype.hasOwnProperty.call(req.body || {}, 'hourly_rate');
  const hasBonus = Object.prototype.hasOwnProperty.call(req.body || {}, 'bonus_rate');
  if (!hasHourly && !hasBonus) {
    return res.status(400).json({ error: 'Укажите ставку или ставку премии' });
  }

  const patch = {};
  if (hasHourly) patch.hourly_rate = parseHourlyRate(req.body.hourly_rate);
  if (hasBonus) patch.bonus_rate = parseHourlyRate(req.body.bonus_rate);

  try {
    const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (!userCheck.rowCount) return res.status(404).json({ error: 'Пользователь не найден' });

    const rates = await upsertMonthRates(pool, userId, monthKey, patch);

    const [y, m] = monthKey.split('-').map((x) => parseInt(x, 10));
    const fromStr = `${monthKey}-01`;
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const toStr = `${monthKey}-${String(lastDay).padStart(2, '0')}`;

    const recR = await pool.query(
      `${ATTENDANCE_DAY_SELECT}
       WHERE a.user_id = $1 AND a.visit_date >= $2::date AND a.visit_date <= $3::date`,
      [userId, fromStr, toStr],
    );
    let totalMins = 0;
    for (const rec of recR.rows) {
      const mins = resolveWorkedMinutes(rec);
      if (mins != null && mins > 0) totalMins += mins;
    }

    res.json({
      user_id: userId,
      month: monthKey,
      total_minutes: totalMins,
      ...buildPayTotals(rates.hourly_rate, rates.bonus_rate, totalMins),
    });
  } catch (e) {
    console.error('PATCH timesheet/rates:', e);
    res.status(500).json({ error: e.message || 'Ошибка сохранения ставок' });
  }
});

/** Все посещения (только администратор) */
router.get('/all', requireAdmin, async (req, res) => {
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
