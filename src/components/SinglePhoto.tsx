import React, { useCallback, useEffect, useState } from 'react';
import { Camera, Image as ImageIcon, Trash2 } from 'lucide-react';
import api from '../api';
import { useConfirm } from '../context/ConfirmContext';
import { useToast } from '../context/ToastContext';
import { fetchAttachmentBlob } from '../utils/attachmentBlob';
import ZoomableImage from './ZoomableImage';

interface Props {
  elementType: string;
  elementId: string;
  /** Called after a photo was added or removed. */
  onChange?: () => void;
}

interface PhotoAttachment {
  id: string;
  originalName: string;
  mimeType?: string;
  url: string;
}

const isImage = (att: PhotoAttachment) => !!att.mimeType?.startsWith('image/') || /\.(jpe?g|png|gif|webp|heic|heif|bmp)$/i.test(att.originalName);

/** One picture for a record: shows it large, and only offers upload while there is none. */
const SinglePhoto: React.FC<Props> = ({ elementType, elementId, onChange }) => {
  const confirm = useConfirm();
  const { showToast } = useToast();
  const [photo, setPhoto] = useState<PhotoAttachment | null>(null);
  const [src, setSrc] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<PhotoAttachment[]>(`/attachments/${elementType}/${elementId}`);
      setPhoto(res.data.find(isImage) ?? null);
    } catch {
      setPhoto(null);
    } finally {
      setLoading(false);
    }
  }, [elementType, elementId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!photo) { setSrc(''); return; }
    let cancelled = false;
    let objectUrl = '';
    fetchAttachmentBlob(photo.url)
      .then(blob => {
        objectUrl = URL.createObjectURL(blob);
        if (cancelled) URL.revokeObjectURL(objectUrl);
        else setSrc(objectUrl);
      })
      .catch(() => { if (!cancelled) setSrc(''); });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photo]);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { showToast('กรุณาเลือกไฟล์รูปภาพ', 'error'); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('elementType', elementType);
      fd.append('elementId', elementId);
      fd.append('attachmentType', 'photo');
      await api.post('/attachments', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      await load();
      onChange?.();
    } catch {
      showToast('อัปโหลดรูปไม่สำเร็จ', 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!photo) return;
    if (!await confirm('ลบรูปนี้?', { title: 'ยืนยันการลบ', danger: true, confirmLabel: 'ลบ' })) return;
    setBusy(true);
    try {
      await api.delete(`/attachments/${photo.id}`);
      setPhoto(null);
      onChange?.();
    } catch {
      showToast('ลบรูปไม่สำเร็จ', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="text-muted" style={{ fontSize: 13 }}>กำลังโหลดรูป...</div>;

  if (photo) {
    return (
      <div style={{ position: 'relative', border: '1px solid var(--border-color)', borderRadius: 10, background: 'var(--bg-tertiary)', padding: 8, textAlign: 'center' }}>
        {src ? (
          <ZoomableImage src={src} alt={photo.originalName} style={{ maxWidth: '100%', maxHeight: 360, objectFit: 'contain', borderRadius: 8, display: 'block', margin: '0 auto' }} />
        ) : (
          <div className="text-muted" style={{ padding: '2rem 0', fontSize: 13 }}>กำลังโหลดรูป...</div>
        )}
        <button
          type="button"
          onClick={() => void remove()}
          disabled={busy}
          aria-label="ลบรูป"
          title="ลบรูป"
          style={{ position: 'absolute', top: 10, right: 10, width: 30, height: 30, borderRadius: '50%', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--status-danger)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--shadow-sm)' }}
        >
          <Trash2 size={14} />
        </button>
      </div>
    );
  }

  return (
    <div style={{ border: '1px dashed var(--border-color)', borderRadius: 10, padding: '1.25rem', textAlign: 'center' }}>
      <div className="text-muted" style={{ fontSize: 13, marginBottom: 10 }}>ยังไม่มีรูป (อัปโหลดได้ 1 รูป)</div>
      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
        <label className="btn btn-outline" style={{ cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Camera size={15} /> ถ่ายรูป
          <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} disabled={busy}
            onChange={e => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        <label className="btn btn-outline" style={{ cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <ImageIcon size={15} /> {busy ? 'กำลังอัปโหลด...' : 'เลือกรูปจากเครื่อง'}
          <input type="file" accept="image/*" style={{ display: 'none' }} disabled={busy}
            onChange={e => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
      </div>
    </div>
  );
};

export default SinglePhoto;
