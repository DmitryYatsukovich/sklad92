/** Android Chrome / WebView */
export function isAndroid() {
  if (typeof navigator === 'undefined') return false;
  return /Android/i.test(navigator.userAgent);
}

/** Телефон или планшет */
export function isMobileDevice() {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1 && window.matchMedia('(max-width: 1024px)').matches);
}

/** Условно слабое мобильное устройство */
export function isLowPowerMobileDevice() {
  if (!isMobileDevice()) return false;
  const cores = Number(navigator.hardwareConcurrency || 0);
  const memory = Number(navigator.deviceMemory || 0);
  return (cores > 0 && cores <= 4) || (memory > 0 && memory <= 4);
}

/** Интервал опроса с поправкой на мобильные устройства */
export function getAdaptivePollInterval(desktopMs, { mobileMs, lowPowerMs } = {}) {
  if (isLowPowerMobileDevice()) {
    if (lowPowerMs != null) return lowPowerMs;
    if (mobileMs != null) return mobileMs;
    return desktopMs;
  }
  if (isMobileDevice()) {
    if (mobileMs != null) return mobileMs;
    return desktopMs;
  }
  return desktopMs;
}
