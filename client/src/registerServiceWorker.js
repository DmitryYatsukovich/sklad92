/** Офлайн-режим удалён: отключаем и очищаем service worker/кэши прошлых версий. */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const clear = async () => {
    const regs = await navigator.serviceWorker.getRegistrations().catch(() => []);
    await Promise.allSettled((regs || []).map((reg) => reg.unregister()));
    if ('caches' in window) {
      const keys = await caches.keys().catch(() => []);
      await Promise.allSettled(
        (keys || [])
          .filter((key) => String(key).startsWith('warehouse-'))
          .map((key) => caches.delete(key)),
      );
    }
  };
  clear().catch(() => {});
}
