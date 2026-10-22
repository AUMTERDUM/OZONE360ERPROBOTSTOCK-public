import React, { useState, useEffect, useMemo } from 'react';
import {
  Plus, Search, Eye, X, Printer, Edit2, Trash2,
  ChevronDown, PlusCircle, MinusCircle, ShoppingCart,
  CheckCircle, Package, Clock, XCircle, FileText,
} from 'lucide-react';
import api from '../api';
import { printPDF, logoSVG } from '../utils/printPDF';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../context/ConfirmContext';
import { ThaiDateInput } from '../components/ThaiDateInput';
import { useToast } from '../context/ToastContext';
import AttachmentPanel from '../components/AttachmentPanel';
import Pagination from '../components/Pagination';
import { Modal, FormSubmitButton, useUrlSearch, useTableSort, SortableTh, useOpenFromUrl } from '../components/UIUtils';
import PageHeader from '../components/PageHeader';
import CameraScanButton from '../components/CameraScanButton';
import { formatThaiDate, formatThaiDateTime, todayISO } from '../utils/thaiDate';

// ── Types ────────────────────────────────────────────────────────────────────

interface POItem {
  id?: string;
  sparePartId?: string;
  sku: string;
  partName: string;
  quantity: number;
  unitPrice: number;
  receivedQty: number;
  remark: string;
}

interface PurchaseOrder {
  id: string;
  docNumber: string;
  orderDate: string;
  supplier: string;
  supplierContact?: string;
  supplierPhone?: string;
  supplierChannel?: string;
  status: string;
  notes?: string;
  totalAmount: number;
  createdAt: string;
  createdBy?: string;
  approvedBy?: string;
  approvedAt?: string;
  receivedAt?: string;
  items: POItem[];
}

interface SparePart {
  id: string;
  sku: string;
  name: string;
  unitPrice: number;
  supplier?: string;
  stock: number;
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

function generateDocNumber() {
  const now = new Date();
  const y = now.getFullYear().toString().slice(-2);
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const rand = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
  return `PO${y}${m}${d}-${rand}`;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; border: string; icon: React.ReactNode }> = {
  Draft:      { label: 'ร่าง',         color: 'var(--text-primary)',   bg: 'var(--bg-tertiary)',        border: 'var(--border-color-strong)', icon: <Clock size={12} /> },
  Ordered:    { label: 'สั่งซื้อแล้ว', color: 'var(--status-info)',    bg: 'var(--status-info-bg)',     border: 'var(--status-info)', icon: <ShoppingCart size={12} /> },
  Partial:    { label: 'รับบางส่วน',   color: 'var(--status-warning)', bg: 'var(--status-warning-bg)',  border: 'var(--status-warning)', icon: <Package size={12} /> },
  Received:   { label: 'รับสินค้าแล้ว',color: 'var(--status-success)', bg: 'var(--status-success-bg)', border: 'var(--status-success)', icon: <CheckCircle size={12} /> },
  Cancelled:  { label: 'ยกเลิก',       color: 'var(--status-danger)',  bg: 'var(--status-danger-bg)',   border: 'var(--status-danger)', icon: <XCircle size={12} /> },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG['Draft'];
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

function getStatusNarrative(order: Pick<PurchaseOrder, 'status' | 'receivedAt' | 'approvedBy'>) {
  switch (order.status) {
    case 'Draft':
      return 'เอกสารยังแก้ไขได้ และยังไม่ถูกยืนยันสั่งซื้อ';
    case 'Ordered':
      return order.approvedBy
        ? `ยืนยันสั่งซื้อแล้วโดย ${order.approvedBy} และรอบันทึกรับสินค้า`
        : 'ยืนยันสั่งซื้อแล้ว และรอบันทึกรับสินค้า';
    case 'Partial':
      return 'รับสินค้าแล้วบางส่วน ควรตรวจสอบจำนวนที่คงค้างก่อนปิดเอกสาร';
    case 'Received':
      return order.receivedAt
        ? `รับสินค้าครบแล้วเมื่อ ${formatDate(order.receivedAt)}`
        : 'รับสินค้าครบแล้ว';
    case 'Cancelled':
      return 'เอกสารถูกยกเลิก และไม่อยู่ในคิวรับสินค้าต่อ';
    default:
      return 'ตรวจสอบสถานะของเอกสารนี้ก่อนดำเนินการต่อ';
  }
}

// ── Part Picker Modal ───────────────────────────────────────────────────────

type StockFilter = 'all' | 'instock' | 'low' | 'out';
const LOW_STOCK_THRESHOLD = 5;

function PartPickerModal({
  parts, onSelect, onClose,
}: { parts: SparePart[]; onSelect: (p: SparePart) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [stockFilter, setStockFilter] = useState<StockFilter>('all');

  const counts = useMemo(() => ({
    all: parts.length,
    instock: parts.filter(p => p.stock > LOW_STOCK_THRESHOLD).length,
    low: parts.filter(p => p.stock > 0 && p.stock <= LOW_STOCK_THRESHOLD).length,
    out: parts.filter(p => p.stock <= 0).length,
  }), [parts]);

  const ROW_CAP = 200;
  const shown = useMemo(() => {
    let list = parts;
    if (stockFilter === 'instock') list = list.filter(p => p.stock > LOW_STOCK_THRESHOLD);
    else if (stockFilter === 'low') list = list.filter(p => p.stock > 0 && p.stock <= LOW_STOCK_THRESHOLD);
    else if (stockFilter === 'out') list = list.filter(p => p.stock <= 0);
    if (q) {
      const lq = q.toLowerCase();
      list = list.filter(p => p.sku.toLowerCase().includes(lq) || p.name.toLowerCase().includes(lq));
    }
    return list;
  }, [parts, q, stockFilter]);
  const cappedShown = shown.slice(0, ROW_CAP);
  const hasMore = shown.length > ROW_CAP;

  const TABS: { key: StockFilter; label: string; color: string }[] = [
    { key: 'all',     label: 'ทั้งหมด',  color: '#555' },
    { key: 'instock', label: 'มีสต็อก',  color: '#2e7d32' },
    { key: 'low',     label: `สต็อกต่ำ (≤${LOW_STOCK_THRESHOLD})`, color: '#e65100' },
    { key: 'out',     label: 'หมด',      color: '#c62828' },
  ];

  return (
    <Modal open={true} onClose={onClose} title={<><Package size={16} style={{ color: 'var(--accent-primary)' }} /> เลือกอะไหล่</>} width={660} describedById="po-part-picker-description">

        <p id="po-part-picker-description" style={{ marginTop: 0, marginBottom: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
          ค้นหาและเลือกอะไหล่จากคลัง โดยกรองตามสถานะสต็อกได้ก่อนเพิ่มลงในใบสั่งซื้อ
        </p>

        <div className="search-box" style={{ marginBottom: 8 }}>
          <Search size={14} />
          <div style={{ display: 'flex', gap: 6 }}>
            <input aria-label="ค้นหา SKU, ชื่ออะไหล่..." autoFocus placeholder="ค้นหา SKU, ชื่ออะไหล่..." value={q} onChange={e => setQ(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
            <CameraScanButton onScan={setQ} />
          </div>
          {q && <button onClick={() => setQ('')} aria-label="ล้างคำค้นหาอะไหล่" title="ล้างคำค้นหาอะไหล่"><X size={13} /></button>}
        </div>

        {/* Filter tabs */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
          {TABS.map(tab => {
            const active = stockFilter === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setStockFilter(tab.key)}
                style={{
                  padding: '4px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  border: `1.5px solid ${active ? tab.color : 'var(--border-color)'}`,
                  background: active ? tab.color : 'transparent',
                  color: active ? 'var(--text-on-accent)' : tab.color,
                  transition: 'all 0.15s',
                }}
              >
                {tab.label}
                <span style={{
                  marginLeft: 6, fontSize: 10, fontWeight: 700,
                  background: active ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.08)',
                  borderRadius: 99, padding: '1px 6px',
                }}>
                  {counts[tab.key]}
                </span>
              </button>
            );
          })}
        </div>

        {/* Low-stock nudge banner (shown when all/no filter, and there are low-stock items) */}
        {stockFilter === 'all' && counts.low > 0 && !q && (
          <div
            onClick={() => setStockFilter('low')}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '7px 12px', marginBottom: 8, borderRadius: 8, cursor: 'pointer',
              background: '#fff3e0', border: '1px solid #ffb74d',
            }}
          >
            <span style={{ fontSize: 15 }}>⚠️</span>
            <span style={{ fontSize: 12, color: '#e65100', fontWeight: 600 }}>
              มี {counts.low} รายการที่สต็อกต่ำ (≤{LOW_STOCK_THRESHOLD}) — คลิกเพื่อดู
            </span>
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 8 }}>
          <table>
            <thead>
              <tr style={{ background: 'var(--bg-tertiary)' }}>
                <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', position: 'sticky', top: 0, background: 'var(--bg-tertiary)' }}>SKU</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', position: 'sticky', top: 0, background: 'var(--bg-tertiary)' }}>ชื่ออะไหล่</th>
                <th style={{ padding: '8px 12px', textAlign: 'center', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', position: 'sticky', top: 0, background: 'var(--bg-tertiary)', width: 70 }}>สต็อก</th>
                <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', position: 'sticky', top: 0, background: 'var(--bg-tertiary)', width: 110 }}>ราคา/หน่วย</th>
                <th style={{ width: 80, position: 'sticky', top: 0, background: 'var(--bg-tertiary)' }}></th>
              </tr>
            </thead>
            <tbody>
              {cappedShown.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: 28, textAlign: 'center', fontSize: 13, color: 'var(--text-secondary)' }}>ไม่พบอะไหล่</td></tr>
              ) : cappedShown.map(part => {
                const isLow = part.stock > 0 && part.stock <= LOW_STOCK_THRESHOLD;
                const isOut = part.stock <= 0;
                return (
                  <tr
                    key={part.id}
                    style={{ borderTop: '1px solid var(--border-color)', cursor: 'pointer', background: isLow ? '#fff8f0' : undefined }}
                    onClick={() => onSelect(part)}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--accent-subtle)')}
                    onMouseLeave={e => (e.currentTarget.style.background = isLow ? '#fff8f0' : '')}
                  >
                    <td style={{ padding: '9px 12px', fontSize: 12, fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'var(--accent-primary)' }}>{part.sku}</td>
                    <td style={{ padding: '9px 12px', fontSize: 13 }}>
                      {part.name}
                      {isLow && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: '#e65100', background: '#ffe0b2', borderRadius: 99, padding: '1px 6px' }}>สต็อกต่ำ</span>}
                    </td>
                    <td style={{ padding: '9px 12px', textAlign: 'center', fontSize: 12, fontWeight: 700, color: isOut ? 'var(--status-danger)' : isLow ? '#e65100' : 'var(--status-success)' }}>{part.stock}</td>
                    <td style={{ padding: '9px 12px', textAlign: 'right', fontSize: 13, fontWeight: 600 }}>฿{formatCurrency(part.unitPrice)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                      <button
                        className="btn btn-primary"
                        style={{ fontSize: 11, padding: '4px 14px' }}
                        onClick={e => { e.stopPropagation(); onSelect(part); }}
                      >
                        เลือก
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {hasMore && (
          <div style={{ padding: '8px 12px', fontSize: 11, color: '#e65100', background: '#fff3e0', borderTop: '1px solid #ffcc80', textAlign: 'center' }}>
            แสดง {ROW_CAP} รายการแรกจาก {shown.length} — พิมพ์เพื่อค้นหาให้แม่นยำขึ้น
          </div>
        )}
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-secondary)', textAlign: 'right' }}>{shown.length} รายการ</div>
    </Modal>
  );
}

// ── Receive Modal (partial receipt) ──────────────────────────────────────────

interface ReceiveModalProps {
  order: PurchaseOrder;
  onConfirm: (receivedItems: { id: string; qty: number }[], file?: File) => Promise<void>;
  onClose: () => void;
}

function ReceiveModal({ order, onConfirm, onClose }: ReceiveModalProps) {
  const already = (it: POItem) => Math.min(it.quantity, it.receivedQty || 0);
  const remaining = (it: POItem) => Math.max(0, it.quantity - already(it));
  // Quantity arriving in this delivery (defaults to everything still outstanding).
  const [qtys, setQtys] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (const it of order.items) init[it.id!] = remaining(it);
    return init;
  });
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const thisRound = (it: POItem) => qtys[it.id!] ?? remaining(it);

  const handleConfirm = async () => {
    if (busy) return;
    const receivedItems = order.items
      .filter(it => it.id)
      .map(it => ({ id: it.id!, qty: already(it) + thisRound(it) }));
    setBusy(true);
    try { await onConfirm(receivedItems, evidenceFile || undefined); } finally { setBusy(false); }
  };

  const totalReceived = order.items.reduce((s, it) => s + thisRound(it) * it.unitPrice, 0);
  const nothingToReceive = order.items.every(it => thisRound(it) === 0);

  return (
    <Modal open={true} onClose={onClose} preventClose={busy} title={<>บันทึกรับสินค้า — {order.docNumber}</>} width={640} describedById="po-receive-description">
      <p id="po-receive-description" style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>ระบุจำนวนที่ได้รับ<strong>ในรอบนี้</strong> (ค่าเริ่มต้น = จำนวนที่ยังค้างรับ) ส่วนที่เหลือรับต่อรอบหน้าได้</p>
        <table style={{ marginBottom: 16 }}>
          <thead>
            <tr style={{ background: 'var(--bg-tertiary)' }}>
              <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>SKU</th>
              <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>อะไหล่</th>
              <th style={{ padding: '8px 12px', textAlign: 'center', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>สั่ง</th>
              <th style={{ padding: '8px 12px', textAlign: 'center', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>รับแล้ว</th>
              <th style={{ padding: '8px 12px', textAlign: 'center', fontSize: 11, fontWeight: 600, color: 'var(--accent-primary)' }}>รับรอบนี้</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map(it => (
              <tr key={it.id} style={{ borderTop: '1px solid var(--border-color)' }}>
                <td style={{ padding: '8px 12px', fontVariantNumeric: 'tabular-nums', fontSize: 12, color: 'var(--text-secondary)' }}>{it.sku}</td>
                <td style={{ padding: '8px 12px', fontSize: 13 }}>{it.partName}</td>
                <td style={{ padding: '8px 12px', textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>{it.quantity}</td>
                <td style={{ padding: '8px 12px', textAlign: 'center', fontSize: 13, color: already(it) >= it.quantity ? 'var(--status-success)' : 'var(--text-muted)' }}>{already(it)}</td>
                <td style={{ padding: '6px 12px', textAlign: 'center' }}>
                  <input aria-label={`จำนวนที่รับรอบนี้ ${it.partName}`}
                    type="number"
                    min={0}
                    max={remaining(it)}
                    disabled={remaining(it) === 0}
                    className="form-control"
                    style={{ width: 70, textAlign: 'center', padding: '4px 8px', fontSize: 13 }}
                    value={thisRound(it)}
                    onChange={e => setQtys(prev => ({ ...prev, [it.id!]: Math.max(0, Math.min(remaining(it), Math.floor(Number(e.target.value) || 0))) }))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            มูลค่ารับ: <strong style={{ color: 'var(--accent-primary)' }}>฿{formatCurrency(totalReceived)}</strong>
          </div>
        </div>
        <div style={{ marginBottom: 16 }}>
          <label className="form-label" htmlFor="purchaseorders-file">ไฟล์หลักฐานการรับสินค้า <span style={{ color: 'var(--status-danger)' }}>*</span></label>
          <input id="purchaseorders-file" type="file" className="form-control" accept="image/*,.pdf" onChange={e => setEvidenceFile(e.target.files?.[0] || null)} />
          {!evidenceFile && <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-muted)' }}>ℹ️ แนะนำให้แนบไฟล์หลักฐาน แต่สามารถข้ามได้</div>}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', paddingTop: 12, borderTop: '1px solid var(--border-color)' }}>
          <button className="btn btn-outline" onClick={onClose} disabled={busy}>ยกเลิก</button>
          <button className="btn btn-success" disabled={busy || nothingToReceive} onClick={() => void handleConfirm()}>
            <CheckCircle size={14} /> {busy ? 'กำลังบันทึก...' : 'ยืนยันรับสินค้า'}
          </button>
        </div>
    </Modal>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

const EMPTY_ITEM: Omit<POItem, 'id' | 'receivedQty'> = {
  sku: '', partName: '', quantity: 1, unitPrice: 0, remark: '',
};

export default function PurchaseOrders() {
  const { user } = useAuth();
  const confirm = useConfirm();
  const { showToast } = useToast();
  const isAdmin = user?.role === 'ADMIN';

  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [spareParts, setSpareParts] = useState<SparePart[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useUrlSearch();
  const [filterStatus, setFilterStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  useOpenFromUrl(orders, o => o.id, o => { setSearch(o.docNumber); setSelectedOrderId(o.id); });
  const [selectedOrderLogs, setSelectedOrderLogs] = useState<LogEntry[]>([]);
  const [loadingOrderLogs, setLoadingOrderLogs] = useState(false);

  // Modal state
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<PurchaseOrder | null>(null);
  const [viewing, setViewing] = useState<PurchaseOrder | null>(null);
  const [receiveModal, setReceiveModal] = useState<PurchaseOrder | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    docNumber: generateDocNumber(),
    orderDate: todayISO(),
    supplier: '',
    supplierContact: '',
    supplierPhone: '',
    supplierChannel: '',
    notes: '',
    status: 'Draft',
  });
  const [formItems, setFormItems] = useState<Omit<POItem, 'id' | 'receivedQty'>[]>([{ ...EMPTY_ITEM }]);
  const [saving, setSaving] = useState(false);
  const [pickerIdx, setPickerIdx] = useState<number | null>(null);
  const [hidePrices, setHidePrices] = useState(false);

  // ── Fetch ────────────────────────────────────────────────────────────────
  const fetchAll = async () => {
    setLoading(true);
    try {
      const [poResult, spResult] = await Promise.allSettled([
        api.get<PurchaseOrder[]>('/purchase-orders'),
        api.get<SparePart[]>('/spare-parts'),
      ]);
      if (poResult.status === 'fulfilled') setOrders(poResult.value.data);
      else showToast('โหลดข้อมูล PO ล้มเหลว', 'error');
      if (spResult.status === 'fulfilled') setSpareParts(spResult.value.data);
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchAll(); }, []);

  // ── Filtered list ────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = orders;
    if (filterStatus) list = list.filter(o => o.status === filterStatus);
    if (dateFrom) list = list.filter(o => o.orderDate >= dateFrom);
    if (dateTo) list = list.filter(o => o.orderDate <= dateTo);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(o =>
        o.docNumber.toLowerCase().includes(q) ||
        o.supplier.toLowerCase().includes(q)
      );
    }
    return list;
  }, [orders, search, filterStatus, dateFrom, dateTo]);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  useEffect(() => { setPage(1); }, [search, filterStatus, dateFrom, dateTo]);
  const sort = useTableSort<PurchaseOrder>({
    docNumber: o => o.docNumber,
    orderDate: o => o.orderDate,
    supplier: o => o.supplier,
    items: o => o.items.length,
    totalAmount: o => o.totalAmount,
    status: o => o.status,
  });
  const paginated = sort.apply(filtered).slice((page - 1) * pageSize, page * pageSize);
  const selectedOrder = useMemo(
    () => orders.find(order => order.id === selectedOrderId) ?? null,
    [orders, selectedOrderId]
  );

  useEffect(() => {
    let ignore = false;

    const fetchOrderLogs = async () => {
      if (!selectedOrderId) {
        setSelectedOrderLogs([]);
        return;
      }
      setLoadingOrderLogs(true);
      try {
        const res = await api.get<LogEntry[]>(`/logs?entityType=PurchaseOrder&entityId=${encodeURIComponent(selectedOrderId)}`);
        if (!ignore) setSelectedOrderLogs(res.data);
      } catch {
        if (!ignore) setSelectedOrderLogs([]);
      } finally {
        if (!ignore) setLoadingOrderLogs(false);
      }
    };

    fetchOrderLogs();

    return () => {
      ignore = true;
    };
  }, [selectedOrderId]);

  useEffect(() => {
    if (filtered.length === 0) {
      setSelectedOrderId(null);
      return;
    }
    if (!selectedOrderId || !filtered.some(order => order.id === selectedOrderId)) {
      setSelectedOrderId(filtered[0].id);
    }
  }, [filtered, selectedOrderId]);

  // ── Open form ────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null);
    setFormData({
      docNumber: generateDocNumber(),
      orderDate: todayISO(),
      supplier: '', supplierContact: '', supplierPhone: '', supplierChannel: '', notes: '', status: 'Draft',
    });
    setFormItems([{ ...EMPTY_ITEM }]);
    setShowForm(true);
  };

  const openEdit = (o: PurchaseOrder) => {
    setEditing(o);
    setFormData({
      docNumber: o.docNumber,
      orderDate: o.orderDate,
      supplier: o.supplier,
      supplierContact: o.supplierContact || '',
      supplierPhone: o.supplierPhone || '',
      supplierChannel: o.supplierChannel || '',
      notes: o.notes || '',
      status: o.status,
    });
    setFormItems(o.items.map(i => ({
      sparePartId: i.sparePartId,
      sku: i.sku,
      partName: i.partName,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      remark: i.remark,
    })));
    setShowForm(true);
  };

  // ── Item helpers ─────────────────────────────────────────────────────────
  const addItem = () => { setFormItems(p => [...p, { ...EMPTY_ITEM }]); };

  const removeItem = (idx: number) => { setFormItems(p => p.filter((_, i) => i !== idx)); };

  const updateItem = (idx: number, key: keyof typeof EMPTY_ITEM, value: string | number) => {
    setFormItems(p => p.map((item, i) => i === idx ? { ...item, [key]: value } : item));
  };

  const updateItemMulti = (idx: number, updates: Partial<Omit<POItem, 'id' | 'receivedQty'>>) => {
    setFormItems(p => p.map((item, i) => i === idx ? { ...item, ...updates } : item));
  };

  const selectPart = (part: SparePart) => {
    if (pickerIdx === null) return;
    updateItemMulti(pickerIdx, { sparePartId: part.id, sku: part.sku, partName: part.name, unitPrice: part.unitPrice });
    setPickerIdx(null);
  };

  const totalAmount = formItems.reduce((s, i) => s + Number(i.quantity) * Number(i.unitPrice), 0);

  // ── Save ─────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!formData.supplier || !formData.orderDate) {
      showToast('กรุณากรอก ผู้จำหน่าย และ วันที่', 'error'); return;
    }
    if (formItems.some(i => !i.sku || !i.partName)) {
      showToast('กรุณากรอก SKU และชื่ออะไหล่ให้ครบ', 'error'); return;
    }
    setSaving(true);
    try {
      const payload = { ...formData, items: formItems };
      if (editing) {
        await api.put(`/purchase-orders/${editing.id}`, payload);
        showToast('บันทึกสำเร็จ', 'success');
      } else {
        await api.post('/purchase-orders', payload);
        showToast('สร้างใบสั่งซื้อสำเร็จ', 'success');
      }
      setShowForm(false);
      fetchAll();
    } catch (e: any) {
      showToast(e.response?.data?.error || 'บันทึกล้มเหลว', 'error');
    } finally { setSaving(false); }
  };

  // ── Status change ─────────────────────────────────────────────────────────
  const changeStatus = async (order: PurchaseOrder, status: string) => {
    const labels: Record<string,string> = { Ordered: 'ยืนยันสั่งซื้อ', Received: 'รับสินค้าแล้ว (จะเพิ่ม stock อะไหล่)', Cancelled: 'ยกเลิก' };
    const ok = await confirm(`${labels[status] || status} — "${order.docNumber}"?`, { danger: status === 'Cancelled' });
    if (!ok) return;
    try {
      await api.patch(`/purchase-orders/${order.id}/status`, { status });
      showToast('อัพเดทสถานะสำเร็จ', 'success');
      fetchAll();
      if (viewing?.id === order.id) setViewing(prev => prev ? { ...prev, status } : null);
    } catch (e: any) {
      showToast(e.response?.data?.error || 'ล้มเหลว', 'error');
    }
  };
  const handleReceive = async (receivedItems: { id: string; qty: number }[], file?: File) => {
    if (!receiveModal) return;
    try {
      if (file) {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('elementType', 'PurchaseOrder');
        fd.append('elementId', receiveModal.id);
        fd.append('attachmentType', 'photo');
        await api.post('/attachments', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      }
      const result = await api.patch(`/purchase-orders/${receiveModal.id}/status`, { status: 'Received', receivedItems });
      showToast(result.data?.status === 'Partial' ? 'บันทึกรับสินค้าบางส่วนแล้ว — ส่วนที่เหลือรับต่อได้ภายหลัง' : 'บันทึกรับสินค้าครบแล้ว', 'success');
      setReceiveModal(null);
      fetchAll();
      if (viewing?.id === receiveModal.id) setViewing(result.data);
    } catch (e: any) {
      showToast(e.response?.data?.error || 'ล้มเหลว', 'error');
    }
  };
  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDelete = async (order: PurchaseOrder) => {
    const ok = await confirm(`ลบ "${order.docNumber}"?`, { danger: true });
    if (!ok) return;
    try {
      await api.delete(`/purchase-orders/${order.id}`);
      showToast('ลบสำเร็จ', 'success');
      setOrders(p => p.filter(o => o.id !== order.id));
    } catch (e: any) {
      showToast(e.response?.data?.error || 'ลบล้มเหลว', 'error');
    }
  };

  // ── Print ─────────────────────────────────────────────────────────────────
  const handlePrint = (order: PurchaseOrder, hidePrice = hidePrices) => {
    const statusLabel = STATUS_CONFIG[order.status]?.label || order.status;
    const itemsHtml = order.items.map((item, i) => `
      <tr>
        <td style="text-align:center">${i + 1}</td>
        <td style="font-variant-numeric:tabular-nums">${item.sku}</td>
        <td>${item.partName}</td>
        <td style="text-align:center">${item.quantity}</td>
        ${hidePrice ? '' : `<td style="text-align:right">฿${formatCurrency(item.unitPrice)}</td>`}
        ${hidePrice ? '' : `<td style="text-align:right;font-weight:600">฿${formatCurrency(item.quantity * item.unitPrice)}</td>`}
        <td style="color:#6b7280">${item.remark || '-'}</td>
      </tr>`).join('');

    const html = `
      <div class="doc-header">
        ${logoSVG}
        <div class="doc-title-block">
          <div class="doc-type">ใบสั่งซื้ออะไหล่</div>
          <div class="doc-meta">
            เลขที่: <strong>${order.docNumber}</strong><br/>
            วันที่: ${formatDate(order.orderDate)}<br/>
            สถานะ: ${statusLabel}
          </div>
        </div>
      </div>

      <div class="info-grid">
        <div class="info-box">
          <h3>ผู้จำหน่าย</h3>
          <p><strong>${order.supplier}</strong></p>
          ${order.supplierContact ? `<p>ผู้ติดต่อ: ${order.supplierContact}</p>` : ''}
          ${order.supplierPhone ? `<p>โทร: ${order.supplierPhone}</p>` : ''}
          ${order.supplierChannel ? `<p>ช่องทางติดต่อ: ${order.supplierChannel}</p>` : ''}
        </div>
        <div class="info-box">
          <h3>ข้อมูลเพิ่มเติม</h3>
          ${order.approvedBy ? `<p>อนุมัติโดย: ${order.approvedBy} (${formatDate(order.approvedAt || '')})</p>` : ''}
          ${order.receivedAt ? `<p>รับสินค้า: ${formatDate(order.receivedAt)}</p>` : ''}
          ${order.notes ? `<p>หมายเหตุ: ${order.notes}</p>` : '<p>-</p>'}
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th style="width:40px">#</th>
            <th>SKU</th>
            <th>ชื่ออะไหล่</th>
            <th style="width:70px;text-align:center">จำนวน</th>
            ${hidePrice ? '' : '<th style="width:110px;text-align:right">ราคา/หน่วย</th>'}
            ${hidePrice ? '' : '<th style="width:110px;text-align:right">รวม</th>'}
            <th>หมายเหตุ</th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>

      ${hidePrice ? '' : `
      <div style="display:flex;justify-content:flex-end;margin-bottom:24px">
        <div style="border:1px solid var(--border-color);border-radius:6px;padding:12px 20px;min-width:200px">
          <div style="display:flex;justify-content:space-between;gap:32px;font-size:13pt">
            <span>รวมทั้งสิ้น</span>
            <strong style="font-size:15pt">฿${formatCurrency(order.totalAmount)}</strong>
          </div>
        </div>
      </div>`}

      <div class="sig-row" style="grid-template-columns:1fr 1fr 1fr">
        ${['ผู้จัดทำ', 'ผู้อนุมัติ', 'ผู้รับสินค้า'].map(label => `
          <div class="sig-box">
            <div class="sig-line"></div>
            <div class="sig-label">${label}</div>
          </div>`).join('')}
      </div>
    `;

    printPDF(html, `PO-${order.docNumber}`);
  };

  // ── Stats ─────────────────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    total: orders.length,
    draft: orders.filter(o => o.status === 'Draft').length,
    ordered: orders.filter(o => o.status === 'Ordered').length,
    received: orders.filter(o => o.status === 'Received').length,
    totalValue: orders.filter(o => o.status !== 'Cancelled').reduce((s, o) => s + o.totalAmount, 0),
  }), [orders]);

  const workspacePills = [
    { label: 'ร่าง', value: stats.draft, tone: 'neutral' },
    { label: 'สั่งซื้อแล้ว', value: stats.ordered, tone: 'info' },
    { label: 'รับสินค้าแล้ว', value: stats.received, tone: 'success' },
    { label: 'เอกสารที่ยังไม่ปิด', value: stats.draft + stats.ordered, tone: 'warning' },
  ] as const;

  const renderOrderActivityDetail = (log: LogEntry) => {
    const oldValues = parseJSON(log.oldValues);
    const newValues = parseJSON(log.newValues);

    if (log.action === 'attachment_added' && typeof newValues?.filename === 'string') {
      return `เพิ่มไฟล์ ${newValues.filename}`;
    }
    if (log.action === 'status_changed' && typeof oldValues?.status === 'string' && typeof newValues?.status === 'string') {
      const fromLabel = STATUS_CONFIG[oldValues.status]?.label || oldValues.status;
      const toLabel = STATUS_CONFIG[newValues.status]?.label || newValues.status;
      return `${fromLabel} -> ${toLabel}`;
    }
    if (log.action === 'created') {
      return 'สร้างใบสั่งซื้อใหม่';
    }
    if (log.action === 'updated') {
      return 'มีการปรับปรุงรายละเอียด PO';
    }
    if (log.action === 'deleted') {
      return 'เอกสารถูกลบออกจากระบบ';
    }
    return null;
  };

  const ACTION_LABELS: Record<string, string> = {
    created: 'สร้างใหม่',
    updated: 'แก้ไขข้อมูล',
    deleted: 'ลบ',
    status_changed: 'เปลี่ยนสถานะ',
    attachment_added: 'เพิ่มไฟล์แนบ',
  };

  const orderActivityTone = (action: string) => {
    if (action === 'created') return 'success';
    if (action === 'status_changed') return 'warning';
    if (action === 'attachment_added') return 'info';
    if (action === 'deleted') return 'danger';
    return 'neutral';
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="page-container">
      <PageHeader
        title="ใบสั่งซื้ออะไหล่"
        subtitle="จัดการการสั่งซื้ออะไหล่และติดตามการรับสินค้า"
        actions={<div className="accounts-header-note">พื้นที่ทำงานสไตล์ ERP สำหรับงานจัดซื้อ</div>}
      />

      <div className="accounts-workspace card">
        <div className="accounts-workspace-main">
          <div>
            <div className="accounts-workspace-eyebrow">พื้นที่ทำงาน</div>
            <h2 className="accounts-workspace-title">ศูนย์ควบคุมการจัดซื้อ</h2>
            <p className="accounts-workspace-subtitle">มุมทำงานสำหรับเอกสารซื้ออะไหล่ เน้นคิวเอกสารที่ยังเปิดอยู่ ข้อมูลผู้จำหน่ายโดยสรุป และสถานะการรับสินค้า</p>
          </div>
          <div className="accounts-workspace-actions">
            <button className="btn btn-primary" onClick={openCreate}>
              <Plus size={16} /><span>สร้างใบสั่งซื้อ</span>
            </button>
          </div>
        </div>
        <div className="accounts-workspace-pills">
          {workspacePills.map((pill) => (
            <div key={pill.label} className={`accounts-pill ${pill.tone}`}>
              <span>{pill.label}</span>
              <strong>{pill.value}</strong>
            </div>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="responsive-stats-grid" style={{ gap: 12, marginBottom: 20 }}>
        {[
          { label: 'ทั้งหมด', value: stats.total, color: 'var(--accent-primary)', bg: 'var(--accent-subtle)' },
          { label: 'ร่าง', value: stats.draft, color: 'var(--text-secondary)', bg: 'var(--bg-tertiary)' },
          { label: 'สั่งซื้อแล้ว', value: stats.ordered, color: 'var(--status-info)', bg: 'var(--status-info-bg)' },
          { label: 'รับสินค้าแล้ว', value: stats.received, color: 'var(--status-success)', bg: 'var(--status-success-bg)' },
          { label: 'มูลค่ารวม', value: `฿${formatCurrency(stats.totalValue)}`, color: 'var(--accent-primary)', bg: 'var(--accent-subtle)', wide: true },
        ].map(({ label, value, color, bg }) => (
          <div key={label} className="stat-card" style={{ padding: '12px 16px' }}>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="card responsive-toolbar" style={{ padding: '12px 16px', marginBottom: 16 }}>
        <div className="responsive-toolbar-search" style={{ display: 'flex', alignItems: 'center' }}>
          <Search size={15} style={{ position: 'absolute', left: 10, color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input aria-label="ค้นหาเลขที่เอกสาร, ผู้จำหน่าย..."
            className="form-control"
            style={{ paddingLeft: '2rem', paddingRight: '2rem', width: '100%' }}
            placeholder="ค้นหาเลขที่เอกสาร, ผู้จำหน่าย..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {!search && <CameraScanButton variant="inline" onScan={setSearch} />}
          {search && (
            <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 8, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }} aria-label="ล้างคำค้นหา PO" title="ล้างคำค้นหา PO">
              <X size={14} />
            </button>
          )}
        </div>
        <div className="responsive-toolbar-filters">
          {[{ key: '', label: 'ทั้งหมด', color: 'var(--text-secondary)', bg: 'var(--bg-tertiary)', icon: null as React.ReactNode }, ...Object.entries(STATUS_CONFIG).map(([k, v]) => ({ key: k, label: v.label, color: v.color, bg: v.bg, icon: v.icon }))].map(({ key, label, color, bg, icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilterStatus(key)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '5px 12px', borderRadius: 999, fontSize: 12, fontWeight: filterStatus === key ? 700 : 500,
                border: `1.5px solid ${filterStatus === key ? color : 'var(--border-color)'}`,
                background: filterStatus === key ? bg : 'transparent',
                color: filterStatus === key ? color : 'var(--text-secondary)',
                cursor: 'pointer', transition: 'all .15s',
              }}
            >
              {icon}{label}
            </button>
          ))}
        </div>
        <div className="responsive-toolbar-filters">
          <ThaiDateInput aria-label="กรองตั้งแต่วันที่" className="form-control" style={{ fontSize: 13 }} value={dateFrom} onChange={e => setDateFrom(e.target.value)} title="เริ่มต้น" />
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>–</span>
          <ThaiDateInput aria-label="กรองถึงวันที่" className="form-control" style={{ fontSize: 13 }} value={dateTo} onChange={e => setDateTo(e.target.value)} title="สิ้นสุด" />
          {(dateFrom || dateTo) && (
            <button type="button" className="btn btn-outline" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => { setDateFrom(''); setDateTo(''); }}>ล้าง</button>
          )}
        </div>
        <span className="responsive-toolbar-meta">{filtered.length} รายการ</span>
      </div>

      {/* Table */}
      <div className="accounts-document-grid">
        <div className="card" style={{ overflowX: 'auto' }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>กำลังโหลด...</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 60, textAlign: 'center' }}>
              <ShoppingCart size={40} style={{ color: 'var(--text-secondary)', marginBottom: 12 }} />
              <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>ไม่พบรายการ</div>
            </div>
          ) : (
            <div className="table-container table-responsive-cards" style={{ border: 'none' }}><table className="data-table">
            <thead>
              <tr>
                <SortableTh {...sort.th('docNumber')}>เลขที่เอกสาร</SortableTh>
                <SortableTh {...sort.th('orderDate')}>วันที่สั่ง</SortableTh>
                <SortableTh {...sort.th('supplier')}>ผู้จำหน่าย</SortableTh>
                <SortableTh {...sort.th('items')} style={{ textAlign: 'center' }}>รายการ</SortableTh>
                <SortableTh {...sort.th('totalAmount')} style={{ textAlign: 'right' }}>มูลค่า (฿)</SortableTh>
                <SortableTh {...sort.th('status')} style={{ textAlign: 'center' }}>สถานะ</SortableTh>
                <th style={{ textAlign: 'center' }}>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map(order => (
                <tr key={order.id} className={selectedOrderId === order.id ? 'accounts-row-selected' : ''}>
                  <td data-label="เลขที่เอกสาร">
                    <button
                      onClick={() => setSelectedOrderId(order.id)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, color: 'var(--accent-primary)', fontSize: 13 }}
                    >
                      {order.docNumber}
                    </button>
                  </td>
                  <td data-label="วันที่สั่ง" style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{formatDate(order.orderDate)}</td>
                  <td data-label="ผู้จำหน่าย" style={{ fontSize: 13, fontWeight: 500, cursor: 'pointer' }} onClick={() => setSelectedOrderId(order.id)}>{order.supplier}</td>
                  <td data-label="รายการ" style={{ textAlign: 'center', fontSize: 13 }}>{order.items.length}</td>
                  <td data-label="มูลค่า (฿)" style={{ textAlign: 'right', fontSize: 13, fontWeight: 600 }}>{formatCurrency(order.totalAmount)}</td>
                  <td data-label="สถานะ" style={{ textAlign: 'center' }}><StatusBadge status={order.status} /></td>
                  <td data-label="จัดการ">
                    <div className="responsive-table-actions" style={{ justifyContent: 'center' }}>
                      <button className="btn btn-ghost" style={{ padding: '4px 8px' }} onClick={() => setViewing(order)} title="ดูรายละเอียด" aria-label={`ดูรายละเอียด ${order.docNumber}`}>
                        <Eye size={14} />
                      </button>
                      <button className="btn btn-ghost" style={{ padding: '4px 8px' }} onClick={() => handlePrint(order)} title="พิมพ์" aria-label={`พิมพ์ ${order.docNumber}`}>
                        <Printer size={14} />
                      </button>
                      {order.status === 'Draft' && (
                        <button className="btn btn-ghost" style={{ padding: '4px 8px' }} onClick={() => openEdit(order)} title="แก้ไข" aria-label={`แก้ไข ${order.docNumber}`}>
                          <Edit2 size={14} />
                        </button>
                      )}
                      {isAdmin && (
                        <button className="btn btn-ghost" style={{ padding: '4px 8px', color: 'var(--status-danger)' }} onClick={() => handleDelete(order)} title="ลบ" aria-label={`ลบ ${order.docNumber}`}>
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            </table></div>
          )}
          <Pagination page={page} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
        </div>

        <div className="card accounts-document-panel">
          {selectedOrder ? (
            <>
              <div className="accounts-document-panel-head">
                <div>
                  <div className="accounts-document-kicker">ตรวจสอบใบสั่งซื้อ</div>
                  <div className="accounts-document-title">{selectedOrder.docNumber}</div>
                  <div className="accounts-document-meta">เปิดคำสั่งซื้อเมื่อ {formatDate(selectedOrder.orderDate)}</div>
                </div>
                <StatusBadge status={selectedOrder.status} />
              </div>

              <div className="accounts-panel-actions">
                <button className="btn btn-outline" onClick={() => setViewing(selectedOrder)} title="ดูรายละเอียดเต็ม" aria-label={`ดูรายละเอียดเต็ม ${selectedOrder.docNumber}`}><Eye size={14} /> ดูเต็ม</button>
                <button className="btn btn-outline" onClick={() => handlePrint(selectedOrder)} title="พิมพ์ใบสั่งซื้อ" aria-label={`พิมพ์ ${selectedOrder.docNumber}`}><Printer size={14} /> พิมพ์</button>
                {selectedOrder.status === 'Draft' && <button className="btn btn-outline" onClick={() => openEdit(selectedOrder)} title="แก้ไขใบสั่งซื้อ" aria-label={`แก้ไข ${selectedOrder.docNumber}`}><Edit2 size={14} /> แก้ไข</button>}
                {selectedOrder.status === 'Draft' && <button className="btn btn-primary" onClick={() => changeStatus(selectedOrder, 'Ordered')} title="ยืนยันสั่งซื้อ" aria-label={`ยืนยันสั่งซื้อ ${selectedOrder.docNumber}`}><ShoppingCart size={14} /> ยืนยันสั่งซื้อ</button>}
                {(selectedOrder.status === 'Ordered' || selectedOrder.status === 'Partial') && <button className="btn btn-primary" onClick={() => setReceiveModal(selectedOrder)} title="บันทึกรับสินค้า" aria-label={`บันทึกรับสินค้า ${selectedOrder.docNumber}`}><CheckCircle size={14} /> บันทึกรับสินค้า</button>}
              </div>

              {(() => {
                const statusCfg = STATUS_CONFIG[selectedOrder.status] || STATUS_CONFIG.Draft;
                return (
                  <div style={{ marginBottom: 16, padding: '12px 14px', borderRadius: 12, border: `1px solid ${statusCfg.color}`, background: statusCfg.bg }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, color: statusCfg.color, fontSize: 12, fontWeight: 700 }}>
                      {statusCfg.icon}
                      <span>สถานะปัจจุบัน: {statusCfg.label}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{getStatusNarrative(selectedOrder)}</div>
                  </div>
                );
              })()}

              <div className="accounts-info-stack">
                <div className="accounts-info-block">
                  <span>ผู้จำหน่าย</span>
                  <strong>{selectedOrder.supplier}</strong>
                </div>
                <div className="accounts-info-block">
                  <span>มูลค่าคำสั่งซื้อ</span>
                  <strong>฿{formatCurrency(selectedOrder.totalAmount)}</strong>
                </div>
                <div className="accounts-info-block">
                  <span>อนุมัติโดย</span>
                  <strong>{selectedOrder.approvedBy || 'รอการอนุมัติ'}</strong>
                </div>
                <div className="accounts-info-block">
                  <span>รับสินค้าเมื่อ</span>
                  <strong>{selectedOrder.receivedAt ? formatDate(selectedOrder.receivedAt) : 'ยังไม่ได้รับสินค้า'}</strong>
                </div>
              </div>

              <div className="accounts-totals-box">
                <div><span>รายการ</span><strong>{selectedOrder.items.length}</strong></div>
                <div><span>จำนวนที่รับแล้ว</span><strong>{selectedOrder.items.reduce((sum, item) => sum + (item.receivedQty || 0), 0)}</strong></div>
                <div><span>จำนวนที่สั่ง</span><strong>{selectedOrder.items.reduce((sum, item) => sum + item.quantity, 0)}</strong></div>
                <div className="accent"><span>รวม</span><strong>฿{formatCurrency(selectedOrder.totalAmount)}</strong></div>
              </div>

              <div className="accounts-side-section">
                <div className="accounts-side-section-title">ข้อมูลผู้จำหน่าย</div>
                <div className="accounts-line-list">
                  <div className="accounts-line-item compact">
                    <div>
                      <strong>{selectedOrder.supplier}</strong>
                      <span>{selectedOrder.supplierContact || 'ไม่ระบุผู้ติดต่อ'}{selectedOrder.supplierPhone ? ` · ${selectedOrder.supplierPhone}` : ''}{selectedOrder.supplierChannel ? ` · ${selectedOrder.supplierChannel}` : ''}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="accounts-side-section">
                <div className="accounts-side-section-title">รายการอะไหล่</div>
                <div className="accounts-line-list">
                  {selectedOrder.items.map((item, idx) => (
                    <div key={`${selectedOrder.id}-${idx}`} className="accounts-line-item compact">
                      <div>
                        <strong>{item.partName}</strong>
                        <span>{item.sku} · {item.quantity} ชิ้น{item.receivedQty ? ` · รับแล้ว ${item.receivedQty}` : ''}</span>
                      </div>
                      <strong>฿{formatCurrency(item.quantity * item.unitPrice)}</strong>
                    </div>
                  ))}
                </div>
              </div>

              <div className="accounts-side-section">
                <div className="accounts-side-section-title">ความเคลื่อนไหว</div>
                {loadingOrderLogs ? (
                  <div className="accounts-empty-note">กำลังโหลดประวัติ PO...</div>
                ) : selectedOrderLogs.length > 0 ? (
                  <div className="accounts-line-list">
                    {selectedOrderLogs.slice(0, 6).map(log => {
                      const detail = renderOrderActivityDetail(log);
                      return (
                        <div key={log.id} className={`accounts-activity-item tone-${orderActivityTone(log.action)}`}>
                          <div className="accounts-activity-topline">
                            <strong>{ACTION_LABELS[log.action] || log.action.replace(/_/g, ' ')}</strong>
                            <span>{formatDateTime(log.performedAt)}</span>
                          </div>
                          {detail && <div className="accounts-activity-detail">{detail}</div>}
                          <div className="accounts-activity-meta">โดย {log.performedBy || 'system'}</div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="accounts-empty-note">ยังไม่มี activity log สำหรับ PO นี้</div>
                )}
              </div>

              <div className="accounts-side-section">
                <div className="accounts-side-section-title">ไฟล์แนบ</div>
                <AttachmentPanel elementType="PurchaseOrder" elementId={selectedOrder.id} />
              </div>

              {selectedOrder.notes && (
                <div className="accounts-side-section">
                  <div className="accounts-side-section-title">หมายเหตุภายใน</div>
                  <div className="accounts-empty-note">{selectedOrder.notes}</div>
                </div>
              )}
            </>
          ) : (
            <div className="accounts-panel-empty">
              <ShoppingCart size={42} style={{ color: 'var(--text-muted)' }} />
              <div>
                <strong>เลือก PO จากรายการ</strong>
                <p>แผงด้านขวานี้ใช้ดู snapshot ของ supplier, line items และ action ถัดไปแบบ ERP workspace</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Detail Modal ──────────────────────────────────────────────────── */}
      {viewing && (
        <Modal open={true} onClose={() => setViewing(null)} title={<><FileText size={20} style={{ color: 'var(--accent-primary)' }} /> {viewing.docNumber} <StatusBadge status={viewing.status} /></>} width={820} describedById="po-view-description">
            <p id="po-view-description" style={{ marginTop: 0, marginBottom: '1rem', fontSize: 12, color: 'var(--text-secondary)' }}>
              แสดงข้อมูลผู้จำหน่าย รายการอะไหล่ มูลค่ารวม และ action ของใบสั่งซื้อฉบับนี้
            </p>
            <div className="responsive-action-group" style={{ justifyContent: 'flex-end', marginBottom: 16 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer', userSelect: 'none' }}>
                  <input
                    type="checkbox"
                    checked={hidePrices}
                    onChange={e => setHidePrices(e.target.checked)}
                    style={{ cursor: 'pointer' }}
                  />
                  ปิดราคา
                </label>
                <button className="btn btn-ghost" onClick={() => handlePrint(viewing)} aria-label={`พิมพ์ ${viewing.docNumber}`} title="พิมพ์ใบสั่งซื้อ"><Printer size={14} /><span>พิมพ์</span></button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 16 }}>
                สร้างโดย {viewing.createdBy || '-'} · {formatDate(viewing.createdAt)}
            </div>

            {(() => {
              const statusCfg = STATUS_CONFIG[viewing.status] || STATUS_CONFIG.Draft;
              return (
                <div style={{ marginBottom: 16, padding: '12px 14px', borderRadius: 12, border: `1px solid ${statusCfg.color}`, background: statusCfg.bg }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, color: statusCfg.color, fontSize: 12, fontWeight: 700 }}>
                    {statusCfg.icon}
                    <span>สถานะปัจจุบัน: {statusCfg.label}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{getStatusNarrative(viewing)}</div>
                </div>
              );
            })()}

            {/* Info */}
            <div className="responsive-grid-2" style={{ gap: 16, marginBottom: 20 }}>
              <div className="card" style={{ padding: 16, background: 'var(--bg-secondary)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 10 }}>ผู้จำหน่าย</div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{viewing.supplier}</div>
                {viewing.supplierContact && <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>ผู้ติดต่อ: {viewing.supplierContact}</div>}
                {viewing.supplierPhone && <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>โทร: {viewing.supplierPhone}</div>}
                {viewing.supplierChannel && <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>ช่องทางติดต่อ: {viewing.supplierChannel}</div>}
              </div>
              <div className="card" style={{ padding: 16, background: 'var(--bg-secondary)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 10 }}>ข้อมูล</div>
                <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div>วันที่สั่ง: <strong>{formatDate(viewing.orderDate)}</strong></div>
                  {viewing.approvedBy && <div>อนุมัติโดย: {viewing.approvedBy} ({formatDate(viewing.approvedAt || '')})</div>}
                  {viewing.receivedAt && <div>รับสินค้า: <strong style={{ color: 'var(--status-success)' }}>{formatDate(viewing.receivedAt)}</strong></div>}
                  {viewing.notes && <div style={{ color: 'var(--text-secondary)' }}>หมายเหตุ: {viewing.notes}</div>}
                </div>
              </div>
            </div>

            {/* Items */}
            <div style={{ border: '1px solid var(--border-color)', borderRadius: 10, overflowX: 'auto', marginBottom: 16 }}>
              <table>
                <thead>
                  <tr style={{ background: 'var(--bg-tertiary)' }}>
                    <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>SKU</th>
                    <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>ชื่ออะไหล่</th>
                    <th style={{ padding: '10px 14px', textAlign: 'center', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>จำนวน</th>
                    <th style={{ padding: '10px 14px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>ราคา/หน่วย</th>
                    <th style={{ padding: '10px 14px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>รวม (฿)</th>
                    {viewing.status === 'Received' && <th style={{ padding: '10px 14px', textAlign: 'center', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>รับแล้ว</th>}
                    <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>หมายเหตุ</th>
                  </tr>
                </thead>
                <tbody>
                  {viewing.items.map((item, i) => (
                    <tr key={item.id || i} style={{ borderTop: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '10px 14px', fontSize: 12, fontVariantNumeric: 'tabular-nums', color: 'var(--text-secondary)' }}>{item.sku}</td>
                      <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 500 }}>{item.partName}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'center', fontSize: 13 }}>{item.quantity}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 13 }}>{formatCurrency(item.unitPrice)}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 13, fontWeight: 600 }}>{formatCurrency(item.quantity * item.unitPrice)}</td>
                      {viewing.status === 'Received' && <td style={{ padding: '10px 14px', textAlign: 'center', fontSize: 13, color: 'var(--status-success)', fontWeight: 600 }}>{item.receivedQty}</td>}
                      <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-secondary)' }}>{item.remark || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Total */}
            <div className="responsive-action-group" style={{ justifyContent: 'flex-end', marginBottom: 20 }}>
              <div style={{ padding: '12px 20px', background: 'var(--accent-subtle)', borderRadius: 10, border: '1px solid var(--border-color)' }}>
                <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>รวมทั้งสิ้น: </span>
                <strong style={{ fontSize: 18, color: 'var(--accent-primary)' }}>฿{formatCurrency(viewing.totalAmount)}</strong>
              </div>
            </div>

            {/* Status actions */}
            {viewing.status !== 'Received' && viewing.status !== 'Cancelled' && (
              <div className="responsive-action-group" style={{ justifyContent: 'flex-end', paddingTop: 16, borderTop: '1px solid var(--border-color)' }}>
                {viewing.status === 'Draft' && (
                  <button className="btn btn-primary" onClick={() => changeStatus(viewing, 'Ordered')} title="ยืนยันสั่งซื้อ" aria-label={`ยืนยันสั่งซื้อ ${viewing.docNumber}`}>
                    <ShoppingCart size={14} /><span>ยืนยันสั่งซื้อ</span>
                  </button>
                )}
                {(viewing.status === 'Ordered' || viewing.status === 'Partial') && (
                  <button className="btn btn-primary" onClick={() => setReceiveModal(viewing)} title="บันทึกรับสินค้า" aria-label={`บันทึกรับสินค้า ${viewing.docNumber}`}>
                    <CheckCircle size={14} /><span>บันทึกรับสินค้า</span>
                  </button>
                )}
                <button className="btn btn-ghost" style={{ color: 'var(--status-danger)' }} onClick={() => changeStatus(viewing, 'Cancelled')} title="ยกเลิกใบสั่งซื้อ" aria-label={`ยกเลิก ${viewing.docNumber}`}>
                  <XCircle size={14} /><span>ยกเลิก</span>
                </button>
              </div>
            )}
        </Modal>
      )}

      {/* ── Create/Edit Modal ─────────────────────────────────────────────── */}
      {showForm && (
        <Modal open={true} onClose={() => setShowForm(false)} title={editing ? 'แก้ไขใบสั่งซื้อ' : 'สร้างใบสั่งซื้ออะไหล่'} width={900} preventClose={saving} describedById="po-form-description">

            <p id="po-form-description" style={{ marginTop: 0, marginBottom: '1rem', fontSize: 12, color: 'var(--text-secondary)' }}>
              ใช้ฟอร์มนี้เพื่อกำหนดผู้จำหน่าย รายการอะไหล่ จำนวน ราคา และหมายเหตุของใบสั่งซื้อ
            </p>

            {/* Header fields */}
            <div className="responsive-grid-3" style={{ gap: 12, marginBottom: 20 }}>
              <div className="form-group">
                <label className="form-label" htmlFor="purchaseorders-field2">เลขที่เอกสาร</label>
                <input id="purchaseorders-field2" className="form-control" value={formData.docNumber} onChange={e => setFormData(p => ({ ...p, docNumber: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="purchaseorders-date">วันที่สั่งซื้อ *</label>
                <ThaiDateInput id="purchaseorders-date" className="form-control" value={formData.orderDate} onChange={e => setFormData(p => ({ ...p, orderDate: e.target.value }))} />
              </div>
              <div className="form-group">
                <span className="form-label" id="po-status-label">สถานะ</span>
                <div role="group" aria-labelledby="po-status-label" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                  {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setFormData(p => ({ ...p, status: k }))}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        padding: '6px 14px', borderRadius: 999, fontSize: 12, fontWeight: 600,
                        border: `1.5px solid ${formData.status === k ? v.color : 'var(--border-color)'}`,
                        background: formData.status === k ? v.bg : 'transparent',
                        color: formData.status === k ? v.color : 'var(--text-secondary)',
                        cursor: 'pointer', transition: 'all .15s',
                      }}
                    >
                      {v.icon}{v.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="purchaseorders-field4">บริษัท *</label>
                <input id="purchaseorders-field4" className="form-control" value={formData.supplier} onChange={e => setFormData(p => ({ ...p, supplier: e.target.value }))} placeholder="ชื่อบริษัท / ร้านค้า" />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="purchaseorders-field5">ผู้ติดต่อ</label>
                <input id="purchaseorders-field5" className="form-control" value={formData.supplierContact} onChange={e => setFormData(p => ({ ...p, supplierContact: e.target.value }))} placeholder="ชื่อผู้ติดต่อ" />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="purchaseorders-field6">เบอร์โทร</label>
                <input id="purchaseorders-field6" className="form-control" value={formData.supplierPhone} onChange={e => setFormData(p => ({ ...p, supplierPhone: e.target.value }))} placeholder="เบอร์โทรศัพท์" />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="purchaseorders-field7">ช่องทางติดต่อ</label>
                <input id="purchaseorders-field7" className="form-control" value={formData.supplierChannel} onChange={e => setFormData(p => ({ ...p, supplierChannel: e.target.value }))} placeholder="เช่น Line ID, อีเมล, เว็บไซต์" />
              </div>
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label className="form-label" htmlFor="purchaseorders-field8">หมายเหตุ</label>
                <textarea id="purchaseorders-field8" className="form-control" rows={2} value={formData.notes} onChange={e => setFormData(p => ({ ...p, notes: e.target.value }))} placeholder="หมายเหตุเพิ่มเติม" style={{ resize: 'vertical' }} />
              </div>
            </div>

            {/* Items */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                  <Package size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                  รายการอะไหล่
                </h3>
                <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={addItem}>
                  <PlusCircle size={14} /><span>เพิ่มรายการ</span>
                </button>
              </div>

              <div style={{ border: '1px solid var(--border-color)', borderRadius: 10, overflow: 'visible' }}>
                <table>
                  <thead>
                    <tr style={{ background: 'var(--bg-tertiary)' }}>
                      <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>อะไหล่</th>
                      <th style={{ padding: '8px 12px', textAlign: 'center', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', width: 82 }}>จำนวน</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', width: 120 }}>ราคา/หน่วย</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', width: 100 }}>รวม</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>หมายเหตุ</th>
                      <th style={{ width: 40 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {formItems.map((item, idx) => (
                      <tr key={idx} style={{ borderTop: '1px solid var(--border-color)' }}>
                        {/* Part selector */}
                        <td style={{ padding: '6px 10px' }}>
                          {item.sku ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <div
                                style={{
                                  flex: 1, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0,
                                  background: 'var(--accent-subtle)', border: '1px solid var(--border-color)',
                                  borderRadius: 6, padding: '5px 10px', cursor: 'pointer',
                                }}
                                onClick={() => setPickerIdx(idx)}
                                title="คลิกเพื่อเปลี่ยนอะไหล่"
                              >
                                <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 11, fontWeight: 700, color: 'var(--accent-primary)', flexShrink: 0 }}>{item.sku}</span>
                                <span style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>{item.partName}</span>
                              </div>
                              <button
                                title="ล้างการเลือก"
                                onClick={() => updateItemMulti(idx, { sku: '', partName: '', sparePartId: undefined, unitPrice: 0 })}
                                aria-label={`ล้างอะไหล่ในแถว ${idx + 1}`}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 2, flexShrink: 0, lineHeight: 1 }}
                              >
                                <X size={14} />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setPickerIdx(idx)}
                              style={{
                                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                                padding: '7px 12px', fontSize: 12, color: 'var(--accent-primary)',
                                background: 'none', border: '1.5px dashed var(--accent-primary)', borderRadius: 6,
                                cursor: 'pointer', opacity: 0.8, transition: 'opacity .15s',
                              }}
                              onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                              onMouseLeave={e => (e.currentTarget.style.opacity = '0.8')}
                            >
                              <Search size={13} /><span>เลือกอะไหล่</span>
                            </button>
                          )}
                        </td>
                        <td style={{ padding: '6px 8px' }}>
                          <input aria-label={`จำนวน แถวที่ ${idx + 1}`}
                            className="form-control"
                            type="number"
                            min={1}
                            style={{ fontSize: 12, padding: '5px 8px', textAlign: 'center' }}
                            value={item.quantity}
                            onChange={e => updateItem(idx, 'quantity', Number(e.target.value))}
                          />
                        </td>
                        <td style={{ padding: '6px 8px' }}>
                          <input aria-label={`ราคาต่อหน่วย แถวที่ ${idx + 1}`}
                            className="form-control"
                            type="number"
                            min={0}
                            step="0.01"
                            style={{ fontSize: 12, padding: '5px 8px', textAlign: 'right' }}
                            value={item.unitPrice}
                            onChange={e => updateItem(idx, 'unitPrice', Number(e.target.value))}
                          />
                        </td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', fontSize: 12, fontWeight: 600, color: 'var(--accent-primary)' }}>
                          ฿{formatCurrency(item.quantity * item.unitPrice)}
                        </td>
                        <td style={{ padding: '6px 8px' }}>
                          <input aria-label="หมายเหตุ"
                            className="form-control"
                            style={{ fontSize: 12, padding: '5px 8px' }}
                            value={item.remark}
                            onChange={e => updateItem(idx, 'remark', e.target.value)}
                            placeholder="หมายเหตุ"
                          />
                        </td>
                        <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                          <button
                            onClick={() => removeItem(idx)}
                            disabled={formItems.length === 1}
                            aria-label={`ลบรายการอะไหล่แถว ${idx + 1}`}
                            title={`ลบรายการอะไหล่แถว ${idx + 1}`}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--status-danger)', opacity: formItems.length === 1 ? 0.3 : 1 }}
                          >
                            <MinusCircle size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Total */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 20 }}>
              <div style={{ padding: '10px 18px', background: 'var(--accent-subtle)', borderRadius: 8, border: '1px solid var(--border-color)' }}>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>รวมทั้งสิ้น: </span>
                <strong style={{ fontSize: 16, color: 'var(--accent-primary)' }}>฿{formatCurrency(totalAmount)}</strong>
              </div>
            </div>

            {/* Footer buttons */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 16, borderTop: '1px solid var(--border-color)' }}>
              <button className="btn btn-ghost" onClick={() => setShowForm(false)} disabled={saving}>ยกเลิก</button>
              <FormSubmitButton loading={saving} onClick={handleSave}>
                {editing ? 'บันทึกการแก้ไข' : 'สร้างใบสั่งซื้อ'}
              </FormSubmitButton>
            </div>
        </Modal>
      )}

      {/* ── Part Picker ────────────────────────────────────────────────────── */}
      {pickerIdx !== null && (
        <PartPickerModal
          parts={spareParts}
          onSelect={selectPart}
          onClose={() => setPickerIdx(null)}
        />
      )}

      {/* ── Receive Modal ─────────────────────────────────────────────────── */}
      {receiveModal && (
        <ReceiveModal
          order={receiveModal}
          onConfirm={handleReceive}
          onClose={() => setReceiveModal(null)}
        />
      )}
    </div>
  );
}
