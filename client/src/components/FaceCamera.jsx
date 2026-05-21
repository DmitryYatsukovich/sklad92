import { useEffect, useRef, useState, useCallback } from 'react';
import { isAndroid } from '../lib/device';

async function openUserCamera() {
  const attempts = isAndroid()
    ? [
        { video: { facingMode: 'user' } },
        { video: { facingMode: { ideal: 'user' } } },
        { video: true },
      ]
    : [
        { video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } },
        { video: { facingMode: 'user' } },
        { video: true },
      ];

  let lastErr;
  for (const video of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia({ video });
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

export default function FaceCamera({ onReady, disabled }) {
  const videoRef = useRef(null);
  const onReadyRef = useRef(onReady);
  const [error, setError] = useState('');
  onReadyRef.current = onReady;

  const notifyReady = useCallback((video) => {
    if (!video) return;
    const fire = () => {
      onReadyRef.current?.(video);
    };
    const ready = () => video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0;
    const onMeta = () => {
      if (!ready()) return;
      video.removeEventListener('loadedmetadata', onMeta);
      video.removeEventListener('loadeddata', onMeta);
      video.removeEventListener('canplay', onMeta);
      video.removeEventListener('playing', onMeta);
      video.play().catch(() => {});
      requestAnimationFrame(() => requestAnimationFrame(fire));
    };
    video.addEventListener('loadedmetadata', onMeta);
    video.addEventListener('loadeddata', onMeta);
    video.addEventListener('canplay', onMeta);
    video.addEventListener('playing', onMeta);
    if (ready()) {
      video.play().catch(() => {});
      requestAnimationFrame(() => requestAnimationFrame(fire));
    }
  }, []);

  useEffect(() => {
    let stream = null;
    let pollId = null;
    const start = async () => {
      setError('');
      try {
        stream = await openUserCamera();
        const v = videoRef.current;
        if (v) {
          v.setAttribute('playsinline', 'true');
          v.setAttribute('webkit-playsinline', 'true');
          v.srcObject = stream;
          notifyReady(v);
        } else {
          let tries = 0;
          pollId = setInterval(() => {
            tries++;
            const el = videoRef.current;
            if (el) {
              el.setAttribute('playsinline', 'true');
              el.setAttribute('webkit-playsinline', 'true');
              el.srcObject = stream;
              notifyReady(el);
              clearInterval(pollId);
              pollId = null;
            } else if (tries > 40) {
              clearInterval(pollId);
              pollId = null;
            }
          }, 50);
        }
      } catch {
        setError(
          !window.isSecureContext
            ? 'Камера доступна по HTTPS или на localhost.'
            : 'Не удалось включить камеру. Разрешите доступ в настройках браузера.',
        );
      }
    };
    start();
    return () => {
      if (pollId) clearInterval(pollId);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [notifyReady]);

  return (
    <div className="space-y-2">
      <div className="relative rounded-xl overflow-hidden bg-black max-w-md aspect-video border border-slate-600">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="face-camera-video w-full h-full object-cover"
        />
      </div>
      {error && <p className="text-amber-400 text-sm">{error}</p>}
      {disabled && <p className="text-slate-500 text-sm">Подождите…</p>}
    </div>
  );
}
