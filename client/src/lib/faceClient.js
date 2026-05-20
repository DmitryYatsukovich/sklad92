import * as faceapi from '@vladmandic/face-api';
import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-webgl';
import { isAndroid, isMobileDevice } from './device';

const MODEL = '/models';

let loadPromise = null;
let useTinyDetector = false;

function waitAnimationFrames(count = 2) {
  return new Promise((resolve) => {
    let left = count;
    const tick = () => {
      left -= 1;
      if (left <= 0) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

function requiredModelBins() {
  if (useTinyDetector) {
    return [
      'tiny_face_detector_model.bin',
      'face_landmark_68_model.bin',
      'face_recognition_model.bin',
    ];
  }
  return [
    'ssd_mobilenetv1_model.bin',
    'face_landmark_68_model.bin',
    'face_recognition_model.bin',
  ];
}

/** Проверка, что .bin доступны и не подменены HTML-страницей (иначе ArrayBuffer alignment error) */
async function assertModelFiles(base) {
  for (const name of requiredModelBins()) {
    const url = `${base}/${name}`;
    let res;
    try {
      res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    } catch (e) {
      throw new Error(`Нет доступа к ${url}: ${e.message || e}`);
    }
    if (!res.ok) {
      throw new Error(
        `Файл модели не найден (${res.status}): ${url}. `
        + 'На сервере выполните npm run build:client и проверьте папку server/public/models.',
      );
    }
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('text/html')) {
      throw new Error(
        `Вместо модели пришла HTML-страница: ${url}. `
        + 'Проверьте, что на сервере есть server/public/models/*.bin и маршрут /models не перехватывается SPA.',
      );
    }
    const len = Number(res.headers.get('content-length') || 0);
    if (len > 0 && len < 1000) {
      throw new Error(`Файл модели повреждён (${len} байт): ${url}`);
    }
  }
}

async function initTfBackend(preferCpu = false) {
  const order = preferCpu
    ? ['cpu', 'webgl']
    : (isAndroid() ? ['webgl', 'cpu'] : ['webgl', 'cpu']);
  for (const name of order) {
    try {
      await tf.setBackend(name);
      await tf.ready();
      if (tf.getBackend() === name) return;
    } catch {
      /* try next */
    }
  }
  throw new Error('Не удалось инициализировать TensorFlow (webgl/cpu)');
}

function isBufferAlignError(err) {
  const msg = String(err?.message || err || '');
  return msg.includes('ArrayBuffer') && msg.includes('element size');
}

async function loadNetsFromUri() {
  if (useTinyDetector) {
    await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL);
  } else {
    await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL);
  }
  await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL);
  await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL);
}

export function loadFaceModels() {
  if (!loadPromise) {
    loadPromise = (async () => {
      useTinyDetector = isAndroid();
      await assertModelFiles(MODEL);
      try {
        await initTfBackend(false);
        await loadNetsFromUri();
      } catch (firstErr) {
        if (!isBufferAlignError(firstErr)) throw firstErr;
        await tf.disposeVariables();
        await initTfBackend(true);
        await loadNetsFromUri();
      }
    })();
  }
  return loadPromise;
}

function faceDetectorOptions(minConfidence = 0.4) {
  if (useTinyDetector) {
    return new faceapi.TinyFaceDetectorOptions({
      inputSize: isMobileDevice() ? 416 : 512,
      scoreThreshold: minConfidence,
    });
  }
  return new faceapi.SsdMobilenetv1Options({
    minConfidence,
    inputSize: isMobileDevice() ? 320 : 416,
  });
}

/** Дождаться кадра с ненулевым размером (иначе detectSingleFace молча не находит лицо) */
export async function ensureVideoReady(videoEl, timeoutMs = 15000) {
  if (!videoEl) return false;

  const hasFrame = () =>
    videoEl.readyState >= 2 && videoEl.videoWidth > 0 && videoEl.videoHeight > 0;

  const tryPlay = async () => {
    try {
      await videoEl.play();
    } catch {
      /* autoplay policies */
    }
  };

  if (hasFrame()) {
    await tryPlay();
    await waitAnimationFrames(isAndroid() ? 3 : 2);
    return hasFrame();
  }

  await new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error('Камера не выдала кадр (проверьте разрешения)')),
      timeoutMs,
    );
    const done = () => {
      if (!hasFrame()) return;
      clearTimeout(t);
      videoEl.removeEventListener('loadedmetadata', done);
      videoEl.removeEventListener('loadeddata', done);
      videoEl.removeEventListener('canplay', done);
      videoEl.removeEventListener('playing', done);
      resolve();
    };
    videoEl.addEventListener('loadedmetadata', done);
    videoEl.addEventListener('loadeddata', done);
    videoEl.addEventListener('canplay', done);
    videoEl.addEventListener('playing', done);
  });

  await tryPlay();

  const deadline = Date.now() + timeoutMs;
  while (!hasFrame() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
    await tryPlay();
  }

  if (!hasFrame()) return false;
  await waitAnimationFrames(isAndroid() ? 4 : 2);
  return true;
}

function videoFrameCanvas(videoEl, maxDim = 640) {
  const w = videoEl.videoWidth;
  const h = videoEl.videoHeight;
  if (!w || !h) return null;

  let tw = w;
  let th = h;
  if (Math.max(w, h) > maxDim) {
    const scale = maxDim / Math.max(w, h);
    tw = Math.round(w * scale);
    th = Math.round(h * scale);
  }

  const canvas = document.createElement('canvas');
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(videoEl, 0, 0, tw, th);
  return canvas;
}

async function detectOneFace(input, minConfidence) {
  const opts = faceDetectorOptions(minConfidence);
  let det = await faceapi
    .detectSingleFace(input, opts)
    .withFaceLandmarks()
    .withFaceDescriptor();

  if (!det) {
    const all = await faceapi
      .detectAllFaces(input, opts)
      .withFaceLandmarks()
      .withFaceDescriptors();
    if (all.length > 0) {
      det = all.reduce((best, cur) => {
        const a = best.detection.box.area;
        const b = cur.detection.box.area;
        return b > a ? cur : best;
      });
    }
  }
  return det;
}

export async function captureFaceDescriptor(videoEl) {
  await loadFaceModels();
  const ok = await ensureVideoReady(videoEl);
  if (!ok) return null;

  const canvas = videoFrameCanvas(videoEl);
  const sources = canvas ? [canvas, videoEl] : [videoEl];
  const thresholds = isAndroid() ? [0.4, 0.32, 0.25] : [0.4, 0.35];

  for (const source of sources) {
    for (const conf of thresholds) {
      const det = await detectOneFace(source, conf);
      if (det) return Array.from(det.descriptor);
    }
  }

  if (isAndroid() && tf.getBackend() === 'webgl') {
    try {
      await tf.setBackend('cpu');
      await tf.ready();
      for (const source of sources) {
        const det = await detectOneFace(source, 0.32);
        if (det) return Array.from(det.descriptor);
      }
    } catch {
      /* ignore */
    }
  }

  return null;
}

export function captureVideoFrameBlob(videoEl, type = 'image/jpeg', quality = 0.92) {
  if (!videoEl?.videoWidth || !videoEl?.videoHeight) return Promise.resolve(null);
  const canvas = videoFrameCanvas(videoEl, 1280) || document.createElement('canvas');
  if (!canvas.width) {
    canvas.width = videoEl.videoWidth;
    canvas.height = videoEl.videoHeight;
    canvas.getContext('2d').drawImage(videoEl, 0, 0);
  }
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}
