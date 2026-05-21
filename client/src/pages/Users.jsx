import { useState, useEffect, useRef, useCallback } from 'react';
import { users as usersApi, roles as rolesApi, settings as settingsApi } from '../api';
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
    role_id: form.role_id || null,
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
  role_id: '',
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
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importConfirm, setImportConfirm] = useState(null);
  const [importPreviewing, setImportPreviewing] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef(null);
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
  const [faceTemplateModal, setFaceTemplateModal] = useState(null);
  const [faceSaving, setFaceSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [passwordSnapshot, setPasswordSnapshot] = useState('');
  const [roles, setRoles] = useState([]);

  const loadRoles = useCallback(() => {
    rolesApi.list().then(setRoles).catch(() => setRoles([]));
  }, []);

  const load = () =>
    usersApi.list()
      .then((data) => { setList(data); setListKey((k) => k + 1); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));

  useEffect(() => {
    setLoading(true);
    load();
    loadRoles();
    settingsApi.organizations.list().then(setOrganizations).catch(() => {});
  }, [loadRoles]);

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
    loadRoles();
    const defaultRole = roles.find((r) => r.name === 'Пользователь') || roles[0];
    setForm({ ...emptyForm(), role_id: defaultRole ? String(defaultRole.id) : '' });
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

  const setProfilePhotosFromBlob = (blob) => {
    if (!blob) return;
    setAvatarFromBlob(blob);
    if (facePhotoPreview) URL.revokeObjectURL(facePhotoPreview);
    const file = new File([blob], 'face.jpg', { type: 'image/jpeg' });
    setFacePhotoFile(file);
    setFacePhotoPreview(URL.createObjectURL(blob));
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
    loadRoles();
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
      role_id: u.role_id ? String(u.role_id) : '',
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
    setShowFaceCamera(false);
    setFaceVideoEl(null);

    const userId = faceTemplateModal?.id ?? editing;

    if (userId) {
      setFaceSaving(true);
      setError('');
      try {
        await usersApi.update(userId, { face_descriptor: descriptor });
        if (blob) {
          const file = new File([blob], 'face.jpg', { type: 'image/jpeg' });
          await Promise.all([
            usersApi.uploadFacePhoto(userId, file),
            usersApi.uploadAvatar(userId, file),
          ]);
          setProfilePhotosFromBlob(blob);
        }
        setEditFaceDescriptor(descriptor);
        setPendingFaceDescriptor(null);
        setFaceImageKey(Date.now());
        setListKey((k) => k + 1);
        load();
        setFaceTemplateModal((m) => (m ? { ...m, has_face: true, has_face_photo: !!blob } : m));
      } catch (err) {
        setError(err.message);
      } finally {
        setFaceSaving(false);
      }
      return;
    }

    setPendingFaceDescriptor(descriptor);
    setEditFaceDescriptor(null);
    if (blob) setProfilePhotosFromBlob(blob);
    setFaceTemplateModal((m) => (m ? { ...m, has_face: true, isDraft: true } : m));
  };

  const editingUser = editing ? list.find((x) => x.id === editing) : null;

  const openFaceTemplateModal = (u) => {
    if (u?.id != null) {
      setFaceTemplateModal({
        id: u.id,
        login: u.login,
        name: [u.first_name, u.last_name].filter(Boolean).join(' '),
        has_face: !!u.has_face || (editing === u.id && editFaceDescriptor?.length >= 128),
        has_face_photo: !!u.has_face_photo || (editing === u.id && !!facePhotoPreview),
      });
    } else if (showCreate) {
      setFaceTemplateModal({
        id: null,
        login: form.login || 'новый пользователь',
        name: [form.first_name, form.last_name].filter(Boolean).join(' '),
        has_face: pendingFaceDescriptor?.length >= 128,
        isDraft: true,
      });
    } else if (editing && editingUser) {
      setFaceTemplateModal({
        id: editingUser.id,
        login: editingUser.login,
        name: [editingUser.first_name, editingUser.last_name].filter(Boolean).join(' '),
        has_face: !!editingUser.has_face || editFaceDescriptor?.length >= 128,
        has_face_photo: !!editingUser.has_face_photo || !!facePhotoPreview,
      });
    }
    setError('');
  };

  const closeFaceTemplateModal = () => {
    if (!faceSaving) setFaceTemplateModal(null);
  };

  const handleDeleteFaceTemplate = async () => {
    const userId = faceTemplateModal?.id ?? editing;
    if (!userId) {
      setPendingFaceDescriptor(null);
      setEditFaceDescriptor(null);
      clearFacePhotoState();
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
      setAvatarFile(null);
      setAvatarPreview(null);
      setFaceTemplateModal((m) => (m ? { ...m, has_face: false, isDraft: true } : m));
      return;
    }
    setFaceSaving(true);
    setError('');
    try {
      await usersApi.clearFaceTemplate(userId);
      setEditFaceDescriptor(null);
      clearFacePhotoState();
      setFaceImageKey(Date.now());
      load();
      setFaceTemplateModal(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setFaceSaving(false);
    }
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

  const openDeleteConfirm = (u) => {
    setDeleteConfirm({
      id: u.id,
      login: u.login,
      name: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.display_name || '',
    });
  };

  const closeDeleteConfirm = () => {
    if (!deleting) setDeleteConfirm(null);
  };

  const confirmDelete = async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    setError('');
    try {
      await usersApi.delete(deleteConfirm.id);
      if (editing === deleteConfirm.id) setEditing(null);
      setDeleteConfirm(null);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setDeleting(false);
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <label className="label">Шаблон лица</label>
            <p className="text-2xs text-slate-400 mt-0.5">
              {hasFaceTemplate
                ? 'Шаблон записан — отметка по лицу доступна'
                : 'Для отметки по лицу запишите шаблон'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => openFaceTemplateModal(editingUser || null)}
            className="btn-ghost text-sm"
          >
            {hasFaceTemplate ? 'Редактировать шаблон' : 'Настроить шаблон'}
          </button>
        </div>
        {hasFaceTemplate && (facePhotoPreview || editingUser?.has_face || pendingFaceDescriptor) && (
          <img
            src={
              facePhotoPreview
              || (editing ? `${usersApi.facePhotoUrl(editing)}?k=${faceImageKey}` : '')
            }
            alt=""
            className="w-20 h-20 rounded-xl object-cover border border-emerald-500/50"
            onError={(e) => {
              if (editing && editingUser?.avatar) {
                e.currentTarget.src = `${usersApi.avatarUrl(editing)}?k=${listKey}`;
              } else {
                e.currentTarget.style.display = 'none';
              }
            }}
          />
        )}
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
      <div>
        <label className="label">Роль</label>
        <select
          value={form.role_id ?? ''}
          onChange={(e) => setForm((f) => ({ ...f, role_id: e.target.value }))}
          className="input"
        >
          <option value="">— не выбрана —</option>
          {roles.map((r) => (
            <option key={r.id} value={String(r.id)}>
              {r.name}{r.is_admin_role ? ' (все возможности)' : ''}
            </option>
          ))}
        </select>
        <p className="text-2xs text-slate-500 mt-1">
          Права доступа задаются в разделе «Роли». При записи шаблона лица включается отметка по лицу.
        </p>
      </div>
    </>
  );

  const handleDownloadTemplate = () => {
    usersApi.downloadImportTemplate().catch((e) => setError(e.message));
  };

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImportPreviewing(true);
    setError('');
    try {
      const preview = await usersApi.previewImportExcel(file);
      setImportConfirm({
        file,
        fileName: file.name,
        total: preview.total ?? 0,
        toCreate: preview.toCreate ?? 0,
        toUpdate: preview.toUpdate ?? 0,
        warnings: preview.warnings ?? [],
        canImport: preview.canImport !== false,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setImportPreviewing(false);
    }
  };

  const closeImportConfirm = () => {
    if (!importing) setImportConfirm(null);
  };

  const confirmImport = async () => {
    if (!importConfirm?.file || !importConfirm.canImport) return;
    setImporting(true);
    setError('');
    try {
      const result = await usersApi.importExcel(importConfirm.file);
      setImportConfirm(null);
      setImportResult({
        total: result.total ?? 0,
        created: result.created ?? 0,
        updated: result.updated ?? 0,
        errors: result.errors ?? [],
      });
      setListKey((k) => k + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  const handleExport = () => {
    setExporting(true);
    setError('');
    usersApi
      .exportExcel()
      .catch((e) => setError(e.message))
      .finally(() => setExporting(false));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        {!embedded && <h2 className="page-title">Пользователи</h2>}
        {embedded && <h3 className="text-white font-medium text-lg">Пользователи</h3>}
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={handleDownloadTemplate}
            className="btn-ghost text-sm"
            title="Скачать шаблон Excel для импорта"
          >
            Шаблон Excel
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing || importPreviewing}
            className="btn-ghost text-sm"
            title="Импорт из Excel (логин, права, шаблон лица)"
          >
            {importPreviewing ? '…' : importing ? '…' : 'Импорт'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={handleImportFile}
          />
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting}
            className="btn-ghost text-sm"
            title="Выгрузить всех пользователей с шаблонами лица"
          >
            {exporting ? '…' : 'Экспорт Excel'}
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="btn-primary text-sm font-medium"
          >
            Добавить пользователя
          </button>
        </div>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {deleteConfirm && (
        <div
          className="modal-backdrop z-50"
          onClick={closeDeleteConfirm}
          role="dialog"
          aria-modal="true"
          aria-labelledby="users-delete-confirm-title"
        >
          <div
            className="card p-5 max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="users-delete-confirm-title" className="text-white font-medium text-lg mb-3">
              Удаление пользователя
            </h3>
            <p className="text-slate-300 text-sm mb-2">
              Вы уверены, что хотите удалить пользователя?
            </p>
            <p className="text-white font-mono text-sm mb-1">{deleteConfirm.login}</p>
            {deleteConfirm.name && (
              <p className="text-slate-400 text-sm mb-3">{deleteConfirm.name}</p>
            )}
            <p className="text-slate-500 text-xs mb-5">
              Будут удалены учётная запись, права, отметки в табеле и связанные выдачи материалов. Действие нельзя отменить.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn-ghost text-sm"
                onClick={closeDeleteConfirm}
                disabled={deleting}
              >
                Отмена
              </button>
              <button
                type="button"
                className="btn-primary text-sm bg-red-600 hover:bg-red-500 border-red-600"
                onClick={confirmDelete}
                disabled={deleting}
              >
                {deleting ? 'Удаление…' : 'Удалить'}
              </button>
            </div>
          </div>
        </div>
      )}

      {importConfirm && (
        <div
          className="modal-backdrop z-50"
          onClick={closeImportConfirm}
          role="dialog"
          aria-modal="true"
          aria-labelledby="users-import-confirm-title"
        >
          <div
            className="card p-5 max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="users-import-confirm-title" className="text-white font-medium text-lg mb-3">
              Импорт пользователей
            </h3>
            <p className="text-slate-400 text-sm mb-4 truncate" title={importConfirm.fileName}>
              Файл: {importConfirm.fileName}
            </p>
            <dl className="space-y-3 text-sm mb-4">
              <div className="flex justify-between gap-4 border-b border-slate-700 pb-2">
                <dt className="text-slate-400">Пользователей в файле</dt>
                <dd className="text-white font-medium tabular-nums">{importConfirm.total}</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-slate-700 pb-2">
                <dt className="text-slate-400">Будет добавлено новых</dt>
                <dd className="text-emerald-400 font-medium tabular-nums">{importConfirm.toCreate}</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-slate-700 pb-2">
                <dt className="text-slate-400">Будет обновлено</dt>
                <dd className="text-sky-400 font-medium tabular-nums">{importConfirm.toUpdate}</dd>
              </div>
            </dl>
            {importConfirm.warnings.length > 0 && (
              <div className="mb-4">
                <p className="text-rose-400 text-sm mb-2">
                  Исправьте файл перед загрузкой ({importConfirm.warnings.length})
                </p>
                <ul className="text-rose-400 text-xs space-y-1 max-h-32 overflow-y-auto">
                  {importConfirm.warnings.slice(0, 15).map((w, i) => (
                    <li key={i}>
                      Строка {w.row} ({w.login}): {w.error}
                    </li>
                  ))}
                  {importConfirm.warnings.length > 15 && (
                    <li className="text-slate-500">…и ещё {importConfirm.warnings.length - 15}</li>
                  )}
                </ul>
              </div>
            )}
            <p className="text-slate-500 text-xs mb-5">
              После подтверждения данные будут записаны в систему. Существующие пользователи обновятся по логину или id.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn-ghost text-sm"
                onClick={closeImportConfirm}
                disabled={importing}
              >
                Отмена
              </button>
              <button
                type="button"
                className="btn-primary text-sm"
                onClick={confirmImport}
                disabled={importing || !importConfirm.canImport}
              >
                {importing ? 'Загрузка…' : 'Загрузить'}
              </button>
            </div>
          </div>
        </div>
      )}

      {importResult && (
        <div
          className="modal-backdrop z-50"
          onClick={() => setImportResult(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="users-import-result-title"
        >
          <div
            className="card p-5 max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="users-import-result-title" className="text-white font-medium text-lg mb-4">
              Результат импорта
            </h3>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-4 border-b border-slate-700 pb-2">
                <dt className="text-slate-400">Пользователей в файле</dt>
                <dd className="text-white font-medium tabular-nums">{importResult.total}</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-slate-700 pb-2">
                <dt className="text-slate-400">Добавлено новых</dt>
                <dd className="text-emerald-400 font-medium tabular-nums">{importResult.created}</dd>
              </div>
              {importResult.updated > 0 && (
                <div className="flex justify-between gap-4 border-b border-slate-700 pb-2">
                  <dt className="text-slate-400">Обновлено</dt>
                  <dd className="text-sky-400 font-medium tabular-nums">{importResult.updated}</dd>
                </div>
              )}
              {importResult.errors.length > 0 && (
                <div>
                  <dt className="text-slate-400 mb-2">
                    Ошибки ({importResult.errors.length})
                  </dt>
                  <ul className="text-rose-400 text-xs space-y-1 max-h-40 overflow-y-auto">
                    {importResult.errors.slice(0, 20).map((err, i) => (
                      <li key={i}>
                        Строка {err.row}: {err.error}
                      </li>
                    ))}
                    {importResult.errors.length > 20 && (
                      <li className="text-slate-500">…и ещё {importResult.errors.length - 20}</li>
                    )}
                  </ul>
                </div>
              )}
            </dl>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                className="btn-primary text-sm"
                onClick={() => setImportResult(null)}
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

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
                  <td className="p-4 text-center">
                    <button
                      type="button"
                      onClick={() => openFaceTemplateModal(u)}
                      className="text-lg hover:scale-110 transition-transform"
                      title={u.has_face ? 'Шаблон лица — нажмите для редактирования' : 'Нет шаблона — нажмите, чтобы записать'}
                    >
                      {u.has_face ? <span className="text-emerald-400">✓</span> : <span className="text-slate-600">—</span>}
                    </button>
                  </td>
                  <td className="p-4 font-mono text-white">{u.login}</td>
                  <td className="p-4 text-slate-300">{u.first_name || '—'}</td>
                  <td className="p-4 text-slate-300">{u.last_name || '—'}</td>
                  <td className="p-4 text-slate-400">{u.phone || '—'}</td>
                  <td className="p-4">
                    <span className={u.role === 'admin' ? 'text-amber-400' : 'text-slate-300'}>
                      {u.role === 'admin' ? 'Системный админ' : (u.role_name || '—')}
                    </span>
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
                    {Number(u.id) !== Number(user?.id) && (
                      <button type="button" onClick={() => openDeleteConfirm(u)} className="ml-2 text-red-400 hover:text-red-300 text-sm">
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

      {faceTemplateModal && (
        <div
          className="modal-backdrop z-[55]"
          onClick={closeFaceTemplateModal}
          role="dialog"
          aria-modal="true"
          aria-labelledby="face-template-modal-title"
        >
          <div
            className="card p-5 max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="face-template-modal-title" className="text-white font-medium text-lg mb-1">
              Шаблон лица
            </h3>
            <p className="text-slate-400 text-sm mb-4 font-mono">{faceTemplateModal.login}</p>
            {faceTemplateModal.name && (
              <p className="text-slate-500 text-sm mb-3">{faceTemplateModal.name}</p>
            )}
            {(facePhotoPreview
              || (faceTemplateModal.id && (faceTemplateModal.has_face_photo || faceTemplateModal.has_face))
              || (faceTemplateModal.isDraft && pendingFaceDescriptor)) && (
              <img
                src={
                  facePhotoPreview
                  || (faceTemplateModal.id
                    ? `${usersApi.facePhotoUrl(faceTemplateModal.id)}?k=${faceImageKey}`
                    : '')
                }
                alt=""
                className="w-32 h-32 rounded-xl object-cover border-2 border-emerald-500/60 mx-auto mb-4"
                onError={(e) => {
                  if (faceTemplateModal.id) {
                    e.currentTarget.src = `${usersApi.avatarUrl(faceTemplateModal.id)}?k=${listKey}`;
                  } else {
                    e.currentTarget.style.display = 'none';
                  }
                }}
              />
            )}
            <p className="text-slate-400 text-sm mb-5 text-center">
              {(faceTemplateModal.has_face || (faceTemplateModal.isDraft && pendingFaceDescriptor?.length >= 128))
                ? 'Шаблон сохранён. Фото профиля обновляется при записи. Можно перезаписать или удалить.'
                : 'Шаблон не записан. При съёмке сохранятся шаблон, фото лица и аватар профиля.'}
            </p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                className="btn-primary text-sm w-full"
                disabled={faceSaving}
                onClick={() => { setError(''); setShowFaceCamera(true); }}
              >
                Записать шаблон
              </button>
              {(faceTemplateModal.has_face
                || (faceTemplateModal.isDraft && pendingFaceDescriptor?.length >= 128)) && (
                <button
                  type="button"
                  className="btn-ghost text-sm w-full text-red-400 hover:text-red-300"
                  disabled={faceSaving}
                  onClick={handleDeleteFaceTemplate}
                >
                  {faceSaving ? '…' : 'Удалить шаблон'}
                </button>
              )}
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                className="btn-ghost text-sm"
                onClick={closeFaceTemplateModal}
                disabled={faceSaving}
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {showFaceCamera && (
        <div className="fixed inset-0 z-[70] bg-black flex flex-col items-center justify-center p-4">
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
              disabled={faceSaving}
            >
              {faceSaving ? 'Сохранение…' : 'Снять шаблон'}
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
