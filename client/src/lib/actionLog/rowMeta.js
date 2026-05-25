/** Убрать офлайн-метки с записи с сервера / кэша. */
export function stripPendingMeta(row) {
  if (!row || typeof row !== 'object') return row;
  const {
    _pending,
    _pendingCreate,
    ...rest
  } = row;
  return rest;
}
