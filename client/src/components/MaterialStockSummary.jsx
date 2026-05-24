import { formatStockMoney, materialStockTotals } from '../lib/materialStock';

export default function MaterialStockSummary({ material, className = '', stockLabel = 'На складе' }) {
  if (material?.quantity == null && material?.price == null && material?.production_price == null) {
    return null;
  }

  const { qty, unit, unitPrice, unitSmr, costTotal, smrTotal } = materialStockTotals(material);

  return (
    <div className={`w-full grid grid-cols-2 gap-x-4 gap-y-2.5 text-left text-2xs p-3 rounded-lg bg-white/5 border border-white/10 ${className}`.trim()}>
      <div className="col-span-2">
        <span className="text-zinc-500 uppercase tracking-wide text-[10px]">{stockLabel}</span>
        <p className="text-white font-semibold tabular-nums text-sm mt-0.5">
          {qty.toLocaleString('ru-RU', { maximumFractionDigits: 4 })}
          {unit ? ` ${unit}` : ''}
        </p>
      </div>
      <div>
        <span className="text-zinc-500">Стоимость за ед.</span>
        <p className="text-zinc-300 tabular-nums mt-0.5">{formatStockMoney(unitPrice)}</p>
      </div>
      <div>
        <span className="text-zinc-500">СМР за ед.</span>
        <p className="text-zinc-300 tabular-nums mt-0.5">{formatStockMoney(unitSmr)}</p>
      </div>
      <div>
        <span className="text-zinc-500">Стоимость</span>
        <p className="text-white font-medium tabular-nums mt-0.5">{formatStockMoney(costTotal)}</p>
      </div>
      <div>
        <span className="text-zinc-500">СМР</span>
        <p className="text-zinc-300 tabular-nums mt-0.5">{formatStockMoney(smrTotal)}</p>
      </div>
    </div>
  );
}
