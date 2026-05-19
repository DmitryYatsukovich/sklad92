import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

export default function QrScanner({ onScan, onClose }) {
  const [error, setError] = useState('');
  const [supported, setSupported] = useState(true);
  const scannerRef = useRef(null);
  const containerId = 'qr-reader-' + Math.random().toString(36).slice(2);

  useEffect(() => {
    if (!onScan) return;
    const scanner = new Html5Qrcode(containerId);
    scannerRef.current = scanner;
    scanner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decoded) => {
          onScan(decoded);
        },
        () => {}
      )
      .catch((err) => {
        setError('Не удалось запустить камеру. Используйте HTTPS и разрешите доступ.');
        setSupported(false);
      });
    return () => {
      if (scannerRef.current?.isScanning) {
        scannerRef.current.stop().catch(() => {});
      }
    };
  }, [containerId]);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex flex-col items-center justify-center p-4">
      <div className="bg-surface-800 rounded-2xl overflow-hidden max-w-md w-full border border-slate-600">
        <div className="p-4 flex justify-between items-center border-b border-slate-700">
          <h3 className="text-lg font-medium text-white">Сканирование QR</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700"
          >
            ✕
          </button>
        </div>
        <div className="p-4">
          {error ? (
            <p className="text-red-400 text-sm mb-4">{error}</p>
          ) : (
            <p className="text-slate-400 text-sm mb-4">
              Наведите камеру на QR-код. Для работы камеры на телефоне нужен HTTPS.
            </p>
          )}
          <div id={containerId} className="scanner-wrap rounded-xl overflow-hidden bg-black min-h-[240px]" />
        </div>
      </div>
    </div>
  );
}
