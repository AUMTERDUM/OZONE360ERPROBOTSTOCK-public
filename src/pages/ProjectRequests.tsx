import React, { useState, useEffect, useMemo } from 'react';
import {
  Plus, Search, Eye, X, Printer, Edit2, Trash2,
  ChevronDown, Clock, CheckCircle, XCircle, PlayCircle,
  Briefcase, FileText, Wrench, Package, Send, MoreHorizontal,
  AlertCircle,
} from 'lucide-react';
import api from '../api';
import { printPDF, logoSVG } from '../utils/printPDF';
import { ThaiDateInput } from '../components/ThaiDateInput';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../context/ConfirmContext';
import { useToast } from '../context/ToastContext';
import { useData } from '../context/DataContext';
import AttachmentPanel from '../components/AttachmentPanel';
import PageHeader from '../components/PageHeader';
import CameraScanButton from '../components/CameraScanButton';
import Pagination from '../components/Pagination';
import { Modal, FormSubmitButton, useUrlSearch, useTableSort, SortableTh } from '../components/UIUtils';
import { formatThaiDate, formatThaiDateTime, todayISO } from '../utils/thaiDate';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ProjectItem {
  id?: string;
  itemType: string; // Part | Labor | Other
  description: string;
  vendor: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
  link: string;
  remark: string;
}

interface ProjectRequest {
  id: string;
  docNumber: string;
  title: string;
  description?: string;
  projectType: string;
  status: string;
  startDate: string;
  expectedEndDate?: string;
  actualEndDate?: string;
  budget: number;
  totalCost: number;
  customerId?: string;
  robotId?: string;
  notes?: string;
  createdAt: string;
  createdBy?: string;
  approvedBy?: string;
  approvedAt?: string;
  items: ProjectItem[];
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso?: string | null) {
  if (!iso) return '-';
  return formatThaiDate(iso);
}

function formatCurrency(n: number) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  return `PRJ${y}${m}${d}-${rand}`;
}

const today = () => todayISO();

// ── Status Config ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; border: string; icon: React.ReactNode }> = {
  Draft:      { label: 'ร่าง',              color: 'var(--text-primary)',    bg: 'var(--bg-tertiary)',        border: 'var(--border-color-strong)', icon: <FileText size={12} /> },
  Pending:    { label: 'รอพิจารณา',         color: 'var(--status-warning)',  bg: 'var(--status-warning-bg)', border: 'var(--status-warning)', icon: <Clock size={12} /> },
  Approved:   { label: 'อนุมัติแล้ว',       color: 'var(--status-info)',     bg: 'var(--status-info-bg)',    border: 'var(--status-info)', icon: <CheckCircle size={12} /> },
  InProgress: { label: 'กำลังดำเนินการ',   color: 'var(--accent-primary)',  bg: 'var(--accent-subtle)',     border: 'var(--accent-primary)', icon: <PlayCircle size={12} /> },
  Completed:  { label: 'สำเร็จ',            color: 'var(--status-success)',  bg: 'var(--status-success-bg)', border: 'var(--status-success)', icon: <CheckCircle size={12} /> },
  Cancelled:  { label: 'ยกเลิก',            color: 'var(--status-danger)',   bg: 'var(--status-danger-bg)',  border: 'var(--status-danger)', icon: <XCircle size={12} /> },
};

const TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  ExternalParts: { label: 'สั่งชิ้นส่วนภายนอก', color: 'var(--accent-primary)' },
  ExternalLabor: { label: 'จ้างช่างภายนอก',     color: 'var(--status-warning)' },
  Both:          { label: 'ทั้งสองอย่าง',        color: 'var(--status-info)' },
};

const ITEM_TYPE_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  Part:  { label: 'ชิ้นส่วน/อะไหล่', icon: <Package  size={12} />, color: 'var(--accent-primary)' },
  Labor: { label: 'ค่าแรง/ช่าง',      icon: <Wrench   size={12} />, color: 'var(--status-warning)' },
  Other: { label: 'อื่นๆ',             icon: <MoreHorizontal size={12} />, color: 'var(--text-secondary)' },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG['Draft'];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600,
      color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.border}`,
    }}>
      {cfg.icon}{cfg.label}
    </span>
  );
}

function getProjectStatusNarrative(project: Pick<ProjectRequest, 'status' | 'approvedBy' | 'actualEndDate'>) {
  switch (project.status) {
    case 'Draft':
      return 'โปรเจคยังเป็นร่างและยังแก้ไขรายละเอียดหรืองบประมาณได้';
    case 'Pending':
      return 'โปรเจครอการพิจารณาอนุมัติก่อนเริ่มดำเนินการจริง';
    case 'Approved':
      return project.approvedBy
        ? `โปรเจคได้รับอนุมัติแล้วโดย ${project.approvedBy} และพร้อมเริ่มดำเนินงาน`
        : 'โปรเจคได้รับอนุมัติแล้วและพร้อมเริ่มดำเนินงาน';
    case 'InProgress':
      return 'โปรเจคอยู่ระหว่างดำเนินการ ควรติดตามต้นทุนและความคืบหน้าอย่างต่อเนื่อง';
    case 'Completed':
      return project.actualEndDate
        ? `โปรเจคเสร็จสิ้นแล้วเมื่อ ${formatDate(project.actualEndDate)}`
        : 'โปรเจคเสร็จสิ้นแล้ว';
    case 'Cancelled':
      return 'โปรเจคถูกยกเลิก และไม่อยู่ในคิวดำเนินการต่อ';
    default:
      return 'ตรวจสอบสถานะของโปรเจคนี้ก่อนดำเนินการต่อ';
  }
}

function TypeBadge({ type }: { type: string }) {
  const cfg = TYPE_CONFIG[type] ?? TYPE_CONFIG['Both'];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 500,
      color: cfg.color, background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
    }}>
      {cfg.label}
    </span>
  );
}

// ── Empty item template ────────────────────────────────────────────────────────

const EMPTY_ITEM: ProjectItem = {
  itemType: 'Part', description: '', vendor: '',
  quantity: 1, unit: 'ชิ้น', unitPrice: 0, totalPrice: 0, link: '', remark: '',
};

// ── View Modal ────────────────────────────────────────────────────────────────

function ViewModal({
  project,
  onClose,
  onEdit,
  onPrint,
  onChangeStatus,
  isAdmin,
  customers,
  robots,
}: {
  project: ProjectRequest;
  onClose: () => void;
  onEdit: () => void;
  onPrint: () => void;
  onChangeStatus: (status: string) => void;
  isAdmin: boolean;
  customers: { id: string; name: string }[];
  robots: { id: string; serialNumber: string }[];
}) {
  const customerName = customers.find(c => c.id === project.customerId)?.name;
  const robotSerial = robots.find(r => r.id === project.robotId)?.serialNumber;

  const NEXT_STATUSES: Record<string, string[]> = {
    Draft:      ['Pending', 'Cancelled'],
    Pending:    ['Approved', 'Cancelled'],
    Approved:   ['InProgress', 'Cancelled'],
    InProgress: ['Completed', 'Cancelled'],
    Completed:  [],
    Cancelled:  [],
  };
  const nextStatuses = NEXT_STATUSES[project.status] ?? [];

  return (
    <Modal open={true} onClose={onClose} title={<><Briefcase size={18} style={{ color: 'var(--accent-primary)' }} /> {project.docNumber} <StatusBadge status={project.status} /></>} width={780} describedById="project-request-view-description">
        <div id="project-request-view-description" style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
          รายละเอียดโปรเจค, สถานะ, งบประมาณ, รายการค่าใช้จ่าย และเอกสารแนบสำหรับ {project.docNumber}
        </div>
        {(() => {
          const statusCfg = STATUS_CONFIG[project.status] ?? STATUS_CONFIG.Draft;
          return (
            <div style={{ marginBottom: 16, padding: '12px 14px', borderRadius: 12, border: `1px solid ${statusCfg.border}`, background: statusCfg.bg }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, color: statusCfg.color, fontSize: 12, fontWeight: 700 }}>
                {statusCfg.icon}
                <span>สถานะปัจจุบัน: {statusCfg.label}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{getProjectStatusNarrative(project)}</div>
            </div>
          );
        })()}
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>{project.title}</div>
        <div style={{ marginBottom: 16 }}><TypeBadge type={project.projectType} /></div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {/* Info grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div className="card" style={{ padding: '12px 16px' }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>ข้อมูลโปรเจค</div>
              <InfoRow label="วันที่เริ่ม" value={formatDate(project.startDate)} />
              <InfoRow label="กำหนดแล้วเสร็จ" value={formatDate(project.expectedEndDate)} />
              {project.actualEndDate && <InfoRow label="แล้วเสร็จจริง" value={formatDate(project.actualEndDate)} />}
              {customerName && <InfoRow label="ลูกค้า" value={customerName} />}
              {robotSerial && <InfoRow label="หุ่นยนต์" value={robotSerial} />}
            </div>
            <div className="card" style={{ padding: '12px 16px' }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>งบประมาณ & ค่าใช้จ่าย</div>
              <InfoRow label="งบประมาณ" value={`฿${formatCurrency(project.budget)}`} />
              <InfoRow label="ค่าใช้จ่ายรวม" value={`฿${formatCurrency(project.totalCost)}`} bold />
              {project.budget > 0 && (
                <div style={{ marginTop: 6 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>
                    ใช้งบแล้ว {project.budget > 0 ? ((project.totalCost / project.budget) * 100).toFixed(1) : 0}%
                  </div>
                  <div style={{ height: 6, background: 'var(--bg-tertiary)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${Math.min(100, project.budget > 0 ? (project.totalCost / project.budget) * 100 : 0)}%`,
                      background: project.totalCost > project.budget ? 'var(--status-danger)' : 'var(--accent-primary)',
                      borderRadius: 3, transition: 'width .3s',
                    }} />
                  </div>
                </div>
              )}
              {project.approvedBy && <InfoRow label="อนุมัติโดย" value={`${project.approvedBy} (${formatDate(project.approvedAt)})`} />}
              {project.createdBy && <InfoRow label="สร้างโดย" value={project.createdBy} />}
            </div>
          </div>

          {project.description && (
            <div className="card" style={{ padding: '12px 16px', marginBottom: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>รายละเอียด/ขอบเขตงาน</div>
              <p style={{ fontSize: 13, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', margin: 0 }}>{project.description}</p>
            </div>
          )}

          {/* Items table */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>รายการ ({project.items.length})</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr style={{ background: 'var(--bg-tertiary)' }}>
                    {['#', 'ประเภท', 'รายการ', 'ผู้จำหน่าย/ช่าง', 'ลิ้งค์สินค้า', 'จำนวน', 'ราคา/หน่วย', 'รวม', 'หมายเหตุ'].map(h => (
                      <th key={h} style={{ padding: '7px 10px', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textAlign: 'left', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {project.items.length === 0 ? (
                    <tr><td colSpan={9} style={{ padding: 24, textAlign: 'center', fontSize: 13, color: 'var(--text-secondary)' }}>ยังไม่มีรายการ</td></tr>
                  ) : project.items.map((item, i) => {
                    const itc = ITEM_TYPE_CONFIG[item.itemType] ?? ITEM_TYPE_CONFIG['Other'];
                    return (
                      <tr key={i} style={{ borderTop: '1px solid var(--border-color)' }}>
                        <td style={{ padding: '7px 10px', fontSize: 12, textAlign: 'center', color: 'var(--text-muted)' }}>{i + 1}</td>
                        <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: itc.color }}>
                            {itc.icon}{itc.label}
                          </span>
                        </td>
                        <td style={{ padding: '7px 10px', fontSize: 13 }}>{item.description}</td>
                        <td style={{ padding: '7px 10px', fontSize: 12, color: 'var(--text-secondary)' }}>
                          {item.vendor && <div>{item.vendor}</div>}
                          {item.link && (
                            <a
                              href={item.link} target="_blank" rel="noopener noreferrer"
                              style={{ fontSize: 11, color: 'var(--accent-primary)' }}
                              onClick={e => e.stopPropagation()}
                            >
                              🔗 ดูสินค้า
                            </a>
                          )}
                          {!item.vendor && !item.link && '-'}
                        </td>
                        <td style={{ padding: '7px 10px', fontSize: 12, textAlign: 'center' }}>{item.quantity} {item.unit}</td>
                        <td style={{ padding: '7px 10px', fontSize: 12, textAlign: 'right' }}>฿{formatCurrency(item.unitPrice)}</td>
                        <td style={{ padding: '7px 10px', fontSize: 13, fontWeight: 600, textAlign: 'right' }}>฿{formatCurrency(item.totalPrice)}</td>
                        <td style={{ padding: '7px 10px', fontSize: 11, color: 'var(--text-muted)' }}>{item.remark || '-'}</td>
                      </tr>
                    );
                  })}
                  {project.items.length > 0 && (
                    <tr style={{ borderTop: '2px solid var(--border-color)', background: 'var(--accent-subtle)' }}>
                      <td colSpan={7} style={{ padding: '8px 10px', textAlign: 'right', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>รวมทั้งสิ้น</td>
                      <td style={{ padding: '8px 10px', fontSize: 15, fontWeight: 700, textAlign: 'right', color: 'var(--accent-primary)' }}>฿{formatCurrency(project.totalCost)}</td>
                      <td />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {project.notes && (
            <div className="card" style={{ padding: '12px 16px' }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>หมายเหตุ</div>
              <p style={{ fontSize: 13, color: 'var(--text-primary)', margin: 0 }}>{project.notes}</p>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border-color)', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {nextStatuses.map(s => {
              const cfg = STATUS_CONFIG[s];
              const isDanger = s === 'Cancelled';
              return (
                <button
                  key={s}
                  type="button"
                  className={`btn ${isDanger ? 'btn-danger' : 'btn-secondary'}`}
                  style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5 }}
                  title={`เปลี่ยนสถานะเป็น ${cfg.label}`}
                  aria-label={`เปลี่ยนสถานะ ${project.docNumber} เป็น ${cfg.label}`}
                  onClick={() => onChangeStatus(s)}
                >
                  {cfg.icon}{cfg.label}
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost" type="button" title={`พิมพ์ ${project.docNumber}`} aria-label={`พิมพ์ ${project.docNumber}`} onClick={onPrint} style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Printer size={14} />พิมพ์
            </button>
            <button className="btn btn-primary" type="button" title={`แก้ไข ${project.docNumber}`} aria-label={`แก้ไข ${project.docNumber}`} onClick={onEdit} style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Edit2 size={14} />แก้ไข
            </button>
          </div>
        </div>
    </Modal>
  );
}

function InfoRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '4px 0', borderBottom: '1px solid var(--border-color)', fontSize: 12 }}>
      <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ color: 'var(--text-primary)', fontWeight: bold ? 700 : 500, textAlign: 'right' }}>{value}</span>
    </div>
  );
}

// ── Form Modal ─────────────────────────────────────────────────────────────────

function FormModal({
  editing,
  onClose,
  onSaved,
  customers,
  robots,
}: {
  editing: ProjectRequest | null;
  onClose: () => void;
  onSaved: () => void;
  customers: { id: string; name: string }[];
  robots: { id: string; serialNumber: string; modelName?: string }[];
}) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const isAdmin = user?.role === 'ADMIN';

  const [form, setForm] = useState({
    docNumber: editing?.docNumber ?? generateDocNumber(),
    title: editing?.title ?? '',
    description: editing?.description ?? '',
    projectType: editing?.projectType ?? 'Both',
    status: editing?.status ?? 'Draft',
    startDate: editing?.startDate ?? today(),
    expectedEndDate: editing?.expectedEndDate ?? '',
    actualEndDate: editing?.actualEndDate ?? '',
    budget: String(editing?.budget ?? ''),
    customerId: editing?.customerId ?? '',
    robotId: editing?.robotId ?? '',
    notes: editing?.notes ?? '',
    approvedBy: editing?.approvedBy ?? '',
  });

  const [items, setItems] = useState<ProjectItem[]>(
    editing?.items?.length
      ? editing.items.map(i => ({ ...i, link: (i as any).link ?? '' }))
      : [{ ...EMPTY_ITEM }]
  );

  const [saving, setSaving] = useState(false);

  const setField = (key: keyof typeof form, value: string) =>
    setForm(p => ({ ...p, [key]: value }));

  // ── Item helpers ──────────────────────────────────────────────────────────
  const addItem = () => setItems(p => [...p, { ...EMPTY_ITEM }]);
  const removeItem = (i: number) => setItems(p => p.filter((_, idx) => idx !== i));
  const updateItem = (i: number, key: keyof ProjectItem, value: string | number) => {
    setItems(p => p.map((item, idx) => {
      if (idx !== i) return item;
      const updated = { ...item, [key]: value };
      if (key === 'quantity' || key === 'unitPrice') {
        updated.totalPrice = Number(updated.quantity) * Number(updated.unitPrice);
      }
      if (key === 'totalPrice') {
        updated.totalPrice = Number(value);
      }
      return updated;
    }));
  };

  const totalCost = items.reduce((s, i) => s + Number(i.totalPrice), 0);

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!form.title.trim() || !form.startDate) {
      showToast('กรุณากรอก ชื่อโปรเจค และ วันที่เริ่มต้น', 'error'); return;
    }
    if (items.some(i => !i.description.trim())) {
      showToast('กรุณากรอกคำอธิบายรายการให้ครบ', 'error'); return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        budget: Number(form.budget) || 0,
        customerId: form.customerId || null,
        robotId: form.robotId || null,
        expectedEndDate: form.expectedEndDate || null,
        actualEndDate: form.actualEndDate || null,
        approvedBy: form.approvedBy || null,
        items: items.map(i => ({
          ...i,
          quantity: Number(i.quantity),
          unitPrice: Number(i.unitPrice),
          totalPrice: Number(i.totalPrice),
        })),
      };
      if (editing) {
        await api.put(`/project-requests/${editing.id}`, payload);
        showToast('บันทึกสำเร็จ', 'success');
      } else {
        await api.post('/project-requests', payload);
        showToast('สร้างใบเปิดโปรเจคสำเร็จ', 'success');
      }
      onSaved();
    } catch (e: any) {
      showToast(e.response?.data?.error || 'บันทึกล้มเหลว', 'error');
    } finally { setSaving(false); }
  };

  return (
    <Modal open={true} onClose={onClose} title={<><Briefcase size={17} style={{ color: 'var(--accent-primary)' }} /> {editing ? 'แก้ไขใบเปิดโปรเจค' : 'สร้างใบเปิดโปรเจค'}</>} width={860} preventClose={saving} describedById="project-request-form-description">

        <p id="project-request-form-description" style={{ marginTop: 0, marginBottom: 16, fontSize: 13, color: 'var(--text-secondary)' }}>
          กรอกข้อมูลโปรเจคภายนอก, ระบุงบประมาณ, ลูกค้า, หุ่นยนต์ และรายการค่าใช้จ่ายที่เกี่ยวข้องก่อนบันทึก
        </p>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {/* Section: ข้อมูลหลัก */}
          <SectionHeader>ข้อมูลหลัก</SectionHeader>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <FormField label="เลขที่เอกสาร *">
              <input className="form-control" value={form.docNumber} onChange={e => setField('docNumber', e.target.value)} />
            </FormField>
            <FormField label="สถานะ">
              <select className="form-control" value={form.status} onChange={e => setField('status', e.target.value)}>
                {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </FormField>
          </div>

          <FormField label="ชื่อโปรเจค *" style={{ marginBottom: 12 }}>
            <input className="form-control" placeholder="เช่น ซ่อมแขนหุ่น BellaBot S/N 1234 - สั่งมอเตอร์จากช่างนอก" value={form.title} onChange={e => setField('title', e.target.value)} />
          </FormField>

          <FormField label="รายละเอียด / ขอบเขตงาน" style={{ marginBottom: 12 }}>
            <textarea className="form-control" rows={3} placeholder="อธิบายงานที่ต้องทำ สาเหตุที่ต้องสั่งนอก หรือเหตุผลการใช้ช่างภายนอก..." value={form.description} onChange={e => setField('description', e.target.value)} style={{ resize: 'vertical', minHeight: 70 }} />
          </FormField>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <FormField label="ประเภทโปรเจค">
              <select className="form-control" value={form.projectType} onChange={e => setField('projectType', e.target.value)}>
                <option value="ExternalParts">สั่งชิ้นส่วนจากภายนอก</option>
                <option value="ExternalLabor">จ้างช่างหรือช่างซ่อมภายนอก</option>
                <option value="Both">ทั้งสองอย่าง</option>
              </select>
            </FormField>
            <FormField label="ลูกค้า (ถ้ามี)">
              <select className="form-control" value={form.customerId} onChange={e => setField('customerId', e.target.value)}>
                <option value="">-- ไม่ระบุ --</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </FormField>
            <FormField label="หุ่นยนต์ (ถ้ามี)">
              <select className="form-control" value={form.robotId} onChange={e => setField('robotId', e.target.value)}>
                <option value="">-- ไม่ระบุ --</option>
                {robots.map(r => <option key={r.id} value={r.id}>{r.serialNumber}</option>)}
              </select>
            </FormField>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <FormField label="วันที่เริ่ม *">
              <ThaiDateInput className="form-control" value={form.startDate} onChange={e => setField('startDate', e.target.value)} />
            </FormField>
            <FormField label="กำหนดแล้วเสร็จ">
              <ThaiDateInput className="form-control" value={form.expectedEndDate} onChange={e => setField('expectedEndDate', e.target.value)} />
            </FormField>
            <FormField label="แล้วเสร็จจริง">
              <ThaiDateInput className="form-control" value={form.actualEndDate} onChange={e => setField('actualEndDate', e.target.value)} />
            </FormField>
            <FormField label="งบประมาณ (฿)">
              <input type="number" className="form-control" min={0} step={100} value={form.budget} onChange={e => setField('budget', e.target.value)} />
            </FormField>
          </div>

          {isAdmin && (
            <FormField label="อนุมัติโดย" style={{ marginBottom: 12 }}>
              <input className="form-control" placeholder="ชื่อผู้อนุมัติ" value={form.approvedBy} onChange={e => setField('approvedBy', e.target.value)} />
            </FormField>
          )}

          <FormField label="หมายเหตุ" style={{ marginBottom: 20 }}>
            <input className="form-control" placeholder="หมายเหตุเพิ่มเติม" value={form.notes} onChange={e => setField('notes', e.target.value)} />
          </FormField>

          {/* Section: รายการ */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <SectionHeader style={{ margin: 0 }}>รายการ (ชิ้นส่วน / ค่าแรง / อื่นๆ)</SectionHeader>
            <button className="btn btn-secondary" onClick={addItem} style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Plus size={14} />เพิ่มรายการ
            </button>
          </div>

          <div style={{ border: '1px solid var(--border-color)', borderRadius: 8, overflow: 'hidden', overflowX: 'auto', marginBottom: 12 }}>
            <table style={{ fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'var(--bg-tertiary)' }}>
                  <th style={{ padding: '7px 8px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', width: 120 }}>ประเภท</th>
                  <th style={{ padding: '7px 8px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>รายการ *</th>
                  <th style={{ padding: '7px 8px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', width: 140 }}>ผู้จำหน่าย/ช่างนอก</th>
                  <th style={{ padding: '7px 8px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', width: 130 }}>ลิ้งค์สินค้า</th>
                  <th style={{ padding: '7px 8px', textAlign: 'center', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', width: 70 }}>จำนวน</th>
                  <th style={{ padding: '7px 8px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', width: 70 }}>หน่วย</th>
                  <th style={{ padding: '7px 8px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', width: 100 }}>ราคา/หน่วย</th>
                  <th style={{ padding: '7px 8px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', width: 100 }}>รวม</th>
                  <th style={{ padding: '7px 8px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', width: 90 }}>หมายเหตุ</th>
                  <th style={{ width: 32 }}></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '5px 8px' }}>
                      <select
                        className="form-control"
                        style={{ fontSize: 11, padding: '3px 6px' }}
                        value={item.itemType}
                        onChange={e => updateItem(i, 'itemType', e.target.value)}
                      >
                        <option value="Part">ชิ้นส่วน/อะไหล่</option>
                        <option value="Labor">ค่าแรง/ช่าง</option>
                        <option value="Other">อื่นๆ</option>
                      </select>
                    </td>
                    <td style={{ padding: '5px 8px' }}>
                      <input
                        className="form-control"
                        style={{ fontSize: 12 }}
                        placeholder="รายละเอียดรายการ"
                        value={item.description}
                        onChange={e => updateItem(i, 'description', e.target.value)}
                      />
                    </td>
                    <td style={{ padding: '5px 8px' }}>
                      <input
                        className="form-control"
                        style={{ fontSize: 12 }}
                        placeholder="บริษัท / ชื่อช่าง"
                        value={item.vendor}
                        onChange={e => updateItem(i, 'vendor', e.target.value)}
                      />
                    </td>
                    <td style={{ padding: '5px 8px' }}>
                      <input
                        type="url"
                        className="form-control"
                        style={{ fontSize: 12 }}
                        placeholder="https://..."
                        value={item.link}
                        onChange={e => updateItem(i, 'link', e.target.value)}
                      />
                    </td>
                    <td style={{ padding: '5px 8px' }}>
                      <input
                        type="number"
                        className="form-control"
                        style={{ fontSize: 12, textAlign: 'center' }}
                        min={0}
                        step={1}
                        value={item.quantity}
                        onChange={e => updateItem(i, 'quantity', Number(e.target.value))}
                      />
                    </td>
                    <td style={{ padding: '5px 8px' }}>
                      <input
                        list={`unit-list-${i}`}
                        className="form-control"
                        style={{ fontSize: 12 }}
                        value={item.unit}
                        onChange={e => updateItem(i, 'unit', e.target.value)}
                      />
                      <datalist id={`unit-list-${i}`}>
                        {['ชิ้น', 'ชม.', 'งาน', 'เซ็ต', 'ครั้ง', 'เมตร', 'กก.'].map(u => (
                          <option key={u} value={u} />
                        ))}
                      </datalist>
                    </td>
                    <td style={{ padding: '5px 8px' }}>
                      <input
                        type="number"
                        className="form-control"
                        style={{ fontSize: 12, textAlign: 'right' }}
                        min={0}
                        step={0.01}
                        value={item.unitPrice}
                        onChange={e => updateItem(i, 'unitPrice', Number(e.target.value))}
                      />
                    </td>
                    <td style={{ padding: '5px 8px' }}>
                      <input
                        type="number"
                        className="form-control"
                        style={{ fontSize: 12, textAlign: 'right', fontWeight: 700, color: 'var(--accent-primary)' }}
                        min={0}
                        step={0.01}
                        value={item.totalPrice}
                        onChange={e => updateItem(i, 'totalPrice', Number(e.target.value))}
                      />
                    </td>
                    <td style={{ padding: '5px 8px' }}>
                      <input
                        className="form-control"
                        style={{ fontSize: 11 }}
                        placeholder="-"
                        value={item.remark}
                        onChange={e => updateItem(i, 'remark', e.target.value)}
                      />
                    </td>
                    <td style={{ padding: '5px 4px', textAlign: 'center' }}>
                      <button
                        className="btn btn-ghost"
                        style={{ padding: '2px 5px', color: 'var(--status-danger)' }}
                        aria-label={`ลบรายการ ${i + 1}`}
                        title={`ลบรายการ ${i + 1}`}
                        onClick={() => removeItem(i)}
                        disabled={items.length === 1}
                      >
                        <X size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: 'var(--accent-subtle)', borderTop: '2px solid var(--border-color)' }}>
                  <td colSpan={7} style={{ padding: '8px 12px', textAlign: 'right', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
                    ยอดรวมทั้งสิ้น
                    {form.budget && Number(form.budget) > 0 && totalCost > Number(form.budget) && (
                      <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--status-danger)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        <AlertCircle size={11} />เกินงบ
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '8px 8px', textAlign: 'right', fontWeight: 800, fontSize: 15, color: 'var(--accent-primary)' }}>
                    ฿{formatCurrency(totalCost)}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border-color)' }}>
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>ยกเลิก</button>
          <FormSubmitButton loading={saving} onClick={handleSave}>
            {editing ? 'บันทึกการแก้ไข' : 'สร้างโปรเจค'}
          </FormSubmitButton>
        </div>
    </Modal>
  );
}

function SectionHeader({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase',
      letterSpacing: 0.8, marginBottom: 10, paddingBottom: 6,
      borderBottom: '1px solid var(--border-color)', ...style,
    }}>
      {children}
    </div>
  );
}

function FormField({ label, children, style }: { label: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={style}>
      {/* label ครอบ control ไว้ = ผูกกันโดยปริยาย คลิกที่ข้อความแล้วโฟกัสช่องกรอก */}
      <label style={{ display: 'block' }}>
        <span style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>{label}</span>
        {children}
      </label>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function ProjectRequests() {
  const { user } = useAuth();
  const confirm = useConfirm();
  const { showToast } = useToast();
  const { customers, robots } = useData();
  const isAdmin = user?.role === 'ADMIN';

  const [projects, setProjects] = useState<ProjectRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useUrlSearch();
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ProjectRequest | null>(null);
  const [viewing, setViewing] = useState<ProjectRequest | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedProjectLogs, setSelectedProjectLogs] = useState<LogEntry[]>([]);
  const [loadingProjectLogs, setLoadingProjectLogs] = useState(false);
  const [completeEvidence, setCompleteEvidence] = useState<ProjectRequest | null>(null);
  const [completeEvidenceFile, setCompleteEvidenceFile] = useState<File | null>(null);
  const [completeEvidenceUploading, setCompleteEvidenceUploading] = useState(false);

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const fetchAll = async () => {
    setLoading(true);
    try {
      const res = await api.get<ProjectRequest[]>('/project-requests');
      setProjects(res.data);
    } catch {
      showToast('โหลดข้อมูลล้มเหลว', 'error');
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchAll(); }, []);

  // ── Filter ─────────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = projects;
    if (filterStatus) list = list.filter(p => p.status === filterStatus);
    if (filterType) list = list.filter(p => p.projectType === filterType);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(p =>
        p.docNumber.toLowerCase().includes(q) ||
        p.title.toLowerCase().includes(q) ||
        p.description?.toLowerCase().includes(q) ||
        p.items.some(i => i.description.toLowerCase().includes(q) || i.vendor?.toLowerCase().includes(q))
      );
    }
    return list;
  }, [projects, filterStatus, filterType, search]);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  useEffect(() => { setPage(1); }, [filterStatus, filterType, search]);
  const sort = useTableSort<ProjectRequest>({
    docNumber: p => p.docNumber,
    title: p => p.title,
    projectType: p => p.projectType,
    status: p => p.status,
    startDate: p => p.startDate,
    expectedEndDate: p => p.expectedEndDate || '',
    budget: p => p.budget,
    totalCost: p => p.totalCost,
    items: p => p.items.length,
  });
  const paginated = sort.apply(filtered).slice((page - 1) * pageSize, page * pageSize);
  const selectedProject = useMemo(
    () => projects.find(project => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId]
  );

  useEffect(() => {
    let ignore = false;

    const fetchProjectLogs = async () => {
      if (!selectedProjectId) {
        setSelectedProjectLogs([]);
        return;
      }
      setLoadingProjectLogs(true);
      try {
        const res = await api.get<LogEntry[]>(`/logs?entityType=ProjectRequest&entityId=${encodeURIComponent(selectedProjectId)}`);
        if (!ignore) setSelectedProjectLogs(res.data);
      } catch {
        if (!ignore) setSelectedProjectLogs([]);
      } finally {
        if (!ignore) setLoadingProjectLogs(false);
      }
    };

    fetchProjectLogs();

    return () => {
      ignore = true;
    };
  }, [selectedProjectId]);

  useEffect(() => {
    if (filtered.length === 0) {
      setSelectedProjectId(null);
      return;
    }
    if (!selectedProjectId || !filtered.some(project => project.id === selectedProjectId)) {
      setSelectedProjectId(filtered[0].id);
    }
  }, [filtered, selectedProjectId]);

  // ── Stats ─────────────────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    total: projects.length,
    pending: projects.filter(p => p.status === 'Pending').length,
    inProgress: projects.filter(p => p.status === 'InProgress').length,
    completed: projects.filter(p => p.status === 'Completed').length,
    totalBudget: projects.filter(p => !['Cancelled'].includes(p.status)).reduce((s, p) => s + p.budget, 0),
    totalCost: projects.filter(p => !['Cancelled'].includes(p.status)).reduce((s, p) => s + p.totalCost, 0),
  }), [projects]);

  const PROJECT_ACTION_LABELS: Record<string, string> = {
    created: 'สร้างใหม่',
    updated: 'ปรับปรุงข้อมูล',
    deleted: 'ลบข้อมูล',
    status_changed: 'เปลี่ยนสถานะ',
    attachment_added: 'เพิ่มไฟล์แนบ',
  };

  const renderProjectActivityDetail = (log: LogEntry) => {
    const oldValues = parseJSON(log.oldValues);
    const newValues = parseJSON(log.newValues);

    if (log.action === 'attachment_added' && typeof newValues?.filename === 'string') {
      return `เพิ่มไฟล์ ${newValues.filename}`;
    }
    if (log.action === 'status_changed' && typeof oldValues?.status === 'string' && typeof newValues?.status === 'string') {
      return `${oldValues.status} -> ${newValues.status}`;
    }
    if (log.action === 'created') {
      return 'เปิดโปรเจคใหม่';
    }
    if (log.action === 'updated') {
      return 'มีการปรับปรุงขอบเขตหรือต้นทุนโครงการ';
    }
    if (log.action === 'deleted') {
      return 'โปรเจคถูกลบออกจากระบบ';
    }
    return null;
  };

  const projectActivityTone = (action: string) => {
    if (action === 'created') return 'success';
    if (action === 'status_changed') return 'warning';
    if (action === 'attachment_added') return 'info';
    if (action === 'deleted') return 'danger';
    return 'neutral';
  };

  // ── Change status ──────────────────────────────────────────────────────────
  const handleChangeStatus = async (project: ProjectRequest, status: string) => {
    if (status === 'Completed') {
      setCompleteEvidence(project);
      setCompleteEvidenceFile(null);
      return;
    }
    const cfg = STATUS_CONFIG[status];
    const ok = await confirm(
      `เปลี่ยนสถานะเป็น "${cfg.label}" — "${project.docNumber}"?`,
      { danger: status === 'Cancelled' }
    );
    if (!ok) return;
    try {
      const now = todayISO();
      const extra: Record<string, string | null> = {};
      if (status === 'Approved') { extra.approvedBy = user?.username ?? null; extra.approvedAt = now; }
      const res = await api.patch(`/project-requests/${project.id}/status`, { status, ...extra });
      showToast('อัพเดทสถานะสำเร็จ', 'success');
      fetchAll();
      if (viewing?.id === project.id) setViewing(res.data);
    } catch (e: any) {
      showToast(e.response?.data?.error || 'ล้มเหลว', 'error');
    }
  };

  const handleCompleteWithEvidence = async () => {
    if (!completeEvidence) return;
    setCompleteEvidenceUploading(true);
    try {
      if (completeEvidenceFile) {
        const fd = new FormData();
        fd.append('file', completeEvidenceFile);
        fd.append('elementType', 'ProjectRequest');
        fd.append('elementId', completeEvidence.id);
        fd.append('attachmentType', 'photo');
        await api.post('/attachments', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      }
      const now = todayISO();
      const res = await api.patch(`/project-requests/${completeEvidence.id}/status`, { status: 'Completed', actualEndDate: now });
      showToast('ปิดโปรเจคสำเร็จ', 'success');
      fetchAll();
      if (viewing?.id === completeEvidence.id) setViewing(res.data);
      setCompleteEvidence(null);
      setCompleteEvidenceFile(null);
    } catch (e: any) {
      showToast(e.response?.data?.error || 'บันทึกล้มเหลว', 'error');
    } finally {
      setCompleteEvidenceUploading(false);
    }
  };

  // ── Delete ─────────────────────────────────────────────────────────────────
  const handleDelete = async (project: ProjectRequest) => {
    const ok = await confirm(`ลบ "${project.docNumber}" — ${project.title}?`, { danger: true });
    if (!ok) return;
    try {
      await api.delete(`/project-requests/${project.id}`);
      showToast('ลบสำเร็จ', 'success');
      setProjects(p => p.filter(x => x.id !== project.id));
      if (viewing?.id === project.id) setViewing(null);
    } catch (e: any) {
      showToast(e.response?.data?.error || 'ลบล้มเหลว', 'error');
    }
  };

  // ── Print ──────────────────────────────────────────────────────────────────
  const handlePrint = (project: ProjectRequest) => {
    const customerName = customers.find(c => c.id === project.customerId)?.name;
    const robotSerial = robots.find(r => r.id === project.robotId)?.serialNumber;
    const statusCfg = STATUS_CONFIG[project.status];
    const typeCfg = TYPE_CONFIG[project.projectType];

    const itemsHtml = project.items.map((item, i) => {
      const itc = ITEM_TYPE_CONFIG[item.itemType] ?? ITEM_TYPE_CONFIG['Other'];
      return `
        <tr>
          <td style="text-align:center">${i + 1}</td>
          <td style="font-size:9pt;color:#6b7280">${itc.label}</td>
          <td>${item.description}</td>
          <td style="color:#6b7280">
            ${item.vendor || '-'}
            ${item.link ? `<br/><a href="${item.link}" style="font-size:9pt;color:var(--status-info)">${item.link}</a>` : ''}
          </td>
          <td style="text-align:center">${item.quantity} ${item.unit}</td>
          <td style="text-align:right">฿${formatCurrency(item.unitPrice)}</td>
          <td style="text-align:right;font-weight:600">฿${formatCurrency(item.totalPrice)}</td>
          <td style="color:#6b7280;font-size:9pt">${item.remark || '-'}</td>
        </tr>`;
    }).join('');

    const overBudget = project.budget > 0 && project.totalCost > project.budget;

    const html = `
      <div class="doc-header">
        ${logoSVG}
        <div class="doc-title-block">
          <div class="doc-type">ใบเปิดโปรเจค</div>
          <div class="doc-meta">
            เลขที่: <strong>${project.docNumber}</strong><br/>
            วันที่เปิด: ${formatDate(project.startDate)}<br/>
            ประเภท: ${typeCfg?.label ?? project.projectType}<br/>
            สถานะ: ${statusCfg?.label ?? project.status}
          </div>
        </div>
      </div>

      <div class="info-grid">
        <div class="info-box">
          <h3>รายละเอียดโปรเจค</h3>
          <p><strong>${project.title}</strong></p>
          ${project.description ? `<p style="font-size:9pt;color:#374151;margin-top:4px">${project.description.replace(/\n/g, '<br/>')}</p>` : ''}
          ${customerName ? `<p style="margin-top:6px">ลูกค้า: <strong>${customerName}</strong></p>` : ''}
          ${robotSerial ? `<p>หุ่นยนต์: <strong>${robotSerial}</strong></p>` : ''}
        </div>
        <div class="info-box">
          <h3>ระยะเวลา & งบประมาณ</h3>
          <p>วันที่เริ่ม: ${formatDate(project.startDate)}</p>
          ${project.expectedEndDate ? `<p>กำหนดแล้วเสร็จ: ${formatDate(project.expectedEndDate)}</p>` : ''}
          ${project.actualEndDate ? `<p>แล้วเสร็จจริง: ${formatDate(project.actualEndDate)}</p>` : ''}
          <p style="margin-top:8px">งบประมาณ: <strong>฿${formatCurrency(project.budget)}</strong></p>
          <p>ค่าใช้จ่ายรวม: <strong${overBudget ? ' style="color:#dc2626"' : ''}>฿${formatCurrency(project.totalCost)}</strong>${overBudget ? ' <span style="color:#dc2626;font-size:9pt">(เกินงบ)</span>' : ''}</p>
          ${project.approvedBy ? `<p style="margin-top:6px">อนุมัติโดย: ${project.approvedBy} (${formatDate(project.approvedAt)})</p>` : ''}
          ${project.notes ? `<p style="margin-top:6px">หมายเหตุ: ${project.notes}</p>` : ''}
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th style="width:35px">#</th>
            <th style="width:90px">ประเภท</th>
            <th>รายการ</th>
            <th>ผู้จำหน่าย/ช่างนอก</th>
            <th style="width:80px;text-align:center">จำนวน</th>
            <th style="width:100px;text-align:right">ราคา/หน่วย</th>
            <th style="width:110px;text-align:right">รวม</th>
            <th>หมายเหตุ</th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>

      <div style="display:flex;justify-content:flex-end;margin-bottom:24px">
        <div style="border:1px solid #e5e7eb;border-radius:6px;padding:12px 20px;min-width:220px">
          ${project.budget > 0 ? `
          <div style="display:flex;justify-content:space-between;gap:32px;font-size:11pt;margin-bottom:6px;color:var(--status-neutral)">
            <span>งบประมาณ</span>
            <span>฿${formatCurrency(project.budget)}</span>
          </div>` : ''}
          <div style="display:flex;justify-content:space-between;gap:32px;font-size:13pt">
            <span>รวมทั้งสิ้น</span>
            <strong style="font-size:15pt${overBudget ? ';color:#dc2626' : ''}">฿${formatCurrency(project.totalCost)}</strong>
          </div>
        </div>
      </div>

      <div class="sig-row" style="grid-template-columns:1fr 1fr 1fr">
        ${['ผู้จัดทำ', 'ผู้อนุมัติ', 'ผู้รับทราบ'].map(label => `
          <div class="sig-box">
            <div class="sig-line"></div>
            <div class="sig-label">${label}</div>
          </div>`).join('')}
      </div>
    `;

    printPDF(html, `PRJ-${project.docNumber}`);
  };

  const openCreate = () => { setEditing(null); setShowForm(true); };
  const openEdit = (p: ProjectRequest) => { setEditing(p); setShowForm(true); };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="page-container">
      {/* Header */}
      <PageHeader
        title="ใบเปิดโปรเจค"
        subtitle="สั่งชิ้นส่วนหรือจ้างช่างภายนอกที่นอกเหนือจากแบรนด์หรือสต็อก"
        meta={<span className="accounts-header-note">พื้นที่ทำงานสไตล์ ERP สำหรับโปรเจค</span>}
      />

      <div className="accounts-workspace card">
        <div className="accounts-workspace-main">
          <div>
            <div className="accounts-workspace-eyebrow">พื้นที่ทำงาน</div>
            <h2 className="accounts-workspace-title">ศูนย์ควบคุมโปรเจค</h2>
            <p className="accounts-workspace-subtitle">มุมทำงานสำหรับโปรเจคงานนอกแบรนด์และงานช่างภายนอก เน้นสถานะการอนุมัติ, งบประมาณ และต้นทุนที่ใช้จริง</p>
          </div>
          <div className="accounts-workspace-actions">
            <button className="btn btn-primary" onClick={openCreate}>
              <Plus size={16} /><span>เปิดโปรเจคใหม่</span>
            </button>
          </div>
        </div>
        <div className="accounts-workspace-pills">
          {[
            { label: 'รอพิจารณา', value: stats.pending, tone: 'warning' },
            { label: 'กำลังดำเนินการ', value: stats.inProgress, tone: 'info' },
            { label: 'เสร็จสิ้น', value: stats.completed, tone: 'success' },
            { label: 'งบประมาณรวม', value: Math.round(stats.totalBudget), tone: 'neutral' },
          ].map((pill) => (
            <div key={pill.label} className={`accounts-pill ${pill.tone}`}>
              <span>{pill.label}</span>
              <strong>{pill.value}</strong>
            </div>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'ทั้งหมด',            value: stats.total,                                 color: 'var(--accent-primary)',  bg: 'var(--accent-subtle)' },
          { label: 'รอพิจารณา',          value: stats.pending,                               color: 'var(--status-warning)',  bg: 'var(--status-warning-bg)' },
          { label: 'กำลังดำเนินการ',     value: stats.inProgress,                            color: 'var(--accent-primary)',  bg: 'var(--accent-subtle)' },
          { label: 'สำเร็จ',             value: stats.completed,                             color: 'var(--status-success)',  bg: 'var(--status-success-bg)' },
          { label: 'งบประมาณรวม',       value: `฿${formatCurrency(stats.totalBudget)}`,    color: 'var(--text-secondary)',  bg: 'var(--bg-tertiary)' },
          { label: 'ค่าใช้จ่ายรวม',     value: `฿${formatCurrency(stats.totalCost)}`,      color: stats.totalCost > stats.totalBudget && stats.totalBudget > 0 ? 'var(--status-danger)' : 'var(--status-success)', bg: stats.totalCost > stats.totalBudget && stats.totalBudget > 0 ? 'var(--status-danger-bg)' : 'var(--status-success-bg)' },
        ].map(({ label, value, color, bg }) => (
          <div key={label} className="stat-card" style={{ padding: '12px 16px' }}>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: typeof value === 'string' && value.length > 10 ? 14 : 20, fontWeight: 700, color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="card" style={{ padding: '12px 16px', marginBottom: 16, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {/* Search */}
        <div style={{ flex: 1, minWidth: 220, position: 'relative', display: 'flex', alignItems: 'center' }}>
          <Search size={15} style={{ position: 'absolute', left: 10, color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input
            className="form-control"
            style={{ paddingLeft: '2rem', paddingRight: '2rem', width: '100%' }}
            placeholder="ค้นหาเลขที่, ชื่อโปรเจค, รายการ..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {!search && <CameraScanButton variant="inline" onScan={setSearch} />}
          {search && (
            <button
              onClick={() => setSearch('')}
              aria-label="ล้างคำค้นหา"
              title="ล้างคำค้นหา"
              style={{ position: 'absolute', right: 8, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Status filter */}
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
          {[{ key: '', label: 'ทุกสถานะ' }, ...Object.entries(STATUS_CONFIG).map(([k, v]) => ({ key: k, label: v.label }))].map(({ key, label }) => {
            const cfg = key ? STATUS_CONFIG[key] : null;
            const isActive = filterStatus === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setFilterStatus(key)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 3,
                  padding: '4px 11px', borderRadius: 999, fontSize: 12, fontWeight: isActive ? 700 : 500,
                  border: `1.5px solid ${isActive && cfg ? cfg.color : 'var(--border-color)'}`,
                  background: isActive && cfg ? cfg.bg : 'transparent',
                  color: isActive && cfg ? cfg.color : 'var(--text-secondary)',
                  cursor: 'pointer',
                }}
              >
                {cfg?.icon}{label}
              </button>
            );
          })}
        </div>

        {/* Type filter */}
        <select
          className="form-control"
          style={{ width: 'auto', fontSize: 12 }}
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
        >
          <option value="">ทุกประเภท</option>
          {Object.entries(TYPE_CONFIG).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="accounts-document-grid">
        <div className="card">
          {loading ? (
            <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)' }}>กำลังโหลด...</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 60, textAlign: 'center' }}>
              <Briefcase size={40} style={{ color: 'var(--text-muted)', marginBottom: 12, opacity: 0.4 }} />
              <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>
                {projects.length === 0 ? 'ยังไม่มีใบเปิดโปรเจค' : 'ไม่พบรายการที่ค้นหา'}
              </div>
              {projects.length === 0 && (
                <button className="btn btn-primary" onClick={openCreate} style={{ marginTop: 14 }}>
                  <Plus size={14} />เปิดโปรเจคแรก
                </button>
              )}
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table>
              <thead>
                <tr style={{ background: 'var(--bg-tertiary)' }}>
                  {([
                    ['เลขที่', 'docNumber'], ['ชื่อโปรเจค', 'title'], ['ประเภท', 'projectType'],
                    ['สถานะ', 'status'], ['วันที่เริ่ม', 'startDate'], ['กำหนดเสร็จ', 'expectedEndDate'],
                    ['งบ', 'budget'], ['ค่าใช้จ่าย', 'totalCost'], ['รายการ', 'items'], ['', ''],
                  ] as const).map(([label, key]) => {
                    const thStyle = {
                      padding: '9px 12px', fontSize: 11, fontWeight: 600,
                      color: 'var(--text-secondary)', textAlign: 'left' as const, whiteSpace: 'nowrap' as const,
                      borderBottom: '1px solid var(--border-color)',
                    };
                    return key
                      ? <SortableTh key={label} {...sort.th(key)} style={thStyle}>{label}</SortableTh>
                      : <th key={label} style={thStyle}>{label}</th>;
                  })}
                </tr>
              </thead>
              <tbody>
                {paginated.map(project => {
                  const isOverBudget = project.budget > 0 && project.totalCost > project.budget;
                  return (
                    <tr
                      key={project.id}
                      className={selectedProjectId === project.id ? 'accounts-row-selected' : ''}
                      style={{ borderBottom: '1px solid var(--border-color)', cursor: 'pointer', transition: 'background .12s' }}
                      onClick={() => setSelectedProjectId(project.id)}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--accent-subtle)')}
                      onMouseLeave={e => (e.currentTarget.style.background = '')}
                    >
                      <td style={{ padding: '10px 12px', fontVariantNumeric: 'tabular-nums', fontWeight: 700, fontSize: 12, color: 'var(--accent-primary)', whiteSpace: 'nowrap' }}>
                        <button className="accounts-row-link" type="button" title={`เปิดสรุป ${project.docNumber}`} aria-label={`เปิดสรุป ${project.docNumber}`} onClick={() => setSelectedProjectId(project.id)}>{project.docNumber}</button>
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: 13, maxWidth: 240 }}>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.title}</div>
                        {project.description && <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>{project.description}</div>}
                      </td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        <TypeBadge type={project.projectType} />
                      </td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        <StatusBadge status={project.status} />
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{formatDate(project.startDate)}</td>
                      <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                        {project.expectedEndDate ? formatDate(project.expectedEndDate) : '-'}
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: 12, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {project.budget > 0 ? `฿${formatCurrency(project.budget)}` : '-'}
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: 12, textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap', color: isOverBudget ? 'var(--status-danger)' : 'var(--text-primary)' }}>
                        ฿{formatCurrency(project.totalCost)}
                        {isOverBudget && <AlertCircle size={12} style={{ marginLeft: 3, verticalAlign: 'middle' }} />}
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: 12, textAlign: 'center', color: 'var(--text-muted)' }}>
                        {project.items.length}
                      </td>
                      <td style={{ padding: '10px 8px' }} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', gap: 3, justifyContent: 'flex-end' }}>
                          <button className="btn btn-ghost" title="ดูรายละเอียด" aria-label={`ดูรายละเอียด ${project.docNumber}`} style={{ padding: '4px 7px' }} onClick={() => setViewing(project)}>
                            <Eye size={14} />
                          </button>
                          <button className="btn btn-ghost" title="แก้ไข" aria-label={`แก้ไข ${project.docNumber}`} style={{ padding: '4px 7px' }} onClick={() => { setEditing(project); setShowForm(true); }}>
                            <Edit2 size={14} />
                          </button>
                          <button className="btn btn-ghost" title="พิมพ์" aria-label={`พิมพ์ ${project.docNumber}`} style={{ padding: '4px 7px' }} onClick={() => handlePrint(project)}>
                            <Printer size={14} />
                          </button>
                          {isAdmin && (
                            <button className="btn btn-ghost" title="ลบ" aria-label={`ลบ ${project.docNumber}`} style={{ padding: '4px 7px', color: 'var(--status-danger)' }} onClick={() => handleDelete(project)}>
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
              <Pagination page={page} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
            </div>
          )}
        </div>

        <div className="card accounts-document-panel">
          {selectedProject ? (
            <>
              <div className="accounts-document-panel-head">
                <div>
                  <div className="accounts-document-kicker">แผงข้อมูลโปรเจค</div>
                  <div className="accounts-document-title">{selectedProject.docNumber}</div>
                  <div className="accounts-document-meta">{selectedProject.title} · เริ่ม {formatDate(selectedProject.startDate)}</div>
                </div>
                <StatusBadge status={selectedProject.status} />
              </div>

              <div className="accounts-panel-actions">
                <button className="btn btn-outline" type="button" title={`ดูรายละเอียด ${selectedProject.docNumber}`} aria-label={`ดูรายละเอียด ${selectedProject.docNumber}`} onClick={() => setViewing(selectedProject)}><Eye size={14} /> ดูเต็ม</button>
                <button className="btn btn-outline" type="button" title={`พิมพ์ ${selectedProject.docNumber}`} aria-label={`พิมพ์ ${selectedProject.docNumber}`} onClick={() => handlePrint(selectedProject)}><Printer size={14} /> พิมพ์</button>
                <button className="btn btn-outline" type="button" title={`แก้ไข ${selectedProject.docNumber}`} aria-label={`แก้ไข ${selectedProject.docNumber}`} onClick={() => openEdit(selectedProject)}><Edit2 size={14} /> แก้ไข</button>
                {selectedProject.status !== 'Completed' && selectedProject.status !== 'Cancelled' && (
                  <button className="btn btn-primary" type="button" title={`เดินสถานะ ${selectedProject.docNumber} ต่อ`} aria-label={`เดินสถานะ ${selectedProject.docNumber} ต่อ`} onClick={() => handleChangeStatus(selectedProject, selectedProject.status === 'Draft' ? 'Pending' : selectedProject.status === 'Pending' ? 'Approved' : selectedProject.status === 'Approved' ? 'InProgress' : 'Completed')}>
                    <Send size={14} /> เดินสถานะต่อ
                  </button>
                )}
              </div>

              {(() => {
                const statusCfg = STATUS_CONFIG[selectedProject.status] ?? STATUS_CONFIG.Draft;
                return (
                  <div style={{ marginBottom: 16, padding: '12px 14px', borderRadius: 12, border: `1px solid ${statusCfg.border}`, background: statusCfg.bg }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, color: statusCfg.color, fontSize: 12, fontWeight: 700 }}>
                      {statusCfg.icon}
                      <span>สถานะปัจจุบัน: {statusCfg.label}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{getProjectStatusNarrative(selectedProject)}</div>
                  </div>
                );
              })()}

              <div className="accounts-info-stack">
                <div className="accounts-info-block">
                  <span>ประเภทโปรเจค</span>
                  <strong>{TYPE_CONFIG[selectedProject.projectType]?.label || selectedProject.projectType}</strong>
                </div>
                <div className="accounts-info-block">
                  <span>ค่าใช้จ่ายรวม</span>
                  <strong>฿{formatCurrency(selectedProject.totalCost)}</strong>
                </div>
                <div className="accounts-info-block">
                  <span>งบประมาณ</span>
                  <strong>{selectedProject.budget > 0 ? `฿${formatCurrency(selectedProject.budget)}` : 'ไม่ได้ตั้งงบ'}</strong>
                </div>
                <div className="accounts-info-block">
                  <span>จำนวนรายการ</span>
                  <strong>{selectedProject.items.length}</strong>
                </div>
              </div>

              <div className="accounts-totals-box">
                <div><span>อนุมัติโดย</span><strong>{selectedProject.approvedBy || '-'}</strong></div>
                <div><span>กำหนดแล้วเสร็จ</span><strong>{formatDate(selectedProject.expectedEndDate)}</strong></div>
                <div><span>แล้วเสร็จจริง</span><strong>{formatDate(selectedProject.actualEndDate)}</strong></div>
                <div className="accent"><span>สัดส่วนการใช้งบ</span><strong>{selectedProject.budget > 0 ? `${((selectedProject.totalCost / selectedProject.budget) * 100).toFixed(1)}%` : 'ไม่มีข้อมูล'}</strong></div>
              </div>

              <div className="accounts-side-section">
                <div className="accounts-side-section-title">ภาพรวมขอบเขตงาน</div>
                <div className="accounts-empty-note">{selectedProject.description || 'ยังไม่ได้ระบุรายละเอียดโปรเจค'}</div>
              </div>

              <div className="accounts-side-section">
                <div className="accounts-side-section-title">รายการค่าใช้จ่าย</div>
                <div className="accounts-line-list">
                  {selectedProject.items.slice(0, 5).map((item, idx) => (
                    <div key={`${selectedProject.id}-${idx}`} className="accounts-line-item compact">
                      <div>
                        <strong>{item.description}</strong>
                        <span>{ITEM_TYPE_CONFIG[item.itemType]?.label || item.itemType}{item.vendor ? ` · ${item.vendor}` : ''}</span>
                      </div>
                      <strong>฿{formatCurrency(item.totalPrice)}</strong>
                    </div>
                  ))}
                  {selectedProject.items.length > 5 && <div className="accounts-empty-note">และอีก {selectedProject.items.length - 5} รายการ</div>}
                </div>
              </div>

              <div className="accounts-side-section">
                <div className="accounts-side-section-title">ความเคลื่อนไหว</div>
                {loadingProjectLogs ? (
                  <div className="accounts-empty-note">กำลังโหลดประวัติโปรเจค...</div>
                ) : selectedProjectLogs.length > 0 ? (
                  <div className="accounts-line-list">
                    {selectedProjectLogs.slice(0, 6).map(log => {
                      const detail = renderProjectActivityDetail(log);
                      return (
                        <div key={log.id} className={`accounts-activity-item tone-${projectActivityTone(log.action)}`}>
                          <div className="accounts-activity-topline">
                            <strong>{PROJECT_ACTION_LABELS[log.action] ?? log.action.replace(/_/g, ' ')}</strong>
                            <span>{formatDateTime(log.performedAt)}</span>
                          </div>
                          {detail && <div className="accounts-activity-detail">{detail}</div>}
                          <div className="accounts-activity-meta">โดย {log.performedBy || 'ระบบ'}</div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="accounts-empty-note">ยังไม่มีความเคลื่อนไหวสำหรับโปรเจคนี้</div>
                )}
              </div>

              <div className="accounts-side-section">
                <div className="accounts-side-section-title">เอกสารแนบ</div>
                <AttachmentPanel elementType="ProjectRequest" elementId={selectedProject.id} />
              </div>
            </>
          ) : (
            <div className="accounts-panel-empty">
              <Briefcase size={42} style={{ color: 'var(--text-muted)' }} />
              <div>
                <strong>เลือกโปรเจคจากรายการ</strong>
                <p>แผงนี้สรุปสถานะ, งบประมาณ, ค่าใช้จ่าย และรายการหลักของโปรเจคในมุมมองเดียว</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* View Modal */}
      {viewing && (
        <ViewModal
          project={viewing}
          customers={customers}
          robots={robots}
          isAdmin={isAdmin}
          onClose={() => setViewing(null)}
          onEdit={() => { setEditing(viewing); setShowForm(true); setViewing(null); }}
          onPrint={() => handlePrint(viewing)}
          onChangeStatus={status => handleChangeStatus(viewing, status)}
        />
      )}

      {/* Form Modal */}
      {showForm && (
        <FormModal
          editing={editing}
          customers={customers}
          robots={robots}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); fetchAll(); }}
        />
      )}

      {/* Complete Evidence Modal */}
      {completeEvidence && (
        <Modal open={true} onClose={() => setCompleteEvidence(null)} title={<><CheckCircle size={18} color="var(--status-success)" /> ยืนยันเสร็จสิ้นโปรเจค</>} width={420} preventClose={completeEvidenceUploading} describedById="project-request-complete-description">
            <p id="project-request-complete-description" style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginBottom: '1rem', marginTop: 0 }}>
              <strong>{completeEvidence.docNumber}</strong> — {completeEvidence.title}<br />
              กรุณาอัปโหลด<strong>ไฟล์หลักฐาน</strong> (รูปภาพ หรือ PDF) ก่อนปิดโปรเจค
            </p>
            <div style={{ marginBottom: '1rem' }}>
              <label className="form-label" htmlFor="projectrequests-file">ไฟล์หลักฐาน <span style={{ color: 'var(--status-danger)' }}>*</span></label>
              <input id="projectrequests-file"
                type="file"
                className="form-control"
                accept="image/*,.pdf"
                disabled={completeEvidenceUploading}
                onChange={e => setCompleteEvidenceFile(e.target.files?.[0] || null)}
              />
              {!completeEvidenceFile && (
                <div style={{ marginTop: 6, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  ℹ️ แนะนำให้แนบไฟล์หลักฐาน แต่สามารถข้ามได้
                </div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-color)' }}>
              <button type="button" className="btn btn-outline" onClick={() => setCompleteEvidence(null)} disabled={completeEvidenceUploading}>
                ยกเลิก
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleCompleteWithEvidence}
                disabled={completeEvidenceUploading}
                style={{ background: !completeEvidenceUploading ? 'var(--status-success)' : undefined, borderColor: !completeEvidenceUploading ? 'var(--status-success)' : undefined }}
              >
                <CheckCircle size={14} />
                {completeEvidenceUploading ? 'กำลังบันทึก...' : 'ยืนยันเสร็จสิ้น'}
              </button>
            </div>
        </Modal>
      )}
    </div>
  );
}
