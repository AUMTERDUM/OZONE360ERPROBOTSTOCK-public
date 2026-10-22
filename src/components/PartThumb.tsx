import React, { useEffect, useState } from 'react';
import { fetchAttachmentBlob } from '../utils/attachmentBlob';
import ZoomableImage from './ZoomableImage';

const cache = new Map<string, string>();
const BOX = 36;

interface Props {
  /** Attachment url of the photo; omit for a part without one. */
  url?: string;
  label: string;
  /** Clicked while there is no photo to show (e.g. open the part so one can be added). */
  onEmptyClick?: () => void;
}

/**
 * Small square photo for list rows. With a photo, clicking it pops the picture up full size;
 * without one it is an empty white square.
 */
const PartThumb: React.FC<Props> = ({ url, label, onEmptyClick }) => {
  const [src, setSrc] = useState(url ? cache.get(url) ?? '' : '');

  useEffect(() => {
    if (!url) { setSrc(''); return; }
    const cached = cache.get(url);
    if (cached) { setSrc(cached); return; }
    let cancelled = false;
    fetchAttachmentBlob(url)
      .then(blob => {
        const objectUrl = URL.createObjectURL(blob);
        cache.set(url, objectUrl);
        if (!cancelled) setSrc(objectUrl);
      })
      .catch(() => { if (!cancelled) setSrc(''); });
    return () => { cancelled = true; };
  }, [url]);

  const box: React.CSSProperties = {
    width: BOX, height: BOX, borderRadius: 6, overflow: 'hidden', flexShrink: 0,
    border: '1px solid var(--border-color)', background: '#fff', display: 'block',
  };

  if (src) {
    return (
      <div style={box}>
        <ZoomableImage src={src} alt={label} style={{ width: BOX, height: BOX, objectFit: 'cover', display: 'block' }} />
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onEmptyClick}
      aria-label={label}
      title="ยังไม่มีรูป"
      style={{ ...box, padding: 0, cursor: onEmptyClick ? 'pointer' : 'default' }}
    />
  );
};

export default PartThumb;
