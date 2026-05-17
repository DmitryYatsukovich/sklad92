import { Router } from 'express';
import bcrypt from 'bcryptjs';
import pool from '../db/pool.js';
import { loadUser } from '../middleware/auth.js';

const router = Router();

router.post('/login', async (req, res) => {
  const { login, password } = req.body || {};
  if (!login || !password) {
    return res.status(400).json({ error: 'Укажите логин и пароль' });
  }
  const r = await pool.query(
    'SELECT id, login, password_hash, display_name, role FROM users WHERE login = $1',
    [login.trim()]
  );
  const user = r.rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }
  const perm = await pool.query(
    `SELECT COALESCE(p.can_warehouse, r.can_warehouse, true) AS can_warehouse,
            COALESCE(p.can_issuance, r.can_issuance, true) AS can_issuance,
            COALESCE(p.can_production, r.can_production, true) AS can_production,
            (u.role = 'admin' OR COALESCE(p.can_users, r.can_users, false)) AS can_users,
            (u.role = 'admin' OR COALESCE(p.can_attendance, r.can_attendance, false)) AS can_attendance
     FROM users u
     LEFT JOIN user_permissions p ON p.user_id = u.id
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE u.id = $1`,
    [user.id]
  );
  const p = perm.rows[0] || {};
  req.session.userId = user.id;
  req.session.save((err) => {
    if (err) return res.status(500).json({ error: 'Ошибка сессии' });
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
      },
    });
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
    },
  });
});

export default router;
