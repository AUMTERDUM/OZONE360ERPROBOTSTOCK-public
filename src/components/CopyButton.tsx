import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useToast } from '../context/ToastContext';

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API needs a secure context; fall back to a temporary textarea.
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      area.remove();
    }
  }
}

interface Props {
  text: string;
  /** What is being copied, used for the tooltip and the toast (e.g. "SKU"). */
  label: string;
}

/** A small icon button that copies `text` to the clipboard. */
const CopyButton: React.FC<Props> = ({ text, label }) => {
  const { showToast } = useToast();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number>(0);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const handleClick = async () => {
    if (await copyText(text)) {
      setCopied(true);
      showToast(`คัดลอก ${label} แล้ว`, 'success');
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1500);
    } else {
      showToast(`คัดลอก ${label} ไม่สำเร็จ`, 'error');
    }
  };

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      aria-label={`คัดลอก ${label}`}
      title={`คัดลอก ${label}`}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, padding: 0, flexShrink: 0,
        border: '1px solid var(--border-color)', borderRadius: 6, background: 'var(--bg-secondary)',
        color: copied ? 'var(--status-success)' : 'var(--text-muted)', cursor: 'pointer',
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
};

export default CopyButton;
