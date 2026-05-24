import { useState, useEffect, useCallback } from 'react';
import { subscribeActionLog } from '../lib/actionLog';
import { loadPendingEntries } from '../lib/actionLog/applyOptimistic.js';

/** Очередь офлайн-мутаций; обновляется при постановке в очередь и после синхронизации. */
export function usePendingMutations() {
  const [entries, setEntries] = useState([]);

  const reload = useCallback(() => {
    loadPendingEntries()
      .then(setEntries)
      .catch(() => setEntries([]));
  }, []);

  useEffect(() => {
    reload();
    return subscribeActionLog(reload);
  }, [reload]);

  return entries;
}
