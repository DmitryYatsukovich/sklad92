/** Все разделы и действия приложения, настраиваемые через роли */
export const APP_PERMISSIONS = [
  {
    key: 'can_warehouse',
    label: 'Склад',
    description: 'Материалы, остатки, QR-коды, импорт и экспорт Excel',
    group: 'Основные разделы',
  },
  {
    key: 'can_warehouse_view',
    label: 'Склад: просмотр материалов',
    description: 'Отображение списка материалов и просмотр карточек',
    group: 'Основные разделы',
  },
  {
    key: 'can_warehouse_edit',
    label: 'Склад: редактирование материалов',
    description: 'Добавление и изменение материалов, приход, импорт',
    group: 'Основные разделы',
  },
  {
    key: 'can_warehouse_qr_scan',
    label: 'Склад: распознавание QR',
    description: 'Поиск материалов через QR-сканер',
    group: 'Основные разделы',
  },
  {
    key: 'can_warehouse_issue',
    label: 'Склад: выдача материалов',
    description: 'Выдача материалов сотрудникам из карточки склада',
    group: 'Основные разделы',
  },
  {
    key: 'can_warehouse_move',
    label: 'Склад: перемещение материалов',
    description: 'Перемещение между объектами/складами/стеллажами',
    group: 'Основные разделы',
  },
  {
    key: 'can_warehouse_split',
    label: 'Склад: разделение материалов',
    description: 'Разделение на части и группировка',
    group: 'Основные разделы',
  },
  {
    key: 'can_warehouse_delete',
    label: 'Склад: удаление материалов',
    description: 'Удаление материалов и очистка склада',
    group: 'Основные разделы',
  },
  {
    key: 'can_warehouse_filters',
    label: 'Склад: фильтры',
    description: 'Доступ к фильтрам и строкам поиска на вкладке склада',
    group: 'Основные разделы',
  },
  {
    key: 'can_warehouse_issue_qr_only',
    label: 'Склад: выдача только по QR',
    description: 'Скрывает кнопку «Выдать» при открытии материала из списка; выдача доступна только после сканирования QR',
    group: 'Основные разделы',
  },
  {
    key: 'can_warehouse_import',
    label: 'Склад: импорт',
    description: 'Доступ к кнопке и API импорта материалов из Excel',
    group: 'Основные разделы',
  },
  {
    key: 'can_warehouse_invoice_import',
    label: 'Склад: добавить по накладной',
    description: 'Распознавание фото/PDF накладной и массовое добавление материалов на склад',
    group: 'Основные разделы',
  },
  {
    key: 'can_warehouse_export',
    label: 'Склад: экспорт',
    description: 'Доступ к кнопкам и API экспорта Excel/PDF',
    group: 'Основные разделы',
  },
  {
    key: 'can_warehouse_col_number',
    label: 'Склад: столбец №',
    description: 'Отображение столбца номера строки',
    group: 'Основные разделы',
  },
  {
    key: 'can_warehouse_col_qr',
    label: 'Склад: столбец QR',
    description: 'Отображение столбца QR',
    group: 'Основные разделы',
  },
  {
    key: 'can_warehouse_col_name',
    label: 'Склад: столбец Наимен.',
    description: 'Отображение столбца наименования материала',
    group: 'Основные разделы',
  },
  {
    key: 'can_warehouse_col_unit',
    label: 'Склад: столбец Ед.',
    description: 'Отображение столбца единицы измерения',
    group: 'Основные разделы',
  },
  {
    key: 'can_warehouse_col_quantity',
    label: 'Склад: столбец Кол.',
    description: 'Отображение столбца количества',
    group: 'Основные разделы',
  },
  {
    key: 'can_warehouse_col_on_hands',
    label: 'Склад: столбец На руках',
    description: 'Отображение столбца количества на руках',
    group: 'Основные разделы',
  },
  {
    key: 'can_warehouse_col_object',
    label: 'Склад: столбец Объект',
    description: 'Отображение столбца объекта',
    group: 'Основные разделы',
  },
  {
    key: 'can_warehouse_col_warehouse',
    label: 'Склад: столбец Склад',
    description: 'Отображение столбца склада',
    group: 'Основные разделы',
  },
  {
    key: 'can_warehouse_col_rack',
    label: 'Склад: столбец Стеллаж',
    description: 'Отображение столбца стеллажа',
    group: 'Основные разделы',
  },
  {
    key: 'can_warehouse_col_system',
    label: 'Склад: столбец Система',
    description: 'Отображение столбца системы',
    group: 'Основные разделы',
  },
  {
    key: 'can_warehouse_col_organization',
    label: 'Склад: столбец Организация',
    description: 'Отображение столбца организации',
    group: 'Основные разделы',
  },
  {
    key: 'can_warehouse_col_category',
    label: 'Склад: столбец Кат.',
    description: 'Отображение столбца категории',
    group: 'Основные разделы',
  },
  {
    key: 'can_warehouse_col_price',
    label: 'Склад: столбец Стоимость за ед.',
    description: 'Отображение столбца стоимости за единицу',
    group: 'Основные разделы',
  },
  {
    key: 'can_warehouse_col_cost_total',
    label: 'Склад: столбец Стоимость',
    description: 'Отображение столбца суммарной стоимости',
    group: 'Основные разделы',
  },
  {
    key: 'can_warehouse_col_smr_unit',
    label: 'Склад: столбец СМР за ед.',
    description: 'Отображение столбца СМР за единицу',
    group: 'Основные разделы',
  },
  {
    key: 'can_warehouse_col_smr_total',
    label: 'Склад: столбец СМР',
    description: 'Отображение столбца суммарной СМР',
    group: 'Основные разделы',
  },
  {
    key: 'can_warehouse_col_updated_at',
    label: 'Склад: столбец Изменён',
    description: 'Отображение столбца даты изменения',
    group: 'Основные разделы',
  },
  {
    key: 'can_warehouse_col_description',
    label: 'Склад: столбец Описание',
    description: 'Отображение столбца описания',
    group: 'Основные разделы',
  },
  {
    key: 'can_issuance',
    label: 'Выдача',
    description: 'Выдача материалов сотрудникам, возвраты, сканирование QR',
    group: 'Основные разделы',
  },
  {
    key: 'can_issuance_return',
    label: 'Выдача: кнопка «Возврат»',
    description: 'Возврат материалов на склад',
    group: 'Основные разделы',
  },
  {
    key: 'can_issuance_transfer',
    label: 'Выдача: кнопка «Передать»',
    description: 'Передача материала между сотрудниками',
    group: 'Основные разделы',
  },
  {
    key: 'can_issuance_production',
    label: 'Выдача: кнопка «Выработать»',
    description: 'Назначение выработки по выдаче',
    group: 'Основные разделы',
  },
  {
    key: 'can_issuance_all',
    label: 'Выдачи всех пользователей',
    description: 'Просмотр всех выдач (иначе — только выдач пользователя)',
    group: 'Основные разделы',
    issuanceScopeOption: true,
  },
  {
    key: 'can_issuance_all_issued',
    label: 'Выдачи: все по выдавшему',
    description: 'Показывать выдачи, оформленные любыми пользователями',
    group: 'Основные разделы',
    issuanceScopeOption: true,
  },
  {
    key: 'can_issuance_all_received',
    label: 'Выдачи: все по получателю',
    description: 'Показывать выдачи, принятые любыми пользователями',
    group: 'Основные разделы',
    issuanceScopeOption: true,
  },
  {
    key: 'can_production',
    label: 'Выработка',
    description: 'Подтверждение выработки, отчёты по выдачам',
    group: 'Основные разделы',
  },
  {
    key: 'can_objects',
    label: 'Объекты',
    description: 'Схема объектов: подъезды, этажи, квартиры и помещения',
    group: 'Основные разделы',
  },
  {
    key: 'can_tools',
    label: 'Инструмент',
    description: 'Учёт инструмента, QR-сканирование, выдача и перемещения',
    group: 'Основные разделы',
  },
  {
    key: 'can_tools_delete',
    label: 'Удаление инструмента',
    description: 'Удаление карточек инструмента и их истории',
    group: 'Основные разделы',
  },
  {
    key: 'can_tasks',
    label: 'Задачи',
    description: 'Постановка и контроль задач сотрудников',
    group: 'Основные разделы',
  },
  {
    key: 'can_task_notifications',
    label: 'Уведомления о задачах',
    description: 'In-app и push-уведомления при назначении задач пользователю',
    group: 'Основные разделы',
  },
  {
    key: 'can_tasks_all',
    label: 'Задачи всех пользователей',
    description: 'Просмотр и управление всеми задачами (иначе — только своими)',
    group: 'Основные разделы',
    tasksScopeOption: true,
  },
  {
    key: 'can_actions',
    label: 'Действия',
    description: 'Журнал операций в приложении, офлайн-синхронизация',
    group: 'Основные разделы',
  },
  {
    key: 'can_actions_all',
    label: 'Действия всех пользователей',
    description: 'Просмотр журнала действий всех сотрудников (иначе — только свои)',
    group: 'Основные разделы',
    actionsScopeOption: true,
  },
  {
    key: 'can_face',
    label: 'Отметка по лицу',
    description: 'Сканирование лица для отметки прихода (нужен шаблон лица)',
    group: 'Посещаемость',
  },
  {
    key: 'can_face_all',
    label: 'Отметка всех сотрудников',
    description: 'Разрешает отмечать по лицу всех сотрудников (иначе — только себя)',
    group: 'Посещаемость',
    faceScopeOption: true,
  },
  {
    key: 'can_face_same_org',
    label: 'Отметка своей организации',
    description: 'Ограничивает отметку по лицу только сотрудниками своей организации',
    group: 'Посещаемость',
    faceScopeOption: true,
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
    key: 'can_attendance_same_org',
    label: 'Табель своей организации',
    description: 'Ограничение табеля сотрудниками той же организации, что и у пользователя',
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
    key: 'can_settings_tools',
    label: 'Виды инструмента',
    description: 'Справочник видов инструмента (перфоратор, шуроповерт и т.д.)',
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
  if (perms.can_settings_work) {
    // Доступ к рабочей схеме в настройках должен включать просмотр вкладки «Объекты».
    perms.can_objects = true;
  }
  if (!perms.can_tasks) {
    perms.can_task_notifications = false;
    perms.can_tasks_all = false;
  }
  if (!perms.can_issuance) {
    perms.can_issuance_return = false;
    perms.can_issuance_transfer = false;
    perms.can_issuance_production = false;
    perms.can_issuance_all = false;
    perms.can_issuance_all_issued = false;
    perms.can_issuance_all_received = false;
  }
  if (perms.can_issuance_all) {
    perms.can_issuance_all_issued = true;
    perms.can_issuance_all_received = true;
  } else if (perms.can_issuance_all_issued && perms.can_issuance_all_received) {
    perms.can_issuance_all = true;
  }
  if (!perms.can_tools) {
    perms.can_tools_delete = false;
  }
  if (!perms.can_actions) {
    perms.can_actions_all = false;
  }
  if (!perms.can_warehouse) {
    perms.can_warehouse_view = false;
    perms.can_warehouse_edit = false;
    perms.can_warehouse_qr_scan = false;
    perms.can_warehouse_issue = false;
    perms.can_warehouse_move = false;
    perms.can_warehouse_split = false;
    perms.can_warehouse_delete = false;
    perms.can_warehouse_filters = false;
    perms.can_warehouse_issue_qr_only = false;
    perms.can_warehouse_import = false;
    perms.can_warehouse_invoice_import = false;
    perms.can_warehouse_export = false;
    perms.can_warehouse_col_number = false;
    perms.can_warehouse_col_qr = false;
    perms.can_warehouse_col_name = false;
    perms.can_warehouse_col_unit = false;
    perms.can_warehouse_col_quantity = false;
    perms.can_warehouse_col_on_hands = false;
    perms.can_warehouse_col_object = false;
    perms.can_warehouse_col_warehouse = false;
    perms.can_warehouse_col_rack = false;
    perms.can_warehouse_col_system = false;
    perms.can_warehouse_col_organization = false;
    perms.can_warehouse_col_category = false;
    perms.can_warehouse_col_price = false;
    perms.can_warehouse_col_cost_total = false;
    perms.can_warehouse_col_smr_unit = false;
    perms.can_warehouse_col_smr_total = false;
    perms.can_warehouse_col_updated_at = false;
    perms.can_warehouse_col_description = false;
  }
  if (!perms.can_warehouse_view) {
    perms.can_warehouse_filters = false;
    perms.can_warehouse_export = false;
    perms.can_warehouse_col_number = false;
    perms.can_warehouse_col_qr = false;
    perms.can_warehouse_col_name = false;
    perms.can_warehouse_col_unit = false;
    perms.can_warehouse_col_quantity = false;
    perms.can_warehouse_col_on_hands = false;
    perms.can_warehouse_col_object = false;
    perms.can_warehouse_col_warehouse = false;
    perms.can_warehouse_col_rack = false;
    perms.can_warehouse_col_system = false;
    perms.can_warehouse_col_organization = false;
    perms.can_warehouse_col_category = false;
    perms.can_warehouse_col_price = false;
    perms.can_warehouse_col_cost_total = false;
    perms.can_warehouse_col_smr_unit = false;
    perms.can_warehouse_col_smr_total = false;
    perms.can_warehouse_col_updated_at = false;
    perms.can_warehouse_col_description = false;
  }
  if (!perms.can_warehouse_import) {
    perms.can_warehouse_invoice_import = false;
  }
  if (!perms.can_warehouse_issue) {
    perms.can_warehouse_issue_qr_only = false;
  }
  if (!perms.can_attendance) {
    perms.can_attendance_all = false;
    perms.can_attendance_same_org = false;
    perms.can_attendance_edit = false;
    perms.can_attendance_pay = false;
    perms.can_attendance_edit_rates = false;
    perms.can_attendance_add_member = false;
    perms.can_attendance_export = false;
    perms.can_attendance_import = false;
    perms.can_attendance_change_month = false;
  }
  if (!perms.can_face) {
    perms.can_face_all = false;
    perms.can_face_same_org = false;
  }
  if (!perms.can_face_all) {
    perms.can_face_same_org = false;
  }
  if (!perms.can_attendance_pay) perms.can_attendance_edit_rates = false;
  if (!perms.can_attendance_all) {
    perms.can_attendance_same_org = false;
    perms.can_attendance_add_member = false;
    perms.can_attendance_import = false;
  }
  return perms;
}

export const ROLE_COLUMNS = PERMISSION_KEYS.join(', ');

export function userHasAnyPermission(user, keys) {
  if (!user) return false;
  if (user.admin_permission_bypass) return true;
  return keys.some((k) => user[k]);
}
