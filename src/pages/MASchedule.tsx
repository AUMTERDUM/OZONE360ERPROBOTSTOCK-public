import React, { useEffect, useMemo, useState, useCallback } from 'react';
import RobotMascot from '../components/RobotMascot';
import ModelAvatar from '../components/ModelAvatar';
import { todayISO } from '../utils/thaiDate';
import api from '../api';
import { usePolling } from '../lib/usePolling';
import { useData, useSpareParts } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../context/ConfirmContext';
import { Modal } from '../components/UIUtils';
import { ThaiDateInput } from '../components/ThaiDateInput';
import CameraScanButton from '../components/CameraScanButton';
import { normalizeScan } from '../utils/scan';
import AttachmentPanel from '../components/AttachmentPanel';
import { printPDF, logoSVG, escapeHtml as esc } from '../utils/printPDF';
import PageHeader from '../components/PageHeader';
import { downloadMaChecklistPdf } from '../utils/maChecklistPdf';
import {
  MA_CATEGORIES, MA_CATEGORY_LABELS, MA_RESULT_LABELS, maChecklistFor, resolveMaCategory, partFitsModel,
  type MaCategory, type MaItemResult,
} from '../utils/maChecklistFields';
import {
  CalendarDays, Plus, AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight,
  ClipboardCheck, QrCode, Trash2, RefreshCw, ListChecks, Upload, FileSpreadsheet, Loader, Printer, Eraser, Download,
  History, Search, Eye,
} from 'lucide-react';

interface MAVisit {
  id: string;
  planId: string;
  visitNumber: number;
  scheduledDate: string;
  status: 'Scheduled' | 'Done' | 'Skipped';
  completedAt?: string | null;
  technician?: string | null;
  summary?: string | null;
  reportJson?: string | null;
  plan?: { customer?: { id: string; name: string }; notes?: string | null; robotIds?: string[] };
}

interface MAPlan {
  id: string;
  customerId: string;
  startDate: string;
  endDate: string | null;
  intervalMonths: number;
  notes: string | null;
  active: boolean;
  visits: MAVisit[];
  /** Robots covered by this plan; empty means every robot of the customer. */
  robotIds?: string[];
}

interface RobotCheck {
  serialNumber: string;
  condition: 'OK' | 'Issue' | 'Repaired';
  notes: string;
  /** Checklist template used for this robot; saved so old reports keep their items. */
  category?: MaCategory;
  model?: string;
  /** Per-item results keyed by item id from maChecklistFields; label is stored so tickets/reports read well. */
  items?: Record<string, { result?: MaItemResult; note?: string; label?: string }>;
  /** Spare parts fitted during the visit; deducted from stock when the visit is saved as Done. */
  parts?: { sparePartId: string; quantity: number }[];
  /** Ticket the server opened for this robot's findings (set once the visit is Done). */
  ticketId?: string;
}

const fmt = (iso: string) =>
  new Date(iso + 'T00:00:00').toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
const daysUntil = (iso: string) =>
  Math.ceil((new Date(iso + 'T00:00:00').getTime() - new Date(todayISO() + 'T00:00:00').getTime()) / 86400000);
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const statusColor: Record<string, string> = { Scheduled: 'var(--status-info)', Done: '#22c55e', Skipped: '#9ca3af' };
const statusLabel: Record<string, string> = { Scheduled: 'รอเข้าเช็ค', Done: 'เช็คแล้ว', Skipped: 'ข้าม' };

function maDueLabel(days: number) {
  if (days < 0) return `เลย ${Math.abs(days)} วัน`;
  if (days === 0) return 'วันนี้';
  return `อีก ${days} วัน`;
}

function getPlanLastVisitDate(plan: MAPlan) {
  if (!plan.visits.length) return null;
  return [...plan.visits]
    .map(visit => visit.scheduledDate)
    .sort((a, b) => a.localeCompare(b))
    .at(-1) ?? null;
}

const Calendar: React.FC<{ visits: MAVisit[]; onClickVisit: (v: MAVisit) => void }> = ({ visits, onClickVisit }) => {
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [dayList, setDayList] = useState<string | null>(null);
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const first = new Date(year, month, 1);
  const startWeekday = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const visitsByDate = useMemo(() => {
    const m = new Map<string, MAVisit[]>();
    visits.forEach(v => {
      if (!m.has(v.scheduledDate)) m.set(v.scheduledDate, []);
      m.get(v.scheduledDate)!.push(v);
    });
    return m;
  }, [visits]);

  const cells: (Date | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);

  const today = todayISO();
  const dayLabels = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <button className="btn btn-outline" onClick={() => setCursor(new Date(year, month - 1, 1))}><ChevronLeft size={16} /></button>
        <div style={{ fontWeight: 600, fontSize: '1.05rem' }}>
          {first.toLocaleDateString('th-TH', { year: 'numeric', month: 'long' })}
        </div>
        <button className="btn btn-outline" onClick={() => setCursor(new Date(year, month + 1, 1))}><ChevronRight size={16} /></button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 4 }}>
        {dayLabels.map(l => (
          <div key={l} style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-muted)', padding: '4px 0' }}>{l}</div>
        ))}
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const iso = ymd(d);
          const dayVisits = visitsByDate.get(iso) || [];
          const isToday = iso === today;
          return (
            <div
              key={i}
              style={{
                minHeight: 78, padding: 4, border: '1px solid var(--border-color)', borderRadius: 6,
                background: isToday ? 'rgba(59,130,246,0.08)' : 'transparent',
                display: 'flex', flexDirection: 'column', gap: 2,
              }}
            >
              <div style={{ fontSize: '0.75rem', fontWeight: isToday ? 700 : 500, color: isToday ? 'var(--status-info)' : 'var(--text)' }}>
                {d.getDate()}
              </div>
      {dayVisits.slice(0, 3).map(v => (
                <button
                  key={v.id}
                  onClick={() => onClickVisit(v)}
                  title={`ถึงวัน MA: ${v.plan?.customer?.name ?? ''} · รอบที่ ${v.visitNumber}`}
                  style={{
                    fontSize: '0.7rem', padding: '2px 4px', borderRadius: 4, border: 'none',
                    background: statusColor[v.status], color: 'var(--text-on-accent)', cursor: 'pointer',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left',
                  }}
                >
                  {`ถึงวัน ${v.plan?.customer?.name ?? '—'}`}
                </button>
              ))}
              {dayVisits.length > 3 && (
                <button type="button" onClick={() => setDayList(iso)} title={`ดูทั้งหมด ${dayVisits.length} นัด`}
                  style={{ fontSize: '0.68rem', padding: '2px 4px', border: 'none', background: 'none', color: 'var(--accent-primary)', fontWeight: 700, cursor: 'pointer', textAlign: 'left' }}>
                  +{dayVisits.length - 3} เพิ่มเติม
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: '1rem', marginTop: '0.75rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
        {Object.entries(statusLabel).map(([k, label]) => (
          <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 10, height: 10, background: statusColor[k], borderRadius: 2 }} /> {label}
          </span>
        ))}
      </div>
      {dayList && (
        <div style={{ marginTop: '0.75rem', border: '1px solid var(--border-color)', borderRadius: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', borderBottom: '1px solid var(--border-color)', fontSize: '0.8rem', fontWeight: 700 }}>
            นัด MA วันที่ {fmt(dayList)} ({(visitsByDate.get(dayList) || []).length})
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDayList(null)}>ปิด</button>
          </div>
          {(visitsByDate.get(dayList) || []).map(v => (
            <button key={v.id} type="button" onClick={() => onClickVisit(v)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 10px', minHeight: 40, border: 'none', borderBottom: '1px solid var(--border-color)', background: 'transparent', color: 'inherit', font: 'inherit', fontSize: '0.82rem', cursor: 'pointer', textAlign: 'left' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor[v.status], flexShrink: 0 }} />
              {v.plan?.customer?.name ?? '—'} · รอบที่ {v.visitNumber}
              <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: '0.75rem' }}>{statusLabel[v.status]}</span>
            </button>
          ))}
        </div>
      )}
      {visits.length > 0 && Array.from(visitsByDate.keys()).filter(d => d.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`)).length === 0 && (
        <div style={{ textAlign: 'center', padding: '0.75rem', marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--text-muted)', background: 'rgba(59,130,246,0.06)', borderRadius: 8 }}>
          เดือนนี้ไม่มีรอบ MA — ลองเลื่อนไปเดือนที่มีรอบ หรือดูแท็บ "รายการ Plan" เพื่อดู {visits.length} นัดหมายทั้งหมด
        </div>
      )}
    </div>
  );
};

type PickerPart = { id: string; name: string; sku: string; stock: number };

/** Search-as-you-type spare part picker; parts that fit the robot's model are listed first. */
const PartPicker: React.FC<{ value: string; fit: PickerPart[]; other: PickerPart[]; modelName: string; onChange: (id: string) => void }> = ({ value, fit, other, modelName, onChange }) => {
  const [query, setQuery] = useState('');
  const selected = value ? fit.find(p => p.id === value) ?? other.find(p => p.id === value) : undefined;
  if (selected) {
    return (
      <div style={{ flex: '1 1 220px', minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', border: '1px solid var(--border-color)', borderRadius: 8 }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected.name} <span style={{ color: 'var(--text-muted)' }}>({selected.sku}) · คงเหลือ {selected.stock}</span></span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange('')}>เปลี่ยน</button>
      </div>
    );
  }
  const q = query.trim().toLowerCase();
  const match = (p: PickerPart) => !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q);
  const fitHits = fit.filter(match);
  const otherHits = q ? other.filter(match).slice(0, Math.max(0, 15 - fitHits.length)) : [];
  const row = (p: PickerPart) => (
    <button key={p.id} type="button" onClick={() => { onChange(p.id); setQuery(''); }}
      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', minHeight: 40, border: 'none', borderBottom: '1px solid var(--border-color)', background: 'transparent', color: 'inherit', font: 'inherit', fontSize: '0.8rem', cursor: 'pointer' }}>
      {p.name} <span style={{ color: 'var(--text-muted)' }}>({p.sku}) · คงเหลือ {p.stock}</span>
    </button>
  );
  return (
    <div style={{ flex: '1 1 220px', minWidth: 0 }}>
      <input aria-label="ค้นหาอะไหล่ (ชื่อหรือ SKU)" className="form-control" placeholder="ค้นหาอะไหล่ ชื่อหรือ SKU..." value={query} onChange={e => setQuery(e.target.value)} />
      <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--border-color)', borderTop: 'none', borderRadius: '0 0 8px 8px' }}>
        {fitHits.length > 0 && <div style={{ padding: '4px 10px', fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)' }}>แนะนำสำหรับ {modelName}</div>}
        {fitHits.slice(0, 15).map(row)}
        {otherHits.length > 0 && <div style={{ padding: '4px 10px', fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)' }}>อะไหล่อื่น ๆ</div>}
        {otherHits.map(row)}
        {!fitHits.length && !otherHits.length && (
          <div style={{ padding: '8px 10px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>{q ? 'ไม่พบอะไหล่ที่ค้นหา' : 'พิมพ์ชื่อหรือ SKU เพื่อค้นหา'}</div>
        )}
      </div>
    </div>
  );
};

const VisitModal: React.FC<{ visit: MAVisit; onClose: () => void; onSaved: () => void }> = ({ visit, onClose, onSaved }) => {
  const { robots, models } = useData();
  const confirm = useConfirm();
  const spareParts = useSpareParts();
  const partById = useMemo(() => new Map(spareParts.map(p => [p.id, p])), [spareParts]);
  const { showToast } = useToast();
  const initialReport = (() => {
    try {
      const parsed = visit.reportJson ? JSON.parse(visit.reportJson) : [];
      return Array.isArray(parsed) ? { checks: parsed } : { checks: parsed.checks ?? [], signatureUrl: parsed.signatureUrl ?? '', signerName: parsed.signerName ?? '' };
    } catch { return { checks: [] as RobotCheck[], signatureUrl: '', signerName: '' }; }
  })();
  const [checks, setChecks] = useState<RobotCheck[]>(initialReport.checks);
  const [snInput, setSnInput] = useState('');
  const [technician, setTechnician] = useState(visit.technician ?? '');
  const [summary, setSummary] = useState(visit.summary ?? '');
  const [status, setStatus] = useState<MAVisit['status']>(visit.status);
  const [saving, setSaving] = useState(false);
  const [signerName, setSignerName] = useState(initialReport.signerName);
  const [signatureUrl, setSignatureUrl] = useState(initialReport.signatureUrl);
  const initialSnapshot = React.useRef(JSON.stringify([initialReport.checks, visit.technician ?? '', visit.summary ?? '', visit.status, initialReport.signerName]));
  const isDirty = () => signatureDirtyRef.current
    || JSON.stringify([checks, technician, summary, status, signerName]) !== initialSnapshot.current;
  const [done, setDone] = useState<{ robots: number; tickets: number } | null>(null);
  useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(onClose, 4000);
    return () => window.clearTimeout(t);
  }, [done, onClose]);
  const requestClose = async () => {
    if (done) { onClose(); return; }
    if (saving) return;
    if (isDirty() && !await confirm('มีข้อมูลที่ยังไม่ได้บันทึก ต้องการปิดและทิ้งการแก้ไขหรือไม่?', { title: 'ยังไม่ได้บันทึก', danger: true, confirmLabel: 'ทิ้งการแก้ไข' })) return;
    onClose();
  };
  const [, setUploadingSignature] = useState(false);
  const signatureRef = React.useRef<HTMLCanvasElement>(null);
  const drawingRef = React.useRef(false);
  const signatureDirtyRef = React.useRef(false);

  const clearSignature = () => {
    const canvas = signatureRef.current;
    if (canvas) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    signatureDirtyRef.current = false;
    setSignatureUrl(''); // saving after a clear removes the stored signature too
  };
  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = signatureRef.current; if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const x = (e.clientX - r.left) * canvas.width / r.width, y = (e.clientY - r.top) * canvas.height / r.height;
    if (e.type === 'pointerdown') { drawingRef.current = true; signatureDirtyRef.current = true; ctx.beginPath(); ctx.moveTo(x, y); canvas.setPointerCapture(e.pointerId); }
    else if (drawingRef.current) { ctx.lineTo(x, y); ctx.stroke(); }
    if (e.type === 'pointerup' || e.type === 'pointercancel') drawingRef.current = false;
  };

  const uploadSignature = async (): Promise<string> => {
    const canvas = signatureRef.current;
    if (!canvas || !signerName.trim() || !signatureDirtyRef.current) return signatureUrl;
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return signatureUrl;
    const fd = new FormData(); fd.append('file', blob, `ma-signature-${visit.visitNumber}.png`); fd.append('elementType', 'MaintenanceVisit'); fd.append('elementId', visit.id); fd.append('attachmentType', 'signature');
    setUploadingSignature(true);
    try { const r = await api.post('/attachments', fd, { headers: { 'Content-Type': 'multipart/form-data' } }); signatureDirtyRef.current = false; return r.data.url; }
    finally { setUploadingSignature(false); }
  };

  const printReport = async () => {
    const attachments = (await api.get(`/attachments/MaintenanceVisit/${visit.id}`)).data as { url: string; originalName: string; mimeType?: string; attachmentType?: string }[];
    const photos = await Promise.all(attachments.filter(a => a.mimeType?.startsWith('image/') && a.attachmentType !== 'signature').slice(0, 12).map(async a => {
      const blob = (await api.get(a.url.replace(/^\/api(?=\/)/, ''), { responseType: 'blob' })).data as Blob;
      return URL.createObjectURL(blob);
    }));
    const rows = checks.map(c => {
      const head = `<tr><td>${esc(c.serialNumber)}${checkModelName(c) ? `<br/><small>${esc(checkModelName(c))}</small>` : ''}</td><td>${esc(c.condition)}</td><td>${esc(c.notes || '-')}</td></tr>`;
      if (!c.items || !Object.keys(c.items).length) return head;
      const itemRows = maChecklistFor(checkCategory(c), checkModelName(c)).flatMap(sec => sec.items).map(it => {
        const r = c.items?.[it.id];
        const color = r?.result === 'Issue' ? '#b91c1c' : r?.result === 'Repaired' ? '#b45309' : '#111';
        return `<tr><td style="padding-left:16px">- ${esc(it.label)}</td><td style="color:${color}">${r?.result ? esc(MA_RESULT_LABELS[r.result]) : '-'}</td><td>${esc(r?.note || '')}</td></tr>`;
      }).join('');
      const partRows = (c.parts ?? []).filter(p => p.sparePartId).map(p => {
        const part = partById.get(p.sparePartId);
        return `<tr><td style="padding-left:16px">- อะไหล่: ${esc(part ? `${part.name} (${part.sku})` : p.sparePartId)}</td><td>x${p.quantity}</td><td></td></tr>`;
      }).join('');
      return `${head}<tr><td colspan="3" style="background:#f3f4f6;font-size:11px">เช็คลิสต์: ${esc(MA_CATEGORY_LABELS[checkCategory(c)])}</td></tr>${itemRows}${partRows}`;
    }).join('');
    printPDF(`${logoSVG}<div class="doc-header"><div class="doc-title-block"><div class="doc-type">รายงานการเข้าบำรุงรักษา</div><div class="doc-meta">รอบที่ ${visit.visitNumber} · ${fmt(visit.scheduledDate)}</div></div></div><div class="info-grid"><div class="info-box"><h3>ลูกค้า / สถานที่</h3><p>${esc(visit.plan?.customer?.name ?? '-')}<br/>${esc(visit.plan?.notes ?? '')}</p></div><div class="info-box"><h3>ผู้เข้าตรวจ</h3><p>${esc(technician || '-')}<br/>สถานะ: ${esc(statusLabel[status] ?? status)}</p></div></div><table><thead><tr><th>หุ่นยนต์ / SN</th><th>สภาพ</th><th>หมายเหตุ</th></tr></thead><tbody>${rows || '<tr><td colspan="3">ไม่มีรายการ</td></tr>'}</tbody></table><div class="summary-box"><h3>สรุปผล</h3><p>${esc(summary || '-')}</p></div>${photos.length ? `<h3>ภาพประกอบ</h3><div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">${photos.map(src => `<img src="${src}" style="width:48%;max-height:80mm;object-fit:contain"/>`).join('')}</div>` : ''}${signatureUrl ? `<div class="sig-row"><div class="sig-box"><img src="${esc(signatureUrl)}" style="height:48px;max-width:220px;object-fit:contain"/><div class="sig-label">ผู้รับรอง: ${esc(signerName || '-')}</div></div><div class="sig-box"><div class="sig-line"></div><div class="sig-label">ผู้เข้าตรวจ: ${esc(technician || '-')}</div></div></div>` : ''}`, `MA-${visit.visitNumber}`);
  };

  const robotsBySN = useMemo(() => {
    const m = new Map<string, typeof robots[number]>();
    robots.forEach(r => m.set(r.serialNumber.toUpperCase(), r));
    return m;
  }, [robots]);

  const modelNameById = useMemo(() => new Map(models.map(m => [m.id, m.name])), [models]);
  const modelById = useMemo(() => new Map(models.map(m => [m.id, m])), [models]);
  const robotModel = (sn: string) => {
    const robot = robotsBySN.get(sn.toUpperCase());
    return robot ? modelById.get(robot.modelId) : undefined;
  };
  const robotModelName = (sn: string) => robotModel(sn)?.name ?? '';
  const checkCategory = (c: RobotCheck) => c.category ?? resolveMaCategory(robotModel(c.serialNumber));
  const checkModelName = (c: RobotCheck) => robotModelName(c.serialNumber) || c.model || '';
  const [openChecklist, setOpenChecklist] = useState<number | null>(null);

  // The robots this plan covers: the ones picked on the plan, or all of the customer's robots when none were picked.
  const planRobotIds = visit.plan?.robotIds;
  const planCustomerId = visit.plan?.customer?.id;
  const planRobots = useMemo(() => {
    const list = planRobotIds?.length
      ? robots.filter(r => planRobotIds.includes(r.id))
      : robots.filter(r => r.customerId === planCustomerId && !r.archivedAt);
    return [...list].sort((a, b) => a.serialNumber.localeCompare(b.serialNumber));
  }, [robots, planRobotIds, planCustomerId]);

  const addRobots = (list: typeof robots) => {
    setChecks(prev => {
      const have = new Set(prev.map(c => c.serialNumber.toUpperCase()));
      const added = list
        .filter(r => !have.has(r.serialNumber.toUpperCase()))
        .map(r => ({ serialNumber: r.serialNumber.toUpperCase(), condition: 'OK' as const, notes: '' }));
      return [...prev, ...added];
    });
  };

  const addSN = (rawInput: string) => {
    // A handheld scanner types the sticker's URL; keep just the serial number.
    const sn = normalizeScan(rawInput).toUpperCase();
    if (!sn) return;
    if (checks.some(c => c.serialNumber.toUpperCase() === sn)) {
      showToast(`SN ${sn} มีอยู่แล้ว`, 'info');
      return;
    }
    if (!robotsBySN.has(sn)) {
      showToast(`ไม่พบหุ่นยนต์ SN ${sn} ในระบบ`, 'warning');
    }
    setChecks(prev => [...prev, { serialNumber: sn, condition: 'OK', notes: '' }]);
    setSnInput('');
  };

  const updateCheck = (idx: number, patch: Partial<RobotCheck>) =>
    setChecks(prev => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  const removeCheck = async (idx: number) => {
    const c = checks[idx];
    const hasWork = !!c && (Object.values(c.items ?? {}).some(r => r.result || r.note) || (c.parts?.length ?? 0) > 0 || !!c.notes.trim());
    if (hasWork && !await confirm(`ลบ ${c.serialNumber} ออกจากรายการตรวจ? ผลเช็คลิสต์ หมายเหตุ และอะไหล่ของเครื่องนี้จะหายไป`, { title: 'ยืนยันการลบ', danger: true, confirmLabel: 'ลบ' })) return;
    setChecks(prev => prev.filter((_, i) => i !== idx));
    setOpenChecklist(null);
  };
  const updateItem = (idx: number, itemId: string, patch: { result?: MaItemResult; note?: string }) =>
    setChecks(prev => prev.map((c, i) => {
      if (i !== idx) return c;
      const current = c.items?.[itemId] ?? {};
      const items = { ...c.items, [itemId]: { ...current, ...patch } };
      // A failing item flags the robot (unless already marked repaired); clearing the last
      // failing item puts it back to OK.
      const anyIssue = Object.values(items).some(r => r.result === 'Issue');
      let condition = c.condition;
      if (anyIssue && condition === 'OK') condition = 'Issue';
      else if (!anyIssue && condition === 'Issue' && current.result === 'Issue' && patch.result) condition = 'OK';
      return { ...c, items, condition };
    }));
  const markAllOk = (idx: number) =>
    setChecks(prev => prev.map((c, i) => {
      if (i !== idx) return c;
      const items = { ...c.items };
      maChecklistFor(checkCategory(c), checkModelName(c)).forEach(sec => sec.items.forEach(it => {
        if (!items[it.id]?.result) items[it.id] = { ...items[it.id], result: 'OK' };
      }));
      return { ...c, items };
    }));

  const updatePart = (idx: number, partIdx: number, patch: Partial<{ sparePartId: string; quantity: number }>) =>
    setChecks(prev => prev.map((c, i) => i !== idx ? c : { ...c, parts: (c.parts ?? []).map((p, j) => (j === partIdx ? { ...p, ...patch } : p)) }));
  const addPart = (idx: number) =>
    setChecks(prev => prev.map((c, i) => i !== idx ? c : { ...c, parts: [...(c.parts ?? []), { sparePartId: '', quantity: 1 }] }));
  const removePart = (idx: number, partIdx: number) =>
    setChecks(prev => prev.map((c, i) => i !== idx ? c : { ...c, parts: (c.parts ?? []).filter((_, j) => j !== partIdx) }));
  const sortedParts = useMemo(() => [...spareParts].sort((a, b) => a.name.localeCompare(b.name)), [spareParts]);
  // Parts whose catalog model list names this robot come first, so the right one is easy to find.
  const partOptions = (modelName: string) => {
    const fit = modelName ? sortedParts.filter(p => partFitsModel(p.productModel, modelName)) : [];
    const fitIds = new Set(fit.map(p => p.id));
    return { fit, other: sortedParts.filter(p => !fitIds.has(p.id)) };
  };

  // Pins the category/model used, and drops answers left over from another category's items.
  const toSavedCheck = (c: RobotCheck): RobotCheck => {
    const category = checkCategory(c);
    const model = checkModelName(c) || undefined;
    const parts = c.parts?.filter(p => p.sparePartId && p.quantity > 0);
    if (!c.items) return { ...c, category, model, parts };
    const labels = new Map(maChecklistFor(category, model).flatMap(sec => sec.items.map(it => [it.id, it.label] as const)));
    const items = Object.fromEntries(Object.entries(c.items)
      .filter(([id, r]) => labels.has(id) && (r.result || r.note))
      .map(([id, r]) => [id, { ...r, label: labels.get(id) }]));
    return { ...c, category, model, items, parts };
  };

  const save = async () => {
    setSaving(true);
    try {
      const uploadedSignature = await uploadSignature();
      setSignatureUrl(uploadedSignature);
      const res = await api.patch(`/ma-visits/${visit.id}`, { status, technician, summary, report: { version: 2, checks: checks.map(toSavedCheck), signatureUrl: uploadedSignature, signerName: signerName.trim() } });
      const ticketsCreated = Number(res.data?.ticketsCreated) || 0;
      onSaved();
      if (status === 'Done') {
        // A finished visit gets a short "done" screen that says what the system did next.
        setDone({ robots: checks.length, tickets: ticketsCreated });
      } else {
        showToast('บันทึกเรียบร้อย', 'success');
        onClose();
      }
    } catch (e: any) {
      showToast(e?.response?.data?.error || 'บันทึกไม่สำเร็จ', 'error');
    } finally { setSaving(false); }
  };

  return (
    <Modal open={true} onClose={() => void requestClose()} preventClose={saving} width={760} describedById="ma-visit-report-description" title={
      <span><ClipboardCheck size={20} style={{ verticalAlign: 'middle', marginRight: 6 }} /> รายงานการเช็ค — รอบที่ {visit.visitNumber}</span>
    }>
      {done ? (
        <div role="status" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 6, padding: '1rem 0' }}>
          <RobotMascot scene="maDone" size={170} />
          <div style={{ fontSize: '1.15rem', fontWeight: 700 }}>บันทึกการเข้า MA เรียบร้อย</div>
          <div className="text-muted" style={{ fontSize: '0.9rem' }}>
            ตรวจ {done.robots} เครื่อง{done.tickets > 0 ? ` · เปิด Ticket ซ่อม ${done.tickets} ใบจากผลตรวจให้แล้ว` : ' · ไม่มีงานซ่อมต่อ'}
          </div>
          <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={onClose}>ปิด</button>
        </div>
      ) : (<>
      <p id="ma-visit-report-description" style={{ marginTop: 0, marginBottom: '0.75rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
        บันทึกสถานะการเข้าเช็ค ผู้ตรวจ รายการหุ่นยนต์ที่ตรวจ และสรุปผลของรอบ MA นี้
      </p>
      <div style={{ display: 'grid', gap: '0.75rem' }}>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          ลูกค้า: <strong style={{ color: 'var(--text)' }}>{visit.plan?.customer?.name ?? '—'}</strong>
           · กำหนดวัน: <strong style={{ color: 'var(--text)' }}>{fmt(visit.scheduledDate)}</strong>
        </div>
        {visit.plan?.notes && (
          <div style={{ padding: '0.7rem 0.85rem', borderRadius: 10, background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.14)' }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#1d4ed8', marginBottom: 4 }}>หมายเหตุจาก MA Plan</div>
            <div style={{ fontSize: '0.84rem', color: 'var(--text)' }}>{visit.plan.notes}</div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <div>
            <label className="form-label" htmlFor="maschedule-status">สถานะ</label>
            <select id="maschedule-status" className="form-control" value={status} onChange={e => setStatus(e.target.value as MAVisit['status'])}>
              <option value="Scheduled">รอเข้าเช็ค</option>
              <option value="Done">เช็คแล้ว</option>
              <option value="Skipped">ข้าม</option>
            </select>
          </div>
          <div>
            <label className="form-label" htmlFor="maschedule-technician">ผู้เข้าตรวจ</label>
            <input id="maschedule-technician" className="form-control" value={technician} onChange={e => setTechnician(e.target.value)} placeholder="ชื่อช่าง" />
          </div>
        </div>

        <div className="card" style={{ background: 'rgba(0,0,0,0.02)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.5rem' }}>
            <QrCode size={16} />
            <strong>รายการหุ่นยนต์ที่ตรวจ</strong>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>(กรอก SN หรือสแกน QR แล้วกด Enter)</span>
          </div>
          {planRobots.length > 0 && (
            <div style={{ marginBottom: '0.6rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>
                  {planRobotIds?.length ? 'หุ่นยนต์ในแผน MA นี้' : 'หุ่นยนต์ของลูกค้า'} ({planRobots.length} เครื่อง)
                </span>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => addRobots(planRobots)}
                  disabled={planRobots.every(r => checks.some(c => c.serialNumber.toUpperCase() === r.serialNumber.toUpperCase()))}>
                  เพิ่มทั้งหมดเข้ารายการตรวจ
                </button>
              </div>
              <div style={{ maxHeight: 150, overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 6 }}>
                {planRobots.map(r => {
                  const added = checks.some(c => c.serialNumber.toUpperCase() === r.serialNumber.toUpperCase());
                  return (
                    <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.4rem 0.65rem', borderBottom: '1px solid var(--border-color)' }}>
                      <code style={{ fontSize: 12 }}>{r.serialNumber}</code>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{modelNameById.get(r.modelId) ?? '—'}</span>
                      <button type="button" className="btn btn-outline btn-sm" style={{ marginLeft: 'auto' }} disabled={added} onClick={() => addRobots([r])}>
                        {added ? 'อยู่ในรายการแล้ว' : 'เพิ่ม'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <form onSubmit={e => { e.preventDefault(); addSN(snInput); }} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <input aria-label="สแกนหรือพิมพ์ Serial Number..."
              className="form-control"
              autoFocus
              value={snInput}
              onChange={e => setSnInput(e.target.value)}
              placeholder="สแกนหรือพิมพ์ Serial Number..."
              style={{ flex: 1 }}
            />
            <CameraScanButton onScan={addSN} />
            <button type="submit" className="btn btn-primary"><Plus size={16} /> เพิ่ม</button>
          </form>
          {checks.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              ยังไม่มีรายการ — สแกน QR หรือพิมพ์ SN เพื่อเริ่ม
            </div>
          ) : (
            <table className="table" style={{ width: '100%' }}>
              <thead>
                <tr><th>SN</th><th style={{ width: 130 }}>สภาพ</th><th>หมายเหตุ</th><th style={{ width: 40 }} /></tr>
              </thead>
              <tbody>
                {checks.map((c, i) => {
                  const known = robotsBySN.has(c.serialNumber.toUpperCase());
                  const sections = maChecklistFor(checkCategory(c), checkModelName(c));
                  const sectionItems = sections.flatMap(sec => sec.items);
                  const doneItems = sectionItems.filter(it => c.items?.[it.id]?.result).length;
                  const issueItems = sectionItems.filter(it => c.items?.[it.id]?.result === 'Issue').length;
                  const isOpen = openChecklist === i;
                  return (
                    <React.Fragment key={i}>
                    <tr>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <ModelAvatar name={checkModelName(c)} imageUrl={robotModel(c.serialNumber)?.imageUrl} size={34} />
                          <div>
                            <code>{c.serialNumber}</code>
                            {robotModelName(c.serialNumber) && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{robotModelName(c.serialNumber)}</div>}
                          </div>
                        </div>
                        {!known && <span style={{ marginLeft: 6, fontSize: '0.7rem', color: 'var(--status-warning)' }}>ไม่พบใน DB</span>}
                        <button type="button" className="btn btn-outline btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4, fontSize: '0.72rem', padding: '0.15rem 0.45rem' }}
                          aria-expanded={isOpen} onClick={() => setOpenChecklist(isOpen ? null : i)}>
                          <ListChecks size={12} /> เช็คลิสต์ {doneItems}/{sectionItems.length}
                          {issueItems > 0 && <span style={{ color: 'var(--status-danger)' }}>· ปัญหา {issueItems}</span>}
                        </button>
                        {c.ticketId && <div style={{ fontSize: '0.7rem', color: 'var(--status-info)', marginTop: 2 }}>เปิด Ticket ซ่อมแล้ว</div>}
                      </td>
                      <td>
                        <select aria-label="สภาพหุ่นยนต์" className="form-control" value={c.condition}
                          onChange={e => updateCheck(i, { condition: e.target.value as RobotCheck['condition'] })}>
                          <option value="OK">OK</option>
                          <option value="Issue">มีปัญหา</option>
                          <option value="Repaired">ซ่อมแล้ว</option>
                        </select>
                      </td>
                      <td><input aria-label="โน้ต..." className="form-control" value={c.notes} onChange={e => updateCheck(i, { notes: e.target.value })} placeholder="โน้ต..." /></td>
                      <td><button className="btn btn-outline" aria-label={`ลบรายการหุ่นยนต์ตรวจแถว ${i + 1}`} title={`ลบรายการหุ่นยนต์ตรวจแถว ${i + 1}`} onClick={() => void removeCheck(i)}><Trash2 size={14} /></button></td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={4} style={{ background: 'rgba(59,130,246,0.04)' }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                            <select aria-label="ประเภทเช็คลิสต์" className="form-control" style={{ width: 'auto', maxWidth: '100%' }} value={checkCategory(c)}
                              onChange={e => updateCheck(i, { category: e.target.value as MaCategory })}>
                              {MA_CATEGORIES.map(cat => <option key={cat} value={cat}>{MA_CATEGORY_LABELS[cat]}</option>)}
                            </select>
                            <button type="button" className="btn btn-outline btn-sm" onClick={() => markAllOk(i)}>ข้อที่ยังไม่กรอก = ปกติ</button>
                          </div>
                          {sections.map(sec => (
                            <div key={sec.title} style={{ marginBottom: 8 }}>
                              <div style={{ fontSize: '0.78rem', fontWeight: 700, marginBottom: 4 }}>{sec.title}</div>
                              {sec.items.map(it => {
                                const r = c.items?.[it.id];
                                return (
                                  <div key={it.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, padding: '0.3rem 0', borderBottom: '1px solid var(--border-color)' }}>
                                    <span style={{ flex: '1 1 200px', minWidth: 0, fontSize: '0.8rem' }}>{it.label}</span>
                                    <select aria-label={`ผล: ${it.label}`} className="form-control" style={{ width: 110, flex: '0 0 auto' }} value={r?.result ?? ''}
                                      onChange={e => updateItem(i, it.id, { result: e.target.value as MaItemResult })}>
                                      <option value="" disabled>—</option>
                                      {(Object.keys(MA_RESULT_LABELS) as MaItemResult[]).map(k => <option key={k} value={k}>{MA_RESULT_LABELS[k]}</option>)}
                                    </select>
                                    <input aria-label={`หมายเหตุ: ${it.label}`} className="form-control" style={{ flex: '1 1 140px', minWidth: 0 }} placeholder="หมายเหตุ"
                                      value={r?.note ?? ''} onChange={e => updateItem(i, it.id, { note: e.target.value })} />
                                  </div>
                                );
                              })}
                            </div>
                          ))}
                          <div style={{ marginTop: 10 }}>
                            <div style={{ fontSize: '0.78rem', fontWeight: 700, marginBottom: 4 }}>อะไหล่ที่เปลี่ยน</div>
                            {(() => {
                              const { fit, other } = partOptions(checkModelName(c));
                              return (c.parts ?? []).map((p, j) => {
                                const part = partById.get(p.sparePartId);
                                return (
                                  <div key={j} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                                    <PartPicker value={p.sparePartId} fit={fit} other={other} modelName={checkModelName(c)}
                                      onChange={id => updatePart(i, j, { sparePartId: id })} />
                                    <input aria-label="จำนวน" type="number" min={1} className="form-control" style={{ width: 80, flex: '0 0 auto' }} value={p.quantity}
                                      onChange={e => updatePart(i, j, { quantity: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} />
                                    {part && !c.ticketId && p.quantity > part.stock && <span style={{ fontSize: '0.72rem', color: 'var(--status-danger)' }}>สต็อกไม่พอ</span>}
                                    <button type="button" className="btn btn-outline btn-sm" aria-label="ลบอะไหล่" onClick={() => removePart(i, j)}><Trash2 size={12} /></button>
                                  </div>
                                );
                              });
                            })()}
                            <button type="button" className="btn btn-outline btn-sm" onClick={() => addPart(i)}><Plus size={12} /> เพิ่มอะไหล่</button>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>
                              เมื่อบันทึกเป็น "เช็คแล้ว": ข้อที่ "มีปัญหา" จะเปิด Ticket ซ่อมให้ ส่วนข้อที่ "ซ่อมแล้ว" หรือมีการใช้อะไหล่ จะบันทึกเป็น Ticket ที่ปิดแล้วและตัดสต็อกอะไหล่
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div>
          <label className="form-label" htmlFor="maschedule-summary">สรุปการเข้าเช็ค</label>
          <textarea id="maschedule-summary" className="form-control" value={summary} onChange={e => setSummary(e.target.value)} rows={3} placeholder="สรุปงานโดยรวม..." />
        </div>

        <AttachmentPanel elementType="MaintenanceVisit" elementId={visit.id} />
        <div className="card" style={{ display: 'grid', gap: 8 }}>
          <strong>ลายเซ็นลูกค้า</strong>
          <input className="form-control" value={signerName} onChange={e => setSignerName(e.target.value)} placeholder="ชื่อผู้ลงนาม" />
          <canvas ref={signatureRef} width={700} height={180} style={{ width: '100%', height: 140, border: '1px dashed var(--border-color)', borderRadius: 6, touchAction: 'none', background: 'var(--text-on-accent)' }} onPointerDown={point} onPointerMove={point} onPointerUp={point} onPointerCancel={point} />
          <div style={{ display: 'flex', gap: 8 }}><button type="button" className="btn btn-outline" onClick={clearSignature}><Eraser size={15} /> ล้างลายเซ็น</button>{signatureUrl && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>มีลายเซ็นที่บันทึกไว้แล้ว</span>}</div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
          <button className="btn btn-outline" onClick={() => void printReport()}><Printer size={16} /> พิมพ์ PDF</button>
          <button className="btn btn-outline" onClick={() => void requestClose()} disabled={saving}>ยกเลิก</button>
          <button className="btn btn-primary" disabled={saving} onClick={save}>
            <CheckCircle2 size={16} /> {saving ? 'กำลังบันทึก...' : 'บันทึก'}
          </button>
        </div>
      </div>
      </>)}
    </Modal>
  );
};

const PlanModal: React.FC<{ plan?: MAPlan | null; onClose: () => void; onSaved: () => void }> = ({ plan, onClose, onSaved }) => {
  const { customers, robots, models } = useData();
  const { showToast } = useToast();
  const [customerId, setCustomerId] = useState(plan?.customerId ?? '');
  const [robotIds, setRobotIds] = useState<string[]>(plan?.robotIds ?? []);
  const [startDate, setStartDate] = useState(plan?.startDate ?? todayISO());
  const [endDate, setEndDate] = useState(plan?.endDate ?? '');
  const [intervalMonths, setIntervalMonths] = useState(plan?.intervalMonths ?? 3);
  const [notes, setNotes] = useState(plan?.notes ?? '');
  const [active, setActive] = useState(plan?.active ?? true);
  const [saving, setSaving] = useState(false);

  const customerRobots = useMemo(
    () => robots
      .filter(r => r.customerId === customerId && !r.archivedAt)
      .sort((a, b) => a.serialNumber.localeCompare(b.serialNumber)),
    [robots, customerId],
  );
  const modelNameById = useMemo(() => new Map(models.map(m => [m.id, m.name])), [models]);

  const changeCustomer = (id: string) => {
    setCustomerId(id);
    setRobotIds([]);
  };
  const toggleRobot = (id: string) => setRobotIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));

  const save = async () => {
    if (!customerId || !startDate) { showToast('กรุณาเลือกลูกค้าและวันที่เริ่ม', 'warning'); return; }
    setSaving(true);
    try {
      const validRobotIds = customerRobots.filter(r => robotIds.includes(r.id)).map(r => r.id);
      const payload = { customerId, startDate, endDate: endDate || null, intervalMonths, notes, active, robotIds: validRobotIds };
      if (plan) await api.put(`/ma-plans/${plan.id}`, payload);
      else await api.post('/ma-plans', payload);
      showToast('บันทึก MA Plan สำเร็จ', 'success');
      onSaved();
      onClose();
    } catch (e: any) {
      showToast(e?.response?.data?.error || 'บันทึกไม่สำเร็จ', 'error');
    } finally { setSaving(false); }
  };

  return (
    <Modal open={true} onClose={onClose} width={520} describedById="ma-plan-form-description" title={plan ? 'แก้ไข MA Plan' : 'สร้าง MA Plan ใหม่'}>
      <p id="ma-plan-form-description" style={{ marginTop: 0, marginBottom: '0.75rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
        กำหนดลูกค้า วันที่เริ่ม รอบเดือน และสถานะการใช้งานของแผน MA เพื่อให้ระบบสร้างรอบตรวจอัตโนมัติ
      </p>
      <div style={{ display: 'grid', gap: '0.75rem' }}>
        <div>
          <label className="form-label" htmlFor="maschedule-customerId">ลูกค้า / ร้านค้า</label>
          <select id="maschedule-customerId" className="form-control" value={customerId} onChange={e => changeCustomer(e.target.value)} disabled={!!plan}>
            <option value="">-- เลือกร้านค้า --</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        {customerId && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
              <span className="form-label" id="ma-plan-robots-label" style={{ margin: 0 }}>หุ่นยนต์ในแผน MA (เลือกได้มากกว่า 1 เครื่อง)</span>
              {customerRobots.length > 0 && (
                <span style={{ display: 'flex', gap: 6, fontSize: '0.75rem' }}>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setRobotIds(customerRobots.map(r => r.id))}>เลือกทั้งหมด</button>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setRobotIds([])} disabled={robotIds.length === 0}>ล้าง</button>
                </span>
              )}
            </div>
            {customerRobots.length === 0 ? (
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>ลูกค้านี้ยังไม่มีหุ่นยนต์ในระบบ</div>
            ) : (
              <>
                <div role="group" aria-labelledby="ma-plan-robots-label" style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 6 }}>
                  {customerRobots.map(r => (
                    <label key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.5rem 0.65rem', borderBottom: '1px solid var(--border-color)', cursor: 'pointer' }}>
                      <input type="checkbox" checked={robotIds.includes(r.id)} onChange={() => toggleRobot(r.id)} />
                      <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{r.serialNumber}</span>
                      <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>{modelNameById.get(r.modelId) ?? ''}</span>
                    </label>
                  ))}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 3 }}>
                  เลือกแล้ว {robotIds.length} จาก {customerRobots.length} เครื่อง{robotIds.length === 0 ? ' (ไม่เลือก = ครอบคลุมทุกเครื่องของลูกค้า)' : ''}
                </div>
              </>
            )}
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <div>
            <label htmlFor="ma-start-date" className="form-label">วันที่เริ่ม MA (วันที่สร้างร้าน)</label>
            <ThaiDateInput id="ma-start-date" className="form-control" value={startDate} onChange={e => setStartDate(e.target.value)} />
          </div>
          <div>
            <label htmlFor="ma-end-date" className="form-label">วันสิ้นสุด MA</label>
            <ThaiDateInput id="ma-end-date" className="form-control" value={endDate} onChange={e => setEndDate(e.target.value)} />
          </div>
        </div>
        <div>
          <label htmlFor="ma-interval-months" className="form-label">ทุกๆ (เดือน)</label>
          <input id="ma-interval-months" className="form-control" type="number" min={1} max={24} value={intervalMonths} onChange={e => setIntervalMonths(Number(e.target.value))} />
        </div>
        <div>
          <label className="form-label" htmlFor="maschedule-notes">หมายเหตุ</label>
          <textarea id="maschedule-notes" className="form-control" value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
        </div>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /> เปิดใช้งาน
        </label>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          ระบบจะสร้างรอบเข้าเช็คอัตโนมัติทุกๆ {intervalMonths} เดือน
          {endDate ? ` จนถึง ${fmt(endDate)}` : ' (ไม่จำกัดจนกว่าจะใส่วันสิ้นสุด)'}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
          <button className="btn btn-outline" onClick={onClose}>ยกเลิก</button>
          <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'กำลังบันทึก...' : 'บันทึก'}</button>
        </div>
      </div>
    </Modal>
  );
};

/* ── Import Modal — upload Excel ───────────────────────────────────────────── */
interface ImportResult { totalRows?: number; totalStores?: number; createdCustomers: number; createdPlans: number; skipped: number; totalVisits: number; details: { name: string; action: string; reason: string }[]; }

const ImportModal: React.FC<{ onClose: () => void; onDone: () => void }> = ({ onClose, onDone }) => {
  const { showToast } = useToast();
  const [mode, setMode] = useState<'idle' | 'uploading' | 'done'>('idle');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setMode('uploading'); setError(null);
    try {
      const fd = new FormData();
      fd.append('file', f);
      const r = await api.post<ImportResult>('/ma-plans/import/upload', fd);
      setResult(r.data); setMode('done');
      if (r.data.createdPlans === 0 && r.data.skipped > 0) {
        showToast(`ข้ามทั้งหมด ${r.data.skipped} รายการ (มี MA Plan อยู่แล้ว)`, 'info');
      } else {
        showToast(`นำเข้า ${r.data.createdPlans} MA Plans สำเร็จ`, 'success');
      }
      onDone();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'อัปโหลดไม่สำเร็จ');
      setMode('idle');
    }
  };

  const actionColor: Record<string, string> = { create: '#22c55e', skip: '#9ca3af' };

  return (
    <Modal open={true} onClose={onClose} width={640} describedById="ma-import-description" title={<span><Upload size={20} style={{ verticalAlign: 'middle', marginRight: 6 }} /> นำเข้า MA Plans</span>}>
      <p id="ma-import-description" style={{ marginTop: 0, marginBottom: '0.75rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
        นำเข้าร้านค้าจากไฟล์ Excel เพื่อสร้าง MA plans และรอบตรวจเริ่มต้นอัตโนมัติ
      </p>
      {mode === 'idle' && (
        <div style={{ display: 'grid', gap: '1rem' }}>
          {error && <div style={{ padding: '0.5rem 0.75rem', borderRadius: 8, background: 'rgba(239,68,68,0.1)', color: 'var(--status-danger)', fontSize: '0.85rem' }}>{error}</div>}

          <div className="card" style={{ cursor: 'pointer', border: '2px dashed var(--border-color)', textAlign: 'center', padding: '1.5rem' }}
            onClick={() => fileRef.current?.click()}>
            <FileSpreadsheet size={36} style={{ color: 'var(--color-primary)', marginBottom: 8 }} />
            <div style={{ fontWeight: 600, marginBottom: 4 }}>อัปโหลดไฟล์ Store List (.xlsx)</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>ระบบจะอ่านร้านค้าจากไฟล์ Excel แล้วสร้าง MA Plans อัตโนมัติ</div>
            <input aria-label="เลือกไฟล์ Excel ตาราง MA" ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={handleFile} />
          </div>
        </div>
      )}

      {mode === 'uploading' && (
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <Loader size={32} className="spin" style={{ color: 'var(--color-primary)', marginBottom: 12 }} />
          <div>กำลังนำเข้าจากไฟล์...</div>
        </div>
      )}

      {mode === 'done' && result && (
        <div style={{ display: 'grid', gap: '0.75rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.5rem' }}>
            <div className="card" style={{ textAlign: 'center', padding: '0.75rem' }}>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#22c55e' }}>{result.createdPlans}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>แผนใหม่ที่สร้าง</div>
            </div>
            <div className="card" style={{ textAlign: 'center', padding: '0.75rem' }}>
              <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{result.totalVisits}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>รอบเข้าตรวจใหม่ที่สร้าง</div>
            </div>
            <div className="card" style={{ textAlign: 'center', padding: '0.75rem' }}>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--status-info)' }}>{result.createdCustomers}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>ลูกค้าใหม่</div>
            </div>
            <div className="card" style={{ textAlign: 'center', padding: '0.75rem' }}>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#9ca3af' }}>{result.skipped}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>ข้าม</div>
            </div>
          </div>

          {result.details.length > 0 && (
            <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 8 }}>
              <table className="table" style={{ width: '100%', fontSize: '0.8rem' }}>
                <thead><tr><th>ร้านค้า</th><th>ผลลัพธ์</th><th>หมายเหตุ</th></tr></thead>
                <tbody>
                  {result.details.map((d, i) => (
                    <tr key={i}>
                      <td>{d.name}</td>
                      <td><span style={{ color: actionColor[d.action] || 'var(--text)' }}>{d.action === 'create' ? '+ สร้างใหม่' : '– ข้าม'}</span></td>
                      <td style={{ color: 'var(--text-muted)' }}>{d.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn btn-primary" onClick={onClose}>ปิด</button>
          </div>
        </div>
      )}
    </Modal>
  );
};

const MASchedule: React.FC = () => {
  const { customers, robots } = useData();
  const { user } = useAuth();
  const confirm = useConfirm();
  const { showToast } = useToast();
  const isAdmin = user?.role === 'ADMIN';

  const [plans, setPlans] = useState<MAPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'calendar' | 'list' | 'history'>('calendar');
  const [historySearch, setHistorySearch] = useState('');
  const [planSearch, setPlanSearch] = useState('');
  const [planModal, setPlanModal] = useState<{ open: boolean; plan: MAPlan | null }>({ open: false, plan: null });
  const [visitModal, setVisitModal] = useState<MAVisit | null>(null);
  const [importModal, setImportModal] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<MAPlan[]>('/ma-plans');
      setPlans(r.data);
    } catch (e: any) {
      showToast(e?.response?.data?.error || 'โหลด MA Plans ไม่สำเร็จ', 'error');
    } finally { setLoading(false); }
  }, [showToast]);

  useEffect(() => { void load(); }, [load]);
  usePolling(load, 300_000);

  const robotSerialById = useMemo(() => new Map(robots.map(r => [r.id, r.serialNumber])), [robots]);

  const customerName = useCallback(
    (id: string) => customers.find(c => c.id === id)?.name ?? id.slice(0, 8),
    [customers]
  );

  const allVisits: MAVisit[] = useMemo(() => {
    const out: MAVisit[] = [];
    plans.forEach(p => {
      p.visits.forEach(v =>
        out.push({ ...v, plan: { customer: { id: p.customerId, name: customerName(p.customerId) }, notes: p.notes, robotIds: p.robotIds } })
      );
    });
    return out;
  }, [plans, customerName]);

  // Every past visit recorded as Done, newest first — across every plan, including ones
  // whose MA has already run out, so a completed round's history stays visible.
  const doneVisits = useMemo(
    () => allVisits
      .filter(v => v.status === 'Done')
      .sort((a, b) => (b.completedAt || b.scheduledDate).localeCompare(a.completedAt || a.scheduledDate)),
    [allVisits]
  );

  const filteredPlans = useMemo(() => {
    const q = planSearch.trim().toLowerCase();
    if (!q) return plans;
    return plans.filter(p =>
      customerName(p.customerId).toLowerCase().includes(q) ||
      (p.notes || '').toLowerCase().includes(q) ||
      (p.robotIds || []).some(id => (robotSerialById.get(id) || '').toLowerCase().includes(q))
    );
  }, [plans, planSearch, customerName, robotSerialById]);

  const filteredHistory = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    if (!q) return doneVisits;
    return doneVisits.filter(v =>
      (v.plan?.customer?.name || '').toLowerCase().includes(q) ||
      (v.technician || '').toLowerCase().includes(q) ||
      (v.summary || '').toLowerCase().includes(q)
    );
  }, [doneVisits, historySearch]);

  const planMeta = useMemo(() => {
    const entries = plans.map(plan => {
      const lastVisitDate = getPlanLastVisitDate(plan);
      const hasScheduledVisits = plan.visits.some(visit => visit.status === 'Scheduled');
      const isCompleted =
        !!plan.endDate &&
        !!lastVisitDate &&
        lastVisitDate < todayISO() &&
        !hasScheduledVisits;
      return [plan.id, { lastVisitDate, hasScheduledVisits, isCompleted }] as const;
    });
    return new Map(entries);
  }, [plans]);

  const visiblePlans = useMemo(
    () => plans.filter(plan => !planMeta.get(plan.id)?.isCompleted),
    [plans, planMeta]
  );

  const activeVisits = useMemo(() => {
    const out: MAVisit[] = [];
    visiblePlans.forEach(p => {
      p.visits.forEach(v =>
        out.push({ ...v, plan: { customer: { id: p.customerId, name: customerName(p.customerId) }, notes: p.notes, robotIds: p.robotIds } })
      );
    });
    return out;
  }, [visiblePlans, customerName]);

  const upcoming = useMemo(
    () => activeVisits.filter(v => v.status === 'Scheduled' && daysUntil(v.scheduledDate) <= 30 && daysUntil(v.scheduledDate) >= 0)
      .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate)),
    [activeVisits]
  );

  const overdue = useMemo(
    () => activeVisits.filter(v => v.status === 'Scheduled' && daysUntil(v.scheduledDate) < 0)
      .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate)),
    [activeVisits]
  );

  const dueToday = useMemo(
    () => activeVisits.filter(v => v.status === 'Scheduled' && v.scheduledDate === todayISO())
      .sort((a, b) => a.visitNumber - b.visitNumber),
    [activeVisits]
  );

  const stats = {
    plans: plans.length,
    activePlans: visiblePlans.filter(p => p.active).length,
    upcoming: upcoming.length,
    overdue: overdue.length,
  };

  const deletePlan = async (p: MAPlan) => {
    const ok = await confirm(`ลบแผน MA ของ "${customerName(p.customerId)}" ทั้งหมด?`, {
      title: 'ลบ MA Plan?', confirmLabel: 'ลบ', danger: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/ma-plans/${p.id}`);
      showToast('ลบเรียบร้อย', 'success');
      void load();
    } catch (e: any) { showToast(e?.response?.data?.error || 'ลบไม่สำเร็จ', 'error'); }
  };

  const regenerate = async (p: MAPlan) => {
    try {
      await api.post(`/ma-plans/${p.id}/regenerate`);
      showToast('สร้างรอบใหม่เรียบร้อย', 'success');
      void load();
    } catch (e: any) { showToast(e?.response?.data?.error || 'ไม่สำเร็จ', 'error'); }
  };

  const [downloadingChecklist, setDownloadingChecklist] = useState(false);
  const handleDownloadChecklist = async (category: MaCategory) => {
    setDownloadingChecklist(true);
    try { await downloadMaChecklistPdf(category); }
    catch { showToast('สร้างไฟล์ PDF ไม่สำเร็จ', 'error'); }
    finally { setDownloadingChecklist(false); }
  };

  return (
    <div className="page-container">
      <PageHeader
        title={<><CalendarDays size={26} style={{ verticalAlign: 'middle', marginRight: 8 }} />ตารางเข้า MA / รอบบำรุงรักษา</>}
        subtitle="จัดการรอบเข้าเช็คหุ่นยนต์ทุกๆ N เดือน นับจากวันที่สร้างร้าน"
        actions={
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <label style={{ position: 'relative', display: 'inline-flex' }} title="ดาวน์โหลดเช็คลิสต์ MA เปล่า (PDF) ตามประเภทหุ่น">
              <span className="btn btn-outline" aria-hidden="true">
                <Download size={16} /> {downloadingChecklist ? 'กำลังสร้างไฟล์...' : 'เช็คลิสต์ MA (PDF)'}
              </span>
              <select aria-label="ดาวน์โหลดเช็คลิสต์ MA (PDF) เลือกประเภทหุ่น" value="" disabled={downloadingChecklist}
                onChange={e => { if (e.target.value) void handleDownloadChecklist(e.target.value as MaCategory); }}
                style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%' }}>
                <option value="" disabled>เลือกประเภทหุ่น</option>
                {MA_CATEGORIES.map(cat => <option key={cat} value={cat}>{MA_CATEGORY_LABELS[cat]}</option>)}
              </select>
            </label>
            {isAdmin && (
              <>
                <button className="btn btn-outline" onClick={() => setImportModal(true)}>
                  <Upload size={16} /> นำเข้า
                </button>
                <button className="btn btn-primary" onClick={() => setPlanModal({ open: true, plan: null })}>
                  <Plus size={16} /> สร้าง MA Plan
                </button>
              </>
            )}
          </div>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '1.6rem', fontWeight: 700 }}>{stats.activePlans}</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>MA Plans (ใช้งาน)</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--status-info)' }}>{stats.upcoming}</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>กำลังจะถึง (30 วัน)</div>
        </div>
        <div className="card" style={{ textAlign: 'center', borderColor: stats.overdue > 0 ? 'var(--status-danger)' : undefined }}>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, color: stats.overdue > 0 ? 'var(--status-danger)' : undefined }}>{stats.overdue}</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>เลยกำหนด</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '1.6rem', fontWeight: 700 }}>{stats.plans}</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>แผนทั้งหมด</div>
        </div>
      </div>

      {(overdue.length > 0 || upcoming.length > 0) && (
        <div className="card" style={{ marginBottom: '1rem', borderColor: overdue.length ? 'var(--status-danger)' : 'var(--status-warning)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: '0.9rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
              <AlertTriangle size={16} color={overdue.length ? 'var(--status-danger)' : 'var(--status-warning)'} />
              แจ้งเตือนรอบ MA
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {overdue.length > 0 && (
                <span className="badge danger" style={{ fontSize: '0.78rem', padding: '0.32rem 0.65rem' }}>
                  เลยกำหนด {overdue.length} รายการ
                </span>
              )}
              {upcoming.length > 0 && (
                <span className="badge warning" style={{ fontSize: '0.78rem', padding: '0.32rem 0.65rem' }}>
                  กำลังจะถึง {upcoming.length} รายการ
                </span>
              )}
            </div>
          </div>
          <div style={{ display: 'grid', gap: '0.85rem' }}>
            {overdue.length > 0 && (
              <div>
                <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--status-danger)', marginBottom: '0.55rem' }}>เลยกำหนดแล้ว</div>
                <div style={{ maxHeight: 360, overflowY: 'auto', paddingRight: 4 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.6rem' }}>
                  {overdue.map(v => {
                    const d = daysUntil(v.scheduledDate);
                    return (
                      <button
                        key={v.id}
                        onClick={() => setVisitModal(v)}
                        style={{
                          textAlign: 'left',
                          padding: '0.85rem 0.9rem',
                          borderRadius: 14,
                          border: '1px solid rgba(239,68,68,0.24)',
                          background: 'linear-gradient(135deg, rgba(239,68,68,0.10), rgba(255,255,255,0.98))',
                          color: 'var(--text)',
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start', marginBottom: 6 }}>
                          <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#991b1b' }}>{v.plan?.customer?.name ?? '—'}</div>
                          <span className="badge danger" style={{ fontSize: '0.74rem', whiteSpace: 'nowrap' }}>{maDueLabel(d)}</span>
                        </div>
                        <div style={{ fontSize: '0.8rem', color: '#7f1d1d', marginBottom: 3 }}>รอบที่ {v.visitNumber}</div>
                        <div style={{ fontSize: '0.82rem', color: '#475569' }}>กำหนดเข้าเช็ค: {fmt(v.scheduledDate)}</div>
                      </button>
                    );
                  })}
                  </div>
                </div>
              </div>
            )}

            {upcoming.length > 0 && (
              <div>
                <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#b45309', marginBottom: '0.55rem' }}>ใกล้ถึงกำหนด</div>
                <div style={{ maxHeight: 360, overflowY: 'auto', paddingRight: 4 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.6rem' }}>
                  {upcoming.map(v => {
                    const d = daysUntil(v.scheduledDate);
                    return (
                      <button
                        key={v.id}
                        onClick={() => setVisitModal(v)}
                        style={{
                          textAlign: 'left',
                          padding: '0.85rem 0.9rem',
                          borderRadius: 14,
                          border: '1px solid rgba(245,158,11,0.24)',
                          background: 'linear-gradient(135deg, rgba(245,158,11,0.10), rgba(255,255,255,0.98))',
                          color: 'var(--text)',
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start', marginBottom: 6 }}>
                          <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#92400e' }}>{v.plan?.customer?.name ?? '—'}</div>
                          <span className="badge warning" style={{ fontSize: '0.74rem', whiteSpace: 'nowrap' }}>{maDueLabel(d)}</span>
                        </div>
                        <div style={{ fontSize: '0.8rem', color: '#a16207', marginBottom: 3 }}>รอบที่ {v.visitNumber}</div>
                        <div style={{ fontSize: '0.82rem', color: '#475569' }}>กำหนดเข้าเช็ค: {fmt(v.scheduledDate)}</div>
                      </button>
                    );
                  })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {dueToday.length > 0 && (
        <div className="card" style={{ marginBottom: '1rem', borderColor: 'var(--status-info)', background: 'linear-gradient(135deg, rgba(59,130,246,0.08), rgba(14,165,233,0.03))' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.65rem', fontWeight: 700, color: '#1d4ed8' }}>
            <CalendarDays size={16} />
            โฟกัสวันนี้: ถึงวันเข้า MA
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0.6rem' }}>
            {dueToday.map(v => (
              <button
                key={v.id}
                onClick={() => setVisitModal(v)}
                style={{
                  textAlign: 'left',
                  padding: '0.85rem 0.9rem',
                  borderRadius: 12,
                  border: '1px solid rgba(59,130,246,0.18)',
                  background: 'var(--text-on-accent)',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: 4 }}>ถึงวัน {fmt(v.scheduledDate)}</div>
                <div style={{ fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>{v.plan?.customer?.name ?? '—'}</div>
                <div style={{ fontSize: '0.82rem', color: '#475569' }}>รอบที่ {v.visitNumber} · สถานะ {statusLabel[v.status]}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <button className={`btn ${tab === 'calendar' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('calendar')}>
          <CalendarDays size={16} /> ปฏิทิน
        </button>
        <button className={`btn ${tab === 'list' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('list')}>
          <ListChecks size={16} /> รายการ Plan
        </button>
        <button className={`btn ${tab === 'history' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('history')}>
          <History size={16} /> ประวัติการเข้า MA ({doneVisits.length})
        </button>
      </div>

      {loading ? (
        <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>กำลังโหลด...</div>
      ) : tab === 'calendar' ? (
        <Calendar visits={activeVisits} onClickVisit={setVisitModal} />
      ) : tab === 'history' ? (
        <div className="card">
          <div style={{ position: 'relative', marginBottom: '1rem', maxWidth: 360 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input className="form-control" style={{ paddingLeft: 32 }} value={historySearch} onChange={e => setHistorySearch(e.target.value)} placeholder="ค้นหาลูกค้า ผู้เข้าตรวจ หรือสรุปงาน" />
          </div>
          {doneVisits.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
              ยังไม่มีประวัติการเข้า MA ที่บันทึกไว้
            </div>
          ) : filteredHistory.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
              ไม่พบรายการที่ตรงกับ "{historySearch}"
            </div>
          ) : (
            <table className="table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>ลูกค้า / สถานที่</th><th>รอบที่</th><th>วันที่เข้าเช็ค</th>
                  <th>ผู้เข้าตรวจ</th><th>สรุปงาน</th><th style={{ width: 90, textAlign: 'right' }}></th>
                </tr>
              </thead>
              <tbody>
                {filteredHistory.map(v => (
                  <tr key={v.id} style={{ cursor: 'pointer' }} onClick={() => setVisitModal(v)}>
                    <td>
                      <strong>{v.plan?.customer?.name ?? '—'}</strong>
                      {v.plan?.notes && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{v.plan.notes}</div>}
                    </td>
                    <td>{v.visitNumber}</td>
                    <td>{fmt(v.completedAt || v.scheduledDate)}</td>
                    <td>{v.technician || <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                    <td style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {v.summary || <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                    <td style={{ textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                      <button className="btn btn-outline btn-sm" onClick={() => setVisitModal(v)} title="ดูรายงาน">
                        <Eye size={14} /> ดู
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <div className="card">
          {plans.length > 0 && (
            <div style={{ position: 'relative', marginBottom: '1rem', maxWidth: 360 }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input className="form-control" style={{ paddingLeft: 32 }} value={planSearch} onChange={e => setPlanSearch(e.target.value)} placeholder="ค้นหาร้านค้า หมายเหตุ หรือ SN หุ่นยนต์" />
            </div>
          )}
          {plans.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
              ยังไม่มี MA Plan — กด "สร้าง MA Plan" เพื่อเริ่ม
            </div>
          ) : filteredPlans.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
              ไม่พบ Plan ที่ตรงกับ "{planSearch}"
            </div>
          ) : (
            <table className="table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>ร้านค้า</th><th>เริ่ม</th><th>สิ้นสุด</th><th>รอบ (เดือน)</th>
                  <th>ก้าวหน้า</th><th>สถานะ</th><th style={{ width: 200, textAlign: 'right' }}>การจัดการ</th>
                </tr>
              </thead>
              <tbody>
                {filteredPlans.map(p => {
                  const done = p.visits.filter(v => v.status === 'Done').length;
                  const meta = planMeta.get(p.id);
                  const isCompleted = !!meta?.isCompleted;
                  return (
                    <tr key={p.id}>
                      <td>
                        <strong>{customerName(p.customerId)}</strong>
                        {!!p.robotIds?.length && (
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                            หุ่นยนต์ {p.robotIds.length} เครื่อง: <span style={{ fontVariantNumeric: 'tabular-nums' }}>{p.robotIds.map(id => robotSerialById.get(id) ?? '—').join(', ')}</span>
                          </div>
                        )}
                        {p.notes && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{p.notes}</div>}
                        {isCompleted && (
                          <div style={{ fontSize: '0.75rem', color: '#b45309', marginTop: 3 }}>
                            จบรอบ MA แล้ว{meta?.lastVisitDate ? ` · รอบสุดท้าย ${fmt(meta.lastVisitDate)}` : ''}
                          </div>
                        )}
                      </td>
                      <td>{fmt(p.startDate)}</td>
                      <td>{p.endDate ? fmt(p.endDate) : <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                      <td>{p.intervalMonths}</td>
                      <td>{done} / {p.visits.length}</td>
                      <td>
                        <span style={{
                          padding: '2px 8px', borderRadius: 10, fontSize: '0.75rem',
                          background: isCompleted
                            ? 'rgba(245,158,11,0.15)'
                            : p.active
                              ? 'rgba(34,197,94,0.15)'
                              : 'rgba(156,163,175,0.15)',
                          color: isCompleted ? '#b45309' : p.active ? 'var(--status-success)' : 'var(--text-muted)',
                        }}>{isCompleted ? 'หมด MA' : p.active ? 'ใช้งานอยู่' : 'ปิดใช้งาน'}</span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {isAdmin && (
                          <>
                            <button className="btn btn-outline btn-sm" title="สร้างรอบใหม่" onClick={() => regenerate(p)} style={{ marginRight: 4 }}>
                              <RefreshCw size={14} />
                            </button>
                            <button className="btn btn-outline btn-sm" onClick={() => setPlanModal({ open: true, plan: p })} style={{ marginRight: 4 }}>
                              แก้ไข
                            </button>
                            <button className="btn btn-outline btn-sm" onClick={() => deletePlan(p)}>
                              <Trash2 size={14} />
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {planModal.open && (
        <PlanModal plan={planModal.plan} onClose={() => setPlanModal({ open: false, plan: null })} onSaved={load} />
      )}
      {visitModal && (
        <VisitModal visit={visitModal} onClose={() => setVisitModal(null)} onSaved={load} />
      )}
      {importModal && (
        <ImportModal onClose={() => setImportModal(false)} onDone={load} />
      )}
    </div>
  );
};

export default MASchedule;
