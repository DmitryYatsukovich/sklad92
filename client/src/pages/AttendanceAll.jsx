import { useState, useEffect } from 'react';
import { attendance as attendanceApi } from '../api';

export default function AttendanceAll() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = () => {
    setLoading(true);
    attendanceApi
      .all(from || undefined, to || undefined)
      .then(setRows)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const apply = (e) => {
    e.preventDefault();
    load();
  };

  const fmt = (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const nameOf = (r) => r.display_name || [r.first_name, r.last_name].filter(Boolean).join(' ') || r.login;

  if (loading && rows.length === 0) return <div className="text-slate-400">Загрузка…</div>;

  return (
    <div className="space-y-6">
      <h2 className="page-title">Посещения сотрудников</h2>
      {error && <p className="text-red-400 text-sm">{error}</p>}

      <form onSubmit={apply} className="flex flex-wrap items-end gap-4">
        <div>
          <label className="label">С даты</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="px-3 py-2 rounded-xl bg-slate-800 border border-slate-600 text-white"
          />
        </div>
        <div>
          <label className="label">По дату</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="px-3 py-2 rounded-xl bg-slate-800 border border-slate-600 text-white"
          />
        </div>
        <button type="submit" className="btn-primary text-sm">
          Показать
        </button>
      </form>

      <div className="rounded-xl border border-slate-700/50 bg-surface-800 overflow-x-auto">
        <table className="w-full text-left text-sm min-w-[640px]">
          <thead>
            <tr className="border-b border-slate-700 text-slate-400">
              <th className="p-3">Сотрудник</th>
              <th className="p-3">Дата</th>
              <th className="p-3">Приход</th>
              <th className="p-3">Уход</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-slate-700/50 hover:bg-slate-800/30">
                <td className="p-3 text-white">{nameOf(row)}</td>
                <td className="p-3 text-slate-300">{row.visit_date}</td>
                <td className="p-3 text-emerald-400">{fmt(row.check_in_at)}</td>
                <td className="p-3 text-amber-400">{fmt(row.check_out_at)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="p-8 text-center text-slate-500">
                  Нет данных
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
