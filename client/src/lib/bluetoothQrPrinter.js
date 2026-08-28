const PRINTER_SERVICE_UUIDS = [
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffb0-0000-1000-8000-00805f9b34fb',
  '0000fff0-0000-1000-8000-00805f9b34fb',
  '0000ae30-0000-1000-8000-00805f9b34fb',
  '0000af30-0000-1000-8000-00805f9b34fb',
  '000018f0-0000-1000-8000-00805f9b34fb',
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
];

const PREFERRED_CHARACTERISTIC_UUIDS = new Set([
  '0000ffe1-0000-1000-8000-00805f9b34fb',
  '0000ff02-0000-1000-8000-00805f9b34fb',
  '0000ffb2-0000-1000-8000-00805f9b34fb',
  '0000fff2-0000-1000-8000-00805f9b34fb',
  '0000ae01-0000-1000-8000-00805f9b34fb',
  '0000af01-0000-1000-8000-00805f9b34fb',
  '6e400002-b5a3-f393-e0a9-e50e24dcca9e',
  '49535343-1e4d-4bd9-ba61-23c647249616',
]);

const WRITE_CHUNK_BYTES = 180;
const QR_CANVAS_SIZE_PX = 384;
const QR_IMAGE_SIZE_PX = 320;

function normalizeUuid(value) {
  return String(value || '').toLowerCase();
}

function isIosLikeDevice() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/i.test(ua)) return true;
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

export function getWebBluetoothUnavailableReason() {
  if (typeof navigator === 'undefined') return 'Bluetooth доступен только в браузере на устройстве.';
  if (navigator.bluetooth?.requestDevice) return '';
  if (isIosLikeDevice()) {
    return 'На iPhone/iPad Safari не поддерживает Web Bluetooth. Используйте Android Chrome/Edge или штатную печать через приложение принтера.';
  }
  return 'Браузер не поддерживает Web Bluetooth. Откройте приложение в Chrome/Edge на Android или на ПК.';
}

export function canUseWebBluetoothPrinting() {
  return !getWebBluetoothUnavailableReason();
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Не удалось подготовить изображение QR'));
    image.src = url;
  });
}

async function svgToMonoBitmap(svgElement) {
  if (!svgElement) throw new Error('SVG QR-код не найден');
  const svgText = new XMLSerializer().serializeToString(svgElement);
  const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = await loadImage(objectUrl);
    const canvas = document.createElement('canvas');
    canvas.width = QR_CANVAS_SIZE_PX;
    canvas.height = QR_CANVAS_SIZE_PX;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Не удалось создать полотно для печати');

    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const offset = Math.floor((QR_CANVAS_SIZE_PX - QR_IMAGE_SIZE_PX) / 2);
    ctx.drawImage(image, offset, offset, QR_IMAGE_SIZE_PX, QR_IMAGE_SIZE_PX);

    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const widthBytes = Math.ceil(canvas.width / 8);
    const raster = new Uint8Array(widthBytes * canvas.height);
    let out = 0;
    for (let y = 0; y < canvas.height; y += 1) {
      for (let xByte = 0; xByte < widthBytes; xByte += 1) {
        let packed = 0;
        for (let bit = 0; bit < 8; bit += 1) {
          const x = xByte * 8 + bit;
          if (x >= canvas.width) continue;
          const pixelOffset = (y * canvas.width + x) * 4;
          const r = img.data[pixelOffset];
          const g = img.data[pixelOffset + 1];
          const b = img.data[pixelOffset + 2];
          const a = img.data[pixelOffset + 3];
          const luma = (0.299 * r) + (0.587 * g) + (0.114 * b);
          const isBlack = a > 8 && luma < 150;
          if (isBlack) packed |= (0x80 >> bit);
        }
        raster[out] = packed;
        out += 1;
      }
    }

    return {
      widthPx: canvas.width,
      heightPx: canvas.height,
      widthBytes,
      raster,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function concatUint8Arrays(chunks) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function buildEscPosQrJob(bitmap) {
  const xL = bitmap.widthBytes & 0xff;
  const xH = (bitmap.widthBytes >> 8) & 0xff;
  const yL = bitmap.heightPx & 0xff;
  const yH = (bitmap.heightPx >> 8) & 0xff;
  return concatUint8Arrays([
    new Uint8Array([0x1b, 0x40]), // init
    new Uint8Array([0x1b, 0x61, 0x01]), // center align
    new Uint8Array([0x1d, 0x76, 0x30, 0x00, xL, xH, yL, yH]),
    bitmap.raster,
    new Uint8Array([0x0a, 0x0a, 0x0a, 0x0a]),
  ]);
}

function isWritableCharacteristic(characteristic) {
  return !!(
    characteristic?.properties?.write
    || characteristic?.properties?.writeWithoutResponse
  );
}

async function chooseWritableCharacteristic(server) {
  const services = await server.getPrimaryServices();
  const writable = [];
  for (const service of services) {
    const characteristics = await service.getCharacteristics();
    for (const characteristic of characteristics) {
      if (!isWritableCharacteristic(characteristic)) continue;
      writable.push(characteristic);
    }
  }
  if (!writable.length) {
    throw new Error('У принтера не найден Bluetooth-канал записи. Нужен режим BLE-печати.');
  }
  const preferred = writable.find((characteristic) =>
    PREFERRED_CHARACTERISTIC_UUIDS.has(normalizeUuid(characteristic.uuid)));
  return preferred || writable[0];
}

async function writeBytes(characteristic, bytes) {
  const supportsWriteWithoutResponse = Boolean(
    characteristic.properties?.writeWithoutResponse
    && typeof characteristic.writeValueWithoutResponse === 'function',
  );
  for (let offset = 0; offset < bytes.length; offset += WRITE_CHUNK_BYTES) {
    const part = bytes.slice(offset, offset + WRITE_CHUNK_BYTES);
    if (supportsWriteWithoutResponse) {
      await characteristic.writeValueWithoutResponse(part);
    } else {
      await characteristic.writeValue(part);
    }
    await wait(10);
  }
}

export async function printQrSvgViaBluetooth(svgElement) {
  const supportError = getWebBluetoothUnavailableReason();
  if (supportError) throw new Error(supportError);

  const bitmap = await svgToMonoBitmap(svgElement);
  const printJob = buildEscPosQrJob(bitmap);

  const device = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: PRINTER_SERVICE_UUIDS,
  });
  if (!device?.gatt) {
    throw new Error('Не удалось подключиться к Bluetooth-принтеру');
  }

  let server;
  try {
    server = await device.gatt.connect();
    const characteristic = await chooseWritableCharacteristic(server);
    await writeBytes(characteristic, printJob);
    return { deviceName: device.name || 'Bluetooth принтер' };
  } catch (error) {
    const message = String(error?.message || '');
    if (/User cancelled|cancelled|chooser closed|NotFoundError/i.test(message)) {
      throw new Error('Принтер не выбран');
    }
    if (/GATT|NetworkError|NotSupportedError/i.test(message)) {
      throw new Error('Не удалось передать данные на принтер. Проверьте, что принтер включён и поддерживает BLE-печать.');
    }
    throw error;
  } finally {
    if (device.gatt.connected) {
      device.gatt.disconnect();
    }
  }
}
