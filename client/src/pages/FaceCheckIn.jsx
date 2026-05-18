import { useState, useCallback, useEffect } from 'react';
import { attendance as attendanceApi } from '../api';
import { loadFaceModels, captureFaceDescriptor, captureVideoFrameBlob } from '../lib/faceClient';
import FaceCamera from '../components/FaceCamera';

const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

function formatVisitDate(d) {
  if (!d) return '—';
  const s = String(d).slice(0, 10);
  const [y, m, day] = s.split('-').map((x) => parseInt(x, 10));
  if (!y || !m || !day) return s;
  return `${day} ${MONTHS_SHORT[m - 1]} ${y}`;
}

function formatTime(iso) {
  if (!iso) return '—';
  const x = new Date(iso);
  if (Number.isNaN(x.getTime())) return '—';
  return x.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function formatMsgTime(iso) {
  if (!iso) return '';
  return formatTime(iso);
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

export default function FaceCheckIn() {
  const [videoEl, setVideoEl] = useState(null);
  const [modelsOk, setModelsOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [msgKind, setMsgKind] = useState('');
  const [myRows, setMyRows] = useState([]);

  const loadMy = () =>
    attendanceApi.my(90).then(setMyRows).catch(() => {});

  useEffect(() => {
    loadMy();
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

  const registerSelf = async () => {
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
        setStatus('Лицо не найдено в кадре. Проверьте освещение.', 'error');
        return;
      }
      const blob = await captureVideoFrameBlob(videoEl);
      let faceImage;
      if (blob) {
        faceImage = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result);
          r.onerror = reject;
          r.readAsDataURL(blob);
        });
      }
      await attendanceApi.registerFace(d, null, faceImage);
      setStatus(
        faceImage
          ? 'Шаблон лица и фото сохранены. В профиле пользователя обновится картинка.'
          : 'Шаблон лица сохранён (фото не удалось снять — повторите).',
        'success',
      );
    } catch (e) {
      setStatus(e.message || 'Ошибка', 'error');
    } finally {
      setBusy(false);
    }
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
      loadMy();
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
            <button
              type="button"
              disabled={busy || !modelsOk}
              onClick={registerSelf}
              className="btn-secondary w-full sm:w-auto min-h-[2.25rem] text-sm px-4"
            >
              Сохранить моё лицо
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
          <h3 className="text-sm font-medium text-white mb-2">Мои посещения</h3>
          <div className="table-wrap">
            <table className="table-compact">
              <thead>
                <tr className="border-b border-white/10 text-zinc-400">
                  <th className="p-2 font-medium">Дата</th>
                  <th className="p-2 font-medium">Приход</th>
                  <th className="p-2 font-medium">Уход</th>
                  <th className="p-2 font-medium text-right">Отработано</th>
                </tr>
              </thead>
              <tbody>
                {myRows.map((row) => (
                  <tr key={row.id} className="border-b border-white/5 hover:bg-white/[0.02]">
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
                {myRows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="p-4 text-center text-zinc-500 text-xs">
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
