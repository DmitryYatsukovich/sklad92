function isIosPlatform() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/i.test(ua)) return true;
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

function encodeBase64UrlUtf8(value) {
  const text = String(value ?? '');
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function canUseIosPrintBridge() {
  return isIosPlatform();
}

export function buildIosPrintPayload(tool, qrText) {
  return {
    v: 1,
    type: 'tool_qr',
    createdAt: new Date().toISOString(),
    name: String(tool?.name || 'Инструмент'),
    code: String(tool?.code || ''),
    qrText: String(qrText || ''),
  };
}

export function buildIosPrintBridgeUrl(payload) {
  const json = JSON.stringify(payload || {});
  const encoded = encodeBase64UrlUtf8(json);
  return `sklad92print://print?payload=${encoded}`;
}

export function openIosPrintBridge(payload) {
  const url = buildIosPrintBridgeUrl(payload);
  if (typeof window !== 'undefined') {
    window.location.href = url;
  }
  return url;
}
