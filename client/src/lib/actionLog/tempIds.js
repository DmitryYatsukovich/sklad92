/** Временные отрицательные id для офлайн-записей (привязаны к id мутации в IndexedDB). */
export const TEMP_MATERIAL_OFFSET = 2_000_000;
export const TEMP_ISSUANCE_OFFSET = 1_000_000;

export function tempMaterialId(mutationDbId) {
  if (mutationDbId == null) return -TEMP_MATERIAL_OFFSET - 1;
  return -Number(mutationDbId) - TEMP_MATERIAL_OFFSET;
}

export function tempIssuanceId(mutationDbId) {
  if (mutationDbId == null) return -TEMP_ISSUANCE_OFFSET - 1;
  return -Number(mutationDbId) - TEMP_ISSUANCE_OFFSET;
}

export function isTempMaterialId(id) {
  const n = Number(id);
  return Number.isFinite(n) && n < 0 && n > -TEMP_MATERIAL_OFFSET - 1_000_000;
}

export function isTempIssuanceId(id) {
  const n = Number(id);
  return Number.isFinite(n) && n < -TEMP_ISSUANCE_OFFSET && n > -TEMP_MATERIAL_OFFSET;
}

export function pendingMaterialCode(mutationDbId) {
  return `~${mutationDbId}`;
}

/** id созданного материала из ответа POST /api/materials (в т.ч. разделение на части). */
export function resolveCreatedMaterialId(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.id != null && data.parent == null) return Number(data.id);
  if (data.parent != null) {
    const parentQty = parseFloat(data.parent.quantity) || 0;
    if (parentQty <= 0 && Array.isArray(data.parts) && data.parts[0]?.id != null) {
      return Number(data.parts[0].id);
    }
    if (data.parent.id != null) return Number(data.parent.id);
  }
  if (Array.isArray(data.parts) && data.parts[0]?.id != null) return Number(data.parts[0].id);
  return null;
}

export function mapsFromPersisted(persisted) {
  const materialIdMap = new Map(
    Object.entries(persisted.material || {}).map(([k, v]) => [Number(k), Number(v)]),
  );
  const issuanceIdMap = new Map(
    Object.entries(persisted.issuance || {}).map(([k, v]) => [Number(k), Number(v)]),
  );
  return { materialIdMap, issuanceIdMap };
}

function replaceIdInPath(path, oldId, newId) {
  return path
    .replace(`/${oldId}/`, `/${newId}/`)
    .replace(`/${oldId}`, `/${newId}`);
}

/** Подставить реальные id материалов/выдач перед отправкой на сервер. */
export function remapMutationForSync(item, materialIdMap, issuanceIdMap) {
  const method = (item.method || 'GET').toUpperCase();
  let path = item.path;
  let body = item.body;

  for (const [temp, real] of materialIdMap) {
    if (path.includes(`/${temp}`)) path = replaceIdInPath(path, temp, real);
  }
  for (const [temp, real] of issuanceIdMap) {
    if (path.includes(`/${temp}`)) path = replaceIdInPath(path, temp, real);
  }

  if (body) {
    try {
      const parsed = JSON.parse(body);
      let changed = false;
      const mid = parsed.material_id != null ? Number(parsed.material_id) : null;
      if (mid != null && materialIdMap.has(mid)) {
        parsed.material_id = materialIdMap.get(mid);
        changed = true;
      }
      const iid = parsed.issuance_id != null ? Number(parsed.issuance_id) : null;
      if (iid != null && issuanceIdMap.has(iid)) {
        parsed.issuance_id = issuanceIdMap.get(iid);
        changed = true;
      }
      if (changed) body = JSON.stringify(parsed);
    } catch {
      /* keep body */
    }
  }

  return { path, method, body };
}

/** Мутация ссылается на ещё не синхронизированный материал/выдачу — только локальная очередь. */
export function mutationNeedsOfflineQueue(path, method, bodyText) {
  const m = (method || 'GET').toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(m)) return false;

  const matPath = path.match(/^\/api\/materials\/(-?\d+)(?:\/|$)/);
  if (matPath && isTempMaterialId(Number(matPath[1]))) return true;

  const issPath = path.match(/^\/api\/operations\/issuances\/(-?\d+)/);
  if (issPath && isTempIssuanceId(Number(issPath[1]))) return true;

  const prodPath = path.match(/\/production\/issuances\/(-?\d+)/);
  if (prodPath && isTempIssuanceId(Number(prodPath[1]))) return true;

  if (!bodyText) return false;
  try {
    const body = JSON.parse(bodyText);
    if (body.material_id != null && isTempMaterialId(body.material_id)) return true;
    if (body.issuance_id != null && isTempIssuanceId(body.issuance_id)) return true;
  } catch {
    return false;
  }
  return false;
}
