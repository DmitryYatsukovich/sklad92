import { Router } from 'express';
import pool from '../db/pool.js';
import { requireAuth, loadUser, requirePermission } from '../middleware/auth.js';
import { canViewAllTasks } from '../lib/tasks-access.js';
import { sendTaskAssignedPush } from '../lib/push-notifications.js';

const router = Router();

router.use(requireAuth);
router.use(loadUser);
router.use(requirePermission('can_tasks'));

function parsePositiveInt(value) {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function parseDueAt(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function normalizeTaskRow(row) {
  const dueMs = row?.due_at ? Date.parse(row.due_at) : NaN;
  const overdue = Number.isFinite(dueMs)
    && row.status !== 'completed'
    && dueMs < Date.now();
  const visibleStatus = overdue ? 'overdue' : row.status;
  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    status: row.status,
    visible_status: visibleStatus,
    due_at: row.due_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    extended_at: row.extended_at,
    completed_at: row.completed_at,
    object_id: row.object_id,
    object_name: row.object_name || '',
    assigned_user_id: row.assigned_user_id,
    assigned_user_name: row.assigned_user_name || row.assigned_user_login || '',
    created_by_user_id: row.created_by_user_id,
    created_by_user_name: row.created_by_user_name || row.created_by_user_login || '',
  };
}

function buildSummary(items) {
  const summary = {
    pending: 0,
    extended: 0,
    overdue: 0,
    completed: 0,
    total: items.length,
  };
  for (const row of items) {
    if (row.visible_status === 'completed') summary.completed += 1;
    else if (row.visible_status === 'overdue') summary.overdue += 1;
    else if (row.visible_status === 'extended') summary.extended += 1;
    else summary.pending += 1;
  }
  return summary;
}

function actorDisplayName(user) {
  return user?.display_name || user?.login || 'Система';
}

function buildTaskAssignedPayload(task, actorName, reassigned = false) {
  const dueAt = task?.due_at || null;
  const dueText = dueAt
    ? (() => {
      const d = new Date(dueAt);
      if (Number.isNaN(d.getTime())) return 'Без срока';
      return d.toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    })()
    : 'Без срока';
  const title = reassigned ? 'Задача назначена вам' : 'Новая задача';
  return {
    taskId: task?.id || null,
    title,
    body: `${task?.title || 'Без названия'} · срок ${dueText}`,
    taskTitle: task?.title || '',
    dueAt,
    objectName: task?.object_name || '',
    assignedBy: actorName,
  };
}

async function findTaskForUpdate(client, taskId, { userId, viewAll }) {
  const q = await client.query(
    `SELECT t.id, t.title, t.description, t.object_id, t.assigned_user_id, t.created_by_user_id,
            t.status, t.due_at, t.extended_at, t.completed_at, t.created_at, t.updated_at
     FROM tasks t
     WHERE t.id = $1
       AND ($2::boolean OR t.assigned_user_id = $3)
     LIMIT 1`,
    [taskId, viewAll, userId],
  );
  return q.rows[0] || null;
}

async function readTaskList(client, { userId, viewAll }) {
  const r = await client.query(
    `SELECT t.id, t.title, t.description, t.object_id, t.assigned_user_id, t.created_by_user_id,
            t.status, t.due_at, t.extended_at, t.completed_at, t.created_at, t.updated_at,
            o.name AS object_name,
            au.display_name AS assigned_user_name, au.login AS assigned_user_login,
            cu.display_name AS created_by_user_name, cu.login AS created_by_user_login
     FROM tasks t
     LEFT JOIN warehouse_objects o ON o.id = t.object_id
     LEFT JOIN users au ON au.id = t.assigned_user_id
     LEFT JOIN users cu ON cu.id = t.created_by_user_id
     WHERE ($1::boolean OR t.assigned_user_id = $2)
     ORDER BY
       t.due_at ASC,
       t.created_at DESC,
       t.id DESC`,
    [viewAll, userId],
  );
  return r.rows.map(normalizeTaskRow);
}

router.get('/meta', async (req, res) => {
  const viewAll = canViewAllTasks(req.user);
  try {
    const [usersResult, objectsResult] = await Promise.all([
      pool.query(
        `SELECT id, login, display_name
         FROM users
         WHERE COALESCE(profile_active, true) = true
           AND COALESCE(employment_status, 'working') <> 'fired'
           AND ($1::boolean OR id = $2)
         ORDER BY display_name NULLS LAST, login`,
        [viewAll, req.user.id],
      ),
      pool.query(
        `SELECT id, name
         FROM warehouse_objects
         ORDER BY name`,
      ),
    ]);
    res.json({
      viewAll,
      users: usersResult.rows.map((u) => ({
        id: u.id,
        login: u.login,
        display_name: u.display_name || u.login,
      })),
      objects: objectsResult.rows,
    });
  } catch (e) {
    console.error('GET /api/tasks/meta:', e);
    res.status(500).json({ error: 'Ошибка загрузки справочников задач' });
  }
});

router.get('/', async (req, res) => {
  const viewAll = canViewAllTasks(req.user);
  const client = await pool.connect();
  try {
    const items = await readTaskList(client, { userId: req.user.id, viewAll });
    res.json({
      viewAll,
      summary: buildSummary(items),
      items,
    });
  } catch (e) {
    console.error('GET /api/tasks:', e);
    res.status(500).json({ error: 'Ошибка загрузки задач' });
  } finally {
    client.release();
  }
});

router.post('/', async (req, res) => {
  const viewAll = canViewAllTasks(req.user);
  const title = String(req.body?.title || '').trim();
  const description = String(req.body?.description || '').trim() || null;
  const objectId = parsePositiveInt(req.body?.object_id);
  const assignedUserId = parsePositiveInt(req.body?.assigned_user_id);
  const dueAt = parseDueAt(req.body?.due_at);

  if (!title) return res.status(400).json({ error: 'Укажите название задачи' });
  if (!objectId) return res.status(400).json({ error: 'Выберите объект' });
  if (!assignedUserId) return res.status(400).json({ error: 'Выберите исполнителя' });
  if (!dueAt) return res.status(400).json({ error: 'Укажите дату и время выполнения' });
  if (!viewAll && assignedUserId !== req.user.id) {
    return res.status(403).json({ error: 'Можно назначать только задачи себе' });
  }

  const client = await pool.connect();
  try {
    const [objectExists, userExists] = await Promise.all([
      client.query('SELECT id FROM warehouse_objects WHERE id = $1', [objectId]),
      client.query(
        `SELECT id
         FROM users
         WHERE id = $1
           AND COALESCE(profile_active, true) = true
           AND COALESCE(employment_status, 'working') <> 'fired'`,
        [assignedUserId],
      ),
    ]);
    if (!objectExists.rows[0]) return res.status(400).json({ error: 'Объект не найден' });
    if (!userExists.rows[0]) return res.status(400).json({ error: 'Исполнитель не найден' });

    const ins = await client.query(
      `INSERT INTO tasks (
         title, description, object_id, assigned_user_id, created_by_user_id,
         status, due_at
       )
       VALUES ($1, $2, $3, $4, $5, 'pending', $6::timestamptz)
       RETURNING id`,
      [title, description, objectId, assignedUserId, req.user.id, dueAt],
    );
    const taskId = ins.rows[0]?.id;
    const items = await readTaskList(client, { userId: req.user.id, viewAll });
    const created = items.find((row) => row.id === taskId);
    if (!created) return res.status(404).json({ error: 'Задача не найдена' });
    sendTaskAssignedPush(
      Number(created.assigned_user_id),
      buildTaskAssignedPayload(created, actorDisplayName(req.user), false),
    ).catch((err) => {
      console.error('push send create task:', err?.message || err);
    });
    res.status(201).json(created);
  } catch (e) {
    console.error('POST /api/tasks:', e);
    res.status(500).json({ error: 'Ошибка создания задачи' });
  } finally {
    client.release();
  }
});

router.put('/:id', async (req, res) => {
  const viewAll = canViewAllTasks(req.user);
  const taskId = parsePositiveInt(req.params.id);
  if (!taskId) return res.status(400).json({ error: 'Неверный id задачи' });

  const title = String(req.body?.title || '').trim();
  const description = String(req.body?.description || '').trim() || null;
  const objectId = parsePositiveInt(req.body?.object_id);
  const assignedUserId = parsePositiveInt(req.body?.assigned_user_id);
  const dueAt = parseDueAt(req.body?.due_at);

  if (!title) return res.status(400).json({ error: 'Укажите название задачи' });
  if (!objectId) return res.status(400).json({ error: 'Выберите объект' });
  if (!assignedUserId) return res.status(400).json({ error: 'Выберите исполнителя' });
  if (!dueAt) return res.status(400).json({ error: 'Укажите дату и время выполнения' });
  if (!viewAll && assignedUserId !== req.user.id) {
    return res.status(403).json({ error: 'Можно назначать только задачи себе' });
  }

  const client = await pool.connect();
  try {
    const current = await findTaskForUpdate(client, taskId, { userId: req.user.id, viewAll });
    if (!current) return res.status(404).json({ error: 'Задача не найдена' });

    const [objectExists, userExists] = await Promise.all([
      client.query('SELECT id FROM warehouse_objects WHERE id = $1', [objectId]),
      client.query(
        `SELECT id
         FROM users
         WHERE id = $1
           AND COALESCE(profile_active, true) = true
           AND COALESCE(employment_status, 'working') <> 'fired'`,
        [assignedUserId],
      ),
    ]);
    if (!objectExists.rows[0]) return res.status(400).json({ error: 'Объект не найден' });
    if (!userExists.rows[0]) return res.status(400).json({ error: 'Исполнитель не найден' });

    const prevDueMs = current.due_at ? Date.parse(current.due_at) : NaN;
    const nextDueMs = Date.parse(dueAt);
    const dueExtended = Number.isFinite(prevDueMs)
      && Number.isFinite(nextDueMs)
      && nextDueMs > prevDueMs + 1000;

    const completed = current.status === 'completed';
    const nextStatus = completed
      ? 'completed'
      : (dueExtended ? 'extended' : (current.status === 'extended' ? 'extended' : 'pending'));
    const nextExtendedAt = nextStatus === 'extended'
      ? (dueExtended ? new Date().toISOString() : current.extended_at)
      : null;

    await client.query(
      `UPDATE tasks
       SET title = $1,
           description = $2,
           object_id = $3,
           assigned_user_id = $4,
           due_at = $5::timestamptz,
           status = $6,
           extended_at = $7::timestamptz,
           updated_at = NOW()
       WHERE id = $8`,
      [title, description, objectId, assignedUserId, dueAt, nextStatus, nextExtendedAt, taskId],
    );

    const items = await readTaskList(client, { userId: req.user.id, viewAll });
    const updated = items.find((row) => row.id === taskId);
    if (!updated) return res.status(404).json({ error: 'Задача не найдена' });
    if (Number(current.assigned_user_id) !== Number(updated.assigned_user_id)) {
      sendTaskAssignedPush(
        Number(updated.assigned_user_id),
        buildTaskAssignedPayload(updated, actorDisplayName(req.user), true),
      ).catch((err) => {
        console.error('push send reassign task:', err?.message || err);
      });
    }
    res.json(updated);
  } catch (e) {
    console.error('PUT /api/tasks/:id:', e);
    res.status(500).json({ error: 'Ошибка обновления задачи' });
  } finally {
    client.release();
  }
});

router.patch('/:id/complete', async (req, res) => {
  const viewAll = canViewAllTasks(req.user);
  const taskId = parsePositiveInt(req.params.id);
  const completed = !!req.body?.completed;
  if (!taskId) return res.status(400).json({ error: 'Неверный id задачи' });

  const client = await pool.connect();
  try {
    const current = await findTaskForUpdate(client, taskId, { userId: req.user.id, viewAll });
    if (!current) return res.status(404).json({ error: 'Задача не найдена' });

    const status = completed ? 'completed' : (current.status === 'extended' ? 'extended' : 'pending');
    const completedAt = completed ? new Date().toISOString() : null;

    await client.query(
      `UPDATE tasks
       SET status = $1,
           completed_at = $2::timestamptz,
           updated_at = NOW()
       WHERE id = $3`,
      [status, completedAt, taskId],
    );

    const items = await readTaskList(client, { userId: req.user.id, viewAll });
    const updated = items.find((row) => row.id === taskId);
    if (!updated) return res.status(404).json({ error: 'Задача не найдена' });
    res.json(updated);
  } catch (e) {
    console.error('PATCH /api/tasks/:id/complete:', e);
    res.status(500).json({ error: 'Ошибка изменения статуса задачи' });
  } finally {
    client.release();
  }
});

router.delete('/:id', async (req, res) => {
  const viewAll = canViewAllTasks(req.user);
  const taskId = parsePositiveInt(req.params.id);
  if (!taskId) return res.status(400).json({ error: 'Неверный id задачи' });

  try {
    const del = await pool.query(
      `DELETE FROM tasks
       WHERE id = $1
         AND ($2::boolean OR assigned_user_id = $3)
       RETURNING id`,
      [taskId, viewAll, req.user.id],
    );
    if (!del.rows[0]) return res.status(404).json({ error: 'Задача не найдена' });
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /api/tasks/:id:', e);
    res.status(500).json({ error: 'Ошибка удаления задачи' });
  }
});

export default router;
