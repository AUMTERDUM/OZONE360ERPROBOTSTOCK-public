import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import api from '../api';
import { useData, useSpareParts, type Robot, type RobotModel, type Customer, type SparePart } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../context/ConfirmContext';
import { useToast } from '../context/ToastContext';
import { CustomerCombobox } from '../components/CustomerCombobox';
import { ThaiDateInput } from '../components/ThaiDateInput';
import Pagination from '../components/Pagination';
import {
  Plus, Edit2, Trash2, Search, Eye, X, PlusCircle, MinusCircle, Printer,
  ChevronDown, ChevronUp, Package, CheckSquare, Paperclip, CheckCircle, Camera, Image as ImageIcon,
} from 'lucide-react';
import AttachmentPanel from '../components/AttachmentPanel';
import { Modal, FormSubmitButton, useUrlSearch, useTableSort, SortableTh } from '../components/UIUtils';
import PageHeader from '../components/PageHeader';
import CameraScanButton from '../components/CameraScanButton';
import { formatThaiDate, formatThaiDateTime, todayISO } from '../utils/thaiDate';

//  Types 

interface DNItem {
  id?: string;
  description: string;
  quantity: number;
  remark: string;
  serialNumbers: string;
}

interface DeliveryNote {
  id: string;
  docNumber: string;
  deliveryDate: string;
  customerId: string;
  status: string;
  customer: { id: string; name: string; address?: string };
  recipientName: string;
  senderName: string;
  notes: string;
  createdAt: string;
  createdBy: string;
  items: DNItem[];
}

interface ManualItem {
  description: string;
  quantity: string;
  remark: string;
  serialNumbersRaw: string;
}

interface SanitizedSparePart extends SparePart {
  displayName: string;
  displayCategory: string;
}

interface LogEntry {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  oldValues?: string;
  newValues?: string;
  performedBy?: string;
  performedAt: string;
}

//  Helpers 

const DN_STATUS: Record<string, { label: string; badge: string; color: string; bg: string; border: string }> = {
  Pending:      { label: 'รอส่ง',           badge: 'warning', color: 'var(--status-warning)', bg: 'var(--status-warning-bg)', border: 'var(--status-warning)' },
  Packed:       { label: 'แพคแล้ว',         badge: 'info',    color: 'var(--status-info)',    bg: 'var(--status-info-bg)',    border: 'var(--status-info)' },
  'In Transit': { label: 'ระหว่างขนส่ง',    badge: 'info',    color: 'var(--accent-primary)', bg: 'var(--accent-subtle)',     border: 'var(--accent-primary)' },
  Delivered:    { label: 'ส่งแล้ว',         badge: 'success', color: 'var(--status-success)', bg: 'var(--status-success-bg)', border: 'var(--status-success)' },
  Accepted:     { label: 'ตรวจรับแล้ว',     badge: 'success', color: 'var(--status-success)', bg: 'var(--status-success-bg)', border: 'var(--status-success)' },
  Invoiced:     { label: 'ส่งของสำเร็จ',    badge: 'success', color: 'var(--status-success)', bg: 'var(--status-success-bg)', border: 'var(--status-success)' },
};

function dnStatusLabel(s: string) { return DN_STATUS[s]?.label || s; }
function dnStatusBadge(s: string) { return DN_STATUS[s]?.badge || 'warning'; }

function DeliveryStatusBadge({ status }: { status: string }) {
  const cfg = DN_STATUS[status] ?? DN_STATUS.Pending;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600,
      color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.border}`,
    }}>
      {cfg.label}
    </span>
  );
}

function getDeliveryStatusNarrative(note: Pick<DeliveryNote, 'status' | 'recipientName'>) {
  switch (note.status) {
    case 'Pending':
      return 'เอกสารฉบับนี้ยังรอการจัดเตรียมสินค้าและยืนยันก่อนออกส่ง';
    case 'Packed':
      return 'สินค้าและรายการในใบส่งของถูกจัดเตรียมแล้ว พร้อมเข้าสู่ขั้นตอนขนส่ง';
    case 'In Transit':
      return 'ใบส่งของอยู่ระหว่างขนส่ง ควรติดตามการส่งมอบและเวลาถึงปลายทาง';
    case 'Delivered':
      return 'สินค้าถูกส่งถึงปลายทางแล้ว และควรติดตามการตรวจรับจากลูกค้า';
    case 'Accepted':
      return note.recipientName
        ? `ลูกค้าตรวจรับเรียบร้อยแล้วโดย ${note.recipientName} และพร้อมปิดงานส่งของ`
        : 'ลูกค้าตรวจรับเรียบร้อยแล้ว และพร้อมปิดงานส่งของ';
    case 'Invoiced':
      return 'ส่งของสำเร็จ ปิดงานส่งของเรียบร้อยแล้ว';
    default:
      return 'ตรวจสอบสถานะของใบส่งของนี้ก่อนดำเนินการขั้นถัดไป';
  }
}

function parseSN(raw: string | string[]): string[] {
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw); } catch { return []; }
}

function formatDate(iso: string) {
  return formatThaiDate(iso);
}

function formatDateTime(iso: string) {
  return formatThaiDateTime(iso);
}

function parseJSON(value?: string) {
  if (!value) return null;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function generateDocNumber() {
  const now = new Date();
  const y = now.getFullYear().toString().slice(-2);
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const rand = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
  return `DN${y}${m}${d}-${rand}`;
}

const LATIN_REGEX = /[A-Za-z]/;

function normalizeDisplayText(value?: string | null) {
  return (value || '')
    .replace(/\s+/g, ' ')
    .replace(/[，、；]+/g, ', ')
    .replace(/\s*\/\s*/g, ' / ')
    .trim();
}

function extractDisplayEnglish(value?: string | null, fallback = '—') {
  const text = normalizeDisplayText(value);
  if (!text) return fallback;

  const candidates = text
    .split(/\s*\/\s*|\s+\|\s+|\s+｜\s+/)
    .flatMap(segment => segment.split(/\s+[–—-]\s+/))
    .map(segment => segment.trim())
    .filter(Boolean);

  let best = '';
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    const latinChars = (candidate.match(/[A-Za-z]/g) || []).length;
    const digitChars = (candidate.match(/[0-9]/g) || []).length;
    const cjkChars = (candidate.match(/[\u3400-\u9FFF\uF900-\uFAFF]/g) || []).length;
    const score = latinChars * 5 + digitChars - cjkChars * 6;
    if (score > bestScore && latinChars > 0) {
      best = candidate;
      bestScore = score;
    }
  }

  if (best) return best;

  const stripped = text
    .replace(/[\u3400-\u9FFF\uF900-\uFAFF]/g, ' ')
    .replace(/[（）【】《》「」]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (LATIN_REGEX.test(stripped) || /[0-9]/.test(stripped)) return stripped;

  return text || fallback;
}

function sanitizeCategoryDisplay(value?: string | null) {
  const parts = (value || '')
    .split(',')
    .map(part => extractDisplayEnglish(part, '').trim())
    .filter(Boolean);
  return Array.from(new Set(parts)).join(', ');
}

// ── Print View ────────────────────────────────────────────────────────────────

const PrintView: React.FC<{ note: DeliveryNote; customer?: Customer; onClose: () => void }> = ({ note, customer, onClose }) => {
  const printRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    const content = printRef.current?.innerHTML || '';
    const win = window.open('', '_blank', 'width=820,height=900');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><title>ใบส่งของ ${note.docNumber}</title>
<meta charset="utf-8"/>
<base href="${window.location.origin}/"/>
<link href="https://fonts.googleapis.com/css2?family=Prompt:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet"/>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
<style>
  @page { size: A4 portrait; margin: 12mm; }
  * { box-sizing: border-box; }
  html, body { width: 210mm; min-height: 297mm; }
  body { font-family: 'Prompt', sans-serif; margin: 0; padding: 0; font-size: 14px; color: #111; background: #fff; }
  .page { width: 100%; min-height: calc(297mm - 24mm); padding: 0; }
  .doc-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
  hr { border: none; border-top: 1px solid #d1d5db; margin: 14px 0; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #f3f4f6; padding: 10px 14px; text-align: center; border: 1px solid #d1d5db; font-weight: 600; font-size: 13px; }
  th small { font-weight: 400; display: block; font-size: 11px; color: #6b7280; }
  td { padding: 10px 14px; border: 1px solid #d1d5db; vertical-align: top; }
  .sn-list { list-style: none; padding: 0 0 0 8px; margin: 4px 0 0 0; }
  .sn-list li { font-variant-numeric: tabular-nums; font-size: 12px; color: #374151; margin-bottom: 2px; }
  .signatures { display: flex; justify-content: space-around; margin-top: 56px; }
  .sig { width: 44%; text-align: center; }
  .sig-line { padding-top: 8px; font-size: 13px; }
  @media print {
    body { margin: 0; }
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  }
</style></head><body><div class="page">${content}</div>
<div id="qr-container" style="position:fixed;bottom:18px;right:28px;text-align:center;font-size:10px;color:#6b7280;"></div>
<script>
  window.addEventListener('load', function() {
    var el = document.getElementById('qr-container');
    if (window.QRCode && el) {
      new QRCode(el, { text: '${note.docNumber}', width: 64, height: 64, colorDark: '#1e3a8a', colorLight: '#ffffff' });
      el.insertAdjacentHTML('beforeend','<div style="margin-top:3px">${note.docNumber}</div>');
    }
  });
</script>
</body></html>`);
    win.document.close();
    win.focus();
    // Wait for Prompt (and the QR script) before printing, or the page prints in a fallback font.
    const printWhenReady = () => { win.print(); win.close(); };
    Promise.race([win.document.fonts.ready, new Promise(r => setTimeout(r, 3000))])
      .then(() => setTimeout(printWhenReady, 300));
  };

  const displayAddress = customer?.address && customer.address !== '-' ? customer.address : '';

  return (
    <Modal open={true} onClose={onClose} title={<>ใบส่งของ — {note.docNumber}</>} width={860} describedById="delivery-note-print-description">
        <p id="delivery-note-print-description" style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: '1rem', marginTop: 0 }}>
          ตรวจรายละเอียดใบส่งของฉบับนี้ก่อนสั่งพิมพ์หรือแชร์กับลูกค้า
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginBottom: '1rem' }}>
          <button className="btn btn-primary" onClick={handlePrint} aria-label="พิมพ์ใบส่งของ"><Printer size={14}/> พิมพ์</button>
        </div>

        <div ref={printRef} className="a4-document-preview" style={{ background: 'var(--text-on-accent)', color: '#111', padding: '32px 40px', border: '1px solid var(--border-color)', borderRadius: 8 }}>
          <div className="doc-header" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 26, fontWeight: 700, color: '#1a56db', margin: '0 0 6px 0' }}>ใบส่งของ</div>
              <div style={{ fontSize: 13, color: '#555', margin: '2px 0' }}>เลขที่: <strong>{note.docNumber}</strong></div>
              <div style={{ fontSize: 13, color: '#555', margin: '2px 0' }}>วันที่: <strong>{formatDate(note.deliveryDate)}</strong></div>
            </div>
            <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
              <img src="/ozone360-logo-real.png" alt="OZONE360" style={{ height: 44, width: 'auto', objectFit: 'contain', marginBottom: 6, display: 'block' }} />
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 3 }}>บริษัท โอโซนสามหกศูนย์ จำกัด</div>
              <div style={{ fontSize: 12, color: 'var(--status-neutral)' }}>31 ถนนสันติธรรม ต.ช้างเผือก อ.เมืองเชียงใหม่</div>
              <div style={{ fontSize: 12, color: 'var(--status-neutral)' }}>จ.เชียงใหม่ 50300</div>
              <div style={{ fontSize: 12, color: 'var(--status-neutral)' }}>เลขทะเบียนนิติบุคคล: 0505550004131</div>
            </div>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid #d1d5db', margin: '14px 0' }} />

          <div style={{ marginBottom: 18 }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: '#374151', marginBottom: 4 }}>ลูกค้า</div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{note.customer?.name || '-'}</div>
            {displayAddress && <div style={{ fontSize: 13, color: 'var(--status-neutral)', marginTop: 3 }}>{displayAddress}</div>}
          </div>

          <table>
            <thead>
              <tr>
                <th style={{ background: '#f3f4f6', padding: '10px 14px', textAlign: 'center', border: '1px solid #d1d5db', fontWeight: 600 }}>
                  รายการ <small style={{ fontWeight: 400, display: 'block', fontSize: 11, color: 'var(--status-neutral)' }}>(Description)</small>
                </th>
                <th style={{ background: '#f3f4f6', padding: '10px 14px', textAlign: 'center', border: '1px solid #d1d5db', fontWeight: 600, width: 80 }}>
                  จำนวน <small style={{ fontWeight: 400, display: 'block', fontSize: 11, color: 'var(--status-neutral)' }}>(Quantity)</small>
                </th>
                <th style={{ background: '#f3f4f6', padding: '10px 14px', textAlign: 'center', border: '1px solid #d1d5db', fontWeight: 600, width: 140 }}>
                  หมายเหตุ <small style={{ fontWeight: 400, display: 'block', fontSize: 11, color: 'var(--status-neutral)' }}>(Remark)</small>
                </th>
              </tr>
            </thead>
            <tbody>
              {note.items.map((item, i) => {
                const sns = parseSN(item.serialNumbers);
                return (
                  <tr key={i}>
                    <td style={{ padding: '10px 14px', border: '1px solid #d1d5db', verticalAlign: 'top' }}>
                      <div style={{ fontWeight: 500, marginBottom: sns.length ? 6 : 0 }}>{extractDisplayEnglish(item.description, item.description)}</div>
                      {sns.length > 0 && (
                        <>
                          <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 3 }}>หมายเลขซีเรียล :</div>
                          <ul className="sn-list" style={{ listStyle: 'none', padding: '0 0 0 8px', margin: '4px 0 0 0' }}>
                            {sns.map((sn, j) => <li key={j} style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12, color: '#374151', marginBottom: 2 }}>{sn}</li>)}
                          </ul>
                        </>
                      )}
                    </td>
                    <td style={{ padding: '10px 14px', border: '1px solid #d1d5db', textAlign: 'center', verticalAlign: 'top' }}>{item.quantity}</td>
                    <td style={{ padding: '10px 14px', border: '1px solid #d1d5db', verticalAlign: 'top', fontSize: 12, color: 'var(--status-neutral)' }}>{item.remark || ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {note.notes && (
            <div style={{ marginTop: 14, fontSize: 13, color: '#374151' }}>
              <span style={{ fontWeight: 600 }}>หมายเหตุ:</span> {note.notes}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-around', marginTop: 56 }}>
            <div style={{ width: '44%', textAlign: 'center' }}>
              <div style={{ paddingTop: 8, fontSize: 13 }}>ลงชื่อ ........................................ ผู้ส่งมอบ</div>
              {note.senderName && <div style={{ fontSize: 12, color: 'var(--status-neutral)', marginTop: 3 }}>({note.senderName})</div>}
              <div style={{ fontSize: 13, marginTop: 8 }}>วันที่ ................................</div>
            </div>
            <div style={{ width: '44%', textAlign: 'center' }}>
              <div style={{ paddingTop: 8, fontSize: 13 }}>ลงชื่อ ........................................ ผู้รับ</div>
              {note.recipientName && <div style={{ fontSize: 12, color: 'var(--status-neutral)', marginTop: 3 }}>({note.recipientName})</div>}
              <div style={{ fontSize: 13, marginTop: 8 }}>วันที่ ................................</div>
            </div>
          </div>
        </div>
    </Modal>
  );
};

// ── Robot Picker ──────────────────────────────────────────────────────────────

interface RobotPickerProps {
  customerId: string;
  hasPendingCustomer?: boolean;
  allRobots: Robot[];
  allModels: RobotModel[];
  selectedIds: Set<string>;
  onChange: (ids: Set<string>) => void;
}

const RobotPicker: React.FC<RobotPickerProps> = ({ customerId, hasPendingCustomer, allRobots, allModels, selectedIds, onChange }) => {
  const [snSearch, setSnSearch] = useState('');
  const [includeStock, setIncludeStock] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const eligible = useMemo(() => {
    const q = snSearch.trim().toLowerCase();
    return allRobots.filter(r => {
      const byCustomer = r.customerId === customerId;
      const isStock = !r.customerId && r.status === 'In Stock';
      const matchSN = !q || r.serialNumber.toLowerCase().includes(q);
      // When typing a search, show ALL robots (any status/customer) that match
      if (q) return matchSN;
      // Pending new customer → only In Stock
      if (hasPendingCustomer && !customerId) return isStock;
      // Normal: customer's robots + optionally In Stock
      return byCustomer || (includeStock && isStock);
    });
  }, [allRobots, customerId, hasPendingCustomer, includeStock, snSearch]);

  const groups = useMemo(() => {
    const map = new Map<string, { model: RobotModel | undefined; robots: Robot[] }>();
    for (const r of eligible) {
      if (!map.has(r.modelId)) map.set(r.modelId, { model: allModels.find(m => m.id === r.modelId), robots: [] });
      map.get(r.modelId)!.robots.push(r);
    }
    return Array.from(map.values());
  }, [eligible, allModels]);

  const toggleRobot = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange(next);
  };

  const toggleGroup = (grp: Robot[]) => {
    const allSel = grp.every(r => selectedIds.has(r.id));
    const next = new Set(selectedIds);
    if (allSel) grp.forEach(r => next.delete(r.id));
    else grp.forEach(r => next.add(r.id));
    onChange(next);
  };

  const toggleCollapse = (id: string) => setCollapsed(prev => {
    const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n;
  });

  const totalSel = eligible.filter(r => selectedIds.has(r.id)).length;

  if (!customerId && !hasPendingCustomer) {
    return <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', border: '1px dashed var(--border-color)', borderRadius: 8, fontSize: 13 }}>เลือกลูกค้าก่อนเพื่อดูรายการหุ่นยนต์</div>;
  }

  return (
    <div style={{ border: '1px solid var(--border-color)', borderRadius: 8, overflow: 'hidden' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', padding: '0.55rem 0.75rem', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)' }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input aria-label="ค้นหาหมายเลขซีเรียล (ค้นหาทุกเครื่อง)..." className="form-control" style={{ paddingLeft: '1.75rem', paddingRight: '2rem', fontSize: 12, height: 32 }} placeholder="ค้นหาหมายเลขซีเรียล (ค้นหาทุกเครื่อง)..." value={snSearch} onChange={e => setSnSearch(e.target.value)} />
          {!snSearch && <CameraScanButton variant="inline" onScan={setSnSearch} />}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={includeStock} onChange={e => setIncludeStock(e.target.checked)} />
          รวมคลัง (In Stock)
        </label>
      </div>

      {/* Groups */}
      {groups.length === 0 ? (
        <div style={{ padding: '1.25rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          {snSearch.trim() ? 'ไม่พบหุ่นยนต์ที่ตรงกับหมายเลขซีเรียลนี้' : includeStock ? 'ไม่พบหุ่นยนต์' : <>ลูกค้านี้ยังไม่มีหุ่นยนต์ที่ถูกมอบหมาย — <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-primary)', fontSize: 13, textDecoration: 'underline' }} onClick={() => setIncludeStock(true)}>แสดงคลังสินค้า</button></>}
        </div>
      ) : (
        <div style={{ maxHeight: 260, overflowY: 'auto' }}>
          {groups.map(({ model, robots: grp }) => {
            const mId = model?.id || 'unknown';
            const allSel = grp.every(r => selectedIds.has(r.id));
            const selCnt = grp.filter(r => selectedIds.has(r.id)).length;
            const isCol = collapsed.has(mId);
            return (
              <div key={mId}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.55rem 0.75rem', background: 'rgba(30,58,138,0.03)', borderBottom: '1px solid var(--border-color)', cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => toggleCollapse(mId)}>
                  <input aria-label="เลือกหุ่นยนต์ทั้งหมด" type="checkbox" checked={allSel}
                    ref={el => { if (el) el.indeterminate = selCnt > 0 && !allSel; }}
                    onChange={e => { e.stopPropagation(); toggleGroup(grp); }}
                    onClick={e => e.stopPropagation()} />
                  <Package size={13} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
                  <span style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>{model?.name || 'ไม่ทราบรุ่น'}</span>
                  <span className={`badge ${selCnt > 0 ? 'info' : ''}`} style={{ fontSize: 11 }}>{selCnt}/{grp.length}</span>
                  {isCol ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
                </div>
                {!isCol && grp.map(r => (
                  <div key={r.id}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.4rem 0.75rem 0.4rem 2rem', borderBottom: '1px solid var(--border-color)', cursor: 'pointer', background: selectedIds.has(r.id) ? 'rgba(249,115,22,0.08)' : undefined }}
                    onClick={() => toggleRobot(r.id)}>
                    <input aria-label={`เลือก ${r.serialNumber}`} type="checkbox" checked={selectedIds.has(r.id)} onChange={() => toggleRobot(r.id)} onClick={e => e.stopPropagation()} />
                    <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12, flex: 1 }}>{r.serialNumber}</span>
                    <span className={`badge ${r.status === 'Assigned' ? 'success' : r.status === 'In Stock' ? 'info' : 'warning'}`} style={{ fontSize: 10 }}>{r.status === 'Assigned' ? 'ติดตั้งแล้ว' : r.status === 'In Stock' ? 'ในคลัง' : r.status === 'Missing' ? 'สูญหาย' : 'ซ่อมบำรุง'}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {totalSel > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.45rem 0.75rem', background: 'rgba(249,115,22,0.08)', borderTop: '1px solid var(--border-color)', fontSize: 12, color: 'var(--accent-primary)' }}>
          <span><CheckSquare size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />เลือกแล้ว {totalSel} เครื่อง</span>
          <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 11 }}
            onClick={() => { const n = new Set(selectedIds); eligible.forEach(r => n.delete(r.id)); onChange(n); }}>
            ยกเลิกทั้งหมด
          </button>
        </div>
      )}
    </div>
  );
};

// ── Items Preview (selected robot groups — editable desc/remark) ──────────────

interface RobotGroupOverride { description: string; remark: string; }

const ItemsPreview: React.FC<{
  selectedIds: Set<string>;
  allRobots: Robot[];
  allModels: RobotModel[];
  overrides: Map<string, RobotGroupOverride>;
  onChange: (modelId: string, field: 'description' | 'remark', val: string) => void;
}> = ({ selectedIds, allRobots, allModels, overrides, onChange }) => {
  const groups = useMemo(() => {
    const sel = allRobots.filter(r => selectedIds.has(r.id));
    const map = new Map<string, { model: RobotModel | undefined; robots: Robot[] }>();
    for (const r of sel) {
      if (!map.has(r.modelId)) map.set(r.modelId, { model: allModels.find(m => m.id === r.modelId), robots: [] });
      map.get(r.modelId)!.robots.push(r);
    }
    return Array.from(map.values());
  }, [selectedIds, allRobots, allModels]);

  if (!groups.length) return null;

  return (
    <div style={{ marginTop: '0.75rem' }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: '0.5rem' }}>รายการที่จะถูกสร้าง (แก้ไขได้)</div>
      {groups.map(({ model, robots: grp }) => {
        const mId = model?.id || 'unknown';
        const ov = overrides.get(mId) || { description: model?.name || '', remark: '' };
        return (
          <div key={mId} style={{ display: 'grid', gridTemplateColumns: '1fr 70px 1fr', gap: '0.5rem', alignItems: 'end', padding: '0.6rem 0.75rem', marginBottom: '0.4rem', background: 'rgba(249,115,22,0.06)', border: '1px solid rgba(249,115,22,0.2)', borderRadius: 6 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>รายการ</div>
              <input aria-label="ชื่อรายการ" className="form-control" style={{ fontSize: 13 }} value={ov.description} onChange={e => onChange(mId, 'description', e.target.value)} />
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>จำนวน</div>
              <div style={{ height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 20, color: 'var(--accent-primary)' }}>{grp.length}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>หมายเหตุ</div>
              <input aria-label="หมายเหตุ (ถ้ามี)" className="form-control" style={{ fontSize: 13 }} placeholder="หมายเหตุ (ถ้ามี)" value={ov.remark} onChange={e => onChange(mId, 'remark', e.target.value)} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ── Spare Parts Picker ────────────────────────────────────────────────────────

interface PartSelection { qty: number; remark: string; description: string; serialNumbers: string[]; tracked?: boolean; }

interface PartSerialItem { id: string; serialNumber: string; receivedDate: string; warehouseId?: string | null; }

const SparePicker: React.FC<{
  allParts: SanitizedSparePart[];
  selected: Map<string, PartSelection>;
  onChange: (next: Map<string, PartSelection>) => void;
}> = ({ allParts, selected, onChange }) => {
  const { showToast } = useToast();
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [serialItems, setSerialItems] = useState<Record<string, PartSerialItem[]>>({});
  const [loadingParts, setLoadingParts] = useState<Set<string>>(new Set());
  const [snSearch, setSnSearch] = useState<Record<string, string>>({});
  const [warehouseNames, setWarehouseNames] = useState<Map<string, string>>(new Map());
  const warehousesLoaded = useRef(false);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  useEffect(() => {
    if (!expanded || warehousesLoaded.current) return;
    warehousesLoaded.current = true;
    api.get('/warehouses')
      .then(res => setWarehouseNames(new Map((res.data as { id: string; name: string }[]).map(w => [w.id, w.name]))))
      .catch(() => { warehousesLoaded.current = false; });
  }, [expanded]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return allParts;
    return allParts.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.displayName.toLowerCase().includes(q) ||
      p.sku.toLowerCase().includes(q) ||
      (p.category || '').toLowerCase().includes(q) ||
      p.displayCategory.toLowerCase().includes(q)
    );
  }, [allParts, search]);

  // Parts that track individual serial numbers must be picked by SN; the rest keep a plain quantity.
  const loadSerials = async (partId: string) => {
    if (serialItems[partId]) return;
    setLoadingParts(prev => new Set(prev).add(partId));
    try {
      const res = await api.get(`/spare-parts/${partId}/items`);
      const items = (res.data.items || []) as PartSerialItem[];
      setSerialItems(prev => ({ ...prev, [partId]: items }));
      const current = selectedRef.current.get(partId);
      if (items.length > 0 && current) {
        const next = new Map(selectedRef.current);
        next.set(partId, { ...current, tracked: true });
        onChange(next);
      }
    } catch {
      showToast('โหลดรายการ SN ของอะไหล่ไม่สำเร็จ', 'error');
    } finally {
      setLoadingParts(prev => { const next = new Set(prev); next.delete(partId); return next; });
    }
  };

  const toggle = (part: SanitizedSparePart) => {
    const next = new Map(selected);
    if (next.has(part.id)) {
      next.delete(part.id);
    } else {
      next.set(part.id, { qty: 1, remark: '', description: part.displayName, serialNumbers: [] });
      void loadSerials(part.id);
    }
    onChange(next);
  };

  const update = (partId: string, field: 'qty' | 'remark' | 'description', val: string) => {
    const next = new Map(selected);
    const cur = next.get(partId);
    if (!cur) return;
    if (field === 'qty') next.set(partId, { ...cur, qty: Math.max(1, parseInt(val) || 1) });
    else next.set(partId, { ...cur, [field]: val });
    onChange(next);
  };

  const toggleSerial = (partId: string, serialNumber: string) => {
    const next = new Map(selected);
    const cur = next.get(partId);
    if (!cur) return;
    const has = cur.serialNumbers.includes(serialNumber);
    next.set(partId, { ...cur, serialNumbers: has ? cur.serialNumbers.filter(sn => sn !== serialNumber) : [...cur.serialNumbers, serialNumber] });
    onChange(next);
  };

  const selectAllSerials = (partId: string, serials: string[]) => {
    const next = new Map(selected);
    const cur = next.get(partId);
    if (!cur) return;
    next.set(partId, { ...cur, serialNumbers: serials });
    onChange(next);
  };

  const scanSerial = (partId: string, raw: string) => {
    const value = raw.trim().toLowerCase();
    if (!value) return;
    const match = (serialItems[partId] || []).find(item => item.serialNumber.toLowerCase() === value);
    if (!match) { showToast(`ไม่พบ SN "${raw.trim()}" ในอะไหล่นี้`, 'error'); return; }
    const cur = selected.get(partId);
    if (cur && !cur.serialNumbers.includes(match.serialNumber)) toggleSerial(partId, match.serialNumber);
    setSnSearch(prev => ({ ...prev, [partId]: '' }));
  };

  const selectedCount = (sel: PartSelection, partId: string) =>
    (serialItems[partId]?.length ?? 0) > 0 ? sel.serialNumbers.length : sel.qty;

  return (
    <div style={{ border: '1px solid var(--border-color)', borderRadius: 8, overflow: 'hidden' }}>
      {/* Header / toggle */}
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.75rem', cursor: 'pointer', background: 'var(--bg-secondary)', userSelect: 'none' }}
        onClick={() => setExpanded(p => !p)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: 13 }}>
          <Package size={14} style={{ color: 'var(--text-muted)' }} />
          <span>เลือกอะไหล่จากคลัง</span>
          {selected.size > 0 && (
            <span style={{ background: 'var(--accent-primary)', color: 'var(--text-on-accent)', borderRadius: 10, padding: '1px 7px', fontSize: 11, fontWeight: 700 }}>
              {selected.size}
            </span>
          )}
        </div>
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </div>

      {/* Collapsed summary */}
      {!expanded && selected.size > 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '0.35rem 0.75rem', borderTop: '1px solid var(--border-color)' }}>
          {Array.from(selected.entries()).map(([id, s]) => {
            const p = allParts.find(pt => pt.id === id);
            return p ? `${p.displayName} ×${selectedCount(s, id)}` : '';
          }).filter(Boolean).join(', ')}
        </div>
      )}

      {/* Expanded panel */}
      {expanded && (
        <div style={{ padding: '0.75rem' }}>
          <div style={{ position: 'relative', marginBottom: '0.5rem' }}>
            <input aria-label="ค้นหาชื่อ / SKU / หมวดหมู่..."
              className="form-control"
              style={{ fontSize: 13, paddingRight: '2rem' }}
              placeholder="ค้นหาชื่อ / SKU / หมวดหมู่..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {!search && <CameraScanButton variant="inline" onScan={setSearch} />}
          </div>
          {/* Part list */}
          <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3, marginBottom: '0.5rem' }}>
            {filtered.length === 0 ? (
              <div style={{ padding: '0.75rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>ไม่พบอะไหล่</div>
            ) : filtered.map(part => {
              const isSel = selected.has(part.id);
              return (
                <div
                  key={part.id}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.4rem 0.6rem', borderRadius: 6, cursor: 'pointer', background: isSel ? 'rgba(249,115,22,0.08)' : 'transparent', border: `1px solid ${isSel ? 'rgba(249,115,22,0.3)' : 'transparent'}` }}
                  onClick={() => toggle(part)}
                >
                  <input aria-label={`เลือกอะไหล่ ${part.displayName}`} type="checkbox" readOnly checked={isSel} style={{ accentColor: 'var(--accent-primary)', width: 14, height: 14, cursor: 'pointer', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: isSel ? 600 : 400 }}>{part.displayName}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{part.sku}{part.displayCategory ? ` · ${part.displayCategory}` : ''}</div>
                  </div>
                  <div style={{ flexShrink: 0, textAlign: 'right' }}>
                    <div style={{ fontSize: 12, color: part.stock > 0 ? 'var(--status-success)' : 'var(--status-danger)', fontWeight: 600 }}>{part.stock} ชิ้น</div>
                    {part.location && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{part.location}</div>}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Selected parts — SN / qty & remark */}
          {selected.size > 0 && (
            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: '0.4rem' }}>รายละเอียดอะไหล่ที่เลือก</div>
              {Array.from(selected.entries()).map(([partId, sel]) => {
                const part = allParts.find(p => p.id === partId);
                if (!part) return null;
                const serials = serialItems[partId];
                const tracked = (serials?.length ?? 0) > 0;
                const snFilter = (snSearch[partId] || '').trim().toLowerCase();
                const visibleSerials = tracked ? serials.filter(item => !snFilter || item.serialNumber.toLowerCase().includes(snFilter)) : [];
                return (
                  <div key={partId} style={{ marginBottom: '0.6rem' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 90px 1fr auto', gap: '0.5rem', alignItems: 'center', marginBottom: '0.4rem' }}>
                      <input aria-label="ชื่อรายการ"
                        className="form-control"
                        style={{ fontSize: 13 }}
                        value={sel.description}
                        onClick={e => e.stopPropagation()}
                        onChange={e => update(partId, 'description', e.target.value)}
                      />
                      <input aria-label="จำนวน"
                        className="form-control"
                        style={{ fontSize: 13, textAlign: 'center' }}
                        type="number" min={1}
                        value={tracked ? sel.serialNumbers.length : sel.qty}
                        readOnly={tracked}
                        title={tracked ? 'จำนวนตามจำนวน SN ที่เลือก' : undefined}
                        onClick={e => e.stopPropagation()}
                        onChange={e => update(partId, 'qty', e.target.value)}
                      />
                      <input aria-label="หมายเหตุ"
                        className="form-control"
                        style={{ fontSize: 13 }}
                        placeholder="หมายเหตุ"
                        value={sel.remark}
                        onClick={e => e.stopPropagation()}
                        onChange={e => update(partId, 'remark', e.target.value)}
                      />
                      <button
                        type="button"
                        aria-label={`เอา ${part.displayName} ออก`}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--status-danger)', padding: '0 4px' }}
                        onClick={() => { const n = new Map(selected); n.delete(partId); onChange(n); }}
                      >
                        <MinusCircle size={14} />
                      </button>
                    </div>

                    {loadingParts.has(partId) && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>กำลังโหลดรายการ SN...</div>}

                    {tracked && (
                      <div style={{ border: '1px solid var(--border-color)', borderRadius: 6, background: 'var(--bg-tertiary)', padding: '0.5rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 12, fontWeight: 600 }}>
                            เลือก SN ที่จะส่ง <span style={{ color: 'var(--status-danger)' }}>*</span>
                            <span className="text-muted" style={{ fontWeight: 400, marginLeft: 6 }}>เลือกแล้ว {sel.serialNumbers.length} จาก {serials.length} ชิ้น</span>
                          </span>
                          <span style={{ display: 'flex', gap: 6 }}>
                            <button type="button" className="btn btn-outline btn-sm" onClick={() => selectAllSerials(partId, serials.map(item => item.serialNumber))}>เลือกทั้งหมด</button>
                            <button type="button" className="btn btn-outline btn-sm" onClick={() => selectAllSerials(partId, [])} disabled={sel.serialNumbers.length === 0}>ล้าง</button>
                          </span>
                        </div>
                        <div style={{ position: 'relative', marginBottom: 6 }}>
                          <input aria-label="สแกนหรือค้นหา SN"
                            className="form-control"
                            style={{ fontSize: 12, height: 32, paddingRight: '2rem' }}
                            placeholder="สแกนหรือพิมพ์ SN (Enter เพื่อเลือก)"
                            value={snSearch[partId] || ''}
                            onChange={e => setSnSearch(prev => ({ ...prev, [partId]: e.target.value }))}
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); scanSerial(partId, snSearch[partId] || ''); } }}
                          />
                          {!(snSearch[partId] || '') && <CameraScanButton variant="inline" onScan={value => scanSerial(partId, value)} />}
                        </div>
                        <div role="group" aria-label={`SN ของ ${part.displayName}`} style={{ maxHeight: 170, overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 6, background: 'var(--bg-primary)' }}>
                          {visibleSerials.length === 0 ? (
                            <div style={{ padding: '0.6rem', textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>ไม่พบ SN</div>
                          ) : visibleSerials.map(item => (
                            <label key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.4rem 0.6rem', borderBottom: '1px solid var(--border-color)', cursor: 'pointer' }}>
                              <input type="checkbox" checked={sel.serialNumbers.includes(item.serialNumber)} onChange={() => toggleSerial(partId, item.serialNumber)} style={{ accentColor: 'var(--accent-primary)' }} />
                              <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{item.serialNumber}</span>
                              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
                                {item.warehouseId ? (warehouseNames.get(item.warehouseId) ?? '') : ''}
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Form ──────────────────────────────────────────────────────────────────────

const DeliveryNoteForm: React.FC<{
  initial?: DeliveryNote | null;
  initialCustomerId?: string;
  initialRobotIds?: string[];
  onSave: () => void;
  onClose: () => void;
}> = ({ initial, initialCustomerId, initialRobotIds, onSave, onClose }) => {
  const { customers, robots, models, quickAddCustomer } = useData();
  const spareParts = useSpareParts();
  const sanitizedSpareParts = useMemo<SanitizedSparePart[]>(() => spareParts.map(part => ({
    ...part,
    displayName: extractDisplayEnglish(part.name, part.sku),
    displayCategory: sanitizeCategoryDisplay(part.category),
  })), [spareParts]);

  const [docNumber, setDocNumber] = useState(initial?.docNumber || generateDocNumber());
  const [deliveryDate, setDeliveryDate] = useState(initial?.deliveryDate || todayISO());
  const [customerId, setCustomerId] = useState(initial?.customerId || initialCustomerId || '');
  const [pendingCustName, setPendingCustName] = useState('');
  const [senderName, setSenderName] = useState(initial?.senderName || '');
  const [recipientName, setRecipientName] = useState(initial?.recipientName || '');
  const [notes, setNotes] = useState(initial?.notes || '');
  const [selectedRobotIds, setSelectedRobotIds] = useState<Set<string>>(new Set(initialRobotIds || []));
  const [overrides, setOverrides] = useState<Map<string, RobotGroupOverride>>(new Map());
  const [selectedParts, setSelectedParts] = useState<Map<string, PartSelection>>(new Map());
  const [manualItems, setManualItems] = useState<ManualItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Reconstruct from existing note when editing
  useEffect(() => {
    if (!initial?.items?.length || !robots.length) return;
    const snToId = new Map(robots.map(r => [r.serialNumber, r.id]));
    const ids = new Set<string>();
    const manual: ManualItem[] = [];
    for (const item of initial.items) {
      const sns = parseSN(item.serialNumbers);
      const found = sns.map(sn => snToId.get(sn)).filter(Boolean) as string[];
      found.forEach(id => ids.add(id));
      const notFound = sns.filter(sn => !snToId.has(sn));
      if (notFound.length > 0 || sns.length === 0) {
        manual.push({ description: item.description, quantity: String(item.quantity), remark: item.remark || '', serialNumbersRaw: notFound.join('\n') });
      }
    }
    setSelectedRobotIds(ids);
    if (manual.length) setManualItems(manual);
  }, [initial, robots]);

  // Sync overrides map with current robot selection
  useEffect(() => {
    const sel = robots.filter(r => selectedRobotIds.has(r.id));
    const modelIds = new Set(sel.map(r => r.modelId));
    setOverrides(prev => {
      const next = new Map(prev);
      for (const mId of modelIds) {
        if (!next.has(mId)) next.set(mId, { description: models.find(m => m.id === mId)?.name || mId, remark: '' });
      }
      for (const k of next.keys()) { if (!modelIds.has(k)) next.delete(k); }
      return next;
    });
  }, [selectedRobotIds, robots, models]);

  const handleOverride = (mId: string, field: 'description' | 'remark', val: string) =>
    setOverrides(prev => new Map(prev).set(mId, { ...(prev.get(mId) || { description: '', remark: '' }), [field]: val }));

  const addManual = () => setManualItems(p => [...p, { description: '', quantity: '1', remark: '', serialNumbersRaw: '' }]);
  const updateManual = (i: number, f: keyof ManualItem, v: string) => setManualItems(p => p.map((it, j) => j === i ? { ...it, [f]: v } : it));
  const removeManual = (i: number) => setManualItems(p => p.filter((_, j) => j !== i));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setError('');
    if (!customerId && !pendingCustName) { setError('กรุณาเลือกลูกค้า'); return; }

    // Robot-group items
    const sel = robots.filter(r => selectedRobotIds.has(r.id));
    const grpMap = new Map<string, Robot[]>();
    for (const r of sel) { if (!grpMap.has(r.modelId)) grpMap.set(r.modelId, []); grpMap.get(r.modelId)!.push(r); }
    const robotItems = Array.from(grpMap.entries()).map(([mId, grp]) => {
      const ov = overrides.get(mId) || { description: models.find(m => m.id === mId)?.name || '', remark: '' };
      return { description: ov.description, quantity: grp.length, remark: ov.remark || null, serialNumbers: grp.map(r => r.serialNumber) };
    });

    // Spare part items — parts that track serial numbers are sent by SN, the rest by quantity
    for (const [partId, sel] of selectedParts) {
      if (sel.tracked && sel.serialNumbers.length === 0) {
        const name = sanitizedSpareParts.find(p => p.id === partId)?.displayName || 'อะไหล่';
        setError(`กรุณาเลือก SN ของ ${name}`);
        return;
      }
    }
    const partItems = Array.from(selectedParts.entries())
      .map(([partId, sel]) => {
        const part = sanitizedSpareParts.find(p => p.id === partId);
        if (!part) return null;
        return {
          description: sel.description.trim() || part.displayName,
          quantity: sel.tracked ? sel.serialNumbers.length : sel.qty,
          remark: sel.remark || null,
          serialNumbers: sel.tracked ? sel.serialNumbers : [],
          sparePartId: partId,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    // Manual items
    const manItems = manualItems.filter(it => it.description.trim()).map(it => ({
      description: it.description,
      quantity: parseInt(it.quantity) || 1,
      remark: it.remark || null,
      serialNumbers: it.serialNumbersRaw.split('\n').map(s => s.trim()).filter(Boolean),
    }));

    const allItems = [...robotItems, ...partItems, ...manItems];
    if (!allItems.length) { setError('กรุณาเลือกหุ่นยนต์ รายการอะไหล่ หรือเพิ่มรายการสินค้า'); return; }

    setSaving(true);
    // Create a staged new customer only once the document itself is valid, and remember it, so a
    // failed save followed by a retry doesn't try to create the same customer again.
    let resolvedCustomerId = customerId;
    if (!resolvedCustomerId && pendingCustName) {
      try {
        const newCust = await quickAddCustomer(pendingCustName);
        resolvedCustomerId = newCust.id;
        setCustomerId(newCust.id);
        setPendingCustName('');
      } catch {
        setError('ไม่สามารถเพิ่มลูกค้าใหม่ได้');
        setSaving(false);
        return;
      }
    }
    try {
      const payload = { docNumber, deliveryDate, customerId: resolvedCustomerId, senderName: senderName || null, recipientName: recipientName || null, notes: notes || null, items: allItems };
      if (initial) await api.put(`/delivery-notes/${initial.id}`, payload);
      else await api.post('/delivery-notes', payload);
      onSave();
    } catch (err: any) {
      setError(err.response?.data?.error || 'เกิดข้อผิดพลาด กรุณาลองใหม่');
    } finally { setSaving(false); }
  };

  return (
    <Modal open={true} onClose={onClose} title={initial ? 'แก้ไขใบส่งของ' : 'สร้างใบส่งของใหม่'} width={780} preventClose={saving} describedById="delivery-note-form-description">

        <p id="delivery-note-form-description" style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: '1rem', marginTop: 0 }}>
          เลือกลูกค้า เพิ่มหุ่นยนต์ อะไหล่ หรือรายการกรอกเอง แล้วบันทึกเป็นเอกสารส่งมอบหนึ่งฉบับ
        </p>

        {error && <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid var(--status-danger)', borderRadius: 6, padding: '0.6rem 0.75rem', marginBottom: '1rem', color: 'var(--status-danger)', fontSize: 13 }}>{error}</div>}

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
            <div>
              <label className="form-label" htmlFor="deliverynotes-docNumber">เลขที่เอกสาร *</label>
              <input id="deliverynotes-docNumber" className="form-control" value={docNumber} onChange={e => setDocNumber(e.target.value)} required />
            </div>
            <div>
              <label className="form-label" htmlFor="deliverynotes-deliveryDate">วันที่ส่ง *</label>
              <ThaiDateInput id="deliverynotes-deliveryDate" className="form-control" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)} required />
            </div>
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label className="form-label" htmlFor="dn-customer">ลูกค้า *</label>
            <CustomerCombobox
              id="dn-customer"
              value={customerId}
              onChange={id => { setCustomerId(id); setSelectedRobotIds(new Set()); }}
              customers={customers}
              pendingName={pendingCustName}
              onPendingName={n => { setPendingCustName(n); setSelectedRobotIds(new Set()); }}
              required
            />
          </div>

          {/* Robot Picker */}
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <span id="dn-robotpicker-label" className="form-label" style={{ margin: 0 }}>เลือกหุ่นยนต์จากระบบ</span>
              {selectedRobotIds.size > 0 && <span className="badge info">{selectedRobotIds.size} เครื่องที่เลือก</span>}
            </div>
            <div role="group" aria-labelledby="dn-robotpicker-label">
              <RobotPicker customerId={customerId} hasPendingCustomer={!!pendingCustName} allRobots={robots} allModels={models} selectedIds={selectedRobotIds} onChange={setSelectedRobotIds} />
            </div>
            <ItemsPreview selectedIds={selectedRobotIds} allRobots={robots} allModels={models} overrides={overrides} onChange={handleOverride} />
          </div>

          {/* Spare Parts Picker */}
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <span id="dn-sparepicker-label" className="form-label" style={{ margin: 0 }}>เลือกอะไหล่ในคลัง</span>
              {selectedParts.size > 0 && <span className="badge info">{selectedParts.size} รายการที่เลือก</span>}
            </div>
            <div role="group" aria-labelledby="dn-sparepicker-label">
              <SparePicker allParts={sanitizedSpareParts} selected={selectedParts} onChange={setSelectedParts} />
            </div>
          </div>

          {/* Manual items */}
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <span className="form-label" style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 13 }}>รายการเพิ่มเติม (กรอกเอง)</span>
              <button type="button" className="btn btn-outline" style={{ padding: '0.25rem 0.6rem', fontSize: 12 }} onClick={addManual}>
                <PlusCircle size={13}/> เพิ่มรายการ
              </button>
            </div>
            {manualItems.map((item, idx) => (
              <div key={idx} style={{ padding: '0.75rem', marginBottom: '0.5rem', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>รายการที่ {idx + 1}</span>
                  <button type="button" onClick={() => removeManual(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--status-danger)' }}><MinusCircle size={14}/></button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 1fr', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <div>
                    <label htmlFor={`dn-manual-${idx}-desc`} className="form-label" style={{ fontSize: 11 }}>รายการ *</label>
                    <input id={`dn-manual-${idx}-desc`} className="form-control" style={{ fontSize: 13 }} placeholder="เช่น Pudu T300 : Lift" value={item.description} onChange={e => updateManual(idx, 'description', e.target.value)} />
                  </div>
                  <div>
                    <label htmlFor={`dn-manual-${idx}-qty`} className="form-label" style={{ fontSize: 11 }}>จำนวน</label>
                    <input id={`dn-manual-${idx}-qty`} className="form-control" style={{ fontSize: 13 }} type="number" min={1} value={item.quantity} onChange={e => updateManual(idx, 'quantity', e.target.value)} />
                  </div>
                  <div>
                    <label htmlFor={`dn-manual-${idx}-remark`} className="form-label" style={{ fontSize: 11 }}>หมายเหตุ</label>
                    <input id={`dn-manual-${idx}-remark`} className="form-control" style={{ fontSize: 13 }} placeholder="หมายเหตุ" value={item.remark} onChange={e => updateManual(idx, 'remark', e.target.value)} />
                  </div>
                </div>
                <div>
                  <label htmlFor={`dn-manual-${idx}-sn`} className="form-label" style={{ fontSize: 11 }}>หมายเลขซีเรียล (แต่ละบรรทัด 1 เลข)</label>
                  <textarea id={`dn-manual-${idx}-sn`} className="form-control" rows={2} style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12 }}
                    placeholder={'8260T6228060001\n8260T6228060002'}
                    value={item.serialNumbersRaw} onChange={e => updateManual(idx, 'serialNumbersRaw', e.target.value)} />
                </div>
              </div>
            ))}
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)', margin: '1rem 0' }} />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
            <div>
              <label className="form-label" htmlFor="deliverynotes-senderName">ผู้ส่งมอบ</label>
              <input id="deliverynotes-senderName" className="form-control" placeholder="ชื่อผู้ส่งมอบ" value={senderName} onChange={e => setSenderName(e.target.value)} />
            </div>
            <div>
              <label className="form-label" htmlFor="deliverynotes-recipientName">ผู้รับ</label>
              <input id="deliverynotes-recipientName" className="form-control" placeholder="ชื่อผู้รับ" value={recipientName} onChange={e => setRecipientName(e.target.value)} />
            </div>
          </div>

          <div style={{ marginBottom: '1.25rem' }}>
            <label className="form-label" htmlFor="deliverynotes-notes">หมายเหตุเอกสาร</label>
            <input id="deliverynotes-notes" className="form-control" placeholder="หมายเหตุ (ถ้ามี)" value={notes} onChange={e => setNotes(e.target.value)} />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
            <button type="button" className="btn btn-outline" onClick={onClose}>ยกเลิก</button>
            <FormSubmitButton loading={saving} type="submit">
              {initial ? 'บันทึกการแก้ไข' : 'สร้างใบส่งของ'}
            </FormSubmitButton>
          </div>
        </form>
    </Modal>
  );
};

// ── Photo delivery note (upload a photo of an existing delivery note) ─────────

const PHOTO_ITEM_DESCRIPTION = 'เอกสารใบส่งสินค้า (แนบรูป)';
const MAX_PHOTOS = 10;

// Phone photos are several MB each; downscale before uploading. Falls back to the original file.
async function shrinkPhoto(file: File, maxSide = 2000, quality = 0.85): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1.5 * 1024 * 1024) { bitmap.close(); return file; }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

interface PhotoDraft { id: string; file: File; url: string; }

const DeliveryPhotoForm: React.FC<{ onSave: () => void; onClose: () => void }> = ({ onSave, onClose }) => {
  const { customers, quickAddCustomer } = useData();
  const { showToast } = useToast();
  const [docNumber, setDocNumber] = useState(generateDocNumber());
  const [deliveryDate, setDeliveryDate] = useState(todayISO());
  const [customerId, setCustomerId] = useState('');
  const [pendingCustName, setPendingCustName] = useState('');
  const [senderName, setSenderName] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<PhotoDraft[]>([]);
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const photosRef = useRef<PhotoDraft[]>([]);
  photosRef.current = photos;

  useEffect(() => () => { photosRef.current.forEach(photo => URL.revokeObjectURL(photo.url)); }, []);

  const addFiles = async (list: FileList | null) => {
    const files = Array.from(list || []).filter(file => file.type.startsWith('image/'));
    if (!files.length) return;
    setError('');
    setProcessing(true);
    try {
      const room = MAX_PHOTOS - photosRef.current.length;
      if (files.length > room) setError(`แนบรูปได้สูงสุด ${MAX_PHOTOS} รูป`);
      const drafts: PhotoDraft[] = [];
      for (const file of files.slice(0, Math.max(0, room))) {
        const small = await shrinkPhoto(file);
        drafts.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, file: small, url: URL.createObjectURL(small) });
      }
      setPhotos(prev => [...prev, ...drafts]);
    } finally {
      setProcessing(false);
    }
  };

  const removePhoto = (id: string) => setPhotos(prev => {
    const target = prev.find(photo => photo.id === id);
    if (target) URL.revokeObjectURL(target.url);
    return prev.filter(photo => photo.id !== id);
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!customerId && !pendingCustName) { setError('กรุณาเลือกลูกค้า'); return; }
    if (photos.length === 0) { setError('กรุณาถ่ายรูปหรืออัปโหลดรูปใบส่งสินค้าอย่างน้อย 1 รูป'); return; }

    setSaving(true);
    try {
      let resolvedCustomerId = customerId;
      if (!resolvedCustomerId && pendingCustName) {
        try {
          resolvedCustomerId = (await quickAddCustomer(pendingCustName)).id;
        } catch {
          setError('ไม่สามารถเพิ่มลูกค้าใหม่ได้');
          return;
        }
      }

      const res = await api.post('/delivery-notes', {
        docNumber, deliveryDate, customerId: resolvedCustomerId,
        senderName: senderName || null, recipientName: recipientName || null, notes: notes || null,
        items: [{ description: PHOTO_ITEM_DESCRIPTION, quantity: 1, remark: null, serialNumbers: [] }],
      });
      const noteId: string = res.data.id;

      let failed = 0;
      for (let i = 0; i < photos.length; i++) {
        setProgress(`กำลังอัปโหลดรูป ${i + 1}/${photos.length}`);
        try {
          const fd = new FormData();
          fd.append('file', photos[i].file);
          fd.append('elementType', 'delivery-note');
          fd.append('elementId', noteId);
          fd.append('attachmentType', 'photo');
          await api.post('/attachments', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        } catch {
          failed += 1;
        }
      }
      if (failed > 0) showToast(`สร้างใบส่งของแล้ว แต่อัปโหลดรูปไม่สำเร็จ ${failed} จาก ${photos.length} รูป — เพิ่มได้ที่ไฟล์แนบของเอกสาร`, 'warning');
      else showToast('เพิ่มใบส่งสินค้าเรียบร้อย', 'success');
      onSave();
    } catch (err) {
      setError((err as { response?: { data?: { error?: string } } }).response?.data?.error || 'เกิดข้อผิดพลาด กรุณาลองใหม่');
    } finally {
      setSaving(false);
      setProgress('');
    }
  };

  return (
    <Modal open={true} onClose={onClose} title={<><Camera size={18} style={{ color: 'var(--accent-primary)' }} /> เพิ่มใบส่งสินค้า (ถ่ายรูป)</>} width={780} preventClose={saving} describedById="delivery-photo-form-description">
      <p id="delivery-photo-form-description" style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: '1rem', marginTop: 0 }}>
        เลือกลูกค้า แล้วถ่ายรูปหรืออัปโหลดรูปใบส่งสินค้าที่มีอยู่แล้ว ระบบจะบันทึกเป็นใบส่งของหนึ่งฉบับพร้อมรูปแนบ
      </p>

      {error && <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid var(--status-danger)', borderRadius: 6, padding: '0.6rem 0.75rem', marginBottom: '1rem', color: 'var(--status-danger)', fontSize: 13 }}>{error}</div>}

      <form onSubmit={handleSubmit}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
          <div>
            <label className="form-label" htmlFor="dn-photo-docNumber">เลขที่เอกสาร *</label>
            <input id="dn-photo-docNumber" className="form-control" value={docNumber} onChange={e => setDocNumber(e.target.value)} required />
          </div>
          <div>
            <label className="form-label" htmlFor="dn-photo-deliveryDate">วันที่ส่ง *</label>
            <ThaiDateInput id="dn-photo-deliveryDate" className="form-control" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)} required />
          </div>
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label className="form-label" htmlFor="dn-photo-customer">ลูกค้า *</label>
          <CustomerCombobox
            id="dn-photo-customer"
            value={customerId}
            onChange={setCustomerId}
            customers={customers}
            pendingName={pendingCustName}
            onPendingName={setPendingCustName}
            required
          />
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: '0.5rem' }}>
            <span className="form-label" style={{ margin: 0 }}>รูปใบส่งสินค้า *</span>
            {photos.length > 0 && <span className="badge info">{photos.length} รูป</span>}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
            <label className="btn btn-outline" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Camera size={15} /> ถ่ายรูป
              <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} disabled={processing || saving || photos.length >= MAX_PHOTOS}
                onChange={e => { void addFiles(e.target.files); e.target.value = ''; }} />
            </label>
            <label className="btn btn-outline" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <ImageIcon size={15} /> เลือกรูปจากเครื่อง
              <input type="file" accept="image/*" multiple style={{ display: 'none' }} disabled={processing || saving || photos.length >= MAX_PHOTOS}
                onChange={e => { void addFiles(e.target.files); e.target.value = ''; }} />
            </label>
            {processing && <span style={{ alignSelf: 'center', fontSize: 12, color: 'var(--text-muted)' }}>กำลังเตรียมรูป...</span>}
          </div>
          {photos.length === 0 ? (
            <div style={{ border: '1px dashed var(--border-color)', borderRadius: 8, padding: '1.25rem', textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
              ยังไม่มีรูป — กด "ถ่ายรูป" หรือ "เลือกรูปจากเครื่อง" (สูงสุด {MAX_PHOTOS} รูป)
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '0.5rem' }}>
              {photos.map((photo, idx) => (
                <div key={photo.id} style={{ position: 'relative', aspectRatio: '1 / 1', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border-color)', background: 'var(--bg-tertiary)' }}>
                  <img src={photo.url} alt={`รูปใบส่งสินค้า ${idx + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  <button type="button" onClick={() => removePhoto(photo.id)} disabled={saving} aria-label={`ลบรูปที่ ${idx + 1}`} title="ลบรูปนี้"
                    style={{ position: 'absolute', top: 4, right: 4, width: 24, height: 24, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.6)', color: 'var(--text-on-accent)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)', margin: '1rem 0' }} />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
          <div>
            <label className="form-label" htmlFor="dn-photo-senderName">ผู้ส่งมอบ</label>
            <input id="dn-photo-senderName" className="form-control" placeholder="ชื่อผู้ส่งมอบ" value={senderName} onChange={e => setSenderName(e.target.value)} />
          </div>
          <div>
            <label className="form-label" htmlFor="dn-photo-recipientName">ผู้รับ</label>
            <input id="dn-photo-recipientName" className="form-control" placeholder="ชื่อผู้รับ" value={recipientName} onChange={e => setRecipientName(e.target.value)} />
          </div>
        </div>

        <div style={{ marginBottom: '1.25rem' }}>
          <label className="form-label" htmlFor="dn-photo-notes">หมายเหตุเอกสาร</label>
          <input id="dn-photo-notes" className="form-control" placeholder="หมายเหตุ (ถ้ามี)" value={notes} onChange={e => setNotes(e.target.value)} />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '0.75rem' }}>
          {progress && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{progress}</span>}
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={saving}>ยกเลิก</button>
          <FormSubmitButton loading={saving} disabled={processing} type="submit">บันทึกใบส่งสินค้า</FormSubmitButton>
        </div>
      </form>
    </Modal>
  );
};

// ── Main Page ─────────────────────────────────────────────────────────────────

const DeliveryNotes: React.FC = () => {
  const { customers, fetchData } = useData();
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const location = useLocation();
  const navState = (location.state || {}) as { robotId?: string; customerId?: string };

  const [notes, setNotes] = useState<DeliveryNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useUrlSearch();
  const [filterCustomerId, setFilterCustomerId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isPhotoFormOpen, setIsPhotoFormOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<DeliveryNote | null>(null);
  const [viewingNote, setViewingNote] = useState<DeliveryNote | null>(null);
  const [attachNote, setAttachNote] = useState<DeliveryNote | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [selectedNoteLogs, setSelectedNoteLogs] = useState<LogEntry[]>([]);
  const [loadingNoteLogs, setLoadingNoteLogs] = useState(false);

  // Auto-open form when navigated from inventory with robot prefill
  const didAutoOpen = useRef(false);
  useEffect(() => {
    if (navState.robotId && !didAutoOpen.current) {
      didAutoOpen.current = true;
      setIsFormOpen(true);
    }
  }, []);

  const fetchNotes = async () => {
    setLoading(true);
    try { const res = await api.get('/delivery-notes'); setNotes(res.data); }
    catch { setNotes([]); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchNotes(); }, []);

  const confirm = useConfirm();
  const handleDelete = async (note: DeliveryNote) => {
    if (!await confirm(`ลบใบส่งของ ${note.docNumber}?`, { title: 'ยืนยันการลบ', danger: true, confirmLabel: 'ลบ' })) return;
    await api.delete(`/delivery-notes/${note.id}`);
    fetchNotes();
  };

  const DN_NEXT: Record<string, string> = { Pending: 'Packed', Packed: 'In Transit', 'In Transit': 'Delivered', Delivered: 'Accepted', Accepted: 'Invoiced' };

  const handleAdvanceStatus = async (note: DeliveryNote) => {
    const next = DN_NEXT[note.status];
    if (!next) return;
    const label = DN_STATUS[next]?.label || next;
    const message = next === 'Invoiced'
      ? `เปลี่ยนสถานะ ${note.docNumber} เป็น "${label}"? หุ่นยนต์และอะไหล่ในใบนี้จะถูกโอนไปเป็นของลูกค้าทันที`
      : `เปลี่ยนสถานะ ${note.docNumber} เป็น "${label}"?`;
    if (!await confirm(message, { title: 'เปลี่ยนสถานะ', confirmLabel: label })) return;
    await api.patch(`/delivery-notes/${note.id}/status`, { status: next });
    if (next === 'Invoiced') void fetchData();
    fetchNotes();
  };

  const handleView = async (note: DeliveryNote) => {
    const res = await api.get(`/delivery-notes/${note.id}`);
    setViewingNote(res.data);
  };

  const handleSave = () => { setIsFormOpen(false); setEditingNote(null); fetchNotes(); };
  const handlePhotoSave = () => { setIsPhotoFormOpen(false); fetchNotes(); };

  const filtered = useMemo(() => notes.filter(n => {
    const q = search.toLowerCase();
    const matchSearch = !q || n.docNumber.toLowerCase().includes(q) || n.customer?.name?.toLowerCase().includes(q);
    const matchDate = (!dateFrom || n.deliveryDate >= dateFrom) && (!dateTo || n.deliveryDate <= dateTo);
    return matchSearch && (!filterCustomerId || n.customerId === filterCustomerId) && matchDate;
  }), [notes, search, filterCustomerId, dateFrom, dateTo]);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  useEffect(() => { setPage(1); }, [search, filterCustomerId, dateFrom, dateTo]);
  const sort = useTableSort<typeof filtered[0]>({
    docNumber: n => n.docNumber,
    customer: n => n.customer?.name || '',
    deliveryDate: n => n.deliveryDate,
    status: n => n.status,
    items: n => n.items?.length || 0,
    robots: n => n.items?.reduce((sum, it) => sum + (it.quantity || 0), 0) || 0,
    createdBy: n => n.createdBy || '',
  });
  const paginated = sort.apply(filtered).slice((page - 1) * pageSize, page * pageSize);
  const selectedNote = useMemo(
    () => notes.find(note => note.id === selectedNoteId) ?? null,
    [notes, selectedNoteId]
  );

  useEffect(() => {
    let ignore = false;

    const fetchNoteLogs = async () => {
      if (!selectedNoteId) {
        setSelectedNoteLogs([]);
        return;
      }
      setLoadingNoteLogs(true);
      try {
        const res = await api.get<LogEntry[]>(`/logs?entityType=DeliveryNote&entityId=${encodeURIComponent(selectedNoteId)}`);
        if (!ignore) setSelectedNoteLogs(res.data);
      } catch {
        if (!ignore) setSelectedNoteLogs([]);
      } finally {
        if (!ignore) setLoadingNoteLogs(false);
      }
    };

    fetchNoteLogs();

    return () => {
      ignore = true;
    };
  }, [selectedNoteId]);

  useEffect(() => {
    if (filtered.length === 0) {
      setSelectedNoteId(null);
      return;
    }
    if (!selectedNoteId || !filtered.some(note => note.id === selectedNoteId)) {
      setSelectedNoteId(filtered[0].id);
    }
  }, [filtered, selectedNoteId]);

  const totalRobots = (n: DeliveryNote) => n.items?.reduce((s, it) => s + (it.quantity || 0), 0) || 0;
  const viewingCustomer = viewingNote ? customers.find(c => c.id === viewingNote.customerId) : undefined;
  const noteStats = {
    total: notes.length,
    delivered: notes.filter(n => n.status === 'Delivered').length,
    pending: notes.filter(n => n.status !== 'Delivered').length,
    customerCount: new Set(notes.map(n => n.customerId)).size,
  };

  const renderNoteActivityDetail = (log: LogEntry) => {
    const oldValues = parseJSON(log.oldValues);
    const newValues = parseJSON(log.newValues);

    if (log.action === 'attachment_added' && typeof newValues?.filename === 'string') {
      return `เพิ่มไฟล์ ${newValues.filename}`;
    }
    if (log.action === 'status_changed' && typeof oldValues?.status === 'string' && typeof newValues?.status === 'string') {
      return `${oldValues.status} -> ${newValues.status}`;
    }
    if (log.action === 'created') {
      return 'สร้างใบส่งของใหม่';
    }
    if (log.action === 'updated') {
      return 'มีการปรับปรุงรายละเอียดใบส่งของ';
    }
    if (log.action === 'deleted') {
      return 'เอกสารถูกลบออกจากระบบ';
    }
    return null;
  };

  const noteActivityTone = (action: string) => {
    if (action === 'created') return 'success';
    if (action === 'status_changed') return 'warning';
    if (action === 'attachment_added') return 'info';
    if (action === 'deleted') return 'danger';
    return 'neutral';
  };

  const noteActivityLabel = (action: string) => {
    switch (action) {
      case 'created': return 'สร้างเอกสาร';
      case 'updated': return 'แก้ไขเอกสาร';
      case 'deleted': return 'ลบเอกสาร';
      case 'status_changed': return 'เปลี่ยนสถานะ';
      case 'attachment_added': return 'เพิ่มไฟล์แนบ';
      default: return action.replace(/_/g, ' ');
    }
  };

  return (
    <div className="page-container">
      <PageHeader
        title="ใบส่งของ"
        subtitle="จัดการเอกสารส่งมอบและติดตามสถานะการส่งของให้ลูกค้า"
      />

      <div className="accounts-workspace card">
        <div className="accounts-workspace-main">
          <div>
            <div className="accounts-workspace-eyebrow">พื้นที่ทำงาน</div>
            <h2 className="accounts-workspace-title">ศูนย์ควบคุมงานส่งของ</h2>
            <p className="accounts-workspace-subtitle">มุมทำงานสำหรับใบส่งของที่รวมคิวเอกสารรอส่ง, ลูกค้าที่เกี่ยวข้อง และแผงตรวจสอบสำหรับดูรายละเอียดเอกสารโดยไม่ต้องเปิดหน้าต่างป็อปอัปทุกครั้ง</p>
          </div>
          <div className="accounts-workspace-actions">
            <button className="btn btn-primary" onClick={() => { setEditingNote(null); setIsFormOpen(true); }}>
              <Plus size={16}/> สร้างจากรายการสินค้า
            </button>
            <button className="btn btn-outline" onClick={() => setIsPhotoFormOpen(true)}>
              <Camera size={16}/> แนบรูปใบส่งของที่มีอยู่
            </button>
          </div>
        </div>
        <div className="accounts-workspace-pills">
          {[
            { label: 'ใบส่งของทั้งหมด', value: noteStats.total, tone: 'info' },
            { label: 'ส่งมอบแล้ว', value: noteStats.delivered, tone: 'success' },
            { label: 'รอดำเนินการ', value: noteStats.pending, tone: 'warning' },
            { label: 'ลูกค้า', value: noteStats.customerCount, tone: 'neutral' },
          ].map((pill) => (
            <div key={pill.label} className={`accounts-pill ${pill.tone}`}>
              <span>{pill.label}</span>
              <strong>{pill.value}</strong>
            </div>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="responsive-stats-grid" style={{ marginBottom: '1.5rem' }}>
        {[
          { label: 'ใบส่งของทั้งหมด', value: notes.length, color: 'var(--accent-primary)' },
          { label: 'ส่งมอบเรียบร้อย', value: notes.filter(n => n.status === 'Delivered').length, color: 'var(--status-success)' },
          { label: 'ลูกค้าที่มีใบส่งของ', value: new Set(notes.map(n => n.customerId)).size, color: 'var(--status-warning)' },
        ].map(s => (
          <div key={s.label} className="card" style={{ padding: '1rem 1.25rem' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="responsive-toolbar">
        <div className="responsive-toolbar-search">
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input aria-label="ค้นหาเลขที่หรือชื่อลูกค้า..." className="form-control" style={{ paddingLeft: '2rem', paddingRight: '2rem', minWidth: 220 }} placeholder="ค้นหาเลขที่หรือชื่อลูกค้า..." value={search} onChange={e => setSearch(e.target.value)} />
          {!search && <CameraScanButton variant="inline" onScan={setSearch} />}
        </div>
        <div className="responsive-toolbar-filters">
          <select aria-label="กรองตามลูกค้า" className="form-control" style={{ minWidth: 180 }} value={filterCustomerId} onChange={e => setFilterCustomerId(e.target.value)}>
            <option value="">— ลูกค้าทั้งหมด —</option>
            {[...customers].sort((a, b) => a.name.localeCompare(b.name)).map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <ThaiDateInput aria-label="กรองตั้งแต่วันที่" className="form-control" style={{ fontSize: 13 }} value={dateFrom} onChange={e => setDateFrom(e.target.value)} title="เริ่มต้น" />
          <ThaiDateInput aria-label="กรองถึงวันที่" className="form-control" style={{ fontSize: 13 }} value={dateTo} onChange={e => setDateTo(e.target.value)} title="สิ้นสุด" />
          {(search || filterCustomerId || dateFrom || dateTo) && (
            <button className="btn btn-outline" style={{ fontSize: 13 }} onClick={() => { setSearch(''); setFilterCustomerId(''); setDateFrom(''); setDateTo(''); }}>
              <X size={13}/> ล้าง
            </button>
          )}
        </div>
        <span className="responsive-toolbar-meta">{filtered.length} รายการ</span>
      </div>

      {/* Table */}
      <div className="accounts-document-grid">
        <div className="card">
          <div className="table-container">
            <table>
            <thead>
              <tr>
                <SortableTh {...sort.th('docNumber')}>เลขที่</SortableTh>
                <SortableTh {...sort.th('customer')}>ลูกค้า</SortableTh>
                <SortableTh {...sort.th('deliveryDate')}>วันที่ส่ง</SortableTh>
                <SortableTh {...sort.th('status')} style={{ textAlign: 'center' }}>สถานะ</SortableTh>
                <SortableTh {...sort.th('items')} style={{ textAlign: 'center' }}>รายการ</SortableTh>
                <SortableTh {...sort.th('robots')} style={{ textAlign: 'center' }}>หุ่นยนต์</SortableTh>
                <SortableTh {...sort.th('createdBy')}>สร้างโดย</SortableTh>
                <th style={{ textAlign: 'right' }}>การดำเนินการ</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>กำลังโหลด...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                  {search || filterCustomerId ? 'ไม่พบรายการที่ค้นหา' : 'ยังไม่มีใบส่งของ'}
                </td></tr>
              ) : paginated.map(note => (
                <tr key={note.id} className={selectedNoteId === note.id ? 'accounts-row-selected' : ''}>
                  <td style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', fontSize: 13 }}>
                    <button className="accounts-row-link" type="button" title={`เปิดสรุป ${note.docNumber}`} aria-label={`เปิดสรุป ${note.docNumber}`} onClick={() => setSelectedNoteId(note.id)}>{note.docNumber}</button>
                  </td>
                  <td style={{ cursor: 'pointer' }} onClick={() => setSelectedNoteId(note.id)}>{note.customer?.name || '-'}</td>
                  <td>{formatDate(note.deliveryDate)}</td>
                  <td style={{ textAlign: 'center' }}>
                    <DeliveryStatusBadge status={note.status} />
                  </td>
                  <td style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>{note.items?.length || 0}</td>
                  <td style={{ textAlign: 'center' }}><span className="badge info">{totalRobots(note)}</span></td>
                  <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{note.createdBy || '-'}</td>
                  <td>
                    <div className="responsive-table-actions">
                      <button className="btn btn-outline" style={{ padding: '0.3rem 0.55rem' }} title="ดู/พิมพ์" aria-label={`ดู/พิมพ์ ${note.docNumber}`} onClick={() => handleView(note)}><Eye size={13}/></button>
                      <button className="btn btn-outline" style={{ padding: '0.3rem 0.55rem' }} title="ไฟล์แนบ (เอกสารเซ็น)" aria-label={`ไฟล์แนบ ${note.docNumber}`} onClick={() => setAttachNote(note)}><Paperclip size={13}/></button>
                      {DN_NEXT[note.status] && (
                        <button className="btn btn-outline" type="button" style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem', borderColor: 'var(--status-success)', color: 'var(--status-success)', display: 'flex', alignItems: 'center', gap: '0.3rem' }} title={`เปลี่ยน ${note.docNumber} เป็น ${dnStatusLabel(DN_NEXT[note.status])}`} aria-label={`เปลี่ยน ${note.docNumber} เป็น ${dnStatusLabel(DN_NEXT[note.status])}`} onClick={() => handleAdvanceStatus(note)}>
                          <CheckCircle size={13}/> {dnStatusLabel(DN_NEXT[note.status])}
                        </button>
                      )}
                      <button className="btn btn-outline" style={{ padding: '0.3rem 0.55rem' }} title="แก้ไข" aria-label={`แก้ไข ${note.docNumber}`} onClick={() => { setEditingNote(note); setIsFormOpen(true); }}><Edit2 size={13}/></button>
                      {isAdmin && <button className="btn btn-outline" style={{ padding: '0.3rem 0.55rem', color: 'var(--status-danger)' }} title="ลบ" aria-label={`ลบ ${note.docNumber}`} onClick={() => handleDelete(note)}><Trash2 size={13}/></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
        </div>

        <div className="card accounts-document-panel">
          {selectedNote ? (
            <>
              <div className="accounts-document-panel-head">
                <div>
                  <div className="accounts-document-kicker">แผงตรวจสอบใบส่งของ</div>
                  <div className="accounts-document-title">{selectedNote.docNumber}</div>
                  <div className="accounts-document-meta">{selectedNote.customer?.name || '-'} · ส่งวันที่ {formatDate(selectedNote.deliveryDate)}</div>
                </div>
                <DeliveryStatusBadge status={selectedNote.status} />
              </div>

              <div className="accounts-panel-actions responsive-action-group">
                <button className="btn btn-outline" type="button" title={`ดูรายละเอียด ${selectedNote.docNumber}`} aria-label={`ดูรายละเอียด ${selectedNote.docNumber}`} onClick={() => handleView(selectedNote)}><Eye size={14} /> ดู/พิมพ์</button>
                <button className="btn btn-outline" type="button" title={`ไฟล์แนบ ${selectedNote.docNumber}`} aria-label={`ไฟล์แนบ ${selectedNote.docNumber}`} onClick={() => setAttachNote(selectedNote)}><Paperclip size={14} /> ไฟล์แนบ</button>
                {selectedNote.status !== 'Invoiced' && DN_NEXT[selectedNote.status] && (
                  <button className="btn btn-primary" type="button" title={`เปลี่ยน ${selectedNote.docNumber} เป็น ${dnStatusLabel(DN_NEXT[selectedNote.status])}`} aria-label={`เปลี่ยน ${selectedNote.docNumber} เป็น ${dnStatusLabel(DN_NEXT[selectedNote.status])}`} onClick={() => handleAdvanceStatus(selectedNote)}><CheckCircle size={14} /> {dnStatusLabel(DN_NEXT[selectedNote.status])}</button>
                )}
              </div>

              {(() => {
                const statusCfg = DN_STATUS[selectedNote.status] ?? DN_STATUS.Pending;
                return (
                  <div style={{ marginBottom: 16, padding: '12px 14px', borderRadius: 12, border: `1px solid ${statusCfg.border}`, background: statusCfg.bg }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: statusCfg.color, marginBottom: 4 }}>
                      สถานะปัจจุบัน: {statusCfg.label}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{getDeliveryStatusNarrative(selectedNote)}</div>
                  </div>
                );
              })()}

              <div className="accounts-info-stack">
                <div className="accounts-info-block">
                  <span>ลูกค้า</span>
                  <strong>{selectedNote.customer?.name || '-'}</strong>
                </div>
                <div className="accounts-info-block">
                  <span>จำนวนรายการ</span>
                  <strong>{selectedNote.items?.length || 0}</strong>
                </div>
                <div className="accounts-info-block">
                  <span>จำนวนหุ่นยนต์</span>
                  <strong>{totalRobots(selectedNote)}</strong>
                </div>
                <div className="accounts-info-block">
                  <span>สร้างโดย</span>
                  <strong>{selectedNote.createdBy || '-'}</strong>
                </div>
              </div>

              <div className="accounts-side-section">
                <div className="accounts-side-section-title">รายการที่ส่ง</div>
                <div className="accounts-line-list">
                  {selectedNote.items.map((item, idx) => {
                    const sns = parseSN(item.serialNumbers);
                    return (
                      <div key={`${selectedNote.id}-${idx}`} className="accounts-line-item compact">
                        <div>
                          <strong>{extractDisplayEnglish(item.description, item.description)}</strong>
                          <span>{item.quantity} ชิ้น{item.remark ? ` · ${item.remark}` : ''}</span>
                          {sns.length > 0 && <span>SN: {sns.slice(0, 3).join(', ')}{sns.length > 3 ? ' ...' : ''}</span>}
                        </div>
                        <strong>{item.quantity}</strong>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="accounts-side-section">
                <div className="accounts-side-section-title">สรุปการเซ็นรับ</div>
                <div className="accounts-line-list">
                  <div className="accounts-line-item compact">
                    <div>
                      <strong>ผู้ส่งมอบ</strong>
                      <span>{selectedNote.senderName || 'ยังไม่ระบุ'}</span>
                    </div>
                  </div>
                  <div className="accounts-line-item compact">
                    <div>
                      <strong>ผู้รับ</strong>
                      <span>{selectedNote.recipientName || 'ยังไม่ระบุ'}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="accounts-side-section">
                <div className="accounts-side-section-title">ความเคลื่อนไหว</div>
                {loadingNoteLogs ? (
                  <div className="accounts-empty-note">กำลังโหลดประวัติใบส่งของ...</div>
                ) : selectedNoteLogs.length > 0 ? (
                  <div className="accounts-line-list">
                    {selectedNoteLogs.slice(0, 6).map(log => {
                      const detail = renderNoteActivityDetail(log);
                      return (
                        <div key={log.id} className={`accounts-activity-item tone-${noteActivityTone(log.action)}`}>
                          <div className="accounts-activity-topline">
                            <strong>{noteActivityLabel(log.action)}</strong>
                            <span>{formatDateTime(log.performedAt)}</span>
                          </div>
                          {detail && <div className="accounts-activity-detail">{detail}</div>}
                          <div className="accounts-activity-meta">โดย {log.performedBy || 'ระบบ'}</div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="accounts-empty-note">ยังไม่มีประวัติการทำงานสำหรับใบส่งของนี้</div>
                )}
              </div>

              <div className="accounts-side-section">
                <div className="accounts-side-section-title">ไฟล์แนบ</div>
                <AttachmentPanel elementType="delivery-note" elementId={selectedNote.id} />
              </div>

              {selectedNote.notes && (
                <div className="accounts-side-section">
                  <div className="accounts-side-section-title">หมายเหตุเอกสาร</div>
                  <div className="accounts-empty-note">{selectedNote.notes}</div>
                </div>
              )}
            </>
          ) : (
            <div className="accounts-panel-empty">
              <Package size={42} style={{ color: 'var(--text-muted)' }} />
              <div>
                <strong>เลือกใบส่งของจากรายการ</strong>
                <p>แผงนี้สรุปลูกค้า, รายการที่ส่ง, การเซ็นรับ และการดำเนินการที่ใช้บ่อยสำหรับการส่งมอบ</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {isFormOpen && (
        <DeliveryNoteForm
          initial={editingNote}
          initialCustomerId={editingNote ? undefined : navState.customerId}
          initialRobotIds={editingNote ? undefined : (navState.robotId ? [navState.robotId] : undefined)}
          onSave={handleSave}
          onClose={() => { setIsFormOpen(false); setEditingNote(null); }}
        />
      )}
      {isPhotoFormOpen && <DeliveryPhotoForm onSave={handlePhotoSave} onClose={() => setIsPhotoFormOpen(false)} />}
      {viewingNote && <PrintView note={viewingNote} customer={viewingCustomer} onClose={() => setViewingNote(null)} />}

      <Modal open={!!attachNote} onClose={() => setAttachNote(null)} title={<>ไฟล์แนบ — {attachNote?.docNumber}</>} width={560} describedById="delivery-note-attachment-description">
        <p id="delivery-note-attachment-description" style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: '1rem', marginTop: 0 }}>แนบเอกสารที่ลูกค้าเซ็นรับแล้ว เช่น PDF สแกน หรือรูปถ่าย</p>
            {attachNote && <AttachmentPanel elementType="delivery-note" elementId={attachNote.id} />}
      </Modal>
    </div>
  );
};

export default DeliveryNotes;
