import { useState, useEffect, useRef, useCallback } from 'react';
import { users as usersApi, roles as rolesApi, settings as settingsApi } from '../api';
import FaceCamera from '../components/FaceCamera';
import {
  loadFaceModels,
  captureFaceDescriptor,
  captureVideoFrameBlob,
  buildFaceTemplateFromImageFile,
  isImageUploadFile,
  isHeicLike,
  normalizeImageBlob,
} from '../lib/faceClient';
import CopyButton, { CopyFieldRow, CopyTableCell } from '../components/CopyButton';
import { parseExcelBlobForPreview, isExcelLaborContract } from '../lib/excelPreview';
import { parseWordBlobForPreview, isWordLaborContract } from '../lib/wordPreview';

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
    profile_active: form.profile_active !== false,
    employment_status: form.employment_status || 'working',
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
  profile_active: true,
  employment_status: 'working',
});

const filterInputCls = 'filter-input';

const EMPLOYMENT_STATUS_LABELS = {
  working: 'Работает',
  vacation: 'В отпуске',
  fired: 'Уволен',
};

function laborContractIcon(mime, filename = '') {
  const m = (mime || '').toLowerCase();
  const n = (filename || '').toLowerCase();
  if (m.includes('pdf') || n.endsWith('.pdf')) return '📕';
  if (m.includes('word') || m.includes('msword') || /\.docx?$/.test(n)) return '📝';
  if (m.includes('sheet') || m.includes('excel') || /\.xlsx?$/.test(n)) return '📊';
  if (m.startsWith('image/')) return '🖼️';
  return '📄';
}

function laborContractCanPreview(mime, filename = '') {
  const m = (mime || '').toLowerCase();
  const n = (filename || '').toLowerCase();
  if (m.includes('pdf') || n.endsWith('.pdf')) return 'pdf';
  if (m.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|heic|heif|tiff?)$/i.test(n)) return 'image';
  if (isExcelLaborContract(mime, filename)) return 'excel';
  if (isWordLaborContract(mime, filename)) return 'word';
  return null;
}

function laborContractPreviewFallback(mime, filename = '') {
  const kind = laborContractCanPreview(mime, filename);
  if (kind === 'image') {
    return 'Не удалось показать изображение. Нажмите «Скачать», чтобы открыть файл.';
  }
  if (kind === 'excel') {
    return 'Не удалось открыть таблицу Excel. Нажмите «Скачать», чтобы открыть файл на компьютере.';
  }
  if (kind === 'word') {
    return 'Не удалось открыть документ Word. Нажмите «Скачать», чтобы открыть файл на компьютере.';
  }
  return 'Предпросмотр этого типа файла недоступен. Нажмите «Скачать».';
}

function LaborContractWordPreview({ html }) {
  return (
    <div
      className="p-4 text-sm text-slate-200 max-w-none overflow-x-auto
        [&_p]:my-2 [&_h1]:text-lg [&_h1]:font-semibold [&_h1]:mt-4
        [&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-medium
        [&_table]:border-collapse [&_table]:my-3 [&_table]:w-full
        [&_td]:border [&_td]:border-slate-600 [&_td]:px-2 [&_td]:py-1 [&_td]:align-top
        [&_th]:border [&_th]:border-slate-600 [&_th]:px-2 [&_th]:py-1 [&_th]:bg-slate-800
        [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-2
        [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-2
        [&_img]:max-w-full [&_strong]:text-white"
      // mammoth: docx → HTML без скриптов
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function LaborContractExcelPreview({ data }) {
  const [activeSheet, setActiveSheet] = useState(0);
  const sheet = data.sheets[activeSheet] || data.sheets[0];
  if (!sheet) return null;
  const colCount = sheet.rows.reduce((m, r) => Math.max(m, r.length), 0);

  return (
    <div className="flex flex-col min-h-0">
      {data.sheets.length > 1 && (
        <div className="flex flex-wrap gap-1 p-2 border-b border-slate-700 bg-slate-800/80 sticky top-0 z-10">
          {data.sheets.map((s, i) => (
            <button
              key={s.name}
              type="button"
              onClick={() => setActiveSheet(i)}
              className={`px-2 py-1 rounded text-xs ${
                i === activeSheet
                  ? 'bg-brand-600 text-white'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      <div className="overflow-auto p-2">
        <table className="text-xs border-collapse min-w-full">
          <tbody>
            {sheet.rows.length === 0 ? (
              <tr>
                <td className="p-4 text-slate-500 text-center">Лист пустой</td>
              </tr>
            ) : (
              sheet.rows.map((row, ri) => (
                <tr key={ri} className={ri === 0 ? 'bg-slate-800' : ri % 2 ? 'bg-slate-900/50' : ''}>
                  {Array.from({ length: colCount }, (_, ci) => (
                    <td
                      key={ci}
                      className="border border-slate-700 px-2 py-1 text-slate-200 whitespace-pre-wrap max-w-[240px] align-top"
                    >
                      {row[ci] ?? ''}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {sheet.truncated && (
        <p className="px-3 py-2 text-2xs text-slate-500 border-t border-slate-700">
          Показана часть таблицы (до 250 строк и 50 столбцов). Скачайте файл для полного просмотра.
        </p>
      )}
    </div>
  );
}

async function laborContractBlobForPreview(blob, mime, filename) {
  const file = new File([blob], filename || 'file', { type: blob.type || mime || '' });
  if (isHeicLike(file)) return normalizeImageBlob(file);
  return blob;
}

function ContractImageThumb({ userId, file, listKey, onOpen }) {
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);
  const directUrl = `${usersApi.laborContractFileUrl(userId, file.id, true)}&k=${listKey}`;
  const needsDecode = isHeicLike({ type: file.mime, name: file.filename });

  useEffect(() => {
    if (!needsDecode) return undefined;
    let cancelled = false;
    let objectUrl = null;
    (async () => {
      try {
        const blob = await usersApi.fetchLaborContractBlob(userId, file.id, true);
        const preview = await laborContractBlobForPreview(blob, file.mime, file.filename);
        if (cancelled) return;
        objectUrl = URL.createObjectURL(preview);
        setSrc(objectUrl);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [userId, file.id, file.mime, file.filename, listKey, needsDecode]);

  if (!needsDecode) {
    return (
      <img
        key={file.id}
        src={directUrl}
        alt=""
        className="w-9 h-9 rounded object-cover border border-slate-600 bg-slate-800 shrink-0 cursor-pointer"
        onClick={(e) => { e.stopPropagation(); onOpen?.(file); }}
      />
    );
  }
  if (src) {
    return (
      <img
        key={file.id}
        src={src}
        alt=""
        className="w-9 h-9 rounded object-cover border border-slate-600 bg-slate-800 shrink-0 cursor-pointer"
        onClick={(e) => { e.stopPropagation(); onOpen?.(file); }}
      />
    );
  }
  return (
    <span
      key={file.id}
      className="w-9 h-9 rounded bg-slate-800 border border-slate-600 flex items-center justify-center text-base shrink-0 cursor-pointer"
      title={failed ? file.filename : 'Загрузка…'}
      onClick={(e) => { e.stopPropagation(); onOpen?.(file); }}
    >
      {failed ? laborContractIcon(file.mime, file.filename) : '…'}
    </span>
  );
}

const emptyFilters = () => ({
  login: '',
  first_name: '',
  last_name: '',
  birth_date: '',
  passport_number: '',
  phone: '',
  role: '',
  role_name: '',
  snils: '',
  inn: '',
  employment_date: '',
  employment_org: '',
  internal_uid: '',
  profile_active: '',
  employment_status: '',
  has_labor_contract: '',
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
  const [info, setInfo] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef(null);
  const facePhotoInputRef = useRef(null);
  const [showCamera, setShowCamera] = useState(false);
  const [showFaceCamera, setShowFaceCamera] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [saving, setSaving] = useState(false);
  const [sortBy, setSortBy] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [filters, setFilters] = useState(emptyFilters);
  const [showContractCamera, setShowContractCamera] = useState(false);
  const [contractSaving, setContractSaving] = useState(false);
  const [laborContracts, setLaborContracts] = useState([]);
  const [contractView, setContractView] = useState(null);
  const [contractPreviewUrl, setContractPreviewUrl] = useState(null);
  const [contractExcelPreview, setContractExcelPreview] = useState(null);
  const [contractWordPreview, setContractWordPreview] = useState(null);
  const [contractDeleteConfirm, setContractDeleteConfirm] = useState(null);
  const [contractViewUserId, setContractViewUserId] = useState(null);
  const [contractsListModal, setContractsListModal] = useState(null);
  const contractVideoRef = useRef(null);
  const contractStreamRef = useRef(null);
  const contractInputRef = useRef(null);
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

  useEffect(() => {
    if (!showContractCamera) return;
    let stream = null;
    const tryGetUserMedia = (constraints) =>
      navigator.mediaDevices.getUserMedia(constraints).then((s) => {
        stream = s;
        contractStreamRef.current = s;
        if (contractVideoRef.current) contractVideoRef.current.srcObject = s;
      });
    tryGetUserMedia({ video: { facingMode: 'environment' } })
      .catch(() => tryGetUserMedia({ video: { facingMode: 'user' } }))
      .catch(() => tryGetUserMedia({ video: true }))
      .catch(() => setError('Не удалось включить камеру для скана договора'));
    return () => {
      if (stream) stream.getTracks().forEach((t) => t.stop());
      contractStreamRef.current = null;
    };
  }, [showContractCamera]);

  const setContractVideoRef = (el) => {
    contractVideoRef.current = el;
    if (el && contractStreamRef.current) el.srcObject = contractStreamRef.current;
  };

  const refreshLaborContracts = useCallback(async (userId) => {
    if (!userId) {
      setLaborContracts([]);
      return;
    }
    try {
      const data = await usersApi.listLaborContracts(userId);
      setLaborContracts(data.files || []);
    } catch {
      setLaborContracts([]);
    }
  }, []);

  const uploadLaborContractFiles = async (files) => {
    if (!editing || !files?.length) return;
    setContractSaving(true);
    setError('');
    try {
      await usersApi.uploadLaborContracts(editing, files);
      await refreshLaborContracts(editing);
      setListKey((k) => k + 1);
      load();
      if (contractsListModal?.user?.id === editing) {
        const data = await usersApi.listLaborContracts(editing);
        setContractsListModal((m) => (m ? { ...m, files: data.files || [], loading: false } : m));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setContractSaving(false);
    }
  };

  const onContractFileChange = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length) await uploadLaborContractFiles(files);
  };

  const captureContractScan = () => {
    const video = contractVideoRef.current;
    if (!video || video.readyState !== 4 || !editing) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      setShowContractCamera(false);
      const scanName = `Скан_${new Date().toISOString().slice(0, 10)}_${Date.now()}.jpg`;
      const file = new File([blob], scanName, { type: 'image/jpeg' });
      await uploadLaborContractFiles([file]);
    }, 'image/jpeg', 0.92);
  };

  const closeContractView = () => {
    if (contractPreviewUrl) URL.revokeObjectURL(contractPreviewUrl);
    setContractPreviewUrl(null);
    setContractExcelPreview(null);
    setContractWordPreview(null);
    setContractView(null);
    setContractViewUserId(null);
  };

  const openContractView = async (file, userId) => {
    const uid = userId ?? editing;
    if (!uid || !file) return;
    const kind = laborContractCanPreview(file.mime, file.filename);
    setContractView(file);
    setContractViewUserId(uid);
    setError('');
    if (contractPreviewUrl) URL.revokeObjectURL(contractPreviewUrl);
    setContractPreviewUrl(null);
    setContractExcelPreview(null);
    setContractWordPreview(null);
    if (!kind) return;
    try {
      const blob = await usersApi.fetchLaborContractBlob(uid, file.id, true);
      if (kind === 'excel') {
        const data = await parseExcelBlobForPreview(blob);
        setContractExcelPreview(data);
        return;
      }
      if (kind === 'word') {
        const data = await parseWordBlobForPreview(blob, file.filename);
        setContractWordPreview(data);
        return;
      }
      const previewBlob = await laborContractBlobForPreview(blob, file.mime, file.filename);
      setContractPreviewUrl(URL.createObjectURL(previewBlob));
    } catch (err) {
      setError(err.message);
      setContractView(null);
      setContractViewUserId(null);
      setContractExcelPreview(null);
      setContractWordPreview(null);
    }
  };

  const downloadContractFile = (file, userId) => {
    const uid = userId ?? contractViewUserId ?? editing;
    if (!uid || !file) return;
    usersApi.downloadLaborContractFile(uid, file.id, file.filename).catch((e) => setError(e.message));
  };

  const openContractsListModal = async (u) => {
    if (!u?.id) return;
    setContractsListModal({ user: u, files: u.labor_contract_previews || [], loading: true });
    setError('');
    try {
      const data = await usersApi.listLaborContracts(u.id);
      setContractsListModal({
        user: u,
        files: data.files || [],
        loading: false,
      });
    } catch (err) {
      setError(err.message);
      setContractsListModal(null);
    }
  };

  const renderContractThumb = (userId, file, onOpen) => {
    const isImage = laborContractCanPreview(file.mime, file.filename) === 'image';
    if (isImage) {
      return (
        <ContractImageThumb
          key={file.id}
          userId={userId}
          file={file}
          listKey={listKey}
          onOpen={onOpen}
        />
      );
    }
    return (
      <span
        key={file.id}
        className="w-9 h-9 rounded bg-slate-800 border border-slate-600 flex items-center justify-center text-base shrink-0"
        title={file.filename}
      >
        {laborContractIcon(file.mime, file.filename)}
      </span>
    );
  };

  const confirmDeleteContractFile = async () => {
    if (!editing || !contractDeleteConfirm) return;
    setContractSaving(true);
    setError('');
    try {
      await usersApi.deleteLaborContractFile(editing, contractDeleteConfirm.id);
      setContractDeleteConfirm(null);
      if (contractView?.id === contractDeleteConfirm.id) closeContractView();
      await refreshLaborContracts(editing);
      setListKey((k) => k + 1);
      load();
      if (contractsListModal?.user?.id === editing) {
        const data = await usersApi.listLaborContracts(editing);
        setContractsListModal((m) => (m ? { ...m, files: data.files || [] } : m));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setContractSaving(false);
    }
  };

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
      profile_active: u.profile_active !== false,
      employment_status: u.employment_status || 'working',
    });
    setEditFaceDescriptor(null);
    clearFacePhotoState();
    setShowFaceCamera(false);
    setPasswordSnapshot(u.password_plain || '');
    setShowPassword(true);
    setFaceImageKey(Date.now());
    setError('');
    refreshLaborContracts(u.id);
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

  const applyFaceFromImageFile = async (file) => {
    if (!isImageUploadFile(file)) {
      setError('Выберите файл изображения (JPEG, PNG, HEIC и т.д.)');
      return;
    }
    setError('');
    setFaceSaving(true);
    try {
      const { descriptor, jpegBlob } = await buildFaceTemplateFromImageFile(file);
      if (!descriptor?.length) {
        setError('Лицо не найдено на фото. Загрузите снимок, где лицо хорошо видно.');
        return;
      }
      await applyFaceCapture(descriptor, jpegBlob);
    } catch (err) {
      setError(err.message || 'Ошибка обработки фото');
    } finally {
      setFaceSaving(false);
    }
  };

  const onFacePhotoFileChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await applyFaceFromImageFile(file);
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

  const textMatch = (val, filter) => {
    if (!filter) return true;
    return String(val || '').toLowerCase().includes(filter.toLowerCase());
  };
  const digitsMatch = (val, filter) => {
    if (!filter) return true;
    return String(val || '').replace(/\D/g, '').includes(filter.replace(/\D/g, ''));
  };

  const filteredList = list.filter((u) => {
    if (!textMatch(u.login, filters.login)) return false;
    if (!textMatch(u.first_name, filters.first_name)) return false;
    if (!textMatch(u.last_name, filters.last_name)) return false;
    if (!textMatch(u.birth_date?.slice?.(0, 10) ?? u.birth_date, filters.birth_date)) return false;
    if (!textMatch(u.passport_number, filters.passport_number)) return false;
    if (!digitsMatch(u.phone, filters.phone)) return false;
    if (filters.role === 'admin' && u.role !== 'admin') return false;
    if (filters.role === 'user' && u.role === 'admin') return false;
    if (!textMatch(u.role === 'admin' ? 'Системный админ' : u.role_name, filters.role_name)) return false;
    if (!digitsMatch(u.snils, filters.snils)) return false;
    if (!digitsMatch(u.inn, filters.inn)) return false;
    if (!textMatch(u.employment_date?.slice?.(0, 10) ?? u.employment_date, filters.employment_date)) return false;
    if (!textMatch(u.employment_org, filters.employment_org)) return false;
    if (!digitsMatch(u.internal_uid, filters.internal_uid)) return false;
    if (filters.profile_active === 'active' && u.profile_active === false) return false;
    if (filters.profile_active === 'inactive' && u.profile_active !== false) return false;
    if (filters.employment_status && u.employment_status !== filters.employment_status) return false;
    if (filters.has_labor_contract === 'yes' && !u.has_labor_contract) return false;
    if (filters.has_labor_contract === 'no' && u.has_labor_contract) return false;
    return true;
  });

  const sortedList = [...filteredList].sort((a, b) => {
    if (!sortBy) return 0;
    let va = a[sortBy] ?? '';
    let vb = b[sortBy] ?? '';
    if (typeof va === 'boolean') va = va ? 1 : 0;
    if (typeof vb === 'boolean') vb = vb ? 1 : 0;
    if (sortBy === 'role_name') {
      va = a.role === 'admin' ? 'системный админ' : (a.role_name || '');
      vb = b.role === 'admin' ? 'системный админ' : (b.role_name || '');
    }
    if (sortBy === 'profile_active') {
      va = a.profile_active === false ? 0 : 1;
      vb = b.profile_active === false ? 0 : 1;
    }
    if (sortBy === 'employment_status') {
      va = EMPLOYMENT_STATUS_LABELS[a.employment_status] || a.employment_status || '';
      vb = EMPLOYMENT_STATUS_LABELS[b.employment_status] || b.employment_status || '';
    }
    if (sortBy === 'has_labor_contract') {
      va = a.has_labor_contract ? 1 : 0;
      vb = b.has_labor_contract ? 1 : 0;
    }
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

  const hasActiveFilters = Object.values(filters).some(Boolean);
  const resetFilters = () => setFilters(emptyFilters());

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
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => openFaceTemplateModal(editingUser || null)}
              className="btn-ghost text-sm"
            >
              {hasFaceTemplate ? 'Редактировать шаблон' : 'Настроить шаблон'}
            </button>
            <label
              htmlFor="face-template-file"
              className={`cursor-pointer px-4 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-white text-sm inline-block ${faceSaving ? 'opacity-50 pointer-events-none' : ''}`}
            >
              {faceSaving ? 'Обработка…' : 'Загрузить фото с телефона'}
            </label>
            <input
              id="face-template-file"
              ref={facePhotoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={onFacePhotoFileChange}
              disabled={faceSaving}
            />
          </div>
        </div>
        <p className="text-2xs text-slate-500">
          Можно выбрать снимок из галереи (JPEG, PNG, HEIC). Лицо на фото должно быть чётко видно.
        </p>
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
        <CopyFieldRow label="Имя" copyValue={form.first_name}>
          <input
            type="text"
            value={form.first_name}
            onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))}
            className="input"
          />
        </CopyFieldRow>
        <CopyFieldRow label="Фамилия" copyValue={form.last_name}>
          <input
            type="text"
            value={form.last_name}
            onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))}
            className="input"
          />
        </CopyFieldRow>
      </div>
      <CopyFieldRow label="Логин" copyValue={form.login}>
        <input
          type="text"
          value={form.login}
          onChange={(e) => setForm((f) => ({ ...f, login: e.target.value }))}
          className="input"
          required={!editing}
        />
      </CopyFieldRow>
      <CopyFieldRow label="Пароль" copyValue={showPassword ? form.password : ''}>
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
      </CopyFieldRow>
      <CopyFieldRow label="Дата рождения" copyValue={form.birth_date}>
        <input
          type="date"
          value={form.birth_date}
          onChange={(e) => setForm((f) => ({ ...f, birth_date: e.target.value }))}
          className="input"
        />
      </CopyFieldRow>
      <CopyFieldRow label="Номер паспорта" copyValue={form.passport_number}>
        <input
          type="text"
          value={form.passport_number}
          onChange={(e) => setForm((f) => ({ ...f, passport_number: e.target.value }))}
          className="input"
          placeholder="Серия и номер"
        />
      </CopyFieldRow>
      <CopyFieldRow label="СНИЛС" copyValue={form.snils}>
        <input
          type="text"
          value={form.snils}
          onChange={(e) => setForm((f) => ({ ...f, snils: e.target.value }))}
          className="input"
          placeholder="XXX-XXX-XXX XX"
        />
      </CopyFieldRow>
      <CopyFieldRow label="Дата трудоустройства" copyValue={form.employment_date}>
        <input
          type="date"
          value={form.employment_date}
          onChange={(e) => setForm((f) => ({ ...f, employment_date: e.target.value }))}
          className="input"
        />
      </CopyFieldRow>
      <CopyFieldRow
        label="Трудоустройство"
        copyValue={organizations.find((o) => String(o.id) === String(form.organization_id))?.name || ''}
      >
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
      </CopyFieldRow>
      <CopyFieldRow label="Внутр. номер (UID) для карты доступа" copyValue={form.internal_uid}>
        <input
          type="text"
          value={form.internal_uid}
          onChange={(e) => setForm((f) => ({ ...f, internal_uid: e.target.value }))}
          className="input"
          placeholder="Напр. 09820541"
        />
      </CopyFieldRow>
      <CopyFieldRow label="ИНН" copyValue={form.inn}>
        <input
          type="text"
          value={form.inn}
          onChange={(e) => setForm((f) => ({ ...f, inn: e.target.value }))}
          className="input"
        />
      </CopyFieldRow>
      <CopyFieldRow label="Номер телефона" copyValue={form.phone}>
        <input
          type="tel"
          value={form.phone}
          onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
          className="input"
          placeholder="+7 (999) 123-45-67"
        />
      </CopyFieldRow>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <CopyFieldRow
          label="Профиль"
          copyValue={form.profile_active === false ? 'Неактивный' : 'Активный'}
        >
          <select
            value={form.profile_active === false ? 'inactive' : 'active'}
            onChange={(e) => setForm((f) => ({
              ...f,
              profile_active: e.target.value === 'active',
            }))}
            className="input"
          >
            <option value="active">Активный</option>
            <option value="inactive">Неактивный</option>
          </select>
          <p className="text-2xs text-slate-500 mt-1">Неактивный — вход в приложение запрещён.</p>
        </CopyFieldRow>
        <CopyFieldRow
          label="Статус сотрудника"
          copyValue={EMPLOYMENT_STATUS_LABELS[form.employment_status] || 'Работает'}
        >
          <select
            value={form.employment_status || 'working'}
            onChange={(e) => setForm((f) => ({ ...f, employment_status: e.target.value }))}
            className="input"
          >
            <option value="working">Работает</option>
            <option value="vacation">В отпуске</option>
            <option value="fired">Уволен</option>
          </select>
          <p className="text-2xs text-slate-500 mt-1">Уволен — вход в приложение запрещён.</p>
        </CopyFieldRow>
      </div>
      <div className="border border-white/10 rounded-xl p-4 space-y-3 bg-white/[0.02]">
        <label className="label">Трудовой договор (сканы)</label>
        {editing ? (
          <>
            <p className="text-2xs text-slate-400">
              Можно загрузить несколько файлов — имя сохраняется как у исходного. Изображения (JPG, PNG, WEBP, HEIC и др.), PDF, Word, Excel. Нажмите на файл — просмотр, скачивание или удаление.
            </p>
            <div className="flex flex-wrap gap-2">
              <label
                htmlFor="labor-contract-file"
                className={`cursor-pointer px-4 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-white text-sm inline-block ${contractSaving ? 'opacity-50 pointer-events-none' : ''}`}
              >
                {contractSaving ? 'Загрузка…' : 'Загрузить файлы'}
              </label>
              <input
                id="labor-contract-file"
                ref={contractInputRef}
                type="file"
                accept="image/*,.pdf,.jpg,.jpeg,.png,.webp,.gif,.bmp,.tif,.tiff,.heic,.heif,.doc,.docx,.xls,.xlsx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                multiple
                className="hidden"
                onChange={onContractFileChange}
                disabled={contractSaving}
              />
              <button
                type="button"
                className="btn-primary text-sm"
                disabled={contractSaving}
                onClick={() => { setError(''); setShowContractCamera(true); }}
              >
                Сканировать
              </button>
            </div>
            {laborContracts.length > 0 ? (
              <div className="flex flex-wrap gap-2 pt-1">
                {laborContracts.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    title={f.filename}
                    onClick={() => openContractView(f, editing)}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 hover:border-brand-500/60 hover:bg-slate-700/80 text-left max-w-[220px]"
                  >
                    <span className="text-lg shrink-0" aria-hidden>{laborContractIcon(f.mime, f.filename)}</span>
                    <span className="text-xs text-slate-200 truncate">{f.filename}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-2xs text-slate-500">Файлов пока нет</p>
            )}
          </>
        ) : (
          <p className="text-2xs text-slate-500">Сохраните пользователя, затем откройте редактирование для загрузки договора.</p>
        )}
      </div>
      <CopyFieldRow
        label="Роль"
        copyValue={roles.find((r) => String(r.id) === String(form.role_id))?.name || ''}
        hint="Права доступа задаются в разделе «Роли». При записи шаблона лица включается отметка по лицу."
      >
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
      </CopyFieldRow>
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
      load();
      const parts = [];
      if (result.created) parts.push(`добавлено: ${result.created}`);
      if (result.updated) parts.push(`обновлено: ${result.updated}`);
      if (result.errors?.length) {
        setInfo('');
      } else {
        setInfo(parts.join(', ') || 'Импорт завершён');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  const handleExport = async () => {
    if (!sortedList.length) {
      setError('Нет данных для выгрузки');
      return;
    }
    setExporting(true);
    setError('');
    setInfo('');
    try {
      await usersApi.exportExcel(sortedList.map((u) => u.id));
    } catch (e) {
      setError(e.message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {!embedded ? (
            <h2 className="page-title shrink-0">Пользователи</h2>
          ) : (
            <h3 className="text-white font-medium text-lg shrink-0">Пользователи</h3>
          )}
          <span className="text-2xs text-zinc-500">
            {hasActiveFilters ? `${sortedList.length}/${list.length}` : list.length}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {hasActiveFilters && (
            <button type="button" onClick={resetFilters} className="btn-ghost">
              Сброс
            </button>
          )}
          <button
            type="button"
            onClick={handleDownloadTemplate}
            className="btn-ghost"
            title="Скачать шаблон Excel"
          >
            Шаблон
          </button>
          <button
            type="button"
            onClick={() => { setInfo(''); fileInputRef.current?.click(); }}
            disabled={importing || importPreviewing}
            className="btn-ghost"
            title="Импорт из Excel"
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
            disabled={exporting || !sortedList.length}
            className="btn-ghost"
            title="Выгрузить отображаемых пользователей в Excel"
          >
            {exporting ? '…' : 'Excel'}
          </button>
          <button type="button" onClick={openCreate} className="btn-secondary">
            + Пользователь
          </button>
        </div>
      </div>

      {error && (
        <p className="alert-error">
          {error}
          <button type="button" onClick={() => load()} className="btn-ghost ml-2 text-xs">
            Повторить
          </button>
        </p>
      )}
      {info && <p className="alert-info">{info}</p>}
      {loading && <p className="text-zinc-500 text-xs">Загрузка…</p>}

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
              После подтверждения данные будут записаны в систему. Обновление — по логину или id. Поддерживаются профиль, статус работы, права и шаблон лица (см. лист «Справка» в шаблоне).
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


      <div className="table-wrap">
        <div className="filter-toolbar">
          <div className="filter-field w-24">
            <span className="filter-label">Логин</span>
            <input type="text" value={filters.login} onChange={(e) => setFilters((f) => ({ ...f, login: e.target.value }))} className={filterInputCls} />
          </div>
          <div className="filter-field w-20">
            <span className="filter-label">Имя</span>
            <input type="text" value={filters.first_name} onChange={(e) => setFilters((f) => ({ ...f, first_name: e.target.value }))} className={filterInputCls} />
          </div>
          <div className="filter-field w-20">
            <span className="filter-label">Фамилия</span>
            <input type="text" value={filters.last_name} onChange={(e) => setFilters((f) => ({ ...f, last_name: e.target.value }))} className={filterInputCls} />
          </div>
          <div className="filter-field w-20">
            <span className="filter-label">Телефон</span>
            <input type="text" value={filters.phone} onChange={(e) => setFilters((f) => ({ ...f, phone: e.target.value }))} className={filterInputCls} />
          </div>
          <div className="filter-field w-20">
            <span className="filter-label">Роль</span>
            <input type="text" value={filters.role_name} onChange={(e) => setFilters((f) => ({ ...f, role_name: e.target.value }))} className={filterInputCls} />
          </div>
          <div className="filter-field w-20">
            <span className="filter-label">Профиль</span>
            <select value={filters.profile_active} onChange={(e) => setFilters((f) => ({ ...f, profile_active: e.target.value }))} className={filterInputCls}>
              <option value="">Все</option>
              <option value="active">Активный</option>
              <option value="inactive">Неактивный</option>
            </select>
          </div>
          <div className="filter-field w-20">
            <span className="filter-label">Статус</span>
            <select value={filters.employment_status} onChange={(e) => setFilters((f) => ({ ...f, employment_status: e.target.value }))} className={filterInputCls}>
              <option value="">Все</option>
              <option value="working">Работает</option>
              <option value="vacation">В отпуске</option>
              <option value="fired">Уволен</option>
            </select>
          </div>
          <div className="filter-field w-16">
            <span className="filter-label">Договор</span>
            <select value={filters.has_labor_contract} onChange={(e) => setFilters((f) => ({ ...f, has_labor_contract: e.target.value }))} className={filterInputCls}>
              <option value="">—</option>
              <option value="yes">Есть</option>
              <option value="no">Нет</option>
            </select>
          </div>
          <div className="filter-field w-20">
            <span className="filter-label">Паспорт</span>
            <input type="text" value={filters.passport_number} onChange={(e) => setFilters((f) => ({ ...f, passport_number: e.target.value }))} className={filterInputCls} />
          </div>
          <div className="filter-field w-20">
            <span className="filter-label">СНИЛС</span>
            <input type="text" value={filters.snils} onChange={(e) => setFilters((f) => ({ ...f, snils: e.target.value }))} className={filterInputCls} />
          </div>
          <div className="filter-field w-16">
            <span className="filter-label">ИНН</span>
            <input type="text" value={filters.inn} onChange={(e) => setFilters((f) => ({ ...f, inn: e.target.value }))} className={filterInputCls} />
          </div>
          <div className="filter-field w-20">
            <span className="filter-label">Организация</span>
            <input type="text" value={filters.employment_org} onChange={(e) => setFilters((f) => ({ ...f, employment_org: e.target.value }))} className={filterInputCls} />
          </div>
          <div className="filter-field w-16">
            <span className="filter-label">UID</span>
            <input type="text" value={filters.internal_uid} onChange={(e) => setFilters((f) => ({ ...f, internal_uid: e.target.value }))} className={filterInputCls} />
          </div>
        </div>
        <div className="overflow-x-auto max-h-[calc(100vh-7.5rem)] overflow-y-auto">
          <table className="table-compact">
            <thead className="sticky top-0 bg-surface-900 z-10">
              <tr>
                <th className="w-8 text-center text-zinc-500 text-2xs font-normal">№</th>
                <th className="w-10">Фото</th>
                <th className="w-8 text-center" title="Шаблон лица">Лицо</th>
                <th><button type="button" onClick={() => toggleSort('login')} className="sort-btn">Логин <SortIcon column="login" /></button></th>
                <th><button type="button" onClick={() => toggleSort('first_name')} className="sort-btn">Имя <SortIcon column="first_name" /></button></th>
                <th><button type="button" onClick={() => toggleSort('last_name')} className="sort-btn">Фамилия <SortIcon column="last_name" /></button></th>
                <th className="whitespace-nowrap"><button type="button" onClick={() => toggleSort('birth_date')} className="sort-btn">Д.рожд. <SortIcon column="birth_date" /></button></th>
                <th><button type="button" onClick={() => toggleSort('passport_number')} className="sort-btn">Паспорт <SortIcon column="passport_number" /></button></th>
                <th><button type="button" onClick={() => toggleSort('phone')} className="sort-btn">Тел. <SortIcon column="phone" /></button></th>
                <th><button type="button" onClick={() => toggleSort('role_name')} className="sort-btn">Роль <SortIcon column="role_name" /></button></th>
                <th><button type="button" onClick={() => toggleSort('profile_active')} className="sort-btn">Профиль <SortIcon column="profile_active" /></button></th>
                <th><button type="button" onClick={() => toggleSort('employment_status')} className="sort-btn">Статус <SortIcon column="employment_status" /></button></th>
                <th className="min-w-[88px]"><button type="button" onClick={() => toggleSort('labor_contract_count')} className="sort-btn">Док. <SortIcon column="labor_contract_count" /></button></th>
                <th><button type="button" onClick={() => toggleSort('snils')} className="sort-btn">СНИЛС <SortIcon column="snils" /></button></th>
                <th><button type="button" onClick={() => toggleSort('inn')} className="sort-btn">ИНН <SortIcon column="inn" /></button></th>
                <th><button type="button" onClick={() => toggleSort('employment_date')} className="sort-btn">Труд. <SortIcon column="employment_date" /></button></th>
                <th><button type="button" onClick={() => toggleSort('employment_org')} className="sort-btn">Организ. <SortIcon column="employment_org" /></button></th>
                <th><button type="button" onClick={() => toggleSort('internal_uid')} className="sort-btn">UID <SortIcon column="internal_uid" /></button></th>
                <th className="w-20" />
              </tr>
            </thead>
            <tbody>
              {sortedList.map((u, idx) => (
                <tr
                  key={u.id}
                  className="cursor-pointer hover:bg-white/5"
                  onClick={() => { if (editing !== u.id) openEdit(u); }}
                >
                  <td className="text-center text-zinc-500 text-2xs tabular-nums">{idx + 1}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {u.avatar ? (
                      <img src={`${usersApi.avatarUrl(u.id)}?k=${listKey}`} alt="" className="w-8 h-8 rounded-full object-cover border border-zinc-700" />
                    ) : (
                      <span className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-600 text-2xs">—</span>
                    )}
                  </td>
                  <td className="text-center" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => openFaceTemplateModal(u)}
                      className="text-base hover:scale-110 transition-transform"
                      title={u.has_face ? 'Шаблон лица' : 'Записать шаблон'}
                    >
                      {u.has_face ? <span className="text-emerald-400">✓</span> : <span className="text-zinc-600">—</span>}
                    </button>
                  </td>
                  <CopyTableCell value={u.login} className="font-mono text-white" />
                  <CopyTableCell value={u.first_name} className="text-zinc-300" />
                  <CopyTableCell value={u.last_name} className="text-zinc-300" />
                  <CopyTableCell value={u.birth_date ? String(u.birth_date).slice(0, 10) : ''} className="text-zinc-500 whitespace-nowrap tabular-nums" />
                  <CopyTableCell value={u.passport_number} className="text-zinc-500" />
                  <CopyTableCell value={u.phone} className="text-zinc-500 tabular-nums" />
                  <CopyTableCell value={u.role === 'admin' ? 'Системный админ' : (u.role_name || '')}>
                    <span className={u.role === 'admin' ? 'text-amber-400' : 'text-zinc-300'}>
                      {u.role === 'admin' ? 'Админ' : (u.role_name || '—')}
                    </span>
                  </CopyTableCell>
                  <CopyTableCell value={u.profile_active === false ? 'Неактивный' : 'Активный'}>
                    <span className={u.profile_active === false ? 'text-red-400' : 'text-emerald-400'}>
                      {u.profile_active === false ? 'Нет' : 'Да'}
                    </span>
                  </CopyTableCell>
                  <CopyTableCell value={EMPLOYMENT_STATUS_LABELS[u.employment_status] || 'Работает'}>
                    <span className={
                      u.employment_status === 'fired' ? 'text-red-400'
                        : u.employment_status === 'vacation' ? 'text-amber-400'
                          : 'text-zinc-400'
                    }>
                      {EMPLOYMENT_STATUS_LABELS[u.employment_status] || 'Работает'}
                    </span>
                  </CopyTableCell>
                  <td onClick={(e) => e.stopPropagation()}>
                    {(u.labor_contract_count || 0) > 0 ? (
                      <button
                        type="button"
                        onClick={() => openContractsListModal(u)}
                        className="flex items-center gap-0.5 p-0.5 rounded hover:bg-white/10"
                        title={`Документов: ${u.labor_contract_count}`}
                      >
                        {(u.labor_contract_previews || []).map((f) =>
                          renderContractThumb(u.id, f, (file) => openContractView(file, u.id)),
                        )}
                        {(u.labor_contract_count || 0) > (u.labor_contract_previews?.length || 0) && (
                          <span className="text-2xs text-zinc-500">+{(u.labor_contract_count || 0) - (u.labor_contract_previews?.length || 0)}</span>
                        )}
                      </button>
                    ) : (
                      <span className="text-zinc-600">—</span>
                    )}
                  </td>
                  <CopyTableCell value={u.snils} className="text-zinc-500 tabular-nums" />
                  <CopyTableCell value={u.inn} className="text-zinc-500 tabular-nums" />
                  <CopyTableCell value={u.employment_date ? u.employment_date.slice(0, 10) : ''} className="text-zinc-500 tabular-nums whitespace-nowrap" />
                  <CopyTableCell value={u.employment_org} className="text-zinc-500 max-w-[120px] truncate" title={u.employment_org} />
                  <CopyTableCell value={u.internal_uid} className="font-mono text-zinc-500 text-2xs" />
                  <td className="whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    {editing === u.id ? (
                      <span className="text-brand-400 text-2xs">…</span>
                    ) : (
                      <>
                        <button type="button" onClick={() => openEdit(u)} className="btn-ghost px-1 text-2xs">Изм</button>
                        {Number(u.id) !== Number(user?.id) && (
                          <button type="button" onClick={() => openDeleteConfirm(u)} className="btn-ghost px-1 text-2xs text-red-400">Удл</button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {sortedList.length === 0 && (
                <tr>
                  <td colSpan={19} className="p-4 text-center text-zinc-500 text-xs">
                    {list.length === 0 ? 'Нет пользователей' : 'Нет данных по фильтрам'}
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
                <button
                  type="button"
                  onClick={() => {
                    closeContractView();
                    setContractDeleteConfirm(null);
                    setLaborContracts([]);
                    setEditing(null);
                    setShowFaceCamera(false);
                    setFaceVideoEl(null);
                    setError('');
                  }}
                  className="px-4 py-2 rounded-xl text-slate-400 hover:text-white"
                >
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
                : 'Запишите с камеры или загрузите фото с телефона — сохранятся шаблон, фото лица и аватар.'}
            </p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                className="btn-primary text-sm w-full"
                disabled={faceSaving}
                onClick={() => { setError(''); setShowFaceCamera(true); }}
              >
                Записать с камеры
              </button>
              <label
                htmlFor="face-template-file-modal"
                className={`btn-secondary text-sm w-full text-center cursor-pointer ${faceSaving ? 'opacity-50 pointer-events-none' : ''}`}
              >
                {faceSaving ? 'Обработка…' : 'Загрузить фото с телефона'}
              </label>
              <input
                id="face-template-file-modal"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={onFacePhotoFileChange}
                disabled={faceSaving}
              />
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

      {contractsListModal && (
        <div
          className="modal-backdrop z-[67]"
          onClick={() => !contractSaving && setContractsListModal(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="card p-5 max-w-lg w-full max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-white font-medium text-lg mb-1">Документы договора</h3>
            <p className="text-slate-400 text-sm mb-4 font-mono">
              {contractsListModal.user?.login}
              {contractsListModal.user?.first_name || contractsListModal.user?.last_name
                ? ` — ${[contractsListModal.user.first_name, contractsListModal.user.last_name].filter(Boolean).join(' ')}`
                : ''}
            </p>
            {contractsListModal.loading ? (
              <p className="text-slate-400 text-sm">Загрузка…</p>
            ) : contractsListModal.files?.length ? (
              <ul className="space-y-2 overflow-y-auto flex-1 min-h-0 pr-1">
                {contractsListModal.files.map((f) => (
                  <li
                    key={f.id}
                    className="flex items-center gap-3 p-3 rounded-xl bg-slate-800/80 border border-slate-600"
                  >
                    <span className="text-2xl shrink-0">{laborContractIcon(f.mime, f.filename)}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-white truncate" title={f.filename}>{f.filename}</p>
                      {f.created_at && (
                        <p className="text-2xs text-slate-500">
                          {new Date(f.created_at).toLocaleString('ru-RU')}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        className="btn-ghost text-xs px-2"
                        onClick={() => openContractView(f, contractsListModal.user.id)}
                      >
                        Смотреть
                      </button>
                      <button
                        type="button"
                        className="btn-secondary text-xs px-2"
                        onClick={() => downloadContractFile(f, contractsListModal.user.id)}
                      >
                        Скачать
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-slate-500 text-sm">Нет загруженных документов</p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              {editing === contractsListModal.user?.id && (
                <button
                  type="button"
                  className="btn-primary text-sm"
                  onClick={() => {
                    setContractsListModal(null);
                    openEdit(contractsListModal.user);
                  }}
                >
                  Редактировать профиль
                </button>
              )}
              <button
                type="button"
                className="btn-ghost text-sm"
                onClick={() => setContractsListModal(null)}
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {contractView && (
        <div
          className="modal-backdrop z-[68]"
          onClick={closeContractView}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="card p-5 max-w-3xl w-full max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-white font-medium text-lg mb-1 truncate" title={contractView.filename}>
              {contractView.filename}
            </h3>
            <p className="text-slate-500 text-xs mb-3">
              {contractView.created_at
                ? new Date(contractView.created_at).toLocaleString('ru-RU')
                : ''}
            </p>
            <div className="flex-1 min-h-[200px] max-h-[55vh] overflow-auto rounded-lg bg-slate-900 border border-slate-700 mb-4">
              {contractExcelPreview ? (
                <LaborContractExcelPreview data={contractExcelPreview} />
              ) : contractWordPreview ? (
                <LaborContractWordPreview html={contractWordPreview.html} />
              ) : contractPreviewUrl ? (
                (() => {
                  const kind = laborContractCanPreview(contractView.mime, contractView.filename);
                  if (kind === 'pdf') {
                    return (
                      <iframe
                        src={contractPreviewUrl}
                        title={contractView.filename}
                        className="w-full h-[min(50vh,480px)] rounded-lg"
                      />
                    );
                  }
                  if (kind === 'image') {
                    return (
                      <img
                        src={contractPreviewUrl}
                        alt={contractView.filename}
                        className="max-w-full h-auto mx-auto block"
                      />
                    );
                  }
                  return (
                    <p className="p-6 text-slate-400 text-sm text-center">
                      {laborContractPreviewFallback(contractView.mime, contractView.filename)}
                    </p>
                  );
                })()
              ) : laborContractCanPreview(contractView.mime, contractView.filename) ? (
                <p className="p-4 text-slate-400 text-sm">Загрузка…</p>
              ) : (
                <p className="p-6 text-slate-400 text-sm text-center">
                  {laborContractPreviewFallback(contractView.mime, contractView.filename)}
                </p>
              )}
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className="btn-ghost text-sm" onClick={closeContractView}>
                Закрыть
              </button>
              <button
                type="button"
                className="btn-secondary text-sm"
                onClick={() => downloadContractFile(contractView, contractViewUserId)}
              >
                Скачать
              </button>
              {contractViewUserId === editing && editing && (
                <button
                  type="button"
                  className="btn-primary text-sm bg-red-600 hover:bg-red-500 border-red-600"
                  onClick={() => {
                    const f = contractView;
                    closeContractView();
                    setContractDeleteConfirm(f);
                  }}
                >
                  Удалить
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {contractDeleteConfirm && (
        <div
          className="modal-backdrop z-[69]"
          onClick={() => !contractSaving && setContractDeleteConfirm(null)}
          role="dialog"
          aria-modal="true"
        >
          <div className="card p-5 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-white font-medium text-lg mb-3">Удалить файл?</h3>
            <p className="text-slate-300 text-sm mb-1 truncate" title={contractDeleteConfirm.filename}>
              {contractDeleteConfirm.filename}
            </p>
            <p className="text-slate-500 text-xs mb-5">Файл будет удалён из базы данных без возможности восстановления.</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn-ghost text-sm"
                disabled={contractSaving}
                onClick={() => setContractDeleteConfirm(null)}
              >
                Отмена
              </button>
              <button
                type="button"
                className="btn-primary text-sm bg-red-600 hover:bg-red-500 border-red-600"
                disabled={contractSaving}
                onClick={confirmDeleteContractFile}
              >
                {contractSaving ? 'Удаление…' : 'Удалить'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showContractCamera && (
        <div className="fixed inset-0 z-[65] bg-black flex flex-col items-center justify-center p-4">
          <h3 className="text-lg font-medium text-white mb-4">Скан трудового договора</h3>
          <video
            ref={setContractVideoRef}
            autoPlay
            playsInline
            muted
            className="max-w-full max-h-[60vh] rounded-xl bg-black object-contain w-full"
          />
          <div className="flex gap-3 mt-4">
            <button
              type="button"
              onClick={() => setShowContractCamera(false)}
              className="btn-secondary"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={captureContractScan}
              className="btn-primary"
              disabled={contractSaving}
            >
              {contractSaving ? 'Сохранение…' : 'Сохранить скан'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
