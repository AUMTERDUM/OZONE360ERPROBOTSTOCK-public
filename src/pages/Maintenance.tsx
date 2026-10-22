import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useData, useSpareParts, type MaintenanceTicket } from '../context/DataContext';
import { useConfirm } from '../context/ConfirmContext';
import { useToast } from '../context/ToastContext';
import { Printer, Plus, CheckCircle, Edit2, Trash2, Search, Bot, ChevronDown, X, PackageMinus, Link2, Copy, History, Download, DollarSign } from 'lucide-react';
import api from '../api';
import { usePolling } from '../lib/usePolling';
import { printPDF, logoSVG } from '../utils/printPDF';
import { ThaiDateInput } from '../components/ThaiDateInput';
import Pagination from '../components/Pagination';
import { TableSkeleton, EmptyState, TicketStatusBadge, RobotStatusBadge, RefreshButton, useEscapeKey, Modal, FormSubmitButton, useUrlSearch, useTableSort, SortableTh, useOpenFromUrl } from '../components/UIUtils';
import { useAuth } from '../context/AuthContext';
import { TICKET_TRANSITIONS } from '../utils/ticketTransitions';
import PageHeader from '../components/PageHeader';
import CameraScanButton from '../components/CameraScanButton';
import AttachmentPanel from '../components/AttachmentPanel';
import ZoomableImage from '../components/ZoomableImage';
import { formatTicketNo } from '../utils/displayText';
import { formatThaiDateTime, todayISO } from '../utils/thaiDate';
import { priorityLabels } from '../utils/statusLabels';

// The ticket workflow only allows Completed from In Progress / Ready to Ship, so closing a ticket that
// is still Pending or waiting for a quotation has to pass through In Progress first.
const COMPLETE_STEPS: Record<string, MaintenanceTicket['status'][]> = {
  'Pending': ['In Progress', 'Completed'],
  'Waiting Quotation': ['In Progress', 'Completed'],
};

interface SparePart { id: string; sku: string; name: string; stock: number; unitPrice: number; }
interface UsedPartRow { sparePartId: string; quantity: number; note: string; }
interface MaintenanceSchedule {
  id: string;
  title: string;
  robotId: string;
  customerId?: string | null;
  frequencyDays: number;
  leadDays: number;
  nextDueDate: string;
  lastGeneratedAt?: string | null;
  lastCompletedAt?: string | null;
  assignedTo?: string | null;
  priorityLevel?: string | null;
  notes?: string | null;
  active: boolean;
}

interface SparePartComboboxProps { spareParts: SparePart[]; value: string; onChange: (id: string) => void; }
const SparePartCombobox: React.FC<SparePartComboboxProps> = ({ spareParts, value, onChange }) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const selected = spareParts.find(sp => sp.id === value);
  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return spareParts.filter(sp => sp.name.toLowerCase().includes(q) || sp.sku.toLowerCase().includes(q)).slice(0, 10);
  }, [spareParts, query]);
  return (
    <div style={{ position: 'relative', flex: 2, minWidth: 0 }}>
      <input aria-label="ค้นหาอะไหล่..."
        className="form-control"
        style={{ width: '100%', paddingRight: '2rem' }}
        placeholder="ค้นหาอะไหล่..."
        value={open ? query : (selected ? selected.name : '')}
        onFocus={() => { setOpen(true); setQuery(''); }}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        onChange={e => setQuery(e.target.value)}
      />
      {!(open ? query : selected) && <CameraScanButton variant="inline" onScan={value => { setQuery(value); setOpen(true); }} />}
      {open && filtered.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 1000,
          background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 6,
          maxHeight: 220, overflowY: 'auto', boxShadow: '0 4px 16px rgba(0,0,0,0.15)'
        }}>
          {filtered.map(sp => (
            <div
              key={sp.id}
              role="option"
              aria-selected={sp.id === value}
              tabIndex={0}
              onMouseDown={() => { onChange(sp.id); setOpen(false); setQuery(''); }}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChange(sp.id); setOpen(false); setQuery(''); } }}
              style={{
                padding: '0.45rem 0.75rem', cursor: 'pointer',
                borderBottom: '1px solid var(--border-color)',
                background: sp.id === value ? 'var(--accent-subtle)' : 'var(--bg-card)',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-secondary)')}
              onMouseLeave={e => (e.currentTarget.style.background = sp.id === value ? 'var(--accent-subtle)' : 'var(--bg-card)')}
            >
              <div style={{ fontWeight: 500, fontSize: '0.84rem' }}>{sp.name}</div>
              <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>
                SKU: {sp.sku}&nbsp;&nbsp;|&nbsp;&nbsp;คงเหลือ:&nbsp;
                <span style={{ fontWeight: 600, color: sp.stock <= 0 ? 'var(--status-danger)' : 'var(--status-success)' }}>{sp.stock}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const Maintenance: React.FC = () => {
  const { tickets, robots, customers, models, loading, fetchData, updateTicket, deleteTicket, updateTicketStatus } = useData();
  const confirm = useConfirm();
  const { showToast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTicket, setEditingTicket] = useState<MaintenanceTicket | null>(null);
  const [uploading, setUploading] = useState(false);
  // Locks the whole save (upload + ticket + parts), not just the upload, so it can't be sent twice.
  const [submitting, setSubmitting] = useState(false);
  // null = not loaded yet / new ticket, false = load failed (saving must not replace the parts).
  const [usedPartsLoaded, setUsedPartsLoaded] = useState<boolean | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [robotSearch, setRobotSearch] = useState('');
  const [robotFilterStatus, setRobotFilterStatus] = useState('');
  const [showRobotPicker, setShowRobotPicker] = useState(false);
  const spareParts: SparePart[] = useSpareParts();
  const [usedParts, setUsedParts] = useState<UsedPartRow[]>([]);
  const [users, setUsers] = useState<{ id: string; username: string }[]>([]);
  const robotById = useMemo(() => new Map(robots.map(robot => [robot.id, robot])), [robots]);
  const robotSerialById = useMemo(() => new Map(robots.map(robot => [robot.id, robot.serialNumber])), [robots]);
  const modelById = useMemo(() => new Map(models.map(model => [model.id, model])), [models]);
  const customerById = useMemo(() => new Map(customers.map(customer => [customer.id, customer])), [customers]);

  const [completeEvidenceTicket, setCompleteEvidenceTicket] = useState<MaintenanceTicket | null>(null);
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const evidenceUploadedRef = useRef(false);
  const [evidenceUploading, setEvidenceUploading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [schedules, setSchedules] = useState<MaintenanceSchedule[]>([]);
  const [loadingSchedules, setLoadingSchedules] = useState(false);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<MaintenanceSchedule | null>(null);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [generatingSchedules, setGeneratingSchedules] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({
    title: '',
    robotId: '',
    customerId: '',
    frequencyDays: 30,
    leadDays: 7,
    nextDueDate: todayISO(),
    assignedTo: '',
    priorityLevel: 'Normal',
    notes: '',
    active: true,
  });
  // ref to detect if modal closed before used-parts fetch completes
  const openFormAbortRef = useRef<boolean>(false);

  const [formData, setFormData] = useState({
    robotId: '',
    issueDescription: '',
    status: 'Pending' as MaintenanceTicket['status'],
    resolution: '',
    replacedParts: '',
    assignedTo: '',
    priorityLevel: 'Normal'
  });

  const fetchSchedules = useCallback(async () => {
    setLoadingSchedules(true);
    try {
      const res = await api.get('/maintenance-schedules');
      setSchedules(res.data);
    } catch {
      setSchedules([]);
    } finally {
      setLoadingSchedules(false);
    }
  }, []);

  useEffect(() => {
    api.get('/users').then(r => setUsers(r.data)).catch(() => {});
    fetchSchedules();
  }, [fetchSchedules]);
  // fetchData reloads every shared dataset (incl. ~1.4k spare parts) — keep the interval long.
  usePolling(() => Promise.all([fetchSchedules(), fetchData()]), 600_000);

  const [ticketSearch, setTicketSearch] = useUrlSearch();
  const [ticketStatusFilter, setTicketStatusFilter] = useState('');
  const [ticketDateFrom, setTicketDateFrom] = useState('');
  const [ticketDateTo, setTicketDateTo] = useState('');

  const filteredTickets = useMemo(() => {
    return tickets.filter(t => {
      if (ticketStatusFilter && t.status !== ticketStatusFilter) return false;
      if (ticketDateFrom && t.reportDate < ticketDateFrom) return false;
      if (ticketDateTo && t.reportDate > ticketDateTo) return false;
      if (ticketSearch) {
        const q = ticketSearch.toLowerCase();
        const sn = robotSerialById.get(t.robotId) || '';
        if (!t.issueDescription.toLowerCase().includes(q) && !sn.toLowerCase().includes(q) && !(t.assignedTo || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [tickets, ticketSearch, ticketStatusFilter, ticketDateFrom, ticketDateTo, robotSerialById]);

  const exportTicketsCSV = () => {
    const header = ['เลขที่ตั๋ว', 'Robot SN', 'ปัญหา', 'สถานะ', 'ระดับความเร่งด่วน', 'มอบหมายให้', 'วันที่แจ้ง'];
    const rows = filteredTickets.map(t => [
      formatTicketNo(t.id),
      robotSerialById.get(t.robotId) || '',
      t.issueDescription,
      t.status,
      t.priorityLevel || 'Normal',
      t.assignedTo || '',
      t.reportDate || '',
    ]);
    const csv = [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `maintenance-${todayISO()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  useEffect(() => { setPage(1); }, [ticketSearch, ticketStatusFilter, ticketDateFrom, ticketDateTo]);
  const sort = useTableSort<typeof filteredTickets[0]>({
    id: t => t.id,
    robotSn: t => robotSerialById.get(t.robotId) || t.robotId,
    issue: t => t.issueDescription,
    priority: t => t.priorityLevel || '',
    assignedTo: t => t.assignedTo || '',
    status: t => t.status,
  });
  const paginated = sort.apply(filteredTickets).slice((page - 1) * pageSize, page * pageSize);

  // ── Timeline (history) modal ──────────────────────────────────────────────
  interface LogEntry { id: string; action: string; entityId: string; oldValues: string | null; newValues: string | null; performedBy: string | null; performedAt: string; }
  const [historyTicket, setHistoryTicket] = useState<MaintenanceTicket | null>(null);
  const [historyLogs, setHistoryLogs] = useState<LogEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const dueTodaySchedules = schedules.filter(schedule => schedule.active && schedule.nextDueDate <= todayISO());
  const dueSoonSchedules = schedules.filter(schedule => {
    if (!schedule.active) return false;
    const diff = Math.ceil((new Date(schedule.nextDueDate).getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000);
    return diff >= 0 && diff <= schedule.leadDays;
  });
  const activeSchedules = schedules.filter(schedule => schedule.active);

  // Escape key handlers (after all state declarations)
  useEscapeKey(() => setIsModalOpen(false), isModalOpen && !uploading && !submitting);
  useEscapeKey(() => setCompleteEvidenceTicket(null), !!completeEvidenceTicket && !evidenceUploading);
  useEscapeKey(() => setHistoryTicket(null), !!historyTicket);

  // Notification link: open tickets go straight to the edit form, closed ones to their history.
  useOpenFromUrl(tickets, t => t.id, t => { void (t.status === 'Completed' ? openHistory(t) : openForm(t)); });

  const openHistory = async (ticket: MaintenanceTicket) => {
    setHistoryTicket(ticket);
    setHistoryLogs([]);
    setHistoryLoading(true);
    try {
      const res = await api.get('/logs', { params: { entityType: 'MaintenanceTicket', entityId: ticket.id } });
      setHistoryLogs(res.data as LogEntry[]);
    } catch { /* ignore */ } finally { setHistoryLoading(false); }
  };

  const createInvoiceFromTicket = async (ticket: MaintenanceTicket) => {
    if (!await confirm(`สร้างใบแจ้งหนี้จากใบงาน ${formatTicketNo(ticket.id)}?`, { title: 'สร้างใบแจ้งหนี้', confirmLabel: 'สร้าง' })) return;
    try {
      await api.post(`/invoices/from-maintenance-ticket/${ticket.id}`);
      showToast('สร้างใบแจ้งหนี้สำเร็จ', 'success');
    } catch (e: any) { showToast(e?.response?.data?.error || 'ไม่สามารถสร้างใบแจ้งหนี้ได้', 'error'); }
  };

  const exportMaintenanceReport = (ticket: typeof tickets[0]) => {
    const robot = robotById.get(ticket.robotId);
    const customer = customerById.get(ticket.customerId || robot?.customerId || '');
    const model = robot ? modelById.get(robot.modelId) : null;
    const today = new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });

    const statusLabel: Record<string, string> = {
      Pending: 'รอดำเนินการ',
      'Waiting Quotation': 'รอทำใบเสนอราคา',
      'In Progress': 'กำลังซ่อม',
      'Ready to Ship': 'รอเตรียมส่ง',
      Completed: 'เสร็จสิ้น',
    };

    const html = `
      <div class="doc-header">
        ${logoSVG}
        <div class="doc-title-block">
          <div class="doc-type">รายงานการซ่อมบำรุง</div>
          <div class="doc-meta">
            วันที่พิมพ์: ${today}<br/>
            เลขที่ใบงาน: ${formatTicketNo(ticket.id)}
          </div>
        </div>
      </div>

      <div class="info-grid">
        <div class="info-box">
          <h3>ข้อมูลลูกค้า (Client)</h3>
          ${customer ? `
            <p><strong>${customer.name}</strong></p>
            <p>${customer.address || '-'}</p>
            <p>ผู้ติดต่อ: ${customer.contactPerson || '-'}</p>
            <p>โทร: ${customer.phone || '-'}</p>
          ` : '<p>-</p>'}
        </div>
        <div class="info-box">
          <h3>ข้อมูลอุปกรณ์ (Equipment)</h3>
          <p><strong>รุ่น:</strong> ${model?.name || '-'}</p>
          <p><strong>Serial Number:</strong> ${robot?.serialNumber || ticket.robotId}</p>
          <p><strong>วันแจ้งซ่อม:</strong> ${ticket.reportDate || '-'}</p>
          <p><strong>สถานะ:</strong> ${statusLabel[ticket.status] || ticket.status}</p>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>อาการที่พบ (Issue Reported)</th>
            <th>วันที่</th>
            <th>สถานะ</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>${ticket.issueDescription || '-'}</td>
            <td>${ticket.reportDate || '-'}</td>
            <td>${statusLabel[ticket.status] || ticket.status}</td>
          </tr>
        </tbody>
      </table>

      <div class="summary-box">
        <h3>สรุปการซ่อม / การแก้ไข</h3>
        <p>${ticket.resolution || 'ยังไม่มีข้อมูลการแก้ไข'}</p>
      </div>

      <div class="summary-box">
        <h3>อะไหล่ที่เปลี่ยน (Replaced Parts)</h3>
        <p>${ticket.replacedParts || 'ไม่มี'}</p>
      </div>

      <div class="sig-row">
        <div class="sig-box">
          <div class="sig-line"></div>
          <div class="sig-label">ช่างเทคนิค / Technician Signature</div>
        </div>
        <div class="sig-box">
          <div class="sig-line"></div>
          <div class="sig-label">ผู้รับบริการ / Customer Signature</div>
        </div>
      </div>
    `;

    printPDF(html, `Maintenance Report - ${robot?.serialNumber || ticket.id.slice(0, 8)}`);
  };

  const openForm = async (ticket?: MaintenanceTicket) => {
    openFormAbortRef.current = false;
    setRobotSearch('');
    setRobotFilterStatus('');
    setShowRobotPicker(false);
    setUsedParts([]);
    setUsedPartsLoaded(null);
    if (ticket) {
      // Block editing completed tickets
      if (ticket.status === 'Completed') {
        showToast('ไม่สามารถแก้ไขใบงานที่เสร็จสิ้นแล้ว', 'error');
        return;
      }
      setEditingTicket(ticket);
      setFormData({
        robotId: ticket.robotId,
        issueDescription: ticket.issueDescription,
        status: ticket.status,
        resolution: ticket.resolution || '',
        replacedParts: ticket.replacedParts || '',
        assignedTo: ticket.assignedTo || '',
        priorityLevel: ticket.priorityLevel || 'Normal'
      });
      // Load existing used parts — guarded against race condition
      void loadUsedParts(ticket.id);
    } else {
      setEditingTicket(null);
      setFormData({ 
        robotId: '',
        issueDescription: '', 
        status: 'Pending',
        resolution: '',
        replacedParts: '',
        assignedTo: '',
        priorityLevel: 'Normal'
      });
    }
    setFile(null);
    setIsModalOpen(true);
  };

  const loadUsedParts = async (ticketId: string) => {
    setUsedPartsLoaded(null);
    try {
      const res = await api.get(`/tickets/${ticketId}/used-parts`);
      if (!openFormAbortRef.current) {
        setUsedParts(res.data.map((p: any) => ({ sparePartId: p.sparePartId, quantity: p.quantity, note: p.note || '' })));
        setUsedPartsLoaded(true);
      }
    } catch {
      if (!openFormAbortRef.current) setUsedPartsLoaded(false);
    }
  };

  const closeModal = () => {
    if (submitting) return;
    openFormAbortRef.current = true;
    setIsModalOpen(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!formData.robotId) { showToast('กรุณาเลือกหุ่นยนต์ก่อน', 'error'); return; }
    setSubmitting(true);
    try {
      let issueImageUrl = editingTicket?.issueImageUrl;
      if (file) {
        setUploading(true);
        setUploadProgress(0);
        const fd = new FormData();
        fd.append('image', file);
        try {
          const res = await api.post('/upload', fd, {
            onUploadProgress: (e) => {
              if (e.total) setUploadProgress(Math.round((e.loaded / e.total) * 100));
            },
          });
          issueImageUrl = res.data.url;
        } catch {
          // Saving on without the photo would make the user think it was attached.
          showToast('อัปโหลดรูปไม่สำเร็จ — ลองใหม่ หรือเอารูปออกแล้วบันทึก', 'error');
          return;
        } finally {
          setUploading(false);
          setUploadProgress(0);
        }
      }

      let ticketId: string;
      let createdTicket: MaintenanceTicket | null = null;
      try {
        if (editingTicket) {
          await updateTicket(editingTicket.id, { ...formData, issueImageUrl });
          ticketId = editingTicket.id;
        } else {
          const res = await api.post('/tickets', {
            robotId: formData.robotId,
            issueDescription: formData.issueDescription,
            status: 'Pending',
            reportDate: todayISO(),
            issueImageUrl,
            assignedTo: formData.assignedTo || null,
            priorityLevel: formData.priorityLevel || 'Normal',
          });
          ticketId = res.data.id;
          createdTicket = res.data;
          await fetchData();
        }
      } catch (err) {
        const apiError = (err as { response?: { data?: { error?: string } } }).response?.data?.error;
        if (!editingTicket) showToast(apiError || 'สร้างใบงานไม่สำเร็จ', 'error');
        return; // updateTicket already reported its own error
      }

      // Used parts are replaced wholesale, so only send them when the current list really loaded.
      if (editingTicket && usedPartsLoaded !== true) {
        if (usedPartsLoaded === false) showToast('บันทึกใบงานแล้ว แต่ไม่ได้แก้อะไหล่ เพราะโหลดรายการอะไหล่เดิมไม่สำเร็จ', 'warning');
      } else {
        try {
          const validParts = usedParts.filter(p => p.sparePartId && p.quantity > 0);
          await api.post(`/tickets/${ticketId}/used-parts`, { parts: validParts });
        } catch (e: any) {
          // Ticket is saved; keep the form open so the parts can be fixed and saved again.
          if (createdTicket) setEditingTicket(createdTicket);
          setUsedPartsLoaded(true);
          showToast(`บันทึกใบงานแล้ว แต่บันทึกอะไหล่ไม่สำเร็จ: ${e.response?.data?.error || 'ลองใหม่อีกครั้ง'}`, 'error');
          return;
        }
      }
      setIsModalOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!await confirm('ลบใบงานนี้?', { title: 'ยืนยันการลบ', danger: true, confirmLabel: 'ลบ' })) return;
    await deleteTicket(id);
    showToast('ลบใบงานเรียบร้อยแล้ว', 'success');
  };

  const completeTicket = (ticket: MaintenanceTicket) => {
    setCompleteEvidenceTicket(ticket);
    setEvidenceFile(null);
    evidenceUploadedRef.current = false;
  };

  const handleCompleteWithEvidence = async () => {
    if (!completeEvidenceTicket) return;
    setEvidenceUploading(true);
    try {
      // Upload once: if a later status step fails, retrying must not attach the same file again.
      if (evidenceFile && !evidenceUploadedRef.current) {
        try {
          const fd = new FormData();
          fd.append('file', evidenceFile);
          fd.append('elementType', 'MaintenanceTicket');
          fd.append('elementId', completeEvidenceTicket.id);
          fd.append('attachmentType', 'photo');
          await api.post('/attachments', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
          evidenceUploadedRef.current = true;
        } catch {
          showToast('อัปโหลดไฟล์หลักฐานไม่สำเร็จ', 'error');
          return;
        }
      }
      try {
        for (const step of COMPLETE_STEPS[completeEvidenceTicket.status] ?? ['Completed']) {
          const last = step === 'Completed';
          // Only fill in a default resolution when the ticket has none; never clear replaced parts.
          await updateTicketStatus(completeEvidenceTicket.id, step, last && !completeEvidenceTicket.resolution?.trim() ? 'แก้ไขปัญหาเรียบร้อยแล้ว' : undefined);
        }
      } catch {
        return; // updateTicketStatus has already shown why the status change was refused
      }
      setCompleteEvidenceTicket(null);
      setEvidenceFile(null);
      showToast('ปิดงานเรียบร้อย', 'success');
    } finally {
      setEvidenceUploading(false);
    }
  };

  const openScheduleForm = (schedule?: MaintenanceSchedule) => {
    if (schedule) {
      setEditingSchedule(schedule);
      setScheduleForm({
        title: schedule.title,
        robotId: schedule.robotId,
        customerId: schedule.customerId || '',
        frequencyDays: schedule.frequencyDays,
        leadDays: schedule.leadDays,
        nextDueDate: schedule.nextDueDate,
        assignedTo: schedule.assignedTo || '',
        priorityLevel: schedule.priorityLevel || 'Normal',
        notes: schedule.notes || '',
        active: schedule.active,
      });
    } else {
      const defaultRobot = robots[0];
      setEditingSchedule(null);
      setScheduleForm({
        title: defaultRobot ? `PM - ${defaultRobot.serialNumber}` : '',
        robotId: defaultRobot?.id || '',
        customerId: defaultRobot?.customerId || '',
        frequencyDays: 30,
        leadDays: 7,
        nextDueDate: todayISO(),
        assignedTo: '',
        priorityLevel: 'Normal',
        notes: '',
        active: true,
      });
    }
    setScheduleModalOpen(true);
  };

  const handleScheduleRobotChange = (robotId: string) => {
    const robot = robotById.get(robotId);
    setScheduleForm(prev => ({
      ...prev,
      robotId,
      customerId: robot?.customerId || '',
      title: editingSchedule ? prev.title : robot ? `PM - ${robot.serialNumber}` : prev.title,
    }));
  };

  const saveSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scheduleForm.title.trim() || !scheduleForm.robotId) {
      showToast('กรุณาระบุหัวข้อและหุ่นยนต์', 'error');
      return;
    }
    setSavingSchedule(true);
    try {
      const payload = {
        ...scheduleForm,
        customerId: scheduleForm.customerId || null,
        assignedTo: scheduleForm.assignedTo || null,
        notes: scheduleForm.notes || null,
      };
      if (editingSchedule) await api.put(`/maintenance-schedules/${editingSchedule.id}`, payload);
      else await api.post('/maintenance-schedules', payload);
      await fetchSchedules();
      setScheduleModalOpen(false);
      showToast(editingSchedule ? 'อัปเดต schedule แล้ว' : 'สร้าง schedule แล้ว', 'success');
    } catch (err: any) {
      showToast(err.response?.data?.error || 'บันทึก schedule ไม่สำเร็จ', 'error');
    } finally {
      setSavingSchedule(false);
    }
  };

  const handleDeleteSchedule = async (schedule: MaintenanceSchedule) => {
    if (!await confirm(`ลบ schedule "${schedule.title}" ?`, { title: 'ยืนยันการลบ', danger: true, confirmLabel: 'ลบ' })) return;
    try {
      await api.delete(`/maintenance-schedules/${schedule.id}`);
      setSchedules(prev => prev.filter(item => item.id !== schedule.id));
      showToast('ลบ schedule แล้ว', 'success');
    } catch (err: any) {
      showToast(err.response?.data?.error || 'ลบ schedule ไม่สำเร็จ', 'error');
    }
  };

  const generateDueSchedules = async () => {
    setGeneratingSchedules(true);
    try {
      const res = await api.post('/maintenance-schedules/generate-due');
      await Promise.all([fetchSchedules(), fetchData()]);
      showToast(res.data.created ? `สร้างใบงาน PM ${res.data.created} รายการ` : 'ไม่มี schedule ที่ครบกำหนดสร้างงาน', 'success');
    } catch (err: any) {
      showToast(err.response?.data?.error || 'สร้างงาน PM ไม่สำเร็จ', 'error');
    } finally {
      setGeneratingSchedules(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="ติดตามงานซ่อมบำรุง"
        subtitle={`แสดง ${filteredTickets.length} จาก ${tickets.length} ใบงาน และมี PM schedule ใช้งานอยู่ ${activeSchedules.length} รายการ`}
        actions={<div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={() => openForm()} disabled={robots.length === 0}>
            <Plus size={16}/> สร้างตั๋วใหม่
          </button>
        </div>}
        overflowActions={[
          <RefreshButton onClick={async () => { setRefreshing(true); await fetchData(); setRefreshing(false); }} loading={refreshing} />,
          <button className="btn btn-outline" onClick={generateDueSchedules} disabled={generatingSchedules}>{generatingSchedules ? 'กำลังสร้าง PM...' : 'สร้างงาน PM'}</button>,
          isAdmin && <button className="btn btn-outline" onClick={() => openScheduleForm()} disabled={robots.length === 0}>เพิ่ม PM Schedule</button>,
          <button className="btn btn-ghost" onClick={exportTicketsCSV}><Download size={15} /> CSV</button>,
        ].filter(Boolean) as React.ReactNode[]}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.9rem', marginBottom: '1rem' }}>
        {[
          { label: 'ตาราง PM ที่ใช้งาน', value: activeSchedules.length, sub: `ครบกำหนดเร็ว ๆ นี้ ${dueSoonSchedules.length} รายการ` },
          { label: 'ครบกำหนดวันนี้', value: dueTodaySchedules.length, sub: 'ควรสร้างงานทันที' },
          { label: 'งานที่ยังไม่มอบหมาย', value: filteredTickets.filter(ticket => !ticket.assignedTo && ticket.status !== 'Completed').length, sub: 'ยังไม่มีผู้รับผิดชอบ' },
          { label: 'งานของฉัน', value: filteredTickets.filter(ticket => ticket.assignedTo === user?.username && ticket.status !== 'Completed').length, sub: user?.username || 'ผู้ใช้ปัจจุบัน' },
        ].map(card => (
          <div key={card.label} className="card" style={{ padding: '1rem 1.1rem' }}>
            <div className="text-muted" style={{ fontSize: '0.76rem', marginBottom: 6 }}>{card.label}</div>
            <div style={{ fontSize: '1.7rem', fontWeight: 800 }}>{card.value}</div>
            <div className="text-muted" style={{ fontSize: '0.78rem', marginTop: 6 }}>{card.sub}</div>
          </div>
        ))}
      </div>

      {activeSchedules.length === 0 ? <div className="card" style={{ marginBottom: '1rem', padding: '0.75rem 1rem', color: 'var(--text-secondary)' }}>
        งานบำรุงรักษาตามรอบ ย้ายไปที่ <a href="/ma-schedule" style={{ color: 'var(--accent-primary)', fontWeight: 700 }}>ตาราง MA</a>
      </div> : <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '0.85rem 1rem', borderBottom: '1px solid var(--border-color)' }}>
          <div>
            <div style={{ fontWeight: 700 }}>ตารางบำรุงรักษาเชิงป้องกัน</div>
            <div className="text-muted" style={{ fontSize: '0.78rem' }}>วางรอบ PM และสร้างใบงานอัตโนมัติเมื่อถึงกำหนด</div>
          </div>
          <span className="badge info">{activeSchedules.length} ใช้งานอยู่</span>
        </div>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>หัวข้อ</th>
                <th>Robot SN</th>
                <th>รอบ (วัน)</th>
                <th>ครบกำหนด</th>
                <th>มอบหมาย</th>
                <th>สถานะ</th>
                {isAdmin && <th>การดำเนินการ</th>}
              </tr>
            </thead>
            <tbody>
              {loadingSchedules && <TableSkeleton cols={isAdmin ? 7 : 6} rows={4} />}
              {!loadingSchedules && schedules.slice(0, 8).map(schedule => {
                const robot = robotById.get(schedule.robotId);
                const diff = Math.ceil((new Date(schedule.nextDueDate).getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000);
                const dueTone = diff < 0 ? 'danger' : diff <= schedule.leadDays ? 'warning' : 'info';
                return (
                  <tr key={schedule.id}>
                    <td style={{ fontWeight: 600 }}>{schedule.title}</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{robot?.serialNumber || schedule.robotId}</td>
                    <td>{schedule.frequencyDays}</td>
                    <td>{schedule.nextDueDate}</td>
                    <td>{schedule.assignedTo || <span className="text-muted">-</span>}</td>
                    <td>
                      <span className={`badge ${schedule.active ? dueTone : 'secondary'}`}>
                        {!schedule.active ? 'หยุดชั่วคราว' : diff < 0 ? `เกินกำหนด ${Math.abs(diff)} วัน` : diff === 0 ? 'ครบกำหนดวันนี้' : `เหลืออีก ${diff} วัน`}
                      </span>
                    </td>
                    {isAdmin && (
                      <td>
                        <div style={{ display: 'flex', gap: '0.4rem' }}>
                          <button className="btn btn-outline" style={{ padding: '0.25rem 0.5rem' }} onClick={() => openScheduleForm(schedule)} aria-label="แก้ไข PM Schedule" title="แก้ไข PM Schedule"><Edit2 size={14} /></button>
                          <button className="btn btn-outline" style={{ padding: '0.25rem 0.5rem', color: 'var(--status-danger)' }} onClick={() => handleDeleteSchedule(schedule)} aria-label="ลบ PM Schedule" title="ลบ PM Schedule"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
              {!loadingSchedules && schedules.length === 0 && (
                <EmptyState icon={<span style={{ fontSize: 28 }}>🗓️</span>} title="ยังไม่มี PM Schedule" description="สร้างรอบบำรุงเพื่อให้ระบบสร้างใบงาน PM อัตโนมัติ" colSpan={isAdmin ? 7 : 6} />
              )}
            </tbody>
          </table>
        </div>
      </div>}

      {/* ── Filter bar ───────────────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: '1rem', padding: '0.75rem 1rem', display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={15} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input aria-label="ค้นหา Robot SN, อาการ, ผู้รับผิดชอบ..." className="form-control" style={{ paddingLeft: '2rem', paddingRight: '2rem' }} placeholder="ค้นหา Robot SN, อาการ, ผู้รับผิดชอบ..." value={ticketSearch} onChange={e => setTicketSearch(e.target.value)} />
          {!ticketSearch && <CameraScanButton variant="inline" onScan={setTicketSearch} />}
          {ticketSearch && (
            <button
              type="button"
              onClick={() => setTicketSearch('')}
              aria-label="ล้างคำค้นหาใบงานซ่อม"
              title="ล้างคำค้นหา"
              style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', padding: 0 }}
            >
              <X size={14} />
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {([['','ทุกสถานะ'],['Pending','รอดำเนินการ'],['Waiting Quotation','รอใบเสนอราคา'],['In Progress','กำลังซ่อม'],['Ready to Ship','รอส่ง'],['Completed','เสร็จสิ้น']] as [string,string][]).map(([v,l]) => (
            <button key={v} type="button" onClick={() => setTicketStatusFilter(v)} style={{ padding: '5px 12px', borderRadius: 999, fontSize: 12, fontWeight: ticketStatusFilter===v?700:500, border: `1.5px solid ${ticketStatusFilter===v?'var(--accent-primary)':'var(--border-color)'}`, background: ticketStatusFilter===v?'var(--accent-subtle)':'transparent', color: ticketStatusFilter===v?'var(--accent-primary)':'var(--text-secondary)', cursor: 'pointer', transition: 'all .15s', whiteSpace: 'nowrap' }}>{l}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          <ThaiDateInput aria-label="กรองตั้งแต่วันที่" className="form-control" style={{ width: 140 }} value={ticketDateFrom} onChange={e => setTicketDateFrom(e.target.value)} title="วันเริ่มต้น" />
          <span>–</span>
          <ThaiDateInput aria-label="กรองถึงวันที่" className="form-control" style={{ width: 140 }} value={ticketDateTo} onChange={e => setTicketDateTo(e.target.value)} title="วันสิ้นสุด" />
          {(ticketDateFrom || ticketDateTo) && <button className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: 12 }} onClick={() => { setTicketDateFrom(''); setTicketDateTo(''); }} aria-label="ล้างช่วงวันที่" title="ล้างช่วงวันที่">x</button>}
        </div>
        <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>{filteredTickets.length} รายการ</span>
      </div>

      <div className="card">
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <SortableTh {...sort.th('id')}>เลขที่ตั๋ว</SortableTh>
                <th>รูปภาพ</th>
                <SortableTh {...sort.th('robotSn')}>Robot SN</SortableTh>
                <SortableTh {...sort.th('issue')}>ปัญหา</SortableTh>
                <SortableTh {...sort.th('priority')}>ระดับความเร่งด่วน</SortableTh>
                <SortableTh {...sort.th('assignedTo')}>มอบหมายให้</SortableTh>
                <SortableTh {...sort.th('status')}>สถานะ</SortableTh>
                <th>การดำเนินการ</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map(ticket => (
                <tr key={ticket.id}>
                  <td style={{ fontWeight: 600 }}>{formatTicketNo(ticket.id)}</td>
                  <td>
                    {ticket.issueImageUrl ? (
                      <ZoomableImage src={ticket.issueImageUrl} alt="รูปอาการเสีย" style={{ width: 40, height: 40, borderRadius: 'var(--radius-md)', objectFit: 'cover' }} />
                    ) : (
                      <span className="text-muted">-</span>
                    )}
                  </td>
                  <td>{robotSerialById.get(ticket.robotId) || ticket.robotId}</td>
                  <td>{ticket.issueDescription}</td>
                  <td style={{ textAlign: 'center' }}>
                    {(() => {
                      const p = ticket.priorityLevel || 'Normal';
                      const colors: Record<string,string> = { Critical: 'var(--status-danger)', High: 'var(--status-warning)', Normal: 'var(--status-neutral)', Low: 'var(--status-success)' };
                      const bgs: Record<string,string> = { Critical: 'var(--status-danger-bg)', High: 'var(--status-warning-bg)', Normal: 'var(--surface-soft)', Low: 'var(--status-success-bg)' };
                      return <span style={{ padding: '2px 7px', borderRadius: 10, fontSize: 11, fontWeight: 600, background: bgs[p] || 'var(--surface-soft)', color: colors[p] || 'var(--status-neutral)', border: `1px solid ${colors[p] || '#e5e7eb'}` }}>{priorityLabels[p] || p}</span>;
                    })()}
                    {/* SLA indicator */}
                    {ticket.status !== 'Completed' && (ticket as any).slaDueAt && (() => {
                      const now = Date.now();
                      const due = new Date((ticket as any).slaDueAt).getTime();
                      const breached = !!(ticket as any).slaBreachedAt;
                      const escalation = (ticket as any).escalationLevel || 0;
                      if (breached || escalation >= 2) return <span title="เกินกำหนด SLA แล้ว" style={{ marginLeft: 4, padding: '1px 5px', borderRadius: 8, fontSize: 10, fontWeight: 700, background: 'var(--status-danger-bg)', color: 'var(--status-danger)', border: '1px solid var(--status-danger)' }}>SLA!</span>;
                      if (now > due) return <span title="เลยกำหนด SLA" style={{ marginLeft: 4, padding: '1px 5px', borderRadius: 8, fontSize: 10, fontWeight: 700, background: 'var(--status-warning-bg)', color: 'var(--status-warning)', border: '1px solid var(--status-warning)' }}>SLA⚠</span>;
                      const remaining = due - now;
                      const hrs = Math.round(remaining / 3600000);
                      if (hrs <= 2) return <span title={`เหลือเวลา SLA อีก ${hrs} ชม.`} style={{ marginLeft: 4, padding: '1px 5px', borderRadius: 8, fontSize: 10, fontWeight: 600, background: 'var(--status-warning-bg)', color: 'var(--status-warning)', border: '1px solid var(--status-warning)' }}>{hrs}ชม.</span>;
                      return null;
                    })()}
                  </td>
                  <td style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{ticket.assignedTo || <span className="text-muted">-</span>}</td>
                  <td>
                    <TicketStatusBadge status={ticket.status} />
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      {ticket.status !== 'Completed' && (
                        <button 
                          className="btn btn-outline" 
                          onClick={() => completeTicket(ticket)}
                          style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem', borderColor: 'var(--status-success)', color: 'var(--status-success)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                          title="ทำเครื่องหมายว่าเสร็จสิ้น"
                        >
                          <CheckCircle size={13}/> เสร็จสิ้น
                        </button>
                      )}
                      <button 
                        className="btn btn-outline" 
                        onClick={() => exportMaintenanceReport(ticket)}
                        style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                        title="ส่งออกรายงานเป็น PDF"
                        aria-label={`ส่งออกรายงาน ${ticket.id}`}
                      >
                        <Printer size={14}/>
                      </button>
                      <button className="btn btn-outline" style={{ padding: '0.25rem 0.5rem' }} onClick={() => openForm(ticket)} aria-label={`แก้ไขใบงาน ${ticket.id}`} title={`แก้ไขใบงาน ${ticket.id}`}>
                        <Edit2 size={14}/>
                      </button>
                      <button
                        className="btn btn-outline"
                        style={{ padding: '0.25rem 0.5rem' }}
                        title="คัดลอกลิงก์ติดตามการซ่อม"
                        aria-label={`คัดลอกลิงก์ติดตาม ${ticket.id}`}
                        onClick={async () => {
                          let token = ticket.trackingToken;
                          if (!token) {
                            const r = await api.post(`/tickets/${ticket.id}/tracking-token`);
                            token = r.data.trackingToken;
                            fetchData();
                          }
                          navigator.clipboard.writeText(`${window.location.origin}/track/${token}`);
                          showToast('คัดลอกลิงก์แล้ว', 'success');
                        }}
                      >
                        <Link2 size={14}/>
                      </button>
                      <button className="btn" style={{ padding: '0.25rem 0.5rem', color: 'var(--status-danger)' }} onClick={() => handleDelete(ticket.id)} aria-label={`ลบใบงาน ${ticket.id}`} title={`ลบใบงาน ${ticket.id}`}>
                        <Trash2 size={14}/>
                      </button>
                      <button className="btn btn-outline" style={{ padding: '0.25rem 0.5rem' }} title="ประวัติการเปลี่ยนสถานะ" aria-label={`ประวัติการเปลี่ยนสถานะ ${ticket.id}`} onClick={() => openHistory(ticket)}>
                        <History size={14}/>
                      </button>
                      {ticket.status === 'Completed' && (
                        <button className="btn btn-outline" style={{ padding: '0.25rem 0.5rem', color: 'var(--status-info)' }} title="สร้างใบแจ้งหนี้" aria-label={`สร้างใบแจ้งหนี้จาก ${ticket.id}`} onClick={() => createInvoiceFromTicket(ticket)}>
                          <DollarSign size={14}/>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {loading && tickets.length === 0 && <TableSkeleton cols={8} />}
              {!loading && filteredTickets.length === 0 && (
                <EmptyState
                  mascot={ticketSearch || ticketStatusFilter || ticketDateFrom || ticketDateTo ? 'noResults' : 'allClear'}
                  icon={<span style={{ fontSize: 32 }}>🔧</span>}
                  title="ไม่พบใบงานซ่อมบำรุง"
                  description={ticketSearch || ticketStatusFilter || ticketDateFrom || ticketDateTo ? 'ลองเปลี่ยนตัวกรองหรือค้นหาใหม่' : 'ยังไม่มีใบงานซ่อมบำรุงในระบบ'}
                  colSpan={8}
                />
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageSize={pageSize} total={filteredTickets.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
      </div>

      <Modal open={isModalOpen} onClose={closeModal} preventClose={submitting} title={editingTicket ? 'แก้ไขใบงาน' : 'สร้างใบงาน'} width={540} describedById="maintenance-ticket-description">
        <p id="maintenance-ticket-description" style={{ marginTop: 0, marginBottom: '1rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
          ใช้ฟอร์มนี้เพื่อเลือกหุ่นยนต์ ระบุอาการ มอบหมายผู้รับผิดชอบ และติดตามสถานะงานซ่อมบำรุง
        </p>
            {/* Tracking link — shown when editing */}
            {editingTicket && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '0.6rem 0.85rem',
                background: 'var(--accent-subtle)', borderRadius: 8,
                border: '1px solid var(--accent-primary)', marginBottom: '1rem',
              }}>
                <Link2 size={15} color="var(--accent-primary)" style={{ flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: '0.78rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {editingTicket.trackingToken
                    ? `${window.location.origin}/track/${editingTicket.trackingToken}`
                    : 'คลิก copy เพื่อสร้างลิงก์ติดตาม'}
                </span>
                <button
                  type="button"
                  title="คัดลอกลิงก์"
                  aria-label="คัดลอกลิงก์ติดตามการซ่อม"
                  onClick={async () => {
                    let token = editingTicket.trackingToken;
                    if (!token) {
                      const r = await api.post(`/tickets/${editingTicket.id}/tracking-token`);
                      token = r.data.trackingToken;
                      fetchData();
                    }
                    navigator.clipboard.writeText(`${window.location.origin}/track/${token}`);
                    showToast('คัดลอกลิงก์แล้ว', 'success');
                  }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center' }}
                >
                  <Copy size={14} color="var(--accent-primary)" />
                </button>
              </div>
            )}
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

              {/* ── Robot Picker ── */}
              <div>
                <span className="form-label" id="maint-robot-label">เลือกหุ่นยนต์ <span style={{ color: 'var(--status-danger)' }}>*</span></span>

                {/* Selected robot summary */}
                {formData.robotId && !showRobotPicker ? (() => {
                  const r = robotById.get(formData.robotId);
                  const m = r ? modelById.get(r.modelId) : undefined;
                  const c = r?.customerId ? customerById.get(r.customerId) : undefined;
                  return (
                    <div
                      onClick={() => setShowRobotPicker(true)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '0.75rem',
                        padding: '0.65rem 0.85rem', borderRadius: 8,
                        border: '2px solid var(--accent-primary)',
                        background: 'rgba(59,130,246,0.06)', cursor: 'pointer',
                      }}
                    >
                      <Bot size={20} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{r?.serialNumber}</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                          {m?.name || '-'}{c ? ` · ${c.name}` : ''}
                        </div>
                      </div>
                      <span className={`badge ${r?.status === 'In Stock' ? 'success' : r?.status === 'Assigned' ? 'info' : 'warning'}`} style={{ fontSize: '0.72rem' }}>
                        {r?.status === 'In Stock' ? 'ในคลัง' : r?.status === 'Assigned' ? 'ติดตั้งแล้ว' : r?.status === 'Missing' ? 'สูญหาย' : 'ซ่อมบำรุง'}
                      </span>
                      <ChevronDown size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                    </div>
                  );
                })() : null}

                {/* Picker panel */}
                {(!formData.robotId || showRobotPicker) && (() => {
                  const filtered = robots.filter(r => {
                    if (robotFilterStatus && r.status !== robotFilterStatus) return false;
                    const q = robotSearch.toLowerCase();
                    if (!q) return true;
                    const m = modelById.get(r.modelId);
                    const c = r.customerId ? customerById.get(r.customerId) : undefined;
                    return (
                      r.serialNumber.toLowerCase().includes(q) ||
                      (m?.name || '').toLowerCase().includes(q) ||
                      (c?.name || '').toLowerCase().includes(q)
                    );
                  });
                  return (
                    <div style={{ border: '1px solid var(--border-color)', borderRadius: 8, overflow: 'hidden' }}>
                      {/* Search + filter bar */}
                      <div style={{ padding: '0.6rem', display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-secondary)' }}>
                        <div style={{ position: 'relative', flex: 1 }}>
                          <Search size={14} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                          <input aria-label="ค้นหา SN / รุ่น / ลูกค้า..."
                            className="form-control"
                            style={{ paddingLeft: '1.8rem', fontSize: '0.85rem', padding: '0.35rem 2rem 0.35rem 1.8rem' }}
                            placeholder="ค้นหา SN / รุ่น / ลูกค้า..."
                            value={robotSearch}
                            onChange={e => setRobotSearch(e.target.value)}
                            autoFocus
                          />
                          {!robotSearch && <CameraScanButton variant="inline" onScan={setRobotSearch} />}
                          {robotSearch && (
                            <button
                              type="button"
                              onClick={() => setRobotSearch('')}
                              aria-label="ล้างคำค้นหาหุ่นยนต์"
                              title="ล้างคำค้นหา"
                              style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', padding: 0 }}
                            >
                              <X size={14} />
                            </button>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                          {([['','ทุกสถานะ'],['In Stock','ในคลัง'],['Assigned','ติดตั้งแล้ว'],['In Maintenance','ซ่อมบำรุง']] as [string,string][]).map(([v,l]) => (
                            <button key={v} type="button" onClick={() => setRobotFilterStatus(v)} style={{ padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: robotFilterStatus===v?700:500, border: `1.5px solid ${robotFilterStatus===v?'var(--accent-primary)':'var(--border-color)'}`, background: robotFilterStatus===v?'var(--accent-subtle)':'transparent', color: robotFilterStatus===v?'var(--accent-primary)':'var(--text-secondary)', cursor: 'pointer', transition: 'all .15s' }}>{l}</button>
                          ))}
                        </div>
                        {showRobotPicker && (
                          <button type="button" className="btn btn-outline" style={{ padding: '0.3rem 0.5rem' }} onClick={() => setShowRobotPicker(false)} aria-label="ปิดตัวเลือกหุ่นยนต์" title="ปิดตัวเลือกหุ่นยนต์">
                            <X size={14} />
                          </button>
                        )}
                      </div>

                      {/* Robot cards list */}
                      <div style={{ maxHeight: 180, overflowY: 'auto' }}>
                        {filtered.length === 0 && (
                          <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>ไม่พบหุ่นยนต์</div>
                        )}
                        {filtered.map(r => {
                          const m = modelById.get(r.modelId);
                          const c = r.customerId ? customerById.get(r.customerId) : undefined;
                          const isSelected = formData.robotId === r.id;
                          return (
                            <div
                              key={r.id}
                              role="option"
                              aria-selected={isSelected}
                              tabIndex={0}
                              onClick={() => { setFormData({ ...formData, robotId: r.id }); setShowRobotPicker(false); }}
                              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFormData({ ...formData, robotId: r.id }); setShowRobotPicker(false); } }}
                              style={{
                                display: 'flex', alignItems: 'center', gap: '0.75rem',
                                padding: '0.55rem 0.85rem', cursor: 'pointer',
                                borderBottom: '1px solid var(--border-color)',
                                background: isSelected ? 'rgba(59,130,246,0.1)' : undefined,
                                transition: 'background 0.15s',
                              }}
                              onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = 'rgba(30,58,138,0.04)'; }}
                              onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = ''; }}
                            >
                              <Bot size={18} style={{ color: isSelected ? 'var(--accent-primary)' : 'var(--text-muted)', flexShrink: 0 }} />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontWeight: 600, fontSize: '0.88rem', fontVariantNumeric: 'tabular-nums' }}>{r.serialNumber}</div>
                                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                  {m?.name || 'ไม่ระบุรุ่น'}{c ? ` · ${c.name}` : ''}
                                </div>
                              </div>
                              <RobotStatusBadge status={r.status} />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </div>
              
              <div>
                <label className="form-label" htmlFor="maintenance-field1">อาการเสีย / ปัญหาที่พบ <span style={{ color: 'var(--status-danger)' }}>*</span></label>
                <textarea id="maintenance-field1" required className="form-control" rows={2} placeholder="อธิบายอาการเสียหรือปัญหาที่พบ..." value={formData.issueDescription} onChange={e => setFormData({...formData, issueDescription: e.target.value})} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label className="form-label" htmlFor="maintenance-field2">ระดับความเร่งด่วน</label>
                  <select id="maintenance-field2" className="form-control" value={formData.priorityLevel} onChange={e => setFormData({...formData, priorityLevel: e.target.value})}>
                    <option value="Low">🟢 ต่ำ</option>
                    <option value="Normal">⚪ ปกติ</option>
                    <option value="High">🟠 สูง</option>
                    <option value="Critical">🔴 วิกฤต</option>
                  </select>
                </div>
                <div>
                  <label className="form-label" htmlFor="maintenance-field3">มอบหมายให้</label>
                  <select id="maintenance-field3" className="form-control" value={formData.assignedTo} onChange={e => setFormData({...formData, assignedTo: e.target.value})}>
                    <option value="">— ยังไม่มอบหมาย —</option>
                    {users.map(u => <option key={u.id} value={u.username}>{u.username}</option>)}
                  </select>
                </div>
              </div>
              
              {editingTicket && (
                <>
                  <div>
                    <span className="form-label" id="maint-status-label">สถานะ</span>
                    <div role="group" aria-labelledby="maint-status-label" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                      {([
                        ['Pending', 'รอดำเนินการ'],
                        ['Waiting Quotation', 'รอทำใบเสนอราคา'],
                        ['In Progress', 'กำลังซ่อม'],
                        ['Ready to Ship', 'รอเตรียมส่ง'],
                        ['Completed', 'เสร็จสิ้น'],
                      ] as [string, string][]).map(([v, l]) => {
                        const allowed = v === editingTicket.status || (TICKET_TRANSITIONS[editingTicket.status] ?? []).includes(v);
                        return (
                        <button key={v} type="button" disabled={!allowed} title={allowed ? undefined : `เปลี่ยนจาก "${editingTicket.status}" ไปสถานะนี้โดยตรงไม่ได้`} onClick={() => setFormData({...formData, status: v as MaintenanceTicket['status']})} style={{ opacity: allowed ? 1 : 0.4, padding: '6px 14px', borderRadius: 999, fontSize: 12, fontWeight: 600, border: `1.5px solid ${formData.status===v?'var(--accent-primary)':'var(--border-color)'}`, background: formData.status===v?'var(--accent-subtle)':'transparent', color: formData.status===v?'var(--accent-primary)':'var(--text-secondary)', cursor: allowed ? 'pointer' : 'not-allowed', transition: 'all .15s', whiteSpace: 'nowrap' }}>{l}</button>
                        );
                      })}
                    </div>
                    {formData.status === 'Pending' && (
                      <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)' }}>
                        ✔️ สามารถข้ามไป ⋯ กำลังซ่อม โดยไม่ต้องผ่านใบเสนอราคา
                      </div>
                    )}
                  </div>
                  <div>
                    <label htmlFor="maint-resolution" className="form-label">วิธีแก้ไข</label>
                    <textarea id="maint-resolution" className="form-control" rows={2} style={{ resize: 'vertical' }} value={formData.resolution} onChange={e => setFormData({...formData, resolution: e.target.value})} />
                  </div>
                  <div>
                    <span className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <PackageMinus size={14} /> อะไหล่ที่ใช้
                    </span>
                    {usedPartsLoaded === false && (
                      <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', marginBottom: 6, borderRadius: 8, background: 'var(--status-danger-bg)', color: 'var(--status-danger)', fontSize: 12 }}>
                        โหลดรายการอะไหล่เดิมไม่สำเร็จ — ถ้าบันทึกตอนนี้ระบบจะไม่แตะรายการอะไหล่
                        <button type="button" className="btn btn-outline btn-sm" style={{ marginLeft: 'auto' }} onClick={() => editingTicket && void loadUsedParts(editingTicket.id)}>ลองใหม่</button>
                      </div>
                    )}
                    {usedParts.map((row, idx) => (
                      <div key={idx} style={{
                        display: 'flex', gap: '0.5rem', marginBottom: '0.5rem',
                        alignItems: 'center', background: 'var(--surface-soft)',
                        border: '1px solid var(--border-color)', borderRadius: 8, padding: '0.5rem 0.65rem',
                      }}>
                        <SparePartCombobox
                          spareParts={spareParts}
                          value={row.sparePartId}
                          onChange={id => {
                            const next = [...usedParts];
                            next[idx] = { ...row, sparePartId: id };
                            setUsedParts(next);
                          }}
                        />
                        <input aria-label="จำนวน"
                          type="number"
                          min={1}
                          className="form-control"
                          style={{ width: 70, flexShrink: 0 }}
                          placeholder="จำนวน"
                          value={row.quantity}
                          onChange={e => {
                            const next = [...usedParts];
                            next[idx] = { ...row, quantity: Math.max(1, parseInt(e.target.value) || 1) };
                            setUsedParts(next);
                          }}
                        />
                        <input aria-label="หมายเหตุ"
                          className="form-control"
                          style={{ flex: 1, minWidth: 0 }}
                          placeholder="หมายเหตุ"
                          value={row.note}
                          onChange={e => {
                            const next = [...usedParts];
                            next[idx] = { ...row, note: e.target.value };
                            setUsedParts(next);
                          }}
                        />
                        <button type="button" className="btn btn-outline" style={{ padding: '0.3rem 0.5rem', flexShrink: 0 }}
                          aria-label={`ลบอะไหล่ที่ใช้แถว ${idx + 1}`}
                          title={`ลบอะไหล่ที่ใช้แถว ${idx + 1}`}
                          onClick={() => setUsedParts(usedParts.filter((_, i) => i !== idx))}>
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="btn btn-outline"
                      style={{ fontSize: '0.82rem', padding: '0.3rem 0.75rem' }}
                      onClick={() => setUsedParts([...usedParts, { sparePartId: '', quantity: 1, note: '' }])}
                    >
                      + เพิ่มอะไหล่
                    </button>
                  </div>
                </>
              )}

              <div>
                <label className="form-label" htmlFor="maintenance-file">แนบรูปภาพ <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(ถ้ามี)</span></label>
                <input id="maintenance-file" type="file" className="form-control" accept="image/*" onChange={e => setFile(e.target.files?.[0] || null)} />
                {uploading && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>
                      <span>กำลังอัปโหลดรูป...</span>
                      <span>{uploadProgress}%</span>
                    </div>
                    <div style={{ height: 6, borderRadius: 999, background: 'var(--border-color)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', borderRadius: 999, background: 'var(--accent-primary)', width: `${uploadProgress}%`, transition: 'width 0.2s ease' }} />
                    </div>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-color)' }}>
                <button type="button" className="btn btn-outline" onClick={closeModal}>ยกเลิก</button>
                <FormSubmitButton loading={submitting} disabled={!formData.robotId || submitting} type="submit">
                  {editingTicket ? 'บันทึกการแก้ไข' : 'สร้างใบงาน'}
                </FormSubmitButton>
              </div>
            </form>
      </Modal>

      <Modal open={scheduleModalOpen} onClose={() => setScheduleModalOpen(false)} title={editingSchedule ? 'แก้ไข PM Schedule' : 'สร้าง PM Schedule'} width={520} preventClose={savingSchedule} describedById="maintenance-schedule-description">
        <p id="maintenance-schedule-description" style={{ marginTop: 0, marginBottom: '1rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
          ตั้งรอบบำรุงล่วงหน้า ระบุความถี่ วันที่ครบกำหนด และผู้รับผิดชอบสำหรับ PM อัตโนมัติ
        </p>
        <form onSubmit={saveSchedule} style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
          <div>
            <label className="form-label" htmlFor="maintenance-field5">หัวข้อ</label>
            <input id="maintenance-field5" className="form-control" value={scheduleForm.title} onChange={e => setScheduleForm(prev => ({ ...prev, title: e.target.value }))} required />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label className="form-label" htmlFor="maintenance-field6">หุ่นยนต์</label>
              <select id="maintenance-field6" className="form-control" value={scheduleForm.robotId} onChange={e => handleScheduleRobotChange(e.target.value)} required>
                <option value="">เลือกหุ่นยนต์</option>
                {robots.map(robot => <option key={robot.id} value={robot.id}>{robot.serialNumber}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label" htmlFor="maintenance-field7">ลูกค้า</label>
              <select id="maintenance-field7" className="form-control" value={scheduleForm.customerId} onChange={e => setScheduleForm(prev => ({ ...prev, customerId: e.target.value }))}>
                <option value="">อิงตามหุ่นยนต์</option>
                {customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label className="form-label" htmlFor="maintenance-number">ทุกกี่วัน</label>
              <input id="maintenance-number" type="number" min={1} className="form-control" value={scheduleForm.frequencyDays} onChange={e => setScheduleForm(prev => ({ ...prev, frequencyDays: Math.max(1, parseInt(e.target.value) || 1) }))} />
            </div>
            <div>
              <label className="form-label" htmlFor="maintenance-field10">เตือนล่วงหน้า</label>
              <input id="maintenance-field10" type="number" min={0} className="form-control" value={scheduleForm.leadDays} onChange={e => setScheduleForm(prev => ({ ...prev, leadDays: Math.max(0, parseInt(e.target.value) || 0) }))} />
            </div>
            <div>
              <label className="form-label" htmlFor="maintenance-date">วันครบกำหนด</label>
              <ThaiDateInput id="maintenance-date" className="form-control" value={scheduleForm.nextDueDate} onChange={e => setScheduleForm(prev => ({ ...prev, nextDueDate: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label className="form-label" htmlFor="maintenance-field12">มอบหมายให้</label>
              <select id="maintenance-field12" className="form-control" value={scheduleForm.assignedTo} onChange={e => setScheduleForm(prev => ({ ...prev, assignedTo: e.target.value }))}>
                <option value="">— ยังไม่มอบหมาย —</option>
                {users.map(u => <option key={u.id} value={u.username}>{u.username}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label" htmlFor="maintenance-field13">ระดับความเร่งด่วน</label>
              <select id="maintenance-field13" className="form-control" value={scheduleForm.priorityLevel} onChange={e => setScheduleForm(prev => ({ ...prev, priorityLevel: e.target.value }))}>
                <option value="Low">ต่ำ</option>
                <option value="Normal">ปกติ</option>
                <option value="High">สูง</option>
                <option value="Critical">วิกฤต</option>
              </select>
            </div>
          </div>
          <div>
            <label className="form-label" htmlFor="maintenance-field14">หมายเหตุ</label>
            <textarea id="maintenance-field14" className="form-control" rows={3} value={scheduleForm.notes} onChange={e => setScheduleForm(prev => ({ ...prev, notes: e.target.value }))} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.88rem' }}>
            <input type="checkbox" checked={scheduleForm.active} onChange={e => setScheduleForm(prev => ({ ...prev, active: e.target.checked }))} />
            เปิดใช้งาน Schedule
          </label>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-color)' }}>
            <button type="button" className="btn btn-outline" onClick={() => setScheduleModalOpen(false)} disabled={savingSchedule}>ยกเลิก</button>
            <FormSubmitButton loading={savingSchedule} type="submit">{editingSchedule ? 'บันทึก Schedule' : 'สร้าง Schedule'}</FormSubmitButton>
          </div>
        </form>
      </Modal>

      {/* ── Complete Evidence modal ─────────────────────────────────────── */}
      <Modal open={!!completeEvidenceTicket} onClose={() => setCompleteEvidenceTicket(null)} title={<><CheckCircle size={18} color="var(--status-success)" /> ยืนยันเสร็จสิ้นงาน</>} width={420} preventClose={evidenceUploading} describedById="maintenance-complete-description">
        <p id="maintenance-complete-description" style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginBottom: '1rem', marginTop: 0 }}>
              กรุณาอัปโหลด<strong>ไฟล์หลักฐาน</strong> (รูปภาพ หรือ PDF) ก่อนปิดงาน
            </p>
            <div style={{ marginBottom: '1rem' }}>
              <label className="form-label" htmlFor="maintenance-field16">ไฟล์หลักฐาน <span style={{ color: 'var(--status-danger)' }}>*</span></label>
              <input id="maintenance-field16"
                type="file"
                className="form-control"
                accept="image/*,.pdf"
                disabled={evidenceUploading}
                onChange={e => { evidenceUploadedRef.current = false; setEvidenceFile(e.target.files?.[0] || null); }}
              />
              {evidenceFile && (
                <div style={{ marginTop: 6, fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span>📎</span>
                  <span>{evidenceFile.name}</span>
                  <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>({(evidenceFile.size / 1024).toFixed(0)} KB)</span>
                </div>
              )}
              {!evidenceFile && (
                <div style={{ marginTop: 6, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  ℹ️ แนะนำให้แนบไฟล์หลักฐาน แต่สามารถข้ามได้
                </div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-color)' }}>
              <button type="button" className="btn btn-outline" onClick={() => setCompleteEvidenceTicket(null)} disabled={evidenceUploading}>
                ยกเลิก
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleCompleteWithEvidence}
                disabled={evidenceUploading}
                style={{ background: !evidenceUploading ? 'var(--status-success)' : undefined, borderColor: !evidenceUploading ? 'var(--status-success)' : undefined }}
              >
                <CheckCircle size={14} /> {evidenceUploading ? 'กำลังบันทึก...' : 'ยืนยันเสร็จสิ้น'}
              </button>
            </div>
      </Modal>

      {/* ── History / timeline modal ──────────────────────────────────────── */}
      <Modal open={!!historyTicket} onClose={() => setHistoryTicket(null)} title={<><History size={16} /> ประวัติและไฟล์แนบ — {historyTicket?.id.slice(0, 8).toUpperCase()}</>} width={560} describedById="maintenance-history-description">
        <p id="maintenance-history-description" style={{ marginTop: 0, marginBottom: '1rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
          แสดงลำดับเหตุการณ์ การเปลี่ยนสถานะ ผู้ที่แก้ไขใบงานนี้ล่าสุด และรูป/ไฟล์ที่แนบไว้กับใบงาน
        </p>
        {historyTicket?.issueImageUrl && (
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: 6 }}>รูปอาการเสีย</div>
            <ZoomableImage src={historyTicket.issueImageUrl} alt="รูปอาการเสีย" style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 8, objectFit: 'contain', border: '1px solid var(--border-color)' }} />
          </div>
        )}
            {historyLoading && <div className="text-muted" style={{ padding: '1rem 0' }}>กำลังโหลด...</div>}
            {!historyLoading && historyLogs.length === 0 && <div className="text-muted" style={{ padding: '1rem 0' }}>ไม่พบประวัติ</div>}
            {!historyLoading && historyLogs.length > 0 && (
              <div style={{ position: 'relative', paddingLeft: 24 }}>
                <div style={{ position: 'absolute', left: 8, top: 0, bottom: 0, width: 2, background: 'var(--border-color)' }} />
                {historyLogs.map((log, i) => {
                  const nv = log.newValues ? (() => { try { return JSON.parse(log.newValues!); } catch { return {}; } })() : {};
                  const ov = log.oldValues ? (() => { try { return JSON.parse(log.oldValues!); } catch { return {}; } })() : {};
                  const actionLabel: Record<string, string> = { created: 'สร้าง Ticket', updated: 'แก้ไข', status_changed: 'เปลี่ยนสถานะ', deleted: 'ลบ', attachment_added: 'เพิ่มไฟล์แนบ' };
                  return (
                    <div key={log.id} style={{ position: 'relative', marginBottom: i < historyLogs.length - 1 ? '1.25rem' : 0 }}>
                      <div style={{ position: 'absolute', left: -20, top: 4, width: 10, height: 10, borderRadius: '50%', background: log.action === 'status_changed' ? 'var(--accent-primary)' : 'var(--text-muted)', border: '2px solid var(--bg-card)' }} />
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 2 }}>
                        {formatThaiDateTime(log.performedAt)}
                        {log.performedBy && ` · ${log.performedBy}`}
                      </div>
                      <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{actionLabel[log.action] || log.action}</div>
                      {log.action === 'status_changed' && (ov.status || nv.status) && (
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                          {ov.status && <span style={{ textDecoration: 'line-through', marginRight: 6, color: 'var(--text-muted)' }}>{ov.status}</span>}
                          {nv.status && <span style={{ color: 'var(--accent-primary)' }}>→ {nv.status}</span>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
        {historyTicket && (
          <div style={{ marginTop: '1.25rem' }}>
            <AttachmentPanel elementType="MaintenanceTicket" elementId={historyTicket.id} />
          </div>
        )}
      </Modal>
    </div>
  );
};

export default Maintenance;
