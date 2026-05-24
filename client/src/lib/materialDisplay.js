import { locationLabel } from './materialForm';

/** Уникальные места из списка частей/строк */
export function uniqueLocationLabels(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows || []) {
    const label = locationLabel(row);
    if (!label || label === '—' || seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out;
}

export function isMaterialPart(m) {
  if (m?.parent_material_id != null) return true;
  return m?.part_index != null && m?.part_index !== '';
}

export function isMaterialGroupParent(m) {
  return !m?.parent_material_id && Number(m?.parts_count) > 0;
}

export function materialDisplayName(m) {
  if (!m) return '';
  if (m.part_index) {
    const label = m.part_label || `Часть ${m.part_index}`;
    const base = m.group_name || m.name || '';
    return `${base} · ${label}`;
  }
  return m.name || '';
}

export function isMaterialGroupRow(m) {
  return !m?.parent_material_id && Number(m?.parts_count) > 0;
}

/** Место для строки таблицы (группа — сводка по частям) */
export function materialRowLocation(row, { parts } = {}) {
  if (!row) return '—';
  if (isMaterialGroupRow(row)) {
    const fromApi = (row.group_locations_label || '').trim();
    if (fromApi) return fromApi;
    const fromParts = uniqueLocationLabels(parts);
    if (fromParts.length) return fromParts.join(' · ');
    return '—';
  }
  return locationLabel(row);
}

/** Количество одной части (не сумма группы) */
export function materialPartQuantity(m) {
  if (!m) return 0;
  if (isMaterialPart(m) || m.part_index != null) {
    const q = Number(m.quantity);
    return Number.isFinite(q) ? q : 0;
  }
  return null;
}

/** Количество для строки таблицы: сумма частей или остаток одиночного материала */
export function materialRowQuantity(m) {
  if (!m) return 0;
  if (isMaterialPart(m)) return materialPartQuantity(m);
  if (isMaterialGroupRow(m)) {
    const sum = Number(m.group_total_quantity);
    if (Number.isFinite(sum)) return sum;
    return Number(m.quantity) || 0;
  }
  return Number(m.quantity) || 0;
}

export function materialPartDisplayName(m, parentName) {
  const base = (m?.group_name || parentName || m?.name || '').trim();
  const label = (m?.part_label || (m?.part_index ? `Часть ${m.part_index}` : '')).trim();
  if (base && label) return { name: base, partLabel: label };
  if (base) return { name: base, partLabel: '' };
  return { name: label || '—', partLabel: '' };
}

export function materialHasStock(m) {
  if (!m) return false;
  if (isMaterialGroupRow(m)) return materialRowQuantity(m) > 0;
  return (Number(m.quantity) || 0) > 0;
}

export function filterPartsInStock(parts) {
  return (parts || []).filter((p) => (Number(p.quantity) || 0) > 0);
}

export function materialPartsCount(m, loadedParts) {
  const inStock = Array.isArray(loadedParts) ? filterPartsInStock(loadedParts) : [];
  if (inStock.length > 0) return inStock.length;
  if (!m) return 0;
  const n = Number(m.parts_count);
  if (Number.isFinite(n) && n >= 0) return n;
  return Math.max(0, parseInt(m.parts_count, 10) || 0);
}

export function materialGroupParentId(m) {
  if (!m) return null;
  if (m.parent_material_id) return m.parent_material_id;
  if (isMaterialGroupRow(m)) return m.id;
  return null;
}

export function materialGroupSummary(m) {
  if (!m) return null;
  const isPart = isMaterialPart(m);
  const isGroupParent = isMaterialGroupRow(m);
  if (!isPart && !isGroupParent) return null;

  const partsCount = materialPartsCount(m);
  const totalQty = Number(m.group_total_quantity);
  const total = Number.isFinite(totalQty) ? totalQty : (isGroupParent ? 0 : Number(m.quantity) || 0);

  return {
    name: (isPart ? m.group_name : null) || m.name,
    code: (isPart ? m.group_code : null) || m.code,
    totalQty: total,
    unit: m.unit || 'шт',
    partsCount,
    partIndex: m.part_index,
    partLabel: m.part_label,
    partQty: isPart ? Number(m.quantity) || 0 : null,
    parentId: materialGroupParentId(m),
  };
}

export function materialQrHoverTitle(m) {
  const g = materialGroupSummary(m);
  if (!g) return materialDisplayName(m) || m?.name || '';
  const lines = [
    materialDisplayName(m) || g.name,
    `Всего на складе: ${g.totalQty} ${g.unit}`,
    `Частей: ${g.partsCount}`,
  ];
  if (g.partIndex != null) {
    lines.push(`Эта часть: ${g.partLabel || `Часть ${g.partIndex}`} — ${g.partQty ?? 0} ${g.unit}`);
    lines.push(`Место: ${locationLabel(m)}`);
  } else if (isMaterialGroupRow(m)) {
    const loc = materialRowLocation(m);
    if (loc && loc !== '—') lines.push(`Места: ${loc}`);
  }
  return lines.join('\n');
}
