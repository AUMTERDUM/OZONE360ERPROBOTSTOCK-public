import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface ZoomableImageProps {
  src: string;
  alt: string;
  style?: React.CSSProperties;
}

/** A thumbnail that opens the full-size image in an overlay when clicked. */
const ZoomableImage: React.FC<ZoomableImageProps> = ({ src, alt, style }) => {
  const [open, setOpen] = useState(false);

  // Capture phase so Escape closes only the preview, not a modal underneath it.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`ดูรูปขนาดเต็ม: ${alt}`}
        title="กดเพื่อดูรูปขนาดเต็ม"
        style={{ padding: 0, border: 'none', background: 'none', cursor: 'zoom-in', display: 'inline-flex' }}
      >
        <img src={src} alt={alt} style={style} />
      </button>
      {open && createPortal(
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={alt}
          style={{ zIndex: 3000, background: 'rgba(0,0,0,0.85)' }}
          onClick={() => setOpen(false)}
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="ปิด"
            style={{ position: 'absolute', top: 12, right: 12, width: 36, height: 36, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.2)', color: 'var(--text-on-accent)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <X size={20} />
          </button>
          <img src={src} alt={alt} style={{ maxWidth: '96vw', maxHeight: '92vh', objectFit: 'contain', borderRadius: 8 }} />
        </div>,
        document.body,
      )}
    </>
  );
};

export default ZoomableImage;
