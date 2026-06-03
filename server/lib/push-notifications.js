import webpush from 'web-push';
import pool from '../db/pool.js';

const VAPID_PUBLIC_KEY = String(process.env.VAPID_PUBLIC_KEY || '').trim();
const VAPID_PRIVATE_KEY = String(process.env.VAPID_PRIVATE_KEY || '').trim();
const VAPID_SUBJECT = String(process.env.VAPID_SUBJECT || 'mailto:admin@example.com').trim();

let vapidInitialized = false;

function hasVapidKeys() {
  return !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
}

function ensureVapid() {
  if (vapidInitialized) return true;
  if (!hasVapidKeys()) return false;
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    vapidInitialized = true;
    return true;
  } catch (e) {
    console.error('web-push vapid init error:', e);
    return false;
  }
}

function parseSubscriptionInput(input) {
  const endpoint = String(input?.endpoint || '').trim();
  const p256dh = String(input?.keys?.p256dh || '').trim();
  const auth = String(input?.keys?.auth || '').trim();
  const expRaw = input?.expirationTime;
  const expirationTime = Number.isFinite(expRaw)
    ? Number(expRaw)
    : (expRaw == null ? null : Number.parseInt(String(expRaw), 10));
  if (!endpoint || !p256dh || !auth) return null;
  return {
    endpoint,
    keys: { p256dh, auth },
    expirationTime: Number.isFinite(expirationTime) ? expirationTime : null,
  };
}

function hasTaskNotificationsPermission(row) {
  if (!row) return false;
  if (row.role === 'admin') return true;
  if (row.role_id != null) return !!row.role_can_task_notifications;
  return !!row.user_can_task_notifications;
}

function isUserActive(row) {
  return !!row
    && row.profile_active !== false
    && String(row.employment_status || 'working') !== 'fired';
}

export function getPushPublicKey() {
  return hasVapidKeys() ? VAPID_PUBLIC_KEY : null;
}

export function hasPushSupportEnabled() {
  return ensureVapid();
}

export async function upsertPushSubscription(userId, rawSubscription, userAgent = '') {
  const subscription = parseSubscriptionInput(rawSubscription);
  if (!subscription) {
    const err = new Error('Неверный формат push-подписки');
    err.statusCode = 400;
    throw err;
  }
  if (!hasPushSupportEnabled()) {
    const err = new Error('Push-уведомления не настроены на сервере');
    err.statusCode = 503;
    throw err;
  }
  await pool.query(
    `INSERT INTO push_subscriptions (
       user_id, endpoint, p256dh, auth, expiration_time, user_agent, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
     ON CONFLICT (endpoint) DO UPDATE
     SET user_id = EXCLUDED.user_id,
         p256dh = EXCLUDED.p256dh,
         auth = EXCLUDED.auth,
         expiration_time = EXCLUDED.expiration_time,
         user_agent = EXCLUDED.user_agent,
         updated_at = NOW()`,
    [
      userId,
      subscription.endpoint,
      subscription.keys.p256dh,
      subscription.keys.auth,
      subscription.expirationTime,
      String(userAgent || '').slice(0, 500),
    ],
  );
  return subscription;
}

export async function deletePushSubscription({ userId, endpoint = '' }) {
  const trimmedEndpoint = String(endpoint || '').trim();
  if (!trimmedEndpoint) {
    const result = await pool.query(
      'DELETE FROM push_subscriptions WHERE user_id = $1',
      [userId],
    );
    return result.rowCount || 0;
  }
  const result = await pool.query(
    `DELETE FROM push_subscriptions
     WHERE user_id = $1
       AND endpoint = $2`,
    [userId, trimmedEndpoint],
  );
  return result.rowCount || 0;
}

async function readRecipientSubscriptions(userId) {
  const result = await pool.query(
    `SELECT ps.id, ps.endpoint, ps.p256dh, ps.auth, ps.expiration_time,
            u.role, u.role_id,
            COALESCE(u.profile_active, true) AS profile_active,
            COALESCE(u.employment_status, 'working') AS employment_status,
            COALESCE(up.can_task_notifications, false) AS user_can_task_notifications,
            COALESCE(r.can_task_notifications, false) AS role_can_task_notifications
     FROM push_subscriptions ps
     JOIN users u ON u.id = ps.user_id
     LEFT JOIN user_permissions up ON up.user_id = u.id
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE ps.user_id = $1`,
    [userId],
  );
  return result.rows || [];
}

export async function sendTaskAssignedPush(userId, payload) {
  if (!hasPushSupportEnabled()) return { sent: 0, skipped: true };
  const rows = await readRecipientSubscriptions(userId);
  if (!rows.length) return { sent: 0 };

  const staleIds = [];
  let sent = 0;
  const body = JSON.stringify({
    type: 'task-assigned',
    url: '/tasks',
    ...payload,
  });

  for (const row of rows) {
    if (!isUserActive(row) || !hasTaskNotificationsPermission(row)) continue;
    const subscription = {
      endpoint: row.endpoint,
      expirationTime: row.expiration_time,
      keys: {
        p256dh: row.p256dh,
        auth: row.auth,
      },
    };
    try {
      await webpush.sendNotification(subscription, body, { TTL: 60 * 60 });
      sent += 1;
    } catch (e) {
      const statusCode = Number(e?.statusCode || 0);
      if (statusCode === 404 || statusCode === 410) {
        staleIds.push(row.id);
      } else {
        console.error('push send error:', e?.message || e);
      }
    }
  }

  if (staleIds.length) {
    await pool.query('DELETE FROM push_subscriptions WHERE id = ANY($1::int[])', [staleIds])
      .catch(() => {});
  }

  return { sent };
}
