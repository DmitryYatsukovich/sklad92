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
  const { updateOfflineDatasetsForPath } = await import('./offlineQueries.js');
  await updateOfflineDatasetsForPath(path, data, { id: userId });
}

/** Загрузить с сервера и сохранить в IndexedDB (по правам пользователя). */
export async function prefetchOfflineData(user, { onProgress } = {}) {
  if (!user?.id) return { ok: false };
  const uid = user.id;
  const report = (msg) => onProgress?.(msg);
  const counts = {};
  const canReadSettingsCatalog = !!(
    user.role === 'admin'
    || user.can_warehouse
    || user.can_settings_warehouses
    || user.can_settings_categories
    || user.can_settings_work
    || user.can_users
    || user.can_roles
  );
  const needMaterialsDataset = !!(user.can_warehouse || user.can_issuance || user.can_production);
  const {
    materials,
    settings,
    users,
    roles,
    operations,
    reports,
    attendance,
    actions,
  } = await import('../../api.js');

  try {
    await setCacheMeta({ prefetching: true, prefetchError: null });
    report('Справочники…');

    if (canReadSettingsCatalog) {
      const catalog = await settings.catalog();
      counts.catalog = catalog ? 1 : 0;
      await save('/api/settings/catalog', catalog, uid);
    }

    if (needMaterialsDataset) {
      report('Материалы…');
      const [list, issueUsers] = await Promise.all([
        materials.list(),
        materials.usersForIssuance(),
      ]);
      counts.materials = list?.length ?? 0;
      counts.issueUsers = issueUsers?.length ?? 0;
      await save('/api/materials', list, uid);
      await save('/api/materials/users-for-issuance', issueUsers, uid);

      if (user.can_warehouse) {
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

    if (user.can_face) {
      report('Посещения (лицо)…');
      const path = '/api/attendance/my?limit=90';
      const visits = await attendance.my(90);
      counts.faceVisits = Array.isArray(visits) ? visits.length : 0;
      await save(path, visits, uid);
    }

    if (user.can_actions) {
      report('Журнал действий…');
      const path = '/api/actions?limit=400';
      const log = await actions.list(400);
      counts.actions = log?.items?.length ?? 0;
      await save(path, log, uid);
    }

    if (user.can_users || user.role === 'admin') {
      report('Пользователи…');
      const usersList = await users.list();
      counts.users = Array.isArray(usersList) ? usersList.length : 0;
      await save('/api/users', usersList, uid);

      const orgs = await settings.organizations.list().catch(() => []);
      counts.organizations = Array.isArray(orgs) ? orgs.length : 0;
      await save('/api/settings/organizations', orgs, uid);
    } else if (user.can_settings_organizations) {
      report('Организации…');
      const orgs = await settings.organizations.list();
      counts.organizations = Array.isArray(orgs) ? orgs.length : 0;
      await save('/api/settings/organizations', orgs, uid);
    }

    if (user.can_roles || user.role === 'admin') {
      report('Роли…');
      const [rolesList, perms] = await Promise.all([
        roles.list(),
        roles.permissions(),
      ]);
      counts.roles = Array.isArray(rolesList) ? rolesList.length : 0;
      counts.rolePerms = Array.isArray(perms) ? perms.length : 0;
      await save('/api/roles', rolesList, uid);
      await save('/api/roles/permissions', perms, uid);
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
