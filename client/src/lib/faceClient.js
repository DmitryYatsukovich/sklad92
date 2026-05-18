import * as faceapi from '@vladmandic/face-api';
import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-webgl';

const MODEL = '/models';

let loadPromise = null;

export function loadFaceModels() {
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        await tf.setBackend('webgl');
      } catch {
        await tf.setBackend('cpu');
      }
      await tf.ready();
      await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL);
      await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL);
      await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL);
    })();
  }
  return loadPromise;
}

/** Дождаться кадра с ненулевым размером (иначе detectSingleFace молча не находит лицо) */
export async function ensureVideoReady(videoEl, timeoutMs = 15000) {
  if (!videoEl) return false;
  if (videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
    try {
      await videoEl.play();
    } catch {
      /* autoplay policies */
    }
    return true;
  }
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Камера не выдала кадр (проверьте разрешения)')), timeoutMs);
    const done = () => {
      clearTimeout(t);
      videoEl.removeEventListener('loadeddata', done);
      videoEl.removeEventListener('canplay', done);
      resolve();
    };
    videoEl.addEventListener('loadeddata', done);
    videoEl.addEventListener('canplay', done);
  });
  try {
    await videoEl.play();
  } catch {
    /* ignore */
  }
  return videoEl.videoWidth > 0 && videoEl.videoHeight > 0;
}

/** Один дескриптор с видео (одно лицо в кадре) */
export async function captureFaceDescriptor(videoEl) {
  await loadFaceModels();
  const ok = await ensureVideoReady(videoEl);
  if (!ok) return null;

  const opts = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.4 });
  let det = await faceapi
    .detectSingleFace(videoEl, opts)
    .withFaceLandmarks()
    .withFaceDescriptor();

  if (!det) {
    const all = await faceapi.detectAllFaces(videoEl, opts).withFaceLandmarks().withFaceDescriptors();
    if (all.length > 0) det = all[0];
  }

  if (!det) return null;
  return Array.from(det.descriptor);
}

/** Снимок кадра с камеры (для превью лица в карточке пользователя) */
export function captureVideoFrameBlob(videoEl, type = 'image/jpeg', quality = 0.92) {
  if (!videoEl?.videoWidth || !videoEl?.videoHeight) return Promise.resolve(null);
  const canvas = document.createElement('canvas');
  canvas.width = videoEl.videoWidth;
  canvas.height = videoEl.videoHeight;
  canvas.getContext('2d').drawImage(videoEl, 0, 0);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}
