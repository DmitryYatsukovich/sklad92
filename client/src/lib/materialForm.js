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
    quantity: '',
    object_id: m.object_id ? String(m.object_id) : '',
    warehouse_id: m.warehouse_id ? String(m.warehouse_id) : '',
    rack_id: m.rack_id ? String(m.rack_id) : '',
    category_id: m.category_id ? String(m.category_id) : '',
  };
}

export function formToPayload(form, { includeQuantity = false } = {}) {
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
  return body;
}

export function locationLabel(m) {
  const parts = [m.object_name, m.warehouse_name, m.rack_name].filter(Boolean);
  return parts.length ? parts.join(' → ') : '—';
}
