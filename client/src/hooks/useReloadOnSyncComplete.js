import { useEffect, useRef } from 'react';
import { usePendingMutations } from './usePendingMutations';

/** Перезагрузить списки с сервера, когда офлайн-очередь опустела после синхронизации. */
export function useReloadOnSyncComplete(reload) {
  const pending = usePendingMutations();
  const prevLen = useRef(pending.length);

  useEffect(() => {
    if (prevLen.current > 0 && pending.length === 0) {
      reload();
    }
    prevLen.current = pending.length;
  }, [pending.length, reload]);
}
