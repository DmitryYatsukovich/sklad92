/* eslint-disable no-restricted-globals */
/** Кэш оболочки SPA для работы после обновления страницы без сети (Timeweb / PWA). */
const CACHE_SHELL = 'warehouse-shell-v4';
const CACHE_ASSETS = 'warehouse-assets-v3';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    await preCacheShellAndAssets();
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((k) => k !== CACHE_SHELL && k !== CACHE_ASSETS)
          .map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

function sameOrigin(url) {
  return url.origin === self.location.origin;
}

function collectAssetPathsFromHtml(html) {
  const paths = new Set();
  const re = /(?:src|href)=["']([^"']+)["']/g;
  let match = re.exec(html);
  while (match) {
    const raw = match[1] || '';
    try {
      const url = new URL(raw, self.location.origin);
      if (url.origin === self.location.origin && url.pathname.startsWith('/assets/')) {
        paths.add(url.pathname);
      }
    } catch {
      /* ignore malformed URL */
    }
    match = re.exec(html);
  }
  return Array.from(paths);
}

async function preCacheShellAndAssets() {
  const shell = await caches.open(CACHE_SHELL);
  const assets = await caches.open(CACHE_ASSETS);
  try {
    const indexRes = await fetch('/index.html', { cache: 'no-store' });
    if (!indexRes.ok) return;
    await shell.put('/index.html', indexRes.clone());
    await shell.put('/', indexRes.clone());
    const html = await indexRes.text();
    const assetPaths = collectAssetPathsFromHtml(html);
    await Promise.allSettled(
      assetPaths.map(async (path) => {
        const res = await fetch(path, { cache: 'no-store' });
        if (res.ok) await assets.put(path, res.clone());
      }),
    );
  } catch {
    /* offline/temporary errors: runtime caching will retry later */
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (!sameOrigin(url)) return;
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname === '/sw.js') return;

  if (url.pathname.startsWith('/models/')) {
    event.respondWith(cacheFirst(request, CACHE_ASSETS));
    return;
  }

  if (request.mode === 'navigate' || isSpaRoute(url.pathname)) {
    event.respondWith(networkFirstShell(request));
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(staleWhileRevalidate(request, CACHE_ASSETS));
  }
});

function isSpaRoute(pathname) {
  if (pathname.includes('.')) return false;
  return pathname !== '/';
}

async function networkFirstShell(request) {
  const cache = await caches.open(CACHE_SHELL);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put('/index.html', response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match('/index.html');
    if (cached) return cached;
    return new Response(
      'Нет сети. Откройте приложение онлайн хотя бы один раз, чтобы прогреть офлайн-кэш.',
      { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
    );
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  if (cached) {
    networkPromise.catch(() => {});
    return cached;
  }

  const fresh = await networkPromise;
  if (fresh) return fresh;

  return new Response('Offline', { status: 503 });
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

async function getWindowClients() {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true });
}

async function postToClients(message) {
  const clients = await getWindowClients();
  clients.forEach((client) => {
    client.postMessage(message);
  });
  return clients;
}

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let payload = {};
    try {
      payload = event.data ? event.data.json() : {};
    } catch {
      payload = {
        type: 'task-assigned',
        title: 'Новая задача',
        body: event.data?.text?.() || 'Вам назначили новую задачу',
      };
    }

    const clients = await postToClients({
      type: 'TASK_PUSH_EVENT',
      payload,
    });
    const hasVisibleClient = clients.some(
      (client) => client.visibilityState === 'visible' || client.focused,
    );
    if (hasVisibleClient) return;

    const title = payload?.title || 'Новая задача';
    const body = payload?.body || 'Вам назначили новую задачу';
    const taskId = payload?.taskId || payload?.task_id || null;
    await self.registration.showNotification(title, {
      body,
      tag: taskId ? `task-${taskId}` : 'task-assigned',
      data: {
        url: payload?.url || '/tasks',
      },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || '/tasks';
  event.waitUntil((async () => {
    const clients = await getWindowClients();
    const target = new URL(targetUrl, self.location.origin).href;
    for (const client of clients) {
      if (client.url === target && 'focus' in client) {
        await client.focus();
        return;
      }
    }
    if (self.clients.openWindow) {
      await self.clients.openWindow(targetUrl);
    }
  })());
});
