import { parseHourlyRate, calcEarnedAmount } from './hourly-rate.js';

export function monthKeyFromDateStr(fromStr) {
  if (!fromStr || typeof fromStr !== 'string') return null;
  const m = fromStr.match(/^(\d{4}-\d{2})/);
  return m ? m[1] : null;
}

export function shiftMonthKey(monthKey, delta) {
  if (!monthKey) return null;
  const [y, m] = monthKey.split('-').map((x) => parseInt(x, 10));
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function buildPayTotals(hourlyRate, bonusRate, totalMinutes) {
  const earned = calcEarnedAmount(hourlyRate, totalMinutes);
  const bonus = calcEarnedAmount(bonusRate, totalMinutes);
  const earnedN = earned != null ? earned : 0;
  const bonusN = bonus != null ? bonus : 0;
  const hasRate = hourlyRate != null || bonusRate != null;
  return {
    hourly_rate: hourlyRate != null ? hourlyRate : null,
    bonus_rate: bonusRate != null ? bonusRate : null,
    earned_amount: earned,
    bonus_amount: bonus,
    total_earned_all: hasRate ? Math.round((earnedN + bonusN) * 100) / 100 : null,
  };
}

/** Ставки за месяц: с прошлого месяца, если сотрудник уже отмечался раньше; иначе 0 */
export async function ensureUserMonthRate(pool, userId, monthKey) {
  if (!monthKey || !userId) return;

  const existing = await pool.query(
    `SELECT 1 FROM timesheet_month_rates WHERE user_id = $1 AND month_key = $2`,
    [userId, monthKey],
  );
  if (existing.rowCount) return;

  const monthStart = `${monthKey}-01`;
  const everBefore = await pool.query(
    `SELECT 1 FROM attendance_records
     WHERE user_id = $1 AND visit_date < $2::date
     LIMIT 1`,
    [userId, monthStart],
  );

  let hourly = 0;
  let bonus = 0;

  if (everBefore.rowCount) {
    const prevKey = shiftMonthKey(monthKey, -1);
    if (prevKey) {
      const prev = await pool.query(
        `SELECT hourly_rate, bonus_rate FROM timesheet_month_rates
         WHERE user_id = $1 AND month_key = $2`,
        [userId, prevKey],
      );
      if (prev.rowCount) {
        hourly = parseHourlyRate(prev.rows[0].hourly_rate) ?? 0;
        bonus = parseHourlyRate(prev.rows[0].bonus_rate) ?? 0;
      }
    }
  }

  await pool.query(
    `INSERT INTO timesheet_month_rates (user_id, month_key, hourly_rate, bonus_rate)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, month_key) DO NOTHING`,
    [userId, monthKey, hourly, bonus],
  );
}

export async function ensureMonthRates(pool, monthKey, userIds) {
  if (!monthKey || !userIds?.length) return;
  for (const uid of userIds) {
    await ensureUserMonthRate(pool, uid, monthKey);
  }
}

export async function fetchRatesMap(pool, monthKey, userIds) {
  const map = new Map();
  if (!monthKey || !userIds?.length) return map;

  const r = await pool.query(
    `SELECT user_id, hourly_rate, bonus_rate FROM timesheet_month_rates
     WHERE month_key = $1 AND user_id = ANY($2::int[])`,
    [monthKey, userIds],
  );
  for (const row of r.rows) {
    const uid = Number(row.user_id);
    if (!Number.isFinite(uid)) continue;
    map.set(uid, {
      hourly_rate: parseHourlyRate(row.hourly_rate ?? null),
      bonus_rate: parseHourlyRate(row.bonus_rate ?? null),
    });
  }
  return map;
}

export async function upsertMonthRates(pool, userId, monthKey, patch) {
  await ensureUserMonthRate(pool, userId, monthKey);

  const cur = await pool.query(
    `SELECT hourly_rate, bonus_rate FROM timesheet_month_rates
     WHERE user_id = $1 AND month_key = $2`,
    [userId, monthKey],
  );
  const row = cur.rows[0] || {};
  const nextHourly = Object.prototype.hasOwnProperty.call(patch, 'hourly_rate')
    ? patch.hourly_rate
    : parseHourlyRate(row.hourly_rate ?? null);
  const nextBonus = Object.prototype.hasOwnProperty.call(patch, 'bonus_rate')
    ? patch.bonus_rate
    : parseHourlyRate(row.bonus_rate ?? null);

  await pool.query(
    `INSERT INTO timesheet_month_rates (user_id, month_key, hourly_rate, bonus_rate)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, month_key) DO UPDATE SET
       hourly_rate = EXCLUDED.hourly_rate,
       bonus_rate = EXCLUDED.bonus_rate`,
    [userId, monthKey, nextHourly, nextBonus],
  );

  return { hourly_rate: nextHourly, bonus_rate: nextBonus };
}
