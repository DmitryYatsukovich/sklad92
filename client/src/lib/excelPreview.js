/** Парсинг Excel для предпросмотра в браузере (xls / xlsx) */
export async function parseExcelBlobForPreview(blob, { maxRows = 250, maxCols = 50 } = {}) {
  const mod = await import('xlsx');
  const XLSX = mod.default ?? mod;
  const buf = await blob.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  if (!wb.SheetNames?.length) {
    throw new Error('В файле нет листов');
  }

  const sheets = wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
    const rows = (Array.isArray(raw) ? raw : []).slice(0, maxRows).map((row) => {
      const arr = Array.isArray(row) ? row : [row];
      return arr.slice(0, maxCols).map((cell) => {
        if (cell == null) return '';
        if (cell instanceof Date) return cell.toLocaleString('ru-RU');
        return String(cell);
      });
    });
    const totalRows = raw.length;
    const maxColInFile = raw.reduce((m, r) => Math.max(m, Array.isArray(r) ? r.length : 0), 0);
    const truncated = totalRows > maxRows || maxColInFile > maxCols;
    return { name, rows, truncated, totalRows, maxColInFile };
  });

  return { sheets };
}

export function isExcelLaborContract(mime, filename = '') {
  const m = (mime || '').toLowerCase();
  const n = (filename || '').toLowerCase();
  return (
    m.includes('spreadsheet')
    || m.includes('excel')
    || m === 'application/vnd.ms-excel'
    || /\.xlsx?$/.test(n)
  );
}
