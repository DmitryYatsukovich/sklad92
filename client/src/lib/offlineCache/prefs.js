import { QUICK_DEVICE_KEY } from './constants.js';

export function isQuickDeviceEnabled() {
  try {
    return localStorage.getItem(QUICK_DEVICE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setQuickDeviceEnabled(on) {
  try {
    if (on) localStorage.setItem(QUICK_DEVICE_KEY, '1');
    else localStorage.removeItem(QUICK_DEVICE_KEY);
  } catch {
    /* ignore */
  }
}

export function getQuickDeviceEnabledFromStorage() {
  return isQuickDeviceEnabled();
}
