import { useState, useEffect } from 'react';
import { reports } from '../api';

function formatDate(d) {
  const x = new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function Production({ user }) {
  const today = formatDate(new Date());
  const firstDay = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const [from, setFrom] = useState(formatDate(firstDay));
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    setError('');
    reports
      .production(from, to)
      .then(setRows)
      .catch((e) => {
        setError(e.message);
        setRows([]);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      reports.production(from, to)
        .then(setRows)
        .catch(() => {});
    }, 5000);
    return () => clearInterval(t);
  }, [from, to]);

  const byUser = {};
  rows.forEach((r) => {
    const key = r.user_id;
    if (!byUser[key]) {
      byUser[key] = { user_id: r.user_id, login: r.login, display_name: r.display_name, materials: [] };
    }
    byUser[key].materials.push({
      material_name: r.material_name,
      material_code: r.material_code,
      unit: r.unit,
      total_issued: parseFloat(r.total_issued),
      total_returned: parseFloat(r.total_returned),
      produced: parseFloat(r.produced),
    });
  });
  const userList = Object.values(byUser);

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-white">Выработка</h2>
      <p className="text-slate-400 text-sm">Сколько материалов взял каждый пользователь за период (с учётом возвратов).</p>

      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-sm text-slate-400 mb-1">Период с</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="px-4 py-2 rounded-xl bg-slate-800 border border-slate-600 text-white"
          />
        </div>
        <div>
          <label className="block text-sm text-slate-400 mb-1">по</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="px-4 py-2 rounded-xl bg-slate-800 border border-slate-600 text-white"
          />
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium disabled:opacity-50"
        >
          {loading ? 'Загрузка…' : 'Показать'}
        </button>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <div className="rounded-xl border border-slate-700/50 bg-surface-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-slate-700 text-slate-400 text-sm">
                <th className="p-4 font-medium">Пользователь</th>
                <th className="p-4 font-medium">Материал</th>
                <th className="p-4 font-medium">Выдано</th>
                <th className="p-4 font-medium">Возвращено</th>
                <th className="p-4 font-medium">Выработка</th>
              </tr>
            </thead>
            <tbody>
              {userList.map((u) =>
                u.materials.map((m, i) => (
                  <tr key={`${u.user_id}-${m.material_code}-${i}`} className="border-b border-slate-700/50 hover:bg-slate-800/30">
                    <td className="p-4 text-white">{i === 0 ? (u.display_name || u.login) : ''}</td>
                    <td className="p-4 text-white">{m.material_name} <span className="text-slate-500 font-mono text-sm">({m.material_code})</span></td>
                    <td className="p-4 text-slate-300">{m.total_issued} {m.unit}</td>
                    <td className="p-4 text-slate-400">{m.total_returned} {m.unit}</td>
                    <td className="p-4 font-medium text-brand-300">{m.produced} {m.unit}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {userList.length === 0 && !loading && (
          <p className="p-8 text-center text-slate-500">Нет данных за выбранный период</p>
        )}
      </div>
    </div>
  );
}
