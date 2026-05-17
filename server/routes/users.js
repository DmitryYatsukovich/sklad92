import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import pool from '../db/pool.js';
import { requireAuth, loadUser, requirePermission } from '../middleware/auth.js';
import { PERMISSIONS_SELECT } from '../lib/permissions-sql.js';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.resolve(__dirname, '../uploads/avatars');

function ensureUploadsDir() {
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
}

// memoryStorage — не трогаем диск в multer, запись вручную в try/catch, чтобы сервер не падал
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => (file.mimetype.startsWith('image/') ? cb(null, true) : cb(new Error('Только изображения'))),
});

const router = Router();

router.use(requireAuth);
router.use(loadUser);
router.use(requirePermission('can_users'));

const userColumns = 'u.id, u.login, u.display_name, u.first_name, u.last_name, u.birth_date, u.passport_number, u.snils, u.inn, u.employment_date, u.employment_org, u.phone, u.avatar, u.role, u.role_id, u.internal_uid, u.created_at';

router.get('/', async (req, res) => {
  const r = await pool.query(
    `SELECT ${userColumns},
            (u.face_descriptor IS NOT NULL) AS has_face,
            ${PERMISSIONS_SELECT}
     FROM users u
     LEFT JOIN user_permissions p ON p.user_id = u.id
     LEFT JOIN roles r ON r.id = u.role_id
     ORDER BY u.login`
  );
  res.json(r.rows);
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
    const filename = `${id}.${ext}`;
    ensureUploadsDir();
    fs.writeFileSync(path.join(uploadsDir, filename), req.file.buffer);
    await pool.query('UPDATE users SET avatar = $1 WHERE id = $2', [filename, id]);
    res.json({ avatar: filename });
  } catch (e) {
    console.error('Avatar upload error:', e);
    res.status(500).json({ error: 'Ошибка сохранения фото' });
  }
});

router.get('/:id/avatar', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const r = await pool.query('SELECT avatar FROM users WHERE id = $1', [id]);
    const filename = r.rows[0]?.avatar;
    if (!filename) return res.status(404).send();
    const filepath = path.join(uploadsDir, filename);
    if (!fs.existsSync(filepath)) return res.status(404).send();
    res.sendFile(path.resolve(filepath));
  } catch (e) {
    console.error('Avatar serve error:', e);
    res.status(500).send();
  }
});

router.post('/', async (req, res) => {
  const {
    login, password, first_name, last_name, birth_date, passport_number, snils, inn, employment_date, employment_org, phone,
    role, role_id, can_warehouse, can_issuance, can_production, can_users, can_attendance, internal_uid, face_descriptor,
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
    const u = await client.query(
      `INSERT INTO users (login, password_hash, display_name, first_name, last_name, birth_date, passport_number, snils, inn, employment_date, employment_org, phone, role, role_id, internal_uid, face_descriptor)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb)
       RETURNING id, login, display_name, first_name, last_name, birth_date, passport_number, snils, inn, employment_date, employment_org, phone, role, role_id, internal_uid, created_at`,
      [
        loginTrim, hash, displayName,
        (first_name || '').trim() || null, (last_name || '').trim() || null,
        birth_date || null, (passport_number || '').trim() || null, (snils || '').trim() || null, (inn || '').trim() || null,
        employment_date || null, (employment_org || '').trim() || null, (phone || '').trim() || null,
        role === 'admin' ? 'admin' : 'user',
        role_id && !isNaN(role_id) ? parseInt(role_id, 10) : null,
        (internal_uid || '').toString().trim() || null,
        faceJson,
      ]
    );
    const user = u.rows[0];
    await client.query(
      `INSERT INTO user_permissions (user_id, can_warehouse, can_issuance, can_production, can_users, can_attendance)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) DO UPDATE SET
         can_warehouse = $2, can_issuance = $3, can_production = $4, can_users = $5, can_attendance = $6`,
      [user.id, !!can_warehouse, !!can_issuance, !!can_production, role === 'admin' || !!can_users, !!can_attendance]
    );
    res.status(201).json({ ...user, has_face: !!faceJson });
  } catch (e) {
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
      login, password, first_name, last_name, birth_date, passport_number, snils, inn, employment_date, employment_org, phone,
      role, role_id, can_warehouse, can_issuance, can_production, can_users, can_attendance, internal_uid, face_descriptor,
    } = body;
    if (!id) return res.status(400).json({ error: 'Неверный id' });

    client = await pool.connect();
    const isAdmin = req.user.role === 'admin';
    const target = (await client.query('SELECT id, role FROM users WHERE id = $1', [id])).rows[0];
    if (!target) return res.status(404).json({ error: 'Пользователь не найден' });

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
    if (employment_org !== undefined) await client.query('UPDATE users SET employment_org = $2 WHERE id = $1', [id, (employment_org || '').trim() || null]);
    if (phone !== undefined) await client.query('UPDATE users SET phone = $2 WHERE id = $1', [id, (phone || '').trim() || null]);
    if (hash) await client.query('UPDATE users SET password_hash = $2 WHERE id = $1', [id, hash]);
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
    if (face_descriptor !== undefined && Array.isArray(face_descriptor) && face_descriptor.length >= 128) {
      await client.query('UPDATE users SET face_descriptor = $2::jsonb WHERE id = $1', [
        id,
        JSON.stringify(face_descriptor.map((x) => Number(x))),
      ]);
    }

    await client.query(
      `INSERT INTO user_permissions (user_id, can_warehouse, can_issuance, can_production, can_users, can_attendance)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) DO UPDATE SET
         can_warehouse = $2, can_issuance = $3, can_production = $4, can_users = $5, can_attendance = $6`,
      [id, !!can_warehouse, !!can_issuance, !!can_production, role === 'admin' || !!can_users, !!can_attendance]
    );

    const u = (await client.query(
      `SELECT ${userColumns}, (u.face_descriptor IS NOT NULL) AS has_face FROM users u WHERE u.id = $1`,
      [id]
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
  if (req.session.userId === id) return res.status(400).json({ error: 'Нельзя удалить себя' });
  const r = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id', [id]);
  if (r.rowCount === 0) return res.status(404).json({ error: 'Пользователь не найден' });
  res.json({ ok: true });
});

export default router;
