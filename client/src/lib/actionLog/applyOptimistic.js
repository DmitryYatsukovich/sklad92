import { listPendingMutations } from './store.js';
import { buildActionFromRequest } from './buildAction.js';
import { formatWorkLocationFromSelection } from '../workLocationLabel.js';
import {
  pendingMaterialCode,
  tempIssuanceId,
  tempMaterialId,
  isTempMaterialId,
  isTempIssuanceId,
} from './tempIds.js';
import { stripPendingMeta } from './rowMeta.js';

export { stripPendingMeta } from './rowMeta.js';

export const PENDING_ROW_CLASS = 'opacity-55 saturate-[0.85]';

export function withPendingRowClass(baseClass, row) {
  if (!row?._pending) return baseClass;
  return `${baseClass} ${PENDING_ROW_CLASS}`.trim();
}

function isRowObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeMutationEntry(entry) {
  if (!isRowObject(entry)) return null;
  return {
    ...entry,
    path: typeof entry.path === 'string' ? entry.path : '',
    method: typeof entry.method === 'string' ? entry.method.toUpperCase() : 'GET',
    body: isRowObject(entry.body) ? entry.body : {},
    meta: isRowObject(entry.meta) ? entry.meta : {},
  };
}

function parseBody(bodyText) {
  if (!bodyText) return {};
  try {
    return JSON.parse(bodyText);
  } catch {
    return {};
  }
}

function parseDeletePeriod(path, body = {}) {
  const fromBody = body?.from;
  const toBody = body?.to;
  if (fromBody || toBody) return { from: fromBody || null, to: toBody || null };
  const query = path?.split('?')[1];
  if (!query) return { from: null, to: null };
  const params = new URLSearchParams(query);
  return {
    from: params.get('from') || null,
    to: params.get('to') || null,
  };
}

function markPending(row, extra = {}) {
  return { ...row, ...extra, _pending: true };
}

function findMaterial(list, id) {
  return list.find((m) => m.id === id || String(m.id) === String(id));
}

function findUser(users, id) {
  return users.find((u) => u.id === id || String(u.id) === String(id));
}

function findIssuance(list, id) {
  return list.find((i) => i.id === id || String(i.id) === String(id));
}

function findProductionRow(list, issuanceId) {
  return list.find((r) => r.issuance_id === issuanceId || String(r.issuance_id) === String(issuanceId));
}

function inDateRange(iso, from, to) {
  if (!iso) return false;
  const day = new Date(iso);
  if (Number.isNaN(day.getTime())) return false;
  const d = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

function catalogNames(catalog, body) {
  if (!catalog || !body) return {};
  const obj = (catalog.objects || []).find((o) => o.id === body.object_id || String(o.id) === String(body.object_id));
  const wh = (catalog.warehouses || []).find((w) => w.id === body.warehouse_id);
  const rack = (catalog.racks || []).find((r) => r.id === body.rack_id);
  const cat = (catalog.categories || []).find((c) => c.id === body.category_id);
  return {
    object_name: obj?.name || null,
    warehouse_name: wh?.name || null,
    rack_name: rack?.name || null,
    category_name: cat?.name || null,
  };
}

function adjustMaterialQty(list, materialId, delta) {
  const m = findMaterial(list, materialId);
  if (!m) return;
  const q = Number(m.quantity) || 0;
  m.quantity = Math.max(0, q + delta);
  m._pending = true;
}

let pendingEntriesCache = null;

export function invalidatePendingEntriesCache() {
  pendingEntriesCache = null;
}

export async function loadPendingEntries() {
  if (pendingEntriesCache) return pendingEntriesCache;
  const queue = await listPendingMutations();
  pendingEntriesCache = queue.map((entry) => {
    const safePath = typeof entry?.path === 'string' ? entry.path : '';
    const safeMethod = typeof entry?.method === 'string' ? entry.method : 'GET';
    const body = parseBody(entry.body);
    const meta = buildActionFromRequest(safePath, safeMethod, entry.body) || {};
    return {
      ...entry,
      path: safePath,
      method: safeMethod,
      body,
      meta,
      kind: meta.kind || 'api_mutation',
    };
  });
  return pendingEntriesCache;
}

function prepareMaterialsBase(materials) {
  const source = Array.isArray(materials) ? materials : [];
  return source
    .filter((m) => isRowObject(m) && !isTempMaterialId(m.id))
    .map(stripPendingMeta);
}

function prepareIssuancesBase(issuances) {
  const source = Array.isArray(issuances) ? issuances : [];
  return source
    .filter((i) => isRowObject(i) && !isTempIssuanceId(i.id))
    .map(stripPendingMeta);
}

function prepareProductionBase(rows) {
  const source = Array.isArray(rows) ? rows : [];
  return source
    .filter((r) => isRowObject(r) && !isTempIssuanceId(r.issuance_id))
    .map(stripPendingMeta);
}

export function applyPendingToMaterials(materials, entries, ctx = {}) {
  const { catalog } = ctx;
  const list = prepareMaterialsBase(materials);
  const pending = Array.isArray(entries) ? entries : [];
  if (!pending.length) return list;

  const hidden = new Set();

  for (const entry of pending) {
    const safe = normalizeMutationEntry(entry);
    if (!safe) continue;
    const { kind, body, path, method } = safe;
    const meta = safe.meta || {};
    const payload = isRowObject(meta.payload) ? meta.payload : body;

    if (kind === 'material_create' && path === '/api/materials' && method === 'POST') {
      const id = tempMaterialId(entry.id);
      const code = body.code || pendingMaterialCode(entry.id);
      list.unshift(markPending({
        id,
        ...body,
        ...catalogNames(catalog, body),
        quantity: body.quantity ?? body.parts?.reduce((s, p) => s + (Number(p.quantity) || 0), 0) ?? 0,
        code,
        material_code: code,
        updated_at: entry.createdAt || new Date().toISOString(),
        _pendingCreate: true,
      }));
      continue;
    }

    const matPut = path.match(/^\/api\/materials\/(\d+)$/);
    if (matPut && method === 'PUT') {
      const id = Number(matPut[1]);
      const m = findMaterial(list, id);
      if (m) {
        Object.assign(m, body, catalogNames(catalog, body));
        m._pending = true;
      }
      continue;
    }

    const matAdd = path.match(/^\/api\/materials\/(\d+)\/add$/);
    if (matAdd && method === 'POST') {
      const id = Number(matAdd[1]);
      const add = Number(body.amount ?? body.quantity) || 0;
      adjustMaterialQty(list, id, add);
      continue;
    }

    const matDel = path.match(/^\/api\/materials\/(\d+)$/);
    if (matDel && method === 'DELETE') {
      hidden.add(Number(matDel[1]));
      continue;
    }

    const matSplit = path.match(/^\/api\/materials\/(\d+)\/split$/);
    if (matSplit && method === 'POST') {
      const m = findMaterial(list, Number(matSplit[1]));
      if (m) m._pending = true;
      continue;
    }

    if (kind === 'issue' && path === '/api/operations/issue') {
      const mid = Number(body.material_id);
      const qty = Number(body.quantity) || 0;
      if (mid && qty > 0) adjustMaterialQty(list, mid, -qty);
    }
  }

  return list.filter((m) => isRowObject(m) && !hidden.has(m.id));
}

function buildIssuanceFromIssue(entry, body, ctx) {
  const { materials = [], issueUsers = [], currentUser } = ctx;
  const mat = findMaterial(materials, body.material_id);
  const recipient = findUser(issueUsers, body.issued_to_user_id);
  const issuedAt = entry.createdAt || new Date().toISOString();
  return markPending({
    id: tempIssuanceId(entry.id),
    material_id: body.material_id,
    issued_to_user_id: body.issued_to_user_id,
    quantity: body.quantity,
    returned_quantity: 0,
    issued_at: issuedAt,
    note: body.note || null,
    material_code: mat?.code || mat?.material_code || null,
    material_name: mat?.name || `Материал #${body.material_id}`,
    unit: mat?.unit || 'шт',
    price: mat?.price ?? 0,
    production_price: mat?.production_price ?? 0,
    issued_to_login: recipient?.login || currentUser?.login || '',
    issued_to_name: recipient?.display_name || recipient?.login || currentUser?.display_name || '',
  });
}

export function applyPendingToIssuances(issuances, entries, ctx = {}) {
  let list = prepareIssuancesBase(issuances);
  const pending = Array.isArray(entries) ? entries : [];
  if (!pending.length) return list;

  const removed = new Set();

  for (const entry of pending) {
    const safe = normalizeMutationEntry(entry);
    if (!safe) continue;
    const { kind, body, path, method } = safe;
    const meta = safe.meta || {};
    const payload = isRowObject(meta.payload) ? meta.payload : body;

    if (kind === 'issue' && path === '/api/operations/issue') {
      list.unshift(buildIssuanceFromIssue(entry, body, ctx));
      continue;
    }

    const returnedMatch = path.match(/^\/api\/operations\/issuances\/(\d+)\/returned$/);
    if (returnedMatch && method === 'PATCH') {
      const id = Number(returnedMatch[1]);
      const row = findIssuance(list, id);
      if (row) {
        row.returned_quantity = body.returned_quantity ?? payload.returned_quantity;
        row._pending = true;
      }
      continue;
    }

    const issDel = path.match(/^\/api\/operations\/issuances\/(\d+)$/);
    if (issDel && method === 'DELETE') {
      removed.add(Number(issDel[1]));
      continue;
    }
    if (path === '/api/operations/issuances/all' && method === 'DELETE') {
      list = [];
      removed.clear();
      continue;
    }
    if (path?.startsWith('/api/reports/production') && method === 'DELETE') {
      const { from, to } = parseDeletePeriod(path, body);
      list = list.filter((row) => !inDateRange(row.issued_at, from, to));
      removed.clear();
      continue;
    }

    if (kind === 'return' && path === '/api/operations/return') {
      const row = findIssuance(list, body.issuance_id);
      if (row) {
        row.returned_quantity = body.returned_quantity ?? body.quantity;
        row._pending = true;
      }
    }
  }

  return list.filter((i) => isRowObject(i) && !removed.has(i.id));
}

function buildProductionRowFromIssue(entry, body, ctx) {
  const { materials = [], issueUsers = [], currentUser, isAdmin } = ctx;
  const recipientId = Number(body.issued_to_user_id);
  if (!isAdmin && currentUser?.id && recipientId !== Number(currentUser.id)) {
    return null;
  }
  const mat = findMaterial(materials, body.material_id);
  const recipient = findUser(issueUsers, recipientId);
  const qty = Number(body.quantity) || 0;
  const issuedAt = entry.createdAt || new Date().toISOString();
  const unitSmr = Number(mat?.production_price) || 0;
  return markPending({
    issuance_id: tempIssuanceId(entry.id),
    issued_at: issuedAt,
    production_confirmed: false,
    material_id: body.material_id,
    material_name: mat?.name || `Материал #${body.material_id}`,
    unit: mat?.unit || 'шт',
    production_price: unitSmr,
    total_issued: qty,
    total_returned: 0,
    produced: qty,
    smr_total: qty * unitSmr,
    user_id: recipientId,
    login: recipient?.login || '',
    display_name: recipient?.display_name || '',
    first_name: recipient?.first_name,
    last_name: recipient?.last_name,
    work_location_label: '',
    work_location_items: null,
  });
}

function patchProductionRow(row, patch, locations) {
  const next = { ...row, ...patch, _pending: true };
  if (patch.work_location_items && locations) {
    next.work_location_label = formatWorkLocationFromSelection(
      locations,
      patch.work_object_id ?? patch.object_id ?? next.work_object_id,
      patch.work_location_items,
    );
  }
  return next;
}

export function applyPendingToProduction(rows, entries, ctx = {}) {
  const {
    materials = [],
    issueUsers = [],
    locations,
    periodFrom,
    periodTo,
    currentUser,
    isAdmin,
  } = ctx;

  let list = prepareProductionBase(rows);
  const pending = Array.isArray(entries) ? entries : [];
  if (!pending.length) return list;

  const removed = new Set();

  for (const entry of pending) {
    const safe = normalizeMutationEntry(entry);
    if (!safe) continue;
    const { kind, body, path, method } = safe;
    const meta = safe.meta || {};
    const payload = isRowObject(meta.payload) ? meta.payload : body;

    if (kind === 'issue' && path === '/api/operations/issue') {
      const issuedAt = entry.createdAt || new Date().toISOString();
      if (!inDateRange(issuedAt, periodFrom, periodTo)) continue;
      const row = buildProductionRowFromIssue(entry, body, {
        materials, issueUsers, currentUser, isAdmin,
      });
      if (row) {
        list.unshift(row);
      }
      continue;
    }

    const returnedMatch = path.match(/^\/api\/operations\/issuances\/(\d+)\/returned$/);
    if (returnedMatch && method === 'PATCH') {
      const id = Number(returnedMatch[1]);
      const row = findProductionRow(list, id);
      if (row) {
        const returned = Number(body.returned_quantity ?? payload.returned_quantity) || 0;
        const issued = Number(row.total_issued) || 0;
        const produced = Math.max(issued - returned, 0);
        const unitSmr = Number(row.production_price) || 0;
        Object.assign(row, {
          total_returned: returned,
          produced,
          smr_total: produced * unitSmr,
          _pending: true,
        });
      }
      continue;
    }

    const issDel = path.match(/^\/api\/operations\/issuances\/(\d+)$/);
    if (issDel && method === 'DELETE') {
      removed.add(Number(issDel[1]));
      continue;
    }
    if (path === '/api/operations/issuances/all' && method === 'DELETE') {
      list = [];
      removed.clear();
      continue;
    }
    if (path?.startsWith('/api/reports/production') && method === 'DELETE') {
      const { from, to } = parseDeletePeriod(path, body);
      list = list.filter((row) => !inDateRange(row.issued_at, from, to));
      removed.clear();
      continue;
    }

    const prodConfirm = path.match(/^\/api\/reports\/production\/issuances\/(\d+)\/confirm$/);
    if (prodConfirm && method === 'PATCH') {
      const id = Number(prodConfirm[1]);
      const row = findProductionRow(list, id);
      if (row) {
        const loc = body;
        Object.assign(row, patchProductionRow(row, {
          production_confirmed: true,
          work_object_id: loc.object_id,
          work_location_items: {
            entrance_ids: loc.entrance_ids || [],
            floor_ids: loc.floor_ids || [],
            apartment_ids: loc.apartment_ids || [],
            room_ids: loc.room_ids || [],
          },
        }, locations));
      }
      continue;
    }

    const prodLoc = path.match(/^\/api\/reports\/production\/issuances\/(\d+)\/location$/);
    if (prodLoc && method === 'PATCH') {
      const id = Number(prodLoc[1]);
      const row = findProductionRow(list, id);
      if (row) {
        Object.assign(row, patchProductionRow(row, {
          work_object_id: body.object_id,
          work_location_items: {
            entrance_ids: body.entrance_ids || [],
            floor_ids: body.floor_ids || [],
            apartment_ids: body.apartment_ids || [],
            room_ids: body.room_ids || [],
          },
        }, locations));
      }
      continue;
    }

    const prodUnc = path.match(/^\/api\/reports\/production\/issuances\/(\d+)\/unconfirm$/);
    if (prodUnc && method === 'PATCH') {
      const id = Number(prodUnc[1]);
      const row = findProductionRow(list, id);
      if (row) {
        row.production_confirmed = false;
        row._pending = true;
      }
    }
  }

  return list.filter((r) => isRowObject(r) && !removed.has(r.issuance_id));
}
