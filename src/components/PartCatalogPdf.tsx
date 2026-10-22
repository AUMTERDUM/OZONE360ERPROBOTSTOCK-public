import React, { useMemo, useState } from 'react';
import { todayISO } from '../utils/thaiDate';
import { Download, FileText, Search } from 'lucide-react';
import { Modal } from './UIUtils';
import { fetchAttachmentBlob } from '../utils/attachmentBlob';
import { useToast } from '../context/ToastContext';

export interface CatalogPart {
  id: string;
  sku: string;
  displayName: string;
  unitPrice: number;
}

interface Props {
  parts: CatalogPart[];
  photoUrls: Record<string, string>;
  initialIds: string[];
  onClose: () => void;
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/** Pick SKUs and produce an A4 sheet (photo, name, SKU) to send to a customer; saved as PDF from the print dialog. */
const PartCatalogPdf: React.FC<Props> = ({ parts, photoUrls, initialIds, onClose }) => {
  const { showToast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialIds));
  const [search, setSearch] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [showPrice, setShowPrice] = useState(false);
  const [busy, setBusy] = useState(false);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? parts.filter(p => p.sku.toLowerCase().includes(q) || p.displayName.toLowerCase().includes(q)) : parts;
  }, [parts, search]);

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const allVisibleSelected = visible.length > 0 && visible.every(p => selected.has(p.id));
  const toggleAllVisible = () => setSelected(prev => {
    const next = new Set(prev);
    visible.forEach(p => { if (allVisibleSelected) next.delete(p.id); else next.add(p.id); });
    return next;
  });

  const generate = async () => {
    const chosen = parts.filter(p => selected.has(p.id));
    if (!chosen.length) { showToast('กรุณาเลือกอย่างน้อย 1 SKU', 'error'); return; }
    setBusy(true);
    const stage = document.createElement('div');
    try {
      // Photos and logo are embedded as data URLs so the canvas render is not blocked by cross-origin/auth.
      const toDataUrl = async (loader: () => Promise<Blob>) => { try { return await blobToDataUrl(await loader()); } catch { return ''; } };
      const [logo, images] = await Promise.all([
        toDataUrl(async () => (await fetch('/ozone360-logo-header.png')).blob()),
        Promise.all(chosen.map(p => photoUrls[p.id] ? toDataUrl(() => fetchAttachmentBlob(photoUrls[p.id])) : Promise.resolve(''))),
      ]);
      const date = new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
      const to = customerName.trim();
      const perPage = 9;
      const pageCount = Math.ceil(chosen.length / perPage);
      const pages = Array.from({ length: pageCount }, (_, pageIndex) => {
        const cards = chosen.slice(pageIndex * perPage, (pageIndex + 1) * perPage).map((p, i) => {
          const image = images[pageIndex * perPage + i];
          return `<div style="border:1px solid #d1d5db;border-radius:8px;padding:8px;background:#fff">
            <div style="height:150px;display:flex;align-items:center;justify-content:center;border:1px solid #f3f4f6;border-radius:6px;margin-bottom:8px;overflow:hidden">
              ${image ? `<img src="${image}" style="max-width:100%;max-height:100%;object-fit:contain" />` : '<span style="color:#9ca3af;font-size:12px">ไม่มีรูป</span>'}
            </div>
            <div style="font-weight:600;line-height:1.3;min-height:2.6em;font-size:13px">${escapeHtml(p.displayName)}</div>
            <div style="color:#4b5563;font-size:12px;margin-top:4px;word-break:break-all">SKU: ${escapeHtml(p.sku)}</div>
            ${showPrice ? `<div style="font-weight:700;margin-top:4px;font-size:13px">฿${p.unitPrice.toLocaleString()}</div>` : ''}
          </div>`;
        }).join('');
        return `<div class="pdf-page" style="width:794px;height:1123px;padding:40px 36px;background:#fff;color:#111;font-family:'Prompt',sans-serif;box-sizing:border-box;position:relative;overflow:hidden">
          <div style="text-align:center;margin-bottom:10px">${logo ? `<img src="${logo}" style="height:64px" />` : '<strong style="font-size:22px">OZONE360</strong>'}</div>
          <div style="display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #f97316;padding-bottom:8px;margin-bottom:16px">
            <div style="font-size:20px;font-weight:700">รายการอะไหล่</div>
            <div style="text-align:right;font-size:12px;color:#4b5563">${to ? `ถึง ${escapeHtml(to)}<br/>` : ''}วันที่ ${date}</div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">${cards}</div>
          <div style="position:absolute;bottom:18px;right:36px;font-size:11px;color:#9ca3af">หน้า ${pageIndex + 1}/${pageCount}</div>
        </div>`;
      });
      stage.style.cssText = 'position:fixed;left:-10000px;top:0;';
      stage.innerHTML = pages.join('');
      document.body.appendChild(stage);
      await document.fonts.ready;
      // Let the embedded images decode before the canvas render.
      await Promise.all(Array.from(stage.querySelectorAll('img')).map(img => img.decode().catch(() => undefined)));
      const [{ jsPDF }, { default: html2canvas }] = await Promise.all([import('jspdf'), import('html2canvas')]);
      const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
      const pageEls = Array.from(stage.querySelectorAll<HTMLElement>('.pdf-page'));
      for (let i = 0; i < pageEls.length; i++) {
        const canvas = await html2canvas(pageEls[i], { scale: 2, backgroundColor: '#ffffff', useCORS: true });
        if (i > 0) doc.addPage();
        doc.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 297);
      }
      doc.save(`รายการอะไหล่${to ? `-${to}` : ''}-${todayISO()}.pdf`);
      onClose();
    } catch {
      showToast('สร้างไฟล์ PDF ไม่สำเร็จ', 'error');
    } finally {
      stage.remove();
      setBusy(false);
    }
  };

  return (
    <Modal open={true} onClose={onClose} title={<><FileText size={18} /> ส่งออก PDF ส่งให้ลูกค้า</>} width={640}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label">ชื่อลูกค้า (ไม่บังคับ)</label>
          <input className="form-input" value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="แสดงที่หัวเอกสาร" />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <input type="checkbox" checked={showPrice} onChange={e => setShowPrice(e.target.checked)} /> แสดงราคาต่อชิ้น
        </label>
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input className="form-input" style={{ paddingLeft: 32 }} value={search} onChange={e => setSearch(e.target.value)} placeholder="ค้นหา SKU หรือชื่ออะไหล่" />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} /> เลือกทั้งหมดที่แสดง ({visible.length})
          </label>
          <strong>เลือกแล้ว {selected.size} รายการ</strong>
        </div>
        <div style={{ maxHeight: '40vh', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 8 }}>
          {visible.length === 0 && <div className="text-muted" style={{ padding: '1rem', textAlign: 'center' }}>ไม่พบอะไหล่</div>}
          {visible.slice(0, 200).map(p => (
            <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--border-color)', cursor: 'pointer' }}>
              <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: 'block', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.displayName}</span>
                <span className="text-muted" style={{ fontSize: 12 }}>{p.sku}{photoUrls[p.id] ? '' : ' · ไม่มีรูป'}</span>
              </span>
            </label>
          ))}
          {visible.length > 200 && <div className="text-muted" style={{ padding: '0.5rem', textAlign: 'center', fontSize: 12 }}>แสดง 200 รายการแรก — ใช้ช่องค้นหาเพื่อกรอง</div>}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-ghost" onClick={onClose}>ยกเลิก</button>
          <button className="btn btn-primary" onClick={generate} disabled={busy || selected.size === 0}>
            <Download size={15} /> {busy ? 'กำลังสร้างไฟล์...' : 'ดาวน์โหลด PDF'}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default PartCatalogPdf;
