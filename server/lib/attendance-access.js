/** Табель всех сотрудников (иначе — только своя строка) */
export function canAttendanceViewAll(user) {
  return user?.role === 'admin' || !!user?.can_attendance_all;
}

export function canAttendanceManageAll(user) {
  return canAttendanceViewAll(user);
}

/** Редактирование ячеек табеля */
export function canAttendanceEditTimesheet(user) {
  return user?.role === 'admin' || !!user?.can_attendance_edit;
}

export function requireAttendanceEdit(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Требуется авторизация' });
  if (canAttendanceEditTimesheet(req.user)) return next();
  return res.status(403).json({ error: 'Нет прав на редактирование табеля' });
}

/** Столбцы ставок, заработка и премий в табеле */
export function canAttendanceShowPay(user) {
  return user?.role === 'admin' || !!user?.can_attendance_pay;
}

/** Изменение ставки и ставки премии */
export function canAttendanceEditRates(user) {
  return user?.role === 'admin' || !!user?.can_attendance_edit_rates;
}

export function requireAttendanceEditRates(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Требуется авторизация' });
  if (canAttendanceEditRates(req.user)) return next();
  return res.status(403).json({ error: 'Нет прав на редактирование ставок' });
}

export function canAttendanceAddMember(user) {
  return user?.role === 'admin' || (!!user?.can_attendance_add_member && canAttendanceViewAll(user));
}

export function canAttendanceExport(user) {
  return user?.role === 'admin' || !!user?.can_attendance_export;
}

export function canAttendanceImport(user) {
  return user?.role === 'admin' || (!!user?.can_attendance_import && canAttendanceViewAll(user));
}

/** Переключение месяца в табеле */
export function canAttendanceChangeMonth(user) {
  return user?.role === 'admin' || !!user?.can_attendance_change_month;
}

const TZ_MSK = 'Europe/Moscow';

/** Текущий YYYY-MM по Москве */
export function currentMonthKeyMoscow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ_MSK,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  return y && m ? `${y}-${m}` : null;
}

/** Диапазон дат табеля: без права — только текущий месяц */
export function resolveTimesheetRange(user, from, to) {
  if (canAttendanceChangeMonth(user)) {
    return { from: from || null, to: to || null };
  }
  const monthKey = currentMonthKeyMoscow();
  if (!monthKey) return { from: from || null, to: to || null };
  const [y, m] = monthKey.split('-').map((x) => parseInt(x, 10));
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    from: `${monthKey}-01`,
    to: `${monthKey}-${String(lastDay).padStart(2, '0')}`,
  };
}

/** Проверка month (YYYY-MM) для операций записи */
export function assertTimesheetMonthAllowed(user, monthKey) {
  if (canAttendanceChangeMonth(user)) return;
  const cur = currentMonthKeyMoscow();
  if (monthKey && cur && monthKey !== cur) {
    const err = new Error('Доступен только табель текущего месяца');
    err.status = 403;
    throw err;
  }
}

const PAY_FIELDS = [
  'hourly_rate',
  'bonus_rate',
  'earned_amount',
  'bonus_amount',
  'total_earned_all',
];

/** Убрать данные расчёта ЗП из ответа табеля */
export function stripTimesheetPay(data) {
  if (!data?.employees) return data;
  return {
    ...data,
    employees: data.employees.map((emp) => {
      const next = { ...emp };
      for (const k of PAY_FIELDS) delete next[k];
      return next;
    }),
  };
}

export function assertTimesheetTargetUser(user, targetUserId) {
  if (canAttendanceManageAll(user)) return;
  if (Number(targetUserId) !== Number(user.id)) {
    const err = new Error('Можно редактировать только свой табель');
    err.status = 403;
    throw err;
  }
}
