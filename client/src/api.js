import {
  enqueueOfflineMutation,
  recordActionAfterSuccess,
  shouldQueueOfflineMutation,
  shouldRecordAction,
  isNetworkFailure,
  OFFLINE_QUEUED,
} from './lib/actionLog/index.js';
import { mutationNeedsOfflineQueue } from './lib/actionLog/tempIds.js';
import {
  isQuickDeviceEnabled,
  getCachedResponse,
  setCachedResponse,
  getCachedUser,
  setCachedUser,
  shouldCacheGetPath,
  setOfflineSession,
} from './lib/offlineCache/index.js';

export { OFFLINE_QUEUED };
export function isOfflineQueuedError(err) {
  return err?.code === OFFLINE_QUEUED;
}

const base = '';
const REQUEST_TIMEOUT = 25000;

async function fetchWithTimeout(url, options = {}, timeout = REQUEST_TIMEOUT) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    clearTimeout(t);
    return res;
  } catch (e) {
    clearTimeout(t);
    if (e.name === 'AbortError') throw new Error('Таймаут запроса');
    throw e;
  }
}

async function readFromOfflineCache(path) {
  const cached = await getCachedResponse(path);
  if (cached != null) return cached;
  return null;
}

async function request(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const bodyText = typeof options.body === 'string' ? options.body : null;
  const queueable = shouldQueueOfflineMutation(path, method);
  const cacheableGet = method === 'GET' && shouldCacheGetPath(path);
  const quickDevice = isQuickDeviceEnabled();

  const deferForPendingRefs = queueable && mutationNeedsOfflineQueue(path, method, bodyText);

  if (queueable && (!navigator.onLine || deferForPendingRefs)) {
    await enqueueOfflineMutation(path, method, bodyText);
  }

  if (cacheableGet && quickDevice && !navigator.onLine) {
    const cached = await readFromOfflineCache(path);
    if (cached != null) return cached;
    throw new Error('Нет сети. Данные не найдены в кэше устройства.');
  }

  try {
    const res = await fetchWithTimeout(base + path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
      credentials: 'include',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText || 'Ошибка');
    if (cacheableGet && quickDevice) {
      setCachedResponse(path, data).catch(() => {});
    }
    if (shouldRecordAction(path, method)) {
      recordActionAfterSuccess(path, method, bodyText).catch(() => {});
    }
    return data;
  } catch (e) {
    if (cacheableGet && quickDevice) {
      const cached = await readFromOfflineCache(path);
      if (cached != null) return cached;
    }
    if (queueable && (isNetworkFailure(e) || !navigator.onLine || deferForPendingRefs)) {
      await enqueueOfflineMutation(path, method, bodyText);
    }
    throw e;
  }
}

async function downloadBlob(path, filename, options = {}) {
  const res = await fetchWithTimeout(base + path, { credentials: 'include', ...options });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || res.statusText || 'Ошибка загрузки');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function exportDownloadFile(url, body, filename) {
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || res.statusText || 'Ошибка выгрузки');
  }
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(blobUrl);
}

async function exportMaterialsFile(format, rows) {
  const ext = format === 'pdf' ? 'pdf' : 'xlsx';
  const ids = rows.map((r) => r.id).filter(Boolean);
  await exportDownloadFile('/api/materials/export', { format, ids }, `materials.${ext}`);
}

export const auth = {
  login: (login, password) => request('/api/auth/login', { method: 'POST', body: JSON.stringify({ login, password }) }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  me: async () => {
    if (isQuickDeviceEnabled() && !navigator.onLine) {
      const user = await getCachedUser();
      if (user) return { user };
      throw new Error('Нет сети. Войдите онлайн или используйте сохранённую сессию.');
    }
    try {
      const data = await request('/api/auth/me');
      if (data?.user && isQuickDeviceEnabled()) {
        await setCachedUser(data.user);
        await setOfflineSession(data.user);
      }
      return data;
    } catch (e) {
      if (isQuickDeviceEnabled()) {
        const user = await getCachedUser();
        if (user) return { user };
      }
      throw e;
    }
  },
};

export const roles = {
  list: () => request('/api/roles'),
  permissions: () => request('/api/roles/permissions'),
  create: (body) => request('/api/roles', { method: 'POST', body: JSON.stringify(body) }),
  update: (id, body) => request(`/api/roles/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  delete: (id) => request(`/api/roles/${id}`, { method: 'DELETE' }),
};

export const users = {
  list: () => request('/api/users'),
  create: (body) => request('/api/users', { method: 'POST', body: JSON.stringify(body) }),
  update: (id, body) => request(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  delete: (id) => request(`/api/users/${id}`, { method: 'DELETE' }),
  uploadAvatar: async (id, file) => {
    const form = new FormData();
    form.append('avatar', file);
    const res = await fetchWithTimeout(`/api/users/${id}/avatar`, { method: 'POST', body: form, credentials: 'include' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText || 'Ошибка загрузки');
    return data;
  },
  avatarUrl: (id) => `/api/users/${id}/avatar`,
  uploadFacePhoto: async (id, file) => {
    const form = new FormData();
    form.append('face', file);
    const res = await fetchWithTimeout(`/api/users/${id}/face-photo`, { method: 'POST', body: form, credentials: 'include' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText || 'Ошибка загрузки фото лица');
    return data;
  },
  facePhotoUrl: (id) => `/api/users/${id}/face-photo`,
  clearFaceTemplate: (id) => request(`/api/users/${id}/face-template`, { method: 'DELETE' }),
  listLaborContracts: (userId) => request(`/api/users/${userId}/labor-contracts`),
  laborContractFileUrl: (userId, fileId, inline = false) => {
    const q = inline ? '?inline=1' : '';
    return `/api/users/${userId}/labor-contracts/${fileId}${q}`;
  },
  uploadLaborContracts: async (userId, files) => {
    const form = new FormData();
    for (const file of files) form.append('contract', file);
    const res = await fetchWithTimeout(`/api/users/${userId}/labor-contracts`, {
      method: 'POST',
      body: form,
      credentials: 'include',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText || 'Ошибка загрузки договора');
    return data;
  },
  fetchLaborContractBlob: async (userId, fileId, inline = true) => {
    const res = await fetchWithTimeout(
      `/api/users/${userId}/labor-contracts/${fileId}${inline ? '?inline=1' : ''}`,
      { credentials: 'include' },
    );
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || res.statusText || 'Ошибка загрузки файла');
    }
    return res.blob();
  },
  downloadLaborContractFile: (userId, fileId, filename) =>
    downloadBlob(`/api/users/${userId}/labor-contracts/${fileId}`, filename || 'dogovor'),
  deleteLaborContractFile: (userId, fileId) =>
    request(`/api/users/${userId}/labor-contracts/${fileId}`, { method: 'DELETE' }),
  downloadImportTemplate: () => downloadBlob('/api/users/import-template', 'shablon-polzovateli.xlsx'),
  exportExcel: (ids) => {
    const date = new Date().toISOString().slice(0, 10);
    if (Array.isArray(ids) && ids.length) {
      return exportDownloadFile(
        '/api/users/export',
        { ids },
        `polzovateli-${date}.xlsx`,
      );
    }
    return downloadBlob('/api/users/export', `polzovateli-${date}.xlsx`);
  },
  previewImportExcel: async (file) => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetchWithTimeout(`${base}/api/users/import/preview`, {
      method: 'POST',
      body: form,
      credentials: 'include',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText || 'Ошибка чтения файла');
    return data;
  },
  importExcel: async (file) => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetchWithTimeout(`${base}/api/users/import`, {
      method: 'POST',
      body: form,
      credentials: 'include',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText || 'Ошибка импорта');
    return data;
  },
};

export const materials = {
  list: () => request('/api/materials'),
  byCode: (code) => request(`/api/materials/by-code/${encodeURIComponent(code)}`),
  create: (body) => request('/api/materials', { method: 'POST', body: JSON.stringify(body) }),
  getParts: (id) => request(`/api/materials/${id}/parts`),
  addPart: (id, body) => request(`/api/materials/${id}/parts`, { method: 'POST', body: JSON.stringify(body) }),
  split: (id, body) => request(`/api/materials/${id}/split`, { method: 'POST', body: JSON.stringify(body) }),
  update: (id, body) => request(`/api/materials/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  delete: (id) => request(`/api/materials/${id}`, { method: 'DELETE' }),
  deleteAll: () => request('/api/materials/all', { method: 'DELETE' }),
  addQuantity: (id, amount) => request(`/api/materials/${id}/add`, { method: 'POST', body: JSON.stringify({ amount }) }),
  quantityHistory: (id) => request(`/api/materials/${id}/quantity-history`),
  usersForIssuance: () => request('/api/materials/users-for-issuance'),
  downloadImportTemplate: () => downloadBlob('/api/materials/import-template', 'shablon-materialy.xlsx'),
  previewImportExcel: async (file) => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetchWithTimeout(`${base}/api/materials/import/preview`, {
      method: 'POST',
      body: form,
      credentials: 'include',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText || 'Ошибка чтения файла');
    return data;
  },
  importExcel: async (file) => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetchWithTimeout(`${base}/api/materials/import`, {
      method: 'POST',
      body: form,
      credentials: 'include',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText || 'Ошибка импорта');
    return data;
  },
  exportExcel: (rows) => exportMaterialsFile('xlsx', rows),
  exportPdf: (rows) => exportMaterialsFile('pdf', rows),
  downloadQrPdf: (payload) => {
    const safeName = String(payload.code).replace(/[^\w.-]+/g, '_').slice(0, 80) || 'material';
    return exportDownloadFile('/api/materials/qr-pdf', payload, `qr-${safeName}.pdf`);
  },
};

export const settings = {
  catalog: () => request('/api/settings/catalog'),
  objects: {
    list: () => request('/api/settings/objects'),
    create: (body) => request('/api/settings/objects', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => request(`/api/settings/objects/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    delete: (id) => request(`/api/settings/objects/${id}`, { method: 'DELETE' }),
  },
  warehouses: {
    list: (objectId) => request(`/api/settings/warehouses${objectId ? `?object_id=${objectId}` : ''}`),
    create: (body) => request('/api/settings/warehouses', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => request(`/api/settings/warehouses/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    delete: (id) => request(`/api/settings/warehouses/${id}`, { method: 'DELETE' }),
  },
  racks: {
    list: (warehouseId) => request(`/api/settings/racks${warehouseId ? `?warehouse_id=${warehouseId}` : ''}`),
    create: (body) => request('/api/settings/racks', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => request(`/api/settings/racks/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    delete: (id) => request(`/api/settings/racks/${id}`, { method: 'DELETE' }),
  },
  categories: {
    list: () => request('/api/settings/categories'),
    create: (body) => request('/api/settings/categories', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => request(`/api/settings/categories/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    delete: (id) => request(`/api/settings/categories/${id}`, { method: 'DELETE' }),
  },
  workEntrances: {
    list: (objectId) => request(`/api/settings/work-entrances${objectId ? `?object_id=${objectId}` : ''}`),
    create: (body) => request('/api/settings/work-entrances', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => request(`/api/settings/work-entrances/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    delete: (id) => request(`/api/settings/work-entrances/${id}`, { method: 'DELETE' }),
  },
  workFloors: {
    list: (entranceId) => request(`/api/settings/work-floors${entranceId ? `?entrance_id=${entranceId}` : ''}`),
    create: (body) => request('/api/settings/work-floors', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => request(`/api/settings/work-floors/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    delete: (id) => request(`/api/settings/work-floors/${id}`, { method: 'DELETE' }),
  },
  workApartments: {
    list: (floorId) => request(`/api/settings/work-apartments${floorId ? `?floor_id=${floorId}` : ''}`),
    create: (body) => request('/api/settings/work-apartments', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => request(`/api/settings/work-apartments/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    delete: (id) => request(`/api/settings/work-apartments/${id}`, { method: 'DELETE' }),
  },
  workRooms: {
    list: (apartmentId) => request(`/api/settings/work-rooms${apartmentId ? `?apartment_id=${apartmentId}` : ''}`),
    create: (body) => request('/api/settings/work-rooms', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => request(`/api/settings/work-rooms/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    delete: (id) => request(`/api/settings/work-rooms/${id}`, { method: 'DELETE' }),
  },
  organizations: {
    list: () => request('/api/settings/organizations'),
    create: (body) => request('/api/settings/organizations', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => request(`/api/settings/organizations/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    delete: (id) => request(`/api/settings/organizations/${id}`, { method: 'DELETE' }),
  },
};

export const operations = {
  issue: (body) => request('/api/operations/issue', { method: 'POST', body: JSON.stringify(body) }),
  return: (body) => request('/api/operations/return', { method: 'POST', body: JSON.stringify(body) }),
  setReturnedQuantity: (issuanceId, returned_quantity) =>
    request(`/api/operations/issuances/${issuanceId}/returned`, {
      method: 'PATCH',
      body: JSON.stringify({ returned_quantity }),
    }),
  issuances: () => request('/api/operations/issuances'),
  deleteIssuance: (id) => request(`/api/operations/issuances/${id}`, { method: 'DELETE' }),
  exportExcel: (rows, meta) =>
    exportDownloadFile('/api/operations/export', { format: 'xlsx', rows, meta }, 'issuances.xlsx'),
  exportPdf: (rows, meta) =>
    exportDownloadFile('/api/operations/export', { format: 'pdf', rows, meta }, 'issuances.pdf'),
};

export const reports = {
  production: (from, to) => request(`/api/reports/production?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  productionHistory: (queryString) => request(`/api/reports/production/history?${queryString}`),
  productionLocations: () => request('/api/reports/production/locations'),
  addWorkEntrance: (body) =>
    request('/api/reports/production/locations/entrances', { method: 'POST', body: JSON.stringify(body) }),
  addWorkFloor: (body) =>
    request('/api/reports/production/locations/floors', { method: 'POST', body: JSON.stringify(body) }),
  addWorkApartment: (body) =>
    request('/api/reports/production/locations/apartments', { method: 'POST', body: JSON.stringify(body) }),
  addWorkRoom: (body) =>
    request('/api/reports/production/locations/rooms', { method: 'POST', body: JSON.stringify(body) }),
  setProductionLocation: (issuanceId, location) =>
    request(`/api/reports/production/issuances/${issuanceId}/location`, {
      method: 'PATCH',
      body: JSON.stringify(location),
    }),
  confirmProduction: (issuanceId, location) =>
    request(`/api/reports/production/issuances/${issuanceId}/confirm`, {
      method: 'PATCH',
      body: JSON.stringify(location),
    }),
  unconfirmProduction: (issuanceId) =>
    request(`/api/reports/production/issuances/${issuanceId}/unconfirm`, { method: 'PATCH' }),
};

export const stats = {
  get: () => request('/api/stats'),
};

export const actions = {
  list: (limit = 300) => request(`/api/actions?limit=${limit}`),
  sync: (items) => request('/api/actions/sync', { method: 'POST', body: JSON.stringify({ items }) }),
};

export const attendance = {
  registerFace: (descriptor, userId, faceImage) =>
    request('/api/attendance/register-face', {
      method: 'POST',
      body: JSON.stringify({
        descriptor,
        ...(userId != null ? { user_id: userId } : {}),
        ...(faceImage ? { face_image: faceImage } : {}),
      }),
    }),
  scan: (descriptor) => request('/api/attendance/scan', { method: 'POST', body: JSON.stringify({ descriptor }) }),
  my: (limit) => request(`/api/attendance/my?limit=${limit || 60}`),
  all: (from, to) => {
    const q = new URLSearchParams();
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    const s = q.toString();
    return request(`/api/attendance/all${s ? `?${s}` : ''}`);
  },
  timesheet: (from, to) => {
    const q = new URLSearchParams();
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    const s = q.toString();
    return request(`/api/attendance/timesheet${s ? `?${s}` : ''}`);
  },
  updateTimesheetRates: (userId, month, fields) =>
    request('/api/attendance/timesheet/rates', {
      method: 'PATCH',
      body: JSON.stringify({ user_id: userId, month, ...fields }),
    }),
  updateTimesheetDay: (userId, date, payload) =>
    request('/api/attendance/timesheet/day', {
      method: 'PATCH',
      body: JSON.stringify({ user_id: userId, date, ...payload }),
    }),
  updateTimesheetHours: (userId, date, worked_hours) =>
    request('/api/attendance/timesheet/hours', {
      method: 'PATCH',
      body: JSON.stringify({ user_id: userId, date, worked_hours }),
    }),
  updateTimesheetTimes: (userId, date, { check_in, check_out }) =>
    request('/api/attendance/timesheet/times', {
      method: 'PATCH',
      body: JSON.stringify({ user_id: userId, date, check_in, check_out }),
    }),
  exportTimesheet: (from, to, organization) => {
    const q = new URLSearchParams();
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    if (organization) q.set('organization', organization);
    const s = q.toString();
    const month = (from || '').slice(0, 7);
    const suffix = organization
      ? organization.replace(/[\\/?*[\]:]/g, '_').slice(0, 40)
      : 'obshiy';
    return downloadBlob(
      `/api/attendance/timesheet/export${s ? `?${s}` : ''}`,
      `tabel-${month || 'period'}-${suffix}.xlsx`,
    );
  },
  importTimesheet: async (month, file) => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetchWithTimeout(`/api/attendance/timesheet/import?month=${encodeURIComponent(month)}`, {
      method: 'POST',
      body: form,
      credentials: 'include',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText || 'Ошибка импорта');
    return data;
  },
  timesheetCandidates: (month) => request(`/api/attendance/timesheet/candidates?month=${encodeURIComponent(month)}`),
  addTimesheetMember: (userId, month) =>
    request('/api/attendance/timesheet/members', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, month }),
    }),
};
