import { useEffect, useRef, useState, useCallback } from 'react';

export default function FaceCamera({ onReady, disabled }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const onReadyRef = useRef(onReady);
  const [error, setError] = useState('');
  onReadyRef.current = onReady;

  const notifyReady = useCallback((video) => {
    if (!video) return;
    const fire = () => {
      onReadyRef.current?.(video);
    };
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      video.play().catch(() => {});
      fire();
      return;
    }
    const onMeta = () => {
      video.removeEventListener('loadeddata', onMeta);
      video.removeEventListener('canplay', onMeta);
      video.play().catch(() => {});
      fire();
    };
    video.addEventListener('loadeddata', onMeta);
    video.addEventListener('canplay', onMeta);
  }, []);

  useEffect(() => {
    let stream = null;
    let pollId = null;
    const start = async () => {
      setError('');
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        });
        streamRef.current = stream;
        const attach = () => {
          const v = videoRef.current;
          if (!v) return false;
          v.srcObject = stream;
          notifyReady(v);
          return true;
        };
        if (!attach()) {
          requestAnimationFrame(() => {
            if (!attach()) requestAnimationFrame(() => attach());
          });
          let tries = 0;
          pollId = setInterval(() => {
            tries++;
            if (attach() || tries > 40) {
              clearInterval(pollId);
              pollId = null;
            }
          }, 50);
        }
      } catch (err) {
        setError(
          !window.isSecureContext
            ? 'Камера доступна по HTTPS или на localhost.'
            : 'Не удалось включить камеру.'
        );
      }
    };
    start();
    return () => {
      if (pollId) clearInterval(pollId);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [notifyReady]);

  return (
    <div className="space-y-2">
      <div className="relative rounded-xl overflow-hidden bg-black max-w-md aspect-video border border-slate-600">
        <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
      </div>
      {error && <p className="text-amber-400 text-sm">{error}</p>}
      {disabled && <p className="text-slate-500 text-sm">Подождите…</p>}
    </div>
  );
}
