import { getOfflineDataset, setOfflineDataset } from './datasets.js';

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function dayFromIso(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function inDateRange(iso, from, to) {
  const day = dayFromIso(iso);
  if (!day) return false;
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

function parsePath(path) {
  const [pathname, query = ''] = String(path || '').split('?');
  return {
    pathname,
    params: new URLSearchParams(query),
  };
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function deriveProductionRows(issuances, materials, users) {
  const materialsById = new Map(asArray(materials).map((m) => [Number(m.id), m]));
  const usersById = new Map(asArray(users).map((u) => [Number(u.id), u]));
  return asArray(issuances).map((iss) => {
    const materialId = Number(iss.material_id);
    const userId = Number(iss.issued_to_user_id);
    const mat = materialsById.get(materialId) || {};
    const usr = usersById.get(userId) || {};
    const issued = toNum(iss.quantity);
    const returned = toNum(iss.returned_quantity);
    const produced = Math.max(issued - returned, 0);
    const unitSmr = toNum(iss.production_price ?? mat.production_price);
    return {
      issuance_id: Number(iss.id),
      issued_at: iss.issued_at,
      issuance_updated_at: iss.updated_at || null,
      production_confirmed: false,
      production_confirmed_at: null,
      user_id: userId,
      login: iss.issued_to_login || usr.login || '',
      display_name: iss.issued_to_name || usr.display_name || '',
      first_name: usr.first_name || null,
      last_name: usr.last_name || null,
      material_id: materialId,
      material_name: iss.material_name || mat.name || `Материал #${materialId}`,
      unit: iss.unit || mat.unit || 'шт',
      production_price: unitSmr,
      total_issued: issued,
      total_returned: returned,
      produced,
      smr_total: produced * unitSmr,
      work_location_label: '',
      work_location_items: null,
      work_object_id: null,
    };
  });
}

function normalizeProductionRows(rows) {
  return asArray(rows)
    .filter((row) => Number(row?.issuance_id) > 0)
    .map((row) => {
      const issued = toNum(row.total_issued);
      const returned = toNum(row.total_returned);
      const produced = Math.max(issued - returned, 0);
      const unitSmr = toNum(row.production_price);
      return {
        ...row,
        issuance_updated_at: row.issuance_updated_at || row.updated_at || null,
        produced,
        smr_total: produced * unitSmr,
      };
    });
}

function filterProductionRows(rows, currentUser, from, to) {
  const isAdmin = currentUser?.role === 'admin';
  const currentUserId = Number(currentUser?.id || 0);
  return rows.filter((row) => {
    if (!inDateRange(row.issued_at, from, to)) return false;
    if (!isAdmin && currentUserId > 0 && Number(row.user_id) !== currentUserId) return false;
    return true;
  });
}

export async function updateOfflineDatasetsForPath(path, data, currentUser = null) {
  const { pathname, params } = parsePath(path);
  const userId = currentUser?.id ? Number(currentUser.id) : null;

  if (pathname === '/api/materials' && Array.isArray(data)) {
    await setOfflineDataset('materials', data, userId);
    return;
  }
  if (pathname === '/api/materials/users-for-issuance' && Array.isArray(data)) {
    await setOfflineDataset('issueUsers', data, userId);
    return;
  }
  if (pathname === '/api/operations/issuances' && Array.isArray(data)) {
    await setOfflineDataset('issuances', data, userId);
    return;
  }
  if (pathname === '/api/reports/production/locations' && data && typeof data === 'object') {
    await setOfflineDataset('productionLocations', data, userId);
    return;
  }
  if (pathname === '/api/reports/production' && Array.isArray(data)) {
    const nextRows = normalizeProductionRows(data);
    const prevRows = asArray(await getOfflineDataset('productionRows', userId));
    const from = params.get('from') || '';
    const to = params.get('to') || '';
    const baseRows = prevRows.filter((row) => !inDateRange(row.issued_at, from, to));
    const byIssuance = new Map(baseRows.map((row) => [Number(row.issuance_id), row]));
    for (const row of nextRows) byIssuance.set(Number(row.issuance_id), row);
    await setOfflineDataset('productionRows', Array.from(byIssuance.values()), userId);
  }
}

export async function getOfflineResponseForPath(path, currentUser = null) {
  const { pathname, params } = parsePath(path);
  const userId = currentUser?.id ? Number(currentUser.id) : null;

  if (pathname === '/api/materials') {
    return getOfflineDataset('materials', userId);
  }
  if (pathname === '/api/materials/users-for-issuance') {
    return getOfflineDataset('issueUsers', userId);
  }
  if (pathname === '/api/operations/issuances') {
    return getOfflineDataset('issuances', userId);
  }
  if (pathname === '/api/reports/production/locations') {
    return getOfflineDataset('productionLocations', userId);
  }
  if (pathname === '/api/reports/production') {
    const from = params.get('from') || '';
    const to = params.get('to') || '';
    let rows = normalizeProductionRows(await getOfflineDataset('productionRows', userId));
    if (!rows.length) {
      const [issuances, materials, issueUsers] = await Promise.all([
        getOfflineDataset('issuances', userId),
        getOfflineDataset('materials', userId),
        getOfflineDataset('issueUsers', userId),
      ]);
      rows = deriveProductionRows(issuances, materials, issueUsers);
    }
    return filterProductionRows(rows, currentUser, from, to);
  }
  return null;
}
