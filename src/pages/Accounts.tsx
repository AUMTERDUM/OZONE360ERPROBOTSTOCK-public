import React, { useState, useEffect, useMemo } from 'react';
import {
  Plus, Search, Eye, X, Edit2, Trash2, Printer,
  ChevronDown, PlusCircle, MinusCircle,
  CheckCircle, Clock, XCircle, FileText, DollarSign,
  Send, CreditCard, BookOpen, BarChart3, Receipt,
  ArrowDownCircle, ArrowUpCircle, AlertTriangle,
} from 'lucide-react';
import api from '../api';
import { printPDF, logoSVG } from '../utils/printPDF';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../context/ConfirmContext';
import { ThaiDateInput } from '../components/ThaiDateInput';
import { useToast } from '../context/ToastContext';
import AttachmentPanel from '../components/AttachmentPanel';
import Pagination from '../components/Pagination';
import { Modal, FormSubmitButton, TableSkeleton, useUrlSearch, useTableSort, SortableTh } from '../components/UIUtils';
import PageHeader from '../components/PageHeader';
import CameraScanButton from '../components/CameraScanButton';
import { formatThaiDate, formatThaiDateTime } from '../utils/thaiDate';

// ── Types ────────────────────────────────────────────────────────────────────

interface Account {
  id: string; code: string; name: string; type: string;
  parentId?: string; parent?: { id: string; code: string; name: string };
  isActive: boolean;
}

interface InvoiceItem {
  id?: string; description: string; quantity: number;
  unit: string; unitPrice: number; amount: number; remark: string;
}

interface Payment {
  id: string; docNumber: string; paymentType: string; paymentDate: string;
  amount: number; method: string; reference?: string; invoiceId?: string;
  invoice?: Invoice; notes?: string; createdAt: string; createdBy?: string;
}

interface Invoice {
  id: string; docNumber: string; invoiceType: string; status: string;
  invoiceDate: string; dueDate: string; customerId?: string; customerName?: string;
  supplier?: string; subtotal: number; taxRate: number; taxAmount: number;
  totalAmount: number; paidAmount: number; notes?: string;
  sourceType?: string; sourceId?: string;
  createdAt: string; createdBy?: string;
  items: InvoiceItem[]; payments: Payment[];
}

interface Budget {
  id: string; name: string; accountId: string;
  account?: Account; fiscalYear: string;
  budgetAmount: number; spentAmount: number; notes?: string;
}

interface AccountSummary {
  totalAR: number; totalAP: number; totalRevenue: number;
  totalExpense: number; totalReceived: number; totalPaid: number;
  overdueInvoices: number; invoiceCount: number;
}

interface LogEntry {
  id: string;
  entityType: string;
  entityId: string;
  entityName?: string;
  action: string;
  oldValues?: string;
  newValues?: string;
  performedBy?: string;
  performedAt: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
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

function generateInvDocNumber(type: 'Sales' | 'Purchase') {
  const prefix = type === 'Sales' ? 'INV' : 'BILL';
  const now = new Date();
  const y = now.getFullYear().toString().slice(-2);
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const rand = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
  return `${prefix}${y}${m}${d}-${rand}`;
}

function generatePayDocNumber() {
  const now = new Date();
  const y = now.getFullYear().toString().slice(-2);
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const rand = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
  return `PAY${y}${m}${d}-${rand}`;
}

const INV_STATUS: Record<string, { label: string; color: string; bg: string; border: string; icon: React.ReactNode }> = {
  Draft:     { label: 'ร่าง',          color: 'var(--text-primary)',    bg: 'var(--bg-tertiary)',        border: 'var(--border-color-strong)', icon: <Clock size={12} /> },
  Issued:    { label: 'วางบิลแล้ว',    color: 'var(--status-info)',     bg: 'var(--status-info-bg)',     border: 'var(--status-info)', icon: <Send size={12} /> },
  Partial:   { label: 'ชำระบางส่วน',   color: 'var(--status-warning)',  bg: 'var(--status-warning-bg)',  border: 'var(--status-warning)', icon: <CreditCard size={12} /> },
  Paid:      { label: 'ชำระครบ',       color: 'var(--status-success)',  bg: 'var(--status-success-bg)',  border: 'var(--status-success)', icon: <CheckCircle size={12} /> },
  Overdue:   { label: 'เกินกำหนด',     color: 'var(--status-danger)',   bg: 'var(--status-danger-bg)',   border: 'var(--status-danger)', icon: <AlertTriangle size={12} /> },
  Cancelled: { label: 'ยกเลิก',        color: 'var(--text-primary)',    bg: 'var(--bg-tertiary)',        border: 'var(--border-color-strong)', icon: <XCircle size={12} /> },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = INV_STATUS[status] || INV_STATUS['Draft'];
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

function getInvoiceStatusNarrative(invoice: Pick<Invoice, 'status' | 'paidAmount' | 'totalAmount' | 'dueDate'>) {
  switch (invoice.status) {
    case 'Draft':
      return 'เอกสารยังแก้ไขได้ และยังไม่ถูกวางบิลหรือรับชำระ';
    case 'Issued':
      return `วางบิลแล้ว รอติดตามยอดคงเหลือและการชำระก่อนถึงกำหนด ${formatDate(invoice.dueDate)}`;
    case 'Partial':
      return `มีการชำระแล้วบางส่วน คงเหลือ ฿${formatCurrency(invoice.totalAmount - invoice.paidAmount)}`;
    case 'Paid':
      return 'เอกสารถูกชำระครบแล้ว และไม่มียอดคงเหลือ';
    case 'Overdue':
      return `เกินกำหนดชำระแล้ว ควรติดตามยอดคงเหลือ ฿${formatCurrency(invoice.totalAmount - invoice.paidAmount)}`;
    case 'Cancelled':
      return 'เอกสารถูกยกเลิก และไม่อยู่ในรอบรับชำระต่อ';
    default:
      return 'ตรวจสอบสถานะของเอกสารนี้ก่อนดำเนินการต่อ';
  }
}

const SOURCE_TYPE_LABELS: Record<string, string> = {
  DeliveryNote: 'ใบส่งของ',
  PurchaseOrder: 'ใบสั่งซื้อ',
  MaintenanceTicket: 'ใบแจ้งซ่อม',
  ProjectRequest: 'ใบเปิดโปรเจค',
};

const ACTIVITY_ACTION_LABELS: Record<string, string> = {
  created: 'สร้างใหม่',
  updated: 'ปรับปรุงข้อมูล',
  deleted: 'ลบข้อมูล',
  status_changed: 'เปลี่ยนสถานะ',
  attachment_added: 'เพิ่มไฟล์แนบ',
};

const ACCT_TYPES: Record<string, { label: string; color: string }> = {
  Asset:     { label: 'สินทรัพย์', color: 'var(--status-info)' },
  Liability: { label: 'หนี้สิน', color: 'var(--status-danger)' },
  Equity:    { label: 'ส่วนของเจ้าของ', color: 'var(--status-secondary)' },
  Income:    { label: 'รายได้', color: 'var(--status-success)' },
  Expense:   { label: 'ค่าใช้จ่าย', color: '#ea580c' },
};

// ── Tab types ────────────────────────────────────────────────────────────────
type TabKey = 'invoices' | 'payments' | 'accounts' | 'budgets';
type WorkspacePillTone = 'neutral' | 'success' | 'warning' | 'info' | 'danger';
type WorkspacePill = { label: string; value: number; tone: WorkspacePillTone };

// ══════════════════════════════════════════════════════════════════════════════
// Main Component
// ══════════════════════════════════════════════════════════════════════════════

export default function Accounts() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const confirm = useConfirm();
  const { showToast } = useToast();

  const [tab, setTab] = useState<TabKey>('invoices');

  // ── Data ──
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [summary, setSummary] = useState<AccountSummary | null>(null);
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const [failedSections, setFailedSections] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [selectedInvoiceLogs, setSelectedInvoiceLogs] = useState<LogEntry[]>([]);
  const [loadingInvoiceLogs, setLoadingInvoiceLogs] = useState(false);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [invR, payR, acctR, budR, sumR, custR] = await Promise.allSettled([
        api.get<Invoice[]>('/invoices'),
        api.get<Payment[]>('/payments'),
        api.get<Account[]>('/accounts'),
        api.get<Budget[]>('/budgets'),
        api.get<AccountSummary>('/accounts/summary'),
        api.get<{ id: string; name: string }[]>('/customers'),
      ]);
      const results = [invR, payR, acctR, budR, sumR, custR];
      const labels = ['ใบแจ้งหนี้', 'การชำระเงิน', 'บัญชี', 'งบประมาณ', 'สรุปบัญชี', 'ลูกค้า'];
      setFailedSections(labels.filter((_, i) => results[i].status === 'rejected'));
      if (invR.status === 'fulfilled') setInvoices(invR.value.data);
      if (payR.status === 'fulfilled') setPayments(payR.value.data);
      if (acctR.status === 'fulfilled') setAccounts(acctR.value.data);
      if (budR.status === 'fulfilled') setBudgets(budR.value.data);
      if (sumR.status === 'fulfilled') setSummary(sumR.value.data);
      if (custR.status === 'fulfilled') setCustomers(custR.value.data);
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchAll(); }, []);

  // ── Filters ──
  const [search, setSearch] = useUrlSearch();
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  // ── Invoice Form Modal ──
  const [showInvForm, setShowInvForm] = useState(false);
  const [editingInv, setEditingInv] = useState<Invoice | null>(null);
  const [viewingInv, setViewingInv] = useState<Invoice | null>(null);
  const [invForm, setInvForm] = useState({
    docNumber: '', invoiceType: 'Sales' as 'Sales' | 'Purchase',
    invoiceDate: new Date().toISOString().split('T')[0],
    dueDate: '', customerId: '', customerName: '', supplier: '',
    taxRate: '7', notes: '', status: 'Draft',
  });
  const [invItems, setInvItems] = useState<Omit<InvoiceItem, 'id' | 'amount'>[]>([
    { description: '', quantity: 1, unit: 'ชิ้น', unitPrice: 0, remark: '' },
  ]);
  const [savingInv, setSavingInv] = useState(false);

  // ── Payment Form Modal ──
  const [showPayForm, setShowPayForm] = useState(false);
  const [payForm, setPayForm] = useState({
    docNumber: '', paymentType: 'Receive' as 'Receive' | 'Pay',
    paymentDate: new Date().toISOString().split('T')[0],
    amount: '', method: 'Transfer', reference: '', invoiceId: '', notes: '',
  });
  const [savingPay, setSavingPay] = useState(false);

  // ── Account Form Modal ──
  const [showAcctForm, setShowAcctForm] = useState(false);
  const [editingAcct, setEditingAcct] = useState<Account | null>(null);
  const [acctForm, setAcctForm] = useState({ code: '', name: '', type: 'Asset', parentId: '' });
  const [savingAcct, setSavingAcct] = useState(false);

  // ── Budget Form Modal ──
  const [showBudgetForm, setShowBudgetForm] = useState(false);
  const [editingBudget, setEditingBudget] = useState<Budget | null>(null);
  const [budgetForm, setBudgetForm] = useState({ name: '', accountId: '', fiscalYear: String(new Date().getFullYear()), budgetAmount: '', notes: '' });
  const [savingBudget, setSavingBudget] = useState(false);

  // ── Pagination ──
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  useEffect(() => { setPage(1); }, [search, filterType, filterStatus, tab]);

  // ════════════════════════════════════════════════════════════════════════════
  // Invoice logic
  // ════════════════════════════════════════════════════════════════════════════

  const filteredInvoices = useMemo(() => {
    let list = invoices;
    if (filterType) list = list.filter(i => i.invoiceType === filterType);
    if (filterStatus) list = list.filter(i => i.status === filterStatus);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(i =>
        i.docNumber.toLowerCase().includes(q) ||
        (i.customerName || '').toLowerCase().includes(q) ||
        (i.supplier || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [invoices, search, filterType, filterStatus]);

  const invoiceSort = useTableSort<typeof filteredInvoices[0]>({
    docNumber: i => i.docNumber,
    invoiceType: i => i.invoiceType,
    party: i => i.customerName || i.supplier || '',
    invoiceDate: i => i.invoiceDate,
    dueDate: i => i.dueDate,
    totalAmount: i => i.totalAmount,
    paidAmount: i => i.paidAmount,
    status: i => i.status,
  });
  const paginatedInv = invoiceSort.apply(filteredInvoices).slice((page - 1) * pageSize, page * pageSize);
  const selectedInvoice = useMemo(
    () => invoices.find(inv => inv.id === selectedInvoiceId) ?? null,
    [invoices, selectedInvoiceId]
  );

  useEffect(() => {
    let ignore = false;

    const fetchInvoiceLogs = async () => {
      if (!selectedInvoiceId) {
        setSelectedInvoiceLogs([]);
        return;
      }
      setLoadingInvoiceLogs(true);
      try {
        const res = await api.get<LogEntry[]>(`/logs?entityType=Invoice&entityId=${encodeURIComponent(selectedInvoiceId)}`);
        if (!ignore) setSelectedInvoiceLogs(res.data);
      } catch {
        if (!ignore) setSelectedInvoiceLogs([]);
      } finally {
        if (!ignore) setLoadingInvoiceLogs(false);
      }
    };

    fetchInvoiceLogs();

    return () => {
      ignore = true;
    };
  }, [selectedInvoiceId]);

  useEffect(() => {
    if (tab !== 'invoices') return;
    if (filteredInvoices.length === 0) {
      setSelectedInvoiceId(null);
      return;
    }
    if (!selectedInvoiceId || !filteredInvoices.some(inv => inv.id === selectedInvoiceId)) {
      setSelectedInvoiceId(filteredInvoices[0].id);
    }
  }, [filteredInvoices, selectedInvoiceId, tab]);

  const invoiceWorkspaceStats = useMemo<WorkspacePill[]>(() => {
    const draft = invoices.filter(inv => inv.status === 'Draft').length;
    const open = invoices.filter(inv => ['Issued', 'Partial', 'Overdue'].includes(inv.status)).length;
    const paid = invoices.filter(inv => inv.status === 'Paid').length;
    const purchase = invoices.filter(inv => inv.invoiceType === 'Purchase').length;
    return [
      { label: 'ร่าง', value: draft, tone: 'neutral' },
      { label: 'รอเก็บเงิน', value: open, tone: 'warning' },
      { label: 'ชำระแล้ว', value: paid, tone: 'success' },
      { label: 'ใบรับวางบิล', value: purchase, tone: 'info' },
    ];
  }, [invoices]);

  const paymentWorkspaceStats = useMemo<WorkspacePill[]>(() => {
    const receive = payments.filter(p => p.paymentType === 'Receive').length;
    const pay = payments.filter(p => p.paymentType === 'Pay').length;
    const linked = payments.filter(p => p.invoiceId).length;
    return [
      { label: 'รับเงิน', value: receive, tone: 'success' },
      { label: 'จ่ายเงิน', value: pay, tone: 'warning' },
      { label: 'ผูกกับใบแจ้งหนี้', value: linked, tone: 'info' },
      { label: 'ไม่ได้ผูก', value: Math.max(0, payments.length - linked), tone: 'neutral' },
    ];
  }, [payments]);

  const accountWorkspaceStats = useMemo<WorkspacePill[]>(() => {
    const active = accounts.filter(a => a.isActive).length;
    const parents = accounts.filter(a => !a.parentId).length;
    return [
      { label: 'บัญชีทั้งหมด', value: accounts.length, tone: 'info' },
      { label: 'ใช้งานอยู่', value: active, tone: 'success' },
      { label: 'ระดับบนสุด', value: parents, tone: 'neutral' },
      { label: 'ผูกกับงบประมาณ', value: budgets.length, tone: 'warning' },
    ];
  }, [accounts, budgets.length]);

  const budgetWorkspaceStats = useMemo<WorkspacePill[]>(() => {
    const over = budgets.filter(b => b.budgetAmount > 0 && b.spentAmount > b.budgetAmount).length;
    const tight = budgets.filter(b => b.budgetAmount > 0 && b.spentAmount / b.budgetAmount >= 0.8 && b.spentAmount <= b.budgetAmount).length;
    return [
      { label: 'แผนงบประมาณ', value: budgets.length, tone: 'info' },
      { label: 'ใกล้เกินงบ', value: tight, tone: 'warning' },
      { label: 'เกินงบ', value: over, tone: 'danger' },
      { label: 'ปีงบประมาณ', value: new Date().getFullYear(), tone: 'neutral' },
    ];
  }, [budgets]);

  const selectedInvoiceSourceLabel = useMemo(() => {
    const sourceLog = selectedInvoiceLogs.find(log => {
      const newValues = parseJSON(log.newValues);
      return typeof newValues?.source === 'string';
    });
    const newValues = sourceLog ? parseJSON(sourceLog.newValues) : null;
    return typeof newValues?.source === 'string' ? newValues.source : null;
  }, [selectedInvoiceLogs]);

  const renderInvoiceActivityDetail = (log: LogEntry) => {
    const oldValues = parseJSON(log.oldValues);
    const newValues = parseJSON(log.newValues);

    if (log.action === 'status_changed' && typeof oldValues?.status === 'string' && typeof newValues?.status === 'string') {
      return `${oldValues.status} -> ${newValues.status}`;
    }
    if (log.action === 'attachment_added' && typeof newValues?.filename === 'string') {
      return `เพิ่มไฟล์ ${newValues.filename}`;
    }
    if (log.action === 'created' && typeof newValues?.source === 'string') {
      return `สร้างจาก ${newValues.source}`;
    }
    if (log.action === 'created' && typeof newValues?.total === 'number') {
      return `ยอดรวม ฿${formatCurrency(newValues.total)}`;
    }
    if (log.action === 'updated') {
      return 'มีการปรับปรุงรายละเอียดเอกสาร';
    }
    if (log.action === 'deleted') {
      return 'เอกสารถูกลบออกจากระบบ';
    }
    return null;
  };

  const invoiceActivityTone = (action: string) => {
    if (action === 'created') return 'success';
    if (action === 'status_changed') return 'warning';
    if (action === 'attachment_added') return 'info';
    if (action === 'deleted') return 'danger';
    return 'neutral';
  };

  const openInvCreate = (type: 'Sales' | 'Purchase' = 'Sales') => {
    setEditingInv(null);
    const due = new Date();
    due.setDate(due.getDate() + 30);
    setInvForm({
      docNumber: generateInvDocNumber(type), invoiceType: type,
      invoiceDate: new Date().toISOString().split('T')[0],
      dueDate: due.toISOString().split('T')[0],
      customerId: '', customerName: '', supplier: '', taxRate: '7', notes: '', status: 'Draft',
    });
    setInvItems([{ description: '', quantity: 1, unit: 'ชิ้น', unitPrice: 0, remark: '' }]);
    setShowInvForm(true);
  };

  const openInvEdit = (inv: Invoice) => {
    setEditingInv(inv);
    setInvForm({
      docNumber: inv.docNumber, invoiceType: inv.invoiceType as 'Sales' | 'Purchase',
      invoiceDate: inv.invoiceDate, dueDate: inv.dueDate,
      customerId: inv.customerId || '', customerName: inv.customerName || '',
      supplier: inv.supplier || '', taxRate: String(inv.taxRate), notes: inv.notes || '', status: inv.status,
    });
    setInvItems(inv.items.map(i => ({
      description: i.description, quantity: i.quantity, unit: i.unit,
      unitPrice: i.unitPrice, remark: i.remark || '',
    })));
    setShowInvForm(true);
  };

  const invSubtotal = invItems.reduce((s, i) => s + Number(i.quantity) * Number(i.unitPrice), 0);
  const invTaxAmount = Math.round(invSubtotal * Number(invForm.taxRate)) / 100;
  const invTotal = invSubtotal + invTaxAmount;

  const saveInvoice = async () => {
    if (!invForm.invoiceDate || !invForm.dueDate) { showToast('กรุณากรอกวันที่', 'error'); return; }
    if (invForm.invoiceType === 'Sales' && !invForm.customerName) { showToast('กรุณากรอกชื่อลูกค้า', 'error'); return; }
    if (invForm.invoiceType === 'Purchase' && !invForm.supplier) { showToast('กรุณากรอกชื่อ Supplier', 'error'); return; }
    if (invItems.some(i => !i.description)) { showToast('กรุณากรอกรายละเอียดรายการ', 'error'); return; }

    setSavingInv(true);
    try {
      const payload = { ...invForm, items: invItems };
      if (editingInv) {
        await api.put(`/invoices/${editingInv.id}`, payload);
        showToast('บันทึกสำเร็จ', 'success');
      } else {
        await api.post('/invoices', payload);
        showToast('สร้างใบแจ้งหนี้สำเร็จ', 'success');
      }
      setShowInvForm(false);
      fetchAll();
    } catch (e: any) {
      showToast(e.response?.data?.error || 'บันทึกล้มเหลว', 'error');
    } finally { setSavingInv(false); }
  };

  const changeInvStatus = async (inv: Invoice, status: string) => {
    const labels: Record<string, string> = {
      Issued: 'วางบิล', Cancelled: 'ยกเลิก',
    };
    const ok = await confirm(`${labels[status] || status} — "${inv.docNumber}"?`, { danger: status === 'Cancelled' });
    if (!ok) return;
    try {
      await api.patch(`/invoices/${inv.id}/status`, { status });
      showToast('อัพเดทสถานะสำเร็จ', 'success');
      fetchAll();
    } catch (e: any) { showToast(e.response?.data?.error || 'ล้มเหลว', 'error'); }
  };

  const deleteInvoice = async (inv: Invoice) => {
    const ok = await confirm(`ลบ "${inv.docNumber}"?`, { danger: true });
    if (!ok) return;
    try {
      await api.delete(`/invoices/${inv.id}`);
      showToast('ลบสำเร็จ', 'success');
      fetchAll();
    } catch (e: any) { showToast(e.response?.data?.error || 'ลบล้มเหลว', 'error'); }
  };

  const handlePrintInvoice = (inv: Invoice) => {
    const isSales = inv.invoiceType === 'Sales';
    const title = isSales ? 'ใบแจ้งหนี้' : 'ใบรับวางบิล';
    const statusLabel = INV_STATUS[inv.status]?.label || inv.status;

    const itemsHtml = inv.items.map((item, i) => `
      <tr>
        <td style="text-align:center">${i + 1}</td>
        <td>${item.description}</td>
        <td style="text-align:center">${item.quantity} ${item.unit}</td>
        <td style="text-align:right">฿${formatCurrency(item.unitPrice)}</td>
        <td style="text-align:right;font-weight:600">฿${formatCurrency(item.amount)}</td>
      </tr>`).join('');

    const html = `
      <div class="doc-header">
        ${logoSVG}
        <div class="doc-title-block">
          <div class="doc-type">${title}</div>
          <div class="doc-meta">
            เลขที่: <strong>${inv.docNumber}</strong><br/>
            วันที่: ${formatDate(inv.invoiceDate)}<br/>
            ครบกำหนด: ${formatDate(inv.dueDate)}<br/>
            สถานะ: ${statusLabel}
          </div>
        </div>
      </div>

      <div class="info-grid">
        <div class="info-box">
          <h3>${isSales ? 'ลูกค้า' : 'ผู้จำหน่าย'}</h3>
          <p><strong>${isSales ? (inv.customerName || '-') : (inv.supplier || '-')}</strong></p>
        </div>
        <div class="info-box">
          <h3>เงื่อนไขการชำระ</h3>
          <p>ชำระภายใน: ${formatDate(inv.dueDate)}</p>
          <p>ภาษี VAT: ${inv.taxRate}%</p>
          ${inv.notes ? `<p>หมายเหตุ: ${inv.notes}</p>` : ''}
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th style="width:40px">#</th>
            <th>รายการ</th>
            <th style="width:100px;text-align:center">จำนวน</th>
            <th style="width:110px;text-align:right">ราคา/หน่วย</th>
            <th style="width:110px;text-align:right">รวม</th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>

      <div style="display:flex;justify-content:flex-end;margin-bottom:24px">
        <div style="border:1px solid #e5e7eb;border-radius:6px;padding:12px 20px;min-width:220px">
          <div style="display:flex;justify-content:space-between;gap:32px;font-size:11pt;margin-bottom:4px">
            <span>ยอดก่อน VAT</span><span>฿${formatCurrency(inv.subtotal)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;gap:32px;font-size:11pt;margin-bottom:4px">
            <span>VAT ${inv.taxRate}%</span><span>฿${formatCurrency(inv.taxAmount)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;gap:32px;font-size:13pt;border-top:1px solid #e5e7eb;padding-top:8px">
            <span>รวมทั้งสิ้น</span><strong style="font-size:15pt">฿${formatCurrency(inv.totalAmount)}</strong>
          </div>
          ${inv.paidAmount > 0 ? `
          <div style="display:flex;justify-content:space-between;gap:32px;font-size:11pt;margin-top:4px;color:var(--status-success)">
            <span>ชำระแล้ว</span><span>฿${formatCurrency(inv.paidAmount)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;gap:32px;font-size:11pt;color:var(--status-danger)">
            <span>คงเหลือ</span><span>฿${formatCurrency(inv.totalAmount - inv.paidAmount)}</span>
          </div>` : ''}
        </div>
      </div>

      <div class="sig-row" style="grid-template-columns:1fr 1fr">
        ${[isSales ? 'ผู้วางบิล' : 'ผู้รับบิล', isSales ? 'ผู้รับบิล' : 'ผู้อนุมัติ'].map(label => `
          <div class="sig-box">
            <div class="sig-line"></div>
            <div class="sig-label">${label}</div>
          </div>`).join('')}
      </div>
    `;
    printPDF(html, `${inv.docNumber}`);
  };

  // ════════════════════════════════════════════════════════════════════════════
  // Payment logic
  // ════════════════════════════════════════════════════════════════════════════

  const openPayCreate = (invoiceId?: string, type?: 'Receive' | 'Pay') => {
    setPayForm({
      docNumber: generatePayDocNumber(),
      paymentType: type || 'Receive',
      paymentDate: new Date().toISOString().split('T')[0],
      amount: '', method: 'Transfer', reference: '',
      invoiceId: invoiceId || '', notes: '',
    });
    setShowPayForm(true);
  };

  const savePayment = async () => {
    if (!payForm.amount || Number(payForm.amount) <= 0) { showToast('กรุณากรอกจำนวนเงิน', 'error'); return; }
    setSavingPay(true);
    try {
      await api.post('/payments', payForm);
      showToast('บันทึกการชำระสำเร็จ', 'success');
      setShowPayForm(false);
      fetchAll();
    } catch (e: any) {
      showToast(e.response?.data?.error || 'บันทึกล้มเหลว', 'error');
    } finally { setSavingPay(false); }
  };

  const deletePayment = async (p: Payment) => {
    const ok = await confirm(`ลบรายการชำระ "${p.docNumber}"?`, { danger: true });
    if (!ok) return;
    try {
      await api.delete(`/payments/${p.id}`);
      showToast('ลบสำเร็จ', 'success');
      fetchAll();
    } catch (e: any) { showToast(e.response?.data?.error || 'ลบล้มเหลว', 'error'); }
  };

  // ════════════════════════════════════════════════════════════════════════════
  // Account (Chart of Accounts) logic
  // ════════════════════════════════════════════════════════════════════════════

  const openAcctCreate = () => {
    setEditingAcct(null);
    setAcctForm({ code: '', name: '', type: 'Asset', parentId: '' });
    setShowAcctForm(true);
  };

  const openAcctEdit = (a: Account) => {
    setEditingAcct(a);
    setAcctForm({ code: a.code, name: a.name, type: a.type, parentId: a.parentId || '' });
    setShowAcctForm(true);
  };

  const saveAccount = async () => {
    if (!acctForm.code || !acctForm.name) { showToast('กรุณากรอกรหัสและชื่อบัญชี', 'error'); return; }
    setSavingAcct(true);
    try {
      if (editingAcct) {
        await api.put(`/accounts/${editingAcct.id}`, acctForm);
        showToast('บันทึกสำเร็จ', 'success');
      } else {
        await api.post('/accounts', acctForm);
        showToast('สร้างผังบัญชีสำเร็จ', 'success');
      }
      setShowAcctForm(false);
      fetchAll();
    } catch (e: any) {
      showToast(e.response?.data?.error || 'บันทึกล้มเหลว', 'error');
    } finally { setSavingAcct(false); }
  };

  const deleteAccount = async (a: Account) => {
    const ok = await confirm(`ลบบัญชี "${a.code} - ${a.name}"?`, { danger: true });
    if (!ok) return;
    try {
      await api.delete(`/accounts/${a.id}`);
      showToast('ลบสำเร็จ', 'success');
      fetchAll();
    } catch (e: any) { showToast(e.response?.data?.error || 'ลบล้มเหลว', 'error'); }
  };

  const seedAccounts = async () => {
    const ok = await confirm('สร้างผังบัญชีเริ่มต้น (Thai Chart of Accounts)?');
    if (!ok) return;
    try {
      await api.post('/accounts/seed');
      showToast('สร้างผังบัญชีสำเร็จ', 'success');
      fetchAll();
    } catch (e: any) { showToast(e.response?.data?.error || 'ล้มเหลว', 'error'); }
  };

  // ════════════════════════════════════════════════════════════════════════════
  // Budget logic
  // ════════════════════════════════════════════════════════════════════════════

  const openBudgetCreate = () => {
    setEditingBudget(null);
    setBudgetForm({ name: '', accountId: '', fiscalYear: String(new Date().getFullYear()), budgetAmount: '', notes: '' });
    setShowBudgetForm(true);
  };

  const openBudgetEdit = (b: Budget) => {
    setEditingBudget(b);
    setBudgetForm({ name: b.name, accountId: b.accountId, fiscalYear: b.fiscalYear, budgetAmount: String(b.budgetAmount), notes: b.notes || '' });
    setShowBudgetForm(true);
  };

  const saveBudget = async () => {
    if (!budgetForm.name || !budgetForm.accountId || !budgetForm.budgetAmount) { showToast('กรุณากรอกข้อมูลให้ครบ', 'error'); return; }
    setSavingBudget(true);
    try {
      if (editingBudget) {
        await api.put(`/budgets/${editingBudget.id}`, budgetForm);
        showToast('บันทึกสำเร็จ', 'success');
      } else {
        await api.post('/budgets', budgetForm);
        showToast('สร้างงบประมาณสำเร็จ', 'success');
      }
      setShowBudgetForm(false);
      fetchAll();
    } catch (e: any) {
      showToast(e.response?.data?.error || 'บันทึกล้มเหลว', 'error');
    } finally { setSavingBudget(false); }
  };

  const deleteBudget = async (b: Budget) => {
    const ok = await confirm(`ลบงบประมาณ "${b.name}"?`, { danger: true });
    if (!ok) return;
    try {
      await api.delete(`/budgets/${b.id}`);
      showToast('ลบสำเร็จ', 'success');
      fetchAll();
    } catch (e: any) { showToast(e.response?.data?.error || 'ลบล้มเหลว', 'error'); }
  };

  const workspaceConfig: Record<TabKey, {
    title: string;
    subtitle: string;
    pills: WorkspacePill[];
    actions: React.ReactNode;
  }> = {
    invoices: {
      title: 'ศูนย์จัดการใบแจ้งหนี้',
      subtitle: 'จัดการเอกสารขายและรับวางบิลแบบ document-centric พร้อมคิวงานที่ต้องตามต่อ',
      pills: invoiceWorkspaceStats,
      actions: (
        <>
          <button className="btn btn-outline" onClick={() => openInvCreate('Purchase')}><Plus size={14} /> ใบรับวางบิล</button>
          <button className="btn btn-primary" onClick={() => openInvCreate('Sales')}><Plus size={14} /> ใบแจ้งหนี้</button>
        </>
      ),
    },
    payments: {
      title: 'คิวบันทึกการชำระเงิน',
      subtitle: 'มุมมองรายการรับ-จ่ายที่เน้นการเชื่อมกับ invoice และการตรวจสอบ reference',
      pills: paymentWorkspaceStats,
      actions: <button className="btn btn-primary" onClick={() => openPayCreate()}><Plus size={14} /> บันทึกชำระ</button>,
    },
    accounts: {
      title: 'ผังบัญชี',
      subtitle: 'ผังบัญชีแบบลำดับชั้นพร้อมสถานะการใช้งานและความเชื่อมโยงกับงบประมาณ',
      pills: accountWorkspaceStats,
      actions: (
        <>
          {!failedSections.includes('บัญชี') && accounts.length === 0 && <button className="btn btn-outline" onClick={seedAccounts}>สร้างผังเริ่มต้น</button>}
          {isAdmin && <button className="btn btn-primary" onClick={openAcctCreate}><Plus size={14} /> เพิ่มบัญชี</button>}
        </>
      ),
    },
    budgets: {
      title: 'ควบคุมงบประมาณ',
      subtitle: 'ดูจุดเสี่ยงงบประมาณและคุมวงเงินรายบัญชีในมุมมองเดียว',
      pills: budgetWorkspaceStats,
      actions: isAdmin ? <button className="btn btn-primary" onClick={openBudgetCreate}><Plus size={14} /> ตั้งงบประมาณ</button> : <></>,
    },
  };

  // ════════════════════════════════════════════════════════════════════════════
  // Render
  // ════════════════════════════════════════════════════════════════════════════

  const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
    { key: 'invoices', label: 'ใบแจ้งหนี้', icon: <Receipt size={16} /> },
    { key: 'payments', label: 'การชำระเงิน', icon: <CreditCard size={16} /> },
    { key: 'accounts', label: 'ผังบัญชี', icon: <BookOpen size={16} /> },
    { key: 'budgets', label: 'งบประมาณ', icon: <BarChart3 size={16} /> },
  ];

  return (
    <div className="page-container">
      {failedSections.length > 0 && <div role="alert" className="card" style={{ color: 'var(--status-danger)', marginBottom: '1rem' }}>โหลดไม่สำเร็จ: {failedSections.join(' / ')} <button className="btn btn-outline" disabled={loading} onClick={fetchAll}>ลองใหม่</button></div>}
      <PageHeader
        title={<><DollarSign size={24} style={{ color: 'var(--accent-primary)' }} /> บัญชี / การเงิน</>}
        subtitle="จัดการใบแจ้งหนี้ การรับ-จ่ายเงิน ผังบัญชี และงบประมาณ"
        actions={<div className="accounts-header-note">พื้นที่ทำงานสไตล์ ERP สำหรับเอกสารการเงิน</div>}
      />

      <div className="accounts-workspace card">
        <div className="accounts-workspace-main">
          <div>
            <div className="accounts-workspace-eyebrow">พื้นที่ทำงาน</div>
            <h2 className="accounts-workspace-title">{workspaceConfig[tab].title}</h2>
            <p className="accounts-workspace-subtitle">{workspaceConfig[tab].subtitle}</p>
          </div>
          <div className="accounts-workspace-actions">{workspaceConfig[tab].actions}</div>
        </div>
        <div className="accounts-workspace-pills">
          {workspaceConfig[tab].pills.map((pill) => (
            <div key={pill.label} className={`accounts-pill ${pill.tone}`}>
              <span>{pill.label}</span>
              <strong>{(tab === 'invoices' && failedSections.includes('ใบแจ้งหนี้') && invoices.length === 0) || (tab === 'payments' && failedSections.includes('การชำระเงิน') && payments.length === 0) || (tab === 'accounts' && failedSections.includes('บัญชี') && accounts.length === 0) || (tab === 'budgets' && failedSections.includes('งบประมาณ') && budgets.length === 0) ? '—' : pill.value}</strong>
            </div>
          ))}
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
          {[
            { label: 'ลูกหนี้ค้างรับ (AR)', value: `฿${formatCurrency(summary.totalAR)}`, color: 'var(--status-info)', icon: <ArrowDownCircle size={18} /> },
            { label: 'เจ้าหนี้ค้างจ่าย (AP)', value: `฿${formatCurrency(summary.totalAP)}`, color: 'var(--status-danger)', icon: <ArrowUpCircle size={18} /> },
            { label: 'รายได้รวม', value: `฿${formatCurrency(summary.totalRevenue)}`, color: 'var(--status-success)', icon: <Receipt size={18} /> },
            { label: 'ค่าใช้จ่ายรวม', value: `฿${formatCurrency(summary.totalExpense)}`, color: '#ea580c', icon: <FileText size={18} /> },
            { label: 'เกินกำหนด', value: summary.overdueInvoices, color: summary.overdueInvoices > 0 ? 'var(--status-danger)' : 'var(--text-secondary)', icon: <AlertTriangle size={18} /> },
          ].map(({ label, value, color, icon }) => (
            <div key={label} className="stat-card" style={{ padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ color }}>{icon}</span>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{label}</span>
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '2px solid var(--border-color)', paddingBottom: 0 }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '10px 18px', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
              background: 'transparent',
              color: tab === t.key ? 'var(--accent-primary)' : 'var(--text-secondary)',
              borderBottom: tab === t.key ? '2px solid var(--accent-primary)' : '2px solid transparent',
              marginBottom: -2, transition: 'all .15s',
            }}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* ══ Tab: Invoices ══ */}
      {tab === 'invoices' && (
        <>
          {/* Filters */}
          <div className="card" style={{ padding: '12px 16px', marginBottom: 16, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 200, position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Search size={15} style={{ position: 'absolute', left: 10, color: 'var(--text-muted)', pointerEvents: 'none' }} />
              <input aria-label="ค้นหาเลขที่, ลูกค้า, supplier..." className="form-control" style={{ paddingLeft: '2rem', paddingRight: '2rem', width: '100%' }} placeholder="ค้นหาเลขที่, ลูกค้า, supplier..." value={search} onChange={e => setSearch(e.target.value)} />
              {!search && <CameraScanButton variant="inline" onScan={setSearch} />}
              {search && <button onClick={() => setSearch('')} aria-label="ล้างคำค้นหา invoice" title="ล้างคำค้นหา invoice" style={{ position: 'absolute', right: 8, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={14} /></button>}
            </div>
            <select aria-label="กรองตามประเภท" className="form-control" style={{ width: 'auto' }} value={filterType} onChange={e => setFilterType(e.target.value)}>
              <option value="">ประเภททั้งหมด</option>
              <option value="Sales">ใบแจ้งหนี้ (ขาย)</option>
              <option value="Purchase">ใบรับวางบิล (ซื้อ)</option>
            </select>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {[
                { key: '', label: 'ทั้งหมด' },
                ...Object.entries(INV_STATUS).map(([k, v]) => ({ key: k, label: v.label })),
              ].map(({ key, label }) => {
                const cfg = INV_STATUS[key] || { color: 'var(--text-secondary)', bg: 'var(--bg-tertiary)', icon: null };
                return (
                  <button key={key} onClick={() => setFilterStatus(key)} style={{
                    padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: filterStatus === key ? 700 : 500,
                    border: `1.5px solid ${filterStatus === key ? (cfg.color || 'var(--text-secondary)') : 'var(--border-color)'}`,
                    background: filterStatus === key ? (cfg.bg || 'var(--bg-tertiary)') : 'transparent',
                    color: filterStatus === key ? (cfg.color || 'var(--text-secondary)') : 'var(--text-secondary)',
                    cursor: 'pointer', transition: 'all .15s',
                  }}>
                    {label}
                  </button>
                );
              })}
            </div>
            <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--text-muted)' }}>{filteredInvoices.length} รายการ</span>
          </div>

          {/* Invoice Table */}
          <div className="accounts-document-grid">
            <div className="card" style={{ overflowX: 'auto' }}>
              {loading ? (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>กำลังโหลด...</div>
              ) : failedSections.includes('ใบแจ้งหนี้') && invoices.length === 0 ? null : filteredInvoices.length === 0 ? (
                <div style={{ padding: 60, textAlign: 'center' }}>
                  <Receipt size={48} style={{ color: 'var(--text-muted)', marginBottom: 12 }} />
                  <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>ยังไม่มีใบแจ้งหนี้</p>
                </div>
              ) : (
                <table className="data-table">
                <thead>
                  <tr>
                    <SortableTh {...invoiceSort.th('docNumber')}>เลขที่</SortableTh>
                    <SortableTh {...invoiceSort.th('invoiceType')}>ประเภท</SortableTh>
                    <SortableTh {...invoiceSort.th('party')}>ลูกค้า / Supplier</SortableTh>
                    <SortableTh {...invoiceSort.th('invoiceDate')}>วันที่</SortableTh>
                    <SortableTh {...invoiceSort.th('dueDate')}>ครบกำหนด</SortableTh>
                    <SortableTh {...invoiceSort.th('totalAmount')} style={{ textAlign: 'right' }}>ยอดรวม</SortableTh>
                    <SortableTh {...invoiceSort.th('paidAmount')} style={{ textAlign: 'right' }}>ชำระแล้ว</SortableTh>
                    <SortableTh {...invoiceSort.th('status')}>สถานะ</SortableTh>
                    <th style={{ width: 120 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedInv.map(inv => (
                    <tr key={inv.id} className={selectedInvoiceId === inv.id ? 'accounts-row-selected' : ''}>
                      <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'var(--accent-primary)', cursor: 'pointer' }} onClick={() => setViewingInv(inv)}>
                        <button className="accounts-row-link" onClick={() => setSelectedInvoiceId(inv.id)}>{inv.docNumber}</button>
                      </td>
                      <td>
                        <span style={{
                          padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 600,
                          background: inv.invoiceType === 'Sales' ? 'var(--status-info-bg)' : 'var(--status-warning-bg)',
                          color: inv.invoiceType === 'Sales' ? '#1d4ed8' : '#92400e',
                        }}>
                          {inv.invoiceType === 'Sales' ? 'ขาย' : 'ซื้อ'}
                        </span>
                      </td>
                      <td onClick={() => setSelectedInvoiceId(inv.id)} style={{ cursor: 'pointer' }}>{inv.customerName || inv.supplier || '-'}</td>
                      <td style={{ fontSize: 12 }}>{formatDate(inv.invoiceDate)}</td>
                      <td style={{ fontSize: 12 }}>{formatDate(inv.dueDate)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>฿{formatCurrency(inv.totalAmount)}</td>
                      <td style={{ textAlign: 'right', color: inv.paidAmount > 0 ? 'var(--status-success)' : 'var(--text-muted)' }}>
                        ฿{formatCurrency(inv.paidAmount)}
                      </td>
                      <td><StatusBadge status={inv.status} /></td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn btn-ghost btn-sm" title="ดู" aria-label={`ดูรายละเอียด ${inv.docNumber}`} onClick={() => setViewingInv(inv)}><Eye size={14} /></button>
                          <button className="btn btn-ghost btn-sm" title="พิมพ์" aria-label={`พิมพ์ ${inv.docNumber}`} onClick={() => handlePrintInvoice(inv)}><Printer size={14} /></button>
                          {inv.status === 'Draft' && <button className="btn btn-ghost btn-sm" title="แก้ไข" aria-label={`แก้ไข ${inv.docNumber}`} onClick={() => openInvEdit(inv)}><Edit2 size={14} /></button>}
                          {(inv.status === 'Draft' || inv.status === 'Issued') && (
                            <button className="btn btn-ghost btn-sm" title="ชำระเงิน" aria-label={`บันทึกการชำระเงิน ${inv.docNumber}`}
                              onClick={() => openPayCreate(inv.id, inv.invoiceType === 'Sales' ? 'Receive' : 'Pay')}
                            ><CreditCard size={14} /></button>
                          )}
                          {isAdmin && <button className="btn btn-ghost btn-sm" title="ลบ" aria-label={`ลบ ${inv.docNumber}`} onClick={() => deleteInvoice(inv)}><Trash2 size={14} /></button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                </table>
              )}
              <Pagination total={filteredInvoices.length} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
            </div>

            <div className="card accounts-document-panel">
              {selectedInvoice ? (
                <>
                  <div className="accounts-document-panel-head">
                    <div>
                      <div className="accounts-document-kicker">แผงข้อมูลเอกสาร</div>
                      <div className="accounts-document-title">{selectedInvoice.docNumber}</div>
                      <div className="accounts-document-meta">{selectedInvoice.invoiceType === 'Sales' ? 'ใบแจ้งหนี้ (ขาย)' : 'ใบรับวางบิล (ซื้อ)'} · เปิดเมื่อ {formatDate(selectedInvoice.invoiceDate)}</div>
                    </div>
                    <StatusBadge status={selectedInvoice.status} />
                  </div>

                  <div className="accounts-panel-actions">
                    <button className="btn btn-outline" onClick={() => handlePrintInvoice(selectedInvoice)}><Printer size={14} /> พิมพ์</button>
                    <button className="btn btn-outline" onClick={() => setViewingInv(selectedInvoice)}><Eye size={14} /> ดูเต็ม</button>
                    {selectedInvoice.status === 'Draft' && <button className="btn btn-outline" onClick={() => openInvEdit(selectedInvoice)}><Edit2 size={14} /> แก้ไข</button>}
                    {(selectedInvoice.status === 'Draft' || selectedInvoice.status === 'Issued' || selectedInvoice.status === 'Partial') && (
                      <button className="btn btn-primary" onClick={() => openPayCreate(selectedInvoice.id, selectedInvoice.invoiceType === 'Sales' ? 'Receive' : 'Pay')}><CreditCard size={14} /> ลงรับชำระ</button>
                    )}
                  </div>

                  {(() => {
                    const statusCfg = INV_STATUS[selectedInvoice.status] || INV_STATUS.Draft;
                    return (
                      <div style={{ marginBottom: 16, padding: '12px 14px', borderRadius: 12, border: `1px solid ${statusCfg.border}`, background: statusCfg.bg }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, color: statusCfg.color, fontSize: 12, fontWeight: 700 }}>
                          {statusCfg.icon}
                          <span>สถานะปัจจุบัน: {statusCfg.label}</span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{getInvoiceStatusNarrative(selectedInvoice)}</div>
                      </div>
                    );
                  })()}

                  <div className="accounts-info-stack">
                    <div className="accounts-info-block">
                      <span>คู่เอกสาร</span>
                      <strong>{selectedInvoice.customerName || selectedInvoice.supplier || '-'}</strong>
                    </div>
                    <div className="accounts-info-block">
                      <span>ยอดคงเหลือ</span>
                      <strong>฿{formatCurrency(selectedInvoice.totalAmount - selectedInvoice.paidAmount)}</strong>
                    </div>
                    <div className="accounts-info-block">
                      <span>ครบกำหนดชำระ</span>
                      <strong>{formatDate(selectedInvoice.dueDate)}</strong>
                    </div>
                    <div className="accounts-info-block">
                      <span>แหล่งที่มา</span>
                      <strong>{SOURCE_TYPE_LABELS[selectedInvoice.sourceType || ''] || selectedInvoice.sourceType || 'บันทึกเอง'}</strong>
                    </div>
                  </div>

                  <div className="accounts-totals-box">
                    <div><span>ยอดก่อนภาษี</span><strong>฿{formatCurrency(selectedInvoice.subtotal)}</strong></div>
                    <div><span>VAT {selectedInvoice.taxRate}%</span><strong>฿{formatCurrency(selectedInvoice.taxAmount)}</strong></div>
                    <div><span>ชำระแล้ว</span><strong>฿{formatCurrency(selectedInvoice.paidAmount)}</strong></div>
                    <div className="accent"><span>ยอดรวม</span><strong>฿{formatCurrency(selectedInvoice.totalAmount)}</strong></div>
                  </div>

                  <div className="accounts-side-section">
                    <div className="accounts-side-section-title">รายการสินค้า</div>
                    <div className="accounts-line-list">
                      {selectedInvoice.items.map((item, idx) => (
                        <div key={`${selectedInvoice.id}-${idx}`} className="accounts-line-item">
                          <div>
                            <strong>{item.description}</strong>
                            <span>{item.quantity} {item.unit} x ฿{formatCurrency(item.unitPrice)}</span>
                          </div>
                          <strong>฿{formatCurrency(item.amount)}</strong>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="accounts-side-section">
                    <div className="accounts-side-section-title">ประวัติการชำระเงิน</div>
                    {selectedInvoice.payments.length > 0 ? (
                      <div className="accounts-line-list">
                        {selectedInvoice.payments.map(payment => (
                          <div key={payment.id} className="accounts-line-item compact">
                            <div>
                              <strong>{payment.docNumber}</strong>
                              <span>{formatDate(payment.paymentDate)} · {payment.method}</span>
                            </div>
                            <strong>฿{formatCurrency(payment.amount)}</strong>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="accounts-empty-note">ยังไม่มีการรับชำระสำหรับเอกสารนี้</div>
                    )}
                  </div>

                  <div className="accounts-side-section">
                    <div className="accounts-side-section-title">เอกสารที่เชื่อมโยง</div>
                    {selectedInvoice.sourceType || selectedInvoice.sourceId ? (
                      <div className="accounts-line-item compact">
                        <div>
                          <strong>{SOURCE_TYPE_LABELS[selectedInvoice.sourceType || ''] || selectedInvoice.sourceType || 'เอกสารต้นทาง'}</strong>
                          <span>{selectedInvoiceSourceLabel || (selectedInvoice.sourceId ? `อ้างอิง ${selectedInvoice.sourceId.slice(0, 8)}...` : 'สร้างจากการบันทึกภายใน')}</span>
                        </div>
                        <strong>{selectedInvoice.sourceType === 'DeliveryNote' ? 'DN' : selectedInvoice.sourceType === 'PurchaseOrder' ? 'PO' : 'DOC'}</strong>
                      </div>
                    ) : (
                      <div className="accounts-empty-note">เอกสารนี้สร้างตรงจากฝ่ายการเงิน ไม่มีเอกสารต้นทาง</div>
                    )}
                  </div>

                  <div className="accounts-side-section">
                    <div className="accounts-side-section-title">ความเคลื่อนไหว</div>
                    {loadingInvoiceLogs ? (
                      <div className="accounts-empty-note">กำลังโหลดประวัติเอกสาร...</div>
                    ) : selectedInvoiceLogs.length > 0 ? (
                      <div className="accounts-line-list">
                        {selectedInvoiceLogs.slice(0, 6).map(log => {
                          const detail = renderInvoiceActivityDetail(log);
                          return (
                            <div key={log.id} className={`accounts-activity-item tone-${invoiceActivityTone(log.action)}`}>
                              <div className="accounts-activity-topline">
                                <strong>{ACTIVITY_ACTION_LABELS[log.action] ?? log.action.replace(/_/g, ' ')}</strong>
                                <span>{formatDateTime(log.performedAt)}</span>
                              </div>
                              {detail && <div className="accounts-activity-detail">{detail}</div>}
                              <div className="accounts-activity-meta">โดย {log.performedBy || 'ระบบ'}</div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="accounts-empty-note">ยังไม่มีความเคลื่อนไหวสำหรับใบแจ้งหนี้นี้</div>
                    )}
                  </div>

                  <div className="accounts-side-section">
                    <div className="accounts-side-section-title">เอกสารแนบ</div>
                    <AttachmentPanel elementType="Invoice" elementId={selectedInvoice.id} />
                  </div>
                </>
              ) : (
                <div className="accounts-panel-empty">
                  <Receipt size={42} style={{ color: 'var(--text-muted)' }} />
                  <div>
                    <strong>เลือกเอกสารจากรายการ</strong>
                    <p>มุมนี้ใช้เป็นแผงตรวจสอบเอกสารแบบ ERP เพื่อดูยอด, ความเคลื่อนไหว, และประวัติการชำระเงินโดยไม่ต้องเปิดหน้าต่างป๊อปอัปทุกครั้ง</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ══ Tab: Payments ══ */}
      {tab === 'payments' && (
        <div className="card" style={{ overflowX: 'auto' }}>
          {loading ? (
            <TableSkeleton cols={5} />
          ) : failedSections.includes('การชำระเงิน') && payments.length === 0 ? null : payments.length === 0 ? (
            <div style={{ padding: 60, textAlign: 'center' }}>
              <CreditCard size={48} style={{ color: 'var(--text-muted)', marginBottom: 12 }} />
              <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>ยังไม่มีรายการชำระเงิน</p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>เลขที่</th>
                  <th>ประเภท</th>
                  <th>วันที่</th>
                  <th>วิธี</th>
                  <th style={{ textAlign: 'right' }}>จำนวน</th>
                  <th>อ้างอิงใบแจ้งหนี้</th>
                  <th>เลขที่อ้างอิง</th>
                  <th>หมายเหตุ</th>
                  <th style={{ width: 60 }}></th>
                </tr>
              </thead>
              <tbody>
                {payments.map(p => (
                  <tr key={p.id}>
                    <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{p.docNumber}</td>
                    <td>
                      <span style={{
                        padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 600,
                        background: p.paymentType === 'Receive' ? '#dcfce7' : 'var(--status-warning-bg)',
                        color: p.paymentType === 'Receive' ? '#166534' : '#92400e',
                      }}>
                        {p.paymentType === 'Receive' ? 'รับเงิน' : 'จ่ายเงิน'}
                      </span>
                    </td>
                    <td style={{ fontSize: 12 }}>{formatDate(p.paymentDate)}</td>
                    <td style={{ fontSize: 12 }}>{p.method}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600, color: p.paymentType === 'Receive' ? 'var(--status-success)' : 'var(--status-danger)' }}>
                      ฿{formatCurrency(p.amount)}
                    </td>
                    <td style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{p.invoice?.docNumber || '-'}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{p.reference || '-'}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{p.notes || '-'}</td>
                    <td>
                      {isAdmin && <button className="btn btn-ghost btn-sm" onClick={() => deletePayment(p)} aria-label={`ลบรายการชำระเงิน ${p.docNumber}`} title="ลบรายการชำระเงิน"><Trash2 size={14} /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ══ Tab: Chart of Accounts ══ */}
      {tab === 'accounts' && (
        <div className="card" style={{ overflowX: 'auto' }}>
          {loading ? (
            <TableSkeleton cols={5} />
          ) : failedSections.includes('บัญชี') && accounts.length === 0 ? null : accounts.length === 0 ? (
            <div style={{ padding: 60, textAlign: 'center' }}>
              <BookOpen size={48} style={{ color: 'var(--text-muted)', marginBottom: 12 }} />
              <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 12 }}>ยังไม่มีผังบัญชี</p>
              {isAdmin && <button className="btn btn-primary" onClick={seedAccounts}>สร้างผังบัญชีเริ่มต้น</button>}
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 100 }}>รหัส</th>
                  <th>ชื่อบัญชี</th>
                  <th>ประเภท</th>
                  <th>บัญชีแม่</th>
                  <th>สถานะ</th>
                  <th style={{ width: 80 }}></th>
                </tr>
              </thead>
              <tbody>
                {accounts.map(a => {
                  const typeCfg = ACCT_TYPES[a.type];
                  return (
                    <tr key={a.id}>
                      <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'var(--accent-primary)' }}>{a.code}</td>
                      <td style={{ paddingLeft: a.parentId ? 28 : 12, fontWeight: a.parentId ? 400 : 600 }}>{a.name}</td>
                      <td>
                        <span style={{
                          padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 600,
                          border: `1px solid ${typeCfg?.color || '#888'}`,
                          color: typeCfg?.color || '#888',
                        }}>
                          {typeCfg?.label || a.type}
                        </span>
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{a.parent ? `${a.parent.code} - ${a.parent.name}` : '-'}</td>
                      <td>{a.isActive ? <span style={{ color: 'var(--status-success)', fontSize: 11 }}>ใช้งาน</span> : <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>ปิดใช้งาน</span>}</td>
                      <td>
                        {isAdmin && (
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button className="btn btn-ghost btn-sm" onClick={() => openAcctEdit(a)} aria-label={`แก้ไขบัญชี ${a.code}`} title="แก้ไขบัญชี"><Edit2 size={14} /></button>
                            <button className="btn btn-ghost btn-sm" onClick={() => deleteAccount(a)} aria-label={`ลบบัญชี ${a.code}`} title="ลบบัญชี"><Trash2 size={14} /></button>
                          </div>
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

      {/* ══ Tab: Budgets ══ */}
      {tab === 'budgets' && (
        <div className="card" style={{ overflowX: 'auto' }}>
          {loading ? (
            <TableSkeleton cols={5} />
          ) : failedSections.includes('งบประมาณ') && budgets.length === 0 ? null : budgets.length === 0 ? (
            <div style={{ padding: 60, textAlign: 'center' }}>
              <BarChart3 size={48} style={{ color: 'var(--text-muted)', marginBottom: 12 }} />
              <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>ยังไม่มีงบประมาณ</p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>ชื่อ</th>
                  <th>บัญชี</th>
                  <th>ปี</th>
                  <th style={{ textAlign: 'right' }}>งบตั้ง</th>
                  <th style={{ textAlign: 'right' }}>ใช้ไป</th>
                  <th style={{ textAlign: 'right' }}>คงเหลือ</th>
                  <th>สถานะ</th>
                  <th style={{ width: 80 }}></th>
                </tr>
              </thead>
              <tbody>
                {budgets.map(b => {
                  const remaining = b.budgetAmount - b.spentAmount;
                  const pct = b.budgetAmount > 0 ? (b.spentAmount / b.budgetAmount) * 100 : 0;
                  return (
                    <tr key={b.id}>
                      <td style={{ fontWeight: 600 }}>{b.name}</td>
                      <td style={{ fontSize: 12 }}>{b.account ? `${b.account.code} - ${b.account.name}` : '-'}</td>
                      <td>{b.fiscalYear}</td>
                      <td style={{ textAlign: 'right' }}>฿{formatCurrency(b.budgetAmount)}</td>
                      <td style={{ textAlign: 'right', color: pct > 90 ? 'var(--status-danger)' : 'var(--text-primary)' }}>
                        ฿{formatCurrency(b.spentAmount)}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600, color: remaining < 0 ? 'var(--status-danger)' : 'var(--status-success)' }}>
                        ฿{formatCurrency(remaining)}
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ width: 60, height: 6, borderRadius: 99, background: 'var(--bg-tertiary)', overflow: 'hidden' }}>
                            <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', borderRadius: 99, background: pct > 90 ? 'var(--status-danger)' : pct > 70 ? '#ea580c' : 'var(--status-success)' }} />
                          </div>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{pct.toFixed(0)}%</span>
                        </div>
                      </td>
                      <td>
                        {isAdmin && (
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button className="btn btn-ghost btn-sm" onClick={() => openBudgetEdit(b)} aria-label={`แก้ไขงบประมาณ ${b.name}`} title="แก้ไขงบประมาณ"><Edit2 size={14} /></button>
                            <button className="btn btn-ghost btn-sm" onClick={() => deleteBudget(b)} aria-label={`ลบงบประมาณ ${b.name}`} title="ลบงบประมาณ"><Trash2 size={14} /></button>
                          </div>
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

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* Modals                                                               */}
      {/* ══════════════════════════════════════════════════════════════════════ */}

      {/* ── Invoice Form Modal ── */}
      {showInvForm && (
        <Modal open onClose={() => setShowInvForm(false)} title={<><Receipt size={16} style={{ color: 'var(--accent-primary)' }} /> {editingInv ? 'แก้ไขใบแจ้งหนี้' : (invForm.invoiceType === 'Sales' ? 'สร้างใบแจ้งหนี้' : 'สร้างใบรับวางบิล')}</>} width={720} describedById="accounts-invoice-form-description">
          <p id="accounts-invoice-form-description" style={{ marginTop: 0, marginBottom: 16, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            กำหนดข้อมูลเอกสาร คู่ค้า รายการสินค้า และยอดรวมก่อนบันทึกใบแจ้งหนี้หรือใบรับวางบิล
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div>
              <label className="form-label" htmlFor="accounts-field1">เลขที่เอกสาร</label>
              <input id="accounts-field1" className="form-control" value={invForm.docNumber} onChange={e => setInvForm(p => ({ ...p, docNumber: e.target.value }))} />
            </div>
            <div>
              <label className="form-label" htmlFor="accounts-field2">ประเภท</label>
              <select id="accounts-field2" className="form-control" value={invForm.invoiceType} onChange={e => setInvForm(p => ({ ...p, invoiceType: e.target.value as 'Sales' | 'Purchase' }))}>
                <option value="Sales">ใบแจ้งหนี้ (ขาย)</option>
                <option value="Purchase">ใบรับวางบิล (ซื้อ)</option>
              </select>
            </div>
            <div>
              <label className="form-label" htmlFor="accounts-date">วันที่ออก</label>
              <ThaiDateInput id="accounts-date" className="form-control" value={invForm.invoiceDate} onChange={e => setInvForm(p => ({ ...p, invoiceDate: e.target.value }))} />
            </div>
            <div>
              <label className="form-label" htmlFor="accounts-field5">ครบกำหนดชำระ</label>
              <ThaiDateInput id="accounts-field5" className="form-control" value={invForm.dueDate} onChange={e => setInvForm(p => ({ ...p, dueDate: e.target.value }))} />
            </div>
            {invForm.invoiceType === 'Sales' ? (
              <>
                <div>
                  <label className="form-label" htmlFor="accounts-field6">ลูกค้า</label>
                  <select id="accounts-field6" className="form-control" value={invForm.customerId}
                    onChange={e => {
                      const c = customers.find(c => c.id === e.target.value);
                      setInvForm(p => ({ ...p, customerId: e.target.value, customerName: c?.name || '' }));
                    }}>
                    <option value="">-- เลือกลูกค้า --</option>
                    {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label" htmlFor="accounts-field7">ชื่อลูกค้า</label>
                  <input id="accounts-field7" className="form-control" value={invForm.customerName} onChange={e => setInvForm(p => ({ ...p, customerName: e.target.value }))} placeholder="ชื่อที่จะแสดงในเอกสาร" />
                </div>
              </>
            ) : (
              <div style={{ gridColumn: 'span 2' }}>
                <label className="form-label" htmlFor="accounts-field8">ผู้จำหน่าย</label>
                <input id="accounts-field8" className="form-control" value={invForm.supplier} onChange={e => setInvForm(p => ({ ...p, supplier: e.target.value }))} />
              </div>
            )}
            <div>
              <label className="form-label" htmlFor="accounts-number">VAT %</label>
              <input id="accounts-number" type="number" className="form-control" value={invForm.taxRate} onChange={e => setInvForm(p => ({ ...p, taxRate: e.target.value }))} />
            </div>
            <div>
              <label className="form-label" htmlFor="accounts-field10">หมายเหตุ</label>
              <input id="accounts-field10" className="form-control" value={invForm.notes} onChange={e => setInvForm(p => ({ ...p, notes: e.target.value }))} />
            </div>
          </div>

          {/* Items */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span className="form-label" style={{ margin: 0 }}>รายการ</span>
              <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setInvItems(p => [...p, { description: '', quantity: 1, unit: 'ชิ้น', unitPrice: 0, remark: '' }])}>
                <PlusCircle size={14} /> เพิ่มรายการ
              </button>
            </div>
            <div style={{ border: '1px solid var(--border-color)', borderRadius: 8, overflow: 'hidden', overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr style={{ background: 'var(--bg-tertiary)' }}>
                    <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 11 }}>รายละเอียด</th>
                    <th style={{ padding: '8px 6px', textAlign: 'center', fontSize: 11, width: 70 }}>จำนวน</th>
                    <th style={{ padding: '8px 6px', textAlign: 'center', fontSize: 11, width: 70 }}>หน่วย</th>
                    <th style={{ padding: '8px 6px', textAlign: 'right', fontSize: 11, width: 110 }}>ราคา/หน่วย</th>
                    <th style={{ padding: '8px 6px', textAlign: 'right', fontSize: 11, width: 110 }}>รวม</th>
                    <th style={{ width: 36 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {invItems.map((item, idx) => (
                    <tr key={idx} style={{ borderTop: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '6px 10px' }}>
                        <input aria-label="รายละเอียด..." className="form-control" style={{ fontSize: 13 }} placeholder="รายละเอียด..." value={item.description}
                          onChange={e => setInvItems(p => p.map((it, i) => i === idx ? { ...it, description: e.target.value } : it))} />
                      </td>
                      <td style={{ padding: '6px' }}>
                        <input aria-label={`จำนวน แถวที่ ${idx + 1}`} type="number" className="form-control" style={{ textAlign: 'center', fontSize: 13 }} min={1} value={item.quantity}
                          onChange={e => setInvItems(p => p.map((it, i) => i === idx ? { ...it, quantity: Math.max(1, Number(e.target.value) || 1) } : it))} />
                      </td>
                      <td style={{ padding: '6px' }}>
                        <input aria-label={`หน่วย แถวที่ ${idx + 1}`} className="form-control" style={{ textAlign: 'center', fontSize: 13 }} value={item.unit}
                          onChange={e => setInvItems(p => p.map((it, i) => i === idx ? { ...it, unit: e.target.value } : it))} />
                      </td>
                      <td style={{ padding: '6px' }}>
                        <input aria-label={`ราคาต่อหน่วย แถวที่ ${idx + 1}`} type="number" className="form-control" style={{ textAlign: 'right', fontSize: 13 }} min={0} step={0.01} value={item.unitPrice}
                          onChange={e => setInvItems(p => p.map((it, i) => i === idx ? { ...it, unitPrice: Number(e.target.value) || 0 } : it))} />
                      </td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600, fontSize: 13 }}>
                        ฿{formatCurrency(Number(item.quantity) * Number(item.unitPrice))}
                      </td>
                      <td style={{ padding: '4px' }}>
                        {invItems.length > 1 && (
                          <button className="btn btn-ghost btn-sm" onClick={() => setInvItems(p => p.filter((_, i) => i !== idx))} aria-label={`ลบรายการ invoice ${idx + 1}`} title={`ลบรายการ invoice ${idx + 1}`}><MinusCircle size={14} style={{ color: 'var(--status-danger)' }} /></button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Totals */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
            <div style={{ minWidth: 220, border: '1px solid var(--border-color)', borderRadius: 8, padding: '12px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                <span>ยอดก่อน VAT</span><span>฿{formatCurrency(invSubtotal)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4, color: 'var(--text-secondary)' }}>
                <span>VAT {invForm.taxRate}%</span><span>฿{formatCurrency(invTaxAmount)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, fontWeight: 700, borderTop: '1px solid var(--border-color)', paddingTop: 8 }}>
                <span>รวมทั้งสิ้น</span><span style={{ color: 'var(--accent-primary)' }}>฿{formatCurrency(invTotal)}</span>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 12, borderTop: '1px solid var(--border-color)' }}>
            <button className="btn btn-outline" onClick={() => setShowInvForm(false)}>ยกเลิก</button>
            <FormSubmitButton loading={savingInv} onClick={saveInvoice}>
              <CheckCircle size={14} /> {editingInv ? 'บันทึก' : 'สร้าง'}
            </FormSubmitButton>
          </div>
        </Modal>
      )}

      {/* ── Invoice Detail Modal ── */}
      {viewingInv && (
        <Modal open onClose={() => setViewingInv(null)} title={<><Receipt size={16} style={{ color: 'var(--accent-primary)' }} /> {viewingInv.docNumber}</>} width={680} describedById="accounts-invoice-detail-description">
          <p id="accounts-invoice-detail-description" style={{ marginTop: 0, marginBottom: 16, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            ดูข้อมูลเอกสาร รายการสินค้า สรุปยอด และประวัติการชำระของใบแจ้งหนี้ฉบับนี้
          </p>
          {(() => {
            const statusCfg = INV_STATUS[viewingInv.status] || INV_STATUS.Draft;
            return (
              <div style={{ marginBottom: 16, padding: '12px 14px', borderRadius: 12, border: `1px solid ${statusCfg.border}`, background: statusCfg.bg }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, color: statusCfg.color, fontSize: 12, fontWeight: 700 }}>
                  {statusCfg.icon}
                  <span>สถานะปัจจุบัน: {statusCfg.label}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{getInvoiceStatusNarrative(viewingInv)}</div>
              </div>
            );
          })()}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>ประเภท</div>
              <div>{viewingInv.invoiceType === 'Sales' ? 'ใบแจ้งหนี้ (ขาย)' : 'ใบรับวางบิล (ซื้อ)'}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>สถานะ</div>
              <StatusBadge status={viewingInv.status} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{viewingInv.invoiceType === 'Sales' ? 'ลูกค้า' : 'ผู้จำหน่าย'}</div>
              <div style={{ fontWeight: 600 }}>{viewingInv.customerName || viewingInv.supplier || '-'}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>ครบกำหนด</div>
              <div>{formatDate(viewingInv.dueDate)}</div>
            </div>
            {viewingInv.sourceType && (
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>สร้างจาก</div>
                <div style={{ fontSize: 12, color: 'var(--accent-primary)' }}>{SOURCE_TYPE_LABELS[viewingInv.sourceType] || viewingInv.sourceType}: {viewingInv.sourceId?.slice(0, 8)}...</div>
              </div>
            )}
            {viewingInv.notes && (
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>หมายเหตุ</div>
                <div style={{ fontSize: 12 }}>{viewingInv.notes}</div>
              </div>
            )}
          </div>

          <table style={{ marginBottom: 16 }}>
            <thead>
              <tr style={{ background: 'var(--bg-tertiary)' }}>
                <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11 }}>#</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11 }}>รายการ</th>
                <th style={{ padding: '8px 12px', textAlign: 'center', fontSize: 11 }}>จำนวน</th>
                <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: 11 }}>ราคา/หน่วย</th>
                <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: 11 }}>รวม</th>
              </tr>
            </thead>
            <tbody>
              {viewingInv.items.map((item, i) => (
                <tr key={i} style={{ borderTop: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '8px 12px', textAlign: 'center' }}>{i + 1}</td>
                  <td style={{ padding: '8px 12px' }}>{item.description}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'center' }}>{item.quantity} {item.unit}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right' }}>฿{formatCurrency(item.unitPrice)}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>฿{formatCurrency(item.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
            <div style={{ minWidth: 220, border: '1px solid var(--border-color)', borderRadius: 8, padding: '12px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}><span>ยอดก่อน VAT</span><span>฿{formatCurrency(viewingInv.subtotal)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}><span>VAT {viewingInv.taxRate}%</span><span>฿{formatCurrency(viewingInv.taxAmount)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, fontWeight: 700, borderTop: '1px solid var(--border-color)', paddingTop: 8 }}>
                <span>รวมทั้งสิ้น</span><span style={{ color: 'var(--accent-primary)' }}>฿{formatCurrency(viewingInv.totalAmount)}</span>
              </div>
              {viewingInv.paidAmount > 0 && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginTop: 6, color: 'var(--status-success)' }}><span>ชำระแล้ว</span><span>฿{formatCurrency(viewingInv.paidAmount)}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--status-danger)' }}><span>คงเหลือ</span><span>฿{formatCurrency(viewingInv.totalAmount - viewingInv.paidAmount)}</span></div>
                </>
              )}
            </div>
          </div>

          {/* Payment history for this invoice */}
          {viewingInv.payments && viewingInv.payments.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: 'var(--text-secondary)' }}>ประวัติการชำระ</div>
              <table>
                <tbody>
                  {viewingInv.payments.map(p => (
                    <tr key={p.id} style={{ borderTop: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '6px 12px', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{p.docNumber}</td>
                      <td style={{ padding: '6px 12px', fontSize: 12 }}>{formatDate(p.paymentDate)}</td>
                      <td style={{ padding: '6px 12px', fontSize: 12 }}>{p.method}</td>
                      <td style={{ padding: '6px 12px', fontSize: 12, textAlign: 'right', fontWeight: 600, color: 'var(--status-success)' }}>฿{formatCurrency(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 12, borderTop: '1px solid var(--border-color)' }}>
            {viewingInv.status === 'Draft' && (
              <button className="btn btn-outline" onClick={() => { changeInvStatus(viewingInv, 'Issued'); setViewingInv(null); }}>
                <Send size={14} /> วางบิล
              </button>
            )}
            {(viewingInv.status === 'Draft' || viewingInv.status === 'Issued' || viewingInv.status === 'Partial') && (
              <button className="btn btn-primary" onClick={() => { setViewingInv(null); openPayCreate(viewingInv.id, viewingInv.invoiceType === 'Sales' ? 'Receive' : 'Pay'); }}>
                <CreditCard size={14} /> บันทึกชำระ
              </button>
            )}
            <button className="btn btn-outline" onClick={() => handlePrintInvoice(viewingInv)}>
              <Printer size={14} /> พิมพ์
            </button>
            <button className="btn btn-outline" onClick={() => setViewingInv(null)}>ปิด</button>
          </div>
        </Modal>
      )}

      {/* ── Payment Form Modal ── */}
      {showPayForm && (
        <Modal open onClose={() => setShowPayForm(false)} title={<><CreditCard size={16} style={{ color: 'var(--accent-primary)' }} /> บันทึกการชำระเงิน</>} width={500} describedById="accounts-payment-form-description">
          <p id="accounts-payment-form-description" style={{ marginTop: 0, marginBottom: 16, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            ระบุประเภทการรับหรือจ่าย วันที่ จำนวนเงิน วิธีชำระ และผูกกับ invoice ที่เกี่ยวข้องได้
          </p>
          <div style={{ display: 'grid', gap: 12, marginBottom: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label className="form-label" htmlFor="accounts-field11">เลขที่เอกสาร</label>
                <input id="accounts-field11" className="form-control" value={payForm.docNumber} onChange={e => setPayForm(p => ({ ...p, docNumber: e.target.value }))} />
              </div>
              <div>
                <label className="form-label" htmlFor="accounts-field12">ประเภท</label>
                <select id="accounts-field12" className="form-control" value={payForm.paymentType} onChange={e => setPayForm(p => ({ ...p, paymentType: e.target.value as 'Receive' | 'Pay' }))}>
                  <option value="Receive">รับเงิน</option>
                  <option value="Pay">จ่ายเงิน</option>
                </select>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label className="form-label" htmlFor="accounts-field14">วันที่</label>
                <ThaiDateInput id="accounts-field14" className="form-control" value={payForm.paymentDate} onChange={e => setPayForm(p => ({ ...p, paymentDate: e.target.value }))} />
              </div>
              <div>
                <label className="form-label" htmlFor="accounts-field16">จำนวนเงิน (฿)</label>
                <input id="accounts-field16" type="number" className="form-control" min={0} step={0.01} value={payForm.amount} onChange={e => setPayForm(p => ({ ...p, amount: e.target.value }))} placeholder="0.00" />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label className="form-label" htmlFor="accounts-field17">วิธีชำระ</label>
                <select id="accounts-field17" className="form-control" value={payForm.method} onChange={e => setPayForm(p => ({ ...p, method: e.target.value }))}>
                  <option value="Transfer">โอนเงิน</option>
                  <option value="Cash">เงินสด</option>
                  <option value="Cheque">เช็ค</option>
                  <option value="Credit">เครดิต</option>
                </select>
              </div>
              <div>
                <label className="form-label" htmlFor="accounts-field18">อ้างอิง (เลขที่สลิป/เช็ค)</label>
                <input id="accounts-field18" className="form-control" value={payForm.reference} onChange={e => setPayForm(p => ({ ...p, reference: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="form-label" htmlFor="accounts-field19">เชื่อม Invoice</label>
              <select id="accounts-field19" className="form-control" value={payForm.invoiceId} onChange={e => setPayForm(p => ({ ...p, invoiceId: e.target.value }))}>
                <option value="">-- ไม่เชื่อม Invoice --</option>
                {invoices.filter(i => i.status !== 'Cancelled' && i.status !== 'Paid').map(i => (
                  <option key={i.id} value={i.id}>{i.docNumber} — {i.customerName || i.supplier} — ฿{formatCurrency(i.totalAmount - i.paidAmount)} ค้างจ่าย</option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label" htmlFor="accounts-field20">หมายเหตุ</label>
              <input id="accounts-field20" className="form-control" value={payForm.notes} onChange={e => setPayForm(p => ({ ...p, notes: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 12, borderTop: '1px solid var(--border-color)' }}>
            <button className="btn btn-outline" onClick={() => setShowPayForm(false)}>ยกเลิก</button>
            <FormSubmitButton loading={savingPay} onClick={savePayment}>
              <CheckCircle size={14} /> บันทึก
            </FormSubmitButton>
          </div>
        </Modal>
      )}

      {/* ── Account Form Modal ── */}
      {showAcctForm && (
        <Modal open onClose={() => setShowAcctForm(false)} title={<><BookOpen size={16} style={{ color: 'var(--accent-primary)' }} /> {editingAcct ? 'แก้ไขบัญชี' : 'เพิ่มบัญชี'}</>} width={460} describedById="accounts-ledger-form-description">
          <p id="accounts-ledger-form-description" style={{ marginTop: 0, marginBottom: 16, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            ตั้งค่ารหัส ชื่อ ประเภท และบัญชีแม่ของผังบัญชีเพื่อใช้ในงานการเงินของระบบ
          </p>
          <div style={{ display: 'grid', gap: 12, marginBottom: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
              <div>
                <label className="form-label" htmlFor="accounts-field21">รหัส</label>
                <input id="accounts-field21" className="form-control" placeholder="เช่น 1100" value={acctForm.code} onChange={e => setAcctForm(p => ({ ...p, code: e.target.value }))} />
              </div>
              <div>
                <label className="form-label" htmlFor="accounts-field22">ชื่อบัญชี</label>
                <input id="accounts-field22" className="form-control" value={acctForm.name} onChange={e => setAcctForm(p => ({ ...p, name: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="form-label" htmlFor="accounts-field23">ประเภท</label>
              <select id="accounts-field23" className="form-control" value={acctForm.type} onChange={e => setAcctForm(p => ({ ...p, type: e.target.value }))}>
                {Object.entries(ACCT_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label} ({k})</option>)}
              </select>
            </div>
            <div>
              <label className="form-label" htmlFor="accounts-field24">บัญชีแม่ (Parent)</label>
              <select id="accounts-field24" className="form-control" value={acctForm.parentId} onChange={e => setAcctForm(p => ({ ...p, parentId: e.target.value }))}>
                <option value="">-- ไม่มี (Top-level) --</option>
                {accounts.filter(a => a.id !== editingAcct?.id).map(a => <option key={a.id} value={a.id}>{a.code} - {a.name}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 12, borderTop: '1px solid var(--border-color)' }}>
            <button className="btn btn-outline" onClick={() => setShowAcctForm(false)}>ยกเลิก</button>
            <FormSubmitButton loading={savingAcct} onClick={saveAccount}>
              <CheckCircle size={14} /> {editingAcct ? 'บันทึก' : 'สร้าง'}
            </FormSubmitButton>
          </div>
        </Modal>
      )}

      {/* ── Budget Form Modal ── */}
      {showBudgetForm && (
        <Modal open onClose={() => setShowBudgetForm(false)} title={<><BarChart3 size={16} style={{ color: 'var(--accent-primary)' }} /> {editingBudget ? 'แก้ไขงบประมาณ' : 'ตั้งงบประมาณ'}</>} width={460} describedById="accounts-budget-form-description">
          <p id="accounts-budget-form-description" style={{ marginTop: 0, marginBottom: 16, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            กำหนดงบประมาณตามบัญชี ปีงบ และวงเงิน เพื่อใช้ติดตามการใช้จ่ายเทียบแผน
          </p>
          <div style={{ display: 'grid', gap: 12, marginBottom: 16 }}>
            <div>
              <label className="form-label" htmlFor="accounts-field25">ชื่องบ</label>
              <input id="accounts-field25" className="form-control" placeholder='เช่น "ค่าอะไหล่ ปี 2026"' value={budgetForm.name} onChange={e => setBudgetForm(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
              <div>
                <label className="form-label" htmlFor="accounts-field26">บัญชี</label>
                <select id="accounts-field26" className="form-control" value={budgetForm.accountId} onChange={e => setBudgetForm(p => ({ ...p, accountId: e.target.value }))}>
                  <option value="">-- เลือกบัญชี --</option>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.code} - {a.name}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label" htmlFor="accounts-field27">ปีงบประมาณ</label>
                <input id="accounts-field27" className="form-control" value={budgetForm.fiscalYear} onChange={e => setBudgetForm(p => ({ ...p, fiscalYear: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="form-label" htmlFor="accounts-field29">จำนวนงบ (฿)</label>
              <input id="accounts-field29" type="number" className="form-control" min={0} step={0.01} value={budgetForm.budgetAmount} onChange={e => setBudgetForm(p => ({ ...p, budgetAmount: e.target.value }))} placeholder="0.00" />
            </div>
            <div>
              <label className="form-label" htmlFor="accounts-field30">หมายเหตุ</label>
              <input id="accounts-field30" className="form-control" value={budgetForm.notes} onChange={e => setBudgetForm(p => ({ ...p, notes: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 12, borderTop: '1px solid var(--border-color)' }}>
            <button className="btn btn-outline" onClick={() => setShowBudgetForm(false)}>ยกเลิก</button>
            <FormSubmitButton loading={savingBudget} onClick={saveBudget}>
              <CheckCircle size={14} /> {editingBudget ? 'บันทึก' : 'สร้าง'}
            </FormSubmitButton>
          </div>
        </Modal>
      )}
    </div>
  );
}
