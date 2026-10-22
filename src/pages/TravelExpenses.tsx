import React, { useState, useEffect, useMemo } from 'react';
import {
  Plus, Search, Eye, X, Printer, Edit2, Trash2,
  PlusCircle, MinusCircle, MapPin, FileText, CheckCircle,
  Clock, XCircle, DollarSign, Paperclip,
} from 'lucide-react';
import api from '../api';
import { useData } from '../context/DataContext';
import { printPDF, logoSVG } from '../utils/printPDF';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../context/ConfirmContext';
import { ThaiDateInput } from '../components/ThaiDateInput';
import { useToast } from '../context/ToastContext';
import PageHeader from '../components/PageHeader';
import CameraScanButton from '../components/CameraScanButton';
import Pagination from '../components/Pagination';
import { TableSkeleton, EmptyState, Modal, FormSubmitButton, useUrlSearch, useTableSort, SortableTh } from '../components/UIUtils';
import { formatThaiDate } from '../utils/thaiDate';
import AttachmentPanel from '../components/AttachmentPanel';

// ── Types ────────────────────────────────────────────────────────────────────

interface ExpenseItem {
  id?: string;
  itemType: 'advance' | 'reimbursed';
  description: string;
  amount: number;
  receiptNo?: string;
  remark?: string;
}

interface TravelExpenseClaim {
  id: string;
  docNumber: string;
  claimDate: string;
  province: string;
  destination?: string;
  purpose: string;
  staffName: string;
  staffDept?: string;
  travelDateFrom: string;
  travelDateTo: string;
  status: string;
  totalAdvance: number;
  totalReimbursed: number;
  notes?: string;
  customerId?: string | null;
  maVisitId?: string | null;
  ticketId?: string | null;
  createdAt: string;
  createdBy?: string;
  approvedBy?: string;
  approvedAt?: string;
  items: ExpenseItem[];
}


const statusMeta: Record<string, { label: string; color: string; bg: string; border: string; icon: React.ReactNode }> = {
  Draft:     { label: 'ร่าง',        color: 'var(--status-neutral)', bg: 'var(--surface-soft)', border: '#d1d5db', icon: <FileText size={12} /> },
  Submitted: { label: 'ยื่นแล้ว',    color: '#b45309', bg: 'var(--status-warning-bg)', border: 'var(--status-warning)', icon: <Clock size={12} /> },
  Approved:  { label: 'อนุมัติแล้ว', color: '#15803d', bg: 'var(--status-success-bg)', border: 'var(--status-success)', icon: <CheckCircle size={12} /> },
  Paid:      { label: 'จ่ายแล้ว',    color: '#1d4ed8', bg: '#eff6ff', border: 'var(--status-info)', icon: <DollarSign size={12} /> },
  Cancelled: { label: 'ยกเลิก',      color: '#9ca3af', bg: '#f3f4f6', border: 'var(--border-color)', icon: <XCircle size={12} /> },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return formatThaiDate(iso);
}

function formatCurrency(n: number) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function today() {
  return new Date().toISOString().split('T')[0];
}

// ── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const meta = statusMeta[status] ?? { label: status, color: 'var(--status-neutral)', bg: 'var(--surface-soft)', border: '#d1d5db', icon: null };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 10px', borderRadius: 9999, fontSize: 12, fontWeight: 600,
      color: meta.color, background: meta.bg, border: `1px solid ${meta.border}`,
    }}>
      {meta.icon}{meta.label}
    </span>
  );
}

// ── Empty item factory ────────────────────────────────────────────────────────

interface LinkVisit { id: string; visitNumber: number; scheduledDate: string; status: string; plan?: { customer?: { id: string; name: string } } }

const blankLinks = { customerId: '', maVisitId: '', ticketId: '' };

function newItem(type: 'advance' | 'reimbursed'): ExpenseItem {
  return { itemType: type, description: '', amount: 0, receiptNo: '', remark: '' };
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function TravelExpenses() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const isAdmin = user?.role === 'ADMIN';
  const { tickets, robots, customers } = useData();

  const [claims, setClaims] = useState<TravelExpenseClaim[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useUrlSearch();
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<TravelExpenseClaim | null>(null);
  const [viewingClaim, setViewingClaim] = useState<TravelExpenseClaim | null>(null);
  const [attachClaim, setAttachClaim] = useState<TravelExpenseClaim | null>(null);

  // form state
  const [form, setForm] = useState({
    claimDate: today(),
    province: '',
    destination: '',
    purpose: '',
    staffName: '',
    staffDept: '',
    travelDateFrom: today(),
    travelDateTo: today(),
    notes: '',
  });
  const [advanceItems, setAdvanceItems] = useState<ExpenseItem[]>([newItem('advance')]);
  const [reimbursedItems, setReimbursedItems] = useState<ExpenseItem[]>([newItem('reimbursed')]);
  const [saving, setSaving] = useState(false);
  // The job this trip was for. Picking one fills customer, place, purpose and dates.
  const [links, setLinks] = useState(blankLinks);
  const [linkVisits, setLinkVisits] = useState<LinkVisit[]>([]);

  useEffect(() => {
    if (!modalOpen) return;
    const shift = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); };
    api.get('/ma-visits', { params: { from: shift(-120), to: shift(60) } })
      .then(r => setLinkVisits(r.data))
      .catch(() => setLinkVisits([]));
  }, [modalOpen]);

  const customerName = (id?: string | null) => customers.find(c => c.id === id)?.name ?? '';
  const robotSN = (id: string) => robots.find(r => r.id === id)?.serialNumber ?? '';
  const linkTickets = useMemo(
    () => [...tickets].sort((a, b) => b.reportDate.localeCompare(a.reportDate)).slice(0, 200),
    [tickets],
  );

  // Province comes from the customer's site when it has exactly one province on record.
  const fillProvinceFromCustomer = async (customerId: string) => {
    try {
      const { data } = await api.get(`/customers/${customerId}/sites`);
      const provinces = [...new Set((data as { province?: string | null }[]).map(s => s.province).filter(Boolean))] as string[];
      if (provinces.length === 1) setForm(p => (p.province ? p : { ...p, province: provinces[0] }));
    } catch { /* leave province for the user */ }
  };

  const pickVisit = (id: string) => {
    const visit = linkVisits.find(v => v.id === id);
    const customerId = visit?.plan?.customer?.id ?? '';
    setLinks({ maVisitId: id, ticketId: '', customerId: customerId || links.customerId });
    if (!visit) return;
    const name = visit.plan?.customer?.name ?? '';
    setForm(p => ({
      ...p,
      destination: p.destination || name,
      purpose: p.purpose || `เข้า MA รอบที่ ${visit.visitNumber} · ${name}`,
      travelDateFrom: visit.scheduledDate,
      travelDateTo: p.travelDateTo < visit.scheduledDate || p.travelDateTo === today() ? visit.scheduledDate : p.travelDateTo,
    }));
    if (customerId) void fillProvinceFromCustomer(customerId);
  };

  const pickTicket = (id: string) => {
    const ticket = tickets.find(t => t.id === id);
    const customerId = ticket?.customerId || robots.find(r => r.id === ticket?.robotId)?.customerId || '';
    setLinks({ ticketId: id, maVisitId: '', customerId: customerId || links.customerId });
    if (!ticket) return;
    const name = customerName(customerId);
    setForm(p => ({
      ...p,
      destination: p.destination || name,
      purpose: p.purpose || `ซ่อมหุ่นยนต์ ${robotSN(ticket.robotId)}${name ? ` · ${name}` : ''}`,
    }));
    if (customerId) void fillProvinceFromCustomer(customerId);
  };

  // ── Fetch ────────────────────────────────────────────────────────────────

  const fetchClaims = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/travel-expenses');
      setClaims(data); setLoadError(false);
    } catch { setLoadError(true); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchClaims(); }, []);

  // ── Filter ────────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    let list = claims;
    if (statusFilter) list = list.filter(c => c.status === statusFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        c.docNumber.toLowerCase().includes(q) ||
        c.staffName.toLowerCase().includes(q) ||
        c.province.toLowerCase().includes(q) ||
        c.purpose.toLowerCase().includes(q),
      );
    }
    return list;
  }, [claims, search, statusFilter]);

  const sort = useTableSort<typeof filtered[0]>({
    docNumber: c => c.docNumber,
    claimDate: c => c.claimDate,
    staffName: c => c.staffName,
    destination: c => `${c.province}${c.destination ? ' ' + c.destination : ''}`,
    travelDate: c => c.travelDateFrom,
    totalAdvance: c => c.totalAdvance,
    totalReimbursed: c => c.totalReimbursed,
    status: c => c.status,
  });
  const pageData = sort.apply(filtered).slice((page - 1) * pageSize, page * pageSize);

  // ── Modal helpers ─────────────────────────────────────────────────────────

  function openCreate() {
    setEditing(null);
    setForm({ claimDate: today(), province: '', destination: '', purpose: '', staffName: '', staffDept: '', travelDateFrom: today(), travelDateTo: today(), notes: '' });
    setAdvanceItems([newItem('advance')]);
    setReimbursedItems([newItem('reimbursed')]);
    setLinks(blankLinks);
    setModalOpen(true);
  }

  function openEdit(c: TravelExpenseClaim) {
    setLinks({ customerId: c.customerId || '', maVisitId: c.maVisitId || '', ticketId: c.ticketId || '' });
    setEditing(c);
    setForm({
      claimDate: c.claimDate,
      province: c.province,
      destination: c.destination || '',
      purpose: c.purpose,
      staffName: c.staffName,
      staffDept: c.staffDept || '',
      travelDateFrom: c.travelDateFrom,
      travelDateTo: c.travelDateTo,
      notes: c.notes || '',
    });
    const adv = c.items.filter(i => i.itemType === 'advance');
    const rei = c.items.filter(i => i.itemType === 'reimbursed');
    setAdvanceItems(adv.length > 0 ? adv : [newItem('advance')]);
    setReimbursedItems(rei.length > 0 ? rei : [newItem('reimbursed')]);
    setModalOpen(true);
  }

  function closeModal() { setModalOpen(false); setEditing(null); }

  // ── Item editors ─────────────────────────────────────────────────────────

  function updateAdvanceItem(idx: number, field: keyof ExpenseItem, value: string | number) {
    setAdvanceItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  }

  function updateReimbursedItem(idx: number, field: keyof ExpenseItem, value: string | number) {
    setReimbursedItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  }

  const incompleteRow = (item: ExpenseItem) => !!(item.description.trim() || Number(item.amount) !== 0 || item.receiptNo?.trim() || item.remark?.trim()) && (!item.description.trim() || !Number.isFinite(Number(item.amount)) || Number(item.amount) <= 0);
  const totalAdvance = advanceItems.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const totalReimbursed = reimbursedItems.reduce((s, i) => s + (Number(i.amount) || 0), 0);

  // ── Save ─────────────────────────────────────────────────────────────────

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.staffName || !form.purpose || !form.province || !form.claimDate || !form.travelDateFrom || !form.travelDateTo) {
      showToast('กรุณากรอกข้อมูลที่จำเป็นให้ครบถ้วน', 'error');
      return;
    }
    const incomplete: string[] = [];
    const checkRows = (items: ExpenseItem[], label: string) => items.forEach((item, i) => {
      const hasContent = item.description.trim() || Number(item.amount) !== 0 || item.receiptNo?.trim() || item.remark?.trim();
      if (hasContent && (!item.description.trim() || !Number.isFinite(Number(item.amount)) || Number(item.amount) <= 0)) incomplete.push(label + ' แถว ' + (i + 1));
    });
    checkRows(advanceItems, 'สำรองจ่าย'); checkRows(reimbursedItems, 'เบิกแล้ว');
    if (incomplete.length) { showToast('กรุณากรอกรายละเอียดและยอดเงินมากกว่า 0: ' + incomplete.join(', '), 'error'); return; }
    const validAdv = advanceItems.filter(i => i.description.trim() && Number(i.amount) > 0);
    const validRei = reimbursedItems.filter(i => i.description.trim() && Number(i.amount) > 0);
    const allItems = [...validAdv, ...validRei];

    setSaving(true);
    try {
      const payload = { ...form, ...links, items: allItems };
      if (editing) {
        await api.put(`/travel-expenses/${editing.id}`, payload);
        showToast('แก้ไขใบเบิกสำเร็จ', 'success');
      } else {
        await api.post('/travel-expenses', payload);
        showToast('สร้างใบเบิกสำเร็จ', 'success');
      }
      await fetchClaims();
      closeModal();
    } catch { showToast('บันทึกไม่สำเร็จ', 'error'); }
    finally { setSaving(false); }
  };

  // ── Status change ────────────────────────────────────────────────────────

  const handleStatusChange = async (claim: TravelExpenseClaim, status: string) => {
    if (statusBusy) return;
    if (['Cancelled', 'Rejected'].includes(status) && !await confirm('ยืนยันการยกเลิก / ปฏิเสธ ' + claim.docNumber + '?', { title: 'ยืนยันการเปลี่ยนสถานะ', danger: true, confirmLabel: 'ยืนยัน' })) return;
    setStatusBusy(true);
    try {
      await api.patch(`/travel-expenses/${claim.id}/status`, { status });
      showToast(`อัปเดตสถานะเป็น "${statusMeta[status]?.label ?? status}"`, 'success');
      await fetchClaims();
      if (viewingClaim?.id === claim.id) {
        setViewingClaim(prev => prev ? { ...prev, status } : prev);
      }
    } catch { showToast('อัปเดตสถานะไม่สำเร็จ', 'error'); }
  };

  // ── Delete ────────────────────────────────────────────────────────────────

  const handleDelete = async (claim: TravelExpenseClaim) => {
    const ok = await confirm(`ลบ ${claim.docNumber}?`, { title: 'ยืนยันการลบ', danger: true, confirmLabel: 'ลบ' });
    if (!ok) return;
    try {
      await api.delete(`/travel-expenses/${claim.id}`);
      showToast('ลบเรียบร้อย', 'success');
      await fetchClaims();
      if (viewingClaim?.id === claim.id) setViewingClaim(null);
    } catch { showToast('ลบไม่สำเร็จ', 'error'); }
  };

  // ── Print ─────────────────────────────────────────────────────────────────

  const handlePrint = (claim: TravelExpenseClaim) => {
    const advItems = claim.items.filter(i => i.itemType === 'advance');
    const reiItems = claim.items.filter(i => i.itemType === 'reimbursed');

    const advRows = advItems.map(i => `
      <tr>
        <td>${i.description}</td>
        <td>${i.receiptNo || '-'}</td>
        <td style="text-align:right">฿${formatCurrency(i.amount)}</td>
        <td>${i.remark || '-'}</td>
      </tr>`).join('');

    const reiRows = reiItems.map(i => `
      <tr>
        <td>${i.description}</td>
        <td>${i.receiptNo || '-'}</td>
        <td style="text-align:right">฿${formatCurrency(i.amount)}</td>
        <td>${i.remark || '-'}</td>
      </tr>`).join('');

    const html = `
      <div style="max-width:800px;margin:auto;padding:24px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px">
          <div>${logoSVG}</div>
          <div style="text-align:right">
            <div style="font-size:22px;font-weight:700">ใบเบิกค่าออกต่างจังหวัด</div>
            <div style="font-size:14px;color:#666">${claim.docNumber}</div>
            <div style="font-size:12px;color:#888">วันที่: ${formatDate(claim.claimDate)}</div>
          </div>
        </div>
        <table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:13px">
          <tr><td style="padding:4px 8px;width:50%"><strong>ชื่อผู้เบิก:</strong> ${claim.staffName}</td>
              <td style="padding:4px 8px"><strong>แผนก:</strong> ${claim.staffDept || '-'}</td></tr>
          <tr><td style="padding:4px 8px"><strong>จังหวัด:</strong> ${claim.province}</td>
              <td style="padding:4px 8px"><strong>สถานที่:</strong> ${claim.destination || '-'}</td></tr>
          <tr><td style="padding:4px 8px"><strong>วัตถุประสงค์:</strong> ${claim.purpose}</td>
              <td style="padding:4px 8px"><strong>วันที่เดินทาง:</strong> ${formatDate(claim.travelDateFrom)} – ${formatDate(claim.travelDateTo)}</td></tr>
        </table>

        <div style="font-weight:700;font-size:14px;margin:16px 0 8px;background:#f3f4f6;padding:6px 8px;border-radius:4px">
          รายการที่สำรองจ่าย
        </div>
        ${advItems.length > 0 ? `
        <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:12px">
          <thead><tr style="background:var(--surface-soft)">
            <th style="border:1px solid var(--border-color);padding:6px 8px;text-align:left">รายการ</th>
            <th style="border:1px solid var(--border-color);padding:6px 8px">เลขที่ใบเสร็จ</th>
            <th style="border:1px solid var(--border-color);padding:6px 8px;text-align:right">จำนวนเงิน</th>
            <th style="border:1px solid var(--border-color);padding:6px 8px">หมายเหตุ</th>
          </tr></thead>
          <tbody>${advRows}</tbody>
          <tfoot><tr style="background:#fef9c3">
            <td colspan="2" style="border:1px solid var(--border-color);padding:6px 8px;font-weight:700">รวม</td>
            <td style="border:1px solid var(--border-color);padding:6px 8px;text-align:right;font-weight:700">฿${formatCurrency(claim.totalAdvance)}</td>
            <td style="border:1px solid var(--border-color)"></td>
          </tr></tfoot>
        </table>` : '<p style="color:#9ca3af;font-size:12px;margin-left:8px">ไม่มีรายการ</p>'}

        <div style="font-weight:700;font-size:14px;margin:16px 0 8px;background:#f3f4f6;padding:6px 8px;border-radius:4px">
          รายการที่เบิกจ่ายไปแล้ว
        </div>
        ${reiItems.length > 0 ? `
        <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:12px">
          <thead><tr style="background:var(--surface-soft)">
            <th style="border:1px solid var(--border-color);padding:6px 8px;text-align:left">รายการ</th>
            <th style="border:1px solid var(--border-color);padding:6px 8px">เลขที่ใบเสร็จ</th>
            <th style="border:1px solid var(--border-color);padding:6px 8px;text-align:right">จำนวนเงิน</th>
            <th style="border:1px solid var(--border-color);padding:6px 8px">หมายเหตุ</th>
          </tr></thead>
          <tbody>${reiRows}</tbody>
          <tfoot><tr style="background:var(--status-info-bg)">
            <td colspan="2" style="border:1px solid var(--border-color);padding:6px 8px;font-weight:700">รวม</td>
            <td style="border:1px solid var(--border-color);padding:6px 8px;text-align:right;font-weight:700">฿${formatCurrency(claim.totalReimbursed)}</td>
            <td style="border:1px solid var(--border-color)"></td>
          </tr></tfoot>
        </table>` : '<p style="color:#9ca3af;font-size:12px;margin-left:8px">ไม่มีรายการ</p>'}

        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:16px">
          <tr style="background:#fef2f2">
            <td style="border:1px solid #fca5a5;padding:8px 12px;font-weight:700">รวมสำรองจ่าย</td>
            <td style="border:1px solid #fca5a5;padding:8px 12px;text-align:right;font-weight:700">฿${formatCurrency(claim.totalAdvance)}</td>
          </tr>
          <tr style="background:#eff6ff">
            <td style="border:1px solid #93c5fd;padding:8px 12px;font-weight:700">รวมที่เบิกจ่ายไปแล้ว</td>
            <td style="border:1px solid #93c5fd;padding:8px 12px;text-align:right;font-weight:700">฿${formatCurrency(claim.totalReimbursed)}</td>
          </tr>
        </table>

        ${claim.notes ? `<div style="margin-top:16px;padding:10px;background:var(--surface-soft);border-radius:4px;font-size:12px"><strong>หมายเหตุ:</strong> ${claim.notes}</div>` : ''}

        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:32px;margin-top:40px;text-align:center;font-size:12px">
          <div>
            <div style="border-top:1px solid #374151;padding-top:8px;margin-top:32px">ผู้ขอเบิก</div>
            <div style="color:#6b7280">${claim.staffName}</div>
          </div>
          <div>
            <div style="border-top:1px solid #374151;padding-top:8px;margin-top:32px">ผู้ตรวจสอบ</div>
          </div>
          <div>
            <div style="border-top:1px solid #374151;padding-top:8px;margin-top:32px">ผู้อนุมัติ</div>
            <div style="color:#6b7280">${claim.approvedBy || ''}</div>
          </div>
        </div>
      </div>`;

    printPDF(html, `ใบเบิก-${claim.docNumber}`);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const S = {
    sectionBox: {
      border: '1px solid var(--border-color)',
      borderRadius: 10,
      overflow: 'hidden',
      marginTop: 16,
    } as React.CSSProperties,
    sectionHead: (accent?: string) => ({
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '8px 14px',
      background: accent || 'var(--bg-tertiary)',
      borderBottom: '1px solid var(--border-color)',
      fontSize: 13,
      fontWeight: 700,
      color: accent ? '#1d4ed8' : 'var(--text-primary)',
    } as React.CSSProperties),
    sectionTotal: {
      fontSize: 13,
      fontWeight: 700,
      color: 'var(--accent-primary)',
    } as React.CSSProperties,
    itemsHeader: {
      padding: '6px 10px',
      background: 'var(--bg-secondary)',
      borderBottom: '1px solid var(--border-color)',
      fontSize: 11,
      fontWeight: 600,
      color: 'var(--text-secondary)',
    } as React.CSSProperties,
    itemRow: {
      padding: '6px 10px',
      borderBottom: '1px solid var(--border-color)',
    } as React.CSSProperties,
    infoGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
      gap: 10,
      margin: '12px 0',
    } as React.CSSProperties,
    infoBlock: {
      display: 'flex',
      flexDirection: 'column' as const,
      gap: 2,
      padding: '8px 12px',
      background: 'var(--bg-tertiary)',
      borderRadius: 8,
    } as React.CSSProperties,
  };

  return (
    <div className="page-container">
      {/* Header */}
      {loadError && <div role="alert" className="card" style={{ color: 'var(--status-danger)', marginBottom: '1rem' }}>โหลดไม่สำเร็จ <button className="btn btn-outline" disabled={loading} onClick={fetchClaims}>ลองใหม่</button></div>}
      <PageHeader
        title="ใบเบิกค่าออกต่างจังหวัด"
        subtitle="บันทึกค่าใช้จ่ายการเดินทางต่างจังหวัด"
        actions={(
          <button className="btn btn-primary" onClick={openCreate}>
            <Plus size={16} /> สร้างใบเบิก
          </button>
        )}
      />

      {/* Filters */}
      <div className="card responsive-toolbar" style={{ padding: '10px 14px', marginBottom: 16 }}>
        <div className="responsive-toolbar-search" style={{ display: 'flex', alignItems: 'center' }}>
          <Search size={15} style={{ position: 'absolute', left: 10, color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input aria-label="ค้นหาเลขที่เอกสาร, ชื่อ, จังหวัด..."
            className="form-control"
            style={{ paddingLeft: '2rem', paddingRight: '2rem', width: '100%' }}
            placeholder="ค้นหาเลขที่เอกสาร, ชื่อ, จังหวัด..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
          />
          {!search && <CameraScanButton variant="inline" onScan={v => { setSearch(v); setPage(1); }} />}
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
        <div className="responsive-toolbar-filters">
          {[{ key: '', label: 'ทั้งหมด' }, ...Object.entries(statusMeta).map(([k, v]) => ({ key: k, label: v.label }))].map(({ key, label }) => {
            const meta = statusMeta[key];
            const active = statusFilter === key;
            return (
              <button key={key} type="button"
                onClick={() => { setStatusFilter(key); setPage(1); }}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '5px 12px', borderRadius: 999, fontSize: 12, fontWeight: active ? 700 : 500,
                  border: `1.5px solid ${active ? (meta?.color || 'var(--accent-primary)') : 'var(--border-color)'}`,
                  background: active ? (meta?.bg || 'var(--accent-subtle)') : 'transparent',
                  color: active ? (meta?.color || 'var(--accent-primary)') : 'var(--text-secondary)',
                  cursor: 'pointer', transition: 'all .15s',
                }}
              >
                {meta?.icon}{label}
              </button>
            );
          })}
        </div>
        <span className="responsive-toolbar-meta">{loadError && claims.length === 0 ? '—' : filtered.length} รายการ</span>
      </div>

      {/* Table */}
      {loading ? (
        <TableSkeleton cols={9} />
      ) : loadError && claims.length === 0 ? null : filtered.length === 0 ? (
        <EmptyState
          icon={<MapPin size={40} />}
          title="ยังไม่มีใบเบิกค่าออกต่างจังหวัด"
          description="กดปุ่ม 'สร้างใบเบิก' เพื่อเพิ่มรายการใหม่"
        />
      ) : (
        <>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <SortableTh {...sort.th('docNumber')}>เลขที่เอกสาร</SortableTh>
                  <SortableTh {...sort.th('claimDate')}>วันที่</SortableTh>
                  <SortableTh {...sort.th('staffName')}>ผู้เบิก</SortableTh>
                  <SortableTh {...sort.th('destination')}>จังหวัด / วัตถุประสงค์</SortableTh>
                  <SortableTh {...sort.th('travelDate')}>วันที่เดินทาง</SortableTh>
                  <SortableTh {...sort.th('totalAdvance')} style={{ textAlign: 'right' }}>สำรองจ่าย</SortableTh>
                  <SortableTh {...sort.th('totalReimbursed')} style={{ textAlign: 'right' }}>เบิกแล้ว</SortableTh>
                  <SortableTh {...sort.th('status')}>สถานะ</SortableTh>
                  <th style={{ textAlign: 'center' }}>จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {pageData.map(claim => (
                  <tr key={claim.id}>
                    <td>
                      <button onClick={() => setViewingClaim(claim)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, color: 'var(--accent-primary)', fontSize: 13 }}>
                        {claim.docNumber}
                      </button>
                    </td>
                    <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{formatDate(claim.claimDate)}</td>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{claim.staffName}</div>
                      {claim.staffDept && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{claim.staffDept}</div>}
                    </td>
                    <td>
                      <div style={{ fontWeight: 500, fontSize: 13 }}>{claim.province}{claim.destination ? ` · ${claim.destination}` : ''}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{claim.purpose}</div>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{formatDate(claim.travelDateFrom)} – {formatDate(claim.travelDateTo)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600, fontSize: 13 }}>฿{formatCurrency(claim.totalAdvance)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600, fontSize: 13, color: 'var(--status-info)' }}>฿{formatCurrency(claim.totalReimbursed)}</td>
                    <td><StatusBadge status={claim.status} /></td>
                    <td>
                      <div className="responsive-table-actions" style={{ justifyContent: 'center' }}>
                        <button className="btn btn-ghost" style={{ padding: '4px 8px' }} aria-label={`ดูรายละเอียด ${claim.docNumber}`} title="ดูรายละเอียด" onClick={() => setViewingClaim(claim)}><Eye size={14} /></button>
                        <button className="btn btn-ghost" style={{ padding: '4px 8px' }} aria-label={`พิมพ์ ${claim.docNumber}`} title="พิมพ์" onClick={() => handlePrint(claim)}><Printer size={14} /></button>
                        <button className="btn btn-ghost" style={{ padding: '4px 8px' }} aria-label={`แนบใบเสร็จ ${claim.docNumber}`} title="แนบใบเสร็จ / รูปภาพ" onClick={() => setAttachClaim(claim)}><Paperclip size={14} /></button>
                        {(claim.status === 'Draft' || claim.status === 'Submitted') && (
                          <button className="btn btn-ghost" style={{ padding: '4px 8px' }} aria-label={`แก้ไข ${claim.docNumber}`} title="แก้ไข" onClick={() => openEdit(claim)}><Edit2 size={14} /></button>
                        )}
                        {isAdmin && (
                          <button className="btn btn-ghost" style={{ padding: '4px 8px', color: 'var(--status-danger)' }} aria-label={`ลบ ${claim.docNumber}`} title="ลบ" disabled={statusBusy} onClick={() => handleDelete(claim)}><Trash2 size={14} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={size => { setPageSize(size); setPage(1); }} />
        </>
      )}

      {/* ── Create / Edit Modal ─────────────────────────────────────────────── */}
      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editing ? `แก้ไข ${editing.docNumber}` : 'สร้างใบเบิกค่าออกต่างจังหวัด'}
        width={860}
        describedById="travel-expense-form-description"
      >
        <form onSubmit={handleSave}>
          <p id="travel-expense-form-description" style={{ marginTop: 0, marginBottom: 16, fontSize: 13, color: 'var(--text-secondary)' }}>
            กรอกข้อมูลผู้เดินทาง, ช่วงเวลาเดินทาง, ค่าใช้จ่ายสำรองจ่ายและค่าใช้จ่ายที่เบิกแล้ว ก่อนบันทึกใบเบิก
          </p>
          {/* Linked job */}
          <div className="responsive-form-grid-2" style={{ gap: '10px 16px', marginBottom: 12, padding: 10, borderRadius: 8, background: 'var(--surface-soft)' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" htmlFor="travelexpenses-maVisit">งาน MA ที่เดินทางไป</label>
              <select id="travelexpenses-maVisit" className="form-control" value={links.maVisitId} onChange={e => pickVisit(e.target.value)}>
                <option value="">— ไม่ผูก —</option>
                {links.maVisitId && !linkVisits.some(v => v.id === links.maVisitId) && <option value={links.maVisitId}>(รอบ MA ที่ผูกไว้)</option>}
                {linkVisits.map(v => (
                  <option key={v.id} value={v.id}>{v.scheduledDate} · {v.plan?.customer?.name ?? '-'} · รอบที่ {v.visitNumber}</option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" htmlFor="travelexpenses-ticket">หรือ Ticket ซ่อม</label>
              <select id="travelexpenses-ticket" className="form-control" value={links.ticketId} onChange={e => pickTicket(e.target.value)}>
                <option value="">— ไม่ผูก —</option>
                {links.ticketId && !linkTickets.some(t => t.id === links.ticketId) && <option value={links.ticketId}>(Ticket ที่ผูกไว้)</option>}
                {linkTickets.map(t => (
                  <option key={t.id} value={t.id}>{t.reportDate} · {robotSN(t.robotId)} · {customerName(t.customerId) || '-'} · {t.issueDescription.split('\n')[0].slice(0, 40)}</option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ gridColumn: '1 / -1', marginBottom: 0 }}>
              <label className="form-label" htmlFor="travelexpenses-customer">ลูกค้า</label>
              <select id="travelexpenses-customer" className="form-control" value={links.customerId} onChange={e => setLinks(l => ({ ...l, customerId: e.target.value }))}>
                <option value="">— ไม่ระบุ —</option>
                {[...customers].sort((a, b) => a.name.localeCompare(b.name)).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>
          {/* Header fields */}
          <div className="responsive-form-grid-2" style={{ gap: '10px 16px' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" htmlFor="travelexpenses-staffName">ชื่อผู้เบิก <span style={{ color: 'var(--status-danger)' }}>*</span></label>
              <input id="travelexpenses-staffName" className="form-control" value={form.staffName} onChange={e => setForm(p => ({ ...p, staffName: e.target.value }))} placeholder="ชื่อ-นามสกุล" required />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" htmlFor="travelexpenses-staffDept">แผนก</label>
              <input id="travelexpenses-staffDept" className="form-control" value={form.staffDept} onChange={e => setForm(p => ({ ...p, staffDept: e.target.value }))} placeholder="ชื่อแผนก" />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" htmlFor="travelexpenses-province">จังหวัดปลายทาง <span style={{ color: 'var(--status-danger)' }}>*</span></label>
              <input id="travelexpenses-province" className="form-control" value={form.province} onChange={e => setForm(p => ({ ...p, province: e.target.value }))} placeholder="เช่น เชียงใหม่" required />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" htmlFor="travelexpenses-destination">สถานที่ (ระบุเพิ่มเติม)</label>
              <input id="travelexpenses-destination" className="form-control" value={form.destination} onChange={e => setForm(p => ({ ...p, destination: e.target.value }))} placeholder="เช่น โรงแรม / ลูกค้า" />
            </div>
            <div className="form-group" style={{ gridColumn: '1 / -1', marginBottom: 0 }}>
              <label className="form-label" htmlFor="travelexpenses-purpose">วัตถุประสงค์ <span style={{ color: 'var(--status-danger)' }}>*</span></label>
              <input id="travelexpenses-purpose" className="form-control" value={form.purpose} onChange={e => setForm(p => ({ ...p, purpose: e.target.value }))} placeholder="เช่น ซ่อมบำรุงหุ่นยนต์ลูกค้า" required />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" htmlFor="travelexpenses-travelDateFrom">วันที่เดินทางออก <span style={{ color: 'var(--status-danger)' }}>*</span></label>
              <ThaiDateInput id="travelexpenses-travelDateFrom" className="form-control" value={form.travelDateFrom} onChange={e => setForm(p => ({ ...p, travelDateFrom: e.target.value }))} required />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" htmlFor="travelexpenses-travelDateTo">วันที่เดินทางกลับ <span style={{ color: 'var(--status-danger)' }}>*</span></label>
              <ThaiDateInput id="travelexpenses-travelDateTo" className="form-control" value={form.travelDateTo} onChange={e => setForm(p => ({ ...p, travelDateTo: e.target.value }))} required />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" htmlFor="travelexpenses-claimDate">วันที่ยื่นใบเบิก <span style={{ color: 'var(--status-danger)' }}>*</span></label>
              <ThaiDateInput id="travelexpenses-claimDate" className="form-control" value={form.claimDate} onChange={e => setForm(p => ({ ...p, claimDate: e.target.value }))} required />
            </div>
          </div>

          {/* Section 1: สำรองจ่าย */}
          <div style={S.sectionBox}>
            <div style={S.sectionHead()}>
              <span>รายการที่สำรองจ่าย</span>
              <span style={S.sectionTotal}>รวม ฿{formatCurrency(totalAdvance)}</span>
            </div>
            <div className="responsive-entry-grid" style={S.itemsHeader}>
              <span>รายการ</span><span>เลขที่ใบเสร็จ</span><span style={{ textAlign: 'right' }}>จำนวนเงิน (฿)</span><span>หมายเหตุ</span><span />
            </div>
            {advanceItems.map((item, idx) => (
              <div key={idx} className="responsive-entry-grid" style={{ ...S.itemRow, border: incompleteRow(item) ? '1px solid var(--status-danger)' : undefined }}>
                <input aria-label="รายการค่าใช้จ่าย" className="form-control" style={{ fontSize: 13 }} placeholder="รายการค่าใช้จ่าย" value={item.description} onChange={e => updateAdvanceItem(idx, 'description', e.target.value)} />
                <input aria-label="เลขที่ใบเสร็จ" className="form-control" style={{ fontSize: 13 }} placeholder="เลขที่ใบเสร็จ" value={item.receiptNo || ''} onChange={e => updateAdvanceItem(idx, 'receiptNo', e.target.value)} />
                <input aria-label="0.00" type="number" min="0" step="0.01" className="form-control" style={{ fontSize: 13, textAlign: 'right' }} placeholder="0.00" value={item.amount || ''} onChange={e => updateAdvanceItem(idx, 'amount', parseFloat(e.target.value) || 0)} />
                <input aria-label="หมายเหตุ" className="form-control" style={{ fontSize: 13 }} placeholder="หมายเหตุ" value={item.remark || ''} onChange={e => updateAdvanceItem(idx, 'remark', e.target.value)} />
                <button type="button" className="btn btn-ghost" style={{ padding: '4px 6px', color: 'var(--status-danger)' }} aria-label={`ลบรายการสำรองจ่าย ${idx + 1}`} title={`ลบรายการสำรองจ่าย ${idx + 1}`} onClick={() => setAdvanceItems(prev => prev.filter((_, i) => i !== idx))} disabled={advanceItems.length === 1}>
                  <MinusCircle size={15} />
                </button>
              </div>
            ))}
            <div style={{ padding: '8px 10px' }}>
              <button type="button" className="btn btn-outline" style={{ fontSize: 12, padding: '4px 12px' }} onClick={() => setAdvanceItems(prev => [...prev, newItem('advance')])}>
                <PlusCircle size={13} /> เพิ่มรายการ
              </button>
            </div>
          </div>

          {/* Section 2: เบิกจ่ายไปแล้ว */}
          <div style={S.sectionBox}>
            <div style={S.sectionHead('#eff6ff')}>
              <span>รายการที่เบิกจ่ายไปแล้ว</span>
              <span style={{ ...S.sectionTotal, color: '#1d4ed8' }}>รวม ฿{formatCurrency(totalReimbursed)}</span>
            </div>
            <div className="responsive-entry-grid" style={S.itemsHeader}>
              <span>รายการ</span><span>เลขที่ใบเสร็จ</span><span style={{ textAlign: 'right' }}>จำนวนเงิน (฿)</span><span>หมายเหตุ</span><span />
            </div>
            {reimbursedItems.map((item, idx) => (
              <div key={idx} className="responsive-entry-grid" style={{ ...S.itemRow, border: incompleteRow(item) ? '1px solid var(--status-danger)' : undefined }}>
                <input aria-label="รายการค่าใช้จ่าย" className="form-control" style={{ fontSize: 13 }} placeholder="รายการค่าใช้จ่าย" value={item.description} onChange={e => updateReimbursedItem(idx, 'description', e.target.value)} />
                <input aria-label="เลขที่ใบเสร็จ" className="form-control" style={{ fontSize: 13 }} placeholder="เลขที่ใบเสร็จ" value={item.receiptNo || ''} onChange={e => updateReimbursedItem(idx, 'receiptNo', e.target.value)} />
                <input aria-label="0.00" type="number" min="0" step="0.01" className="form-control" style={{ fontSize: 13, textAlign: 'right' }} placeholder="0.00" value={item.amount || ''} onChange={e => updateReimbursedItem(idx, 'amount', parseFloat(e.target.value) || 0)} />
                <input aria-label="หมายเหตุ" className="form-control" style={{ fontSize: 13 }} placeholder="หมายเหตุ" value={item.remark || ''} onChange={e => updateReimbursedItem(idx, 'remark', e.target.value)} />
                <button type="button" className="btn btn-ghost" style={{ padding: '4px 6px', color: 'var(--status-danger)' }} aria-label={`ลบรายการเบิกแล้ว ${idx + 1}`} title={`ลบรายการเบิกแล้ว ${idx + 1}`} onClick={() => setReimbursedItems(prev => prev.filter((_, i) => i !== idx))} disabled={reimbursedItems.length === 1}>
                  <MinusCircle size={15} />
                </button>
              </div>
            ))}
            <div style={{ padding: '8px 10px' }}>
              <button type="button" className="btn btn-outline" style={{ fontSize: 12, padding: '4px 12px' }} onClick={() => setReimbursedItems(prev => [...prev, newItem('reimbursed')])}>
                <PlusCircle size={13} /> เพิ่มรายการ
              </button>
            </div>
          </div>

          {/* Notes */}
          <div className="form-group" style={{ marginTop: 12 }}>
            <label className="form-label" htmlFor="travelexpenses-notes">หมายเหตุ</label>
            <textarea id="travelexpenses-notes" className="form-control" rows={2} value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
          </div>

          {/* Summary bar */}
          <div className="responsive-summary-bar" style={{ gap: 16, padding: '10px 0 4px', borderTop: '1px solid var(--border-color)', fontSize: 14 }}>
            <span style={{ color: 'var(--text-secondary)' }}>สำรองจ่าย: <strong style={{ color: 'var(--accent-primary)' }}>฿{formatCurrency(totalAdvance)}</strong></span>
            <span style={{ color: 'var(--border-color)' }}>|</span>
            <span style={{ color: 'var(--text-secondary)' }}>เบิกแล้ว: <strong style={{ color: 'var(--status-info)' }}>฿{formatCurrency(totalReimbursed)}</strong></span>
          </div>

          <div className="responsive-action-group" style={{ justifyContent: 'flex-end', paddingTop: 8 }}>
            <button type="button" className="btn btn-outline" onClick={closeModal}>ยกเลิก</button>
            <FormSubmitButton loading={saving}>{editing ? 'บันทึกการแก้ไข' : 'สร้างใบเบิก'}</FormSubmitButton>
          </div>
        </form>
      </Modal>

      {/* ── View Detail Modal ─────────────────────────────────────────────────── */}
      {viewingClaim && (
        <Modal open={!!viewingClaim} onClose={() => setViewingClaim(null)} title={`รายละเอียด ${viewingClaim.docNumber}`} width={860} describedById="travel-expense-view-description">
          <div id="travel-expense-view-description" style={{ marginBottom: 12, fontSize: 13, color: 'var(--text-secondary)' }}>
            สรุปรายละเอียดการเดินทาง, รายการค่าใช้จ่าย, สถานะอนุมัติ และยอดรวมของ {viewingClaim.docNumber}
          </div>
          {/* Top actions */}
          <div className="responsive-modal-top" style={{ marginBottom: 16 }}>
            <StatusBadge status={viewingClaim.status} />
            <div className="responsive-action-group">
              <button className="btn btn-ghost" style={{ padding: '5px 12px', fontSize: 13 }} onClick={() => handlePrint(viewingClaim)}><Printer size={14} /> พิมพ์</button>
              {viewingClaim.status === 'Draft' && (
                <button className="btn btn-primary" style={{ fontSize: 13 }} disabled={statusBusy} onClick={() => handleStatusChange(viewingClaim, 'Submitted')}>ยื่นขออนุมัติ</button>
              )}
              {viewingClaim.status === 'Submitted' && isAdmin && (
                <button className="btn btn-primary" style={{ fontSize: 13 }} disabled={statusBusy} onClick={() => handleStatusChange(viewingClaim, 'Approved')}>อนุมัติ</button>
              )}
              {viewingClaim.status === 'Approved' && isAdmin && (
                <button className="btn btn-primary" style={{ fontSize: 13 }} disabled={statusBusy} onClick={() => handleStatusChange(viewingClaim, 'Paid')}>บันทึกจ่ายแล้ว</button>
              )}
              {!['Paid', 'Cancelled'].includes(viewingClaim.status) && isAdmin && (
                <button className="btn btn-outline" style={{ fontSize: 13, color: 'var(--status-danger)', borderColor: 'var(--status-danger)' }} disabled={statusBusy} onClick={() => handleStatusChange(viewingClaim, 'Cancelled')}>ยกเลิก</button>
              )}
            </div>
          </div>

          {/* Info grid */}
          <div style={S.infoGrid}>
            {[
              ['ผู้เบิก', viewingClaim.staffName],
              ['แผนก', viewingClaim.staffDept || '-'],
              ['จังหวัด', viewingClaim.province],
              ['สถานที่', viewingClaim.destination || '-'],
              ['วัตถุประสงค์', viewingClaim.purpose],
              ['วันที่เดินทาง', `${formatDate(viewingClaim.travelDateFrom)} – ${formatDate(viewingClaim.travelDateTo)}`],
              ['วันที่ยื่น', formatDate(viewingClaim.claimDate)],
              ...(viewingClaim.approvedBy ? [['อนุมัติโดย', viewingClaim.approvedBy]] : []),
            ].map(([label, value]) => (
              <div key={label} style={S.infoBlock}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>{label}</span>
                <strong style={{ fontSize: 13 }}>{value}</strong>
              </div>
            ))}
          </div>

          {/* Advance items table */}
          <div style={S.sectionBox}>
            <div style={S.sectionHead()}>
              <span>รายการที่สำรองจ่าย</span>
              <span style={S.sectionTotal}>฿{formatCurrency(viewingClaim.totalAdvance)}</span>
            </div>
            {viewingClaim.items.filter(i => i.itemType === 'advance').length > 0 ? (
              <table style={{ fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-tertiary)' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>รายการ</th>
                    <th style={{ padding: '8px 12px', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>ใบเสร็จ</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>จำนวนเงิน</th>
                    <th style={{ padding: '8px 12px', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>หมายเหตุ</th>
                  </tr>
                </thead>
                <tbody>
                  {viewingClaim.items.filter(i => i.itemType === 'advance').map((item, idx) => (
                    <tr key={idx} style={{ borderTop: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '9px 12px' }}>{item.description}</td>
                      <td style={{ padding: '9px 12px', color: 'var(--text-muted)', fontSize: 12 }}>{item.receiptNo || '-'}</td>
                      <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 600 }}>฿{formatCurrency(item.amount)}</td>
                      <td style={{ padding: '9px 12px', color: 'var(--text-muted)', fontSize: 12 }}>{item.remark || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div style={{ padding: '14px 12px', fontSize: 13, color: 'var(--text-muted)' }}>ไม่มีรายการ</div>
            )}
          </div>

          {/* Reimbursed items table */}
          <div style={S.sectionBox}>
            <div style={S.sectionHead('#eff6ff')}>
              <span>รายการที่เบิกจ่ายไปแล้ว</span>
              <span style={{ ...S.sectionTotal, color: '#1d4ed8' }}>฿{formatCurrency(viewingClaim.totalReimbursed)}</span>
            </div>
            {viewingClaim.items.filter(i => i.itemType === 'reimbursed').length > 0 ? (
              <table style={{ fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-tertiary)' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>รายการ</th>
                    <th style={{ padding: '8px 12px', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>ใบเสร็จ</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>จำนวนเงิน</th>
                    <th style={{ padding: '8px 12px', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>หมายเหตุ</th>
                  </tr>
                </thead>
                <tbody>
                  {viewingClaim.items.filter(i => i.itemType === 'reimbursed').map((item, idx) => (
                    <tr key={idx} style={{ borderTop: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '9px 12px' }}>{item.description}</td>
                      <td style={{ padding: '9px 12px', color: 'var(--text-muted)', fontSize: 12 }}>{item.receiptNo || '-'}</td>
                      <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 600, color: 'var(--status-info)' }}>฿{formatCurrency(item.amount)}</td>
                      <td style={{ padding: '9px 12px', color: 'var(--text-muted)', fontSize: 12 }}>{item.remark || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div style={{ padding: '14px 12px', fontSize: 13, color: 'var(--text-muted)' }}>ไม่มีรายการ</div>
            )}
          </div>

          {viewingClaim.notes && (
            <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--bg-tertiary)', borderRadius: 8, fontSize: 13 }}>
              <strong>หมายเหตุ:</strong> {viewingClaim.notes}
            </div>
          )}

          {/* Totals */}
          <div className="responsive-metric-pills" style={{ marginTop: 16 }}>
            <div style={{ padding: '12px 20px', background: 'var(--accent-subtle)', borderRadius: 10, border: '1px solid var(--border-color)', textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 2 }}>สำรองจ่ายรวม</div>
              <strong style={{ fontSize: 16, color: 'var(--accent-primary)' }}>฿{formatCurrency(viewingClaim.totalAdvance)}</strong>
            </div>
            <div style={{ padding: '12px 20px', background: 'var(--status-info-bg)', borderRadius: 10, border: '1px solid var(--border-color)', textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 2 }}>เบิกแล้วรวม</div>
              <strong style={{ fontSize: 16, color: 'var(--status-info)' }}>฿{formatCurrency(viewingClaim.totalReimbursed)}</strong>
            </div>
          </div>

          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: 'var(--text-secondary)' }}>
              ใบเสร็จ / เอกสารแนบ
            </div>
            <AttachmentPanel elementType="TravelExpenseClaim" elementId={viewingClaim.id} />
          </div>
        </Modal>
      )}

      <Modal open={!!attachClaim} onClose={() => setAttachClaim(null)} title={<>ใบเสร็จ / เอกสารแนบ — {attachClaim?.docNumber}</>} width={560} describedById="travel-expense-attachment-description">
        <p id="travel-expense-attachment-description" style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 0, marginBottom: '1rem' }}>
          แนบรูปถ่ายบิล ใบเสร็จ หรือสลิปค่าใช้จ่าย รองรับทั้งรูปภาพและ PDF
        </p>
        {attachClaim && <AttachmentPanel elementType="TravelExpenseClaim" elementId={attachClaim.id} />}
      </Modal>
    </div>
  );
}
