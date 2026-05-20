/** Парсинг ставки (руб/час) из строки или числа */
export function parseHourlyRate(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const cleaned = String(value).replace(/\s/g, '').replace(/₽/g, '').replace(',', '.').trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (Number.isNaN(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

/** Заработано = ставка × часы (total_minutes / 60) */
export function calcEarnedAmount(hourlyRate, totalMinutes) {
  if (hourlyRate == null || hourlyRate === '') return null;
  const rate = Number(hourlyRate);
  if (Number.isNaN(rate)) return null;
  const mins = totalMinutes != null ? Number(totalMinutes) : 0;
  if (mins <= 0) return 0;
  return Math.round(rate * (mins / 60) * 100) / 100;
}
