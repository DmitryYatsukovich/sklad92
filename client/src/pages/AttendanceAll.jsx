import { useState, useEffect, useMemo, useCallback } from 'react';
import { attendance as attendanceApi } from '../api';

const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

function currentMonthValue() {
  const d = new Date();
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

function dayHeader(dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  const day = d.getDate();
  const wd = WEEKDAYS[d.getDay()];
  return { day, wd, isWeekend: d.getDay() === 0 || d.getDay() === 6 };
}

function formatDayLong(dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  return d.toLocaleDateString('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** Короткий формат длительности: 8:30, 8, 45м */
function formatCompactMinutes(mins) {
  if (mins == null || mins <= 0) return null;
  const total = Math.round(mins);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}м`;
  if (m === 0) return String(h);
  return `${h}:${String(m).padStart(2, '0')}`;
}

/** Короткий формат времени: 9:05 вместо 09:05 */
function formatCompactTime(timeStr) {
  if (!timeStr) return '…';
  const [h, m] = timeStr.split(':');
  const hi = parseInt(h, 10);
  if (!m || m === '00') return String(hi);
  return `${hi}:${m}`;
}

function cellCompactLabel(cell) {
  if (!cell || cell.status === 'empty') return null;
  if (cell.status === 'partial') return formatCompactTime(cell.check_in);
  return formatCompactMinutes(cell.worked_minutes) || '…';
}

function formatMoney(amount) {
  if (amount == null) return '—';
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

function calcEarned(hourlyRate, totalMinutes) {
  if (hourlyRate == null || hourlyRate === '') return null;
  const rate = Number(hourlyRate);
  if (Number.isNaN(rate)) return null;
  const mins = totalMinutes != null ? Number(totalMinutes) : 0;
  if (mins <= 0) return 0;
  return Math.round(rate * (mins / 60) * 100) / 100;
}

function TimesheetRateInput({ userId, value, disabled, onSaved, onError }) {
  const [local, setLocal] = useState(value != null ? String(value) : '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLocal(value != null ? String(value) : '');
  }, [value, userId]);

  const save = async () => {
    const trimmed = local.trim();
    const parsed = trimmed === '' ? null : Number(trimmed.replace(',', '.'));
    const current = value != null ? Number(value) : null;
    if (trimmed === '' && current == null) return;
    if (trimmed !== '' && !Number.isNaN(parsed) && current != null && parsed === current) return;

    setSaving(true);
    try {
      const res = await attendanceApi.updateTimesheetRate(userId, trimmed === '' ? null : local);
      onSaved(userId, res.hourly_rate);
    } catch (e) {
      onError(e.message);
      setLocal(value != null ? String(value) : '');
    } finally {
      setSaving(false);
    }
  };

  return (
    <input
      type="number"
      min="0"
      step="0.01"
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => { if (!saving) save(); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      disabled={disabled || saving}
      className="timesheet-rate-input"
      title="Ставка, ₽/час"
      placeholder="—"
    />
  );
}

function TimesheetCell({ cell, onClick }) {
  if (!cell || cell.status === 'empty') {
    return <span className="text-zinc-600 text-[9px]">·</span>;
  }

  const label = cellCompactLabel(cell);
  const colorClass = cell.status === 'partial'
    ? 'text-amber-400/90 hover:text-amber-300'
    : 'text-sky-300 hover:text-sky-200';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full font-medium tabular-nums cursor-pointer hover:underline ${colorClass}`}
      title="Приход и уход"
    >
      {label}
    </button>
  );
}

export default function AttendanceAll() {
  const [month, setMonth] = useState(currentMonthValue);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState(null);

  const load = useCallback(() => {
    const { from, to } = monthToRange(month);
    if (!from || !to) return;
    setLoading(true);
    setError('');
    attendanceApi
      .timesheet(from, to)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [month]);

  useEffect(() => {
    load();
  }, [load]);

  const dayMeta = useMemo(
    () => (data?.days || []).map((d) => ({ date: d, ...dayHeader(d) })),
    [data?.days],
  );

  const periodTitle = useMemo(
    () => formatMonthTitle(data?.from, data?.to),
    [data?.from, data?.to],
  );

  const handleRateSaved = useCallback((userId, hourlyRate) => {
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        employees: prev.employees.map((emp) => {
          if (emp.user_id !== userId) return emp;
          const rate = hourlyRate != null ? Number(hourlyRate) : null;
          return {
            ...emp,
            hourly_rate: rate,
            earned_amount: calcEarned(rate, emp.total_minutes),
          };
        }),
      };
    });
  }, []);

  const colSpan = (dayMeta.length || 1) + 4;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="page-title">Табель посещений</h2>
        <p className="page-subtitle">
          В ячейках — отработанные часы. Заработано = ставка × итого часов. Ставку можно изменить в таблице или в карточке пользователя.
        </p>
      </div>

      {error && <p className="alert-error text-xs">{error}</p>}

      <form
        onSubmit={(e) => { e.preventDefault(); load(); }}
        className="flex flex-wrap items-end gap-3"
      >
        <div className="filter-field">
          <span className="filter-label">Месяц</span>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="filter-input"
          />
        </div>
        <button type="submit" className="btn-primary text-sm" disabled={loading}>
          {loading ? 'Загрузка…' : 'Обновить'}
        </button>
        {periodTitle && (
          <span className="text-xs text-zinc-400 pb-2 capitalize">{periodTitle}</span>
        )}
      </form>

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-2xs text-zinc-500">
        <span><span className="text-sky-300 font-medium tabular-nums">8:30</span> — отработано</span>
        <span><span className="text-amber-400/90 tabular-nums">9</span> — только приход</span>
        <span><span className="text-zinc-600">·</span> — нет отметки</span>
        <span>Клик по ячейке — приход и уход</span>
      </div>

      {loading && !data ? (
        <p className="text-zinc-500 text-xs">Загрузка табеля…</p>
      ) : (
        <div className="table-wrap overflow-x-auto">
          <table className="table-compact timesheet-table">
            <thead className="sticky top-0 bg-surface-900 z-10">
              <tr className="border-b border-white/10">
                <th className="timesheet-name text-left font-medium text-zinc-300 sticky left-0 bg-surface-900 z-20 border-r border-white/10">
                  Сотр.
                </th>
                {dayMeta.map(({ date, day, isWeekend }) => (
                  <th
                    key={date}
                    title={date}
                    className={`timesheet-day font-normal tabular-nums ${
                      isWeekend ? 'text-zinc-500 bg-white/[0.02]' : 'text-zinc-400'
                    }`}
                  >
                    {day}
                  </th>
                ))}
                <th className="timesheet-total font-medium text-zinc-300 border-l border-white/10">
                  Итого
                </th>
                <th className="timesheet-rate font-medium text-zinc-300 border-l border-white/10">
                  Ставка
                </th>
                <th className="timesheet-earned font-medium text-zinc-300 border-l border-white/10">
                  Зараб.
                </th>
              </tr>
            </thead>
            <tbody>
              {(data?.employees || []).map((emp) => (
                <tr key={emp.user_id} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td
                    className="timesheet-name text-zinc-200 sticky left-0 bg-surface-900 border-r border-white/10 font-medium truncate"
                    title={emp.name}
                  >
                    {emp.name}
                  </td>
                  {dayMeta.map(({ date, isWeekend }) => (
                    <td
                      key={date}
                      className={`timesheet-day tabular-nums ${
                        isWeekend ? 'bg-white/[0.02]' : ''
                      }`}
                    >
                      <TimesheetCell
                        cell={emp.days?.[date]}
                        onClick={() => {
                          const cell = emp.days?.[date];
                          if (!cell || cell.status === 'empty') return;
                          setDetail({
                            employeeName: emp.name,
                            date,
                            cell,
                          });
                        }}
                      />
                    </td>
                  ))}
                  <td className="timesheet-total text-white font-semibold tabular-nums border-l border-white/10">
                    {formatCompactMinutes(emp.total_minutes) || '0'}
                  </td>
                  <td className="timesheet-rate border-l border-white/10">
                    <TimesheetRateInput
                      userId={emp.user_id}
                      value={emp.hourly_rate}
                      onSaved={handleRateSaved}
                      onError={setError}
                    />
                  </td>
                  <td className="timesheet-earned tabular-nums border-l border-white/10" title="Ставка × итого часов">
                    {emp.hourly_rate != null ? formatMoney(emp.earned_amount ?? calcEarned(emp.hourly_rate, emp.total_minutes)) : '—'}
                  </td>
                </tr>
              ))}
              {(!data?.employees || data.employees.length === 0) && (
                <tr>
                  <td
                    colSpan={colSpan}
                    className="p-6 text-center text-zinc-500 text-xs"
                  >
                    Нет сотрудников с отметками за период
                  </td>
                </tr>
              )}
            </tbody>
          </table>
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
            className="card p-5 max-w-sm w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-white mb-1">{detail.employeeName}</h3>
            <p className="text-zinc-400 text-xs mb-4 capitalize">{formatDayLong(detail.date)}</p>

            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-zinc-500">Приход</dt>
                <dd className="text-emerald-400 font-medium tabular-nums">
                  {detail.cell.check_in || '—'}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-zinc-500">Уход</dt>
                <dd className="text-amber-400/90 font-medium tabular-nums">
                  {detail.cell.check_out || '—'}
                </dd>
              </div>
              {detail.cell.worked_label && (
                <div className="flex justify-between gap-4 pt-2 border-t border-white/10">
                  <dt className="text-zinc-500">Отработано</dt>
                  <dd className="text-sky-300 font-medium">
                    {detail.cell.worked_label}
                  </dd>
                </div>
              )}
            </dl>

            <div className="mt-5 flex justify-end">
              <button type="button" onClick={() => setDetail(null)} className="btn-secondary text-sm">
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
