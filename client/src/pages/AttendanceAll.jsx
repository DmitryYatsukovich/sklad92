import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { attendance as attendanceApi, isOfflineQueuedError } from '../api';
import { usePendingMutations } from '../hooks/usePendingMutations';
import { withPendingRowClass } from '../lib/actionLog/applyOptimistic';

const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const TZ_MSK = 'Europe/Moscow';

function isRowObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asArrayOfObjects(value) {
  return Array.isArray(value)
    ? value.filter((row) => isRowObject(row))
    : [];
}

function normalizeTimesheetData(value) {
  const safe = isRowObject(value) ? value : {};
  const days = Array.isArray(safe.days)
    ? safe.days.filter((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d))
    : [];
  const employees = asArrayOfObjects(safe.employees).map((emp) => ({
    ...emp,
    days: isRowObject(emp.days) ? emp.days : {},
  }));
  return {
    from: typeof safe.from === 'string' ? safe.from : '',
    to: typeof safe.to === 'string' ? safe.to : '',
    month: typeof safe.month === 'string' ? safe.month : '',
    days,
    employees,
  };
}

function parsePendingMutationBody(entry) {
  if (isRowObject(entry?.body)) return entry.body;
  const raw = entry?.body;
  if (typeof raw !== 'string' || !raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return isRowObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function buildPendingTimesheetState(entries = []) {
  const pendingUsers = new Set();
  const pendingDays = new Set();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const path = typeof entry?.path === 'string' ? entry.path : '';
    const method = typeof entry?.method === 'string' ? entry.method.toUpperCase() : '';
    if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) continue;
    if (!path.startsWith('/api/attendance/timesheet/')) continue;
    const body = parsePendingMutationBody(entry);
    const uid = Number(body.user_id);
    if (Number.isFinite(uid) && uid > 0) pendingUsers.add(uid);
    const date = typeof body.date === 'string' ? body.date.slice(0, 10) : '';
    if (Number.isFinite(uid) && uid > 0 && date) {
      pendingDays.add(`${uid}|${date}`);
    }
  }
  return { pendingUsers, pendingDays };
}

function currentMonthValue() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ_MSK,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const y = parts.find((x) => x.type === 'year')?.value;
  const m = parts.find((x) => x.type === 'month')?.value;
  if (y && m) return `${y}-${m}`;
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(monthValue, delta) {
  if (!monthValue) return currentMonthValue();
  const [y, m] = monthValue.split('-').map((x) => parseInt(x, 10));
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthToRange(monthValue) {
  if (!monthValue) return { from: '', to: '' };
  const [y, m] = monthValue.split('-').map((x) => parseInt(x, 10));
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const to = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { from, to };
}

function formatMonthTitle(from, to) {
  if (!from) return '';
  const d = new Date(`${from}T12:00:00`);
  return d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
}

/** Полдень UTC — внутри того же календарного дня в Москве для заголовков колонок */
function anchorUtcNoon(dateStr) {
  return new Date(`${dateStr}T12:00:00Z`);
}

function dayHeader(dateStr) {
  const d = anchorUtcNoon(dateStr);
  if (Number.isNaN(d.getTime())) return { day: '', wd: '', isWeekend: false };
  const wdPart = new Intl.DateTimeFormat('en-US', { timeZone: TZ_MSK, weekday: 'short' })
    .formatToParts(d)
    .find((p) => p.type === 'weekday')?.value;
  const wdMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const idx = wdPart != null ? wdMap[wdPart] : undefined;
  const day = Number.parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: TZ_MSK, day: 'numeric' }).format(d),
    10,
  );
  const wd = typeof idx === 'number' ? WEEKDAYS[idx] : '…';
  return { day, wd, isWeekend: idx === 0 || idx === 6 };
}

function formatDayLong(dateStr) {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: TZ_MSK,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(anchorUtcNoon(dateStr));
}

/** Итого часов в ячейке «Итого»: 8:30 */
function formatCompactMinutes(mins) {
  if (mins == null || mins <= 0) return null;
  const total = Math.round(mins);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}м`;
  if (m === 0) return String(h);
  return `${h}:${String(m).padStart(2, '0')}`;
}

function formatTimeMsk(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString('ru-RU', {
    timeZone: TZ_MSK,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function isoToTimeInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const s = d.toLocaleTimeString('ru-RU', {
    timeZone: TZ_MSK,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const [h, m] = s.split(':');
  return `${h.padStart(2, '0')}:${m}`;
}

function employeeDisplayTitle(emp) {
  if (!emp) return '—';
  const full = [emp.employeeFirstName ?? emp.first_name, emp.employeeLastName ?? emp.last_name]
    .filter(Boolean)
    .join(' ')
    .trim();
  if (full) return full;
  const name = emp.employeeName ?? emp.name;
  if (name && name !== emp.employeeLogin && name !== emp.login) return name;
  return name || emp.employeeLogin || emp.login || '—';
}

function resolveTimeAttribution(cell, which) {
  if (!cell) return null;
  const direct = which === 'in' ? cell.check_in_by : cell.check_out_by;
  if (direct?.name) return direct;
  return null;
}

function timeAttributionNote(att) {
  if (!att?.name) return null;
  const verb = att.via === 'manual' ? 'задал' : 'отметил';
  return `${verb} ${att.name}`;
}

const TIMESHEET_VIEW_HINTS = [
  'Приход и уход отдельно: отметил — лицо, задал — табель.',
  'Отработано — как в ячейке табеля (часы или приход).',
];

const TIMESHEET_EDIT_HINTS = [
  'ЧЧ:ММ, Москва. Пустое поле очищает время.',
  'Отработано пересчитывается при изменении прихода или ухода.',
  'Часы/мин можно задать вручную — перекроют расчёт по времени.',
];

function timesheetDayStatus(cell) {
  if (!cell || cell.status === 'empty') {
    return { label: 'Нет записи', tone: 'zinc' };
  }
  if (cell.status === 'partial') {
    return { label: 'Только приход', tone: 'amber' };
  }
  if (dayCommentVisible(cell)) {
    return { label: 'Есть комментарий', tone: 'violet' };
  }
  return { label: 'День заполнен', tone: 'emerald' };
}

function TimesheetDayStatusBadge({ cell }) {
  const { label, tone } = timesheetDayStatus(cell);
  const tones = {
    zinc: 'bg-zinc-500/15 text-zinc-400 ring-zinc-500/20',
    amber: 'bg-amber-500/15 text-amber-300 ring-amber-500/25',
    violet: 'bg-violet-500/15 text-violet-300 ring-violet-500/25',
    emerald: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/25',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-2xs font-medium ring-1 ${tones[tone]}`}>
      {label}
    </span>
  );
}

function TimesheetDayHints({ canEdit, editing, isEmpty }) {
  const isEditMode = editing || (canEdit && isEmpty);
  const items = [...(isEditMode ? TIMESHEET_EDIT_HINTS : TIMESHEET_VIEW_HINTS)];
  if (canEdit && !editing && !isEmpty) {
    items.unshift('Клик по приходу, уходу или отработано — редактирование.');
  }
  return (
    <div className="timesheet-day-legend" role="note">
      <p><strong>{isEditMode ? 'Редактирование' : 'Просмотр'}</strong></p>
      {items.map((text) => (
        <p key={text}>{text}</p>
      ))}
    </div>
  );
}

function cellTimeDisplay(cell, which) {
  if (!cell) return '';
  if (which === 'in') {
    return cell.check_in?.slice(0, 5)
      || isoToTimeInput(cell.check_in_at)
      || (formatTimeMsk(cell.check_in_at) || '').slice(0, 5);
  }
  return cell.check_out?.slice(0, 5)
    || isoToTimeInput(cell.check_out_at)
    || (formatTimeMsk(cell.check_out_at) || '').slice(0, 5);
}

function TimesheetDayDetailRow({
  label, timeClass, cell, which, onActivate, clickable,
}) {
  const time = cellTimeDisplay(cell, which);
  const note = timeAttributionNote(resolveTimeAttribution(cell, which));
  const rowClass = clickable ? 'timesheet-day-detail-row--clickable' : '';
  const cells = (
    <>
      <th scope="row">{label}</th>
      <td>
        <span className={`timesheet-day-detail-time ${timeClass}`}>{time || '—'}</span>
        {note && <span className="timesheet-day-detail-meta">{note}</span>}
        {clickable && onActivate && (
          <span className="timesheet-day-detail-meta text-sky-400/80">редактировать</span>
        )}
      </td>
    </>
  );
  if (clickable && onActivate) {
    return (
      <tr className={rowClass} onClick={onActivate} onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(); }
      }} tabIndex={0} role="button" title="Редактировать">
        {cells}
      </tr>
    );
  }
  return <tr className={rowClass}>{cells}</tr>;
}

function TimesheetDayWorkedRow({
  cell, workedLabel, hoursBy, manualHours, clickable, onActivate,
}) {
  const rowClass = clickable ? 'timesheet-day-detail-row--clickable' : '';
  const cells = (
    <>
      <th scope="row">Отработано</th>
      <td>
        <span className="timesheet-day-detail-time text-sky-300 font-medium">{workedLabel ?? '—'}</span>
        {hoursBy && <span className="timesheet-day-detail-meta">{hoursBy}</span>}
        {!manualHours && cell.status === 'partial' && (
          <span className="timesheet-day-detail-meta">после ухода</span>
        )}
        {clickable && onActivate && (
          <span className="timesheet-day-detail-meta text-sky-400/80">редактировать</span>
        )}
      </td>
    </>
  );
  if (clickable && onActivate) {
    return (
      <tr
        className={rowClass}
        onClick={onActivate}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onActivate();
          }
        }}
        tabIndex={0}
        role="button"
        title="Редактировать"
      >
        {cells}
      </tr>
    );
  }
  return <tr className={rowClass}>{cells}</tr>;
}

function TimesheetDayDetailTable({ cell, canEdit, onActivate, editing }) {
  if (!cell) return null;
  const isEmpty = cell.status === 'empty';
  const workedLabel = cell.worked_label
    ?? (cell.worked_minutes != null && cell.worked_minutes > 0
      ? formatCompactMinutes(cell.worked_minutes)
      : null)
    ?? (cell.status === 'partial' ? '—' : isEmpty ? null : '0 ч');
  const manualHours = cell.manual_worked_minutes != null || cell.manual_minutes_saved != null;
  const hoursBy = manualHours && cell.edited_by?.name
    ? `задал ${cell.edited_by.name}`
    : null;

  return (
    <div className="table-wrap border-0 rounded-none shadow-none">
      <table className="table-compact timesheet-day-detail-table w-full">
        <tbody>
          <TimesheetDayDetailRow
            label="Приход"
            timeClass="text-emerald-400"
            cell={cell}
            which="in"
            clickable={canEdit && !editing}
            onActivate={onActivate}
          />
          <TimesheetDayDetailRow
            label="Уход"
            timeClass="text-amber-400/90"
            cell={cell}
            which="out"
            clickable={canEdit && !editing}
            onActivate={onActivate}
          />
          {(workedLabel != null || !isEmpty) && (
            <TimesheetDayWorkedRow
              cell={cell}
              workedLabel={workedLabel}
              hoursBy={hoursBy}
              manualHours={manualHours}
              clickable={canEdit && !editing}
              onActivate={onActivate}
            />
          )}
          {dayCommentVisible(cell) && !editing && (
            <tr>
              <th scope="row">Коммент.</th>
              <td className="text-violet-300/95 whitespace-pre-wrap leading-snug">
                {String(cell.day_comment).trim()}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function cellCompactLabel(cell) {
  if (!cell || cell.status === 'empty') return null;
  if (cell.cell_label) return cell.cell_label;
  if (cell.status === 'partial' && cell.check_in) return cell.check_in.slice(0, 5);
  return null;
}

/** Единый критерий «есть комментарий» для стиля ячейки (не полагаться на has_day_comment — может рассинхронизироваться) */
function dayCommentVisible(cell) {
  if (cell?.day_comment == null || cell.day_comment === '') return false;
  return String(cell.day_comment).trim().length > 0;
}

function hasTimesheetRecord(cell) {
  if (!cell || cell.status === 'empty') return false;
  return !!(
    cell.record_id
    || cell.check_in_at
    || cell.check_out_at
    || cell.manual_worked_minutes != null
    || cell.manual_minutes_saved != null
    || dayCommentVisible(cell)
  );
}

function formatMoney(amount) {
  if (amount == null) return '—';
  const n = Number(amount);
  if (Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n);
}

function formatRate(value) {
  if (value == null || value === '') return '—';
  const n = Number(value);
  if (Number.isNaN(n)) return '—';
  return `${new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n)} ₽`;
}

function formatEarnedCell(emp) {
  if (emp.earned_amount != null && emp.earned_amount !== '') {
    const fromApi = Number(emp.earned_amount);
    if (!Number.isNaN(fromApi)) return formatMoney(fromApi);
  }
  if (emp.hourly_rate == null || emp.hourly_rate === '') return '—';
  const earned = calcEarned(emp.hourly_rate, emp.total_minutes);
  return earned != null ? formatMoney(earned) : '—';
}

function formatBonusCell(emp) {
  if (emp.bonus_amount != null && emp.bonus_amount !== '') {
    const n = Number(emp.bonus_amount);
    if (!Number.isNaN(n)) return formatMoney(n);
  }
  if (emp.bonus_rate == null || emp.bonus_rate === '') return '—';
  const bonus = calcEarned(emp.bonus_rate, emp.total_minutes);
  return bonus != null ? formatMoney(bonus) : '—';
}

function formatTotalEarnedCell(emp) {
  if (emp.total_earned_all != null && emp.total_earned_all !== '') {
    const n = Number(emp.total_earned_all);
    if (!Number.isNaN(n)) return formatMoney(n);
  }
  return '—';
}

function calcEarned(hourlyRate, totalMinutes) {
  if (hourlyRate == null || hourlyRate === '') return null;
  const rate = Number(hourlyRate);
  if (Number.isNaN(rate)) return null;
  const mins = totalMinutes != null ? Number(totalMinutes) : 0;
  if (mins <= 0) return 0;
  return Math.round(rate * (mins / 60) * 100) / 100;
}

function empEarnedAmount(emp) {
  if (emp.earned_amount != null && emp.earned_amount !== '') {
    const n = Number(emp.earned_amount);
    if (!Number.isNaN(n)) return n;
  }
  return calcEarned(emp.hourly_rate, emp.total_minutes) ?? 0;
}

function empBonusAmount(emp) {
  if (emp.bonus_amount != null && emp.bonus_amount !== '') {
    const n = Number(emp.bonus_amount);
    if (!Number.isNaN(n)) return n;
  }
  return calcEarned(emp.bonus_rate, emp.total_minutes) ?? 0;
}

function empTotalAllAmount(emp) {
  if (emp.total_earned_all != null && emp.total_earned_all !== '') {
    const n = Number(emp.total_earned_all);
    if (!Number.isNaN(n)) return n;
  }
  return Math.round((empEarnedAmount(emp) + empBonusAmount(emp)) * 100) / 100;
}

function calcGroupTotals(employees) {
  let totalMinutes = 0;
  let earned = 0;
  let bonus = 0;
  let totalAll = 0;
  for (const emp of employees || []) {
    totalMinutes += emp.total_minutes != null ? Number(emp.total_minutes) : 0;
    earned += empEarnedAmount(emp);
    bonus += empBonusAmount(emp);
    totalAll += empTotalAllAmount(emp);
  }
  return {
    total_minutes: totalMinutes,
    earned: Math.round(earned * 100) / 100,
    bonus: Math.round(bonus * 100) / 100,
    total_all: Math.round(totalAll * 100) / 100,
  };
}

function orgGroupLabel(name) {
  const s = name && String(name).trim();
  return s || 'Без организации';
}

function groupEmployeesByOrg(employees) {
  const map = new Map();
  for (const emp of employees || []) {
    const label = orgGroupLabel(emp.organization_name);
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

function calcPayTotals(emp) {
  const totalMins = emp.total_minutes != null ? Number(emp.total_minutes) : 0;
  const earned = calcEarned(emp.hourly_rate, totalMins);
  const bonus = calcEarned(emp.bonus_rate, totalMins);
  const earnedN = earned != null ? earned : 0;
  const bonusN = bonus != null ? bonus : 0;
  const hasRate = emp.hourly_rate != null || emp.bonus_rate != null;
  return {
    earned_amount: earned,
    bonus_amount: bonus,
    total_earned_all: hasRate ? Math.round((earnedN + bonusN) * 100) / 100 : null,
  };
}

const HOURLY_RATE_STEP = 5;
const BONUS_RATE_STEP = 5;

function TimesheetRateStepper({
  userId, month, field, value, readOnly, step, onSaved, onError,
}) {
  const rateStep = step ?? HOURLY_RATE_STEP;
  const [local, setLocal] = useState(value != null ? String(value) : '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLocal(value != null ? String(value) : '');
  }, [value, userId, field, month]);

  const saveValue = async (next) => {
    setSaving(true);
    try {
      const res = await attendanceApi.updateTimesheetRates(userId, month, { [field]: next });
      onSaved(userId, res);
    } catch (e) {
      if (isOfflineQueuedError(e)) {
        onSaved(userId, { [field]: next, _pending: true });
        return;
      }
      onError(e.message);
      setLocal(value != null ? String(value) : '');
    } finally {
      setSaving(false);
    }
  };

  const bump = (delta) => {
    const fromLocal = local.trim() !== '' ? Number(local.replace(',', '.')) : NaN;
    const cur = !Number.isNaN(fromLocal) ? fromLocal : (value != null && value !== '' ? Number(value) : 0);
    const base = Number.isNaN(cur) ? 0 : cur;
    const next = Math.max(0, Math.round((base + delta) * 100) / 100);
    setLocal(String(next));
    saveValue(next);
  };

  const saveInput = async () => {
    const trimmed = local.trim();
    const parsed = trimmed === '' ? null : Number(trimmed.replace(',', '.'));
    const current = value != null ? Number(value) : null;
    if (trimmed === '' && current == null) return;
    if (trimmed !== '' && !Number.isNaN(parsed) && current != null && parsed === current) return;
    if (trimmed !== '' && Number.isNaN(parsed)) {
      onError('Некорректная ставка');
      setLocal(value != null ? String(value) : '');
      return;
    }
    await saveValue(trimmed === '' ? null : parsed);
  };

  const isBonus = field === 'bonus_rate';

  if (readOnly) {
    return (
      <span
        className="tabular-nums text-zinc-200 text-[10px] font-medium"
        title={isBonus ? '₽/час премии' : '₽/час'}
      >
        {formatRate(value)}
      </span>
    );
  }

  return (
    <div className="timesheet-rate-editor">
      <input
        type="text"
        inputMode="decimal"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => { if (!saving) saveInput(); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'ArrowUp') { e.preventDefault(); bump(rateStep); }
          if (e.key === 'ArrowDown') { e.preventDefault(); bump(-rateStep); }
        }}
        disabled={saving}
        className="timesheet-rate-input"
        title={`Клик — ввести вручную, стрелки ±${rateStep} ₽`}
        placeholder="—"
      />
      <div className="timesheet-rate-arrows">
        <button
          type="button"
          onClick={() => bump(rateStep)}
          disabled={saving}
          className="timesheet-rate-arrow"
          title={`+${rateStep} ₽`}
          aria-label={`Увеличить на ${rateStep} рублей`}
        >
          ▲
        </button>
        <button
          type="button"
          onClick={() => bump(-rateStep)}
          disabled={saving}
          className="timesheet-rate-arrow"
          title={`−${rateStep} ₽`}
          aria-label={`Уменьшить на ${rateStep} рублей`}
        >
          ▼
        </button>
      </div>
    </div>
  );
}

function workedMinutesFromCell(cell) {
  if (!cell || cell.status === 'empty' || cell.worked_minutes == null) return null;
  return Math.round(Number(cell.worked_minutes));
}

/** Поля «часы / минуты» из итоговых минут ячейки */
function durationFieldsFromMinutes(totalMins) {
  if (totalMins == null || Number.isNaN(totalMins)) return { h: '', m: '' };
  const t = Math.max(0, Math.round(totalMins));
  return { h: String(Math.floor(t / 60)), m: String(t % 60).padStart(2, '0') };
}

/** null — оба пусто; NaN — ошибка ввода; число — всего минут */
function parseDurationHm(hStr, mStr) {
  const hs = (hStr ?? '').trim();
  const ms = (mStr ?? '').trim();
  if (hs === '' && ms === '') return null;
  if (hs !== '' && !/^\d+$/.test(hs)) return NaN;
  if (ms !== '' && !/^\d{1,2}$/.test(ms)) return NaN;
  const h = hs === '' ? 0 : parseInt(hs, 10);
  const mi = ms === '' ? 0 : parseInt(ms, 10);
  if (h < 0 || mi < 0 || mi > 59) return NaN;
  return h * 60 + mi;
}

/** ЧЧ:ММ на дату в Москве → Date */
function parseTimeOnDate(dateStr, timeStr) {
  const t = (timeStr ?? '').trim();
  if (!dateStr || !t) return null;
  const parts = t.split(':');
  const h = parseInt(parts[0], 10);
  const m = parts.length > 1 ? parseInt(parts[1], 10) : 0;
  if (Number.isNaN(h) || h < 0 || h > 23 || Number.isNaN(m) || m < 0 || m > 59) return null;
  const hh = String(h).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  const d = new Date(`${dateStr}T${hh}:${mm}:00+03:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Минуты между приходом и уходом (МСК); null если нельзя посчитать */
function workedMinutesFromTimes(dateStr, inStr, outStr) {
  const a = parseTimeOnDate(dateStr, inStr);
  const b = parseTimeOnDate(dateStr, outStr);
  if (!a || !b || b.getTime() <= a.getTime()) return null;
  return Math.round((b.getTime() - a.getTime()) / 60000);
}

function sanitizeDayComment(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim().slice(0, 2000);
  return s || null;
}

function emptyTimesheetCellPending() {
  return {
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
    check_in_by: null,
    check_out_by: null,
    edited_by: null,
    edited_at: null,
    edited_at_label: null,
    day_comment: null,
    has_day_comment: false,
    _pending: true,
  };
}

function buildOptimisticTimesheetPatch(date, prevCell, payload, editorName) {
  const prev = isRowObject(prevCell) ? prevCell : EMPTY_CELL;
  if (payload?.clear) return emptyTimesheetCellPending();
  const hasIn = Object.prototype.hasOwnProperty.call(payload || {}, 'check_in');
  const hasOut = Object.prototype.hasOwnProperty.call(payload || {}, 'check_out');
  const hasWorked = Object.prototype.hasOwnProperty.call(payload || {}, 'worked_minutes');
  const hasComment = Object.prototype.hasOwnProperty.call(payload || {}, 'day_comment');

  const nextCheckIn = hasIn
    ? (typeof payload.check_in === 'string' && payload.check_in.trim() ? payload.check_in.trim() : null)
    : cellTimeDisplay(prev, 'in') || null;
  const nextCheckOut = hasOut
    ? (typeof payload.check_out === 'string' && payload.check_out.trim() ? payload.check_out.trim() : null)
    : cellTimeDisplay(prev, 'out') || null;
  const checkInAt = nextCheckIn ? parseTimeOnDate(date, nextCheckIn)?.toISOString() || null : null;
  const checkOutAt = nextCheckOut ? parseTimeOnDate(date, nextCheckOut)?.toISOString() || null : null;

  let workedMinutes = prev.worked_minutes != null ? Math.round(Number(prev.worked_minutes)) : null;
  if (hasWorked) {
    if (payload.worked_minutes === null || payload.worked_minutes === '') {
      workedMinutes = null;
    } else {
      const n = Math.round(Number(payload.worked_minutes));
      workedMinutes = Number.isNaN(n) || n < 0 ? null : n;
    }
  } else if (checkInAt && checkOutAt) {
    workedMinutes = workedMinutesFromTimes(date, nextCheckIn, nextCheckOut);
  } else if (!checkInAt && !checkOutAt) {
    workedMinutes = null;
  }

  const comment = hasComment ? sanitizeDayComment(payload.day_comment) : sanitizeDayComment(prev.day_comment);
  if (!checkInAt && !checkOutAt && workedMinutes == null && !comment) {
    return emptyTimesheetCellPending();
  }

  let status = 'empty';
  if (checkInAt) {
    status = checkOutAt || (workedMinutes != null && workedMinutes > 0) ? 'ok' : 'partial';
  } else if (workedMinutes != null || comment) {
    status = 'ok';
  }
  const workedLabel = workedMinutes == null
    ? null
    : (workedMinutes <= 0 ? '0 ч' : (formatCompactMinutes(workedMinutes) || '0 ч'));
  const editor = editorName ? { name: editorName, via: 'manual' } : null;
  return {
    ...prev,
    status,
    worked_minutes: workedMinutes,
    manual_worked_minutes: hasWorked ? workedMinutes : prev.manual_worked_minutes ?? null,
    manual_minutes_saved: hasWorked ? workedMinutes : prev.manual_minutes_saved ?? null,
    worked_hours: workedMinutes != null ? Math.round((workedMinutes / 60) * 100) / 100 : null,
    worked_label: workedLabel,
    cell_label: cellCompactLabel({
      status,
      check_in: nextCheckIn,
      worked_minutes: workedMinutes,
    }),
    check_in_at: checkInAt,
    check_out_at: checkOutAt,
    check_in: nextCheckIn,
    check_out: nextCheckOut,
    check_in_by: hasIn ? editor : prev.check_in_by ?? null,
    check_out_by: hasOut ? editor : prev.check_out_by ?? null,
    edited_by: editorName ? { name: editorName } : prev.edited_by ?? null,
    edited_at: new Date().toISOString(),
    day_comment: comment,
    has_day_comment: !!comment,
    _pending: true,
  };
}

function TimesheetDayEditForm({
  userId, date, cell, onSaved, onError, onReload, onCancel, editorName,
}) {
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [durHours, setDurHours] = useState('');
  const [durMins, setDurMins] = useState('');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const skipTimesRecalcRef = useRef(true);

  const resetForm = useCallback(() => {
    setCheckIn(isoToTimeInput(cell.check_in_at) || (cell.check_in ? cell.check_in.slice(0, 5) : ''));
    setCheckOut(isoToTimeInput(cell.check_out_at) || (cell.check_out ? cell.check_out.slice(0, 5) : ''));
    const { h, m } = durationFieldsFromMinutes(workedMinutesFromCell(cell));
    setDurHours(h);
    setDurMins(m);
    setComment((cell?.day_comment && String(cell.day_comment)) || '');
  }, [cell]);

  useEffect(() => {
    resetForm();
    skipTimesRecalcRef.current = true;
  }, [userId, date, resetForm]);

  useEffect(() => {
    if (skipTimesRecalcRef.current) {
      skipTimesRecalcRef.current = false;
      return;
    }
    const inTrim = checkIn.trim();
    const outTrim = checkOut.trim();
    if (!inTrim || !outTrim) return;
    const mins = workedMinutesFromTimes(date, inTrim, outTrim);
    if (mins == null) return;
    const { h, m } = durationFieldsFromMinutes(mins);
    setDurHours(h);
    setDurMins(m);
  }, [date, checkIn, checkOut]);

  const resetManualHours = async () => {
    const commentTrim = comment.trim();
    const payload = (checkIn.trim() || cell.check_in_at)
      ? {
        check_in: checkIn.trim() || isoToTimeInput(cell.check_in_at) || null,
        check_out: checkOut.trim() ? checkOut : null,
        worked_minutes: null,
        day_comment: commentTrim || null,
      }
      : { clear: true };
    setSaving(true);
    try {
      const res = await attendanceApi.updateTimesheetDay(userId, date, payload);
      onSaved(userId, date, res);
      onReload?.();
    } catch (e) {
      if (isOfflineQueuedError(e)) {
        const optimistic = buildOptimisticTimesheetPatch(date, cell, payload, editorName);
        onSaved(userId, date, optimistic);
        onReload?.();
        return;
      }
      onError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const clearDay = async () => {
    const payload = { clear: true };
    setSaving(true);
    try {
      const res = await attendanceApi.updateTimesheetDay(userId, date, payload);
      onSaved(userId, date, res);
      onReload?.();
    } catch (e) {
      if (isOfflineQueuedError(e)) {
        onSaved(userId, date, buildOptimisticTimesheetPatch(date, cell, payload, editorName));
        onReload?.();
        return;
      }
      onError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    const initialIn = isoToTimeInput(cell.check_in_at) || (cell.check_in ? cell.check_in.slice(0, 5) : '');
    const initialOut = isoToTimeInput(cell.check_out_at) || (cell.check_out ? cell.check_out.slice(0, 5) : '');
    const initialTotal = workedMinutesFromCell(cell);
    const initialComment = (cell?.day_comment && String(cell.day_comment).trim()) || '';

    const commentTrim = comment.trim();
    const nextIn = checkIn.trim() || null;
    const nextOut = checkOut.trim() || null;
    const sameIn = (checkIn.trim() || '') === (initialIn || '');
    const sameOut = (checkOut.trim() || '') === (initialOut || '');
    const sameComment = commentTrim === initialComment;

    const timesChanged = !sameIn || !sameOut;
    const autoMins = workedMinutesFromTimes(
      date,
      nextIn ?? checkIn.trim(),
      nextOut ?? checkOut.trim(),
    );
    const curMins = parseDurationHm(durHours, durMins);
    const hoursEmpty = durHours.trim() === '' && durMins.trim() === '';
    const hoursDirty = hoursEmpty
      ? (initialTotal != null)
      : (Number.isNaN(curMins) || initialTotal !== curMins);
    const hoursFromTimes = timesChanged && autoMins != null && curMins === autoMins;

    const payload = {};

    if (!sameIn) payload.check_in = nextIn;
    if (!sameOut) payload.check_out = nextOut;
    if (!sameComment) payload.day_comment = commentTrim || null;

    if (hoursDirty && !hoursFromTimes) {
      if (Number.isNaN(curMins)) {
        onError('Некорректно: часы — целое число ≥ 0, минуты — от 0 до 59');
        return;
      }
      payload.worked_minutes = curMins === null ? null : curMins;
    }

    if (Object.keys(payload).length === 0) {
      onError('Нет изменений');
      return;
    }

    const clearingAll = !nextIn && !nextOut && hoursEmpty && !commentTrim
      && (!sameIn || !sameOut || hoursDirty || !sameComment);
    if (clearingAll && (cell.check_in_at || cell.check_out_at || initialTotal != null || initialComment)) {
      await clearDay();
      return;
    }

    if (hoursDirty && hoursEmpty && !commentTrim && !payload.day_comment) {
      payload.worked_minutes = null;
    }

    setSaving(true);
    try {
      const res = await attendanceApi.updateTimesheetDay(userId, date, payload);
      onSaved(userId, date, res);
      await onReload?.();
      onCancel?.();
    } catch (e) {
      if (isOfflineQueuedError(e)) {
        onSaved(userId, date, buildOptimisticTimesheetPatch(date, cell, payload, editorName));
        await onReload?.();
        onCancel?.();
        return;
      }
      onError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="timesheet-day-edit-panel">
      <p className="text-zinc-400 font-medium">Правка · МСК</p>
      <div className="grid grid-cols-2 gap-1.5">
        <label className="space-y-0.5">
          <span className="text-2xs text-zinc-500">Приход</span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            value={checkIn}
            onChange={(e) => setCheckIn(e.target.value)}
            placeholder="09:00"
            maxLength={5}
            className="filter-input w-full tabular-nums font-mono"
            disabled={saving}
          />
        </label>
        <label className="space-y-0.5">
          <span className="text-2xs text-zinc-500">Уход</span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            value={checkOut}
            onChange={(e) => setCheckOut(e.target.value)}
            placeholder="18:00"
            maxLength={5}
            className="filter-input w-full tabular-nums font-mono"
            disabled={saving}
          />
        </label>
      </div>
      <p className="text-2xs text-zinc-600">Отработано пересчитывается по приходу и уходу</p>
      <div className="grid grid-cols-2 gap-1.5">
        <label className="space-y-0.5">
          <span className="text-2xs text-zinc-500">Часы</span>
          <input
            type="text"
            inputMode="numeric"
            value={durHours}
            onChange={(e) => setDurHours(e.target.value.replace(/\D/g, ''))}
            placeholder="0"
            maxLength={3}
            className="filter-input w-full tabular-nums font-mono"
            disabled={saving}
          />
        </label>
        <label className="space-y-0.5">
          <span className="text-2xs text-zinc-500">Мин</span>
          <input
            type="text"
            inputMode="numeric"
            value={durMins}
            onChange={(e) => setDurMins(e.target.value.replace(/\D/g, '').slice(0, 2))}
            placeholder="00"
            maxLength={2}
            className="filter-input w-full tabular-nums font-mono"
            disabled={saving}
          />
        </label>
      </div>
      {cell.manual_minutes_saved != null && (
        <button
          type="button"
          onClick={resetManualHours}
          disabled={saving}
          className="text-2xs text-zinc-500 hover:text-zinc-300"
        >
          Сбросить ручные часы
        </button>
      )}
      <label className="block space-y-0.5">
        <span className="text-2xs text-zinc-500">Комментарий</span>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={2000}
          rows={2}
          disabled={saving}
          className="filter-input w-full resize-y min-h-[2.5rem]"
          placeholder="…"
        />
      </label>
      <div className="flex gap-1.5 pt-0.5">
        <button type="button" onClick={save} disabled={saving} className="btn-primary text-2xs flex-1 py-1">
          {saving ? '…' : 'Сохранить'}
        </button>
        <button
          type="button"
          onClick={() => { resetForm(); onCancel?.(); }}
          disabled={saving}
          className="btn-secondary text-2xs py-1 px-2"
        >
          Отмена
        </button>
      </div>
    </div>
  );
}

function TimesheetDayPanel({
  userId, date, cell, canEdit, onSaved, onError, onReload, editorName,
}) {
  const [editing, setEditing] = useState(false);
  const isEmpty = !cell || cell.status === 'empty';
  const activateEdit = useCallback(() => {
    if (canEdit) setEditing(true);
  }, [canEdit]);

  useEffect(() => {
    setEditing(isEmpty && canEdit);
  }, [userId, date, isEmpty, canEdit]);

  return (
    <>
      <TimesheetDayHints canEdit={canEdit} editing={editing} isEmpty={isEmpty} />

      {!editing && (
        <>
          <TimesheetDayDetailTable
            cell={cell}
            canEdit={canEdit}
            onActivate={activateEdit}
            editing={editing}
          />
          {isEmpty && canEdit && (
            <div className="px-2 py-2 border-t border-white/10">
              <button
                type="button"
                onClick={activateEdit}
                className="btn-secondary text-2xs w-full py-1"
              >
                + Добавить день
              </button>
            </div>
          )}
        </>
      )}

      {editing && canEdit && (
        <TimesheetDayEditForm
          userId={userId}
          date={date}
          cell={cell}
          onSaved={onSaved}
          onError={onError}
          onReload={onReload}
          onCancel={() => setEditing(false)}
          editorName={editorName}
        />
      )}
    </>
  );
}

const EMPTY_CELL = { status: 'empty', worked_minutes: null, worked_label: null };

function TimesheetCell({ cell, onClick, clickableEmpty }) {
  const isEmpty = !cell || cell.status === 'empty';
  if (isEmpty) {
    if (clickableEmpty) {
      return (
        <button
          type="button"
          onClick={onClick}
          className="w-full text-zinc-500 text-[9px] cursor-pointer hover:text-sky-300 hover:underline"
          title="Добавить время"
        >
          +
        </button>
      );
    }
    return <span className="text-zinc-600 text-[9px]">·</span>;
  }

  const label = cellCompactLabel(cell);
  if (!label && hasTimesheetRecord(cell)) {
    const onlyComment = dayCommentVisible(cell)
      && !cell?.check_in_at && !cell?.check_out_at;
    const cmt = dayCommentVisible(cell) ? String(cell.day_comment).trim() : '';
    return (
      <button
        type="button"
        onClick={onClick}
        className={`w-full min-h-[1em] text-[9px] cursor-pointer hover:underline ${
          onlyComment ? 'text-violet-300 hover:text-violet-200' : 'text-zinc-600/70 hover:text-sky-300'
        }`}
        title={cmt || 'Просмотр записи'}
        aria-label="Просмотр записи"
      >
        {onlyComment ? '…' : '·'}
      </button>
    );
  }

  const colorClass = dayCommentVisible(cell)
    ? 'text-violet-300 hover:text-violet-200'
    : cell.status === 'partial'
      ? 'text-amber-400/90 hover:text-amber-300'
      : 'text-sky-300 hover:text-sky-200';

  const titleText = dayCommentVisible(cell)
    ? String(cell.day_comment).trim()
    : 'Приход и уход';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full font-medium tabular-nums cursor-pointer hover:underline ${colorClass}`}
      title={titleText}
    >
      {label || '…'}
    </button>
  );
}

function employeeStaysInTimesheet(emp) {
  if ((emp.total_minutes || 0) > 0) return true;
  return Object.values(emp.days || {}).some((c) => hasTimesheetRecord(c));
}

function recalcEmployeeTotals(emp) {
  let totalMins = 0;
  const days = { ...emp.days };
  for (const d of Object.keys(days)) {
    const cell = days[d];
    if (!cell || cell.status === 'empty') continue;
    const m = cell.worked_minutes;
    if (m != null && m > 0) totalMins += m;
  }
  const pay = calcPayTotals({ ...emp, total_minutes: totalMins });
  return {
    ...emp,
    days,
    total_minutes: totalMins,
    total_hours: Math.round((totalMins / 60) * 100) / 100,
    ...pay,
  };
}

export default function AttendanceAll({ user }) {
  const canViewAll = user?.role === 'admin' || !!user?.can_attendance_all;
  const showPayColumns = user?.role === 'admin' || !!user?.can_attendance_pay;
  const canEditTimes = user?.role === 'admin' || !!user?.can_attendance_edit;
  const canEditRates = user?.role === 'admin' || !!user?.can_attendance_edit_rates;
  const canAddMember = canViewAll && (user?.role === 'admin' || !!user?.can_attendance_add_member);
  const canExportTimesheet = user?.role === 'admin' || !!user?.can_attendance_export;
  const canImportTimesheet = canViewAll && (user?.role === 'admin' || !!user?.can_attendance_import);
  const canChangeMonth = user?.role === 'admin' || !!user?.can_attendance_change_month;
  const [month, setMonth] = useState(currentMonthValue);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState(null);
  const importRef = useRef(null);
  const [showAddMember, setShowAddMember] = useState(false);
  const [candidates, setCandidates] = useState([]);
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const [busy, setBusy] = useState(false);
  const pendingMutations = usePendingMutations();

  const pendingTimesheet = useMemo(
    () => buildPendingTimesheetState(pendingMutations),
    [pendingMutations],
  );

  const load = useCallback(() => {
    const { from, to } = monthToRange(month);
    if (!from || !to) return;
    setLoading(true);
    setError('');
    attendanceApi
      .timesheet(from, to)
      .then((payload) => setData(normalizeTimesheetData(payload)))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [month]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!canChangeMonth) setMonth(currentMonthValue());
  }, [canChangeMonth]);

  const dayMeta = useMemo(
    () => (data?.days || []).map((d) => ({ date: d, ...dayHeader(d) })),
    [data?.days],
  );

  const periodTitle = useMemo(
    () => formatMonthTitle(data?.from, data?.to),
    [data?.from, data?.to],
  );

  const handlePaySaved = useCallback((userId, patch) => {
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        employees: prev.employees.map((emp) => {
          if (Number(emp.user_id) !== Number(userId)) return emp;
          const next = recalcEmployeeTotals({
            ...emp,
            hourly_rate: patch.hourly_rate !== undefined ? patch.hourly_rate : emp.hourly_rate,
            bonus_rate: patch.bonus_rate !== undefined ? patch.bonus_rate : emp.bonus_rate,
            earned_amount: patch.earned_amount,
            bonus_amount: patch.bonus_amount,
            total_earned_all: patch.total_earned_all,
            total_minutes: patch.total_minutes ?? emp.total_minutes,
          });
          if (patch?._pending) next._pending = true;
          return next;
        }),
      };
    });
  }, []);

  const applyDayPatch = useCallback((userId, date, patch) => {
    const uid = Number(userId);
    const { user_id: _uid, date: _date, ...raw } = isRowObject(patch) ? patch : {};
    const cTrim = raw.day_comment != null ? String(raw.day_comment).trim() : '';
    const dayPatch = {
      ...raw,
      day_comment: cTrim.length ? cTrim : null,
      has_day_comment: cTrim.length > 0,
    };
    setError('');
    setData((prev) => {
      if (!prev) return prev;
      const employees = prev.employees
        .map((emp) => {
          if (Number(emp.user_id) !== uid) return emp;
          const days = {
            ...emp.days,
            [date]: { ...dayPatch },
          };
          const next = recalcEmployeeTotals({ ...emp, days });
          if (dayPatch._pending) next._pending = true;
          return next;
        })
        .filter(employeeStaysInTimesheet);
      return { ...prev, employees };
    });
    setDetail((d) => {
      if (!d || d.date !== date || Number(d.userId) !== uid) return d;
      if (dayPatch.status === 'empty') return null;
      return { ...d, cell: { ...dayPatch } };
    });
  }, []);

  const employeeGroups = useMemo(
    () => groupEmployeesByOrg(data?.employees),
    [data?.employees],
  );

  const exportRange = useMemo(() => monthToRange(month), [month]);

  const handleExportAll = () => {
    const { from, to } = exportRange;
    attendanceApi.exportTimesheet(from, to).catch((e) => setError(e.message));
  };

  const handleExportOrg = (orgName) => {
    const { from, to } = exportRange;
    attendanceApi.exportTimesheet(from, to, orgName).catch((e) => setError(e.message));
  };

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const result = await attendanceApi.importTimesheet(month, file);
      if (result.errors?.length) {
        setError(`Импортировано: ${result.applied}. Предупреждения: ${result.errors.join('; ')}`);
      }
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  };

  const openAddMember = () => {
    setShowAddMember(true);
    setSelectedMemberId('');
    attendanceApi.timesheetCandidates(month)
      .then(setCandidates)
      .catch((e) => setError(e.message));
  };

  const appendPendingMemberToTimesheet = useCallback((candidateId) => {
    const uid = Number(candidateId);
    if (!Number.isFinite(uid) || uid <= 0) return;
    setData((prev) => {
      if (!prev || !Array.isArray(prev.days)) return prev;
      if (asArrayOfObjects(prev.employees).some((emp) => Number(emp.user_id) === uid)) return prev;
      const candidate = candidates.find((row) => Number(row.id) === uid);
      const baseDays = {};
      for (const d of prev.days) {
        baseDays[d] = EMPTY_CELL;
      }
      const nextEmployee = {
        user_id: uid,
        name: candidate?.name || candidate?.display_name || candidate?.login || `Сотрудник #${uid}`,
        login: candidate?.login || '',
        first_name: candidate?.first_name || null,
        last_name: candidate?.last_name || null,
        organization_id: candidate?.organization_id || null,
        organization_name: candidate?.organization_name || null,
        total_minutes: 0,
        total_hours: 0,
        total_label: '0 ч',
        days: baseDays,
        hourly_rate: null,
        bonus_rate: null,
        earned_amount: null,
        bonus_amount: null,
        total_earned_all: null,
        _pending: true,
      };
      return {
        ...prev,
        employees: [...asArrayOfObjects(prev.employees), nextEmployee],
      };
    });
  }, [candidates]);

  const handleAddMember = async () => {
    if (!selectedMemberId) return;
    setBusy(true);
    setError('');
    try {
      await attendanceApi.addTimesheetMember(Number(selectedMemberId), month);
      setShowAddMember(false);
      load();
    } catch (e) {
      if (isOfflineQueuedError(e)) {
        appendPendingMemberToTimesheet(selectedMemberId);
        setShowAddMember(false);
        return;
      }
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="page-title">Табель посещений</h2>
        <p className="page-subtitle">
          {canEditTimes
            ? (canViewAll
              ? 'Сотрудник появляется в табеле месяца после сканирования. Новый месяц начинается пустым; ставка и премия копируются с прошлого месяца (для новых — 0). Без ухода — только приход. С уходом или вручную — часы (8.5).'
              : 'Отображается только ваш табель. Можно править свои ячейки.')
            : 'Табель доступен только для просмотра.'}
        </p>
      </div>

      {error && <p className="alert-error text-xs">{error}</p>}

      <div className="flex flex-wrap items-end gap-2">
        <div className="filter-field">
          <span className="filter-label">Месяц</span>
          {canChangeMonth ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setMonth((m) => shiftMonth(m, -1))}
                className="btn-secondary text-xs px-2 py-1 min-w-[2rem]"
                title="Предыдущий месяц"
                aria-label="Предыдущий месяц"
              >
                ‹
              </button>
              <input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="filter-input min-w-[9.5rem]"
              />
              <button
                type="button"
                onClick={() => setMonth((m) => shiftMonth(m, 1))}
                className="btn-secondary text-xs px-2 py-1 min-w-[2rem]"
                title="Следующий месяц"
                aria-label="Следующий месяц"
              >
                ›
              </button>
            </div>
          ) : (
            <p className="filter-input min-w-[9.5rem] text-sm text-zinc-200 py-1.5 capitalize">
              {periodTitle || month}
            </p>
          )}
        </div>
        {canChangeMonth && periodTitle && (
          <span className="text-xs text-zinc-400 pb-2 capitalize">
            {loading ? 'Загрузка…' : periodTitle}
          </span>
        )}
        {canChangeMonth && (
          <button
            type="button"
            onClick={() => setMonth(currentMonthValue())}
            className="btn-ghost text-2xs pb-2"
          >
            Текущий месяц
          </button>
        )}
      </div>

      {(canExportTimesheet || canAddMember || canImportTimesheet) && (
        <div className="flex flex-wrap gap-2 items-center">
          {canExportTimesheet && (
            <button type="button" onClick={handleExportAll} className="btn-secondary text-xs" disabled={busy}>
              {canViewAll ? 'Экспорт общего табеля' : 'Экспорт табеля'}
            </button>
          )}
          {canAddMember && (
            <button type="button" onClick={openAddMember} className="btn-secondary text-xs" disabled={busy}>
              Добавить сотрудника
            </button>
          )}
          {canImportTimesheet && (
            <>
              <button
                type="button"
                onClick={() => importRef.current?.click()}
                className="btn-secondary text-xs"
                disabled={busy}
              >
                Импорт из Excel
              </button>
              <input
                ref={importRef}
                type="file"
                accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={handleImport}
              />
            </>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-2xs text-zinc-500">
        <span><span className="text-sky-300 font-medium tabular-nums">8.5</span> — часы (есть уход или вручную)</span>
        <span><span className="text-amber-400/90 tabular-nums">9</span> — только приход</span>
        <span><span className="text-zinc-600">·</span> — нет отметки</span>
        {canEditTimes && <span>Клик по ячейке — приход и уход</span>}
      </div>
      {(pendingTimesheet.pendingUsers.size > 0 || pendingTimesheet.pendingDays.size > 0) && (
        <p className="text-2xs text-amber-400/90 border border-amber-500/30 rounded px-2 py-1 bg-amber-500/10">
          Несинхронизированные изменения в табеле отображаются тускло и отправятся на сервер при появлении сети.
        </p>
      )}

      {loading && !data ? (
        <p className="text-zinc-500 text-xs">Загрузка табеля…</p>
      ) : employeeGroups.length === 0 ? (
        <p className="text-zinc-500 text-xs py-4">
          {canViewAll
            ? 'Табель пуст. Добавьте сотрудника вручную или дождитесь сканирования на проходной.'
            : 'Нет отметок за этот месяц. Строка появится после сканирования на проходной.'}
        </p>
      ) : (
        <div className="space-y-8">
          {employeeGroups.map((group) => {
            const groupTotals = calcGroupTotals(group.employees);
            return (
            <section key={group.label} className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-2">
                <h3 className="text-sm font-semibold text-zinc-200">
                  {group.label}
                </h3>
                {canExportTimesheet && canViewAll && (
                  <button
                    type="button"
                    onClick={() => handleExportOrg(group.label)}
                    className="btn-ghost text-2xs shrink-0"
                    disabled={busy}
                  >
                    Экспорт Excel
                  </button>
                )}
              </div>
              <div className="table-wrap overflow-x-auto">
          <table className="table-compact timesheet-table">
            <thead className="sticky top-0 bg-surface-900 z-10">
              <tr className="border-b border-white/10">
                <th className="timesheet-name text-left font-medium text-zinc-300 sticky left-0 bg-surface-900 z-20 border-r border-white/10">
                  Сотр.
                </th>
                {showPayColumns && (
                  <th className="timesheet-org text-left font-medium text-zinc-300 border-r border-white/10">
                    Организация
                  </th>
                )}
                {dayMeta.map(({ date, day, wd, isWeekend }) => (
                  <th
                    key={date}
                    title={formatDayLong(date)}
                    className={`timesheet-day font-normal tabular-nums ${
                      isWeekend ? 'text-zinc-500 bg-white/[0.02]' : 'text-zinc-400'
                    }`}
                  >
                    <div className="flex flex-col items-center gap-0.5 leading-tight py-0.5">
                      <span className="text-[11px] font-medium text-zinc-200">{day}</span>
                      <span className={`text-[9px] uppercase ${isWeekend ? 'text-zinc-600' : 'text-zinc-500'}`}>
                        {wd}
                      </span>
                    </div>
                  </th>
                ))}
                <th className="timesheet-total font-medium text-zinc-300 border-l border-white/10 align-bottom">
                  <div className="flex flex-col items-end gap-0.5 px-0.5 py-1 leading-tight">
                    <span>Итого</span>
                    <span className="text-[10px] font-semibold tabular-nums text-white">
                      {formatCompactMinutes(groupTotals.total_minutes) || '0'}
                    </span>
                  </div>
                </th>
                {showPayColumns && (
                  <>
                    <th className="timesheet-rate font-medium text-zinc-300 border-l border-white/10" title="₽/час">
                      Ставка
                    </th>
                    <th className="timesheet-earned font-medium text-zinc-300 border-l border-white/10 align-bottom">
                      <div className="flex flex-col items-end gap-0.5 px-0.5 py-1 leading-tight">
                        <span>Зараб.</span>
                        <span className="text-[10px] font-semibold tabular-nums text-emerald-400/90">
                          {formatMoney(groupTotals.earned)}
                        </span>
                      </div>
                    </th>
                    <th className="timesheet-bonus-rate font-medium text-zinc-300 border-l border-white/10" title="₽/час премии">
                      Ст. прем.
                    </th>
                    <th className="timesheet-bonus font-medium text-zinc-300 border-l border-white/10 align-bottom">
                      <div className="flex flex-col items-end gap-0.5 px-0.5 py-1 leading-tight">
                        <span>Премия</span>
                        <span className="text-[10px] font-semibold tabular-nums text-violet-300/90">
                          {formatMoney(groupTotals.bonus)}
                        </span>
                      </div>
                    </th>
                    <th className="timesheet-total-all font-medium text-zinc-300 border-l border-white/10 align-bottom">
                      <div className="flex flex-col items-end gap-0.5 px-0.5 py-1 leading-tight">
                        <span>Всего</span>
                        <span className="text-[10px] font-semibold tabular-nums text-emerald-300/95">
                          {formatMoney(groupTotals.total_all)}
                        </span>
                      </div>
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {group.employees.map((emp) => {
                const userIdNum = Number(emp.user_id);
                const rowPending = pendingTimesheet.pendingUsers.has(userIdNum) || emp._pending;
                return (
                <tr
                  key={emp.user_id}
                  className={withPendingRowClass('border-b border-white/5 hover:bg-white/[0.02]', { _pending: rowPending })}
                  title={rowPending ? 'Ожидает отправки на сервер' : undefined}
                >
                  <td
                    className="timesheet-name text-zinc-200 sticky left-0 bg-surface-900 border-r border-white/10 font-medium truncate"
                    title={emp.name}
                  >
                    {emp.name}
                  </td>
                  {showPayColumns && (
                    <td
                      className="timesheet-org truncate border-r border-white/10"
                      title={orgGroupLabel(emp.organization_name)}
                    >
                      {orgGroupLabel(emp.organization_name)}
                    </td>
                  )}
                  {dayMeta.map(({ date, isWeekend }) => {
                    const cellPending = pendingTimesheet.pendingDays.has(`${userIdNum}|${date}`);
                    return (
                    <td
                      key={date}
                      className={withPendingRowClass(
                        `timesheet-day tabular-nums ${isWeekend ? 'bg-white/[0.02]' : ''}`,
                        { _pending: rowPending || cellPending },
                      )}
                    >
                      <TimesheetCell
                        cell={emp.days?.[date]}
                        clickableEmpty={canEditTimes}
                        onClick={() => {
                          const cell = emp.days?.[date] || EMPTY_CELL;
                          if (cell.status === 'empty' && !canEditTimes) return;
                          setDetail({
                            userId: emp.user_id,
                            employeeName: emp.name,
                            employeeLogin: emp.login,
                            employeeLastName: emp.last_name,
                            employeeFirstName: emp.first_name,
                            date,
                            cell,
                          });
                        }}
                      />
                    </td>
                    );
                  })}
                  <td className="timesheet-total text-white font-semibold tabular-nums border-l border-white/10">
                    {formatCompactMinutes(emp.total_minutes) || '0'}
                  </td>
                  {showPayColumns && (
                    <>
                      <td className="timesheet-rate border-l border-white/10">
                        <TimesheetRateStepper
                          userId={emp.user_id}
                          month={month}
                          field="hourly_rate"
                          value={emp.hourly_rate}
                          step={HOURLY_RATE_STEP}
                          readOnly={!canEditRates}
                          onSaved={handlePaySaved}
                          onError={setError}
                        />
                      </td>
                      <td className="timesheet-earned tabular-nums border-l border-white/10" title="Ставка × итого часов">
                        {formatEarnedCell(emp)}
                      </td>
                      <td className="timesheet-bonus-rate border-l border-white/10">
                        <TimesheetRateStepper
                          userId={emp.user_id}
                          month={month}
                          field="bonus_rate"
                          value={emp.bonus_rate}
                          step={BONUS_RATE_STEP}
                          readOnly={!canEditRates}
                          onSaved={handlePaySaved}
                          onError={setError}
                        />
                      </td>
                      <td className="timesheet-bonus tabular-nums border-l border-white/10" title="Ставка премии × итого часов">
                        {formatBonusCell(emp)}
                      </td>
                      <td className="timesheet-total-all tabular-nums border-l border-white/10 font-semibold text-emerald-300/95" title="Заработано + премия">
                        {formatTotalEarnedCell(emp)}
                      </td>
                    </>
                  )}
                </tr>
                );
              })}
            </tbody>
          </table>
              </div>
            </section>
            );
          })}
        </div>
      )}

      {detail && (
        <div
          className="modal-backdrop z-50"
          onClick={() => setDetail(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="timesheet-day-modal w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="timesheet-day-modal__shell">
              <header className="timesheet-day-modal__header">
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-zinc-200 truncate">{employeeDisplayTitle(detail)}</h3>
                  <p className="text-2xs text-zinc-500 mt-0.5 capitalize">{formatDayLong(detail.date)}</p>
                  <div className="mt-1.5">
                    <TimesheetDayStatusBadge cell={detail.cell} />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setDetail(null)}
                  className="shrink-0 w-6 h-6 rounded border border-white/10 text-zinc-500 hover:text-white text-sm leading-none"
                  aria-label="Закрыть"
                >
                  ×
                </button>
              </header>

              <div className="timesheet-day-modal__body">
                <TimesheetDayPanel
                  userId={detail.userId}
                  date={detail.date}
                  cell={detail.cell}
                  canEdit={canEditTimes}
                  onSaved={applyDayPatch}
                  onError={setError}
                  onReload={load}
                  editorName={user?.display_name || user?.login || 'Вы'}
                />
              </div>

              <footer className="timesheet-day-modal__footer">
                <button type="button" onClick={() => setDetail(null)} className="btn-secondary text-2xs py-1">
                  Закрыть
                </button>
              </footer>
            </div>
          </div>
        </div>
      )}

      {showAddMember && canAddMember && (
        <div
          className="modal-backdrop z-50"
          onClick={() => setShowAddMember(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="card p-5 max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-white font-medium mb-1">Добавить в табель</h3>
            <p className="text-zinc-400 text-xs mb-4">
              Выберите зарегистрированного пользователя для месяца {month}. В день добавления (по Москве, в пределах
              этого месяца) для него автоматически ставится 1 минута отработанного времени, если за эту дату ещё нет
              записи.
            </p>
            <div className="space-y-4">
              <div>
                <label className="label">Сотрудник</label>
                <select
                  value={selectedMemberId}
                  onChange={(e) => setSelectedMemberId(e.target.value)}
                  className="input"
                >
                  <option value="">— Выберите —</option>
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}{c.login ? ` (${c.login})` : ''}
                      {c.organization_name ? ` — ${c.organization_name}` : ''}
                    </option>
                  ))}
                </select>
                {!candidates.length && (
                  <p className="text-zinc-500 text-xs mt-1">Все пользователи уже в табеле этого месяца</p>
                )}
              </div>
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => setShowAddMember(false)} className="btn-secondary text-sm">
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={handleAddMember}
                  className="btn-primary text-sm"
                  disabled={!selectedMemberId || busy}
                >
                  Добавить
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
