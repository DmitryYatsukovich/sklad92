import { useState, useCallback, useEffect } from 'react';
import { attendance as attendanceApi } from '../api';
import { loadFaceModels, captureFaceDescriptor } from '../lib/faceClient';
import FaceCamera from '../components/FaceCamera';

export default function FaceCheckIn() {
  const [videoEl, setVideoEl] = useState(null);
  const [modelsOk, setModelsOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
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

  const registerSelf = async () => {
    if (!modelsOk) {
      setMsg('Загрузка моделей… Подождите.');
      return;
    }
    if (!videoEl) {
      setMsg('Камера ещё не готова. Разрешите доступ к камере и подождите пару секунд.');
      return;
    }
    setBusy(true);
    setMsg('');
    try {
      const d = await captureFaceDescriptor(videoEl);
      if (!d) {
        setMsg('Лицо не найдено в кадре. Освещение и положение лица.');
        return;
      }
      await attendanceApi.registerFace(d);
      setMsg('Шаблон лица сохранён для вашей учётной записи.');
    } catch (e) {
      setMsg(e.message || 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  const scan = async () => {
    if (!modelsOk) {
      setMsg('Загрузка моделей… Подождите.');
      return;
    }
    if (!videoEl) {
      setMsg('Камера ещё не готова. Разрешите доступ к камере и подождите пару секунд.');
      return;
    }
    setBusy(true);
    setMsg('');
    try {
      const d = await captureFaceDescriptor(videoEl);
      if (!d) {
        setMsg('Лицо не найдено в кадре.');
        return;
      }
      const r = await attendanceApi.scan(d);
      const name = r.user?.display_name || r.user?.login || '';
      if (r.action === 'check_in') {
        setMsg(`Приход зафиксирован: ${name}`);
      } else if (r.action === 'check_out') {
        setMsg(`Уход зафиксирован: ${name}`);
      }
      loadMy();
    } catch (e) {
      if (e.message?.includes('409') || e.message?.includes('уже')) {
        setMsg(e.message);
      } else {
        setMsg(e.message || 'Ошибка');
      }
    } finally {
      setBusy(false);
    }
  };

  const fmt = (iso) => {
    if (!iso) return '—';
    const x = new Date(iso);
    return x.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="page-title mb-1">Отметка по лицу</h2>
        <p className="text-slate-400 text-sm max-w-xl">
          Первое распознавание за день — приход, второе — уход. Сотрудник должен быть заранее добавлен с шаблоном лица (в профиле или администратором).
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-8">
        <div className="space-y-4">
          <FaceCamera onReady={onVideoReady} disabled={busy} />
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={scan}
              className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white font-medium"
            >
              Отметиться
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={registerSelf}
              className="px-4 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-sm"
            >
              Сохранить моё лицо
            </button>
          </div>
          {!modelsOk && <p className="text-slate-500 text-sm">Загрузка нейросети…</p>}
          {msg && <p className="text-slate-300 text-sm whitespace-pre-wrap">{msg}</p>}
        </div>

        <div>
          <h3 className="text-lg font-medium text-white mb-3">Мои посещения</h3>
          <div className="table-wrap">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-700 text-slate-400">
                  <th className="p-3">Дата</th>
                  <th className="p-3">Приход</th>
                  <th className="p-3">Уход</th>
                </tr>
              </thead>
              <tbody>
                {myRows.map((row) => (
                  <tr key={row.id} className="border-b border-slate-700/50">
                    <td className="p-3 text-slate-300">{row.visit_date}</td>
                    <td className="p-3 text-emerald-400">{fmt(row.check_in_at)}</td>
                    <td className="p-3 text-amber-400">{fmt(row.check_out_at)}</td>
                  </tr>
                ))}
                {myRows.length === 0 && (
                  <tr>
                    <td colSpan={3} className="p-6 text-center text-slate-500">
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
