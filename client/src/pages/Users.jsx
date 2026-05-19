import { useState, useEffect, useRef, useCallback } from 'react';
import { users as usersApi, settings as settingsApi } from '../api';
import FaceCamera from '../components/FaceCamera';
import { loadFaceModels, captureFaceDescriptor, captureVideoFrameBlob } from '../lib/faceClient';

function buildUserPayload(form, extras = {}, { omitPassword } = {}) {
  const payload = {
    login: form.login,
    first_name: form.first_name,
    last_name: form.last_name,
    birth_date: form.birth_date || null,
    passport_number: form.passport_number,
    snils: form.snils,
    inn: form.inn,
    employment_date: form.employment_date || null,
    organization_id: form.organization_id || null,
    internal_uid: form.internal_uid,
    phone: form.phone,
    role: form.role,
    role_id: form.role_id,
    can_warehouse: form.can_warehouse,
    can_issuance: form.can_issuance,
    can_production: form.can_production,
    can_users: form.can_users,
    can_attendance: form.can_attendance,
    can_settings: form.can_settings,
    can_face: form.can_face,
    ...extras,
  };
  if (!omitPassword && form.password?.trim()) payload.password = form.password;
  return payload;
}

const emptyForm = () => ({
  first_name: '',
  last_name: '',
  login: '',
  password: '',
  birth_date: '',
  passport_number: '',
  snils: '',
  inn: '',
  employment_date: '',
  organization_id: '',
  internal_uid: '',
  phone: '',
  role: 'user',
  role_id: null,
  can_warehouse: true,
  can_issuance: true,
  can_production: true,
  can_users: false,
  can_attendance: false,
  can_settings: false,
  can_face: true,
});

export default function Users({ user, embedded = false }) {
  const [list, setList] = useState([]);
  const [organizations, setOrganizations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [listKey, setListKey] = useState(0);
  const [showCamera, setShowCamera] = useState(false);
  const [showFaceCamera, setShowFaceCamera] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [saving, setSaving] = useState(false);
  const [sortBy, setSortBy] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [filters, setFilters] = useState({ login: '', first_name: '', last_name: '', phone: '', role: '', snils: '', inn: '', employment_date: '', employment_org: '', internal_uid: '' });
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [pendingFaceDescriptor, setPendingFaceDescriptor] = useState(null);
  const [faceVideoEl, setFaceVideoEl] = useState(null);
  const [editFaceDescriptor, setEditFaceDescriptor] = useState(null);
  const [facePhotoFile, setFacePhotoFile] = useState(null);
  const [facePhotoPreview, setFacePhotoPreview] = useState(null);
  const [faceImageKey, setFaceImageKey] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [passwordSnapshot, setPasswordSnapshot] = useState('');

  const load = () =>
    usersApi.list()
      .then((data) => { setList(data); setListKey((k) => k + 1); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));

  useEffect(() => {
    setLoading(true);
    load();
    settingsApi.organizations.list().then(setOrganizations).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setInterval(() => usersApi.list().then((data) => { setList(data); setListKey((k) => k + 1); }).catch(() => {}), 5000);
    return () => clearInterval(t);
  }, []);

  const onFaceVideoReady = useCallback((el) => {
    setFaceVideoEl(el);
  }, []);

  const clearFacePhotoState = () => {
    if (facePhotoPreview) URL.revokeObjectURL(facePhotoPreview);
    setFacePhotoFile(null);
    setFacePhotoPreview(null);
  };

  const refreshOrganizations = () => {
    settingsApi.organizations.list().then(setOrganizations).catch(() => {});
  };

  const openCreate = () => {
    refreshOrganizations();
    setForm(emptyForm());
    setAvatarFile(null);
    setAvatarPreview(null);
    setPendingFaceDescriptor(null);
    setEditFaceDescriptor(null);
    clearFacePhotoState();
    setShowFaceCamera(false);
    setShowPassword(false);
    setPasswordSnapshot('');
    setShowCreate(true);
    setError('');
  };

  const onAvatarChange = (e) => {
    const file = e.target.files?.[0];
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    if (file) {
      setAvatarFile(file);
      setAvatarPreview(URL.createObjectURL(file));
    } else {
      setAvatarFile(null);
      setAvatarPreview(null);
    }
    e.target.value = '';
  };

  const setAvatarFromBlob = (blob) => {
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    const file = new File([blob], 'photo.jpg', { type: 'image/jpeg' });
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(blob));
  };

  const setVideoRef = (el) => {
    videoRef.current = el;
    if (el && streamRef.current) el.srcObject = streamRef.current;
  };

  useEffect(() => {
    if (!showCamera) return;
    setCameraError('');
    let stream = null;
    const tryGetUserMedia = (constraints) =>
      navigator.mediaDevices.getUserMedia(constraints).then((s) => {
        stream = s;
        streamRef.current = s;
        if (videoRef.current) videoRef.current.srcObject = s;
      });
    tryGetUserMedia({ video: { facingMode: 'environment' } })
      .catch(() => tryGetUserMedia({ video: { facingMode: 'user' } }))
      .catch(() => tryGetUserMedia({ video: true }))
      .catch((err) => {
        setCameraError(
          !window.isSecureContext
            ? 'Камера требует HTTPS. Откройте приложение по защищённой ссылке.'
            : 'Не удалось получить доступ к камере. Проверьте разрешения в настройках браузера.'
        );
      });
    return () => {
      if (stream) stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [showCamera]);

  const capturePhoto = () => {
    const video = videoRef.current;
    if (!video || video.readyState !== 4) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (blob) {
        setAvatarFromBlob(blob);
        setShowCamera(false);
      }
    }, 'image/jpeg', 0.9);
  };

  const openEdit = (u) => {
    refreshOrganizations();
    setEditing(u.id);
    setAvatarFile(null);
    setAvatarPreview(null);
    setForm({
      first_name: u.first_name || '',
      last_name: u.last_name || '',
      login: u.login || '',
      password: u.password_plain || '',
      birth_date: u.birth_date ? u.birth_date.slice(0, 10) : '',
      passport_number: u.passport_number || '',
      snils: u.snils || '',
      inn: u.inn || '',
      employment_date: u.employment_date ? u.employment_date.slice(0, 10) : '',
      organization_id: u.organization_id ? String(u.organization_id) : '',
      internal_uid: u.internal_uid || '',
      phone: u.phone || '',
      role: u.role || 'user',
      role_id: u.role_id || null,
      can_warehouse: !!u.can_warehouse,
      can_issuance: !!u.can_issuance,
      can_production: !!u.can_production,
      can_users: !!u.can_users,
      can_attendance: !!u.can_attendance,
      can_settings: !!u.can_settings,
      can_face: !!u.can_face,
    });
    setEditFaceDescriptor(null);
    clearFacePhotoState();
    setShowFaceCamera(false);
    setPasswordSnapshot(u.password_plain || '');
    setShowPassword(true);
    setFaceImageKey(Date.now());
    setError('');
  };

  const applyFaceCapture = async (descriptor, blob) => {
    if (showCreate) {
      setPendingFaceDescriptor(descriptor);
      setEditFaceDescriptor(null);
    } else {
      setEditFaceDescriptor(descriptor);
      setPendingFaceDescriptor(null);
    }
    if (blob) {
      clearFacePhotoState();
      setFacePhotoFile(new File([blob], 'face.jpg', { type: 'image/jpeg' }));
      setFacePhotoPreview(URL.createObjectURL(blob));
    }
    setForm((f) => ({ ...f, can_face: true }));
    setShowFaceCamera(false);
  };

  const captureFaceTemplate = async () => {
    if (!faceVideoEl) return setError('Дождитесь включения камеры');
    setError('');
    try {
      await loadFaceModels();
      const d = await captureFaceDescriptor(faceVideoEl);
      if (!d) return setError('Лицо не найдено в кадре');
      const blob = await captureVideoFrameBlob(faceVideoEl);
      await applyFaceCapture(d, blob);
    } catch (err) {
      setError(err.message || 'Ошибка распознавания');
    }
  };

  const editingUser = editing ? list.find((x) => x.id === editing) : null;
  const hasFaceTemplate = showCreate
    ? pendingFaceDescriptor?.length >= 128
    : !!(editingUser?.has_face || editFaceDescriptor?.length >= 128);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.login.trim() || !form.password) return setError('Укажите логин и пароль');
    setError('');
    try {
      const extras = {};
      if (pendingFaceDescriptor?.length >= 128) {
        extras.face_descriptor = pendingFaceDescriptor;
      }
      const payload = buildUserPayload(form, extras);
      const created = await usersApi.create(payload);
      if (avatarFile) await usersApi.uploadAvatar(created.id, avatarFile);
      if (facePhotoFile) await usersApi.uploadFacePhoto(created.id, facePhotoFile);
      alert(`Пользователь «${created.login}» создан. Для входа нужен тот же пароль, что вы указали при создании.`);
      setShowCreate(false);
      setAvatarFile(null);
      setAvatarPreview(null);
      setPendingFaceDescriptor(null);
      clearFacePhotoState();
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleUpdate = async (e) => {
    e.preventDefault();
    if (!editing || saving) return;
    if (!form.login?.trim()) {
      setError('Укажите логин');
      return;
    }
    setError('');
    setSaving(true);
    try {
      const extras = {};
      if (editFaceDescriptor?.length >= 128) {
        extras.face_descriptor = editFaceDescriptor;
      }
      const passwordChanged = form.password !== passwordSnapshot;
      const payload = buildUserPayload(form, extras, { omitPassword: !passwordChanged });
      await usersApi.update(editing, payload);
      if (avatarFile) await usersApi.uploadAvatar(editing, avatarFile);
      if (facePhotoFile) await usersApi.uploadFacePhoto(editing, facePhotoFile);
      setEditing(null);
      setAvatarFile(null);
      setAvatarPreview(null);
      setEditFaceDescriptor(null);
      clearFacePhotoState();
      if (passwordChanged && form.password) setPasswordSnapshot(form.password);
      setFaceImageKey(Date.now());
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Удалить пользователя?')) return;
    try {
      await usersApi.delete(id);
      setEditing(null);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const filteredList = list.filter((u) => {
    if (filters.login && !(u.login || '').toLowerCase().includes(filters.login.toLowerCase())) return false;
    if (filters.first_name && !(u.first_name || '').toLowerCase().includes(filters.first_name.toLowerCase())) return false;
    if (filters.last_name && !(u.last_name || '').toLowerCase().includes(filters.last_name.toLowerCase())) return false;
    if (filters.phone && !(u.phone || '').replace(/\D/g, '').includes(filters.phone.replace(/\D/g, ''))) return false;
    if (filters.role === 'admin' && u.role !== 'admin') return false;
    if (filters.role === 'user' && u.role !== 'user') return false;
    if (filters.snils && !(u.snils || '').replace(/\D/g, '').includes(filters.snils.replace(/\D/g, ''))) return false;
    if (filters.inn && !(u.inn || '').replace(/\D/g, '').includes(filters.inn.replace(/\D/g, ''))) return false;
    if (filters.employment_date && !(u.employment_date || '').startsWith(filters.employment_date)) return false;
    if (filters.employment_org && !(u.employment_org || '').toLowerCase().includes(filters.employment_org.toLowerCase())) return false;
    if (filters.internal_uid && !(u.internal_uid || '').replace(/\D/g, '').includes((filters.internal_uid || '').replace(/\D/g, ''))) return false;
    return true;
  });

  const sortedList = [...filteredList].sort((a, b) => {
    if (!sortBy) return 0;
    let va = a[sortBy] ?? '';
    let vb = b[sortBy] ?? '';
    if (typeof va === 'boolean') va = va ? 1 : 0;
    if (typeof vb === 'boolean') vb = vb ? 1 : 0;
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    const cmp = va < vb ? -1 : va > vb ? 1 : 0;
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const toggleSort = (col) => {
    if (sortBy === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(col); setSortDir('asc'); }
  };

  const SortIcon = ({ column }) => {
    if (sortBy !== column) return <span className="opacity-30">↕</span>;
    return sortDir === 'asc' ? <span>↑</span> : <span>↓</span>;
  };

  if (loading) return <div className="text-slate-400">Загрузка…</div>;

  const formFields = (
    <>
      <div>
        <label className="label">Фотография</label>
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="avatar-file" className="cursor-pointer px-4 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-white text-sm inline-block">
            Загрузить из файла
          </label>
          <input
            id="avatar-file"
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onAvatarChange}
          />
          <button
            type="button"
            onClick={() => setShowCamera(true)}
            className="btn-primary text-sm"
          >
            Снять фото
          </button>
          {(avatarPreview || (editing && list.find((x) => x.id === editing)?.avatar)) && (
            <div className="relative">
              <img
                src={avatarPreview || (editing ? `${usersApi.avatarUrl(editing)}?k=${listKey}` : '')}
                alt=""
                className="w-20 h-20 rounded-full object-cover border-2 border-slate-600"
              />
            </div>
          )}
        </div>
      </div>
      <div className="border border-white/10 rounded-xl p-4 space-y-3 bg-white/[0.02]">
        <div>
          <label className="label">Лицо для отметки</label>
          <p className="text-2xs text-slate-400 mt-0.5">
            Шаблон необязателен при сохранении. Для отметки по лицу запишите его кнопкой ниже.
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-4">
          {(facePhotoPreview || (editing && editingUser?.has_face)) && (
            <img
              src={
                facePhotoPreview
                || (editing ? `${usersApi.facePhotoUrl(editing)}?k=${faceImageKey}` : '')
              }
              alt="Шаблон лица"
              className="w-28 h-28 rounded-xl object-cover border-2 border-emerald-500/60 shrink-0"
              onError={(e) => {
                if (editing && editingUser?.avatar) {
                  e.currentTarget.src = `${usersApi.avatarUrl(editing)}?k=${listKey}`;
                } else {
                  e.currentTarget.style.display = 'none';
                }
              }}
            />
          )}
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => { setError(''); setShowFaceCamera(true); }}
              className="btn-primary text-sm"
            >
              Записать шаблон
            </button>
            {hasFaceTemplate && (
              <p className="text-emerald-400 text-sm">Шаблон записан</p>
            )}
            {editing && editingUser?.has_face && !editFaceDescriptor && (
              <p className="text-slate-500 text-2xs">Сохранённый шаблон используется. Нажмите «Записать шаблон», чтобы обновить.</p>
            )}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="label">Имя</label>
          <input
            type="text"
            value={form.first_name}
            onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))}
            className="input"
          />
        </div>
        <div>
          <label className="label">Фамилия</label>
          <input
            type="text"
            value={form.last_name}
            onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))}
            className="input"
          />
        </div>
      </div>
      <div>
        <label className="label">Логин</label>
        <input
          type="text"
          value={form.login}
          onChange={(e) => setForm((f) => ({ ...f, login: e.target.value }))}
          className="input"
          required={!editing}
        />
      </div>
      <div>
        <label className="label">Пароль</label>
        <div className="flex gap-2">
          <input
            type={showPassword ? 'text' : 'password'}
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            className="input flex-1"
            placeholder={editing ? 'Введите пароль' : ''}
            required={!editing}
            autoComplete={editing ? 'off' : 'new-password'}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="btn-secondary text-xs shrink-0 px-3"
          >
            {showPassword ? 'Скрыть' : 'Показать'}
          </button>
        </div>
        {editing && !passwordSnapshot && (
          <p className="text-2xs text-zinc-500 mt-1">Пароль не был сохранён в открытом виде — задайте новый.</p>
        )}
      </div>
      <div>
        <label className="label">Дата рождения</label>
        <input
          type="date"
          value={form.birth_date}
          onChange={(e) => setForm((f) => ({ ...f, birth_date: e.target.value }))}
          className="input"
        />
      </div>
      <div>
        <label className="label">Номер паспорта</label>
        <input
          type="text"
          value={form.passport_number}
          onChange={(e) => setForm((f) => ({ ...f, passport_number: e.target.value }))}
          className="input"
          placeholder="Серия и номер"
        />
      </div>
      <div>
        <label className="label">СНИЛС</label>
        <input
          type="text"
          value={form.snils}
          onChange={(e) => setForm((f) => ({ ...f, snils: e.target.value }))}
          className="input"
          placeholder="XXX-XXX-XXX XX"
        />
      </div>
      <div>
        <label className="label">Дата трудоустройства</label>
        <input
          type="date"
          value={form.employment_date}
          onChange={(e) => setForm((f) => ({ ...f, employment_date: e.target.value }))}
          className="input"
        />
      </div>
      <div>
        <label className="label">Трудоустройство</label>
        <select
          value={form.organization_id}
          onChange={(e) => setForm((f) => ({ ...f, organization_id: e.target.value }))}
          className="input"
        >
          <option value="">— Не выбрано —</option>
          {organizations.map((o) => (
            <option key={o.id} value={String(o.id)}>{o.name}</option>
          ))}
        </select>
        {!organizations.length && (
          <p className="text-zinc-500 text-xs mt-1">Добавьте организации в Настройках → Организации</p>
        )}
      </div>
      <div>
        <label className="label">Внутр. номер (UID) для карты доступа</label>
        <input
          type="text"
          value={form.internal_uid}
          onChange={(e) => setForm((f) => ({ ...f, internal_uid: e.target.value }))}
          className="input"
          placeholder="Напр. 09820541"
        />
      </div>
      <div>
        <label className="label">ИНН</label>
        <input
          type="text"
          value={form.inn}
          onChange={(e) => setForm((f) => ({ ...f, inn: e.target.value }))}
          className="input"
        />
      </div>
      <div>
        <label className="label">Номер телефона</label>
        <input
          type="tel"
          value={form.phone}
          onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
          className="input"
          placeholder="+7 (999) 123-45-67"
        />
      </div>
      <div className="flex flex-wrap gap-4">
        {['can_warehouse', 'can_issuance', 'can_production', 'can_users', 'can_attendance', 'can_settings', 'can_face'].map((key) => (
          <label key={key} className="flex items-center gap-2 text-slate-300 text-sm">
            <input
              type="checkbox"
              checked={form[key]}
              onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.checked }))}
              className="rounded border-slate-600 text-brand-600 focus:ring-brand-500"
            />
            {key === 'can_warehouse' && 'Склад'}
            {key === 'can_issuance' && 'Выдача'}
            {key === 'can_production' && 'Выработка'}
            {key === 'can_users' && 'Пользователи'}
            {key === 'can_attendance' && 'Журнал посещений'}
            {key === 'can_settings' && 'Настройка'}
            {key === 'can_face' && 'Отметка'}
          </label>
        ))}
      </div>
    </>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        {!embedded && <h2 className="page-title">Пользователи</h2>}
        {embedded && <h3 className="text-white font-medium text-lg">Пользователи</h3>}
        <button
          type="button"
          onClick={openCreate}
          className="btn-primary text-sm font-medium"
        >
          Добавить пользователя
        </button>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {(filters.login || filters.first_name || filters.last_name || filters.phone || filters.role || filters.snils || filters.inn || filters.employment_date || filters.employment_org || filters.internal_uid) && (
        <p className="text-slate-400 text-sm">
          Показано {sortedList.length} из {list.length} пользователей
        </p>
      )}

      <div className="table-wrap">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-slate-700 text-slate-400 text-sm">
                <th className="p-4 font-medium w-14">Фото</th>
                <th className="p-4 font-medium w-12" title="Шаблон лица для отметки">Лицо</th>
                <th className="p-4 font-medium">
                  <button type="button" onClick={() => toggleSort('login')} className="flex items-center gap-1 hover:text-white">
                    Логин <SortIcon column="login" />
                  </button>
                </th>
                <th className="p-4 font-medium">
                  <button type="button" onClick={() => toggleSort('first_name')} className="flex items-center gap-1 hover:text-white">
                    Имя <SortIcon column="first_name" />
                  </button>
                </th>
                <th className="p-4 font-medium">
                  <button type="button" onClick={() => toggleSort('last_name')} className="flex items-center gap-1 hover:text-white">
                    Фамилия <SortIcon column="last_name" />
                  </button>
                </th>
                <th className="p-4 font-medium">
                  <button type="button" onClick={() => toggleSort('phone')} className="flex items-center gap-1 hover:text-white">
                    Телефон <SortIcon column="phone" />
                  </button>
                </th>
                <th className="p-4 font-medium">
                  <button type="button" onClick={() => toggleSort('role')} className="flex items-center gap-1 hover:text-white">
                    Роль <SortIcon column="role" />
                  </button>
                </th>
                <th className="p-4 font-medium">
                  <button type="button" onClick={() => toggleSort('snils')} className="flex items-center gap-1 hover:text-white">
                    СНИЛС <SortIcon column="snils" />
                  </button>
                </th>
                <th className="p-4 font-medium">
                  <button type="button" onClick={() => toggleSort('inn')} className="flex items-center gap-1 hover:text-white">
                    ИНН <SortIcon column="inn" />
                  </button>
                </th>
                <th className="p-4 font-medium">
                  <button type="button" onClick={() => toggleSort('employment_date')} className="flex items-center gap-1 hover:text-white">
                    Дата труд. <SortIcon column="employment_date" />
                  </button>
                </th>
                <th className="p-4 font-medium">
                  <button type="button" onClick={() => toggleSort('employment_org')} className="flex items-center gap-1 hover:text-white">
                    Трудоустройство <SortIcon column="employment_org" />
                  </button>
                </th>
                <th className="p-4 font-medium">
                  <button type="button" onClick={() => toggleSort('internal_uid')} className="flex items-center gap-1 hover:text-white">
                    UID <SortIcon column="internal_uid" />
                  </button>
                </th>
                <th className="p-4 font-medium w-24">Действия</th>
              </tr>
              <tr className="border-b border-slate-700/50 bg-slate-800/50 text-slate-400 text-sm">
                <th className="p-2 w-14" />
                <th className="p-2 w-12" />
                <th className="p-2">
                  <input
                    type="text"
                    value={filters.login}
                    onChange={(e) => setFilters((f) => ({ ...f, login: e.target.value }))}
                    placeholder="Фильтр..."
                    className="w-full px-2 py-1 rounded bg-slate-800 border border-slate-600 text-white text-xs placeholder-slate-500"
                  />
                </th>
                <th className="p-2">
                  <input
                    type="text"
                    value={filters.first_name}
                    onChange={(e) => setFilters((f) => ({ ...f, first_name: e.target.value }))}
                    placeholder="Фильтр..."
                    className="w-full px-2 py-1 rounded bg-slate-800 border border-slate-600 text-white text-xs placeholder-slate-500"
                  />
                </th>
                <th className="p-2">
                  <input
                    type="text"
                    value={filters.last_name}
                    onChange={(e) => setFilters((f) => ({ ...f, last_name: e.target.value }))}
                    placeholder="Фильтр..."
                    className="w-full px-2 py-1 rounded bg-slate-800 border border-slate-600 text-white text-xs placeholder-slate-500"
                  />
                </th>
                <th className="p-2">
                  <input
                    type="text"
                    value={filters.phone}
                    onChange={(e) => setFilters((f) => ({ ...f, phone: e.target.value }))}
                    placeholder="Фильтр..."
                    className="w-full px-2 py-1 rounded bg-slate-800 border border-slate-600 text-white text-xs placeholder-slate-500"
                  />
                </th>
                <th className="p-2" />
                <th className="p-2">
                  <select
                    value={filters.role}
                    onChange={(e) => setFilters((f) => ({ ...f, role: e.target.value }))}
                    className="w-full px-2 py-1 rounded bg-slate-800 border border-slate-600 text-white text-xs"
                  >
                    <option value="">Все</option>
                    <option value="admin">Админ</option>
                    <option value="user">Пользователь</option>
                  </select>
                </th>
                <th className="p-2">
                  <input
                    type="text"
                    value={filters.snils}
                    onChange={(e) => setFilters((f) => ({ ...f, snils: e.target.value }))}
                    placeholder="Фильтр..."
                    className="w-full px-2 py-1 rounded bg-slate-800 border border-slate-600 text-white text-xs placeholder-slate-500"
                  />
                </th>
                <th className="p-2">
                  <input
                    type="text"
                    value={filters.inn}
                    onChange={(e) => setFilters((f) => ({ ...f, inn: e.target.value }))}
                    placeholder="Фильтр..."
                    className="w-full px-2 py-1 rounded bg-slate-800 border border-slate-600 text-white text-xs placeholder-slate-500"
                  />
                </th>
                <th className="p-2">
                  <input
                    type="text"
                    value={filters.employment_date || ''}
                    onChange={(e) => setFilters((f) => ({ ...f, employment_date: e.target.value }))}
                    placeholder="Фильтр..."
                    className="w-full px-2 py-1 rounded bg-slate-800 border border-slate-600 text-white text-xs placeholder-slate-500"
                  />
                </th>
                <th className="p-2">
                  <input
                    type="text"
                    value={filters.employment_org || ''}
                    onChange={(e) => setFilters((f) => ({ ...f, employment_org: e.target.value }))}
                    placeholder="Фильтр..."
                    className="w-full px-2 py-1 rounded bg-slate-800 border border-slate-600 text-white text-xs placeholder-slate-500"
                  />
                </th>
                <th className="p-2">
                  <input
                    type="text"
                    value={filters.internal_uid || ''}
                    onChange={(e) => setFilters((f) => ({ ...f, internal_uid: e.target.value }))}
                    placeholder="Фильтр..."
                    className="w-full px-2 py-1 rounded bg-slate-800 border border-slate-600 text-white text-xs placeholder-slate-500"
                  />
                </th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {sortedList.map((u) => (
                <tr key={u.id} className="border-b border-slate-700/50 hover:bg-slate-800/30">
                  <td className="p-4">
                    {u.avatar ? (
                      <img src={`${usersApi.avatarUrl(u.id)}?k=${listKey}`} alt="" className="w-10 h-10 rounded-full object-cover border border-slate-600" />
                    ) : (
                      <span className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center text-slate-500 text-xs">—</span>
                    )}
                  </td>
                  <td className="p-4 text-center text-lg" title={u.has_face ? 'Шаблон лица сохранён' : 'Нет шаблона'}>
                    {u.has_face ? <span className="text-emerald-400">✓</span> : <span className="text-slate-600">—</span>}
                  </td>
                  <td className="p-4 font-mono text-white">{u.login}</td>
                  <td className="p-4 text-slate-300">{u.first_name || '—'}</td>
                  <td className="p-4 text-slate-300">{u.last_name || '—'}</td>
                  <td className="p-4 text-slate-400">{u.phone || '—'}</td>
                  <td className="p-4">
                    <span className={u.role === 'admin' ? 'text-amber-400' : 'text-slate-400'}>{u.role === 'admin' ? 'Админ' : 'Пользователь'}</span>
                  </td>
                  <td className="p-4 text-slate-400">{u.snils || '—'}</td>
                  <td className="p-4 text-slate-400">{u.inn || '—'}</td>
                  <td className="p-4 text-slate-400">{u.employment_date ? u.employment_date.slice(0, 10) : '—'}</td>
                  <td className="p-4 text-slate-400">{u.employment_org || '—'}</td>
                  <td className="p-4 font-mono text-slate-400">{u.internal_uid || '—'}</td>
                  <td className="p-4">
                    {editing === u.id ? (
                      <span className="text-brand-400 text-sm">Редактирование</span>
                    ) : (
                      <button type="button" onClick={() => openEdit(u)} className="text-brand-400 hover:text-brand-300 text-sm">
                        Редактировать
                      </button>
                    )}
                    {u.id !== user.id && (
                      <button type="button" onClick={() => handleDelete(u.id)} className="ml-2 text-red-400 hover:text-red-300 text-sm">
                        Удалить
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {sortedList.length === 0 && (
                <tr>
                  <td colSpan={14} className="p-8 text-center text-slate-500">
                    {list.length === 0 ? 'Нет пользователей' : 'Нет данных по выбранным фильтрам'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="card p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-medium text-white mb-4">Новый пользователь</h3>
            <form onSubmit={handleCreate} className="space-y-4">
              {formFields}
              <div>
                <label className="label">Системная роль</label>
                <select
                  value={form.role}
                  onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                  className="input"
                >
                  <option value="user">Пользователь</option>
                  <option value="admin">Администратор</option>
                </select>
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button type="button" onClick={() => { setShowCreate(false); setShowFaceCamera(false); setFaceVideoEl(null); }} className="px-4 py-2 rounded-xl text-slate-400 hover:text-white">
                  Отмена
                </button>
                <button type="submit" className="btn-primary">
                  Создать
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="card p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-medium text-white mb-4">Редактирование пользователя</h3>
            {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
            <form onSubmit={handleUpdate} className="space-y-4" noValidate>
              {formFields}
              {user.role === 'admin' && (
                <>
                  <div>
                    <label className="label">Системная роль</label>
                    <select
                      value={form.role}
                      onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                      className="input"
                    >
                      <option value="user">Пользователь</option>
                      <option value="admin">Администратор</option>
                    </select>
                  </div>
                </>
              )}
              <div className="flex gap-2 justify-end pt-2">
                <button type="button" onClick={() => { setEditing(null); setShowFaceCamera(false); setFaceVideoEl(null); setError(''); }} className="px-4 py-2 rounded-xl text-slate-400 hover:text-white">
                  Отмена
                </button>
                <button type="submit" disabled={saving} className="btn-primary disabled:opacity-50">
                  {saving ? 'Сохранение…' : 'Сохранить'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showFaceCamera && (
        <div className="fixed inset-0 z-[60] bg-black flex flex-col items-center justify-center p-4">
          <h3 className="text-lg font-medium text-white mb-4">Записать шаблон лица</h3>
          <div className="w-full max-w-md">
            <FaceCamera onReady={onFaceVideoReady} disabled={false} />
          </div>
          <div className="flex gap-3 mt-4">
            <button
              type="button"
              onClick={() => { setShowFaceCamera(false); setFaceVideoEl(null); }}
              className="btn-secondary"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={captureFaceTemplate}
              className="btn-primary"
            >
              Снять шаблон
            </button>
          </div>
        </div>
      )}

      {showCamera && (
        <div className="fixed inset-0 z-[60] bg-black flex flex-col items-center justify-center p-4">
          <h3 className="text-lg font-medium text-white mb-4">Снять фото</h3>
          {cameraError ? (
            <p className="text-red-400 text-sm text-center mb-4 max-w-sm">{cameraError}</p>
          ) : (
            <video
              ref={setVideoRef}
              autoPlay
              playsInline
              muted
              className="max-w-full max-h-[60vh] rounded-xl bg-black object-contain w-full"
            />
          )}
          <div className="flex gap-3 mt-4">
            <button
              type="button"
              onClick={() => { setShowCamera(false); setCameraError(''); }}
              className="btn-secondary"
            >
              Отмена
            </button>
            {!cameraError && (
              <button
                type="button"
                onClick={capturePhoto}
                className="btn-primary"
              >
                Сделать снимок
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
