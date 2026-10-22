import React, { useEffect, useState, useMemo, useRef } from 'react';
import { todayISO } from '../utils/thaiDate';
import { useConfirm } from '../context/ConfirmContext';
import { useToast } from '../context/ToastContext';
import { Plus, Search, Printer, ChevronDown, ChevronRight, X, CheckCircle, PlayCircle, RotateCcw, XCircle, CornerDownLeft, Paperclip } from 'lucide-react';
import api from '../api';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import PageHeader from '../components/PageHeader';
import { ThaiDateInput } from '../components/ThaiDateInput';
import CameraScanButton from '../components/CameraScanButton';
import Pagination from '../components/Pagination';
import { printPDF, logoSVG } from '../utils/printPDF';
import { Modal, FormSubmitButton, useUrlSearch, useTableSort, SortableTh, useOpenFromUrl } from '../components/UIUtils';
import AttachmentPanel from '../components/AttachmentPanel';

// ── Types ─────────────────────────────────────────────────────────────────────

interface LoanItem {
  id: string;
  robotId: string;
  serialNumber: string;
  modelName: string;
  returnedAt?: string | null;
  condition?: string | null;
}

interface Loan {
  id: string;
  docNumber: string;
  purpose: string;
  loanDate: string;
  expectedReturn: string;
  actualReturn?: string | null;
  status: 'Pending' | 'Approved' | 'Active' | 'Returned' | 'Cancelled';
  borrowerName: string;
  borrowerPhone?: string | null;
  borrowerDept?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  notes?: string | null;
  createdBy?: string | null;
  createdAt: string;
  items: LoanItem[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  Pending: 'รออนุมัติ',
  Approved: 'อนุมัติแล้ว',
  Active: 'กำลังยืม',
  Returned: 'คืนแล้ว',
  Cancelled: 'ยกเลิก',
};

const STATUS_CLASS: Record<string, string> = {
  Pending: 'warning',
  Approved: 'info',
  Active: 'success',
  Returned: 'secondary',
  Cancelled: 'danger',
};

const CONDITION_LABEL: Record<string, string> = {
  Good: 'สภาพดี',
  Damaged: 'ชำรุด',
  'Needs Repair': 'ต้องซ่อม',
};

function today() {
  return todayISO();
}

function isOverdue(loan: Loan) {
  return (loan.status === 'Approved' || loan.status === 'Active') && loan.expectedReturn < today();
}

// ── Robot Picker (reused pattern) ─────────────────────────────────────────────

interface RobotPickerProps {
  selected: string[];
  onChange: (ids: string[]) => void;
}

const RobotPicker: React.FC<RobotPickerProps> = ({ selected, onChange }) => {
  const { robots, models } = useData();
  const [search, setSearch] = useState('');
  const [onlyStock, setOnlyStock] = useState(true);

  const filtered = useMemo(() => {
    return robots.filter(r => {
      if (onlyStock && r.status !== 'In Stock') return false;
      const term = search.toLowerCase();
      if (!term) return true;
      const m = models.find(m => m.id === r.modelId);
      return r.serialNumber.toLowerCase().includes(term) || m?.name.toLowerCase().includes(term);
    });
  }, [robots, models, search, onlyStock]);

  const byModel = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const r of filtered) {
      const key = models.find(m => m.id === r.modelId)?.name || 'ไม่ระบุรุ่น';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return map;
  }, [filtered, models]);

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);
  };

  const toggleGroup = (ids: string[]) => {
    const allSelected = ids.every(id => selected.includes(id));
    if (allSelected) {
      onChange(selected.filter(x => !ids.includes(x)));
    } else {
      const toAdd = ids.filter(id => !selected.includes(id));
      onChange([...selected, ...toAdd]);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'center' }}>
        <input aria-label="ค้นหา SN / รุ่น..."
          className="form-control"
          style={{ flex: 1 }}
          placeholder="ค้นหา SN / รุ่น..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <CameraScanButton onScan={setSearch} />
        <label style={{ display: 'flex', gap: '0.3rem', alignItems: 'center', fontSize: '0.85rem', whiteSpace: 'nowrap', cursor: 'pointer' }}>
          <input type="checkbox" checked={onlyStock} onChange={e => setOnlyStock(e.target.checked)} />
          เฉพาะ In Stock
        </label>
      </div>
      <div style={{ border: '1px solid var(--border)', borderRadius: 6, maxHeight: 320, overflowY: 'auto' }}>
        {byModel.size === 0 && (
          <div style={{ padding: '0.75rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>ไม่พบหุ่นยนต์</div>
        )}
        {Array.from(byModel.entries()).map(([modelName, list]) => {
          const groupIds = list.map(r => r.id);
          const allChecked = groupIds.every(id => selected.includes(id));
          const someChecked = groupIds.some(id => selected.includes(id));
          return (
            <div key={modelName}>
              <div
                style={{ padding: '0.4rem 0.75rem', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', gap: '0.5rem', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                onClick={() => toggleGroup(groupIds)}
              >
                <input aria-label="เลือกทั้งหมดในหน้านี้" type="checkbox" checked={allChecked} ref={el => { if (el) el.indeterminate = someChecked && !allChecked; }} onChange={() => toggleGroup(groupIds)} onClick={e => e.stopPropagation()} />
                <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{modelName}</span>
                <span style={{ marginLeft: 'auto', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{list.filter(r => selected.includes(r.id)).length}/{list.length}</span>
              </div>
              {list.map(r => (
                <label key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.35rem 0.75rem 0.35rem 1.5rem', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}>
                  <input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggle(r.id)} />
                  <span style={{ fontSize: '0.85rem', flex: 1 }}>{r.serialNumber}</span>
                  <span className={`badge ${r.status === 'In Stock' ? 'success' : r.status === 'Assigned' ? 'info' : 'warning'}`} style={{ fontSize: '0.7rem' }}>{r.status === 'In Stock' ? 'ในคลัง' : r.status === 'Assigned' ? 'ติดตั้งแล้ว' : r.status === 'Missing' ? 'สูญหาย' : 'ซ่อมบำรุง'}</span>
                </label>
              ))}
            </div>
          );
        })}
      </div>
      {selected.length > 0 && (
        <div style={{ marginTop: '0.4rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
          เลือก {selected.length} เครื่อง
        </div>
      )}
    </div>
  );
};

// ── Print View ────────────────────────────────────────────────────────────────

const PrintView: React.FC<{ loan: Loan; onClose: () => void }> = ({ loan, onClose }) => {
  const fmtDate = (d?: string | null) => {
    if (!d) return '-';
    const s = d.split('T')[0];
    const parts = s.split('-');
    if (parts.length !== 3) return d;
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  };

  const handlePrint = () => {
    const itemsHtml = loan.items.map((it, i) => `
      <tr>
        <td style="text-align:center">${i + 1}</td>
        <td style="font-variant-numeric:tabular-nums">${it.serialNumber}</td>
        <td>${it.modelName}</td>
        <td style="color:#6b7280">${loan.notes || '-'}</td>
      </tr>`).join('');

    const html = `
      <div class="doc-header">
        <div style="display:flex;flex-direction:column;gap:4px">
          ${logoSVG}
          <div style="font-size:9pt;font-weight:600;color:#1e3a8a;margin-top:6px">บริษัท โอโซนสามหกศูนย์ จำกัด</div>
          <div style="font-size:8pt;color:#6b7280;line-height:1.5">31 ถ.สันติธรรม ต.ช้างเผือก อ.เมือง จ.เชียงใหม่ 50300</div>
          <div style="font-size:8pt;color:#6b7280">เลขที่ผู้เสียภาษี 0505565019503</div>
        </div>
        <div class="doc-title-block">
          <div class="doc-type">ใบยืมหุ่นยนต์</div>
          <div class="doc-meta">
            Robot Loan Request<br/>
            เลขที่: <strong>${loan.docNumber}</strong><br/>
            วันที่ยืม: ${fmtDate(loan.loanDate)}<br/>
            สถานะ: ${STATUS_LABEL[loan.status]}
          </div>
        </div>
      </div>

      <div class="info-grid">
        <div class="info-box">
          <h3>ข้อมูลผู้ยืม</h3>
          <p><strong>${loan.borrowerName}</strong></p>
          ${loan.borrowerDept ? `<p>ชื่อบริษัท: ${loan.borrowerDept}</p>` : ''}
          ${loan.borrowerPhone ? `<p>โทร: ${loan.borrowerPhone}</p>` : ''}
        </div>
        <div class="info-box">
          <h3>รายละเอียดการยืม</h3>
          <p>วัตถุประสงค์: ${loan.purpose}</p>
          <p>กำหนดคืน: ${fmtDate(loan.expectedReturn)}</p>
          ${loan.actualReturn ? `<p>วันที่คืนจริง: ${fmtDate(loan.actualReturn)}</p>` : ''}
          ${loan.approvedBy ? `<p>อนุมัติโดย: ${loan.approvedBy}${loan.approvedAt ? ` (${fmtDate(loan.approvedAt)})` : ''}</p>` : ''}
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th style="width:40px;text-align:center">#</th>
            <th>หมายเลขเครื่อง (SN)</th>
            <th>รุ่น (Model)</th>
            <th>หมายเหตุ</th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>

      <div style="margin-bottom:20px;padding:12px 16px;border:1px solid #e5e7eb;border-radius:6px;font-size:9pt">
        <div style="font-weight:700;color:#1e3a8a;margin-bottom:8px;font-size:9.5pt">เงื่อนไขการยืม</div>
        <ul style="margin:0;padding-left:18px;color:#374151;line-height:1.9">
          <li>ผู้ยืมเป็นผู้รับผิดชอบในการดูแล รักษาหุ่นยนต์ ไม่ให้เกิดการชำรุดเสียหาย ใช้การไม่ได้ หรือสูญหายไป รวมถึงใช้จ่ายในการพึ่งพาหุ่นยนต์ได้รับความเสียหาย</li>
          <li>หลังจากเซ็นรับแล้ว ถือว่ารับทราบยอมรับว่าได้รับหุ่นยนต์ในสภาพสมบูรณ์</li>
          <li>ต้องคืนหุ่นยนต์ภายในวันที่กำหนด หากเกินกำหนดต้องแจ้งล่วงหน้าเพื่อขอขยายเวลา</li>
          <li>ห้ามนำหุ่นยนต์ไปให้บุคคลภายนอกหรือองค์กรอื่นใช้งานโดยไม่ได้รับอนุญาต</li>
        </ul>
      </div>

      <div class="sig-row" style="grid-template-columns:1fr 1fr">
        <div class="sig-box">
          <div class="sig-line" style="width:65%;margin:0 auto"></div>
          <div class="sig-label">ผู้ยืม</div>
        </div>
        <div class="sig-box">
          <div class="sig-line" style="width:65%;margin:0 auto"></div>
          <div class="sig-label">ผู้มอบ</div>
        </div>
      </div>
    `;

    printPDF(html, `LN-${loan.docNumber}`);
  };

  const thStyle: React.CSSProperties = { background: '#1e3a8a', color: 'var(--text-on-accent)', fontWeight: 600, padding: '9px 12px', textAlign: 'left', fontSize: 12, letterSpacing: 0.3 };
  const tdStyle: React.CSSProperties = { border: '1px solid var(--border-color)', padding: '7px 12px', fontSize: 12, verticalAlign: 'top' };

  return (
    <Modal open={true} onClose={onClose} title="ใบยืมหุ่นยนต์" width={860} describedById="robot-loan-preview-description">

        <div id="robot-loan-preview-description" style={{ marginBottom: '1rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          ตัวอย่างเอกสารใบยืมหุ่นยนต์สำหรับพิมพ์ พร้อมข้อมูลผู้ยืม รายการหุ่นยนต์ และเงื่อนไขการยืม
        </div>

        {/* Toolbar */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginBottom: '1.25rem' }}>
          <button className="btn btn-primary" style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }} onClick={handlePrint} aria-label="พิมพ์ใบยืม">
            <Printer size={16} /> พิมพ์
          </button>
        </div>

        {/* Document preview */}
        <div className="a4-document-preview" style={{ background: 'var(--text-on-accent)', color: '#111', padding: '32px 36px', border: '1px solid var(--border-color)', borderRadius: 8, fontFamily: 'inherit' }}>

          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: 14, borderBottom: '2px solid #1e3a8a', marginBottom: 22 }}>
            <div>
              <img src="/ozone360-logo-real.png" alt="OZONE360" style={{ height: 48, width: 'auto', objectFit: 'contain', display: 'block', marginBottom: 6 }} />
              <div style={{ fontSize: 12, fontWeight: 700, color: '#1e3a8a' }}>บริษัท โอโซนสามหกศูนย์ จำกัด</div>
              <div style={{ fontSize: 11, color: 'var(--status-neutral)', lineHeight: 1.6 }}>31 ถ.สันติธรรม ต.ช้างเผือก อ.เมือง จ.เชียงใหม่ 50300</div>
              <div style={{ fontSize: 11, color: 'var(--status-neutral)' }}>เลขที่ผู้เสียภาษี 0505565019503</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#1e3a8a', letterSpacing: 0.5 }}>ใบยืมหุ่นยนต์</div>
              <div style={{ fontSize: 11, color: 'var(--status-neutral)', marginTop: 2 }}>Robot Loan Request</div>
              <div style={{ fontSize: 12, marginTop: 6 }}>เลขที่: <strong>{loan.docNumber}</strong></div>
              <div style={{ fontSize: 12 }}>วันที่ยืม: <strong>{fmtDate(loan.loanDate)}</strong></div>
              <div style={{ fontSize: 12 }}>สถานะ: <strong style={{ color: loan.status === 'Active' ? 'var(--status-success)' : loan.status === 'Returned' ? 'var(--status-neutral)' : '#1e3a8a' }}>{STATUS_LABEL[loan.status]}</strong></div>
            </div>
          </div>

          {/* Info grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 32px', marginBottom: 20, padding: '14px 18px', background: 'var(--surface-soft)', border: '1px solid var(--border-color)', borderRadius: 8 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--status-neutral)', letterSpacing: 1, marginBottom: 8 }}>ข้อมูลผู้ยืม</div>
              <div style={{ fontSize: 13, lineHeight: 1.8 }}>
                <div><b>ชื่อผู้ยืม:</b> {loan.borrowerName}</div>
                <div><b>ชื่อบริษัท:</b> {loan.borrowerDept || '-'}</div>
                <div><b>เบอร์โทร:</b> {loan.borrowerPhone || '-'}</div>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--status-neutral)', letterSpacing: 1, marginBottom: 8 }}>รายละเอียดการยืม</div>
              <div style={{ fontSize: 13, lineHeight: 1.8 }}>
                <div><b>วัตถุประสงค์:</b> {loan.purpose}</div>
                <div><b>กำหนดคืน:</b> {fmtDate(loan.expectedReturn)}</div>
                <div><b>วันที่คืนจริง:</b> {fmtDate(loan.actualReturn)}</div>
                {loan.approvedBy && <div><b>อนุมัติโดย:</b> {loan.approvedBy}{loan.approvedAt ? ` (${fmtDate(loan.approvedAt)})` : ''}</div>}
              </div>
            </div>
          </div>

          {/* Items table */}
          <table style={{ marginBottom: 18 }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, textAlign: 'center', width: 40 }}>#</th>
                <th style={thStyle}>หมายเลขเครื่อง (SN)</th>
                <th style={thStyle}>รุ่น (Model)</th>
                <th style={thStyle}>หมายเหตุ</th>
              </tr>
            </thead>
            <tbody>
              {loan.items.map((it, i) => (
                <tr key={it.id} style={{ background: i % 2 === 0 ? 'var(--text-on-accent)' : 'var(--surface-soft)' }}>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>{i + 1}</td>
                  <td style={{ ...tdStyle, fontVariantNumeric: 'tabular-nums' }}>{it.serialNumber}</td>
                  <td style={tdStyle}>{it.modelName}</td>
                  <td style={tdStyle}>{loan.notes || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Conditions */}
          <div style={{ marginBottom: 22, padding: '12px 16px', border: '1px solid var(--border-color)', borderRadius: 6, fontSize: 11 }}>
            <div style={{ fontWeight: 700, color: '#1e3a8a', marginBottom: 8, fontSize: 12 }}>เงื่อนไขการยืม</div>
            <ul style={{ margin: 0, paddingLeft: 18, color: '#374151', lineHeight: 1.9 }}>
              <li>ผู้ยืมเป็นผู้รับผิดชอบในการดูแล รักษาหุ่นยนต์ ไม่ให้เกิดการชำรุดเสียหาย ใช้การไม่ได้ หรือสูญหายไป รวมถึงใช้จ่ายในการพึ่งพาหุ่นยนต์ได้รับความเสียหาย</li>
              <li>หลังจากเซ็นรับแล้ว ถือว่ารับทราบยอมรับว่าได้รับหุ่นยนต์ในสภาพสมบูรณ์</li>
              <li>ต้องคืนหุ่นยนต์ภายในวันที่กำหนด หากเกินกำหนดต้องแจ้งล่วงหน้าเพื่อขอขยายเวลา</li>
              <li>ห้ามนำหุ่นยนต์ไปให้บุคคลภายนอกหรือองค์กรอื่นใช้งานโดยไม่ได้รับอนุญาต</li>
            </ul>
          </div>

          {/* Signatures */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, marginTop: 44, paddingTop: 18, borderTop: '1px solid var(--border-color)' }}>
            {[
              { label: 'ผู้ยืม' },
              { label: 'ผู้มอบ' },
            ].map(s => (
              <div key={s.label} style={{ textAlign: 'center' }}>
                <div style={{ height: 44 }} />
                <div style={{ borderTop: '1.5px solid #374151', paddingTop: 8, width: '65%', margin: '0 auto' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#111' }}>{s.label}</div>
                </div>
              </div>
            ))}
          </div>

        </div>
    </Modal>
  );
};

// ── Status Action Modal ───────────────────────────────────────────────────────

interface StatusModalProps {
  loan: Loan;
  nextStatus: 'Approved' | 'Active' | 'Returned' | 'Cancelled';
  onConfirm: (notes?: string, file?: File) => void;
  onClose: () => void;
}

const StatusModal: React.FC<StatusModalProps> = ({ loan, nextStatus, onConfirm, onClose }) => {
  const [notes, setNotes] = useState(loan.notes || '');
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const labels: Record<string, string> = {
    Approved: 'อนุมัติการยืม',
    Active: 'เริ่มการยืม (ส่งมอบหุ่นยนต์)',
    Returned: 'บันทึกการคืน',
    Cancelled: 'ยกเลิกใบยืม',
  };
  const colors: Record<string, string> = {
    Approved: 'btn-primary',
    Active: 'btn-success',
    Returned: 'btn-primary',
    Cancelled: 'btn-danger',
  };
  const requiresEvidence = nextStatus === 'Active' || nextStatus === 'Returned';
  const canConfirm = !requiresEvidence || !!evidenceFile;
  return (
    <Modal open={true} onClose={onClose} title={labels[nextStatus]} width={420} describedById="robot-loan-status-description">
        <p id="robot-loan-status-description" style={{ marginBottom: '1rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          เลขที่: <b>{loan.docNumber}</b> &nbsp;|&nbsp; ผู้ยืม: <b>{loan.borrowerName}</b>
          {nextStatus === 'Returned' && <><br />หุ่นยนต์ {loan.items.length} เครื่อง จะถูกบันทึกว่าคืนแล้ว</>}
          {nextStatus === 'Active' && <><br />ต้องแนบหลักฐานใบยืมที่ผู้ยืมเซ็นแล้วก่อนเริ่มยืม</>}
        </p>
        <div style={{ marginBottom: '1rem' }}>
          <label className="form-label" htmlFor="robotloans-notes">หมายเหตุ (ถ้ามี)</label>
          <textarea id="robotloans-notes" className="form-control" rows={3} value={notes} onChange={e => setNotes(e.target.value)} />
        </div>
        {requiresEvidence && (
          <div style={{ marginBottom: '1rem' }}>
            <label className="form-label" htmlFor="robotloans-file">{nextStatus === 'Active' ? 'ไฟล์หลักฐานใบยืม' : 'ไฟล์หลักฐานรับคืน'} <span style={{ color: 'var(--status-danger)' }}>*</span></label>
            <input id="robotloans-file" type="file" className="form-control" accept="image/*,.pdf" onChange={e => setEvidenceFile(e.target.files?.[0] || null)} />
            {!evidenceFile && <div style={{ marginTop: 4, fontSize: 11, color: 'var(--status-danger)' }}>ต้องแนบรูปถ่ายหรือ PDF ก่อนยืนยัน</div>}
          </div>
        )}
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button className="btn btn-outline" onClick={onClose}>ยกเลิก</button>
          <button className={`btn ${colors[nextStatus]}`} disabled={!canConfirm} onClick={() => onConfirm(notes || undefined, evidenceFile || undefined)}>{labels[nextStatus]}</button>
        </div>
    </Modal>
  );
};

// ── Return Item Modal (partial return) ───────────────────────────────────────

interface ReturnItemModalProps {
  item: LoanItem;
  onConfirm: (condition: string, file?: File) => Promise<void> | void;
  onClose: () => void;
}

const ReturnItemModal: React.FC<ReturnItemModalProps> = ({ item, onConfirm, onClose }) => {
  const [condition, setCondition] = useState('Good');
  // Locks the modal while the evidence uploads and the return is saved, so it can't be sent twice.
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try { await onConfirm(condition, evidenceFile || undefined); } finally { setBusy(false); }
  };
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  return (
    <Modal open={true} onClose={onClose} preventClose={busy} title="บันทึกคืนหุ่นยนต์" width={380} describedById="robot-loan-return-item-description">
        <p id="robot-loan-return-item-description" style={{ marginBottom: '1rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          <b style={{ fontVariantNumeric: 'tabular-nums' }}>{item.serialNumber}</b> — {item.modelName}
        </p>
        <div style={{ marginBottom: '1rem' }}>
          <span id="robotloans-condition2-label" className="form-label">สภาพเมื่อคืน</span>
          <div role="group" aria-labelledby="robotloans-condition2-label" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
            {(['Good', 'Damaged', 'Needs Repair'] as const).map(c => (
              <button key={c} type="button" onClick={() => setCondition(c)}
                style={{ padding: '6px 14px', borderRadius: 999, fontSize: 12, fontWeight: 600,
                  border: `1.5px solid ${condition === c ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                  background: condition === c ? 'var(--accent-subtle)' : 'transparent',
                  color: condition === c ? 'var(--accent-primary)' : 'var(--text-secondary)', cursor: 'pointer' }}
              >{CONDITION_LABEL[c]}</button>
            ))}
          </div>
        </div>
        <div style={{ marginBottom: '1rem' }}>
          <label className="form-label" htmlFor="robotloans-field4">ไฟล์หลักฐาน <span style={{ color: 'var(--status-danger)' }}>*</span></label>
          <input id="robotloans-field4" type="file" className="form-control" accept="image/*,.pdf" onChange={e => setEvidenceFile(e.target.files?.[0] || null)} />
          {!evidenceFile && <div style={{ marginTop: 4, fontSize: 11, color: 'var(--status-danger)' }}>ต้องแนบรูปถ่ายหรือ PDF ก่อนบันทึกคืน</div>}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button className="btn btn-outline" onClick={onClose}>ยกเลิก</button>
          <button className="btn btn-primary" disabled={!evidenceFile || busy} onClick={() => void submit()}>{busy ? 'กำลังบันทึก...' : 'บันทึกคืน'}</button>
        </div>
    </Modal>
  );
};

// ── Bulk Return Modal ────────────────────────────────────────────────────────

interface BulkReturnModalProps {
  items: LoanItem[];
  onConfirm: (condition: string, file?: File) => Promise<void> | void;
  onClose: () => void;
}

const BulkReturnModal: React.FC<BulkReturnModalProps> = ({ items, onConfirm, onClose }) => {
  const [condition, setCondition] = useState('Good');
  // Locks the modal while the evidence uploads and the return is saved, so it can't be sent twice.
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try { await onConfirm(condition, evidenceFile || undefined); } finally { setBusy(false); }
  };
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  return (
    <Modal open={true} onClose={onClose} preventClose={busy} title={`คืนหุ่นยนต์ ${items.length} เครื่อง`} width={400} describedById="robot-loan-bulk-return-description">
        <p id="robot-loan-bulk-return-description" style={{ marginBottom: '1rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          เลือกสภาพการคืนร่วมกันและแนบไฟล์หลักฐานสำหรับหุ่นยนต์ {items.length} เครื่อง
        </p>
        <div style={{ marginBottom: '1rem', maxHeight: 160, overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 6, padding: '0.5rem' }}>
          {items.map(it => (
            <div key={it.id} style={{ fontSize: '0.85rem', padding: '2px 0', fontVariantNumeric: 'tabular-nums' }}>{it.serialNumber} <span style={{ color: 'var(--text-muted)', fontFamily: 'inherit', fontSize: '0.78rem' }}>— {it.modelName}</span></div>
          ))}
        </div>
        <div style={{ marginBottom: '1rem' }}>
          <span className="form-label" id="robotloans-condition-label">สภาพเมื่อคืน</span>
          <div role="group" aria-labelledby="robotloans-condition-label" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
            {(['Good', 'Damaged', 'Needs Repair'] as const).map(c => (
              <button key={c} type="button" onClick={() => setCondition(c)}
                style={{ padding: '6px 14px', borderRadius: 999, fontSize: 12, fontWeight: 600,
                  border: `1.5px solid ${condition === c ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                  background: condition === c ? 'var(--accent-subtle)' : 'transparent',
                  color: condition === c ? 'var(--accent-primary)' : 'var(--text-secondary)', cursor: 'pointer' }}>{CONDITION_LABEL[c]}</button>
            ))}
          </div>
        </div>
        <div style={{ marginBottom: '1rem' }}>
          <label className="form-label" htmlFor="robotloans-field8">ไฟล์หลักฐาน <span style={{ color: 'var(--status-danger)' }}>*</span></label>
          <input id="robotloans-field8" type="file" className="form-control" accept="image/*,.pdf" onChange={e => setEvidenceFile(e.target.files?.[0] || null)} />
          {!evidenceFile && <div style={{ marginTop: 4, fontSize: 11, color: 'var(--status-danger)' }}>ต้องแนบรูปถ่ายหรือ PDF ก่อนบันทึกคืน</div>}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button className="btn btn-outline" onClick={onClose}>ยกเลิก</button>
          <button className="btn btn-primary" disabled={!evidenceFile || busy} onClick={() => void submit()}>{busy ? 'กำลังบันทึก...' : 'คืนทั้งหมด'}</button>
        </div>
    </Modal>
  );
};

// ── Loan Form ─────────────────────────────────────────────────────────────────

interface LoanFormProps {
  loan?: Loan;
  onSave: () => void;
  onClose: () => void;
}

const LoanForm: React.FC<LoanFormProps> = ({ loan, onSave, onClose }) => {
  const [form, setForm] = useState({
    borrowerName: loan?.borrowerName || '',
    borrowerPhone: loan?.borrowerPhone || '',
    borrowerDept: loan?.borrowerDept || '',
    purpose: loan?.purpose || '',
    loanDate: loan?.loanDate || today(),
    expectedReturn: loan?.expectedReturn || '',
    notes: loan?.notes || '',
  });
  const [robotIds, setRobotIds] = useState<string[]>(loan?.items.map(it => it.robotId) || []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k: string, v: string) => setForm(prev => ({ ...prev, [k]: v }));

  const handleSubmit = async () => {
    if (!form.borrowerName.trim()) { setError('กรุณากรอกชื่อผู้ยืม'); return; }
    if (!form.purpose.trim()) { setError('กรุณากรอกวัตถุประสงค์'); return; }
    if (!form.loanDate) { setError('กรุณาระบุวันที่ยืม'); return; }
    if (!form.expectedReturn) { setError('กรุณาระบุวันกำหนดคืน'); return; }
    if (!loan && robotIds.length === 0) { setError('กรุณาเลือกหุ่นยนต์อย่างน้อย 1 เครื่อง'); return; }
    setSaving(true);
    setError('');
    try {
      const payload: any = { ...form, customerId: null, robotIds };
      if (loan) {
        await api.put(`/loans/${loan.id}`, payload);
      } else {
        await api.post('/loans', payload);
      }
      onSave();
    } catch (e: any) {
      setError(e.response?.data?.error || 'เกิดข้อผิดพลาด');
      setSaving(false);
    }
  };

  return (
    <Modal open={true} onClose={onClose} title={loan ? 'แก้ไขใบยืม' : 'สร้างใบยืมหุ่นยนต์'} width={860} preventClose={saving} describedById="robot-loan-form-description">
        <p id="robot-loan-form-description" style={{ marginTop: 0, marginBottom: '0.75rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          กรอกข้อมูลผู้ยืม ระบุช่วงเวลายืม และเลือกหุ่นยนต์ที่ต้องการบันทึกในใบยืม
        </p>
        {error && <div className="badge danger" style={{ marginBottom: '0.75rem', display: 'block', padding: '0.5rem' }}>{error}</div>}

        {/* Body — 2 columns: form left, robot picker right */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))', gap: '1.25rem', alignItems: 'start' }}>
          {/* Left: form fields */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
            <div>
              <label className="form-label" htmlFor="robotloans-borrowerName">ชื่อผู้ยืม <span style={{ color: 'var(--status-danger)' }}>*</span></label>
              <input id="robotloans-borrowerName" className="form-control" value={form.borrowerName} onChange={e => set('borrowerName', e.target.value)} />
            </div>
            <div>
              <label className="form-label" htmlFor="robotloans-borrowerDept">ชื่อบริษัท</label>
              <input id="robotloans-borrowerDept" className="form-control" value={form.borrowerDept} onChange={e => set('borrowerDept', e.target.value)} />
            </div>
            <div>
              <label className="form-label" htmlFor="robotloans-borrowerPhone">เบอร์โทรศัพท์</label>
              <input id="robotloans-borrowerPhone" className="form-control" value={form.borrowerPhone} onChange={e => set('borrowerPhone', e.target.value)} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="form-label" htmlFor="robotloans-purpose">วัตถุประสงค์ <span style={{ color: 'var(--status-danger)' }}>*</span></label>
              <input id="robotloans-purpose" className="form-control" value={form.purpose} onChange={e => set('purpose', e.target.value)} />
            </div>
            <div>
              <label className="form-label" htmlFor="robotloans-loanDate">วันที่ยืม <span style={{ color: 'var(--status-danger)' }}>*</span></label>
              <ThaiDateInput id="robotloans-loanDate" className="form-control" value={form.loanDate} onChange={e => set('loanDate', e.target.value)} />
            </div>
            <div>
              <label className="form-label" htmlFor="robotloans-expectedReturn">กำหนดคืน <span style={{ color: 'var(--status-danger)' }}>*</span></label>
              <ThaiDateInput id="robotloans-expectedReturn" className="form-control" value={form.expectedReturn} onChange={e => set('expectedReturn', e.target.value)} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="form-label" htmlFor="robotloans-field16">หมายเหตุ</label>
              <textarea id="robotloans-field16" className="form-control" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
            </div>
          </div>

          {/* Right: robot picker */}
          <div>
            <span id="robotloans-picker-label" className="form-label">เลือกหุ่นยนต์ที่ยืม <span style={{ color: 'var(--status-danger)' }}>*</span></span>
            <div role="group" aria-labelledby="robotloans-picker-label">
              <RobotPicker selected={robotIds} onChange={setRobotIds} />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-color)' }}>
          <button className="btn btn-outline" onClick={onClose}>ยกเลิก</button>
          <FormSubmitButton loading={saving} onClick={handleSubmit}>
            {loan ? 'บันทึกการแก้ไข' : 'สร้างใบยืม'}
          </FormSubmitButton>
        </div>
    </Modal>
  );
};

// ── Main Page ─────────────────────────────────────────────────────────────────

const RobotLoans: React.FC = () => {
  const { user } = useAuth();
  const confirm = useConfirm();
  const { showToast } = useToast();
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useUrlSearch();
  useOpenFromUrl(loans, l => l.id, l => setSearch(l.docNumber));
  const [filterStatus, setFilterStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editLoan, setEditLoan] = useState<Loan | undefined>();
  const [printLoan, setPrintLoan] = useState<Loan | undefined>();
  const [statusAction, setStatusAction] = useState<{ loan: Loan; next: 'Approved' | 'Active' | 'Returned' | 'Cancelled' } | null>(null);
  const [returnItem, setReturnItem] = useState<{ loan: Loan; item: LoanItem } | null>(null);
  const [itemEvidence, setItemEvidence] = useState<{ loan: Loan; item: LoanItem } | null>(null);
  const [bulkReturn, setBulkReturn] = useState<{ loan: Loan; items: LoanItem[] } | null>(null);
  const [selectedReturnIds, setSelectedReturnIds] = useState<Record<string, Set<string>>>({}); // loanId -> Set of itemIds
  // ?open=<loanId> deep-links straight to one loan's evidence — the robot drawer's
  // "ดูหลักฐาน" link lands here, and an unexpanded row would hide the photos again.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set([new URLSearchParams(window.location.search).get('open') || ''].filter(Boolean)),
  );

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/loans');
      setLoans(res.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const uploadAttachment = async (elementType: string, elementId: string, file: File, attachmentType: string) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('elementType', elementType);
    fd.append('elementId', elementId);
    fd.append('attachmentType', attachmentType);
    await api.post('/attachments', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  };

  // Loan-wide paperwork (the signed handover form, a close-out photo covering the whole loan).
  const uploadLoanAttachment = (loanId: string, file: File, attachmentType: 'loan-handover' | 'loan-return') =>
    uploadAttachment('RobotLoan', loanId, file, attachmentType);

  // Per-robot return evidence hangs off the loan ITEM, so each machine carries its own proof
  // instead of a pile of look-alike files on the loan.
  const uploadItemReturnEvidence = (itemId: string, file: File) =>
    uploadAttachment('RobotLoanItem', itemId, file, 'loan-return');

  const filtered = useMemo(() => {
    return loans.filter(l => {
      if (filterStatus && l.status !== filterStatus) return false;
      if (dateFrom && l.loanDate < dateFrom) return false;
      if (dateTo && l.loanDate > dateTo) return false;
      const term = search.toLowerCase();
      if (!term) return true;
      return (
        l.docNumber.toLowerCase().includes(term) ||
        l.borrowerName.toLowerCase().includes(term) ||
        (l.borrowerDept || '').toLowerCase().includes(term)
      );
    });
  }, [loans, filterStatus, search, dateFrom, dateTo]);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  useEffect(() => { setPage(1); }, [filterStatus, search, dateFrom, dateTo]);
  const sort = useTableSort<Loan>({
    docNumber: l => l.docNumber,
    borrowerName: l => l.borrowerName,
    purpose: l => l.purpose,
    loanDate: l => l.loanDate,
    expectedReturn: l => l.expectedReturn,
    items: l => l.items.length,
    status: l => l.status,
  });
  const paginated = sort.apply(filtered).slice((page - 1) * pageSize, page * pageSize);

  // Stats
  const totalActive = loans.filter(l => l.status === 'Active').length;
  const totalOverdue = loans.filter(isOverdue).length;
  const totalPending = loans.filter(l => l.status === 'Pending').length;

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleStatusChange = async (notes?: string, file?: File) => {
    if (!statusAction) return;
    try {
      if (statusAction.next === 'Active') {
        if (!file) {
          showToast('ต้องแนบหลักฐานใบยืมก่อนเริ่มยืม', 'error');
          return;
        }
        await uploadLoanAttachment(statusAction.loan.id, file, 'loan-handover');
      }
      if (statusAction.next === 'Returned') {
        if (!file) {
          showToast('ต้องแนบหลักฐานรับคืนก่อนบันทึกคืน', 'error');
          return;
        }
        await uploadLoanAttachment(statusAction.loan.id, file, 'loan-return');
      }
      await api.patch(`/loans/${statusAction.loan.id}/status`, { status: statusAction.next, notes });
      setStatusAction(null);
      load();
    } catch (e: any) {
      showToast(e.response?.data?.error || 'เกิดข้อผิดพลาด', 'error');
    }
  };

  const handleReturnItem = async (condition: string, file?: File) => {
    if (!returnItem) return;
    try {
      if (!file) {
        showToast('ต้องแนบหลักฐานรับคืนก่อนบันทึกคืน', 'error');
        return;
      }
      await uploadItemReturnEvidence(returnItem.item.id, file);
      await api.patch(`/loans/${returnItem.loan.id}/items/${returnItem.item.id}/return`, { condition });
      setReturnItem(null);
      load();
    } catch (e: any) {
      showToast(e.response?.data?.error || 'เกิดข้อผิดพลาด', 'error');
    }
  };

  const handleBulkReturn = async (condition: string, file?: File) => {
    if (!bulkReturn) return;
    try {
      if (!file) {
        showToast('ต้องแนบหลักฐานรับคืนก่อนบันทึกคืน', 'error');
        return;
      }
      // ponytail: one photo covering N robots is stored once per item, so every row keeps its
      // own evidence. Bulk returns are a handful of machines; dedupe by hash if that changes.
      await Promise.all(bulkReturn.items.map(it => uploadItemReturnEvidence(it.id, file)));
      const results = await Promise.allSettled(
        bulkReturn.items.map(it =>
          api.patch(`/loans/${bulkReturn.loan.id}/items/${it.id}/return`, { condition })
        )
      );
      const failed = results.filter(r => r.status === 'rejected').length;
      const succeeded = bulkReturn.items.length - failed;
      setBulkReturn(null);
      setSelectedReturnIds(prev => ({ ...prev, [bulkReturn.loan.id]: new Set() }));
      load();
      if (failed > 0) {
        showToast(`คืนสำเร็จ ${succeeded} เครื่อง, ล้มเหลว ${failed} เครื่อง`, 'warning');
      } else {
        showToast(`คืน ${bulkReturn.items.length} เครื่องสำเร็จ`, 'success');
      }
    } catch (e: any) {
      showToast(e.response?.data?.error || 'เกิดข้อผิดพลาด', 'error');
    }
  };

  const handleDelete = async (loan: Loan) => {
    if (!await confirm(`ลบใบยืม ${loan.docNumber}?`, { title: 'ยืนยันการลบ', danger: true, confirmLabel: 'ลบ' })) return;
    await api.delete(`/loans/${loan.id}`);
    load();
  };

  const isAdmin = user?.role === 'ADMIN';

  return (
    <div className="page-container">
      <PageHeader
        title="ใบยืมหุ่นยนต์"
        subtitle="จัดการการยืม-คืนหุ่นยนต์"
        actions={(
          <button className="btn btn-primary" style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }} onClick={() => { setEditLoan(undefined); setShowForm(true); }}>
            <Plus size={18} /> สร้างใบยืม
          </button>
        )}
      />

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        {[
          { label: 'ใบยืมทั้งหมด', value: loans.length, color: 'var(--text)' },
          { label: 'รออนุมัติ', value: totalPending, color: 'var(--status-warning)' },
          { label: 'กำลังยืม', value: totalActive, color: 'var(--status-success)' },
          { label: 'เกินกำหนด', value: totalOverdue, color: 'var(--status-danger)' },
        ].map(s => (
          <div key={s.label} className="card" style={{ padding: '1rem' }}>
            <div style={{ fontSize: '1.8rem', fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: '1rem', padding: '0.75rem 1rem', display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input aria-label="ค้นหาเลขที่, ชื่อผู้ยืม, ชื่อบริษัท..."
            className="form-control"
            style={{ paddingLeft: '2rem', paddingRight: '2rem' }}
            placeholder="ค้นหาเลขที่, ชื่อผู้ยืม, ชื่อบริษัท..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {!search && <CameraScanButton variant="inline" onScan={setSearch} />}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {([['','ทุกสถานะ'], ...Object.entries(STATUS_LABEL)] as [string,string][]).map(([v,l]) => (
            <button key={v} type="button" onClick={() => setFilterStatus(v)} style={{ padding: '5px 12px', borderRadius: 999, fontSize: 12, fontWeight: filterStatus===v?700:500, border: `1.5px solid ${filterStatus===v?'var(--accent-primary)':'var(--border-color)'}`, background: filterStatus===v?'var(--accent-subtle)':'transparent', color: filterStatus===v?'var(--accent-primary)':'var(--text-secondary)', cursor: 'pointer', transition: 'all .15s' }}>{l}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>จาก</span>
          <ThaiDateInput aria-label="กรองตั้งแต่วันที่" className="form-control" style={{ fontSize: 13 }} value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>ถึง</span>
          <ThaiDateInput aria-label="กรองถึงวันที่" className="form-control" style={{ fontSize: 13 }} value={dateTo} onChange={e => setDateTo(e.target.value)} />
          {(dateFrom || dateTo) && (
            <button type="button" className="btn btn-outline" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => { setDateFrom(''); setDateTo(''); }}>ล้าง</button>
          )}
        </div>
        <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--text-muted)' }}>{filtered.length} รายการ</span>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>กำลังโหลด...</div>
      ) : filtered.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
          ไม่มีใบยืมที่ตรงกับเงื่อนไข
        </div>
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border)' }}>
                <th style={{ padding: '0.75rem', textAlign: 'left', width: 36 }}></th>
                <SortableTh {...sort.th('docNumber')} style={{ padding: '0.75rem', textAlign: 'left' }}>เลขที่</SortableTh>
                <SortableTh {...sort.th('borrowerName')} style={{ padding: '0.75rem', textAlign: 'left' }}>ผู้ยืม</SortableTh>
                <SortableTh {...sort.th('purpose')} style={{ padding: '0.75rem', textAlign: 'left' }}>วัตถุประสงค์</SortableTh>
                <SortableTh {...sort.th('loanDate')} style={{ padding: '0.75rem', textAlign: 'left' }}>วันยืม</SortableTh>
                <SortableTh {...sort.th('expectedReturn')} style={{ padding: '0.75rem', textAlign: 'left' }}>กำหนดคืน</SortableTh>
                <SortableTh {...sort.th('items')} style={{ padding: '0.75rem', textAlign: 'center' }}>จำนวน</SortableTh>
                <SortableTh {...sort.th('status')} style={{ padding: '0.75rem', textAlign: 'center' }}>สถานะ</SortableTh>
                <th style={{ padding: '0.75rem', textAlign: 'center' }}>การดำเนินการ</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map(loan => {
                const overdue = isOverdue(loan);
                const isExp = expanded.has(loan.id);
                return (
                  <React.Fragment key={loan.id}>
                    <tr style={{ borderBottom: '1px solid var(--border)', background: overdue ? 'rgba(239,68,68,0.04)' : undefined }}>
                      <td style={{ padding: '0.75rem' }}>
                        <button
                          type="button"
                          onClick={() => toggleExpand(loan.id)}
                          aria-expanded={isExp}
                          aria-controls={`loan-details-${loan.id}`}
                          aria-label={`${isExp ? 'ซ่อน' : 'แสดง'}รายละเอียด ${loan.docNumber}`}
                          title={`${isExp ? 'ซ่อน' : 'แสดง'}รายละเอียด`}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            cursor: 'pointer',
                            color: 'var(--text-secondary)',
                          }}
                        >
                          {isExp ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </button>
                      </td>
                      <td style={{ padding: '0.75rem', fontWeight: 600, fontVariantNumeric: 'tabular-nums', fontSize: '0.9rem' }}>{loan.docNumber}</td>
                      <td style={{ padding: '0.75rem' }}>
                        <div style={{ fontWeight: 500 }}>{loan.borrowerName}</div>
                        {loan.borrowerDept && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{loan.borrowerDept}</div>}
                      </td>
                      <td style={{ padding: '0.75rem', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={loan.purpose}>{loan.purpose}</td>
                      <td style={{ padding: '0.75rem', fontSize: '0.9rem' }}>{loan.loanDate}</td>
                      <td style={{ padding: '0.75rem', fontSize: '0.9rem', color: overdue ? 'var(--status-danger)' : undefined, fontWeight: overdue ? 600 : undefined }}>
                        {loan.expectedReturn}
                        {overdue && <div style={{ fontSize: '0.75rem' }}>เกินกำหนด!</div>}
                        {loan.actualReturn && <div style={{ fontSize: '0.75rem', color: 'var(--status-success)' }}>คืน: {loan.actualReturn}</div>}
                      </td>
                      <td style={{ padding: '0.75rem', textAlign: 'center' }}>{loan.items.length}</td>
                      <td style={{ padding: '0.75rem', textAlign: 'center' }}>
                        <span className={`badge ${STATUS_CLASS[loan.status]}`}>{STATUS_LABEL[loan.status]}</span>
                      </td>
                      <td style={{ padding: '0.75rem' }}>
                        <div className="responsive-table-actions" style={{ justifyContent: 'center', gap: '0.3rem' }}>
                          {/* Status transitions */}
                          {loan.status === 'Pending' && isAdmin && (
                            <button className="btn btn-primary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.78rem', display: 'flex', gap: '0.3rem', alignItems: 'center' }}
                              onClick={() => setStatusAction({ loan, next: 'Approved' })} title="อนุมัติ">
                              <CheckCircle size={14} /> อนุมัติ
                            </button>
                          )}
                          {loan.status === 'Approved' && (
                            <button className="btn btn-success" style={{ padding: '0.25rem 0.5rem', fontSize: '0.78rem', display: 'flex', gap: '0.3rem', alignItems: 'center' }}
                              onClick={() => setStatusAction({ loan, next: 'Active' })} title="เริ่มยืม">
                              <PlayCircle size={14} /> เริ่มยืม
                            </button>
                          )}
                          {loan.status === 'Active' && (
                            <button className="btn btn-primary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.78rem', display: 'flex', gap: '0.3rem', alignItems: 'center' }}
                              onClick={() => setStatusAction({ loan, next: 'Returned' })} title="บันทึกคืน">
                              <RotateCcw size={14} /> บันทึกคืน
                            </button>
                          )}
                          {(loan.status === 'Pending' || loan.status === 'Approved') && (
                            <button className="btn btn-danger" style={{ padding: '0.25rem 0.5rem', fontSize: '0.78rem', display: 'flex', gap: '0.3rem', alignItems: 'center' }}
                              onClick={() => setStatusAction({ loan, next: 'Cancelled' })} title="ยกเลิก">
                              <XCircle size={14} /> ยกเลิก
                            </button>
                          )}
                          {/* Print */}
                          <button className="btn btn-outline" style={{ padding: '0.25rem 0.5rem', fontSize: '0.78rem' }}
                            onClick={() => setPrintLoan(loan)} title="พิมพ์ใบยืม" aria-label={`พิมพ์ใบยืม ${loan.docNumber}`}>
                            <Printer size={14} />
                          </button>
                          {/* Edit — only if not returned/cancelled */}
                          {loan.status !== 'Returned' && loan.status !== 'Cancelled' && (
                            <button className="btn btn-outline" style={{ padding: '0.25rem 0.5rem', fontSize: '0.78rem' }}
                              onClick={() => { setEditLoan(loan); setShowForm(true); }}>
                              แก้ไข
                            </button>
                          )}
                          {/* Delete — admin only */}
                          {isAdmin && (
                            <button className="btn btn-danger" style={{ padding: '0.25rem 0.5rem', fontSize: '0.78rem' }}
                              onClick={() => handleDelete(loan)}>
                              ลบ
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {/* Expanded items */}
                    {isExp && (() => {
                      const pendingItems = loan.items.filter(it => !it.returnedAt);
                      const sel = selectedReturnIds[loan.id] || new Set<string>();
                      const toggleSel = (id: string) => {
                        const next = new Set(sel);
                        if (next.has(id)) next.delete(id);
                        else next.add(id);
                        setSelectedReturnIds(prev => ({ ...prev, [loan.id]: next }));
                      };
                      const allChecked = pendingItems.length > 0 && pendingItems.every(it => sel.has(it.id));
                      const toggleAll = () => {
                        if (allChecked) setSelectedReturnIds(prev => ({ ...prev, [loan.id]: new Set() }));
                        else setSelectedReturnIds(prev => ({ ...prev, [loan.id]: new Set(pendingItems.map(it => it.id)) }));
                      };
                      return (
                      <tr style={{ background: 'var(--bg-secondary)' }}>
                        <td colSpan={9} style={{ padding: '0 1rem 0.75rem 2.5rem' }}>
                          <div id={`loan-details-${loan.id}`}>
                          {loan.status === 'Active' && sel.size > 0 && (
                            <div className="responsive-action-group" style={{ marginBottom: '0.5rem', padding: '0.4rem 0.5rem', background: 'var(--accent-subtle)', borderRadius: 6 }}>
                              <span style={{ fontSize: '0.85rem', color: 'var(--accent-primary)', fontWeight: 600 }}>เลือก {sel.size} เครื่อง</span>
                              <button
                                className="btn btn-primary"
                                style={{ padding: '0.25rem 0.75rem', fontSize: '0.78rem', display: 'flex', gap: '0.3rem', alignItems: 'center', marginLeft: 'auto' }}
                                onClick={() => {
                                  const selectedItems = loan.items.filter(it => sel.has(it.id));
                                  setBulkReturn({ loan, items: selectedItems });
                                }}
                              >
                                <CornerDownLeft size={12} /> คืนที่เลือก ({sel.size})
                              </button>
                            </div>
                          )}
                          <table style={{ fontSize: '0.85rem' }}>
                            <thead>
                              <tr>
                                {loan.status === 'Active' && (
                                  <th style={{ padding: '0.4rem', borderBottom: '1px solid var(--border)', width: 32 }}>
                                    {pendingItems.length > 0 && (
                                      <input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label={`เลือกหุ่นยนต์ทั้งหมดใน ${loan.docNumber}`} style={{ accentColor: 'var(--accent-primary)', cursor: 'pointer' }} />
                                    )}
                                  </th>
                                )}
                                <th style={{ padding: '0.4rem', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>SN</th>
                                <th style={{ padding: '0.4rem', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>รุ่น</th>
                                <th style={{ padding: '0.4rem', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>สถานะการคืน</th>
                                <th style={{ padding: '0.4rem', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>สภาพ</th>
                                <th style={{ padding: '0.4rem', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>หลักฐาน</th>
                                {loan.status === 'Active' && <th style={{ padding: '0.4rem', borderBottom: '1px solid var(--border)' }}></th>}
                              </tr>
                            </thead>
                            <tbody>
                              {loan.items.map(it => (
                                <tr key={it.id}>
                                  {loan.status === 'Active' && (
                                    <td style={{ padding: '0.35rem 0.4rem' }}>
                                      {!it.returnedAt && (
                                        <input type="checkbox" checked={sel.has(it.id)} onChange={() => toggleSel(it.id)} aria-label={`เลือก ${it.serialNumber} เพื่อคืน`} style={{ accentColor: 'var(--accent-primary)', cursor: 'pointer' }} />
                                      )}
                                    </td>
                                  )}
                                  <td style={{ padding: '0.35rem 0.4rem', fontVariantNumeric: 'tabular-nums' }}>{it.serialNumber}</td>
                                  <td style={{ padding: '0.35rem 0.4rem' }}>{it.modelName}</td>
                                  <td style={{ padding: '0.35rem 0.4rem' }}>
                                    {it.returnedAt
                                      ? <span className="badge success" style={{ fontSize: '0.75rem' }}>คืนแล้ว ({it.returnedAt})</span>
                                      : <span className="badge warning" style={{ fontSize: '0.75rem' }}>ยังไม่คืน</span>
                                    }
                                  </td>
                                  <td style={{ padding: '0.35rem 0.4rem' }}>{it.condition ? (CONDITION_LABEL[it.condition] ?? it.condition) : '-'}</td>
                                  <td style={{ padding: '0.35rem 0.4rem' }}>
                                    <button
                                      className="btn btn-outline"
                                      style={{ padding: '0.15rem 0.45rem', fontSize: '0.72rem', display: 'inline-flex', gap: '0.25rem', alignItems: 'center' }}
                                      onClick={() => setItemEvidence({ loan, item: it })}
                                      title={`รูปหลักฐานการคืนของ ${it.serialNumber}`}
                                    >
                                      <Paperclip size={11} /> ดูรูป
                                    </button>
                                  </td>
                                  {loan.status === 'Active' && (
                                    <td style={{ padding: '0.35rem 0.4rem' }}>
                                      {!it.returnedAt && (
                                        <button
                                          className="btn btn-outline"
                                          style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', display: 'flex', gap: '0.3rem', alignItems: 'center' }}
                                          onClick={() => setReturnItem({ loan, item: it })}
                                          title="คืนเครื่องนี้"
                                        >
                                          <CornerDownLeft size={12} /> คืน
                                        </button>
                                      )}
                                    </td>
                                  )}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {loan.notes && (
                            <div style={{ marginTop: '0.5rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                              <b>หมายเหตุ:</b> {loan.notes}
                            </div>
                          )}
                          {loan.approvedBy && (
                            <div style={{ marginTop: '0.3rem', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                              อนุมัติโดย: {loan.approvedBy} เมื่อ {loan.approvedAt}
                            </div>
                          )}
                          <div style={{ marginTop: '0.75rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.4rem' }}>
                              <Paperclip size={14} />
                              หลักฐานเอกสาร
                            </div>
                            <AttachmentPanel elementType="RobotLoan" elementId={loan.id} />
                          </div>
                          </div>
                        </td>
                      </tr>
                      );
                    })()}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
          <Pagination page={page} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
        </div>
      )}

      {/* Modals */}
      {showForm && (
        <LoanForm
          loan={editLoan}
          onClose={() => setShowForm(false)}
          onSave={() => { setShowForm(false); load(); }}
        />
      )}
      {printLoan && <PrintView loan={printLoan} onClose={() => setPrintLoan(undefined)} />}
      {statusAction && (
        <StatusModal
          loan={statusAction.loan}
          nextStatus={statusAction.next}
          onConfirm={handleStatusChange}
          onClose={() => setStatusAction(null)}
        />
      )}
      {returnItem && (
        <ReturnItemModal
          item={returnItem.item}
          onConfirm={handleReturnItem}
          onClose={() => setReturnItem(null)}
        />
      )}
      {bulkReturn && (
        <BulkReturnModal
          items={bulkReturn.items}
          onConfirm={handleBulkReturn}
          onClose={() => setBulkReturn(null)}
        />
      )}

      <Modal
        open={!!itemEvidence}
        onClose={() => setItemEvidence(null)}
        title={<>หลักฐานการคืน — {itemEvidence?.item.serialNumber}</>}
        width={560}
        describedById="robot-loan-item-evidence-description"
      >
        <p id="robot-loan-item-evidence-description" style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 0, marginBottom: '1rem' }}>
          {itemEvidence?.item.modelName} · ใบยืม {itemEvidence?.loan.docNumber}
          {itemEvidence?.item.returnedAt ? ` · คืนเมื่อ ${itemEvidence.item.returnedAt}` : ' · ยังไม่คืน'}
        </p>
        {itemEvidence && <AttachmentPanel elementType="RobotLoanItem" elementId={itemEvidence.item.id} />}
      </Modal>
    </div>
  );
};

export default RobotLoans;
