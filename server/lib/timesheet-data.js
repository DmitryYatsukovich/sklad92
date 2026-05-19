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

export function toDateKey(val) {
  if (val == null) return null;
  if (typeof val === 'string') {
    const m = val.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  const d = val instanceof Date ? val : new Date(val);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
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

export function buildTimesheetDayPatch(rec) {
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

/** @param {{ from?: string, to?: string, isAdmin: boolean, selfUserId: number }} opts */
export async function loadTimesheet(opts) {
  const { isAdmin, selfUserId } = opts;
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

  let userIds = [...new Set(recR.rows.map((r) => r.user_id))];
  if (isAdmin && monthKey) {
    const rated = await pool.query(
      'SELECT DISTINCT user_id FROM timesheet_month_rates WHERE month_key = $1',
      [monthKey],
    );
    userIds = [...new Set([...userIds, ...rated.rows.map((r) => r.user_id)])];
  }
  if (!isAdmin) {
    userIds = userIds.includes(selfUserId) ? [selfUserId] : [];
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
      const mins = resolveWorkedMinutes(rec);
      if (mins != null && mins > 0) totalMins += mins;
      cells[d] = buildTimesheetDayPatch(rec);
    }

    const rates = ratesMap.get(u.id) || {};
    const pay = buildPayTotals(rates.hourly_rate ?? null, rates.bonus_rate ?? null, totalMins);
    return {
      user_id: u.id,
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
  });

  return {
    from: fromStr,
    to: toStr,
    month: monthKey,
    days,
    employees,
  };
}
