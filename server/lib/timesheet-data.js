import pool from '../db/pool.js';
import {
  monthKeyFromDateStr,
  buildPayTotals,
  ensureMonthRates,
  fetchRatesMap,
} from './timesheet-month-rates.js';
import {
  formatTimeMoscowFull,
  buildTimesheetCellLabel,
  userMarkedByPayload,
  formatDateTimeMoscow,
} from './attendance-time.js';

const TZ_MSK = 'Europe/Moscow';

/** Календарный YYYY-MM-DD в Москве для момента времени (visit_date и колонки табеля) */
function dateKeyFromInstantInMoscow(d) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ_MSK,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const pick = (t) => parts.find((p) => p.type === t)?.value;
  const y = pick('year');
  const mo = pick('month');
  const day = pick('day');
  if (!y || !mo || !day) return null;
  return `${y}-${mo}-${day}`;
}

/**
 * Нормализация к YYYY-MM-DD по календарю Москвы.
 * Раньше для Date использовался UTC — при visit_date из PG и TZ сервера MSK день сдвигался на −1.
 */
export function toDateKey(val) {
  if (val == null) return null;
  if (typeof val === 'string') {
    const plain = val.match(/^(\d{4}-\d{2}-\d{2})$/);
    if (plain) return plain[1];
    const d = new Date(val);
    if (Number.isNaN(d.getTime())) return null;
    return dateKeyFromInstantInMoscow(d);
  }
  const d = val instanceof Date ? val : new Date(val);
  if (Number.isNaN(d.getTime())) return null;
  return dateKeyFromInstantInMoscow(d);
}

export function enumerateDays(fromStr, toStr) {
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

function workedMinutes(checkIn, checkOut) {
  if (!checkIn || !checkOut) return null;
  const a = new Date(checkIn).getTime();
  const b = new Date(checkOut).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return null;
  return Math.round((b - a) / 60000);
}

/** Момент последней отметки по лицу (сравнение с manual_minutes_updated_at — что новее) */
export function lastFaceMarkAt(rec) {
  if (!rec) return 0;
  if (rec.last_face_scan_at) {
    const t = new Date(rec.last_face_scan_at).getTime();
    return Number.isNaN(t) ? 0 : t;
  }
  let t = 0;
  for (const field of ['check_in_at', 'check_out_at']) {
    if (!rec[field]) continue;
    const ms = new Date(rec[field]).getTime();
    if (!Number.isNaN(ms)) t = Math.max(t, ms);
  }
  return t;
}

export async function deleteTimesheetDay(poolOrClient, userId, dateStr) {
  await poolOrClient.query(
    'DELETE FROM attendance_records WHERE user_id = $1 AND visit_date = $2::date',
    [userId, dateStr],
  );
}

/** Ручные минуты «новее» отметки по лицу — побеждают в ячейке (последнее действие по каналу часов) */
export function manualMinutesBeatScan(rec) {
  if (rec?.manual_worked_minutes == null || rec.manual_worked_minutes === '') return false;
  const manUp = rec.manual_minutes_updated_at
    ? new Date(rec.manual_minutes_updated_at).getTime()
    : (rec.edited_at ? new Date(rec.edited_at).getTime() : 0);
  const faceUp = lastFaceMarkAt(rec);
  return manUp > faceUp;
}

/** Итоговые минуты: последнее действие — либо ручной ввод часов, либо интервал по отметкам */
export function resolveWorkedMinutes(rec) {
  const autoFromSql = rec.worked_minutes != null ? Math.round(Number(rec.worked_minutes)) : null;
  const autoMins = autoFromSql ?? workedMinutes(rec.check_in_at, rec.check_out_at);

  const hasManual = rec.manual_worked_minutes != null && rec.manual_worked_minutes !== '';
  if (!hasManual) {
    if (autoMins != null && autoMins > 0) return autoMins;
    return null;
  }

  const m = Math.round(Number(rec.manual_worked_minutes));
  if (Number.isNaN(m) || m < 0) {
    if (autoMins != null && autoMins > 0) return autoMins;
    return null;
  }

  if (manualMinutesBeatScan(rec)) return m;
  if (autoMins != null && autoMins > 0) return autoMins;
  return m;
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

export function emptyTimesheetDayPatch() {
  return {
    record_id: null,
    status: 'empty',
    worked_minutes: null,
    manual_worked_minutes: null,
    manual_minutes_saved: null,
    worked_hours: null,
    worked_label: null,
    cell_label: null,
    check_in_at: null,
    check_out_at: null,
    check_in: null,
    check_out: null,
    marked_by: null,
    edited_by: null,
    edited_at: null,
    edited_at_label: null,
    day_comment: null,
    has_day_comment: false,
  };
}

function rowDayCommentTrim(rec) {
  if (!rec || rec.day_comment == null) return null;
  const s = String(rec.day_comment).trim();
  return s ? s.slice(0, 2000) : null;
}

export function buildTimesheetDayPatch(rec) {
  if (!rec) return emptyTimesheetDayPatch();

  const commentTrim = rowDayCommentTrim(rec);
  const mins = resolveWorkedMinutes(rec);
  const hasOut = !!rec.check_out_at;
  const manualWins = manualMinutesBeatScan(rec);
  const manualMins = manualWins && rec.manual_worked_minutes != null
    ? Math.round(Number(rec.manual_worked_minutes))
    : null;

  let manualMinutesSaved = null;
  if (rec.manual_worked_minutes != null && rec.manual_worked_minutes !== '') {
    const raw = Math.round(Number(rec.manual_worked_minutes));
    manualMinutesSaved = Number.isNaN(raw) ? null : raw;
  }

  let status = 'empty';
  if (manualMins === 0) {
    status = 'ok';
  } else if (rec.check_in_at) {
    if ((mins != null && mins > 0) || hasOut) status = 'ok';
    else status = 'partial';
  } else if (mins != null && mins > 0) {
    status = 'ok';
  } else if (manualMins != null) {
    status = 'ok';
  } else if (commentTrim) {
    status = 'ok';
  }

  return {
    record_id: rec.id,
    status,
    worked_minutes: mins,
    manual_worked_minutes: manualWins ? manualMins : null,
    manual_minutes_saved: manualMinutesSaved,
    worked_hours: mins != null ? Math.round((mins / 60) * 100) / 100 : null,
    worked_label: formatWorkedHours(mins),
    cell_label: buildTimesheetCellLabel(rec.check_in_at, rec.check_out_at, mins, commentTrim),
    check_in_at: rec.check_in_at,
    check_out_at: rec.check_out_at,
    check_in: formatTimeMoscowFull(rec.check_in_at),
    check_out: hasOut ? formatTimeMoscowFull(rec.check_out_at) : null,
    marked_by: joinUserPayload(rec, 'marked_by_user_id', 'mb'),
    edited_by: joinUserPayload(rec, 'edited_by_user_id', 'eb'),
    edited_at: rec.edited_at || null,
    edited_at_label: rec.edited_at ? formatDateTimeMoscow(rec.edited_at) : null,
    day_comment: commentTrim,
    has_day_comment: !!commentTrim,
  };
}

export const ATTENDANCE_DAY_SELECT = `
  SELECT a.id, a.user_id, a.visit_date, a.check_in_at, a.check_out_at,
         a.marked_by_user_id, a.manual_worked_minutes, a.manual_minutes_updated_at,
         a.edited_by_user_id, a.edited_at,
         a.last_face_scan_at, a.day_comment,
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

export async function fetchAttendanceDayRecord(userId, dateStr) {
  const r = await pool.query(
    `${ATTENDANCE_DAY_SELECT} WHERE a.user_id = $1 AND a.visit_date = $2::date`,
    [userId, dateStr],
  );
  return r.rows[0] || null;
}

function dayMapHasPresence(dayMap) {
  for (const rec of dayMap.values()) {
    if (rec.check_in_at || rec.check_out_at || rec.manual_worked_minutes != null) return true;
    if (rowDayCommentTrim(rec)) return true;
  }
  return false;
}

export function attendanceRecordIsEmpty(rec) {
  if (!rec) return true;
  if (rowDayCommentTrim(rec)) return false;
  return !rec.check_in_at
    && !rec.check_out_at
    && (rec.manual_worked_minutes == null || rec.manual_worked_minutes === '');
}

export async function finalizeTimesheetDay(poolOrClient, userId, dateStr, monthKey) {
  const rec = await fetchAttendanceDayRecord(userId, dateStr);
  if (attendanceRecordIsEmpty(rec)) {
    await deleteTimesheetDay(poolOrClient, userId, dateStr);
    if (monthKey) await pruneTimesheetMemberIfEmpty(poolOrClient, userId, monthKey);
    return emptyTimesheetDayPatch();
  }
  if (monthKey) await pruneTimesheetMemberIfEmpty(poolOrClient, userId, monthKey);
  return buildTimesheetDayPatch(rec);
}

/** Убрать из табеля месяца, если нет отметок и нулевые часы */
export async function pruneTimesheetMemberIfEmpty(poolOrClient, userId, monthKey) {
  if (!monthKey || !userId) return;
  const [y, m] = monthKey.split('-').map((x) => parseInt(x, 10));
  if (!y || !m) return;
  const fromStr = `${monthKey}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const toStr = `${monthKey}-${String(lastDay).padStart(2, '0')}`;

  const r = await poolOrClient.query(
    `SELECT 1 FROM attendance_records
     WHERE user_id = $1 AND visit_date >= $2::date AND visit_date <= $3::date
       AND (
         check_in_at IS NOT NULL
         OR check_out_at IS NOT NULL
         OR manual_worked_minutes IS NOT NULL
         OR (day_comment IS NOT NULL AND TRIM(day_comment) <> '')
       )
     LIMIT 1`,
    [userId, fromStr, toStr],
  );
  if (r.rowCount) return;

  await poolOrClient.query(
    'DELETE FROM timesheet_month_rates WHERE user_id = $1 AND month_key = $2',
    [userId, monthKey],
  );
}

export function orgLabel(name) {
  const s = name && String(name).trim();
  return s || 'Без организации';
}

export function groupEmployeesByOrg(employees) {
  const map = new Map();
  for (const emp of employees || []) {
    const label = orgLabel(emp.organization_name);
    if (!map.has(label)) map.set(label, []);
    map.get(label).push(emp);
  }
  return [...map.entries()]
    .sort(([a], [b]) => {
      if (a === 'Без организации') return 1;
      if (b === 'Без организации') return -1;
      return a.localeCompare(b, 'ru');
    })
    .map(([label, rows]) => ({ label, employees: rows }));
}

/** @param {{ from?: string, to?: string, isAdmin: boolean, selfUserId: number, forceIncludeUserIds?: number[] }} opts */
export async function loadTimesheet(opts) {
  const { isAdmin, selfUserId } = opts;
  const forceInclude = new Set((opts.forceIncludeUserIds || []).map((id) => Number(id)).filter(Boolean));
  let from = opts.from || null;
  let to = opts.to || null;

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
    const err = new Error('Некорректный период');
    err.status = 400;
    throw err;
  }

  const days = enumerateDays(fromStr, toStr);
  const monthKey = monthKeyFromDateStr(fromStr);

  const recParams = [fromStr, toStr];
  let recSql = `${ATTENDANCE_DAY_SELECT}
     WHERE a.visit_date >= $1::date AND a.visit_date <= $2::date`;
  if (!isAdmin) {
    recSql += ' AND a.user_id = $3';
    recParams.push(selfUserId);
  }
  recSql += ' ORDER BY a.user_id, a.visit_date';
  const recR = await pool.query(recSql, recParams);

  const uidNum = (id) => {
    const n = Number(id);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  let userIds = [...new Set(recR.rows.map((r) => uidNum(r.user_id)).filter(Boolean))];
  if (isAdmin && monthKey) {
    const rated = await pool.query(
      'SELECT DISTINCT user_id FROM timesheet_month_rates WHERE month_key = $1',
      [monthKey],
    );
    userIds = [
      ...new Set([
        ...userIds,
        ...rated.rows.map((r) => uidNum(r.user_id)).filter(Boolean),
        ...[...forceInclude].map((id) => uidNum(id)).filter(Boolean),
      ]),
    ];
  }
  if (!isAdmin) {
    const sid = Number(selfUserId);
    userIds = userIds.includes(sid) ? [sid] : [];
  }

  if (monthKey && userIds.length) {
    await ensureMonthRates(pool, monthKey, userIds);
  }
  const ratesMap = monthKey ? await fetchRatesMap(pool, monthKey, userIds) : new Map();

  let usersR = { rows: [] };
  if (userIds.length) {
    usersR = await pool.query(
      `SELECT u.id, u.login, u.display_name, u.first_name, u.last_name,
              u.organization_id,
              COALESCE(o.name, NULLIF(TRIM(u.employment_org), '')) AS organization_name
       FROM users u
       LEFT JOIN organizations o ON o.id = u.organization_id
       WHERE u.id = ANY($1::int[])
       ORDER BY organization_name NULLS LAST, u.last_name NULLS LAST, u.first_name NULLS LAST, u.login`,
      [userIds],
    );
  }

  const byUserDate = new Map();
  for (const rec of recR.rows) {
    const uid = uidNum(rec.user_id);
    if (!uid) continue;
    const d = toDateKey(rec.visit_date);
    if (!d) continue;
    if (!byUserDate.has(uid)) byUserDate.set(uid, new Map());
    byUserDate.get(uid).set(d, rec);
  }

  let employees = usersR.rows
    .map((u) => {
      const uid = uidNum(u.id);
      if (!uid) return null;
      const name = u.display_name || [u.first_name, u.last_name].filter(Boolean).join(' ') || u.login;
      const dayMap = byUserDate.get(uid) || new Map();
      let totalMins = 0;
      const cells = {};

      for (const d of days) {
        const rec = dayMap.get(d);
        if (!rec) {
          cells[d] = emptyTimesheetDayPatch();
          continue;
        }
        const patch = buildTimesheetDayPatch(rec);
        const mins = patch.worked_minutes;
        if (mins != null && mins > 0) totalMins += mins;
        cells[d] = patch;
      }

      const rates = ratesMap.get(uid) || {};
      const pay = buildPayTotals(rates.hourly_rate ?? null, rates.bonus_rate ?? null, totalMins);
      return {
        user_id: uid,
        name,
        login: u.login,
        first_name: u.first_name,
        last_name: u.last_name,
        organization_id: u.organization_id,
        organization_name: u.organization_name || null,
        total_minutes: totalMins,
        total_hours: Math.round((totalMins / 60) * 100) / 100,
        total_label: formatWorkedHours(totalMins) || '0 ч',
        days: cells,
        ...pay,
      };
    })
    .filter(Boolean);

  if (isAdmin && monthKey) {
    const toPrune = [];
    employees = employees.filter((emp) => {
      const eid = uidNum(emp.user_id);
      const dayMap = (eid && byUserDate.get(eid)) || new Map();
      const keep = emp.total_minutes > 0
        || dayMapHasPresence(dayMap)
        || (eid != null && forceInclude.has(eid));
      if (!keep && eid != null) toPrune.push(eid);
      return keep;
    });
    await Promise.all(toPrune.map((uid) => pruneTimesheetMemberIfEmpty(pool, uid, monthKey)));
  }

  return {
    from: fromStr,
    to: toStr,
    month: monthKey,
    days,
    employees,
  };
}
