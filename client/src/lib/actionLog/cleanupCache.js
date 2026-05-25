import { stripPendingMeta } from './rowMeta.js';
import { isTempMaterialId, isTempIssuanceId } from './tempIds.js';

function monthBounds() {
  const d = new Date();
  const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const to = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
  return { from, to };
}

/** После синхронизации убрать временные и «мутные» записи из офлайн-кэша GET. */
export async function cleanupOfflineCacheAfterSync() {
  const { isQuickDeviceEnabled } = await import('../offlineCache/prefs.js');
  if (!isQuickDeviceEnabled()) return;
  const { getCachedResponse, setCachedResponse } = await import('../offlineCache/store.js');

  const materials = await getCachedResponse('/api/materials');
  if (Array.isArray(materials)) {
    const next = materials
      .filter((m) => !isTempMaterialId(m.id))
      .map(stripPendingMeta);
    await setCachedResponse('/api/materials', next);
  }

  const issuances = await getCachedResponse('/api/operations/issuances');
  if (Array.isArray(issuances)) {
    await setCachedResponse(
      '/api/operations/issuances',
      issuances.filter((i) => !isTempIssuanceId(i.id)).map(stripPendingMeta),
    );
  }

  const { from, to } = monthBounds();
  const prodPath = `/api/reports/production?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const production = await getCachedResponse(prodPath);
  if (Array.isArray(production)) {
    await setCachedResponse(
      prodPath,
      production.filter((r) => !isTempIssuanceId(r.issuance_id)).map(stripPendingMeta),
    );
  }
}
