/** Все разделы и действия приложения, настраиваемые через роли */
export const APP_PERMISSIONS = [
  {
    key: 'can_warehouse',
    label: 'Склад',
    description: 'Материалы, остатки, QR-коды, импорт и экспорт Excel',
    group: 'Основные разделы',
  },
  {
    key: 'can_issuance',
    label: 'Выдача',
    description: 'Выдача материалов сотрудникам, возвраты, сканирование QR',
    group: 'Основные разделы',
  },
  {
    key: 'can_production',
    label: 'Выработка',
    description: 'Подтверждение выработки, отчёты по выдачам',
    group: 'Основные разделы',
  },
  {
    key: 'can_face',
    label: 'Отметка по лицу',
    description: 'Сканирование лица для отметки прихода (нужен шаблон лица)',
    group: 'Посещаемость',
  },
  {
    key: 'can_attendance',
    label: 'Журнал посещений',
    description: 'Доступ к табелю посещений',
    group: 'Посещаемость',
  },
  {
    key: 'can_attendance_all',
    label: 'Табель всех сотрудников',
    description: 'Просмотр табеля всех сотрудников (иначе — только свой)',
    group: 'Посещаемость',
    attendanceScopeOption: true,
  },
  {
    key: 'can_attendance_edit',
    label: 'Редактирование табеля',
    description: 'Правка ячеек, времени прихода/ухода и комментариев',
    group: 'Посещаемость',
    attendanceEditOption: true,
  },
  {
    key: 'can_attendance_edit_rates',
    label: 'Редактирование ставок',
    description: 'Изменение ставки и ставки премии в табеле',
    group: 'Посещаемость',
    attendanceRatesOption: true,
  },
  {
    key: 'can_attendance_pay',
    label: 'Табель с расчётом',
    description: 'Ставки, заработок и премии в табеле',
    group: 'Посещаемость',
    attendancePayOption: true,
  },
  {
    key: 'can_attendance_add_member',
    label: 'Добавить сотрудника в табель',
    description: 'Ручное добавление строки в табель месяца',
    group: 'Посещаемость',
    attendanceToolsOption: true,
  },
  {
    key: 'can_attendance_export',
    label: 'Экспорт табеля',
    description: 'Выгрузка табеля в Excel',
    group: 'Посещаемость',
    attendanceToolsOption: true,
  },
  {
    key: 'can_attendance_import',
    label: 'Импорт табеля',
    description: 'Загрузка табеля из Excel',
    group: 'Посещаемость',
    attendanceToolsOption: true,
  },
  {
    key: 'can_attendance_change_month',
    label: 'Выбор месяца табеля',
    description: 'Переход к другим месяцам (‹ ›, календарь, «Текущий месяц»)',
    group: 'Посещаемость',
    attendanceMonthOption: true,
  },
  {
    key: 'can_settings_organizations',
    label: 'Организации',
    description: 'Справочник организаций в настройках',
    group: 'Настройка',
  },
  {
    key: 'can_settings_warehouses',
    label: 'Склады',
    description: 'Склады и места хранения',
    group: 'Настройка',
  },
  {
    key: 'can_settings_categories',
    label: 'Категории',
    description: 'Категории материалов',
    group: 'Настройка',
  },
  {
    key: 'can_settings_work',
    label: 'Место проведения работ',
    description: 'Объекты, подъезды, этажи, квартиры и помещения',
    group: 'Настройка',
  },
  {
    key: 'can_users',
    label: 'Пользователи',
    description: 'Учётные записи, импорт и экспорт пользователей',
    group: 'Настройка',
  },
  {
    key: 'can_roles',
    label: 'Роли',
    description: 'Роли и права доступа к разделам',
    group: 'Настройка',
  },
];

export const PERMISSION_KEYS = APP_PERMISSIONS.map((p) => p.key);

/** Права, дающие доступ хотя бы к одной вкладке «Настройка» */
export const SETTINGS_ACCESS_KEYS = PERMISSION_KEYS.filter((k) =>
  k.startsWith('can_settings_') || k === 'can_users' || k === 'can_roles',
);

export const ADMIN_ROLE_NAME = 'Администратор';

export function isAdminRoleName(name) {
  return String(name ?? '').trim().toLowerCase() === ADMIN_ROLE_NAME.toLowerCase();
}

export function fullPermissionFlags(value = true) {
  return Object.fromEntries(PERMISSION_KEYS.map((k) => [k, !!value]));
}

export function permissionsFromBody(body = {}) {
  const perms = Object.fromEntries(PERMISSION_KEYS.map((k) => [k, !!body[k]]));
  if (!perms.can_attendance) {
    perms.can_attendance_all = false;
    perms.can_attendance_edit = false;
    perms.can_attendance_pay = false;
    perms.can_attendance_edit_rates = false;
    perms.can_attendance_add_member = false;
    perms.can_attendance_export = false;
    perms.can_attendance_import = false;
    perms.can_attendance_change_month = false;
  }
  if (!perms.can_attendance_pay) perms.can_attendance_edit_rates = false;
  if (!perms.can_attendance_all) {
    perms.can_attendance_add_member = false;
    perms.can_attendance_import = false;
  }
  return perms;
}

export const ROLE_COLUMNS = PERMISSION_KEYS.join(', ');

export function userHasAnyPermission(user, keys) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return keys.some((k) => user[k]);
}
