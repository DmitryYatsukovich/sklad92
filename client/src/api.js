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

async function request(path, options = {}) {
  const res = await fetchWithTimeout(base + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText || 'Ошибка');
  return data;
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

async function exportMaterialsFile(format, rows) {
  const res = await fetchWithTimeout(`${base}/api/materials/export`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ format, rows }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || res.statusText || 'Ошибка выгрузки');
  }
  const ext = format === 'pdf' ? 'pdf' : 'xlsx';
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `materials.${ext}`;
  a.click();
  URL.revokeObjectURL(url);
}

export const auth = {
  login: (login, password) => request('/api/auth/login', { method: 'POST', body: JSON.stringify({ login, password }) }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  me: () => request('/api/auth/me'),
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
};

export const materials = {
  list: () => request('/api/materials'),
  byCode: (code) => request(`/api/materials/by-code/${encodeURIComponent(code)}`),
  create: (body) => request('/api/materials', { method: 'POST', body: JSON.stringify(body) }),
  update: (id, body) => request(`/api/materials/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  addQuantity: (id, amount) => request(`/api/materials/${id}/add`, { method: 'POST', body: JSON.stringify({ amount }) }),
  quantityHistory: (id) => request(`/api/materials/${id}/quantity-history`),
  usersForIssuance: () => request('/api/materials/users-for-issuance'),
  downloadImportTemplate: () => downloadBlob('/api/materials/import-template', 'shablon-materialy.xlsx'),
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
};

export const reports = {
  production: (from, to) => request(`/api/reports/production?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
};

export const roles = {
  list: () => request('/api/roles'),
  create: (body) => request('/api/roles', { method: 'POST', body: JSON.stringify(body) }),
  update: (id, body) => request(`/api/roles/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  delete: (id) => request(`/api/roles/${id}`, { method: 'DELETE' }),
};

export const stats = {
  get: () => request('/api/stats'),
};

export const attendance = {
  registerFace: (descriptor, userId) =>
    request('/api/attendance/register-face', {
      method: 'POST',
      body: JSON.stringify(userId != null ? { descriptor, user_id: userId } : { descriptor }),
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
};
