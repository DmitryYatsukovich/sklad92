import { Router } from 'express';
import path from 'path';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import pool from '../db/pool.js';
import { requireAuth, loadUser, requirePermission } from '../middleware/auth.js';
import { PERMISSIONS_SELECT } from '../lib/permissions-sql.js';
import {
  resolveUserPermissionsForSave,
  upsertUserPermissions,
} from '../lib/sync-user-permissions-from-role.js';
import {
  saveUserFacePhoto,
  saveUserAvatar,
  readUserAvatar,
  readUserFacePhoto,
  sendImageBuffer,
  HAS_FACE_PHOTO_SQL,
} from '../lib/user-images.js';
import {
  insertLaborContractFile,
  listLaborContractFiles,
  readLaborContractFile,
  deleteLaborContractFile,
  countLaborContractFiles,
  HAS_LABOR_CONTRACT_SQL,
  LABOR_CONTRACT_COUNT_SQL,
  normalizeEmploymentStatus,
  normalizeProfileActive,
  isAllowedLaborContractUpload,
  LABOR_CONTRACT_ACCEPT_HINT,
  attachLaborContractPreviews,
} from '../lib/user-labor-contract.js';
import { parseHourlyRate } from '../lib/hourly-rate.js';
import { resolveEmploymentForSave } from '../lib/organization-employment.js';
import {
  buildTemplateBuffer,
  buildExportBuffer,
  fetchUsersForExport,
  fetchUsersForExportByIds,
  parseImportSheet,
  applyUsersImport,
  previewUsersImport,
} from '../lib/users-excel.js';
import { deleteUserById } from '../lib/delete-user.js';
import { clearUserFaceTemplate } from '../lib/clear-user-face.js';

// memoryStorage — не трогаем диск в multer, запись вручную в try/catch, чтобы сервер не падал
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => (file.mimetype.startsWith('image/') ? cb(null, true) : cb(new Error('Только изображения'))),
});

const contractUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (isAllowedLaborContractUpload(file)) cb(null, true);
    else cb(new Error(`Допустимые файлы: ${LABOR_CONTRACT_ACCEPT_HINT}`));
  },
});

const excelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

const router = Router();

router.use(requireAuth);
router.use(loadUser);
router.use(requirePermission('can_users'));

const userColumns = `u.id, u.login, u.password_plain, u.display_name, u.first_name, u.last_name, u.birth_date,
  u.passport_number, u.snils, u.inn, u.employment_date, u.organization_id, u.employment_org, u.phone, u.hourly_rate,
  u.avatar, u.face_photo, u.role, u.role_id, u.internal_uid, u.kig_card_number, u.kig_card_expires_at, u.created_at,
  COALESCE(u.profile_active, true) AS profile_active,
  COALESCE(u.employment_status, 'working') AS employment_status`;

router.get('/', async (req, res) => {
  const r = await pool.query(
    `SELECT ${userColumns},
            r.name AS role_name,
            (u.face_descriptor IS NOT NULL) AS has_face,
            ${HAS_FACE_PHOTO_SQL} AS has_face_photo,
            ${HAS_LABOR_CONTRACT_SQL} AS has_labor_contract,
            ${LABOR_CONTRACT_COUNT_SQL} AS labor_contract_count,
            ${PERMISSIONS_SELECT}
     FROM users u
     LEFT JOIN user_permissions p ON p.user_id = u.id
     LEFT JOIN roles r ON r.id = u.role_id
     ORDER BY u.login`,
  );
  const rows = await attachLaborContractPreviews(r.rows);
  res.json(rows);
});

router.get('/import-template', (_req, res) => {
  const buf = buildTemplateBuffer();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="shablon-polzovateli.xlsx"');
  res.send(buf);
});

async function sendUsersExport(res, rows) {
  const buf = await buildExportBuffer(rows);
  const date = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="polzovateli-${date}.xlsx"`);
  res.send(buf);
}

router.get('/export', async (_req, res) => {
  try {
    await sendUsersExport(res, await fetchUsersForExport());
  } catch (e) {
    console.error('GET /users/export:', e);
    res.status(500).json({ error: e.message || 'Ошибка выгрузки' });
  }
});

router.post('/export', async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
  try {
    const rows = ids?.length
      ? await fetchUsersForExportByIds(ids)
      : await fetchUsersForExport();
    if (!rows.length) {
      return res.status(400).json({ error: 'Нет данных для выгрузки' });
    }
    await sendUsersExport(res, rows);
  } catch (e) {
    console.error('POST /users/export:', e);
    res.status(500).json({ error: e.message || 'Ошибка выгрузки' });
  }
});

router.post('/import/preview', excelUpload.single('file'), async (req, res) => {
  if (!req.file?.buffer) {
    return res.status(400).json({ error: 'Выберите файл Excel (.xlsx)' });
  }
  try {
    const preview = await previewUsersImport(req.file.buffer);
    res.json(preview);
  } catch (e) {
    return res.status(400).json({ error: e.message || 'Ошибка чтения файла' });
  }
});

router.post('/import', excelUpload.single('file'), async (req, res) => {
  if (!req.file?.buffer) {
    return res.status(400).json({ error: 'Выберите файл Excel (.xlsx)' });
  }
  let items;
  try {
    items = await parseImportSheet(req.file.buffer);
  } catch (e) {
    return res.status(400).json({ error: e.message || 'Ошибка чтения файла' });
  }
  try {
    const result = await applyUsersImport(items, {
      userId: req.session.userId,
      role: req.user?.role,
    });
    res.json(result);
  } catch (e) {
    console.error('POST /users/import:', e);
    res.status(500).json({ error: e.message || 'Ошибка импорта' });
  }
});

router.post('/:id/avatar', (req, res, next) => {
  upload.single('avatar')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Ошибка загрузки' });
    next();
  });
}, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!req.file || !req.file.buffer) return res.status(400).json({ error: 'Загрузите изображение' });
    const ext = (path.extname(req.file.originalname) || '.jpg').toLowerCase().replace(/[^a-z]/g, '') || 'jpg';
    const filename = await saveUserAvatar(id, req.file.buffer, ext);
    res.json({ avatar: filename });
  } catch (e) {
    console.error('Avatar upload error:', e);
    res.status(500).json({ error: 'Ошибка сохранения фото' });
  }
});

router.post('/:id/face-photo', (req, res, next) => {
  upload.single('face')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Ошибка загрузки' });
    next();
  });
}, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!req.file || !req.file.buffer) return res.status(400).json({ error: 'Загрузите фото лица' });
    const ext = (path.extname(req.file.originalname) || '.jpg').toLowerCase().replace(/[^a-z]/g, '') || 'jpg';
    const filename = await saveUserFacePhoto(id, req.file.buffer, ext);
    res.json({ face_photo: filename });
  } catch (e) {
    console.error('Face photo upload error:', e);
    res.status(500).json({ error: 'Ошибка сохранения фото лица' });
  }
});

router.get('/:id/face-photo', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const img = await readUserFacePhoto(id);
    if (!img?.buffer?.length) return res.status(404).send();
    sendImageBuffer(res, img.buffer, img.mime);
  } catch (e) {
    console.error('Face photo serve error:', e);
    res.status(500).send();
  }
});

router.delete('/:id/face-template', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Некорректный id' });
    const ok = await clearUserFaceTemplate(id);
    if (!ok) return res.status(404).json({ error: 'Пользователь не найден' });
    const u = (await pool.query(
      `SELECT ${userColumns},
              (u.face_descriptor IS NOT NULL) AS has_face,
              ${HAS_FACE_PHOTO_SQL} AS has_face_photo
       FROM users u WHERE u.id = $1`,
      [id],
    )).rows[0];
    res.json(u);
  } catch (e) {
    console.error('DELETE /users/:id/face-template:', e);
    res.status(500).json({ error: e.message || 'Ошибка удаления шаблона' });
  }
});

router.get('/:id/avatar', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const img = await readUserAvatar(id);
    if (!img?.buffer?.length) return res.status(404).send();
    sendImageBuffer(res, img.buffer, img.mime);
  } catch (e) {
    console.error('Avatar serve error:', e);
    res.status(500).send();
  }
});

router.get('/:id/labor-contracts', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const exists = (await pool.query('SELECT id FROM users WHERE id = $1', [id])).rows[0];
    if (!exists) return res.status(404).json({ error: 'Пользователь не найден' });
    const files = await listLaborContractFiles(id);
    res.json({
      files,
      count: files.length,
      has_labor_contract: files.length > 0,
    });
  } catch (e) {
    console.error('GET labor-contracts:', e);
    res.status(500).json({ error: e.message || 'Ошибка загрузки списка' });
  }
});

router.post('/:id/labor-contracts', (req, res, next) => {
  contractUpload.array('contract', 30)(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Ошибка загрузки' });
    next();
  });
}, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const exists = (await pool.query('SELECT id FROM users WHERE id = $1', [id])).rows[0];
    if (!exists) return res.status(404).json({ error: 'Пользователь не найден' });
    const uploads = Array.isArray(req.files) ? req.files : (req.file ? [req.file] : []);
    if (!uploads.length) {
      return res.status(400).json({ error: `Выберите файлы: ${LABOR_CONTRACT_ACCEPT_HINT}` });
    }
    const saved = [];
    for (const f of uploads) {
      if (!f.buffer?.length) continue;
      const row = await insertLaborContractFile(
        pool,
        id,
        f.buffer,
        f.mimetype || 'application/octet-stream',
        f.originalname || `trudovoj-dogovor-${id}`,
      );
      saved.push(row);
    }
    if (!saved.length) {
      return res.status(400).json({ error: 'Не удалось сохранить файлы' });
    }
    const count = await countLaborContractFiles(id);
    res.status(201).json({
      ok: true,
      files: saved,
      count,
      has_labor_contract: count > 0,
    });
  } catch (e) {
    console.error('POST labor-contracts:', e);
    res.status(500).json({ error: e.message || 'Ошибка сохранения договора' });
  }
});

router.get('/:id/labor-contracts/:fileId', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const fileId = parseInt(req.params.fileId, 10);
    const doc = await readLaborContractFile(id, fileId);
    if (!doc?.buffer?.length) return res.status(404).send();
    const encoded = encodeURIComponent(doc.filename);
    const inline = req.query.inline === '1' || req.query.view === '1';
    res.setHeader('Content-Type', doc.mime);
    res.setHeader(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encoded}`,
    );
    res.send(doc.buffer);
  } catch (e) {
    console.error('GET labor-contract file:', e);
    res.status(500).send();
  }
});

router.delete('/:id/labor-contracts/:fileId', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const fileId = parseInt(req.params.fileId, 10);
    const ok = await deleteLaborContractFile(id, fileId);
    if (!ok) return res.status(404).json({ error: 'Файл не найден' });
    const count = await countLaborContractFiles(id);
    res.json({ ok: true, count, has_labor_contract: count > 0 });
  } catch (e) {
    console.error('DELETE labor-contract file:', e);
    res.status(500).json({ error: e.message || 'Ошибка удаления' });
  }
});

router.post('/', async (req, res) => {
  const {
    login, password, first_name, last_name, birth_date, passport_number, snils, inn, employment_date, organization_id, employment_org, phone, hourly_rate,
    role, role_id,
    internal_uid, kig_card_number, kig_card_expires_at, face_descriptor,
    profile_active, employment_status,
  } = req.body || {};
  const loginTrim = login?.trim();
  const passwordRaw = typeof password === 'string' ? password : '';
  if (!loginTrim || !passwordRaw) {
    return res.status(400).json({ error: 'Укажите логин и пароль' });
  }
  const hash = await bcrypt.hash(passwordRaw, 10);
  const displayName = [first_name, last_name].filter(Boolean).join(' ').trim() || null;
  let faceJson = null;
  if (Array.isArray(face_descriptor) && face_descriptor.length >= 128) {
    faceJson = JSON.stringify(face_descriptor.map((x) => Number(x)));
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const employment = await resolveEmploymentForSave(client, { organization_id, employment_org });
    if (employment?.error) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: employment.error });
    }
    let orgId = null;
    let orgName = (employment_org || '').trim() || null;
    if (employment) {
      orgId = employment.organization_id;
      orgName = employment.employment_org;
    }
    const u = await client.query(
      `INSERT INTO users (login, password_hash, password_plain, display_name, first_name, last_name, birth_date, passport_number, snils, inn, employment_date, organization_id, employment_org, phone, hourly_rate, role, role_id, internal_uid, kig_card_number, kig_card_expires_at, face_descriptor, profile_active, employment_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21::jsonb, $22, $23)
       RETURNING id, login, password_plain, display_name, first_name, last_name, birth_date, passport_number, snils, inn, employment_date, organization_id, employment_org, phone, hourly_rate, role, role_id, internal_uid, kig_card_number, kig_card_expires_at, created_at, profile_active, employment_status`,
      [
        loginTrim, hash, passwordRaw, displayName,
        (first_name || '').trim() || null, (last_name || '').trim() || null,
        birth_date || null, (passport_number || '').trim() || null, (snils || '').trim() || null, (inn || '').trim() || null,
        employment_date || null, orgId, orgName, (phone || '').trim() || null,
        parseHourlyRate(hourly_rate) ?? null,
        role === 'admin' ? 'admin' : 'user',
        role_id && !isNaN(role_id) ? parseInt(role_id, 10) : null,
        (internal_uid || '').toString().trim() || null,
        (kig_card_number || '').toString().trim() || null,
        kig_card_expires_at || null,
        faceJson,
        normalizeProfileActive(profile_active),
        normalizeEmploymentStatus(employment_status),
      ]
    );
    const user = u.rows[0];
    const perms = await resolveUserPermissionsForSave(client, {
      systemRole: role === 'admin' ? 'admin' : 'user',
      role_id,
    });
    await upsertUserPermissions(client, user.id, perms);
    await client.query('COMMIT');
    res.status(201).json({
      ...user,
      has_face: !!faceJson,
      has_face_photo: false,
      has_labor_contract: false,
    });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    if (e.code === '23505') return res.status(400).json({ error: 'Такой логин уже существует' });
    throw e;
  } finally {
    client.release();
  }
});

router.put('/:id', async (req, res) => {
  let client;
  try {
    const id = parseInt(req.params.id, 10);
    const body = req.body || {};
    const {
      login, password, first_name, last_name, birth_date, passport_number, snils, inn, employment_date, organization_id, employment_org, phone, hourly_rate,
      role, role_id,
      internal_uid, kig_card_number, kig_card_expires_at, face_descriptor,
      profile_active, employment_status,
    } = body;
    if (!id) return res.status(400).json({ error: 'Неверный id' });

    client = await pool.connect();
    const employmentResolved = await resolveEmploymentForSave(client, { organization_id, employment_org });
    if (employmentResolved?.error) {
      client.release();
      return res.status(400).json({ error: employmentResolved.error });
    }
    const isAdmin = req.user.role === 'admin';
    const target = (await client.query(
      'SELECT id, role, (face_descriptor IS NOT NULL) AS has_face FROM users WHERE id = $1',
      [id],
    )).rows[0];
    if (!target) return res.status(404).json({ error: 'Пользователь не найден' });

    const newFace = Array.isArray(face_descriptor) && face_descriptor.length >= 128;

    let hash = null;
    if (password && password.length > 0) hash = await bcrypt.hash(password, 10);

    if (login !== undefined && login != null) await client.query('UPDATE users SET login = $1 WHERE id = $2', [String(login).trim(), id]);
    if (first_name !== undefined) await client.query('UPDATE users SET first_name = $2 WHERE id = $1', [id, (first_name || '').trim() || null]);
    if (last_name !== undefined) await client.query('UPDATE users SET last_name = $2 WHERE id = $1', [id, (last_name || '').trim() || null]);
    if (birth_date !== undefined) await client.query('UPDATE users SET birth_date = $2 WHERE id = $1', [id, birth_date || null]);
    if (passport_number !== undefined) await client.query('UPDATE users SET passport_number = $2 WHERE id = $1', [id, (passport_number || '').trim() || null]);
    if (snils !== undefined) await client.query('UPDATE users SET snils = $2 WHERE id = $1', [id, (snils || '').trim() || null]);
    if (inn !== undefined) await client.query('UPDATE users SET inn = $2 WHERE id = $1', [id, (inn || '').trim() || null]);
    if (employment_date !== undefined) await client.query('UPDATE users SET employment_date = $2 WHERE id = $1', [id, employment_date || null]);
    if (employmentResolved) {
      await client.query(
        'UPDATE users SET organization_id = $2, employment_org = $3 WHERE id = $1',
        [id, employmentResolved.organization_id, employmentResolved.employment_org],
      );
    }
    if (phone !== undefined) await client.query('UPDATE users SET phone = $2 WHERE id = $1', [id, (phone || '').trim() || null]);
    if (Object.prototype.hasOwnProperty.call(body, 'hourly_rate')) {
      await client.query('UPDATE users SET hourly_rate = $2 WHERE id = $1', [id, parseHourlyRate(body.hourly_rate)]);
    }
    if (hash) {
      await client.query(
        'UPDATE users SET password_hash = $2, password_plain = $3 WHERE id = $1',
        [id, hash, password],
      );
    }
    if (first_name !== undefined || last_name !== undefined) {
      const { rows: [u] } = await client.query('SELECT first_name, last_name FROM users WHERE id = $1', [id]);
      const displayName = [u?.first_name, u?.last_name].filter(Boolean).join(' ').trim() || null;
      await client.query('UPDATE users SET display_name = $2 WHERE id = $1', [id, displayName]);
    }
    if (role !== undefined && isAdmin) {
      await client.query('UPDATE users SET role = $2 WHERE id = $1', [id, role === 'admin' ? 'admin' : 'user']);
    }
    if (role_id !== undefined) {
      await client.query('UPDATE users SET role_id = $2 WHERE id = $1', [id, role_id && !isNaN(role_id) ? parseInt(role_id, 10) : null]);
    }
    if (internal_uid !== undefined) {
      await client.query('UPDATE users SET internal_uid = $2 WHERE id = $1', [id, (internal_uid || '').toString().trim() || null]);
    }
    if (kig_card_number !== undefined) {
      await client.query(
        'UPDATE users SET kig_card_number = $2 WHERE id = $1',
        [id, (kig_card_number || '').toString().trim() || null],
      );
    }
    if (kig_card_expires_at !== undefined) {
      await client.query(
        'UPDATE users SET kig_card_expires_at = $2 WHERE id = $1',
        [id, kig_card_expires_at || null],
      );
    }
    if (profile_active !== undefined) {
      const nextActive = normalizeProfileActive(profile_active);
      if (Number(id) === Number(req.session.userId) && !nextActive) {
        client.release();
        return res.status(400).json({ error: 'Нельзя сделать неактивным свою учётную запись' });
      }
      await client.query('UPDATE users SET profile_active = $2 WHERE id = $1', [id, nextActive]);
    }
    if (employment_status !== undefined) {
      const nextStatus = normalizeEmploymentStatus(employment_status);
      if (Number(id) === Number(req.session.userId) && nextStatus === 'fired') {
        client.release();
        return res.status(400).json({ error: 'Нельзя установить себе статус «Уволен»' });
      }
      await client.query('UPDATE users SET employment_status = $2 WHERE id = $1', [id, nextStatus]);
    }
    if (newFace) {
      await client.query('UPDATE users SET face_descriptor = $2::jsonb WHERE id = $1', [
        id,
        JSON.stringify(face_descriptor.map((x) => Number(x))),
      ]);
    }

    const effectiveRole =
      role !== undefined && isAdmin ? (role === 'admin' ? 'admin' : 'user') : target.role;
    let effectiveRoleId = null;
    if (role_id !== undefined) {
      effectiveRoleId = role_id && !isNaN(role_id) ? parseInt(role_id, 10) : null;
    } else {
      const cr = (await client.query('SELECT role_id FROM users WHERE id = $1', [id])).rows[0];
      effectiveRoleId = cr?.role_id ?? null;
    }
    const perms = await resolveUserPermissionsForSave(client, {
      systemRole: effectiveRole,
      role_id: effectiveRoleId,
    });
    await upsertUserPermissions(client, id, perms);

    const u = (await client.query(
      `SELECT ${userColumns},
              (u.face_descriptor IS NOT NULL) AS has_face,
              ${HAS_FACE_PHOTO_SQL} AS has_face_photo,
              ${HAS_LABOR_CONTRACT_SQL} AS has_labor_contract,
              ${LABOR_CONTRACT_COUNT_SQL} AS labor_contract_count
       FROM users u WHERE u.id = $1`,
      [id],
    )).rows[0];
    res.json(u);
  } catch (e) {
    console.error('PUT /users/:id error:', e);
    res.status(500).json({ error: e.message || 'Ошибка сохранения' });
  } finally {
    if (client) client.release();
  }
});

router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Некорректный id' });
  if (Number(req.session.userId) === id) {
    return res.status(400).json({ error: 'Нельзя удалить себя' });
  }
  try {
    const deleted = await deleteUserById(id);
    if (!deleted) return res.status(404).json({ error: 'Пользователь не найден' });
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /users/:id:', e);
    if (e.code === '23503') {
      return res.status(409).json({
        error: 'Нельзя удалить: у пользователя есть связанные данные в системе',
      });
    }
    res.status(500).json({ error: e.message || 'Ошибка удаления' });
  }
});

export default router;
