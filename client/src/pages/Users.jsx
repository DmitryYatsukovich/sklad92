import { useState, useEffect, useRef, useCallback } from 'react';
import { users as usersApi, roles as rolesApi } from '../api';
import FaceCamera from '../components/FaceCamera';
import { loadFaceModels, captureFaceDescriptor } from '../lib/faceClient';

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
  employment_org: '',
  internal_uid: '',
  phone: '',
  role: 'user',
  role_id: null,
  can_warehouse: true,
  can_issuance: true,
  can_production: true,
  can_users: false,
  can_attendance: false,
});

export default function Users({ user }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [listKey, setListKey] = useState(0);
  const [showCamera, setShowCamera] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [saving, setSaving] = useState(false);
  const [sortBy, setSortBy] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [filters, setFilters] = useState({ login: '', first_name: '', last_name: '', phone: '', role: '', snils: '', inn: '', employment_date: '', employment_org: '', internal_uid: '' });
  const [rolesList, setRolesList] = useState([]);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [faceEnrollCreate, setFaceEnrollCreate] = useState(false);
  const [pendingFaceDescriptor, setPendingFaceDescriptor] = useState(null);
  const [faceVideoEl, setFaceVideoEl] = useState(null);
  const [editFaceDescriptor, setEditFaceDescriptor] = useState(null);

  const load = () =>
    usersApi.list()
      .then((data) => { setList(data); setListKey((k) => k + 1); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));

  useEffect(() => {
    setLoading(true);
    load();
  }, []);

  useEffect(() => {
    const t = setInterval(() => usersApi.list().then((data) => { setList(data); setListKey((k) => k + 1); }).catch(() => {}), 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (user?.can_users) rolesApi.list().then(setRolesList).catch(() => {});
  }, [user?.can_users]);

  const onFaceVideoReady = useCallback((el) => {
    setFaceVideoEl(el);
  }, []);

  const applyRoleToForm = (roleId) => {
    if (!roleId) return;
    const r = rolesList.find((x) => x.id === roleId);
    if (!r) return;
    setForm((f) => ({
      ...f,
      role_id: roleId,
      can_warehouse: !!r.can_warehouse,
      can_issuance: !!r.can_issuance,
      can_production: !!r.can_production,
      can_users: !!r.can_users,
      can_attendance: !!r.can_attendance,
    }));
  };

  const openCreate = () => {
    setForm(emptyForm());
    setAvatarFile(null);
    setAvatarPreview(null);
    setFaceEnrollCreate(false);
    setPendingFaceDescriptor(null);
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
    setEditing(u.id);
    setAvatarFile(null);
    setAvatarPreview(null);
    setForm({
      first_name: u.first_name || '',
      last_name: u.last_name || '',
      login: u.login || '',
      password: '',
      birth_date: u.birth_date ? u.birth_date.slice(0, 10) : '',
      passport_number: u.passport_number || '',
      snils: u.snils || '',
      inn: u.inn || '',
      employment_date: u.employment_date ? u.employment_date.slice(0, 10) : '',
      employment_org: u.employment_org || '',
      internal_uid: u.internal_uid || '',
      phone: u.phone || '',
      role: u.role || 'user',
      role_id: u.role_id || null,
      can_warehouse: !!u.can_warehouse,
      can_issuance: !!u.can_issuance,
      can_production: !!u.can_production,
      can_users: !!u.can_users,
      can_attendance: !!u.can_attendance,
    });
    setEditFaceDescriptor(null);
    setError('');
  };

  const captureFaceTemplate = async () => {
    if (!faceVideoEl) return setError('Дождитесь включения камеры');
    setError('');
    try {
      await loadFaceModels();
      const d = await captureFaceDescriptor(faceVideoEl);
      if (!d) return setError('Лицо не найдено в кадре');
      setPendingFaceDescriptor(d);
    } catch (err) {
      setError(err.message || 'Ошибка распознавания');
    }
  };

  const captureEditFaceTemplate = async () => {
    if (!faceVideoEl) return setError('Дождитесь включения камеры');
    setError('');
    try {
      await loadFaceModels();
      const d = await captureFaceDescriptor(faceVideoEl);
      if (!d) return setError('Лицо не найдено в кадре');
      setEditFaceDescriptor(d);
    } catch (err) {
      setError(err.message || 'Ошибка распознавания');
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.login.trim() || !form.password) return setError('Укажите логин и пароль');
    if (faceEnrollCreate && (!pendingFaceDescriptor || pendingFaceDescriptor.length < 128)) {
      return setError('Отметьте «Зарегистрировать лицо» и снимите шаблон кнопкой «Снять шаблон»');
    }
    setError('');
    try {
      const payload = { ...form };
      if (pendingFaceDescriptor?.length >= 128) payload.face_descriptor = pendingFaceDescriptor;
      const created = await usersApi.create(payload);
      if (avatarFile) await usersApi.uploadAvatar(created.id, avatarFile);
      alert(`Пользователь «${created.login}» создан. Для входа нужен тот же пароль, что вы указали при создании.`);
      setShowCreate(false);
      setAvatarFile(null);
      setAvatarPreview(null);
      setFaceEnrollCreate(false);
      setPendingFaceDescriptor(null);
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
      const payload = { ...form };
      if (editFaceDescriptor?.length >= 128) payload.face_descriptor = editFaceDescriptor;
      await usersApi.update(editing, payload);
      if (avatarFile) await usersApi.uploadAvatar(editing, avatarFile);
      setEditing(null);
      setAvatarFile(null);
      setAvatarPreview(null);
      setEditFaceDescriptor(null);
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
        <label className="block text-sm text-slate-400 mb-1">Фотография</label>
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
            className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-sm"
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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm text-slate-400 mb-1">Имя</label>
          <input
            type="text"
            value={form.first_name}
            onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))}
            className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-slate-600 text-white"
          />
        </div>
        <div>
          <label className="block text-sm text-slate-400 mb-1">Фамилия</label>
          <input
            type="text"
            value={form.last_name}
            onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))}
            className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-slate-600 text-white"
          />
        </div>
      </div>
      <div>
        <label className="block text-sm text-slate-400 mb-1">Логин</label>
        <input
          type="text"
          value={form.login}
          onChange={(e) => setForm((f) => ({ ...f, login: e.target.value }))}
          className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-slate-600 text-white"
          required={!editing}
        />
      </div>
      <div>
        <label className="block text-sm text-slate-400 mb-1">Пароль</label>
        <input
          type="password"
          value={form.password}
          onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
          className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-slate-600 text-white"
          placeholder={editing ? 'Оставьте пустым, чтобы не менять' : ''}
          required={!editing}
        />
      </div>
      <div>
        <label className="block text-sm text-slate-400 mb-1">Дата рождения</label>
        <input
          type="date"
          value={form.birth_date}
          onChange={(e) => setForm((f) => ({ ...f, birth_date: e.target.value }))}
          className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-slate-600 text-white"
        />
      </div>
      <div>
        <label className="block text-sm text-slate-400 mb-1">Номер паспорта</label>
        <input
          type="text"
          value={form.passport_number}
          onChange={(e) => setForm((f) => ({ ...f, passport_number: e.target.value }))}
          className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-slate-600 text-white"
          placeholder="Серия и номер"
        />
      </div>
      <div>
        <label className="block text-sm text-slate-400 mb-1">СНИЛС</label>
        <input
          type="text"
          value={form.snils}
          onChange={(e) => setForm((f) => ({ ...f, snils: e.target.value }))}
          className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-slate-600 text-white"
          placeholder="XXX-XXX-XXX XX"
        />
      </div>
      <div>
        <label className="block text-sm text-slate-400 mb-1">Дата трудоустройства</label>
        <input
          type="date"
          value={form.employment_date}
          onChange={(e) => setForm((f) => ({ ...f, employment_date: e.target.value }))}
          className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-slate-600 text-white"
        />
      </div>
      <div>
        <label className="block text-sm text-slate-400 mb-1">Трудоустройство</label>
        <input
          type="text"
          value={form.employment_org}
          onChange={(e) => setForm((f) => ({ ...f, employment_org: e.target.value }))}
          className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-slate-600 text-white"
          placeholder="Организация"
        />
      </div>
      <div>
        <label className="block text-sm text-slate-400 mb-1">Внутр. номер (UID) для карты доступа</label>
        <input
          type="text"
          value={form.internal_uid}
          onChange={(e) => setForm((f) => ({ ...f, internal_uid: e.target.value }))}
          className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-slate-600 text-white"
          placeholder="Напр. 09820541"
        />
      </div>
      <div>
        <label className="block text-sm text-slate-400 mb-1">ИНН</label>
        <input
          type="text"
          value={form.inn}
          onChange={(e) => setForm((f) => ({ ...f, inn: e.target.value }))}
          className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-slate-600 text-white"
        />
      </div>
      <div>
        <label className="block text-sm text-slate-400 mb-1">Номер телефона</label>
        <input
          type="tel"
          value={form.phone}
          onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
          className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-slate-600 text-white"
          placeholder="+7 (999) 123-45-67"
        />
      </div>
      <div className="flex flex-wrap gap-4">
        {['can_warehouse', 'can_issuance', 'can_production', 'can_users', 'can_attendance'].map((key) => (
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
          </label>
        ))}
      </div>
    </>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-xl font-semibold text-white">Пользователи</h2>
        <button
          type="button"
          onClick={openCreate}
          className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium"
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

      <div className="rounded-xl border border-slate-700/50 bg-surface-800 overflow-hidden">
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
                  <td colSpan={12} className="p-8 text-center text-slate-500">
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
          <div className="bg-surface-800 rounded-2xl border border-slate-600 p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-medium text-white mb-4">Новый пользователь</h3>
            <form onSubmit={handleCreate} className="space-y-4">
              {formFields}
              <div className="border border-slate-600 rounded-xl p-4 space-y-3">
                <label className="flex items-center gap-2 text-slate-300 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={faceEnrollCreate}
                    onChange={(e) => {
                      setFaceEnrollCreate(e.target.checked);
                      if (!e.target.checked) setPendingFaceDescriptor(null);
                    }}
                    className="rounded border-slate-600 text-brand-600"
                  />
                  Зарегистрировать лицо (шаблон для отметки прихода/ухода)
                </label>
                {faceEnrollCreate && (
                  <div className="space-y-2">
                    <FaceCamera onReady={onFaceVideoReady} disabled={false} />
                    <button
                      type="button"
                      onClick={captureFaceTemplate}
                      className="px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-sm"
                    >
                      Снять шаблон
                    </button>
                    {pendingFaceDescriptor && <p className="text-emerald-400 text-sm">Шаблон готов</p>}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Системная роль</label>
                <select
                  value={form.role}
                  onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                  className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-slate-600 text-white"
                >
                  <option value="user">Пользователь</option>
                  <option value="admin">Администратор</option>
                </select>
              </div>
              {rolesList.length > 0 && (
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Роль (доступ к разделам)</label>
                  <select
                    value={form.role_id ?? ''}
                    onChange={(e) => {
                      const id = e.target.value ? parseInt(e.target.value, 10) : null;
                      if (id) applyRoleToForm(id);
                      else setForm((f) => ({ ...f, role_id: null }));
                    }}
                    className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-slate-600 text-white"
                  >
                    <option value="">— Без роли (индивидуальные права) —</option>
                    {rolesList.map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="flex gap-2 justify-end pt-2">
                <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-xl text-slate-400 hover:text-white">
                  Отмена
                </button>
                <button type="submit" className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white">
                  Создать
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-surface-800 rounded-2xl border border-slate-600 p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-medium text-white mb-4">Редактирование пользователя</h3>
            {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
            <form onSubmit={handleUpdate} className="space-y-4" noValidate>
              {formFields}
              <div className="border border-slate-600 rounded-xl p-4 space-y-3">
                <p className="text-sm text-slate-400">Новый шаблон лица (необязательно)</p>
                <FaceCamera onReady={onFaceVideoReady} disabled={false} />
                <button
                  type="button"
                  onClick={captureEditFaceTemplate}
                  className="px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-sm"
                >
                  Снять шаблон
                </button>
                {editFaceDescriptor && <p className="text-emerald-400 text-sm">Будет сохранён при «Сохранить»</p>}
              </div>
              {user.role === 'admin' && (
                <>
                  <div>
                    <label className="block text-sm text-slate-400 mb-1">Системная роль</label>
                    <select
                      value={form.role}
                      onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                      className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-slate-600 text-white"
                    >
                      <option value="user">Пользователь</option>
                      <option value="admin">Администратор</option>
                    </select>
                  </div>
                  {rolesList.length > 0 && (
                    <div>
                      <label className="block text-sm text-slate-400 mb-1">Роль (доступ к разделам)</label>
                      <select
                        value={form.role_id ?? ''}
                        onChange={(e) => {
                      const id = e.target.value ? parseInt(e.target.value, 10) : null;
                      if (id) applyRoleToForm(id);
                      else setForm((f) => ({ ...f, role_id: null }));
                    }}
                        className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-slate-600 text-white"
                      >
                        <option value="">— Без роли (индивидуальные права) —</option>
                        {rolesList.map((r) => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </>
              )}
              <div className="flex gap-2 justify-end pt-2">
                <button type="button" onClick={() => { setEditing(null); setError(''); }} className="px-4 py-2 rounded-xl text-slate-400 hover:text-white">
                  Отмена
                </button>
                <button type="submit" disabled={saving} className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-50">
                  {saving ? 'Сохранение…' : 'Сохранить'}
                </button>
              </div>
            </form>
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
              className="px-4 py-2 rounded-xl bg-slate-600 hover:bg-slate-500 text-white"
            >
              Отмена
            </button>
            {!cameraError && (
              <button
                type="button"
                onClick={capturePhoto}
                className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white"
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
