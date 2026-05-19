/** Android Chrome / WebView */
export function isAndroid() {
  return /Android/i.test(navigator.userAgent);
}

/** Телефон или планшет */
export function isMobileDevice() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1 && window.matchMedia('(max-width: 1024px)').matches);
}
