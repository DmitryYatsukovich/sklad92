export const UNITS = ['шт', 'кг', 'л', 'м', 'м²', 'упак', 'рул'];

export const emptyMaterialForm = () => ({
  name: '',
  unit: 'шт',
  price: '',
  production_price: '',
  quantity: '',
  object_id: '',
  warehouse_id: '',
  rack_id: '',
  category_id: '',
});

export function materialToForm(m) {
  return {
    name: m.name || '',
    unit: m.unit || 'шт',
    price: m.price != null ? String(m.price) : '',
    production_price: m.production_price != null ? String(m.production_price) : '',
    quantity: m.quantity != null && m.quantity !== '' ? String(m.quantity) : '',
    part_label: m.part_label || '',
    object_id: m.object_id ? String(m.object_id) : '',
    warehouse_id: m.warehouse_id ? String(m.warehouse_id) : '',
    rack_id: m.rack_id ? String(m.rack_id) : '',
    category_id: m.category_id ? String(m.category_id) : '',
  };
}

export function materialPartLabel(materialName, index) {
  const base = (materialName || '').trim();
  if (!base) return `Часть ${index}`;
  return `${base} — часть ${index}`;
}

export function emptySplitPart(form = emptyMaterialForm(), index = 1, materialName) {
  const name = materialName ?? form?.name ?? '';
  return {
    quantity: '',
    object_id: form.object_id || '',
    warehouse_id: form.warehouse_id || '',
    rack_id: form.rack_id || '',
    part_label: materialPartLabel(name, index),
    labelManual: false,
  };
}

export function defaultSplitParts(count, form = emptyMaterialForm()) {
  const n = Math.max(1, Math.min(500, parseInt(count, 10) || 1));
  const name = form?.name ?? '';
  return Array.from({ length: n }, (_, i) => emptySplitPart(form, i + 1, name));
}

export function appendSplitPart(parts, form = emptyMaterialForm()) {
  const name = form?.name ?? '';
  return [...parts, emptySplitPart(form, parts.length + 1, name)];
}

/** Подписи частей из наименования материала (если пользователь не менял вручную). */
export function syncSplitPartLabels(parts, materialName) {
  return parts.map((p, i) => (
    p.labelManual
      ? p
      : { ...p, part_label: materialPartLabel(materialName, i + 1) }
  ));
}

const qtyRound = (n) => Math.round(n * 10000) / 10000;

/**
 * После изменения количества в части idx: обрезать следующие части,
 * при остатке > 0 добавить следующую часть с автозаполнением остатка.
 */
export function applySplitPartQuantityChange(parts, index, quantityStr, totalQty, form = emptyMaterialForm()) {
  const total = parseFloat(totalQty) || 0;
  const materialName = form?.name ?? '';
  const next = parts.map((p, i) => {
    if (i !== index) return p;
    return {
      ...p,
      quantity: quantityStr,
      part_label: p.labelManual ? p.part_label : materialPartLabel(materialName, i + 1),
    };
  });

  const head = next.slice(0, index + 1);
  const sumHead = head.reduce((s, p) => s + (parseFloat(p.quantity) || 0), 0);
  const remaining = qtyRound(total - sumHead);

  if (remaining > 0.0001) {
    const tail = emptySplitPart(form, head.length + 1, materialName);
    return [...head, { ...tail, quantity: String(remaining) }];
  }
  return head;
}

/** Пересчитать остаток при смене общего количества. */
export function resyncSplitPartsForTotal(parts, totalQty, form = emptyMaterialForm()) {
  if (!parts.length) return defaultSplitParts(1, form);
  const total = parseFloat(totalQty) || 0;
  if (!(total > 0)) {
    return syncSplitPartLabels(
      parts.map((p) => ({ ...p, quantity: '' })),
      form?.name ?? '',
    );
  }
  let result = [];
  for (let i = 0; i < parts.length; i++) {
    const q = parseFloat(parts[i].quantity);
    if (!(q > 0)) break;
    result.push(parts[i]);
    const sum = result.reduce((s, p) => s + (parseFloat(p.quantity) || 0), 0);
    const rem = qtyRound(total - sum);
    if (rem > 0.0001 && i === parts.length - 1) {
      return applySplitPartQuantityChange(result, result.length - 1, parts[i].quantity, totalQty, form);
    }
    if (rem <= 0.0001) return result;
  }
  if (!result.length) return defaultSplitParts(1, form);
  const lastIdx = result.length - 1;
  return applySplitPartQuantityChange(result, lastIdx, result[lastIdx].quantity, totalQty, form);
}

/** Равномерно делит totalQty между частями */
export function splitQuantitiesEvenly(parts, totalQty) {
  const total = parseFloat(totalQty) || 0;
  const n = parts.length;
  if (!n) return [];
  if (total <= 0) return parts.map((p) => ({ ...p, quantity: '' }));
  const base = Math.floor((total / n) * 10000) / 10000;
  let sum = 0;
  return parts.map((p, i) => {
    const q = i === n - 1 ? Math.round((total - sum) * 10000) / 10000 : base;
    sum += q;
    return { ...p, quantity: String(q) };
  });
}

export function formToPayload(form, { includeQuantity = false, includePartLabel = false } = {}) {
  const body = {
    name: form.name.trim(),
    unit: form.unit.trim() || 'шт',
    price: parseFloat(form.price) || 0,
    production_price: parseFloat(form.production_price) || 0,
    object_id: form.object_id || null,
    warehouse_id: form.warehouse_id || null,
    rack_id: form.rack_id || null,
    category_id: form.category_id || null,
  };
  if (includeQuantity) body.quantity = parseFloat(form.quantity) || 0;
  if (includePartLabel && form.part_label != null) {
    body.part_label = form.part_label.trim() || null;
  }
  return body;
}

export function locationLabel(m) {
  const parts = [m.object_name, m.warehouse_name, m.rack_name].filter(Boolean);
  return parts.length ? parts.join(' → ') : '—';
}

export function formatUpdatedAt(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}
