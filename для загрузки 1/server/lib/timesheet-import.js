import pool from '../db/pool.js';
import { parseHourlyRate } from './hourly-rate.js';
import { parseWorkedHoursInput } from './attendance-time.js';
import { ensureUserMonthRate, upsertMonthRates } from './timesheet-month-rates.js';
import { toDateKey } from './timesheet-data.js';

async function resolveUserId(client, { user_id, login }) {
  if (user_id) {
    const r = await client.query('SELECT id FROM users WHERE id = $1', [user_id]);
    if (r.rowCount) return r.rows[0].id;
  }
  if (login) {
    const r = await client.query('SELECT id FROM users WHERE LOWER(login) = LOWER($1)', [login.trim()]);
    if (r.rowCount) return r.rows[0].id;
  }
  return null;
}

async function applyDayValue(client, userId, dateStr, rawValue, editorId) {
  const mins = parseWorkedHoursInput(rawValue);
  if (mins == null) return;

  const existing = await client.query(
    'SELECT id FROM attendance_records WHERE user_id = $1 AND visit_date = $2::date',
    [userId, dateStr],
  );

  if (!existing.rowCount) {
    await client.query(
      `INSERT INTO attendance_records
         (user_id, visit_date, manual_worked_minutes, manual_minutes_updated_at, edited_by_user_id, edited_at)
       VALUES ($1, $2::date, $3, NOW(), $4, NOW())`,
      [userId, dateStr, mins, editorId],
    );
  } else {
    await client.query(
      `UPDATE attendance_records
       SET manual_worked_minutes = $3,
           manual_minutes_updated_at = NOW(),
           edited_by_user_id = $4,
           edited_at = NOW()
       WHERE user_id = $1 AND visit_date = $2::date`,
      [userId, dateStr, mins, editorId],
    );
  }
}

/** @param {{ monthKey: string, rows: Array, editorId: number|null }} opts */
export async function applyTimesheetImport({ monthKey, rows, editorId }) {
  const client = await pool.connect();
  const errors = [];
  let applied = 0;

  try {
    await client.query('BEGIN');
    for (const row of rows) {
      const userId = await resolveUserId(client, row);
      if (!userId) {
        errors.push(`Не найден: ${row.login || row.user_id}`);
        continue;
      }

      await ensureUserMonthRate(client, userId, monthKey);

      if (row.hourly_rate !== undefined || row.bonus_rate !== undefined) {
        const patch = {};
        if (row.hourly_rate !== undefined) patch.hourly_rate = parseHourlyRate(row.hourly_rate);
        if (row.bonus_rate !== undefined) patch.bonus_rate = parseHourlyRate(row.bonus_rate);
        await upsertMonthRates(client, userId, monthKey, patch);
      }

      for (const [dateStr, val] of Object.entries(row.days || {})) {
        const d = toDateKey(dateStr);
        if (!d || !d.startsWith(monthKey)) continue;
        await applyDayValue(client, userId, d, val, editorId);
      }
      applied += 1;
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  return { applied, errors };
}
