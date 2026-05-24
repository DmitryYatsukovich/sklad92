import { setCachedResponse, setCacheMeta } from './store.js';
import { buildPrefetchStatsFromStorage } from './prefetchStats.js';
import { measureOfflineCacheSize } from './cacheSize.js';

function monthBounds() {
  const d = new Date();
  const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const to = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
  return { from, to };
}

async function save(path, data, userId) {
  await setCachedResponse(path, data, userId);
}

/** Загрузить с сервера и сохранить в IndexedDB (по правам пользователя). */
export async function prefetchOfflineData(user, { onProgress } = {}) {
  if (!user?.id) return { ok: false };
  const uid = user.id;
  const report = (msg) => onProgress?.(msg);
  const counts = {};
  const {
    materials,
    settings,
    operations,
    reports,
    attendance,
    actions,
  } = await import('../../api.js');

  try {
    await setCacheMeta({ prefetching: true, prefetchError: null });
    report('Справочники…');

    if (user.can_warehouse) {
      report('Материалы…');
      const [list, catalog, issueUsers] = await Promise.all([
        materials.list(),
        settings.catalog(),
        materials.usersForIssuance(),
      ]);
      counts.materials = list?.length ?? 0;
      counts.catalog = catalog ? 1 : 0;
      counts.issueUsers = issueUsers?.length ?? 0;
      await save('/api/materials', list, uid);
      await save('/api/settings/catalog', catalog, uid);
      await save('/api/materials/users-for-issuance', issueUsers, uid);

      report('QR и части материалов…');
      const codes = new Set();
      const partParents = [];
      for (const m of list) {
        const code = m.material_code || m.code;
        if (code) codes.add(String(code).trim());
        if (Number(m.parts_count) > 0) partParents.push(m);
      }
      let qrSaved = 0;
      for (const code of codes) {
        try {
          const row = await materials.byCode(code);
          await save(`/api/materials/by-code/${encodeURIComponent(code)}`, row, uid);
          qrSaved += 1;
        } catch {
          /* skip */
        }
      }
      counts.qrCodes = qrSaved;
      let partsSaved = 0;
      for (const m of partParents) {
        try {
          const parts = await materials.getParts(m.id);
          await save(`/api/materials/${m.id}/parts`, parts, uid);
          partsSaved += 1;
        } catch {
          /* skip */
        }
      }
      counts.materialParts = partsSaved;
    }

    if (user.can_issuance) {
      report('Выдачи…');
      const issuances = await operations.issuances();
      counts.issuances = issuances?.length ?? 0;
      await save('/api/operations/issuances', issuances, uid);
    }

    if (user.can_production) {
      report('Выработка…');
      const locations = await reports.productionLocations();
      counts.productionLocations = 1;
      await save('/api/reports/production/locations', locations, uid);
      const { from, to } = monthBounds();
      const prodPath = `/api/reports/production?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
      const prod = await reports.production(from, to);
      counts.production = Array.isArray(prod) ? prod.length : 0;
      await save(prodPath, prod, uid);
    }

    if (user.can_attendance) {
      report('Табель…');
      const { from, to } = monthBounds();
      const q = new URLSearchParams();
      if (from) q.set('from', from);
      if (to) q.set('to', to);
      const path = `/api/attendance/timesheet?${q.toString()}`;
      const sheet = await attendance.timesheet(from, to);
      counts.timesheetRows = sheet?.employees?.length ?? sheet?.rows?.length ?? 0;
      await save(path, sheet, uid);
    }

    if (user.can_actions) {
      report('Журнал действий…');
      const path = '/api/actions?limit=400';
      const log = await actions.list(400);
      counts.actions = log?.items?.length ?? 0;
      await save(path, log, uid);
    }

    const storage = await measureOfflineCacheSize();
    const stats = buildPrefetchStatsFromStorage(storage);
    await setCacheMeta({
      prefetching: false,
      lastPrefetchAt: new Date().toISOString(),
      lastPrefetchUserId: uid,
      prefetchError: null,
      lastPrefetchStats: stats,
      lastPrefetchCounts: counts,
    });
    return { ok: true, stats, counts };
  } catch (e) {
    await setCacheMeta({
      prefetching: false,
      prefetchError: e.message || 'Ошибка загрузки',
    });
    return { ok: false, error: e.message };
  }
}
