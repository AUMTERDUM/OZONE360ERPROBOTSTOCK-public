import React, { useEffect, useRef, useState } from 'react';
import { normalizeScan } from '../utils/scan';
import { createPortal } from 'react-dom';
import { Camera, X } from 'lucide-react';

const describeCameraError = (err: unknown): string => {
  const name = (err as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'ไม่ได้รับอนุญาตให้ใช้กล้อง กรุณาอนุญาตการเข้าถึงกล้องในเบราว์เซอร์';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'ไม่พบกล้องในอุปกรณ์นี้';
  if (name === 'NotReadableError') return 'ไม่สามารถเปิดกล้องได้ อาจมีแอปอื่นกำลังใช้งานอยู่';
  return 'เปิดกล้องไม่สำเร็จ';
};

const ScannerOverlay: React.FC<{ onDetected: (value: string) => void; onClose: () => void }> = ({ onDetected, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | undefined;
    let handled = false;

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('เบราว์เซอร์นี้ไม่รองรับการเปิดกล้อง (ต้องเปิดผ่าน HTTPS)');
        return;
      }
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        if (cancelled || !videoRef.current) return;
        const reader = new BrowserMultiFormatReader(undefined, { delayBetweenScanAttempts: 100 });
        const controls = await reader.decodeFromConstraints(
          { audio: false, video: { facingMode: { ideal: 'environment' } } },
          videoRef.current,
          result => {
            if (!result || handled) return;
            handled = true;
            navigator.vibrate?.(60);
            onDetectedRef.current(result.getText().trim());
          },
        );
        stop = () => controls.stop();
        if (cancelled) controls.stop();
      } catch (err) {
        if (!cancelled) setError(describeCameraError(err));
      }
    })();

    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  // Capture phase so Escape closes only the scanner, not the modal underneath it.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, []);

  return createPortal(
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="สแกนด้วยกล้อง"
      style={{ zIndex: 3000 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="card modal-content" style={{ width: 'min(96vw, 460px)' }}>
        <div className="modal-header">
          <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8, fontSize: '1.1rem' }}>
            <Camera size={18} style={{ color: 'var(--accent-primary)' }} /> สแกนด้วยกล้อง
          </h2>
          <button type="button" className="btn btn-ghost modal-close-btn" onClick={onClose} aria-label="ปิด">
            <X size={18} />
          </button>
        </div>
        {error ? (
          <div style={{ padding: '1.25rem 0.5rem', textAlign: 'center', color: 'var(--status-danger)', fontSize: 13 }}>{error}</div>
        ) : (
          <div style={{ position: 'relative', background: '#000', borderRadius: 8, overflow: 'hidden', aspectRatio: '4 / 3', maxHeight: '60vh', width: '100%' }}>
            <style>{'@keyframes camera-scan-line { 0%, 100% { opacity: 0.45; } 50% { opacity: 1; } }'}</style>
            <video ref={videoRef} playsInline muted style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
            <div
              style={{
                position: 'absolute', left: '8%', right: '8%', top: '34%', bottom: '34%',
                border: '2px solid rgba(255,255,255,0.95)', borderRadius: 10,
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)', pointerEvents: 'none',
              }}
            >
              <div
                style={{
                  position: 'absolute', left: 8, right: 8, top: '50%', height: 2, marginTop: -1,
                  background: 'var(--status-danger)', borderRadius: 2, boxShadow: '0 0 6px rgba(239,68,68,0.9)',
                  animation: 'camera-scan-line 1.2s ease-in-out infinite',
                }}
              />
            </div>
          </div>
        )}
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8, textAlign: 'center' }}>
          หันกล้องไปที่บาร์โค้ดหรือ QR Code ระบบจะอ่านค่าให้อัตโนมัติ
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.75rem' }}>
          <button type="button" className="btn btn-outline" onClick={onClose}>ปิด</button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

interface CameraScanButtonProps {
  onScan: (value: string) => void;
  disabled?: boolean;
  label?: string;
  /** 'inline' floats the icon over the right edge of a position:relative search box. */
  variant?: 'button' | 'inline';
  /** Distance from the right edge in px when variant is 'inline'. */
  right?: number;
}

const BUTTON_STYLE: React.CSSProperties = { padding: '0.4rem 0.6rem', flexShrink: 0, display: 'inline-flex', alignItems: 'center' };

const CameraScanButton: React.FC<CameraScanButtonProps> = ({ onScan, disabled, label = 'สแกนด้วยกล้อง', variant = 'button', right = 6 }) => {
  const [open, setOpen] = useState(false);
  const inlineStyle: React.CSSProperties = {
    position: 'absolute', right, top: '50%', transform: 'translateY(-50%)',
    background: 'none', border: 'none', padding: 10, minWidth: 40, minHeight: 40, justifyContent: 'center', cursor: 'pointer',
    color: 'var(--text-muted)', display: 'flex', alignItems: 'center',
  };
  return (
    <>
      <button
        type="button"
        className={variant === 'inline' ? undefined : 'btn btn-outline'}
        style={variant === 'inline' ? inlineStyle : BUTTON_STYLE}
        title={label}
        aria-label={label}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <Camera size={variant === 'inline' ? 15 : 16} />
      </button>
      {open && (
        <ScannerOverlay
          onClose={() => setOpen(false)}
          onDetected={value => { setOpen(false); const v = normalizeScan(value); if (v) onScan(v); }}
        />
      )}
    </>
  );
};

export default CameraScanButton;
