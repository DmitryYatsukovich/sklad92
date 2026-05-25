import { useState, useCallback, useEffect } from 'react';
import { attendance as attendanceApi } from '../api';
import { recordAction } from '../lib/actionLog';
import { loadFaceModels, captureFaceDescriptor } from '../lib/faceClient';
import FaceCamera from '../components/FaceCamera';

const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const TZ_MSK = 'Europe/Moscow';

/** Календарный день visit_date по Москве (не брать slice(0,10) у ISO — там UTC-день) */
function formatVisitDate(d) {
  if (d == null || d === '') return '—';
  const plain = String(d).match(/^(\d{4}-\d{2}-\d{2})$/);
  if (plain) {
    const [, ymd] = plain;
    const [y, m, day] = ymd.split('-').map((x) => parseInt(x, 10));
    if (y && m && day) return `${day} ${MONTHS_SHORT[m - 1]} ${y}`;
  }
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return '—';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ_MSK,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(x);
  const pick = (t) => parts.find((p) => p.type === t)?.value;
  const y = pick('year');
  const mo = pick('month');
  const day = pick('day');
  if (!y || !mo || !day) return '—';
  return `${parseInt(day, 10)} ${MONTHS_SHORT[parseInt(mo, 10) - 1]} ${y}`;
}

function formatTime(iso) {
  if (!iso) return '—';
  const x = new Date(iso);
  if (Number.isNaN(x.getTime())) return '—';
  return x.toLocaleTimeString('ru-RU', {
    timeZone: TZ_MSK,
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatMsgTime(iso) {
  if (!iso) return '';
  return formatTime(iso);
}

function employeeName(row) {
  if (row.display_name) return row.display_name;
  const parts = [row.last_name, row.first_name].filter(Boolean);
  if (parts.length) return parts.join(' ');
  return row.login || '—';
}

/** Разница между уходом и приходом */
function formatWorkedDuration(checkIn, checkOut) {
  if (!checkIn || !checkOut) return '—';
  const a = new Date(checkIn).getTime();
  const b = new Date(checkOut).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return '—';
  const totalMins = Math.floor((b - a) / 60000);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  if (h === 0) return `${m} мин`;
  if (m === 0) return `${h} ч`;
  return `${h} ч ${m} мин`;
}

export default function FaceCheckIn({ user }) {
  const isAdmin = user?.role === 'admin';
  const [videoEl, setVideoEl] = useState(null);
  const [modelsOk, setModelsOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [msgKind, setMsgKind] = useState('');
  const [visitRows, setVisitRows] = useState([]);

  const loadVisits = () =>
    attendanceApi.my(90).then(setVisitRows).catch(() => {});

  useEffect(() => {
    loadVisits();
  }, []);

  useEffect(() => {
    loadFaceModels()
      .then(() => setModelsOk(true))
      .catch((e) => setMsg(`Модели: ${e.message || e}`));
  }, []);

  const onVideoReady = useCallback((el) => {
    setVideoEl(el);
  }, []);

  const setStatus = (text, kind = '') => {
    setMsg(text);
    setMsgKind(kind);
  };

  const scan = async () => {
    if (!modelsOk) {
      setStatus('Загрузка моделей… Подождите.', 'info');
      return;
    }
    if (!videoEl) {
      setStatus('Дождитесь включения камеры.', 'info');
      return;
    }
    setBusy(true);
    setStatus('');
    try {
      const d = await captureFaceDescriptor(videoEl);
      if (!d) {
        setStatus('Лицо не найдено в кадре.', 'error');
        return;
      }
      const r = await attendanceApi.scan(d);
      const name = r.user?.display_name || r.user?.login || '';
      const tIn = formatMsgTime(r.record?.check_in_at);
      const tOut = formatMsgTime(r.record?.check_out_at);
      if (r.action === 'check_in') {
        setStatus(`Приход: ${name}${tIn ? ` · ${tIn}` : ''}`, 'success');
      } else if (r.action === 'check_out') {
        setStatus(`Уход: ${name}${tOut ? ` · ${tOut}` : ''}`, 'success');
      } else if (r.action === 'check_out_update') {
        setStatus(`Время ухода обновлено: ${name}${tOut ? ` · ${tOut}` : ''}`, 'success');
      }
      const actionMeta = {
        check_in: { kind: 'attendance_check_in', title: 'Приход (лицо)' },
        check_out: { kind: 'attendance_check_out', title: 'Уход (лицо)' },
        check_out_update: { kind: 'attendance_check_out', title: 'Обновление ухода (лицо)' },
      }[r.action] || { kind: 'attendance_check_in', title: 'Отметка по лицу' };
      recordAction({
        ...actionMeta,
        description: [name, formatVisitDate(r.record?.visit_date), tIn || tOut].filter(Boolean).join(' · '),
        payload: {
          user_id: r.user?.id,
          action: r.action,
          visit_date: r.record?.visit_date,
        },
      }, { synced: true }).catch(() => {});
      loadVisits();
    } catch (e) {
      setStatus(e.message || 'Ошибка', 'error');
    } finally {
      setBusy(false);
    }
  };

  const msgClass = msgKind === 'success'
    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
    : msgKind === 'error'
      ? 'border-red-500/40 bg-red-500/10 text-red-300'
      : 'border-white/10 bg-white/5 text-zinc-300';

  return (
    <div className="space-y-4 max-w-5xl">
      <div>
        <h2 className="page-title">Отметка по лицу</h2>
        <p className="page-subtitle">
          1-й скан — приход, 2-й — уход. Повторный скан в тот же день обновляет время ухода.
        </p>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,20rem)_1fr] gap-4 items-start">
        <div className="space-y-3">
          <FaceCamera onReady={onVideoReady} disabled={busy} />
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <button
              type="button"
              disabled={busy || !modelsOk}
              onClick={scan}
              className="btn-primary w-full sm:w-auto min-h-[2.25rem] text-sm px-4"
            >
              {busy ? 'Обработка…' : 'Отметиться'}
            </button>
          </div>
          {!modelsOk && (
            <p className="text-zinc-500 text-2xs">Загрузка нейросети…</p>
          )}
          {msg && (
            <p className={`text-xs rounded-lg border px-3 py-2 ${msgClass}`}>
              {msg}
            </p>
          )}
        </div>

        <div className="min-w-0">
          <h3 className="text-sm font-medium text-white mb-2">
            {isAdmin ? 'Посещения всех сотрудников' : 'Мои посещения'}
          </h3>
          <div className="table-wrap">
            <table className="table-compact">
              <thead>
                <tr className="border-b border-white/10 text-zinc-400">
                  {isAdmin && <th className="p-2 font-medium">Сотрудник</th>}
                  <th className="p-2 font-medium">Дата</th>
                  <th className="p-2 font-medium">Приход</th>
                  <th className="p-2 font-medium">Уход</th>
                  <th className="p-2 font-medium text-right">Отработано</th>
                </tr>
              </thead>
              <tbody>
                {visitRows.map((row) => (
                  <tr key={row.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                    {isAdmin && (
                      <td className="p-2 text-zinc-200 whitespace-nowrap">
                        {employeeName(row)}
                      </td>
                    )}
                    <td className="p-2 text-zinc-200 whitespace-nowrap font-medium">
                      {formatVisitDate(row.visit_date)}
                    </td>
                    <td className="p-2 text-emerald-400 tabular-nums whitespace-nowrap">
                      {formatTime(row.check_in_at)}
                    </td>
                    <td className="p-2 text-amber-400/90 tabular-nums whitespace-nowrap">
                      {formatTime(row.check_out_at)}
                    </td>
                    <td className="p-2 text-sky-300/90 tabular-nums whitespace-nowrap text-right font-medium">
                      {formatWorkedDuration(row.check_in_at, row.check_out_at)}
                    </td>
                  </tr>
                ))}
                {visitRows.length === 0 && (
                  <tr>
                    <td colSpan={isAdmin ? 5 : 4} className="p-4 text-center text-zinc-500 text-xs">
                      Нет записей
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
