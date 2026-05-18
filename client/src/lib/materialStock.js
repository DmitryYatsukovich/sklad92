export function formatStockMoney(n) {
  const s = (Number(n) || 0).toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${s} ₽`;
}

export function materialStockTotals(m) {
  const qty = Number(m?.quantity) || 0;
  const unitPrice = Number(m?.price ?? 0);
  const unitSmr = Number(m?.production_price ?? 0);
  return {
    qty,
    unit: m?.unit || '',
    unitPrice,
    unitSmr,
    costTotal: qty * unitPrice,
    smrTotal: qty * unitSmr,
  };
}
