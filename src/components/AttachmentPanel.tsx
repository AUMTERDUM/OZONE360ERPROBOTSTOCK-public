import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Paperclip, Upload, Camera, Trash2, Download, X, Eye, Image as ImageIcon } from 'lucide-react';
import api from '../api';
import { useConfirm } from '../context/ConfirmContext';
import { useToast } from '../context/ToastContext';
import { fetchAttachmentBlob } from '../utils/attachmentBlob';

interface Attachment {
  id: string;
  attachmentType: string;
  originalName: string;
  fileSize?: number;
  mimeType?: string;
  uploadedBy?: string;
  uploadedAt: string;
  url: string;
}

interface Props {
  elementType: string;
  elementId: string;
  readonly?: boolean;
}

const TYPE_OPTIONS = ['photo', 'receipt', 'manual', 'warranty', 'log', 'loan-handover', 'loan-return', 'other'];

const ATTACHMENT_TYPE_LABELS: Record<string, string> = {
  photo: 'รูปภาพ',
  receipt: 'ใบเสร็จ',
  manual: 'คู่มือ',
  warranty: 'ใบรับประกัน',
  log: 'บันทึก',
  'loan-handover': 'ส่งมอบยืม',
  'loan-return': 'คืนยืม',
  other: 'อื่นๆ',
};

const isImageFile = (att: Pick<Attachment, 'mimeType' | 'originalName'>) =>
  !!att.mimeType?.startsWith('image/') || /\.(jpe?g|png|gif|webp|heic|heif|bmp)$/i.test(att.originalName);
const isPdfFile = (att: Pick<Attachment, 'mimeType' | 'originalName'>) =>
  att.mimeType === 'application/pdf' || /\.pdf$/i.test(att.originalName);

const formatSize = (bytes?: number) => {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const AttachmentPanel: React.FC<Props> = ({ elementType, elementId, readonly = false }) => {
  const confirm = useConfirm();
  const { showToast } = useToast();
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [attachType, setAttachType] = useState('other');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});

  const fetchAttachments = async () => {
    if (!elementId) return;
    setLoading(true);
    try {
      const res = await api.get(`/attachments/${elementType}/${elementId}`);
      setAttachments(res.data);
    } catch { } finally { setLoading(false); }
  };

  useEffect(() => { fetchAttachments(); }, [elementId]);

  // Previews are cached by attachment id: adding or deleting one file only fetches/revokes that
  // file, instead of re-downloading every full-size image on each change.
  const previewCache = useRef(new Map<string, string>());
  useEffect(() => () => {
    previewCache.current.forEach(url => URL.revokeObjectURL(url));
    previewCache.current.clear();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const cache = previewCache.current;
    const imageAttachments = attachments.filter(isImageFile);
    const wanted = new Set(imageAttachments.map(att => att.id));
    for (const [id, url] of cache) {
      if (!wanted.has(id)) { URL.revokeObjectURL(url); cache.delete(id); }
    }
    const publish = () => { if (!cancelled) setImageUrls(Object.fromEntries(cache)); };
    publish();

    // Each preview is caught on its own: a single unreadable file (missing in R2, a network blip)
    // must not blank every thumbnail, which reads as "the photos are gone" on an old record.
    const missing = imageAttachments.filter(att => !cache.has(att.id));
    void (async () => {
      for (let i = 0; i < missing.length; i += 3) { // a few at a time, not all at once
        await Promise.all(missing.slice(i, i + 3).map(async att => {
          try {
            const objectUrl = URL.createObjectURL(await fetchAttachmentBlob(att.url));
            if (cancelled || cache.has(att.id)) { URL.revokeObjectURL(objectUrl); return; }
            cache.set(att.id, objectUrl);
          } catch { /* thumbnail falls back to the file icon */ }
        }));
        publish();
        if (cancelled) return;
      }
    })();

    return () => { cancelled = true; };
  }, [attachments]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('elementType', elementType);
      fd.append('elementId', elementId);
      fd.append('attachmentType', attachType);
      await api.post('/attachments', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      fetchAttachments();
    } catch (err) {
      // Uploads used to fail silently, which read as "the button does nothing" — surface the real reason.
      const response = (err as { response?: { data?: { error?: string } } }).response;
      showToast(response?.data?.error || 'อัปโหลดไฟล์ไม่สำเร็จ', 'error');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!await confirm(`ลบไฟล์แนบ "${name}"?`, { title: 'ยืนยันการลบ', danger: true, confirmLabel: 'ลบ' })) return;
    try {
      await api.delete(`/attachments/${id}`);
      setAttachments(a => a.filter(x => x.id !== id));
    } catch {
      showToast('ลบไฟล์ไม่สำเร็จ', 'error');
    }
  };

  const handleDownload = async (att: Attachment) => {
    try {
      const objectUrl = URL.createObjectURL(await fetchAttachmentBlob(att.url));
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = att.originalName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      showToast('ดาวน์โหลดไฟล์ไม่สำเร็จ', 'error');
    }
  };

  // Images open in a full-size preview, PDFs in a new tab, anything else downloads.
  const openAttachment = async (att: Attachment) => {
    try {
      if (isImageFile(att)) {
        let src = imageUrls[att.id];
        if (!src) {
          src = URL.createObjectURL(await fetchAttachmentBlob(att.url));
          const created = src;
          setImageUrls(prev => ({ ...prev, [att.id]: created }));
        }
        setPreviewUrl(src);
      } else if (isPdfFile(att)) {
        const objectUrl = URL.createObjectURL(new Blob([await fetchAttachmentBlob(att.url)], { type: 'application/pdf' }));
        window.open(objectUrl, '_blank');
        setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      } else {
        await handleDownload(att);
      }
    } catch {
      showToast('เปิดไฟล์ไม่สำเร็จ กรุณาลองใหม่', 'error');
    }
  };

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.5rem',
        padding: '0.75rem 1rem', background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border)'
      }}>
        <Paperclip size={15} />
        <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>ไฟล์แนบ</span>
        <span className="badge info" style={{ marginLeft: 'auto', fontSize: '0.7rem' }}>{attachments.length}</span>
      </div>

      <div style={{ padding: '0.75rem 1rem' }}>
        {loading && <p className="text-muted" style={{ fontSize: '0.85rem', margin: 0 }}>กำลังโหลด...</p>}

        {!loading && attachments.length === 0 && (
          <p className="text-muted" style={{ fontSize: '0.85rem', margin: '0.5rem 0', textAlign: 'center' }}>ไม่มีไฟล์แนบ</p>
        )}

        {attachments.map(att => {
          const isImage = isImageFile(att);
          const previewSrc = imageUrls[att.id];
          return (
            <div key={att.id} style={{
              display: 'flex', alignItems: 'center', gap: '0.5rem',
              padding: '0.4rem 0', borderBottom: '1px solid var(--border)',
              fontSize: '0.83rem'
            }}>
              <button
                type="button"
                onClick={() => void openAttachment(att)}
                aria-label={`ดูไฟล์ ${att.originalName}`}
                title="กดเพื่อดูไฟล์"
                style={{ padding: 0, border: 'none', background: 'none', cursor: 'pointer', flexShrink: 0, display: 'flex', color: 'var(--text-muted)' }}
              >
                {isImage && previewSrc
                  ? <img src={previewSrc} alt={att.originalName} style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 4 }} />
                  : isImage ? <ImageIcon size={18} /> : <Paperclip size={16} />}
              </button>
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <button
                  type="button"
                  onClick={() => void openAttachment(att)}
                  title="กดเพื่อดูไฟล์"
                  style={{ display: 'block', maxWidth: '100%', padding: 0, border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', color: 'inherit', font: 'inherit', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {att.originalName}
                </button>
                <div className="text-muted" style={{ fontSize: '0.75rem' }}>
                  <span className="badge info" style={{ fontSize: '0.65rem', marginRight: 4 }}>{ATTACHMENT_TYPE_LABELS[att.attachmentType] || att.attachmentType}</span>
                  {formatSize(att.fileSize)}
                  {att.uploadedBy && ` · ${att.uploadedBy}`}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void openAttachment(att)}
                aria-label={`ดูไฟล์ ${att.originalName}`}
                title="ดูไฟล์"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-primary)', padding: 2 }}
              >
                <Eye size={15} />
              </button>
              <button
                type="button"
                onClick={() => handleDownload(att)}
                aria-label={`ดาวน์โหลด ${att.originalName}`}
                title="ดาวน์โหลด"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}
              >
                <Download size={14} />
              </button>
              {!readonly && (
                <button
                  type="button"
                  onClick={() => handleDelete(att.id, att.originalName)}
                  aria-label={`ลบ ${att.originalName}`}
                  title="ลบ"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--status-danger)', padding: 2 }}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          );
        })}

        {!readonly && (
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {TYPE_OPTIONS.map(t => (
                <button key={t} type="button" onClick={() => setAttachType(t)} style={{ padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: attachType===t?700:500, border: `1.5px solid ${attachType===t?'var(--accent-primary)':'var(--border-color)'}`, background: attachType===t?'var(--accent-subtle)':'transparent', color: attachType===t?'var(--accent-primary)':'var(--text-secondary)', cursor: 'pointer', transition: 'all .15s' }}>{ATTACHMENT_TYPE_LABELS[t] || t}</button>
              ))}
            </div>
            <label className="btn btn-primary" style={{
              cursor: 'pointer', fontSize: '0.82rem', padding: '0.3rem 0.75rem',
              display: 'flex', alignItems: 'center', gap: '0.3rem',
              opacity: uploading ? 0.6 : 1
            }}>
              <Camera size={13} />
              {uploading ? 'กำลังอัปโหลด…' : 'ถ่ายภาพ'}
              <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handleUpload} disabled={uploading} />
            </label>
            <label className="btn btn-outline" style={{
              cursor: 'pointer', fontSize: '0.82rem', padding: '0.3rem 0.75rem',
              display: 'flex', alignItems: 'center', gap: '0.3rem',
              opacity: uploading ? 0.6 : 1
            }}>
              <Upload size={13} />
              {uploading ? 'กำลังอัปโหลด…' : 'แนบไฟล์'}
              <input type="file" accept="image/*,application/pdf" style={{ display: 'none' }} onChange={handleUpload} disabled={uploading} />
            </label>
          </div>
        )}
      </div>

      {previewUrl && createPortal(
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="ดูรูปขนาดเต็ม"
          onClick={() => setPreviewUrl(null)}
          style={{ zIndex: 9999, background: 'rgba(0,0,0,0.85)' }}
        >
          <div style={{ position: 'relative', maxWidth: '96vw', maxHeight: '92vh' }}>
            <button
              type="button"
              onClick={() => setPreviewUrl(null)}
              aria-label="ปิด"
              style={{ position: 'absolute', top: -12, right: -12, background: 'white', border: 'none', cursor: 'pointer', borderRadius: '50%', padding: 6, zIndex: 1, display: 'flex' }}
            >
              <X size={16} />
            </button>
            <img src={previewUrl} alt="รูปแนบ" onClick={e => e.stopPropagation()} style={{ maxWidth: '96vw', maxHeight: '90vh', borderRadius: 8, display: 'block', objectFit: 'contain' }} />
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
};

export default AttachmentPanel;
