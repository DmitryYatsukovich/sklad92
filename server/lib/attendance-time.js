const TZ = 'Europe/Moscow';

/** Время HH:MM в часовом поясе Москвы */
export function formatTimeMoscow(val) {
  if (val == null) return null;
  const d = val instanceof Date ? val : new Date(val);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString('ru-RU', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Дата и время в Москве */
export function formatDateTimeMoscow(val) {
  if (val == null) return null;
  const d = val instanceof Date ? val : new Date(val);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('ru-RU', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Время HH:MM:SS в Москве (для модального окна) */
export function formatTimeMoscowFull(val) {
  if (val == null) return null;
  const d = val instanceof Date ? val : new Date(val);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString('ru-RU', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** Коротко: 9 или 9:05 */
export function formatTimeMoscowShort(val) {
  const s = formatTimeMoscow(val);
  if (!s) return null;
  const [h, m] = s.split(':');
  const hi = parseInt(h, 10);
  if (!m || m === '00') return String(hi);
  return `${hi}:${m}`;
}

/** Диапазон приход–уход: 9–18 */
export function formatTimeRangeMoscowShort(checkIn, checkOut) {
  const a = formatTimeMoscowShort(checkIn);
  if (!a) return null;
  const b = formatTimeMoscowShort(checkOut);
  if (!b) return a;
  return `${a}–${b}`;
}

/** Отработано одним числом: 8.5 (часы) */
export function formatDecimalHours(mins) {
  if (mins == null || mins <= 0) return null;
  const h = Math.round((mins / 60) * 10) / 10;
  return Number.isInteger(h) ? String(h) : h.toFixed(1);
}

/** Часы из ввода администратора → минуты */
export function parseWorkedHoursInput(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const cleaned = String(value).replace(/\s/g, '').replace(',', '.').trim();
  if (!cleaned) return null;
  const h = Number(cleaned);
  if (Number.isNaN(h) || h < 0) return null;
  return Math.round(h * 60);
}

/** Дата + время (HH:MM) → ISO в часовом поясе Москвы */
export function parseMoscowDateTime(dateStr, timeStr) {
  if (!dateStr) return null;
  if (timeStr == null || String(timeStr).trim() === '') return null;
  const cleaned = String(timeStr).trim();
  const parts = cleaned.split(':');
  const h = parseInt(parts[0], 10);
  const m = parts.length > 1 ? parseInt(parts[1], 10) : 0;
  if (Number.isNaN(h) || h < 0 || h > 23 || Number.isNaN(m) || m < 0 || m > 59) return null;
  const hh = String(h).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  return `${dateStr}T${hh}:${mm}:00+03:00`;
}

/** ISO → значение для input type="time" (HH:MM) */
export function isoToTimeInputValue(iso) {
  const s = formatTimeMoscow(iso);
  return s || '';
}

/** Подпись ячейки: только приход или часы */
export function buildTimesheetCellLabel(checkInAt, checkOutAt, workedMinutes) {
  const hasOut = !!checkOutAt;
  const mins = workedMinutes != null ? Math.round(Number(workedMinutes)) : null;
  if (mins === 0) return null;
  if (!hasOut && mins == null) {
    return formatTimeMoscowShort(checkInAt);
  }
  if (mins != null && mins > 0) {
    return formatDecimalHours(mins);
  }
  return formatTimeMoscowShort(checkInAt);
}

export function userDisplayName(u) {
  if (!u) return null;
  return u.display_name || [u.first_name, u.last_name].filter(Boolean).join(' ') || u.login || null;
}

export function userMarkedByPayload(u) {
  if (!u || !u.id) return null;
  return {
    id: u.id,
    login: u.login,
    first_name: u.first_name,
    last_name: u.last_name,
    display_name: u.display_name,
    name: userDisplayName(u),
  };
}
