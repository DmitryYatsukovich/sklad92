/** Собрать описание действия из HTTP-запроса (для журнала). */
export function buildActionFromRequest(path, method, bodyText) {
  let body = {};
  if (bodyText) {
    try {
      body = JSON.parse(bodyText);
    } catch {
      body = {};
    }
  }
  const m = (method || 'GET').toUpperCase();

  if (path === '/api/operations/issue' && m === 'POST') {
    return {
      kind: 'issue',
      title: 'Выдача материала',
      description: describeIssue(body),
      payload: body,
    };
  }
  if (path === '/api/operations/return' && m === 'POST') {
    return {
      kind: 'return',
      title: 'Возврат материала',
      description: describeReturn(body),
      payload: body,
    };
  }
  const returnedMatch = path.match(/^\/api\/operations\/issuances\/(\d+)\/returned$/);
  if (returnedMatch && m === 'PATCH') {
    return {
      kind: 'return_adjust',
      title: 'Изменение возврата',
      description: `Выдача #${returnedMatch[1]}, возвращено: ${body.returned_quantity ?? '—'}`,
      payload: { issuanceId: Number(returnedMatch[1]), ...body },
    };
  }
  if (path === '/api/materials' && m === 'POST') {
    return {
      kind: 'material_create',
      title: 'Добавление материала',
      description: body.name ? `«${body.name}»` : null,
      payload: body,
    };
  }
  const matPut = path.match(/^\/api\/materials\/(\d+)$/);
  if (matPut && m === 'PUT') {
    return {
      kind: 'material_update',
      title: 'Изменение материала',
      description: body.name ? `«${body.name}»` : `ID ${matPut[1]}`,
      payload: { materialId: Number(matPut[1]), ...body },
    };
  }
  const matAdd = path.match(/^\/api\/materials\/(\d+)\/add$/);
  if (matAdd && m === 'POST') {
    return {
      kind: 'material_add_qty',
      title: 'Пополнение на складе',
      description: `Материал #${matAdd[1]}, +${body.quantity ?? body.amount ?? '—'}`,
      payload: { materialId: Number(matAdd[1]), ...body },
    };
  }
  const matSplit = path.match(/^\/api\/materials\/(\d+)\/split$/);
  if (matSplit && m === 'POST') {
    return {
      kind: 'material_split',
      title: 'Разделение материала',
      description: `Материал #${matSplit[1]}`,
      payload: { materialId: Number(matSplit[1]), ...body },
    };
  }
  const matDel = path.match(/^\/api\/materials\/(\d+)$/);
  if (matDel && m === 'DELETE') {
    return {
      kind: 'material_delete',
      title: 'Удаление материала',
      description: `ID ${matDel[1]}`,
      payload: { materialId: Number(matDel[1]) },
    };
  }
  const prodConfirm = path.match(/^\/api\/reports\/production\/issuances\/(\d+)\/confirm$/);
  if (prodConfirm && m === 'PATCH') {
    return {
      kind: 'production_confirm',
      title: 'Подтверждение выработки',
      description: `Выдача #${prodConfirm[1]}`,
      payload: { issuanceId: Number(prodConfirm[1]), ...body },
    };
  }
  const prodLoc = path.match(/^\/api\/reports\/production\/issuances\/(\d+)\/location$/);
  if (prodLoc && m === 'PATCH') {
    return {
      kind: 'production_location',
      title: 'Адрес выработки',
      description: `Выдача #${prodLoc[1]}`,
      payload: { issuanceId: Number(prodLoc[1]), ...body },
    };
  }
  const prodUnc = path.match(/^\/api\/reports\/production\/issuances\/(\d+)\/unconfirm$/);
  if (prodUnc && m === 'PATCH') {
    return {
      kind: 'production_unconfirm',
      title: 'Снятие подтверждения выработки',
      description: `Выдача #${prodUnc[1]}`,
      payload: { issuanceId: Number(prodUnc[1]) },
    };
  }
  const issDel = path.match(/^\/api\/operations\/issuances\/(\d+)$/);
  if (issDel && m === 'DELETE') {
    return {
      kind: 'issuance_delete',
      title: 'Удаление выдачи',
      description: `Выдача #${issDel[1]}`,
      payload: { issuanceId: Number(issDel[1]) },
    };
  }
  if (path === '/api/operations/issuances/all' && m === 'DELETE') {
    return {
      kind: 'issuance_delete_all',
      title: 'Удаление всех выдач',
      description: 'Массовое удаление выдач',
      payload: {},
    };
  }

  if (path === '/api/attendance/register-face' && m === 'POST') {
    return {
      kind: 'attendance_register_face',
      title: 'Регистрация шаблона лица',
      description: body.user_id ? `Пользователь #${body.user_id}` : 'Свой профиль',
      payload: attendancePayload(body),
    };
  }
  if (path === '/api/attendance/scan' && m === 'POST') {
    return {
      kind: 'attendance_face_scan',
      title: 'Отметка по лицу',
      description: 'Оффлайн-отметка: ожидание синхронизации',
      payload: attendancePayload(body),
    };
  }
  if (path === '/api/attendance/timesheet/day' && m === 'PATCH') {
    return {
      kind: 'attendance_timesheet_day',
      title: body.clear ? 'Очистка ячейки табеля' : 'Правка табеля (день)',
      description: describeTimesheetBody(body),
      payload: attendancePayload(body),
    };
  }
  if (path === '/api/attendance/timesheet/hours' && m === 'PATCH') {
    return {
      kind: 'attendance_timesheet_hours',
      title: 'Правка часов в табеле',
      description: describeTimesheetBody(body),
      payload: attendancePayload(body),
    };
  }
  if (path === '/api/attendance/timesheet/times' && m === 'PATCH') {
    return {
      kind: 'attendance_timesheet_times',
      title: 'Правка времени в табеле',
      description: describeTimesheetBody(body),
      payload: attendancePayload(body),
    };
  }
  if (path === '/api/attendance/timesheet/rates' && m === 'PATCH') {
    return {
      kind: 'attendance_timesheet_rates',
      title: 'Изменение ставок в табеле',
      description: describeTimesheetRates(body),
      payload: attendancePayload(body),
    };
  }
  if (path === '/api/attendance/timesheet/members' && m === 'POST') {
    return {
      kind: 'attendance_timesheet_member',
      title: 'Добавление в табель',
      description: `Сотрудник #${body.user_id}, месяц ${body.month || '—'}`,
      payload: attendancePayload(body),
    };
  }

  if (shouldRecordAction(path, method)) {
    return {
      kind: 'api_mutation',
      title: 'Изменение данных',
      description: `${m} ${path}`,
      payload: { path, method: m, body },
    };
  }
  return null;
}

function describeIssue(body) {
  const parts = [];
  if (body.material_id) parts.push(`материал #${body.material_id}`);
  if (body.quantity != null) parts.push(`кол-во ${body.quantity}`);
  if (body.issued_to_user_id) parts.push(`получатель #${body.issued_to_user_id}`);
  return parts.length ? parts.join(', ') : null;
}

function describeReturn(body) {
  const parts = [];
  if (body.issuance_id) parts.push(`выдача #${body.issuance_id}`);
  if (body.quantity != null) parts.push(`кол-во ${body.quantity}`);
  return parts.length ? parts.join(', ') : null;
}

const OFFLINE_SKIP = [
  '/import',
  '/export',
  '/qr-pdf',
  '/register-face',
  '/timesheet/import',
];

/** Записывать в журнал действий (шире, чем офлайн-очередь). */
export function shouldRecordAction(path, method) {
  const m = (method || 'GET').toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(m)) return false;
  if (OFFLINE_SKIP.some((s) => path.includes(s))) return false;
  if (path.startsWith('/api/operations/')) return true;
  if (path.startsWith('/api/materials')) return true;
  if (path.startsWith('/api/reports/production/issuances/')) return true;
  if (path.startsWith('/api/attendance/timesheet/')) return true;
  if (path === '/api/attendance/register-face') return true;
  return false;
}

export function shouldQueueOfflineMutation(path, method) {
  const m = (method || 'GET').toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(m)) return false;
  if (OFFLINE_SKIP.some((s) => path.includes(s))) return false;
  if (path.startsWith('/api/operations/')) return true;
  if (path.startsWith('/api/materials')) return true;
  if (path.startsWith('/api/reports/production/issuances/')) return true;
  if (path.startsWith('/api/attendance/timesheet/')) return true;
  if (path === '/api/attendance/scan') return true;
  return false;
}

function attendancePayload(body) {
  const { descriptor, face_image, ...rest } = body || {};
  return rest;
}

function describeTimesheetBody(body) {
  const parts = [];
  if (body.user_id) parts.push(`сотр. #${body.user_id}`);
  if (body.date) parts.push(body.date);
  if (body.month) parts.push(`месяц ${body.month}`);
  if (body.clear) parts.push('очистка');
  if (body.check_in != null && body.check_in !== '') parts.push(`приход ${body.check_in}`);
  if (body.check_out != null && body.check_out !== '') parts.push(`уход ${body.check_out}`);
  if (body.worked_hours != null && body.worked_hours !== '') parts.push(`часы ${body.worked_hours}`);
  if (body.worked_minutes != null && body.worked_minutes !== '') parts.push(`мин. ${body.worked_minutes}`);
  if (body.day_comment) parts.push('комментарий');
  return parts.length ? parts.join(', ') : null;
}

function describeTimesheetRates(body) {
  const parts = [];
  if (body.user_id) parts.push(`сотр. #${body.user_id}`);
  if (body.month) parts.push(`месяц ${body.month}`);
  const rateFields = ['rate', 'bonus_rate', 'rate_bonus', 'premium_rate'];
  rateFields.forEach((k) => {
    if (body[k] != null) parts.push(`${k}: ${body[k]}`);
  });
  return parts.length ? parts.join(', ') : null;
}

export function isNetworkFailure(err) {
  if (!err) return false;
  if (err.name === 'TypeError') return true;
  const msg = String(err.message || '');
  return /fetch|network|таймаут|failed|offline/i.test(msg);
}
