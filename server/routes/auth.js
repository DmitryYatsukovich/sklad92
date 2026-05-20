import { Router } from 'express';
import bcrypt from 'bcryptjs';
import pool from '../db/pool.js';
import { loadUser } from '../middleware/auth.js';
import { PERMISSIONS_SELECT } from '../lib/permissions-sql.js';

const router = Router();

router.post('/login', async (req, res) => {
  const login = (req.body?.login || '').trim();
  const password = req.body?.password ?? '';
  if (!login || !password) {
    return res.status(400).json({ error: 'Укажите логин и пароль' });
  }
  const r = await pool.query(
    'SELECT id, login, password_hash, display_name, role FROM users WHERE LOWER(TRIM(login)) = LOWER($1)',
    [login]
  );
  const user = r.rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }
  const perm = await pool.query(
    `SELECT ${PERMISSIONS_SELECT}
     FROM users u
     LEFT JOIN user_permissions p ON p.user_id = u.id
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE u.id = $1`,
    [user.id]
  );
  const p = perm.rows[0] || {};
  const hasAnyAccess =
    user.role === 'admin' ||
    p.can_warehouse ||
    p.can_issuance ||
    p.can_production ||
    p.can_users ||
    p.can_attendance ||
    p.can_settings ||
    p.can_face;
  if (!hasAnyAccess) {
    return res.status(403).json({
      error: 'Нет назначенных прав доступа. Обратитесь к администратору.',
    });
  }
  req.session.userId = user.id;
  try {
    await new Promise((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    console.error('session.save:', err);
    return res.status(500).json({ error: 'Ошибка сессии' });
  }
  res.json({
    user: {
      id: user.id,
      login: user.login,
      display_name: user.display_name,
      role: user.role,
      can_warehouse: !!p.can_warehouse,
      can_issuance: !!p.can_issuance,
      can_production: !!p.can_production,
      can_users: !!p.can_users,
      can_attendance: !!p.can_attendance,
      can_settings: !!p.can_settings,
      can_face: !!p.can_face,
    },
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

router.get('/me', loadUser, (req, res) => {
  if (!req.user) return res.json({ user: null });
  res.json({
    user: {
      id: req.user.id,
      login: req.user.login,
      display_name: req.user.display_name,
      role: req.user.role,
      can_warehouse: !!req.user.can_warehouse,
      can_issuance: !!req.user.can_issuance,
      can_production: !!req.user.can_production,
      can_users: !!req.user.can_users,
      can_attendance: !!req.user.can_attendance,
      can_settings: !!req.user.can_settings,
      can_face: !!req.user.can_face,
    },
  });
});

export default router;
