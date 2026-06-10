import { Router } from 'express';
import multer from 'multer';
import pool from '../db/pool.js';
import { requireAuth, loadUser, requirePermission, requireAdmin } from '../middleware/auth.js';
import {
  canAttendanceViewAll,
  canAttendanceScopeToOwnOrganization,
  canAttendanceAddMember,
  canAttendanceExport,
  canAttendanceImport,
  requireAttendanceEdit,
  canAttendanceShowPay,
  requireAttendanceEditRates,
  stripTimesheetPay,
  resolveTimesheetRange,
  assertTimesheetMonthAllowed,
  assertTimesheetTargetUser,
} from '../lib/attendance-access.js';
import { parseFaceImageBase64, saveUserFacePhoto } from '../lib/face-photo.js';
import { parseHourlyRate } from '../lib/hourly-rate.js';
import {
  monthKeyFromDateStr,
  buildPayTotals,
  ensureUserMonthRate,
  upsertMonthRates,
} from '../lib/timesheet-month-rates.js';
import {
  parseWorkedHoursInput,
  parseMoscowDateTime,
} from '../lib/attendance-time.js';
import {
  loadTimesheet,
  toDateKey,
  buildTimesheetDayPatch,
  fetchAttendanceDayRecord,
  pruneTimesheetMemberIfEmpty,
  emptyTimesheetDayPatch,
  ATTENDANCE_DAY_SELECT,
  resolveWorkedMinutes,
  deleteTimesheetDay,
  finalizeTimesheetDay,
  attendanceRecordIsEmpty,
} from '../lib/timesheet-data.js';
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

function readNumberEnv(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

// Более строгие дефолты, чтобы снизить ложные срабатывания "чужого" пользователя.
const DIST_THRESHOLD = readNumberEnv('FACE_MATCH_THRESHOLD', 0.48);
const DIST_SELF_THRESHOLD = readNumberEnv('FACE_MATCH_SELF_THRESHOLD', 0.56);
const DIST_MIN_GAP = readNumberEnv('FACE_MATCH_MIN_GAP', 0.06);
const DIST_MAX_RATIO = readNumberEnv('FACE_MATCH_MAX_RATIO', 0.92);
const DIST_STRICT_SINGLE_THRESHOLD = readNumberEnv('FACE_MATCH_STRICT_SINGLE_THRESHOLD', 0.42);
const DIST_STRICT_SINGLE_GAP = readNumberEnv('FACE_MATCH_STRICT_SINGLE_GAP', 0.03);

function normalizeDescriptorVector(values) {
  if (!Array.isArray(values) || values.length !== 128) return null;
  const vector = values.map((x) => Number(x));
  if (vector.some((x) => !Number.isFinite(x))) return null;
  const norm = Math.hypot(...vector);
  if (!Number.isFinite(norm) || norm < 1e-9) return null;
  return vector.map((x) => x / norm);
}

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
  if (!Array.isArray(raw) || raw.length !== 128) return null;
  return normalizeDescriptorVector(raw);
}

function normalizeDescriptorBatch(raw) {
  if (Array.isArray(raw) && raw.length > 0 && Array.isArray(raw[0])) {
    const list = raw
      .map((item) => normalizeDescriptor(item))
      .filter(Boolean);
    return list.length ? list : null;
  }
  const one = normalizeDescriptor(raw);
  return one ? [one] : null;
}

function normalizeStoredDescriptor(raw) {
  if (!raw) return null;
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(parsed) || parsed.length !== 128) return null;
  return normalizeDescriptorVector(parsed);
}

function findBestFaceCandidate(descriptor, candidates, options = {}) {
  const threshold = Number.isFinite(options.threshold) ? Number(options.threshold) : DIST_THRESHOLD;
  let best = null;
  let bestDist = Infinity;
  let secondBestDist = Infinity;
  for (const row of candidates) {
    const stored = row._face_descriptor;
    if (!stored?.length) continue;
    const d = euclideanDistance(descriptor, stored);
    if (!Number.isFinite(d)) continue;
    if (d < bestDist) {
      secondBestDist = bestDist;
      bestDist = d;
      best = row;
    } else if (d < secondBestDist) {
      secondBestDist = d;
    }
  }
  if (!best || bestDist > threshold) return null;
  if (Number.isFinite(secondBestDist)) {
    const gap = secondBestDist - bestDist;
    const ratio = secondBestDist > 0 ? (bestDist / secondBestDist) : 1;
    // Если лучший и второй кандидат слишком близки — распознавание неоднозначно.
    if (gap < DIST_MIN_GAP || ratio > DIST_MAX_RATIO) return null;
  }
  return {
    user: best,
    distance: bestDist,
    second_distance: Number.isFinite(secondBestDist) ? secondBestDist : null,
  };
}

function average(arr) {
  if (!arr?.length) return Infinity;
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}

function matchUserByDescriptors(descriptors, candidates, options = {}) {
  const threshold = Number.isFinite(options.threshold) ? Number(options.threshold) : DIST_THRESHOLD;
  const singleCandidateMode = !!options.singleCandidateMode;
  const matches = [];
  for (const descriptor of descriptors) {
    const hit = findBestFaceCandidate(descriptor, candidates, { threshold });
    if (hit) matches.push(hit);
  }
  if (!matches.length) return null;

  const grouped = new Map();
  for (const hit of matches) {
    const id = Number(hit.user.id);
    const prev = grouped.get(id) || { user: hit.user, distances: [] };
    prev.distances.push(hit.distance);
    grouped.set(id, prev);
  }
  const ranked = Array.from(grouped.values())
    .map((row) => ({
      user: row.user,
      count: row.distances.length,
      avgDistance: average(row.distances),
      minDistance: Math.min(...row.distances),
    }))
    .sort((a, b) => (b.count - a.count) || (a.avgDistance - b.avgDistance));
  const top = ranked[0];
  if (!top) return null;

  const minVotes = singleCandidateMode ? 1 : (descriptors.length >= 3 ? 2 : 1);
  if (top.count < minVotes) {
    // Если консенсуса нет, разрешаем только очень уверенное одиночное совпадение
    // с заметным отрывом от второго кандидата.
    const second = ranked[1];
    const strongSingle = top.minDistance <= DIST_STRICT_SINGLE_THRESHOLD
      && (!second || (second.minDistance - top.minDistance) >= DIST_STRICT_SINGLE_GAP);
    if (!strongSingle) return null;
  }

  if (!singleCandidateMode) {
    const second = ranked[1];
    if (second) {
      if (second.count === top.count && Math.abs(top.avgDistance - second.avgDistance) < 0.025) {
        return null;
      }
      if (second.count === top.count && second.minDistance <= top.minDistance + 0.015) {
        return null;
      }
    }
  }

  if (top.avgDistance > threshold) return null;
  return {
    user: top.user,
    distance: top.avgDistance,
    matched_samples: top.count,
    total_samples: descriptors.length,
  };
}

async function loadFaceCandidates({ onlyUserId = null, organizationName = null } = {}) {
  const params = [];
  const whereParts = [
    'u.face_descriptor IS NOT NULL',
    "COALESCE(u.profile_active, true) = true",
    "COALESCE(u.employment_status, 'working') <> 'fired'",
  ];

  if (Number.isInteger(Number(onlyUserId)) && Number(onlyUserId) > 0) {
    params.push(Number(onlyUserId));
    whereParts.push(`u.id = $${params.length}`);
  }

  const normalizedOrg = normalizeOrgName(organizationName);
  if (normalizedOrg) {
    params.push(normalizedOrg);
    whereParts.push(`LOWER(TRIM(COALESCE(o.name, NULLIF(TRIM(u.employment_org), '')))) = $${params.length}`);
  }

  const r = await pool.query(
    `SELECT u.id, u.login, u.display_name, u.first_name, u.last_name, u.face_descriptor
     FROM users u
     LEFT JOIN organizations o ON o.id = u.organization_id
     WHERE ${whereParts.join('\n       AND ')}`,
    params,
  );
  return r.rows
    .map((row) => ({
      ...row,
      _face_descriptor: normalizeStoredDescriptor(row.face_descriptor),
    }))
    .filter((row) => Array.isArray(row._face_descriptor));
}

function normalizeOrgName(value) {
  return String(value || '').trim().toLowerCase();
}

async function resolveAttendanceOrganizationScope(user) {
  if (!canAttendanceScopeToOwnOrganization(user)) return null;
  const r = await pool.query(
    `SELECT COALESCE(o.name, NULLIF(TRIM(u.employment_org), '')) AS organization_name
     FROM users u
     LEFT JOIN organizations o ON o.id = u.organization_id
     WHERE u.id = $1`,
    [user.id],
  );
  const orgName = r.rows[0]?.organization_name ? String(r.rows[0].organization_name).trim() : '';
  if (!orgName) {
    const err = new Error('Для этой роли доступ к табелю ограничен организацией, но у пользователя не указана организация');
    err.status = 403;
    throw err;
  }
  return { organizationName: orgName };
}

async function assertTargetUserInAttendanceScope(userId, scope) {
  if (!scope?.organizationName) return;
  const r = await pool.query(
    `SELECT COALESCE(o.name, NULLIF(TRIM(u.employment_org), '')) AS organization_name
     FROM users u
     LEFT JOIN organizations o ON o.id = u.organization_id
     WHERE u.id = $1`,
    [userId],
  );
  if (!r.rowCount) {
    const err = new Error('Сотрудник не найден');
    err.status = 404;
    throw err;
  }
  const targetOrg = normalizeOrgName(r.rows[0]?.organization_name);
  if (!targetOrg || targetOrg !== normalizeOrgName(scope.organizationName)) {
    const err = new Error('Нет доступа к табелю сотрудника из другой организации');
    err.status = 403;
    throw err;
  }
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


  res.json({
    ok: true,
    user_id: targetId,
    has_face: true,
    face_photo: facePhoto,
  });
});

/** Распознать лицо и отметить приход/уход за сегодня */
router.post('/scan', requirePermission('can_face'), async (req, res) => {
  const descriptors = normalizeDescriptorBatch(
    req.body?.descriptors ?? req.body?.descriptor,
  );
  if (!descriptors) {
    return res.status(400).json({ error: 'Передайте descriptor (128 чисел) или descriptors (массив векторов)' });
  }
  const currentUserId = Number(req.session.userId || req.user.id || 0) || null;
  const canMarkAll = req.user.role === 'admin' || (!!req.user.can_face_all && !req.user.can_face_same_org);
  const canMarkSameOrg = req.user.role !== 'admin' && !!req.user.can_face_all && !!req.user.can_face_same_org;
  let faceScope = 'self';
  if (canMarkAll) faceScope = 'all';
  else if (canMarkSameOrg) faceScope = 'same_org';

  let candidates = [];
  if (faceScope === 'all') {
    candidates = await loadFaceCandidates();
  } else if (faceScope === 'same_org') {
    const orgName = normalizeOrgName(req.user.organization_name);
    if (!orgName) {
      return res.status(403).json({
        error: 'Для этой роли отметка ограничена своей организацией, но у пользователя не указана организация',
      });
    }
    candidates = await loadFaceCandidates({ organizationName: orgName });
  } else {
    candidates = await loadFaceCandidates({ onlyUserId: currentUserId });
  }

  if (faceScope === 'self' && !candidates.length) {
    return res.status(404).json({ error: 'У вас не записан шаблон лица. Обратитесь к администратору.' });
  }
  const match = matchUserByDescriptors(descriptors, candidates, {
    threshold: faceScope === 'self' ? DIST_SELF_THRESHOLD : DIST_THRESHOLD,
    singleCandidateMode: faceScope === 'self',
  });
  if (!match) {
    return res.status(404).json({ error: 'Лицо не распознано. Зарегистрируйте шаблон в профиле или у администратора.' });
  }
  const userId = match.user.id;

  /** Текст YYYY-MM-DD по Москве — без сдвига при передаче в PG/JSON как у JS Date */
  const visitDate = (await pool.query(
    `SELECT to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Moscow')::date, 'YYYY-MM-DD') AS d`,
  )).rows[0]?.d;
  if (!visitDate) {
    return res.status(500).json({ error: 'Не удалось определить дату посещения' });
  }

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
        `INSERT INTO attendance_records (
           user_id, visit_date, check_in_at, check_out_at, marked_by_user_id,
           check_in_by_user_id, check_in_via, last_face_scan_at
         )
         VALUES ($1, $2, $3, NULL, $4, $4, 'face', $3)
         RETURNING id, user_id, visit_date, check_in_at, check_out_at, marked_by_user_id`,
        [userId, visitDate, now, markedById]
      );
      await client.query('COMMIT');
      const monthKeyScan = monthKeyFromDateStr(visitDate);
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
        matched_samples: match.matched_samples || 1,
        total_samples: match.total_samples || 1,
      });
    }

    const upd = await client.query(
      `UPDATE attendance_records
       SET check_out_at = $1,
           check_out_by_user_id = $2,
           check_out_via = 'face',
           marked_by_user_id = $2,
           edited_by_user_id = NULL,
           edited_at = NULL,
           times_edited_at = NULL,
           last_face_scan_at = $1
       WHERE id = $3
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
      matched_samples: match.matched_samples || 1,
      total_samples: match.total_samples || 1,
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

/** Табель: администратор — все сотрудники; остальные — только своя строка */
router.get('/timesheet', requirePermission('can_attendance'), async (req, res) => {
  try {
    const range = resolveTimesheetRange(req.user, req.query.from || null, req.query.to || null);
    const orgScope = await resolveAttendanceOrganizationScope(req.user);
    const data = await loadTimesheet({
      from: range.from,
      to: range.to,
      isAdmin: canAttendanceViewAll(req.user),
      selfUserId: Number(req.user.id),
      scopeOrganizationName: orgScope?.organizationName || null,
    });
    res.json(canAttendanceShowPay(req.user) ? data : stripTimesheetPay(data));
  } catch (e) {
    if (e.status === 400 || e.status === 403) return res.status(e.status).json({ error: e.message });
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
router.get('/timesheet/export', requirePermission('can_attendance'), async (req, res) => {
  if (!canAttendanceExport(req.user)) {
    return res.status(403).json({ error: 'Нет прав на экспорт табеля' });
  }
  try {
    const range = resolveTimesheetRange(req.user, req.query.from || null, req.query.to || null);
    const orgScope = await resolveAttendanceOrganizationScope(req.user);
    const data = await loadTimesheet({
      from: range.from,
      to: range.to,
      isAdmin: canAttendanceViewAll(req.user),
      selfUserId: Number(req.user.id),
      scopeOrganizationName: orgScope?.organizationName || null,
    });
    const organization = req.query.organization ? String(req.query.organization) : null;
    if (orgScope?.organizationName && organization && normalizeOrgName(organization) !== normalizeOrgName(orgScope.organizationName)) {
      return res.status(403).json({ error: 'Нет доступа к табелю другой организации' });
    }
    const buf = buildTimesheetWorkbook(data, { organization });
    const month = data.month || 'period';
    const name = organization
      ? `tabel-${month}-${safeFilenamePart(organization)}.xlsx`
      : `tabel-${month}-obshiy.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(name)}"`);
    res.send(buf);
  } catch (e) {
    if (e.status === 400 || e.status === 403) return res.status(e.status).json({ error: e.message });
    console.error('GET timesheet/export:', e);
    res.status(500).json({ error: 'Ошибка экспорта' });
  }
});

/** Импорт табеля из Excel */
router.post('/timesheet/import', requirePermission('can_attendance'), (req, res, next) => {
  if (!canAttendanceImport(req.user)) {
    return res.status(403).json({ error: 'Нет прав на импорт табеля' });
  }
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
    const orgScope = await resolveAttendanceOrganizationScope(req.user);
    if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) {
      return res.status(400).json({ error: 'Укажите месяц (YYYY-MM) в параметре или в файле' });
    }
    try {
      assertTimesheetMonthAllowed(req.user, monthKey);
    } catch (e) {
      return res.status(e.status || 403).json({ error: e.message });
    }
    const result = await applyTimesheetImport({
      monthKey,
      rows: parsed.rows,
      editorId: req.session.userId || null,
      organizationNameScope: orgScope?.organizationName || null,
    });
    res.json({
      ok: true,
      month: monthKey,
      applied: result.applied,
      errors: result.errors,
    });
  } catch (e) {
    if (e.status === 400 || e.status === 403) return res.status(e.status).json({ error: e.message });
    console.error('POST timesheet/import:', e);
    res.status(500).json({ error: e.message || 'Ошибка импорта' });
  }
});

/** Пользователи, которых можно добавить в табель месяца */
router.get('/timesheet/candidates', requirePermission('can_attendance'), async (req, res) => {
  if (!canAttendanceAddMember(req.user)) {
    return res.status(403).json({ error: 'Нет прав на добавление сотрудника в табель' });
  }
  try {
    const monthKey = typeof req.query.month === 'string' ? req.query.month.trim() : '';
    if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) {
      return res.status(400).json({ error: 'Укажите месяц (YYYY-MM)' });
    }
    const orgScope = await resolveAttendanceOrganizationScope(req.user);
    try {
      assertTimesheetMonthAllowed(req.user, monthKey);
    } catch (e) {
      return res.status(e.status || 403).json({ error: e.message });
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
      scopeOrganizationName: orgScope?.organizationName || null,
    });
    const inSheet = new Set(
      data.employees.map((e) => Number(e.user_id)).filter((id) => Number.isFinite(id)),
    );
    const candidateParams = [];
    let candidateSql = `SELECT u.id, u.login, u.display_name, u.first_name, u.last_name,
                               COALESCE(o.name, NULLIF(TRIM(u.employment_org), '')) AS organization_name
                        FROM users u
                        LEFT JOIN organizations o ON o.id = u.organization_id`;
    if (orgScope?.organizationName) {
      candidateSql += `
        WHERE LOWER(TRIM(COALESCE(o.name, NULLIF(TRIM(u.employment_org), '')))) = LOWER(TRIM($1))`;
      candidateParams.push(orgScope.organizationName);
    }
    candidateSql += ' ORDER BY u.last_name NULLS LAST, u.first_name NULLS LAST, u.login';
    const all = await pool.query(candidateSql, candidateParams);
    const candidates = all.rows
      .filter((u) => !inSheet.has(Number(u.id)))
      .map((u) => ({
        id: u.id,
        login: u.login,
        name: u.display_name || [u.first_name, u.last_name].filter(Boolean).join(' ') || u.login,
        organization_name: u.organization_name || null,
      }));
    res.json(candidates);
  } catch (e) {
    if (e.status === 403) return res.status(403).json({ error: e.message });
    console.error('GET timesheet/candidates:', e);
    res.status(500).json({ error: 'Ошибка загрузки списка' });
  }
});

/** Добавить сотрудника в табель месяца вручную */
router.post('/timesheet/members', requirePermission('can_attendance'), async (req, res) => {
  if (!canAttendanceAddMember(req.user)) {
    return res.status(403).json({ error: 'Нет прав на добавление сотрудника в табель' });
  }
  try {
    const userId = parseInt(req.body?.user_id, 10);
    const monthKey = typeof req.body?.month === 'string' ? req.body.month.trim() : '';
    if (!userId) return res.status(400).json({ error: 'Выберите сотрудника' });
    if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) {
      return res.status(400).json({ error: 'Укажите месяц (YYYY-MM)' });
    }
    const orgScope = await resolveAttendanceOrganizationScope(req.user);
    assertTimesheetMonthAllowed(req.user, monthKey);
    const exists = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (!exists.rowCount) return res.status(404).json({ error: 'Пользователь не найден' });
    await assertTargetUserInAttendanceScope(userId, orgScope);

    await ensureUserMonthRate(pool, userId, monthKey);

    const [y, m] = monthKey.split('-').map((x) => parseInt(x, 10));
    const fromStr = `${monthKey}-01`;
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const toStr = `${monthKey}-${String(lastDay).padStart(2, '0')}`;

    /** День в пределах выбранного месяца: «сегодня» по Москве, иначе граница месяца */
    const todayR = await pool.query(
      `SELECT to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Moscow')::date, 'YYYY-MM-DD') AS d`,
    );
    let visitDateStr = todayR.rows[0]?.d;
    if (!visitDateStr) {
      return res.status(500).json({ error: 'Не удалось определить дату' });
    }
    if (visitDateStr < fromStr) visitDateStr = fromStr;
    else if (visitDateStr > toStr) visitDateStr = toStr;

    const editorId = req.session.userId || null;
    const existingDay = await pool.query(
      'SELECT id FROM attendance_records WHERE user_id = $1 AND visit_date = $2::date',
      [userId, visitDateStr],
    );
    if (!existingDay.rowCount) {
      await pool.query(
        `INSERT INTO attendance_records (user_id, visit_date, manual_worked_minutes, manual_minutes_updated_at, edited_by_user_id, edited_at)
         VALUES ($1, $2::date, 1, NOW(), $3, NOW())`,
        [userId, visitDateStr, editorId],
      );
    }

    const data = await loadTimesheet({
      from: fromStr,
      to: toStr,
      isAdmin: true,
      selfUserId: Number(req.user.id),
      forceIncludeUserIds: [userId],
      scopeOrganizationName: orgScope?.organizationName || null,
    });
    const employee = data.employees.find((e) => Number(e.user_id) === userId);
    if (!employee) {
      return res.status(500).json({ error: 'Не удалось добавить в табель' });
    }
    res.status(201).json({ employee });
  } catch (e) {
    if (e.status === 403 || e.status === 404) return res.status(e.status).json({ error: e.message });
    console.error('POST timesheet/members:', e);
    res.status(500).json({ error: e.message || 'Ошибка добавления' });
  }
});

/** Сохранение ячейки табеля: время и/или часы, либо полная очистка */
router.patch('/timesheet/day', requirePermission('can_attendance'), requireAttendanceEdit, async (req, res) => {
  const userId = parseInt(req.body?.user_id, 10);
  const dateStr = toDateKey(req.body?.date);
  if (!userId || !dateStr) {
    return res.status(400).json({ error: 'Укажите сотрудника и дату' });
  }
  try {
    const orgScope = await resolveAttendanceOrganizationScope(req.user);
    assertTimesheetTargetUser(req.user, userId);
    await assertTargetUserInAttendanceScope(userId, orgScope);
    assertTimesheetMonthAllowed(req.user, monthKeyFromDateStr(dateStr));
  } catch (e) {
    return res.status(e.status || 403).json({ error: e.message });
  }

  const clearCell = req.body?.clear === true;
  const hasHoursField = Object.prototype.hasOwnProperty.call(req.body || {}, 'worked_hours')
    || Object.prototype.hasOwnProperty.call(req.body || {}, 'worked_minutes');
  const hasIn = Object.prototype.hasOwnProperty.call(req.body || {}, 'check_in');
  const hasOut = Object.prototype.hasOwnProperty.call(req.body || {}, 'check_out');
  const hasCommentField = Object.prototype.hasOwnProperty.call(req.body || {}, 'day_comment');
  const sanitizeDayComment = (v) => {
    if (v == null || v === '') return null;
    const s = String(v).trim().slice(0, 2000);
    return s || null;
  };
  const dayCommentNext = hasCommentField ? sanitizeDayComment(req.body.day_comment) : undefined;

  const manualMins = hasHoursField
    ? (Object.prototype.hasOwnProperty.call(req.body || {}, 'worked_minutes')
      ? (req.body.worked_minutes === null || req.body.worked_minutes === ''
        ? null
        : Math.round(Number(req.body.worked_minutes)))
      : parseWorkedHoursInput(req.body.worked_hours))
    : undefined;

  if (manualMins != null && (Number.isNaN(manualMins) || manualMins < 0)) {
    return res.status(400).json({ error: 'Некорректное значение часов' });
  }

  try {
    const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (!userCheck.rowCount) {
      return res.status(404).json({ error: 'Сотрудник не найден' });
    }

    const monthKeyPatch = monthKeyFromDateStr(dateStr);
    const editorId = req.session.userId || null;

    if (clearCell) {
      await deleteTimesheetDay(pool, userId, dateStr);
      if (monthKeyPatch) await pruneTimesheetMemberIfEmpty(pool, userId, monthKeyPatch);
      return res.json({
        user_id: userId,
        date: dateStr,
        ...emptyTimesheetDayPatch(),
      });
    }

    const existing = await pool.query(
      `SELECT id, check_in_at, check_out_at, manual_worked_minutes
       FROM attendance_records WHERE user_id = $1 AND visit_date = $2::date`,
      [userId, dateStr],
    );
    let row = existing.rows[0];

    const parseAdminTime = (value, label) => {
      if (value === null || value === '') return null;
      const t = parseMoscowDateTime(dateStr, value);
      if (!t) {
        const err = new Error(`Некорректное время ${label}`);
        err.status = 400;
        throw err;
      }
      return t;
    };

    const timesTouched = hasIn || hasOut;
    if (timesTouched) {
      let checkInAt = row?.check_in_at ?? null;
      let checkOutAt = row?.check_out_at ?? null;

      if (hasIn) {
        checkInAt = parseAdminTime(req.body.check_in, 'прихода');
      }
      if (hasOut) {
        checkOutAt = parseAdminTime(req.body.check_out, 'ухода');
      }

      if (checkInAt && checkOutAt && new Date(checkOutAt) <= new Date(checkInAt)) {
        return res.status(400).json({ error: 'Время ухода должно быть позже прихода' });
      }

      if (!checkInAt && !checkOutAt && (!hasHoursField || manualMins == null)) {
        const keepForComment = Boolean(hasCommentField && dayCommentNext);
        if (!keepForComment) {
          await deleteTimesheetDay(pool, userId, dateStr);
          if (monthKeyPatch) await ensureUserMonthRate(pool, userId, monthKeyPatch);
          return res.json({
            user_id: userId,
            date: dateStr,
            ...emptyTimesheetDayPatch(),
          });
        }
      }

      if (checkInAt || checkOutAt || hasIn || hasOut) {
        if (!row) {
          const ins = await pool.query(
            `INSERT INTO attendance_records (
               user_id, visit_date, check_in_at, check_out_at,
               check_in_by_user_id, check_out_by_user_id, check_in_via, check_out_via,
               edited_by_user_id, edited_at, times_edited_at
             )
             VALUES (
               $1, $2::date, $3, $4,
               CASE WHEN $3::timestamptz IS NOT NULL THEN $5::int ELSE NULL END,
               CASE WHEN $4::timestamptz IS NOT NULL THEN $5::int ELSE NULL END,
               CASE WHEN $3::timestamptz IS NOT NULL THEN 'manual' ELSE NULL END,
               CASE WHEN $4::timestamptz IS NOT NULL THEN 'manual' ELSE NULL END,
               $5, NOW(), NOW()
             )
             RETURNING id`,
            [userId, dateStr, checkInAt, checkOutAt, editorId],
          );
          row = { id: ins.rows[0].id };
        } else {
          const setParts = [];
          const params = [userId, dateStr];
          let p = 3;
          if (hasIn) {
            setParts.push(`check_in_at = $${p++}`);
            params.push(checkInAt);
            if (checkInAt) {
              setParts.push(`check_in_by_user_id = $${p++}`, `check_in_via = 'manual'`);
              params.push(editorId);
            } else {
              setParts.push('check_in_by_user_id = NULL', 'check_in_via = NULL');
            }
          }
          if (hasOut) {
            setParts.push(`check_out_at = $${p++}`);
            params.push(checkOutAt);
            if (checkOutAt) {
              setParts.push(`check_out_by_user_id = $${p++}`, `check_out_via = 'manual'`);
              params.push(editorId);
            } else {
              setParts.push('check_out_by_user_id = NULL', 'check_out_via = NULL');
            }
          }
          setParts.push(`edited_by_user_id = $${p++}`, 'edited_at = NOW()', 'times_edited_at = NOW()');
          params.push(editorId);
          await pool.query(
            `UPDATE attendance_records SET ${setParts.join(', ')}
             WHERE user_id = $1 AND visit_date = $2::date`,
            params,
          );
        }
      } else if (row) {
        await pool.query(
          `UPDATE attendance_records
           SET check_in_at = NULL,
               check_out_at = NULL,
               check_in_by_user_id = NULL,
               check_out_by_user_id = NULL,
               check_in_via = NULL,
               check_out_via = NULL,
               manual_worked_minutes = NULL,
               manual_minutes_updated_at = NOW(),
               edited_by_user_id = $3,
               edited_at = NOW(),
               times_edited_at = NOW()
           WHERE user_id = $1 AND visit_date = $2::date`,
          [userId, dateStr, editorId],
        );
      }
    }

    if (hasHoursField && manualMins != null) {
      if (!row) {
        const ins = await pool.query(
          `INSERT INTO attendance_records
             (user_id, visit_date, manual_worked_minutes, manual_minutes_updated_at, edited_by_user_id, edited_at)
           VALUES ($1, $2::date, $3, NOW(), $4, NOW())
           RETURNING id`,
          [userId, dateStr, manualMins, editorId],
        );
        row = { id: ins.rows[0].id };
      } else {
        await pool.query(
          `UPDATE attendance_records
           SET manual_worked_minutes = $3,
               manual_minutes_updated_at = NOW(),
               edited_by_user_id = $4,
               edited_at = NOW()
           WHERE user_id = $1 AND visit_date = $2::date`,
          [userId, dateStr, manualMins, editorId],
        );
      }
    } else if (hasHoursField && manualMins == null && row) {
      await pool.query(
        `UPDATE attendance_records
         SET manual_worked_minutes = NULL,
             manual_minutes_updated_at = NOW(),
             edited_by_user_id = $3,
             edited_at = NOW()
         WHERE user_id = $1 AND visit_date = $2::date`,
        [userId, dateStr, editorId],
      );
    }

    if (hasCommentField) {
      const c = dayCommentNext;
      if (!row) {
        if (c) {
          const insC = await pool.query(
            `INSERT INTO attendance_records (user_id, visit_date, day_comment, edited_by_user_id, edited_at)
             VALUES ($1, $2::date, $3, $4, NOW())
             RETURNING id`,
            [userId, dateStr, c, editorId],
          );
          row = { id: insC.rows[0].id };
        }
      } else {
        await pool.query(
          `UPDATE attendance_records
           SET day_comment = $3, edited_by_user_id = COALESCE($4, edited_by_user_id), edited_at = NOW()
           WHERE user_id = $1 AND visit_date = $2::date`,
          [userId, dateStr, c, editorId],
        );
      }
    }

    if (monthKeyPatch) await ensureUserMonthRate(pool, userId, monthKeyPatch);
    const dayPatch = await finalizeTimesheetDay(pool, userId, dateStr, monthKeyPatch);
    res.json({
      user_id: userId,
      date: dateStr,
      ...dayPatch,
    });
  } catch (e) {
    console.error('PATCH timesheet/day:', e);
    if (e.status === 400) return res.status(400).json({ error: e.message });
    res.status(500).json({ error: e.message || 'Ошибка сохранения' });
  }
});

/** Ручная правка отработанных часов за день (только администратор) */
router.patch('/timesheet/hours', requirePermission('can_attendance'), async (req, res) => {
  const userId = parseInt(req.body?.user_id, 10);
  const dateStr = toDateKey(req.body?.date);
  if (!userId || !dateStr) {
    return res.status(400).json({ error: 'Укажите сотрудника и дату' });
  }
  try {
    const orgScope = await resolveAttendanceOrganizationScope(req.user);
    assertTimesheetTargetUser(req.user, userId);
    await assertTargetUserInAttendanceScope(userId, orgScope);
    assertTimesheetMonthAllowed(req.user, monthKeyFromDateStr(dateStr));
  } catch (e) {
    return res.status(e.status || 403).json({ error: e.message });
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
      `SELECT id, check_in_at, check_out_at FROM attendance_records
       WHERE user_id = $1 AND visit_date = $2::date`,
      [userId, dateStr],
    );
    const row = existing.rows[0];
    const editorId = req.session.userId || null;
    const monthKeyPatch = monthKeyFromDateStr(dateStr);

    if (!row) {
      if (manualMins == null) {
        return res.status(400).json({ error: 'Укажите отработанные часы' });
      }
      await pool.query(
        `INSERT INTO attendance_records
           (user_id, visit_date, manual_worked_minutes, manual_minutes_updated_at, edited_by_user_id, edited_at)
         VALUES ($1, $2::date, $3, NOW(), $4, NOW())`,
        [userId, dateStr, manualMins, editorId],
      );
    } else if (manualMins == null) {
      await pool.query(
        `UPDATE attendance_records
         SET manual_worked_minutes = NULL,
             manual_minutes_updated_at = NOW(),
             edited_by_user_id = $3,
             edited_at = NOW()
         WHERE user_id = $1 AND visit_date = $2::date`,
        [userId, dateStr, editorId],
      );
    } else {
      const r = await pool.query(
        `UPDATE attendance_records
         SET manual_worked_minutes = $3,
             manual_minutes_updated_at = NOW(),
             edited_by_user_id = $4,
             edited_at = NOW()
         WHERE user_id = $1 AND visit_date = $2::date
         RETURNING id`,
        [userId, dateStr, manualMins, editorId],
      );
      if (!r.rowCount) {
        return res.status(404).json({ error: 'Запись посещения за этот день не найдена' });
      }
    }

    if (monthKeyPatch) await ensureUserMonthRate(pool, userId, monthKeyPatch);
    const dayPatch = await finalizeTimesheetDay(pool, userId, dateStr, monthKeyPatch);
    res.json({
      user_id: userId,
      date: dateStr,
      ...dayPatch,
    });
  } catch (e) {
    console.error('PATCH timesheet/hours:', e);
    res.status(500).json({ error: e.message || 'Ошибка сохранения часов' });
  }
});

/** Ручная правка времени прихода и ухода (только администратор) */
router.patch('/timesheet/times', requirePermission('can_attendance'), requireAttendanceEdit, async (req, res) => {
  const userId = parseInt(req.body?.user_id, 10);
  const dateStr = toDateKey(req.body?.date);
  if (!userId || !dateStr) {
    return res.status(400).json({ error: 'Укажите сотрудника и дату' });
  }
  try {
    const orgScope = await resolveAttendanceOrganizationScope(req.user);
    assertTimesheetTargetUser(req.user, userId);
    await assertTargetUserInAttendanceScope(userId, orgScope);
    assertTimesheetMonthAllowed(req.user, monthKeyFromDateStr(dateStr));
  } catch (e) {
    return res.status(e.status || 403).json({ error: e.message });
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
      if (req.body.check_in === null || req.body.check_in === '') {
        checkInAt = null;
      } else {
        const t = parseMoscowDateTime(dateStr, req.body.check_in);
        if (!t) return res.status(400).json({ error: 'Некорректное время прихода' });
        checkInAt = t;
      }
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

    if (!checkInAt && !checkOutAt) {
      await deleteTimesheetDay(pool, userId, dateStr);
      const monthKeyPatch = monthKeyFromDateStr(dateStr);
      if (monthKeyPatch) await pruneTimesheetMemberIfEmpty(pool, userId, monthKeyPatch);
      return res.json({
        user_id: userId,
        date: dateStr,
        ...emptyTimesheetDayPatch(),
      });
    }

    if (checkInAt && checkOutAt && new Date(checkOutAt) <= new Date(checkInAt)) {
      return res.status(400).json({ error: 'Время ухода должно быть позже прихода' });
    }

    const editorId = req.session.userId || null;
    if (!row) {
      await pool.query(
        `INSERT INTO attendance_records (
           user_id, visit_date, check_in_at, check_out_at,
           check_in_by_user_id, check_out_by_user_id, check_in_via, check_out_via,
           edited_by_user_id, edited_at, times_edited_at
         )
         VALUES (
           $1, $2::date, $3, $4,
           CASE WHEN $3::timestamptz IS NOT NULL THEN $5::int ELSE NULL END,
           CASE WHEN $4::timestamptz IS NOT NULL THEN $5::int ELSE NULL END,
           CASE WHEN $3::timestamptz IS NOT NULL THEN 'manual' ELSE NULL END,
           CASE WHEN $4::timestamptz IS NOT NULL THEN 'manual' ELSE NULL END,
           $5, NOW(), NOW()
         )`,
        [userId, dateStr, checkInAt, checkOutAt, editorId],
      );
    } else {
      const setParts = [];
      const params = [userId, dateStr];
      let p = 3;
      if (hasIn) {
        setParts.push(`check_in_at = $${p++}`);
        params.push(checkInAt);
        if (checkInAt) {
          setParts.push(`check_in_by_user_id = $${p++}`, `check_in_via = 'manual'`);
          params.push(editorId);
        } else {
          setParts.push('check_in_by_user_id = NULL', 'check_in_via = NULL');
        }
      }
      if (hasOut) {
        setParts.push(`check_out_at = $${p++}`);
        params.push(checkOutAt);
        if (checkOutAt) {
          setParts.push(`check_out_by_user_id = $${p++}`, `check_out_via = 'manual'`);
          params.push(editorId);
        } else {
          setParts.push('check_out_by_user_id = NULL', 'check_out_via = NULL');
        }
      }
      setParts.push(`edited_by_user_id = $${p++}`, 'edited_at = NOW()', 'times_edited_at = NOW()');
      params.push(editorId);
      const r = await pool.query(
        `UPDATE attendance_records SET ${setParts.join(', ')}
         WHERE user_id = $1 AND visit_date = $2::date
         RETURNING id`,
        params,
      );
      if (!r.rowCount) {
        return res.status(404).json({ error: 'Запись посещения за этот день не найдена' });
      }
    }
    const monthKeyPatch = monthKeyFromDateStr(dateStr);
    if (monthKeyPatch) await ensureUserMonthRate(pool, userId, monthKeyPatch);
    const dayPatch = await finalizeTimesheetDay(pool, userId, dateStr, monthKeyPatch);
    res.json({
      user_id: userId,
      date: dateStr,
      ...dayPatch,
    });
  } catch (e) {
    console.error('PATCH timesheet/times:', e);
    res.status(500).json({ error: e.message || 'Ошибка сохранения времени' });
  }
});

/** Ставки за месяц из табеля (только администратор) */
router.patch('/timesheet/rates', requirePermission('can_attendance'), requireAttendanceEditRates, async (req, res) => {
  const userId = parseInt(req.body?.user_id, 10);
  const monthKey = typeof req.body?.month === 'string' ? req.body.month.trim() : null;
  if (!userId) return res.status(400).json({ error: 'Укажите сотрудника' });
  if (!canAttendanceShowPay(req.user)) {
    return res.status(403).json({ error: 'Расчёт ЗП недоступен для этой роли' });
  }
  try {
    const orgScope = await resolveAttendanceOrganizationScope(req.user);
    assertTimesheetTargetUser(req.user, userId);
    await assertTargetUserInAttendanceScope(userId, orgScope);
  } catch (e) {
    return res.status(e.status || 403).json({ error: e.message });
  }
  if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) {
    return res.status(400).json({ error: 'Укажите месяц (YYYY-MM)' });
  }
  try {
    assertTimesheetMonthAllowed(req.user, monthKey);
  } catch (e) {
    return res.status(e.status || 403).json({ error: e.message });
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
router.get('/all', requirePermission('can_attendance'), async (req, res) => {
  if (!canAttendanceViewAll(req.user)) {
    return res.status(403).json({ error: 'Нет доступа' });
  }
  let orgScope = null;
  try {
    orgScope = await resolveAttendanceOrganizationScope(req.user);
  } catch (e) {
    return res.status(e.status || 403).json({ error: e.message });
  }
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
  if (orgScope?.organizationName) {
    q += ` AND LOWER(TRIM(COALESCE(
      (
        SELECT o_scope.name
        FROM organizations o_scope
        WHERE o_scope.id = u.organization_id
      ),
      NULLIF(TRIM(u.employment_org), '')
    ))) = LOWER(TRIM($${n++}))`;
    params.push(orgScope.organizationName);
  }
  q += ` ORDER BY a.visit_date DESC, a.check_in_at DESC`;
  const r = await pool.query(q, params);
  res.json(r.rows);
});

export default router;
