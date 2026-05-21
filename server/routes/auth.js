import { Router } from 'express';
import bcrypt from 'bcryptjs';
import pool from '../db/pool.js';
import { loadUser } from '../middleware/auth.js';
import { PERMISSIONS_SELECT } from '../lib/permissions-sql.js';
import { PERMISSION_KEYS } from '../lib/app-permissions.js';

const router = Router();

function userPayload(base, perms = {}) {
  return {
    id: base.id,
    login: base.login,
    display_name: base.display_name,
    role: base.role,
    ...Object.fromEntries(PERMISSION_KEYS.map((k) => [k, !!perms[k]])),
  };
}

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
    user.role === 'admin' || PERMISSION_KEYS.some((k) => p[k]);
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
  res.json({ user: userPayload(user, p) });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

router.get('/me', loadUser, (req, res) => {
  if (!req.user) return res.json({ user: null });
  res.json({ user: userPayload(req.user, req.user) });
});

export default router;
