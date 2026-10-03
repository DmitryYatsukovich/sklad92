import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { settings as settingsApi } from '../api';
import Users from './Users';
import RolesTab from '../settings/RolesTab';
import OrganizationsTab from './settings/OrganizationsTab';
import {
  canAccessSettingsTab,
  getFirstSettingsTab,
  hasAnySettingsAccess,
  SETTINGS_TAB_PERMISSIONS,
} from '../lib/settingsPermissions.js';

const MAIN_TABS = [
  { id: 'organizations', label: 'Организации', perm: SETTINGS_TAB_PERMISSIONS.organizations },
  { id: 'warehouses', label: 'Склады', perm: SETTINGS_TAB_PERMISSIONS.warehouses },
  { id: 'categories', label: 'Категории', perm: SETTINGS_TAB_PERMISSIONS.categories },
  { id: 'systems', label: 'Система', perm: SETTINGS_TAB_PERMISSIONS.systems },
  { id: 'work', label: 'Место проведения работ', perm: SETTINGS_TAB_PERMISSIONS.work },
  { id: 'tools', label: 'Виды инструмента', perm: SETTINGS_TAB_PERMISSIONS.tools },
];

const WAREHOUSE_SUB_TABS = [
  { id: 'warehouses', label: 'Склады' },
  { id: 'storage', label: 'Место хранения' },
];

const WORK_SUB_TABS = [
  { id: 'objects', label: 'Объекты' },
  { id: 'entrances', label: 'Подъезды' },
  { id: 'floors', label: 'Этажи' },
  { id: 'apartments', label: 'Квартиры, помещения' },
];

const EMPTY_CATALOG = {
  objects: [],
  warehouses: [],
  racks: [],
  categories: [],
  systems: [],
  organizations: [],
  work_entrances: [],
  work_floors: [],
  work_apartments: [],
  work_rooms: [],
  tool_types: [],
};
const FLOOR_ROOMS_BUCKET_NAME = 'Помещения этажа';
const FLOOR_ROOMS_DISPLAY_TITLE = 'Помещения на этаже';

function isRowObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asArrayOfObjects(value) {
  return Array.isArray(value)
    ? value.filter((row) => isRowObject(row))
    : [];
}

function normalizeCatalog(value) {
  const safe = isRowObject(value) ? value : {};
  return {
    objects: asArrayOfObjects(safe.objects),
    warehouses: asArrayOfObjects(safe.warehouses),
    racks: asArrayOfObjects(safe.racks),
    categories: asArrayOfObjects(safe.categories),
    systems: asArrayOfObjects(safe.systems),
    organizations: asArrayOfObjects(safe.organizations),
    work_entrances: asArrayOfObjects(safe.work_entrances),
    work_floors: asArrayOfObjects(safe.work_floors),
    work_apartments: asArrayOfObjects(safe.work_apartments),
    work_rooms: asArrayOfObjects(safe.work_rooms),
    tool_types: asArrayOfObjects(safe.tool_types),
  };
}

function tabButtonClass(active, variant = 'main') {
  if (variant === 'work' || variant === 'warehouse') {
    return active
      ? variant === 'work'
        ? 'px-3 py-1.5 rounded-lg text-sm font-semibold bg-emerald-600 text-white shadow-sm ring-1 ring-emerald-400/40'
        : 'px-3 py-1.5 rounded-lg text-sm font-semibold bg-sky-600 text-white shadow-sm ring-1 ring-sky-400/40'
      : 'px-3 py-1.5 rounded-lg text-sm font-medium bg-zinc-800 text-zinc-100 border border-zinc-600 hover:bg-zinc-700 hover:text-white';
  }
  return active
    ? 'px-4 py-2 rounded-xl text-sm font-semibold bg-sky-600 text-white shadow-sm ring-1 ring-sky-400/40'
    : 'px-4 py-2 rounded-xl text-sm font-medium bg-zinc-800 text-zinc-100 border border-zinc-600 hover:bg-zinc-700 hover:text-white';
}

function naturalCompare(a, b) {
  return String(a || '').localeCompare(String(b || ''), 'ru', { numeric: true, sensitivity: 'base' });
}

function sortByNaturalName(items) {
  return [...items].sort((a, b) => naturalCompare(a?.name, b?.name));
}

function toggleSelection(list, id) {
  const key = String(id);
  return list.includes(key) ? list.filter((x) => x !== key) : [...list, key];
}

const CATEGORY_ICON_OPTIONS = [
  { key: 'electrical', label: 'Электромонтаж', hint: 'Базовая электрика', group: 'electrical' },
  { key: 'cable', label: 'Кабельные линии', hint: 'Кабели и трассы', group: 'electrical' },
  { key: 'panel', label: 'Щитовое оборудование', hint: 'Щиты и автоматика', group: 'electrical' },
  { key: 'socket', label: 'Розетки и точки питания', hint: 'Розетки/питание', group: 'electrical' },
  { key: 'switchgear', label: 'Коммутация', hint: 'Выключатели и автоматы', group: 'electrical' },
  { key: 'lighting', label: 'Освещение', hint: 'Светильники и линии', group: 'electrical' },
  { key: 'grounding', label: 'Заземление', hint: 'PE/N шины', group: 'electrical' },
  { key: 'power_supply', label: 'Блоки питания', hint: 'БП, ИБП', group: 'electrical' },
  { key: 'battery', label: 'Аккумуляторы', hint: 'Резервное питание', group: 'electrical' },

  { key: 'fire_alarm', label: 'Пожарная сигнализация', hint: 'ОПС/АПС', group: 'fire' },
  { key: 'smoke_detector', label: 'Дымовой извещатель', hint: 'Дымовые датчики', group: 'fire' },
  { key: 'heat_detector', label: 'Тепловой извещатель', hint: 'Тепловые датчики', group: 'fire' },
  { key: 'siren', label: 'Оповещение и сирены', hint: 'Звуковое оповещение', group: 'fire' },
  { key: 'call_point', label: 'Ручной извещатель', hint: 'Кнопки пожарной тревоги', group: 'fire' },

  { key: 'access_control', label: 'СКУД', hint: 'Контроль доступа', group: 'access' },
  { key: 'lock', label: 'Замки', hint: 'Электромагнитные/электромеханические', group: 'access' },
  { key: 'card_reader', label: 'Считыватели', hint: 'Карты и брелоки', group: 'access' },
  { key: 'turnstile', label: 'Турникеты', hint: 'Точки прохода', group: 'access' },
  { key: 'intercom', label: 'Домофония', hint: 'Домофоны и панели', group: 'access' },

  { key: 'video_surveillance', label: 'Видеонаблюдение', hint: 'CCTV', group: 'video' },
  { key: 'camera_dome', label: 'Купольные камеры', hint: 'Внутренние камеры', group: 'video' },
  { key: 'recorder', label: 'Видеорегистраторы', hint: 'NVR/DVR', group: 'video' },
  { key: 'monitor', label: 'Мониторы', hint: 'Пост наблюдения', group: 'video' },

  { key: 'dispatching', label: 'Диспетчеризация', hint: 'BMS/SCADA', group: 'automation' },
  { key: 'automation', label: 'Автоматизация', hint: 'Логика управления', group: 'automation' },
  { key: 'controller', label: 'Контроллеры', hint: 'ПЛК и модули', group: 'automation' },
  { key: 'networking', label: 'Сети связи', hint: 'Сетевое оборудование', group: 'automation' },
  { key: 'server_rack', label: 'Серверные шкафы', hint: 'Рэки и узлы связи', group: 'automation' },

  { key: 'toolbox', label: 'Инструмент', hint: 'Сервисные позиции', group: 'general' },
  { key: 'mounting', label: 'Крепёж и монтаж', hint: 'Метизы и монтажные элементы', group: 'general' },
  { key: 'sensor', label: 'Датчики', hint: 'Универсальные датчики', group: 'general' },
  { key: 'relay', label: 'Реле и пускатели', hint: 'Промежуточная автоматика', group: 'general' },
  { key: 'other', label: 'Прочее', hint: 'Универсальная категория', group: 'general' },
];

const CATEGORY_ICON_GROUP_LABELS = {
  electrical: 'Электрика',
  fire: 'Пожарка',
  access: 'СКУД',
  video: 'Видео',
  automation: 'Автоматика',
  general: 'Общее',
};

const CATEGORY_ICON_GROUP_STYLES = {
  electrical: 'bg-sky-500/15 text-sky-300 ring-sky-400/35',
  fire: 'bg-rose-500/15 text-rose-300 ring-rose-400/35',
  access: 'bg-violet-500/15 text-violet-300 ring-violet-400/35',
  video: 'bg-cyan-500/15 text-cyan-300 ring-cyan-400/35',
  automation: 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/35',
  general: 'bg-zinc-500/20 text-zinc-200 ring-zinc-400/30',
};

const CATEGORY_ICON_META = CATEGORY_ICON_OPTIONS.reduce((acc, option) => {
  acc[option.key] = {
    label: option.label,
    badgeClass: CATEGORY_ICON_GROUP_STYLES[option.group] || CATEGORY_ICON_GROUP_STYLES.general,
  };
  return acc;
}, {});

function inferCategoryIconKey(name) {
  const source = String(name || '').toLowerCase();
  if (/дым|smoke/.test(source)) return 'smoke_detector';
  if (/тепл|heat/.test(source)) return 'heat_detector';
  if (/сирен|оповещ|alert/.test(source)) return 'siren';
  if (/пожар|огнет|извещ|апс|опс/.test(source)) return 'fire_alarm';

  if (/турникет/.test(source)) return 'turnstile';
  if (/считыв|rfid|карта|брелок/.test(source)) return 'card_reader';
  if (/замок/.test(source)) return 'lock';
  if (/домофон|панел.*вызова/.test(source)) return 'intercom';
  if (/скуд|доступ|пропуск/.test(source)) return 'access_control';

  if (/регистрат|nvr|dvr/.test(source)) return 'recorder';
  if (/купол|dome/.test(source)) return 'camera_dome';
  if (/видео|камер|cctv|наблюд/.test(source)) return 'video_surveillance';
  if (/монитор|экран/.test(source)) return 'monitor';

  if (/сервер|шкаф/.test(source)) return 'server_rack';
  if (/сет|коммут|router|switch/.test(source)) return 'networking';
  if (/контроллер|плк|plc/.test(source)) return 'controller';
  if (/диспет|bms|scada/.test(source)) return 'dispatching';
  if (/автоматизац|управ/.test(source)) return 'automation';

  if (/кабел|провод/.test(source)) return 'cable';
  if (/щит/.test(source)) return 'panel';
  if (/розет|питан/.test(source)) return 'socket';
  if (/выкл|автомат|узо|коммутац/.test(source)) return 'switchgear';
  if (/свет|ламп|освещ/.test(source)) return 'lighting';
  if (/зазем/.test(source)) return 'grounding';
  if (/ибп|блок питан/.test(source)) return 'power_supply';
  if (/аккум|батар/.test(source)) return 'battery';

  if (/датчик|сенсор/.test(source)) return 'sensor';
  if (/реле|пускател/.test(source)) return 'relay';
  if (/креп|болт|гайк|хомут|скоб/.test(source)) return 'mounting';
  if (/инструмент|ящик/.test(source)) return 'toolbox';
  if (/элект/.test(source)) return 'electrical';
  return 'other';
}

function resolveCategoryMiniature({ name, icon_key }) {
  const preferred = String(icon_key || '').trim();
  const key = CATEGORY_ICON_META[preferred] ? preferred : inferCategoryIconKey(name);
  const meta = CATEGORY_ICON_META[key] || CATEGORY_ICON_META.other;
  return {
    key,
    label: meta.label,
    badgeClass: meta.badgeClass,
  };
}

function CategoryGlyph({ iconKey, className = 'h-4 w-4' }) {
  if (iconKey === 'electrical') return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <path d="M13 2L5 13h6l-1 9 9-13h-6l1-7z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
  if (iconKey === 'cable') return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <path d="M4 8h4m8 8h4M8 8c5 0 3 8 8 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="4" cy="8" r="1.5" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="20" cy="16" r="1.5" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
  if (iconKey === 'panel') return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <rect x="5" y="3.5" width="14" height="17" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 8h8M8 12h8M8 16h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
  if (iconKey === 'socket') return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="10" cy="11" r="0.9" fill="currentColor" />
      <circle cx="14" cy="11" r="0.9" fill="currentColor" />
      <path d="M12 14.5v1.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
  if (iconKey === 'switchgear') return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <rect x="4" y="8" width="16" height="8" rx="4" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="9" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
  if (iconKey === 'lighting') return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <path d="M12 3a6 6 0 0 0-3 11.2V17h6v-2.8A6 6 0 0 0 12 3z" stroke="currentColor" strokeWidth="1.7" />
      <path d="M10 20h4M9.5 18.5h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
  if (iconKey === 'grounding') return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <path d="M12 4v10M7 14h10M8.5 17h7M10 20h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
  if (iconKey === 'power_supply') return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <rect x="4" y="6" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M20 10v4M11 8l-2 4h3l-1 4 4-6h-3l1-2z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  if (iconKey === 'battery') return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <rect x="3" y="8" width="16" height="8" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M21 10v4M6 10h6v4H6z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
  if (iconKey === 'fire_alarm') return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <path d="M12 3c2 2 3 4 3 6 0 1.5-.5 2.7-1.6 3.8C12.2 14 12 15 12 16c0-1.2-.5-2.2-1.7-3.2C9.2 11.7 9 10.5 9 9c0-2 1-4 3-6z" stroke="currentColor" strokeWidth="1.7" />
      <path d="M7 16c0 2.8 2.2 5 5 5s5-2.2 5-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
  if (iconKey === 'smoke_detector') return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <circle cx="12" cy="11" r="5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M6 18c1-.8 2-.8 3 0m2 0c1-.8 2-.8 3 0m2 0c1-.8 2-.8 3 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
  if (iconKey === 'heat_detector') return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 4v2M12 18v2M4 12h2M18 12h2M6.4 6.4l1.4 1.4M16.2 16.2l1.4 1.4M17.6 6.4l-1.4 1.4M7.8 16.2l-1.4 1.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
  if (iconKey === 'siren') return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <path d="M8 14a4 4 0 0 1 8 0v3H8v-3z" stroke="currentColor" strokeWidth="1.7" />
      <path d="M6 20h12M12 5v2M5 9l2 1M19 9l-2 1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
  if (iconKey === 'call_point') return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M10.5 12h3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
  if (iconKey === 'access_control') return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <rect x="4" y="5" width="12" height="14" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 9h4M8 12h5M8 15h3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M17 12h3m-1.5-1.5L20 12l-1.5 1.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  if (iconKey === 'lock') return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <rect x="6" y="11" width="12" height="9" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M9 11V8a3 3 0 0 1 6 0v3" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="15" r="1" fill="currentColor" />
    </svg>
  );
  if (iconKey === 'card_reader') return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <rect x="4" y="6" width="11" height="12" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 10h3M8 13h5M17 10c1 .3 2 .9 3 2m-3 3c1-.3 2-.9 3-2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
  if (iconKey === 'turnstile') return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <path d="M6 19V9h12v10M12 9V5M9 12h6M12 12l-3 4M12 12l3 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  if (iconKey === 'intercom') return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <rect x="7" y="4" width="10" height="16" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M10 8h4M10 11h4M10 14h2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="14.5" cy="16.5" r="0.9" fill="currentColor" />
    </svg>
  );
  if (iconKey === 'video_surveillance') return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <path d="M3 10h12l3 3v3H6l-3-3v-3z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M15 10l4-2v2.5M8 16v2M12 16v2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  if (iconKey === 'camera_dome') return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <path d="M5 11a7 7 0 0 1 14 0H5z" stroke="currentColor" strokeWidth="1.7" />
      <path d="M6 14h12M9 11a3 3 0 1 0 6 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
  if (iconKey === 'recorder') return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <rect x="4" y="6" width="16" height="12" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 10h8M8 14h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="17" cy="14" r="1" fill="currentColor" />
    </svg>
  );
  if (iconKey === 'monitor') return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <rect x="4" y="5" width="16" height="11" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M9 19h6M12 16v3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
  if (iconKey === 'dispatching') return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <rect x="3" y="5" width="8" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
      <rect x="13" y="5" width="8" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
      <rect x="3" y="13" width="18" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M7 8h1M17 8h1M7 16h10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
  if (iconKey === 'automation') return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <circle cx="9" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="15" cy="15" r="2.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M10.8 10.8l2.4 2.4M9 18h2M15 6h2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
  if (iconKey === 'controller') return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <rect x="7" y="7" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M9 4v2M12 4v2M15 4v2M9 18v2M12 18v2M15 18v2M4 9h2M4 12h2M4 15h2M18 9h2M18 12h2M18 15h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
  if (iconKey === 'networking') return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <circle cx="6" cy="7" r="2" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="18" cy="7" r="2" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="17" r="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M7.7 8.2L10.3 15M16.3 8.2L13.7 15M8 7h8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
  if (iconKey === 'server_rack') return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <rect x="6" y="4" width="12" height="16" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8.5 8h7M8.5 12h7M8.5 16h7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="16.5" cy="8" r="0.8" fill="currentColor" />
      <circle cx="16.5" cy="12" r="0.8" fill="currentColor" />
      <circle cx="16.5" cy="16" r="0.8" fill="currentColor" />
    </svg>
  );
  if (iconKey === 'toolbox') return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <rect x="4" y="9" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M9 9V7h6v2M4 13h16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  if (iconKey === 'mounting') return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <path d="M8 16l8-8M7 10l7 7M10 7l7 7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="7" cy="17" r="2" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="17" cy="7" r="2" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
  if (iconKey === 'sensor') return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="1.7" fill="currentColor" />
      <path d="M7.5 12a4.5 4.5 0 0 1 9 0M5 12a7 7 0 0 1 14 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
  if (iconKey === 'relay') return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <rect x="4" y="7" width="8" height="10" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 10v4M8 12h8l4 3M16 12l4-3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <path d="M4 8l8-4 8 4-8 4-8-4z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M4 8v8l8 4 8-4V8" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function SimpleList({ items, onEdit, onDelete, extraCol, renderActions, renderTitleLeading }) {
  if (!items.length) return <p className="text-zinc-500 text-sm py-4">Список пуст. Добавьте запись.</p>;
  return (
    <div className="table-wrap">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-white/10 text-zinc-300">
            <th className="p-3 font-medium">Название</th>
            {extraCol && <th className="p-3 font-medium">{extraCol}</th>}
            <th className="p-3 w-28" />
          </tr>
        </thead>
        <tbody>
          {items.map((row) => (
            <tr key={row.id} className="border-b border-white/5">
              <td className="p-3 text-white">
                <div className="flex items-center gap-2">
                  {renderTitleLeading?.(row)}
                  <span>{row._displayName || row.name}</span>
                </div>
              </td>
              {extraCol && <td className="p-3 text-zinc-300">{row._extra || '—'}</td>}
              <td className="p-3">
                <div className="flex items-center justify-end gap-2">
                  {renderActions?.(row)}
                <button type="button" onClick={() => onEdit(row)} className="text-sky-400 hover:text-sky-300 text-sm font-medium">
                  Изм.
                </button>
                <button type="button" onClick={() => onDelete(row)} className="text-rose-400 hover:text-rose-300 text-sm font-medium">
                  Удал.
                </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Settings({ user }) {
  const location = useLocation();
  const canUsers = canAccessSettingsTab(user, SETTINGS_TAB_PERMISSIONS.users);
  const canRoles = canAccessSettingsTab(user, SETTINGS_TAB_PERMISSIONS.roles);
  const visibleMainTabs = MAIN_TABS.filter((t) => canAccessSettingsTab(user, t.perm));
  const canOrganizations = canAccessSettingsTab(user, SETTINGS_TAB_PERMISSIONS.organizations);

  const resolveInitialTab = () => {
    const loc = location.state?.tab;
    if (loc === 'users' && canUsers) return 'users';
    if (loc === 'roles' && canRoles) return 'roles';
    if (loc && MAIN_TABS.some((t) => t.id === loc) && canAccessSettingsTab(user, SETTINGS_TAB_PERMISSIONS[loc])) {
      return loc;
    }
    return getFirstSettingsTab(user) || 'users';
  };

  const [tab, setTab] = useState(resolveInitialTab);
  const [warehouseSubTab, setWarehouseSubTab] = useState('warehouses');
  const [workSubTab, setWorkSubTab] = useState('objects');
  const [collapsedWorkFloors, setCollapsedWorkFloors] = useState([]);
  const [catalog, setCatalog] = useState(EMPTY_CATALOG);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [categoryIconKey, setCategoryIconKey] = useState('');
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [categoryIconsExpanded, setCategoryIconsExpanded] = useState(false);
  const [categoryIconSearch, setCategoryIconSearch] = useState('');
  const [parentId, setParentId] = useState('');
  const [sortOrder, setSortOrder] = useState('');
  const [workItemKind, setWorkItemKind] = useState('apartment');
  const [workModalOpen, setWorkModalOpen] = useState(false);
  const [modalFloorId, setModalFloorId] = useState('');
  const [modalApartmentId, setModalApartmentId] = useState('');
  const [editing, setEditing] = useState(null);
  const formCardRef = useRef(null);
  const nameInputRef = useRef(null);

  const load = useCallback(() => {
    settingsApi.catalog()
      .then((data) => setCatalog(normalizeCatalog(data)))
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (tab !== 'users' && tab !== 'roles' && tab !== 'organizations') load();
  }, [load, tab]);

  useEffect(() => {
    const loc = location.state?.tab;
    if (loc === 'users' && canUsers) setTab('users');
    else if (loc === 'roles' && canRoles) setTab('roles');
    else if (loc && canAccessSettingsTab(user, SETTINGS_TAB_PERMISSIONS[loc])) setTab(loc);
  }, [location.state?.tab, canUsers, canRoles, user]);

  useEffect(() => {
    const allowed =
      (tab === 'users' && canUsers)
      || (tab === 'roles' && canRoles)
      || (tab === 'organizations' && canOrganizations)
      || visibleMainTabs.some((t) => t.id === tab);
    if (!allowed) {
      const next = getFirstSettingsTab(user);
      if (next) setTab(next);
    }
  }, [tab, user, canUsers, canRoles, canOrganizations, visibleMainTabs]);

  const resetForm = () => {
    setName('');
    setCategoryIconKey('');
    setCategoryIconSearch('');
    setCategoryIconsExpanded(false);
    setCategoryModalOpen(false);
    setParentId('');
    setSortOrder('');
    setWorkItemKind('apartment');
    setEditing(null);
    setError('');
  };

  const switchTab = (id) => {
    setTab(id);
    resetForm();
    if (id === 'warehouses') setWarehouseSubTab('warehouses');
    if (id === 'work') setWorkSubTab('objects');
  };

  const switchWarehouseSubTab = (id) => {
    setWarehouseSubTab(id);
    resetForm();
  };

  const switchWorkSubTab = (id) => {
    setWorkSubTab(id);
    resetForm();
  };

  const effectiveWarehouseTab = tab === 'warehouses' ? warehouseSubTab : null;
  const effectiveWorkTab = tab === 'work' ? workSubTab : null;

  const itemsForTab = () => {
    const sortedObjects = sortByNaturalName(catalog.objects);
    const sortedEntrances = [...catalog.work_entrances].sort((a, b) => (
      naturalCompare(a.object_name, b.object_name)
      || naturalCompare(a.name, b.name)
    ));
    const sortedFloors = [...catalog.work_floors].sort((a, b) => (
      naturalCompare(a.object_name, b.object_name)
      || naturalCompare(a.entrance_name, b.entrance_name)
      || ((a.sort_order ?? Number.MAX_SAFE_INTEGER) - (b.sort_order ?? Number.MAX_SAFE_INTEGER))
      || naturalCompare(a.name, b.name)
    ));
    const sortedApartments = [...catalog.work_apartments].sort((a, b) => (
      naturalCompare(a.object_name, b.object_name)
      || naturalCompare(a.entrance_name, b.entrance_name)
      || ((a.floor_sort_order ?? Number.MAX_SAFE_INTEGER) - (b.floor_sort_order ?? Number.MAX_SAFE_INTEGER))
      || naturalCompare(a.floor_name, b.floor_name)
      || naturalCompare(a.name, b.name)
    ));
    const sortedRooms = [...catalog.work_rooms].sort((a, b) => (
      naturalCompare(a.object_name, b.object_name)
      || naturalCompare(a.entrance_name, b.entrance_name)
      || ((a.floor_sort_order ?? Number.MAX_SAFE_INTEGER) - (b.floor_sort_order ?? Number.MAX_SAFE_INTEGER))
      || naturalCompare(a.floor_name, b.floor_name)
      || naturalCompare(a.apartment_name, b.apartment_name)
      || naturalCompare(a.name, b.name)
    ));

    if (effectiveWarehouseTab === 'warehouses') {
      return catalog.warehouses.map((w) => ({
        ...w,
        _extra: w.object_name || catalog.objects.find((o) => o.id === w.object_id)?.name,
      }));
    }
    if (effectiveWarehouseTab === 'storage') {
      return catalog.racks.map((r) => ({
        ...r,
        _extra: r.warehouse_name || catalog.warehouses.find((w) => w.id === r.warehouse_id)?.name,
      }));
    }
    if (tab === 'systems') return catalog.systems.map((s) => ({ ...s }));
    if (tab === 'tools') return catalog.tool_types.map((t) => ({ ...t }));
    if (tab === 'categories') return catalog.categories.map((c) => ({
      ...c,
      _miniature: resolveCategoryMiniature(c),
    }));

    if (effectiveWorkTab === 'objects') {
      return sortedObjects.map((o) => ({ ...o }));
    }
    if (effectiveWorkTab === 'entrances') {
      return sortedEntrances.map((x) => ({
        ...x,
        _extra: x.object_name || catalog.objects.find((o) => o.id === x.object_id)?.name,
      }));
    }
    if (effectiveWorkTab === 'floors') {
      return sortedFloors.map((f) => ({
        ...f,
        _extra: [f.object_name, f.entrance_name].filter(Boolean).join(' → ')
          || catalog.work_entrances.find((e) => e.id === f.entrance_id)?.name,
      }));
    }
    if (effectiveWorkTab === 'apartments') {
      return sortedApartments.map((a) => ({
        ...a,
        _extra: [a.object_name, a.entrance_name, a.floor_name].filter(Boolean).join(' → ')
          || catalog.work_floors.find((f) => f.id === a.floor_id)?.name,
      }));
    }
    return sortedRooms.map((r) => ({
      ...r,
      _extra: [r.object_name, r.entrance_name, r.floor_name, r.apartment_name].filter(Boolean).join(' → '),
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return setError('Укажите название');
    const sortRaw = sortOrder.trim();
    const sortValue = sortRaw ? Number.parseInt(sortRaw, 10) : null;
    if (sortRaw && (!Number.isFinite(sortValue) || sortValue <= 0)) {
      return setError('Порядок должен быть положительным числом');
    }
    setError('');
    try {
      if (effectiveWorkTab === 'objects') {
        if (editing) await settingsApi.objects.update(editing.id, { name: n });
        else await settingsApi.objects.create({ name: n });
      } else if (effectiveWarehouseTab === 'warehouses') {
        const oid = parseInt(parentId, 10);
        if (!oid) return setError('Выберите объект');
        if (editing) await settingsApi.warehouses.update(editing.id, { name: n, object_id: oid });
        else await settingsApi.warehouses.create({ name: n, object_id: oid });
      } else if (effectiveWarehouseTab === 'storage') {
        const wid = parseInt(parentId, 10);
        if (!wid) return setError('Выберите склад');
        if (editing) await settingsApi.racks.update(editing.id, { name: n, warehouse_id: wid });
        else await settingsApi.racks.create({ name: n, warehouse_id: wid });
      } else if (tab === 'categories') {
        const payload = { name: n, icon_key: categoryIconKey || null };
        if (editing) await settingsApi.categories.update(editing.id, payload);
        else await settingsApi.categories.create(payload);
      } else if (tab === 'systems') {
        if (editing) await settingsApi.systems.update(editing.id, { name: n });
        else await settingsApi.systems.create({ name: n });
      } else if (tab === 'tools') {
        if (editing) await settingsApi.toolTypes.update(editing.id, { name: n });
        else await settingsApi.toolTypes.create({ name: n });
      } else if (effectiveWorkTab === 'entrances') {
        const oid = parseInt(parentId, 10);
        if (!oid) return setError('Выберите объект');
        if (editing) await settingsApi.workEntrances.update(editing.id, { name: n, object_id: oid });
        else await settingsApi.workEntrances.create({ name: n, object_id: oid });
      } else if (effectiveWorkTab === 'floors') {
        const eid = parseInt(parentId, 10);
        if (!eid) return setError('Выберите подъезд');
        const payload = { name: n, entrance_id: eid, ...(sortValue ? { sort_order: sortValue } : {}) };
        if (editing) await settingsApi.workFloors.update(editing.id, payload);
        else await settingsApi.workFloors.create(payload);
      } else if (effectiveWorkTab === 'apartments') {
        if (workItemKind === 'room') {
          const floorId = parseInt(modalFloorId, 10);
          if (!floorId) return setError('Выберите этаж');
          let apartmentId = parseInt(modalApartmentId, 10);
          if (!apartmentId) {
            let bucket = catalog.work_apartments.find((a) => a.floor_id === floorId && a.name === FLOOR_ROOMS_BUCKET_NAME);
            if (!bucket) {
              bucket = await settingsApi.workApartments.create({ name: FLOOR_ROOMS_BUCKET_NAME, floor_id: floorId });
            }
            apartmentId = bucket?.id;
          }
          if (!apartmentId) return setError('Не удалось определить квартиру для помещения');
          if (editing) await settingsApi.workRooms.update(editing.id, { name: n, apartment_id: apartmentId });
          else await settingsApi.workRooms.create({ name: n, apartment_id: apartmentId });
        } else {
          const fid = parseInt(modalFloorId, 10);
          if (!fid) return setError('Выберите этаж');
          if (editing) await settingsApi.workApartments.update(editing.id, { name: n, floor_id: fid });
          else await settingsApi.workApartments.create({ name: n, floor_id: fid });
        }
      }
      if (tab === 'categories') closeCategoryModal();
      else if (effectiveWorkTab === 'apartments') closeWorkModal();
      else resetForm();
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const startEdit = (row) => {
    if (tab === 'categories') {
      openEditCategoryModal(row);
      return;
    }
    setEditing(row);
    setName(row.name || '');
    setSortOrder('');
    setCategoryIconKey('');
    if (effectiveWarehouseTab === 'warehouses') setParentId(String(row.object_id || ''));
    else if (effectiveWarehouseTab === 'storage') setParentId(String(row.warehouse_id || ''));
    else if (effectiveWorkTab === 'entrances') setParentId(String(row.object_id || ''));
    else if (effectiveWorkTab === 'floors') {
      setParentId(String(row.entrance_id || ''));
      setSortOrder(row.sort_order != null ? String(row.sort_order) : '');
    }
    else if (effectiveWorkTab === 'apartments') {
      if (row._kind === 'room' || row.apartment_id) {
        setWorkItemKind('room');
        setParentId(String(row.apartment_id || ''));
      } else {
        setWorkItemKind('apartment');
        setParentId(String(row.floor_id || ''));
      }
    }
    else setParentId('');
  };

  const handleDelete = async (row) => {
    if (!confirm(`Удалить «${row.name}»?`)) return;
    setError('');
    try {
      if (effectiveWorkTab === 'objects') await settingsApi.objects.delete(row.id);
      else if (effectiveWarehouseTab === 'warehouses') await settingsApi.warehouses.delete(row.id);
      else if (effectiveWarehouseTab === 'storage') await settingsApi.racks.delete(row.id);
      else if (tab === 'categories') await settingsApi.categories.delete(row.id);
      else if (tab === 'systems') await settingsApi.systems.delete(row.id);
      else if (tab === 'tools') await settingsApi.toolTypes.delete(row.id);
      else if (effectiveWorkTab === 'entrances') await settingsApi.workEntrances.delete(row.id);
      else if (effectiveWorkTab === 'floors') await settingsApi.workFloors.delete(row.id);
      else if (effectiveWorkTab === 'apartments') {
        if (row._kind === 'room' || row.apartment_id) await settingsApi.workRooms.delete(row.id);
        else await settingsApi.workApartments.delete(row.id);
      }
      if (editing?.id === row.id) resetForm();
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleMoveFloor = async (row, direction) => {
    setError('');
    try {
      await settingsApi.workFloors.move(row.id, direction);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const toggleWorkFloorCollapse = (floorId) => {
    setCollapsedWorkFloors((prev) => toggleSelection(prev, floorId));
  };

  const extraLabel = (() => {
    if (effectiveWarehouseTab === 'warehouses') return 'Объект';
    if (effectiveWarehouseTab === 'storage') return 'Склад';
    if (effectiveWorkTab === 'entrances') return 'Объект';
    if (effectiveWorkTab === 'floors') return 'Подъезд';
    if (effectiveWorkTab === 'apartments') return workItemKind === 'room' ? 'Квартира' : 'Этаж';
    return null;
  })();

  const formTitle = (() => {
    if (tab === 'warehouses') {
      const labels = { warehouses: 'склад', storage: 'место хранения' };
      const what = labels[effectiveWarehouseTab] || 'запись';
      return editing ? `Редактирование: ${what}` : `Добавить ${what}`;
    }
    if (tab === 'systems') return editing ? 'Редактирование: система' : 'Добавить систему';
    if (tab === 'tools') return editing ? 'Редактирование: вид инструмента' : 'Добавить вид инструмента';
    if (tab !== 'work') return editing ? 'Редактирование' : 'Добавить';
    const labels = {
      objects: 'объект',
      entrances: 'подъезд',
      floors: 'этаж',
      apartments: workItemKind === 'room' ? 'помещение' : 'квартиру',
    };
    const what = labels[effectiveWorkTab] || 'запись';
    return editing ? `Редактирование: ${what}` : `Добавить ${what}`;
  })();
  const categoryAutoMiniature = resolveCategoryMiniature({ name, icon_key: null });
  const categorySelectedMiniature = resolveCategoryMiniature({ name, icon_key: categoryIconKey || null });
  const categoryIconSearchNormalized = categoryIconSearch.trim().toLowerCase();
  const categoryIconOptionsFiltered = CATEGORY_ICON_OPTIONS.filter((option) => {
    if (!categoryIconSearchNormalized) return true;
    const haystack = `${option.label} ${option.hint} ${CATEGORY_ICON_GROUP_LABELS[option.group] || ''}`.toLowerCase();
    return haystack.includes(categoryIconSearchNormalized);
  });
  const categoryIconOptionsGrouped = Object.entries(CATEGORY_ICON_GROUP_LABELS)
    .map(([groupKey, groupLabel]) => ({
      groupKey,
      groupLabel,
      options: categoryIconOptionsFiltered.filter((option) => option.group === groupKey),
    }))
    .filter((group) => group.options.length > 0);

  const entranceOptionLabel = (e) => {
    const obj = e.object_name || catalog.objects.find((o) => o.id === e.object_id)?.name;
    return obj ? `${obj} → ${e.name}` : e.name;
  };

  const floorOptionLabel = (f) => {
    const floorName = f.name;
    const ent = f.entrance_name || catalog.work_entrances.find((e) => e.id === f.entrance_id)?.name;
    const obj = f.object_name;
    if (obj && ent) return `${obj} → ${ent} → ${floorName}`;
    return ent ? `${ent} → ${floorName}` : floorName;
  };

  const apartmentOptionLabel = (a) => {
    const parts = [a.object_name, a.entrance_name, a.floor_name].filter(Boolean);
    const apartmentName = a._withPrefix ? `Кв. ${a.name}` : a.name;
    if (parts.length >= 1) return `${parts.join(' → ')} → ${apartmentName}`;
    const floor = catalog.work_floors.find((f) => f.id === a.floor_id);
    if (floor) return `${floorOptionLabel(floor)} → ${apartmentName}`;
    return apartmentName;
  };

  const sortedWorkObjects = sortByNaturalName(catalog.objects);
  const sortedWorkEntrances = [...catalog.work_entrances].sort((a, b) => (
    naturalCompare(a.object_name, b.object_name) || naturalCompare(a.name, b.name)
  ));
  const sortedWorkFloors = [...catalog.work_floors].sort((a, b) => (
    naturalCompare(a.object_name, b.object_name)
    || naturalCompare(a.entrance_name, b.entrance_name)
    || ((a.sort_order ?? Number.MAX_SAFE_INTEGER) - (b.sort_order ?? Number.MAX_SAFE_INTEGER))
    || naturalCompare(a.name, b.name)
  ));
  const sortedWorkApartments = [...catalog.work_apartments].sort((a, b) => (
    naturalCompare(a.object_name, b.object_name)
    || naturalCompare(a.entrance_name, b.entrance_name)
    || ((a.floor_sort_order ?? Number.MAX_SAFE_INTEGER) - (b.floor_sort_order ?? Number.MAX_SAFE_INTEGER))
    || naturalCompare(a.floor_name, b.floor_name)
    || naturalCompare(a.name, b.name)
  ));
  const sortedWorkRooms = [...catalog.work_rooms].sort((a, b) => (
    naturalCompare(a.object_name, b.object_name)
    || naturalCompare(a.entrance_name, b.entrance_name)
    || ((a.floor_sort_order ?? Number.MAX_SAFE_INTEGER) - (b.floor_sort_order ?? Number.MAX_SAFE_INTEGER))
    || naturalCompare(a.floor_name, b.floor_name)
    || naturalCompare(a.apartment_name, b.apartment_name)
    || naturalCompare(a.name, b.name)
  ));
  const floorsByEntrance = sortedWorkEntrances.map((entrance) => ({
    entrance,
    floors: sortedWorkFloors.filter((f) => f.entrance_id === entrance.id),
  }));
  const floorById = Object.fromEntries(sortedWorkFloors.map((f) => [f.id, f]));
  const apartmentFloorMap = Object.fromEntries(sortedWorkApartments.map((a) => [a.id, a.floor_id]));
  const apartmentsByFloorId = sortedWorkApartments.reduce((acc, apartment) => {
    const floorId = apartment.floor_id;
    if (!acc[floorId]) acc[floorId] = [];
    acc[floorId].push(apartment);
    return acc;
  }, {});
  const roomsByApartmentId = sortedWorkRooms.reduce((acc, room) => {
    const apartmentId = room.apartment_id;
    if (!acc[apartmentId]) acc[apartmentId] = [];
    acc[apartmentId].push(room);
    return acc;
  }, {});
  const modalRoomApartmentOptions = modalFloorId
    ? sortedWorkApartments.filter((a) => a.floor_id === parseInt(modalFloorId, 10) && a.name !== FLOOR_ROOMS_BUCKET_NAME)
    : [];
  const collapsedWorkFloorSet = new Set(
    collapsedWorkFloors
      .map((v) => Number.parseInt(v, 10))
      .filter((v) => Number.isInteger(v) && v > 0),
  );

  useEffect(() => {
    if (!workModalOpen || workItemKind !== 'room') return;
    const selectedApartmentId = parseInt(modalApartmentId, 10);
    const selectedFloorId = parseInt(modalFloorId, 10);
    if (!selectedApartmentId || !selectedFloorId) return;
    if (apartmentFloorMap[selectedApartmentId] !== selectedFloorId) {
      setModalApartmentId('');
    }
  }, [workModalOpen, workItemKind, modalApartmentId, modalFloorId, apartmentFloorMap]);

  const focusForm = () => {
    if (typeof window === 'undefined') return;
    window.requestAnimationFrame(() => {
      formCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      nameInputRef.current?.focus();
    });
  };

  const openCreateCategoryModal = () => {
    setEditing(null);
    setName('');
    setCategoryIconKey('');
    setCategoryIconSearch('');
    setCategoryIconsExpanded(true);
    setCategoryModalOpen(true);
    setError('');
  };

  const openEditCategoryModal = (row) => {
    setEditing(row);
    setName(row.name || '');
    setCategoryIconKey(row.icon_key || '');
    setCategoryIconSearch('');
    setCategoryIconsExpanded(true);
    setCategoryModalOpen(true);
    setError('');
  };

  const closeCategoryModal = () => {
    setCategoryModalOpen(false);
    setCategoryIconsExpanded(false);
    setCategoryIconSearch('');
    setEditing(null);
    setName('');
    setCategoryIconKey('');
    setError('');
  };

  const closeWorkModal = () => {
    setWorkModalOpen(false);
    setWorkItemKind('apartment');
    setEditing(null);
    setName('');
    setModalFloorId('');
    setModalApartmentId('');
    setError('');
  };

  const startAddFloorForEntrance = (entranceId, floorsCount = 0, forceFloorsTab = false) => {
    const needOpenFloorsTab = forceFloorsTab || effectiveWorkTab !== 'floors';
    if (needOpenFloorsTab) setWorkSubTab('floors');
    setEditing(null);
    setName('');
    setSortOrder(String((floorsCount || 0) + 1));
    setParentId(String(entranceId || ''));
    setError('');
    if (needOpenFloorsTab && typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => focusForm());
      });
      return;
    }
    focusForm();
  };

  const startAddApartmentForFloor = (floorId) => {
    setWorkModalOpen(true);
    setWorkItemKind('apartment');
    setEditing(null);
    setName('');
    setSortOrder('');
    setModalFloorId(String(floorId || ''));
    setModalApartmentId('');
    setError('');
  };

  const startAddRoomForFloor = (floorId) => {
    setWorkModalOpen(true);
    setWorkItemKind('room');
    setEditing(null);
    setName('');
    setSortOrder('');
    setModalFloorId(String(floorId || ''));
    setModalApartmentId('');
    setError('');
  };

  const startAddRoomForApartment = (apartmentId, floorIdFromRow = null) => {
    const floorId = floorIdFromRow || apartmentFloorMap[apartmentId] || '';
    setWorkModalOpen(true);
    setWorkItemKind('room');
    setEditing(null);
    setName('');
    setSortOrder('');
    setModalFloorId(String(floorId || ''));
    setModalApartmentId(String(apartmentId || ''));
    setError('');
  };

  const startEditApartmentOrRoom = (row, kind) => {
    setWorkModalOpen(true);
    setEditing({ ...row, _kind: kind });
    setWorkItemKind(kind);
    setName(row.name || '');
    setSortOrder('');
    if (kind === 'room') {
      const apartmentId = row.apartment_id || '';
      const floorId = row.floor_id || apartmentFloorMap[apartmentId] || '';
      setModalFloorId(String(floorId || ''));
      setModalApartmentId(String(apartmentId || ''));
    } else {
      setModalFloorId(String(row.floor_id || ''));
      setModalApartmentId('');
    }
    setError('');
  };

  const settingsTabs = (
    <div className="flex flex-wrap gap-2">
      {canUsers && (
        <button
          type="button"
          onClick={() => setTab('users')}
          className={tabButtonClass(tab === 'users')}
        >
          Пользователи
        </button>
      )}
      {canRoles && (
        <button
          type="button"
          onClick={() => setTab('roles')}
          className={tabButtonClass(tab === 'roles')}
        >
          Роли
        </button>
      )}
      {visibleMainTabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => switchTab(t.id)}
          className={tabButtonClass(tab === t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  if (tab === 'users' && canUsers) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="page-title">Настройка</h2>
        </div>
        {settingsTabs}
        <Users user={user} embedded />
      </div>
    );
  }

  if (tab === 'roles' && canRoles) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="page-title">Настройка</h2>
        </div>
        {settingsTabs}
        <RolesTab />
      </div>
    );
  }

  if (tab === 'organizations' && canOrganizations) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="page-title">Настройка</h2>
        </div>
        {settingsTabs}
        <OrganizationsTab />
      </div>
    );
  }

  if (!hasAnySettingsAccess(user) || !visibleMainTabs.some((t) => t.id === tab)) {
    return (
      <div className="space-y-6">
        <h2 className="page-title">Настройка</h2>
        {settingsTabs}
        {!hasAnySettingsAccess(user) && (
          <p className="text-zinc-500 text-sm">Нет доступа к разделам настройки.</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="page-title">Настройка</h2>
        <p className="text-zinc-400 text-sm mt-1">
          Справочники склада и мест проведения работ: склады и места хранения, категории и системы; объекты, подъезды, этажи, квартиры и помещения — во вкладке «Место проведения работ».
        </p>
      </div>

      {settingsTabs}

      {tab === 'warehouses' && (
        <div className="rounded-xl border border-sky-500/25 bg-sky-950/20 p-4 space-y-3">
          <p className="text-sky-100/90 text-sm font-medium">Склады</p>
          <div className="flex flex-wrap gap-2">
            {WAREHOUSE_SUB_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => switchWarehouseSubTab(t.id)}
                className={tabButtonClass(warehouseSubTab === t.id, 'warehouse')}
              >
                {t.label}
              </button>
            ))}
          </div>
          <p className="text-zinc-400 text-xs">
            Сначала склады (привязка к объекту), затем места хранения внутри склада.
          </p>
        </div>
      )}

      {tab === 'work' && (
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-950/20 p-4 space-y-3">
          <p className="text-emerald-100/90 text-sm font-medium">Место проведения работ</p>
          <div className="flex flex-wrap gap-2">
            {WORK_SUB_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => switchWorkSubTab(t.id)}
                className={tabButtonClass(workSubTab === t.id, 'work')}
              >
                {t.label}
              </button>
            ))}
          </div>
          <p className="text-zinc-400 text-xs">
            Сначала объекты, затем подъезды, этажи, квартиры и помещения — каждый уровень привязан к родительскому.
          </p>
        </div>
      )}

      {error && <p className="text-rose-400 text-sm">{error}</p>}

      {effectiveWorkTab === 'floors' ? (
        floorsByEntrance.length ? (
          <div className="space-y-4">
            {floorsByEntrance.map(({ entrance, floors }) => (
              <div
                key={entrance.id}
                className="rounded-xl border border-emerald-500/25 bg-emerald-950/20 p-4 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-white font-medium">{entranceOptionLabel(entrance)}</p>
                    <p className="text-zinc-400 text-xs">
                      {floors.length ? `Этажей: ${floors.length}` : 'Этажи пока не добавлены'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => startAddFloorForEntrance(entrance.id, floors.length)}
                    className="btn-secondary text-xs"
                  >
                    Добавить этаж
                  </button>
                </div>
                {floors.length ? (
                  <div className="table-wrap">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-white/10 text-zinc-300">
                          <th className="p-3 font-medium">Этаж</th>
                          <th className="p-3 w-40" />
                        </tr>
                      </thead>
                      <tbody>
                        {floors.map((row) => (
                          <tr key={row.id} className="border-b border-white/5">
                            <td className="p-3 text-white">{row.name}</td>
                            <td className="p-3">
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleMoveFloor(row, 'up')}
                                  className="px-2 py-1 rounded border border-white/20 text-zinc-200 hover:bg-white/10"
                                  title="Поднять этаж"
                                >
                                  ↑
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleMoveFloor(row, 'down')}
                                  className="px-2 py-1 rounded border border-white/20 text-zinc-200 hover:bg-white/10"
                                  title="Опустить этаж"
                                >
                                  ↓
                                </button>
                                <button
                                  type="button"
                                  onClick={() => startEdit(row)}
                                  className="text-sky-400 hover:text-sky-300 text-sm font-medium"
                                >
                                  Изм.
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDelete(row)}
                                  className="text-rose-400 hover:text-rose-300 text-sm font-medium"
                                >
                                  Удал.
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-zinc-500 text-sm py-2">Для этого подъезда этажи пока не добавлены.</p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-zinc-500 text-sm py-4">Сначала добавьте подъезды во вкладке «Подъезды».</p>
        )
      ) : effectiveWorkTab === 'apartments' ? (
        floorsByEntrance.length ? (
          <div className="space-y-4">
            {floorsByEntrance.map(({ entrance, floors }) => (
              <div
                key={entrance.id}
                className="rounded-xl border border-emerald-500/25 bg-emerald-950/20 p-4 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-white font-medium">{entranceOptionLabel(entrance)}</p>
                    <p className="text-zinc-400 text-xs">
                      {floors.length ? `Этажей: ${floors.length}` : 'Этажи пока не добавлены'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => startAddFloorForEntrance(entrance.id, floors.length, true)}
                    className="btn-secondary text-xs"
                  >
                    Добавить этаж
                  </button>
                </div>
                {floors.length ? (
                  <div className="space-y-3">
                    {floors.map((floor) => {
                      const floorApartmentsRaw = apartmentsByFloorId[floor.id] || [];
                      const floorRoomsBucket = floorApartmentsRaw.find((a) => a.name === FLOOR_ROOMS_BUCKET_NAME);
                      const floorRooms = floorRoomsBucket ? (roomsByApartmentId[floorRoomsBucket.id] || []) : [];
                      const floorApartments = floorApartmentsRaw.filter((a) => a.name !== FLOOR_ROOMS_BUCKET_NAME);
                      const isCollapsed = collapsedWorkFloorSet.has(floor.id);
                      return (
                        <div
                          key={floor.id}
                          className="rounded-lg border border-white/10 bg-black/20 p-2.5 space-y-1.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => toggleWorkFloorCollapse(floor.id)}
                              className="text-zinc-100 text-xs font-semibold hover:text-white text-left"
                              title={isCollapsed ? 'Развернуть этаж' : 'Свернуть этаж'}
                            >
                              Этаж {floor.name}
                            </button>
                            <div className="flex items-center gap-2">
                              <span className="text-2xs text-zinc-500">
                                {floorApartments.length} / {floorRooms.length}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleMoveFloor(floor, 'up')}
                                className="px-2 py-0.5 rounded border border-white/20 text-zinc-200 hover:bg-white/10 text-xs"
                                title="Поднять этаж"
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                onClick={() => handleMoveFloor(floor, 'down')}
                                className="px-2 py-0.5 rounded border border-white/20 text-zinc-200 hover:bg-white/10 text-xs"
                                title="Опустить этаж"
                              >
                                ↓
                              </button>
                              <button
                                type="button"
                                onClick={() => startAddApartmentForFloor(floor.id)}
                                className="btn-secondary text-xs"
                              >
                                Добавить квартиру
                              </button>
                              <button
                                type="button"
                                onClick={() => startAddRoomForFloor(floor.id)}
                                className="btn-secondary text-xs"
                              >
                                Добавить помещение
                              </button>
                            </div>
                          </div>
                          {!isCollapsed && (
                            (floorApartments.length || floorRooms.length) ? (
                              <div className="space-y-2">
                                {floorRooms.length ? (
                                  <div className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5">
                                    <p className="text-zinc-200 text-2xs font-medium">{FLOOR_ROOMS_DISPLAY_TITLE}</p>
                                    <div className="mt-1 space-y-1.5">
                                      {floorRooms.map((room) => (
                                        <div
                                          key={room.id}
                                          className="rounded border border-white/10 bg-black/20 px-2 py-1.5 flex flex-wrap items-center justify-between gap-2"
                                        >
                                          <p className="text-zinc-200 text-2xs font-medium">Пом. {room.name}</p>
                                          <div className="flex items-center gap-2">
                                            <button
                                              type="button"
                                              onClick={() => startEditApartmentOrRoom({ ...room, floor_id: floor.id, apartment_id: floorRoomsBucket?.id }, 'room')}
                                              className="text-sky-400 hover:text-sky-300 text-2xs font-medium"
                                            >
                                              Изм.
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => handleDelete({ ...room, _kind: 'room' })}
                                              className="text-rose-400 hover:text-rose-300 text-2xs font-medium"
                                            >
                                              Удал.
                                            </button>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ) : null}

                                {floorApartments.length ? (
                                  <div className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5 space-y-1.5">
                                    <p className="text-zinc-200 text-2xs font-medium">Квартиры на этаже</p>
                                    {floorApartments.map((apartment) => {
                                      const apartmentRooms = roomsByApartmentId[apartment.id] || [];
                                      return (
                                        <div key={apartment.id} className="rounded border border-white/10 bg-black/20 px-2 py-1.5">
                                          <div className="flex flex-wrap items-center justify-between gap-2">
                                            <p className="text-zinc-200 text-2xs font-medium">Кв. {apartment.name}</p>
                                            <div className="flex items-center gap-2">
                                              <button
                                                type="button"
                                                onClick={() => startAddRoomForApartment(apartment.id, floor.id)}
                                                className="text-emerald-400 hover:text-emerald-300 text-2xs font-medium"
                                              >
                                                + Пом.
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => startEditApartmentOrRoom(apartment, 'apartment')}
                                                className="text-sky-400 hover:text-sky-300 text-2xs font-medium"
                                              >
                                                Изм.
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => handleDelete({ ...apartment, _kind: 'apartment' })}
                                                className="text-rose-400 hover:text-rose-300 text-2xs font-medium"
                                              >
                                                Удал.
                                              </button>
                                            </div>
                                          </div>
                                          {apartmentRooms.length ? (
                                            <div className="mt-1 space-y-1">
                                              {apartmentRooms.map((room) => (
                                                <div
                                                  key={room.id}
                                                  className="px-1.5 py-1 rounded bg-zinc-800/80 text-zinc-300 text-[10px] leading-none flex items-center justify-between gap-2"
                                                >
                                                  <span>Пом. {room.name}</span>
                                                  <div className="flex items-center gap-2">
                                                    <button
                                                      type="button"
                                                      onClick={() => startEditApartmentOrRoom({ ...room, floor_id: floor.id }, 'room')}
                                                      className="text-sky-400 hover:text-sky-300 text-[10px] font-medium"
                                                    >
                                                      Изм.
                                                    </button>
                                                    <button
                                                      type="button"
                                                      onClick={() => handleDelete({ ...room, _kind: 'room' })}
                                                      className="text-rose-400 hover:text-rose-300 text-[10px] font-medium"
                                                    >
                                                      Удал.
                                                    </button>
                                                  </div>
                                                </div>
                                              ))}
                                            </div>
                                          ) : null}
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : null}
                              </div>
                            ) : (
                              <p className="text-zinc-500 text-2xs">Квартиры и помещения еще не добавлены</p>
                            )
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-zinc-500 text-sm">В этом подъезде пока нет этажей.</p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-zinc-500 text-sm py-4">Сначала добавьте подъезды и этажи.</p>
        )
      ) : (
        <div className="space-y-3">
          {tab === 'categories' && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={openCreateCategoryModal}
                className="btn-primary text-sm"
              >
                Добавить категорию
              </button>
            </div>
          )}
          <SimpleList
            items={itemsForTab()}
            onEdit={startEdit}
            onDelete={handleDelete}
            extraCol={extraLabel}
            renderTitleLeading={tab === 'categories'
              ? (row) => (
                <span
                  className={`inline-flex h-7 w-7 items-center justify-center rounded-lg ring-1 ${row._miniature?.badgeClass || 'bg-zinc-700 text-zinc-200 ring-zinc-500/40'}`}
                  title={row._miniature?.label || 'Категория'}
                  aria-label={row._miniature?.label || 'Категория'}
                >
                  <CategoryGlyph iconKey={row._miniature?.key} />
                </span>
              )
              : null}
          />
        </div>
      )}

      {effectiveWorkTab !== 'apartments' && tab !== 'categories' && (
        <div ref={formCardRef} className="rounded-xl border border-white/10 bg-surface-850 p-5 max-w-lg">
          <h3 className="text-white font-medium mb-4">{formTitle}</h3>
          <form onSubmit={handleSubmit} className="space-y-4">
          {effectiveWarehouseTab === 'warehouses' && (
            <div>
              <label className="label">Объект</label>
              <select value={parentId} onChange={(e) => setParentId(e.target.value)} className="input" required>
                <option value="">— Выберите —</option>
                {catalog.objects.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>
          )}
          {effectiveWarehouseTab === 'storage' && (
            <div>
              <label className="label">Склад</label>
              <select value={parentId} onChange={(e) => setParentId(e.target.value)} className="input" required>
                <option value="">— Выберите —</option>
                {catalog.warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.object_name ? `${w.object_name} → ` : ''}{w.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {effectiveWorkTab === 'entrances' && (
            <div>
              <label className="label">Объект</label>
              <select value={parentId} onChange={(e) => setParentId(e.target.value)} className="input" required>
                <option value="">— Выберите —</option>
                {sortedWorkObjects.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>
          )}
          {effectiveWorkTab === 'floors' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Подъезд</label>
                <select value={parentId} onChange={(e) => setParentId(e.target.value)} className="input" required>
                  <option value="">— Выберите —</option>
                  {sortedWorkEntrances.map((e) => (
                    <option key={e.id} value={e.id}>{entranceOptionLabel(e)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Порядок</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value)}
                  className="input"
                  placeholder="По умолчанию в конец"
                />
              </div>
            </div>
          )}
          <div>
            <label className="label">Название</label>
            <input
              ref={nameInputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input"
              required
            />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary text-sm">
              {editing ? 'Сохранить' : 'Добавить'}
            </button>
            {editing && (
              <button type="button" onClick={resetForm} className="btn-secondary text-sm">
                Отмена
              </button>
            )}
          </div>
          </form>
        </div>
      )}

      {tab === 'categories' && categoryModalOpen && (
        <div
          className="modal-backdrop z-50"
          onClick={closeCategoryModal}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="card p-5 max-w-4xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-white font-medium text-lg mb-4">
              {editing ? 'Редактирование категории' : 'Добавить категорию'}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="label">Название</label>
                <input
                  autoFocus
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="input"
                  required
                />
              </div>

              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm">
                    <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ring-1 ${categorySelectedMiniature.badgeClass}`}>
                      <CategoryGlyph iconKey={categorySelectedMiniature.key} />
                    </span>
                    <span className="text-zinc-200">Выбрано: {categorySelectedMiniature.label}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCategoryIconsExpanded((prev) => !prev)}
                    className="btn-secondary text-sm"
                  >
                    {categoryIconsExpanded ? 'Свернуть значки' : 'Раскрыть значки'}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setCategoryIconKey('')}
                  className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                    !categoryIconKey
                      ? 'border-sky-400/70 bg-sky-500/10 ring-1 ring-sky-400/30'
                      : 'border-white/10 bg-zinc-900/50 hover:bg-zinc-800/70'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span className={`inline-flex h-7 w-7 items-center justify-center rounded-lg ring-1 ${categoryAutoMiniature.badgeClass}`}>
                      <CategoryGlyph iconKey={categoryAutoMiniature.key} />
                    </span>
                    <span>
                      <span className="block text-sm text-white">Автоопределение</span>
                      <span className="block text-xs text-zinc-400">Значок определяется по названию категории</span>
                    </span>
                  </div>
                </button>

                {categoryIconsExpanded && (
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3 space-y-3">
                    <input
                      type="text"
                      value={categoryIconSearch}
                      onChange={(e) => setCategoryIconSearch(e.target.value)}
                      className="input"
                      placeholder="Поиск значка: пожарная, камеры, щит, СКУД…"
                    />
                    {categoryIconOptionsGrouped.length ? (
                      <div className="space-y-4">
                        {categoryIconOptionsGrouped.map((group) => (
                          <div key={group.groupKey} className="space-y-2">
                            <p className="text-xs uppercase tracking-wide text-zinc-400">{group.groupLabel}</p>
                            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                              {group.options.map((option) => {
                                const meta = CATEGORY_ICON_META[option.key] || CATEGORY_ICON_META.other;
                                const selected = categoryIconKey === option.key;
                                return (
                                  <button
                                    key={option.key}
                                    type="button"
                                    onClick={() => setCategoryIconKey(option.key)}
                                    className={`rounded-lg border px-3 py-2 text-left transition ${
                                      selected
                                        ? 'border-sky-400/70 bg-sky-500/10 ring-1 ring-sky-400/30'
                                        : 'border-white/10 bg-zinc-900/50 hover:bg-zinc-800/70'
                                    }`}
                                  >
                                    <div className="flex items-start gap-2">
                                      <span className={`inline-flex h-7 w-7 items-center justify-center rounded-lg ring-1 ${meta.badgeClass}`}>
                                        <CategoryGlyph iconKey={option.key} />
                                      </span>
                                      <span>
                                        <span className="block text-sm text-white">{option.label}</span>
                                        <span className="block text-xs text-zinc-400">{option.hint}</span>
                                      </span>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-zinc-500 text-sm py-1">По запросу значки не найдены.</p>
                    )}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={closeCategoryModal} className="btn-ghost text-sm">
                  Отмена
                </button>
                <button type="submit" className="btn-primary text-sm">
                  {editing ? 'Сохранить' : 'Добавить'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {effectiveWorkTab === 'apartments' && workModalOpen && (
        <div
          className="modal-backdrop z-50"
          onClick={closeWorkModal}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="card p-5 max-w-lg w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-white font-medium text-lg mb-4">
              {editing ? `Редактирование: ${workItemKind === 'room' ? 'помещение' : 'квартира'}` : `Добавить ${workItemKind === 'room' ? 'помещение' : 'квартиру'}`}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="label">Этаж</label>
                <select
                  value={modalFloorId}
                  onChange={(e) => {
                    setModalFloorId(e.target.value);
                    if (workItemKind === 'room') setModalApartmentId('');
                  }}
                  className="input"
                  required
                >
                  <option value="">— Выберите —</option>
                  {sortedWorkEntrances.map((entrance) => {
                    const entranceFloors = sortedWorkFloors.filter((f) => f.entrance_id === entrance.id);
                    if (!entranceFloors.length) return null;
                    return (
                      <optgroup key={entrance.id} label={entranceOptionLabel(entrance)}>
                        {entranceFloors.map((f) => (
                          <option key={f.id} value={f.id}>{f.name}</option>
                        ))}
                      </optgroup>
                    );
                  })}
                </select>
              </div>

              {workItemKind === 'room' && (
                <div>
                  <label className="label">Квартира (необязательно)</label>
                  <select
                    value={modalApartmentId}
                    onChange={(e) => setModalApartmentId(e.target.value)}
                    className="input"
                  >
                    <option value="">— Добавить на этаж (без квартиры) —</option>
                    {modalRoomApartmentOptions.map((a) => (
                      <option key={a.id} value={a.id}>
                        {apartmentOptionLabel({ ...a, _withPrefix: true })}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="label">Название</label>
                <div className="flex">
                  <span className="inline-flex items-center px-3 rounded-l-lg border border-r-0 border-zinc-600 bg-zinc-800 text-zinc-300 text-sm">
                    {workItemKind === 'room' ? 'Пом.' : 'Кв.'}
                  </span>
                  <input
                    autoFocus
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="input rounded-l-none"
                    required
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={closeWorkModal} className="btn-ghost text-sm">
                  Отмена
                </button>
                <button type="submit" className="btn-primary text-sm">
                  {editing ? 'Сохранить' : 'Добавить'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
