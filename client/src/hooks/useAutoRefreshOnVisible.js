import { useEffect, useRef } from 'react';

/**
 * Периодически запускает refresh только когда вкладка видима.
 * Также перезапускает refresh при возврате фокуса/видимости.
 */
export function useAutoRefreshOnVisible(
  refresh,
  { intervalMs = 10000, enabled = true } = {},
) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!enabled) return undefined;

    const run = () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const result = refreshRef.current?.();
        if (result && typeof result.catch === 'function') {
          result.catch(() => {});
        }
      } catch {
        /* ignore refresh errors */
      }
    };

    const t = setInterval(run, intervalMs);
    document.addEventListener('visibilitychange', run);
    window.addEventListener('focus', run);

    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', run);
      window.removeEventListener('focus', run);
    };
  }, [enabled, intervalMs]);
}

