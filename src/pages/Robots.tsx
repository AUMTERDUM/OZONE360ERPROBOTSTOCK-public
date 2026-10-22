import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import ModelAvatar from '../components/ModelAvatar';
import { todayISO } from '../utils/thaiDate';
import { useNavigate } from 'react-router-dom';
import { useData, type Robot } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../context/ConfirmContext';
import { useToast } from '../context/ToastContext';
import { FileText, Plus, Edit2, Trash2, Search, X, Wifi, ShieldCheck, CalendarClock, Wrench, StickyNote, Battery, Weight, ChevronRight, User, Download, Archive, CheckSquare, Square, ChevronDown, QrCode, RefreshCw, Upload, FileSpreadsheet, CheckCircle, AlertCircle, SkipForward, ScanLine, Paperclip } from 'lucide-react';
import { printPDF, logoSVG } from '../utils/printPDF';
import { ThaiDateInput } from '../components/ThaiDateInput';
import api from '../api';
import { CustomerCombobox } from '../components/CustomerCombobox';
import Pagination from '../components/Pagination';
import CameraScanButton from '../components/CameraScanButton';
import { TableSkeleton, EmptyState, RobotStatusBadge, RefreshButton, useEscapeKey, Modal, FormSubmitButton, useUrlSearch, useTableSort, SortableTh, BodyPortal, useOpenFromUrl } from '../components/UIUtils';
import PageHeader from '../components/PageHeader';
import Timeline from '../components/Timeline';
import { escapeHtml } from '../utils/printPDF';
import { loanStatusLabels, robotStatusLabels } from '../utils/statusLabels';

const parseRobotModelSkus = (value?: string | null) =>
  Array.from(new Set(
    String(value || '')
      .split(/[\n,]+/)
      .map(item => item.trim())
      .filter(Boolean)
  ));

const Robots: React.FC = () => {
  const { robots, models, customers, tickets, loading, addRobot, updateRobot, deleteRobot, quickAddCustomer, fetchData } = useData();
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [filter, setFilter] = useState('All');
  const [modelFilter, setModelFilter] = useState('All');
  const [customerFilter, setCustomerFilter] = useState('All');
  const [search, setSearch] = useUrlSearch();
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRobot, setEditingRobot] = useState<Robot | null>(null);
  const [selectedRobot, setSelectedRobot] = useState<Robot | null>(null);
  useOpenFromUrl(robots, r => r.id, setSelectedRobot);
  const [pendingCustName, setPendingCustName] = useState('');

  const [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([]);
  const [robotLoans, setRobotLoans] = useState<any[]>([]);
  const [robotLoansLoading, setRobotLoansLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<Robot['status']>('In Stock');
  const [bulkSaving, setBulkSaving] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [refreshing, setRefreshing] = useState(false);

  // ── Import status from Excel ──
  const { showToast } = useToast();
  const [importOpen, setImportOpen] = useState(false);
  const [importStep, setImportStep] = useState<'select' | 'preview' | 'done'>('select');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importPreview, setImportPreview] = useState<any>(null);
  const [importResult, setImportResult] = useState<any>(null);
  const importFileRef = useRef<HTMLInputElement>(null);

  const [formSaving, setFormSaving] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferRobot, setTransferRobot] = useState<Robot | null>(null);
  const [transferCustomerId, setTransferCustomerId] = useState('');
  const [transferPendingCustName, setTransferPendingCustName] = useState('');
  const [transferSaving, setTransferSaving] = useState(false);
  const [transferError, setTransferError] = useState('');
  const [scanAddOpen, setScanAddOpen] = useState(false);
  const [scanSubmitting, setScanSubmitting] = useState(false);
  const [scanForm, setScanForm] = useState({
    sku: '',
    serialNumber: '',
    purchaseDate: todayISO(),
    locationId: '',
    notes: '',
  });
  const scanSkuRef = useRef<HTMLInputElement>(null);
  const scanSerialRef = useRef<HTMLInputElement>(null);
  const scanSubmittingRef = useRef(false);

  useEscapeKey(() => setSelectedRobot(null), !!selectedRobot);
  useEscapeKey(() => { if (!transferSaving) setTransferOpen(false); }, transferOpen);
  useEscapeKey(() => { if (!importLoading) setImportOpen(false); }, importOpen);
  useEscapeKey(() => { if (!scanSubmitting) setScanAddOpen(false); }, scanAddOpen);

  const openImportModal = useCallback(() => {
    setImportStep('select');
    setImportFile(null);
    setImportPreview(null);
    setImportResult(null);
    setImportOpen(true);
  }, []);

  const handleImportFile = useCallback(async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!ext || !['xlsx', 'xls'].includes(ext)) {
      showToast('รองรับเฉพาะไฟล์ .xlsx หรือ .xls', 'error');
      return;
    }
    setImportFile(file);
    setImportLoading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post('/robots/import-status/preview', fd);
      setImportPreview(res.data);
      setImportStep('preview');
    } catch (e: any) {
      showToast(e?.response?.data?.error || 'อัปโหลดไม่สำเร็จ', 'error');
    } finally {
      setImportLoading(false);
    }
  }, [showToast]);

  const handleImportConfirm = useCallback(async () => {
    if (!importFile) return;
    setImportLoading(true);
    try {
      const fd = new FormData();
      fd.append('file', importFile);
      const res = await api.post('/robots/import-status/confirm', fd);
      setImportResult(res.data);
      setImportStep('done');
      await fetchData();
      showToast(`นำเข้าสำเร็จ: เพิ่ม ${res.data.created} / อัปเดต ${res.data.updated} เครื่อง`, 'success');
    } catch (e: any) {
      showToast(e?.response?.data?.error || 'นำเข้าไม่สำเร็จ', 'error');
    } finally {
      setImportLoading(false);
    }
  }, [importFile, fetchData, showToast]);

  useEffect(() => {
    api.get('/warehouses').then(r => setWarehouses(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    const savedLocationId = window.localStorage.getItem('robots.scanAdd.locationId');
    setScanForm(prev => ({
      ...prev,
      locationId: savedLocationId || '',
    }));
  }, []);

  useEffect(() => {
    if (!selectedRobot) { setRobotLoans([]); return; }
    // ดึงตอนเปิด drawer — ถ้าไม่กัน จะโชว์ "ไม่มีประวัติการยืม" แวบหนึ่งทุกครั้งก่อนข้อมูลมา
    setRobotLoansLoading(true);
    api.get('/loans', { params: { robotId: selectedRobot.id } })
      .then(r => setRobotLoans(r.data))
      .catch(() => {})
      .finally(() => setRobotLoansLoading(false));
  }, [selectedRobot?.id]);

  const printRobotQR = (robot: Robot) => {
    const model = modelById.get(robot.modelId);
    const robotUrl = `${window.location.origin}/robot/${encodeURIComponent(robot.serialNumber)}`;
    const w = window.open('', '_blank', 'width=360,height=560');
    if (!w) return;
    w.document.write(`
      <html><head><title>ป้าย QR - ${robot.serialNumber}</title>
      <base href="${window.location.origin}/"/>
      <link href="https://fonts.googleapis.com/css2?family=Prompt:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet"/>
      <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script>
      <style>
        *{margin:0;padding:0;box-sizing:border-box}
        @page{size:A4 portrait;margin:12mm}
        html,body{width:210mm;min-height:297mm}
        body{font-family:'Prompt',sans-serif;display:flex;justify-content:center;align-items:center;min-height:calc(297mm - 24mm);background:#e8ecf4}
        .label{background:#fff;border-radius:14px;width:300px;overflow:hidden;box-shadow:0 8px 32px rgba(30,58,138,.18)}
        .header{background:#fff;padding:14px 18px 10px;display:flex;align-items:center;justify-content:center;border-bottom:3px solid #1e3a8a}
        .body{padding:16px 18px 14px;text-align:center}
        .accent-bar{height:4px;background:linear-gradient(90deg,#f97316 0%,#fb923c 40%,#1e3a8a 100%)}
        #qr{display:inline-flex;justify-content:center;padding:8px;background:#f0f4ff;border-radius:10px;border:2px solid #c7d2fe;margin:10px 0 8px}
        .serial{font-size:17px;font-weight:800;font-variant-numeric:tabular-nums;color:#1e3a8a;letter-spacing:1.5px;margin:6px 0 3px}
        .model{font-size:12px;color:#475569;margin-bottom:8px;font-weight:500}
        .status{display:inline-block;padding:3px 14px;border-radius:999px;font-size:11px;font-weight:700;background:#fff7ed;color:#ea580c;border:1.5px solid #fdba74;margin-bottom:10px}
        .url{font-size:8px;color:#94a3b8;word-break:break-all;padding:5px 8px;background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0;line-height:1.4}
        .footer{font-size:9px;color:#f97316;text-align:center;padding:8px 0 9px;background:#1e3a8a;letter-spacing:2px;font-weight:700;text-transform:uppercase}
        @media print{
          body{background:#fff}
          .label{box-shadow:none;border-radius:0}
          button{display:none}
          *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
        }
      </style></head><body>
      <div class="label">
        <div class="header">
          <img src="ozone360-logo-real.png" alt="OZONE360" style="height:52px;width:auto;object-fit:contain;display:block;"/>
        </div>
        <div class="accent-bar"></div>
        <div class="body">
          <div id="qr"></div>
          <div class="serial">${robot.serialNumber}</div>
          <div class="model">${model?.name || 'ไม่ทราบรุ่น'}</div>
          <span class="status">${robotStatusLabels[robot.status] || robot.status}</span>
          <div class="url">${robotUrl}</div>
        </div>
        <div class="footer">ป้ายทรัพย์สินหุ่นยนต์</div>
      </div>
      <script>
        window.addEventListener('load',function(){
          new QRCode(document.getElementById('qr'),{text:'${robotUrl}',width:148,height:148,colorDark:'#1e3a8a',colorLight:'#f0f4ff'});
          document.fonts.ready.then(function(){setTimeout(function(){window.print();},300);});
        });
      <\/script>
      </body></html>`);
    w.document.close();
  };

  const printSelectedRobotQR = (robotIds: Set<string>) => {
    const selected = filteredRobots.filter(r => robotIds.has(r.id));
    if (!selected.length) return;
    const w = window.open('', '_blank', 'width=900,height=700');
    if (!w) return;
    const labels = selected.map((robot, index) => {
      const url = `${window.location.origin}/robot/${encodeURIComponent(robot.serialNumber)}`;
      const model = modelById.get(robot.modelId)?.name || 'ไม่ทราบรุ่น';
      return `<div class="label"><div class="brand">OZONE360</div><div id="qr-${index}" class="qr"></div><div class="serial">${escapeHtml(robot.serialNumber)}</div><div class="model">${escapeHtml(model)}</div><div class="url">${escapeHtml(url)}</div></div>`;
    }).join('');
    const qrScripts = selected.map((robot, index) => `new QRCode(document.getElementById('qr-${index}'),{text:${JSON.stringify(`${window.location.origin}/robot/${encodeURIComponent(robot.serialNumber)}`)},width:150,height:150});`).join('');
    w.document.write(`<html><head><title>ป้าย QR หุ่นยนต์</title><link href="https://fonts.googleapis.com/css2?family=Prompt:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet"/><script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script><style>*{box-sizing:border-box}body{font-family:'Prompt',sans-serif;display:flex;flex-wrap:wrap;gap:16px;padding:20px}.label{width:280px;text-align:center;border:2px solid #1e3a8a;border-radius:12px;padding:14px;page-break-inside:avoid}.brand{font-weight:800;color:#1e3a8a;font-size:20px}.qr{display:flex;justify-content:center;margin:12px}.serial{font-weight:800;font-size:18px;font-variant-numeric:tabular-nums;color:#1e3a8a}.model{color:#475569;margin:6px}.url{font-size:9px;color:#64748b;word-break:break-all}@media print{button{display:none}}</style></head><body>${labels}<script>window.addEventListener('load',function(){${qrScripts}document.fonts.ready.then(function(){setTimeout(function(){window.print()},300)})})<\/script></body></html>`);
    w.document.close();
  };

  const [formData, setFormData] = useState({
    serialNumber: '',
    modelId: '',
    status: 'In Stock' as Robot['status'],
    customerId: '',
    purchaseDate: todayISO(),
    locationId: '',
    notes: '',
    warrantyExpiresAt: ''
  });

  const modelById = useMemo(() => new Map(models.map(model => [model.id, model])), [models]);
  const customerById = useMemo(() => new Map(customers.map(customer => [customer.id, customer])), [customers]);
  const warehouseNameById = useMemo(() => new Map(warehouses.map(warehouse => [warehouse.id, warehouse.name])), [warehouses]);

  const getModelName = (modelId: string) => modelById.get(modelId)?.name || 'ไม่ทราบ';
  const getCustomerName = (customerId?: string) => (customerId ? customerById.get(customerId)?.name : undefined) || '-';
  const findRobotBySerialNumber = (serialNumber: string) => {
    const normalized = serialNumber.trim().toLowerCase();
    if (!normalized) return null;
    return robots.find(robot => robot.serialNumber.trim().toLowerCase() === normalized) ?? null;
  };
  const findModelBySku = (sku: string): typeof models[number] | 'AMBIGUOUS' | null => {
    const normalized = sku.trim().toLowerCase();
    if (!normalized) return null;
    const matchedModels = models.filter(model =>
      parseRobotModelSkus(model.sku).some(item => item.toLowerCase() === normalized)
    );
    if (matchedModels.length > 1) return 'AMBIGUOUS';
    return matchedModels[0] ?? null;
  };

  const filteredRobots = useMemo(() => robots
    .filter(r => filter === 'All' || r.status === filter)
    .filter(r => modelFilter === 'All' || r.modelId === modelFilter)
    .filter(r => customerFilter === 'All' || r.customerId === customerFilter)
    .filter(r => {
      if (!search) return true;
      const q = search.toLowerCase();
      return r.serialNumber.toLowerCase().includes(q)
        || getModelName(r.modelId).toLowerCase().includes(q)
        || getCustomerName(r.customerId).toLowerCase().includes(q);
    }), [robots, filter, modelFilter, customerFilter, search, modelById, customerById]);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  useEffect(() => { setPage(1); }, [filter, modelFilter, customerFilter, search]);
  const sort = useTableSort<typeof robots[0]>({
    serialNumber: r => r.serialNumber,
    model: r => getModelName(r.modelId),
    status: r => r.status,
    location: r => warehouseNameById.get(r.locationId ?? '') ?? '',
    purchaseDate: r => r.purchaseDate,
    customer: r => getCustomerName(r.customerId),
  });
  const paginated = sort.apply(filteredRobots).slice((page - 1) * pageSize, page * pageSize);
  const hasActiveFilters = filter !== 'All' || modelFilter !== 'All' || customerFilter !== 'All' || search.trim() !== '';

  const clearFilters = () => {
    setFilter('All');
    setModelFilter('All');
    setCustomerFilter('All');
    setSearch('');
  };

  const openScanAddModal = () => {
    const savedLocationId = window.localStorage.getItem('robots.scanAdd.locationId') || '';
    setScanForm({
      sku: '',
      serialNumber: '',
      purchaseDate: todayISO(),
      locationId: savedLocationId,
      notes: '',
    });
    setScanAddOpen(true);
  };

  const openForm = (robot?: Robot) => {
    setFormErrors({});
    if (robot) {
      setEditingRobot(robot);
      setFormData({
        serialNumber: robot.serialNumber,
        modelId: robot.modelId,
        status: robot.status,
        customerId: robot.customerId || '',
        purchaseDate: robot.purchaseDate,
        locationId: robot.locationId || '',
        notes: robot.notes || '',
        warrantyExpiresAt: robot.warrantyExpiresAt || ''
      });
    } else {
      setEditingRobot(null);
      setFormData({ 
        serialNumber: '', 
        modelId: models.length > 0 ? models[0].id : '', 
        status: 'In Stock', 
        customerId: '', 
        purchaseDate: todayISO(),
        locationId: '',
        notes: '',
        warrantyExpiresAt: ''
      });
    }
    setPendingCustName('');
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors: Record<string, string> = {};
    if (!formData.serialNumber.trim()) errors.serialNumber = 'กรุณากรอกหมายเลขซีเรียล';
    if (!formData.modelId) errors.modelId = 'กรุณาเลือกรุ่นหุ่นยนต์';
    if (formData.status === 'Assigned' && !formData.customerId && !pendingCustName.trim()) errors.customerId = 'กรุณาระบุลูกค้า';
    if (Object.keys(errors).length) { setFormErrors(errors); return; }
    setFormErrors({});
    setFormSaving(true);
    try {
      // Resolve new customer if staged
      let resolvedCustomerId = formData.customerId;
      if (formData.status === 'Assigned' && !resolvedCustomerId && pendingCustName) {
        const newCust = await quickAddCustomer(pendingCustName);
        resolvedCustomerId = newCust.id;
      }
      const payload = {
        ...formData,
        customerId: formData.status === 'Assigned' && resolvedCustomerId ? resolvedCustomerId : undefined,
        // null (not undefined) so clearing a field is actually sent — undefined is dropped from JSON
        // and the old value stayed.
        locationId: formData.locationId || null,
        notes: formData.notes || null,
        warrantyExpiresAt: formData.warrantyExpiresAt || null,
      } as unknown as Omit<Robot, 'id'>;
      
      if (editingRobot) {
        await updateRobot(editingRobot.id, payload);
      } else {
        await addRobot(payload);
      }
      setIsModalOpen(false);
    } finally {
      setFormSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!await confirm('ลบหุ่นยนต์นี้?', { title: 'ยืนยันการลบ', danger: true, confirmLabel: 'ลบ' })) return;
    await deleteRobot(id);
  };

  const openTransferModal = (robot: Robot) => {
    setTransferRobot(robot);
    setTransferCustomerId(robot.customerId || '');
    setTransferPendingCustName('');
    setTransferError('');
    setTransferOpen(true);
  };

  const handleTransferRobot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferRobot) return;
    if (!transferCustomerId && !transferPendingCustName.trim()) {
      setTransferError('กรุณาเลือกลูกค้าปลายทาง');
      return;
    }

    setTransferError('');
    setTransferSaving(true);
    try {
      let nextCustomerId = transferCustomerId;
      if (!nextCustomerId && transferPendingCustName.trim()) {
        const createdCustomer = await quickAddCustomer(transferPendingCustName.trim());
        nextCustomerId = createdCustomer.id;
      }
      await updateRobot(transferRobot.id, {
        customerId: nextCustomerId,
        status: transferRobot.status === 'In Stock' ? 'Assigned' : transferRobot.status,
      });
      setTransferOpen(false);
      setSelectedRobot(current => current?.id === transferRobot.id ? { ...current, customerId: nextCustomerId, status: current.status === 'In Stock' ? 'Assigned' : current.status } : current);
    } finally {
      setTransferSaving(false);
    }
  };

  const handleScanAddSubmit = async () => {
    if (scanSubmittingRef.current) return;
    const matchedModel = findModelBySku(scanForm.sku);
    if (!scanForm.sku.trim()) {
      showToast('กรุณาสแกนหรือกรอก SKU', 'error');
      scanSkuRef.current?.focus();
      return;
    }
    if (!matchedModel) {
      showToast('ไม่พบ SKU นี้ในหน้ารุ่นหุ่นยนต์', 'error');
      scanSkuRef.current?.focus();
      return;
    }
    if (matchedModel === 'AMBIGUOUS') {
      showToast('SKU นี้ผูกมากกว่า 1 รุ่น กรุณาตรวจสอบในหน้ารุ่นหุ่นยนต์', 'error');
      scanSkuRef.current?.focus();
      return;
    }
    if (!scanForm.serialNumber.trim()) {
      showToast('กรุณาสแกนหรือกรอกหมายเลขซีเรียล', 'error');
      scanSerialRef.current?.focus();
      return;
    }
    const normalizedSerialNumber = scanForm.serialNumber.trim();
    const existingRobot = findRobotBySerialNumber(normalizedSerialNumber);
    scanSubmittingRef.current = true;
    setScanSubmitting(true);
    try {
      const payload = {
        serialNumber: normalizedSerialNumber,
        modelId: matchedModel.id,
        status: 'In Stock' as const,
        purchaseDate: scanForm.purchaseDate,
        locationId: scanForm.locationId || undefined,
        notes: scanForm.notes.trim() || undefined,
      };
      if (existingRobot) {
        await updateRobot(existingRobot.id, payload);
      } else {
        await addRobot(payload);
      }
      if (scanForm.locationId) window.localStorage.setItem('robots.scanAdd.locationId', scanForm.locationId);
      else window.localStorage.removeItem('robots.scanAdd.locationId');
      showToast(existingRobot ? `อัปเดตหุ่นยนต์แล้ว: ${normalizedSerialNumber}` : `เพิ่มหุ่นยนต์แล้ว: ${normalizedSerialNumber}`, 'success');
      setScanForm(prev => ({
        ...prev,
        sku: '',
        serialNumber: '',
        purchaseDate: todayISO(),
        notes: '',
      }));
      setTimeout(() => scanSkuRef.current?.focus(), 0);
    } catch {
      // handled by DataContext toast
    } finally {
      scanSubmittingRef.current = false;
      setScanSubmitting(false);
    }
  };

  const resolvedScanModel = scanForm.sku.trim() ? findModelBySku(scanForm.sku) : null;

  const resolveScanSku = (skuOverride?: string) => {
    const matchedModel = findModelBySku(skuOverride ?? scanForm.sku);
    if (!matchedModel) {
      showToast('ไม่พบ SKU นี้ในหน้ารุ่นหุ่นยนต์', 'error');
      setTimeout(() => scanSkuRef.current?.focus(), 0);
      return null;
    }
    if (matchedModel === 'AMBIGUOUS') {
      showToast('SKU นี้ผูกมากกว่า 1 รุ่น กรุณาตรวจสอบในหน้ารุ่นหุ่นยนต์', 'error');
      setTimeout(() => scanSkuRef.current?.focus(), 0);
      return null;
    }
    setTimeout(() => scanSerialRef.current?.focus(), 0);
    return matchedModel;
  };

  const exportDeliveryOrder = (robot: typeof robots[0]) => {
    const customer = robot.customerId ? customerById.get(robot.customerId) : undefined;
    const model = modelById.get(robot.modelId);
    const today = new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
    const orderRef = `DO-${Date.now().toString().slice(-6)}`;

    const html = `
      <div class="doc-header">
        ${logoSVG}
        <div class="doc-title-block">
          <div class="doc-type">ใบส่งของ</div>
          <div class="doc-meta">
            วันที่: ${today}<br/>
            เลขที่เอกสาร: ${orderRef}
          </div>
        </div>
      </div>

      <div class="info-grid">
        <div class="info-box">
          <h3>ส่งถึง</h3>
          ${customer ? `
            <p><strong>${customer.name}</strong></p>
            <p>${customer.address || '-'}</p>
            <p>ผู้ติดต่อ: ${customer.contactPerson || '-'}</p>
            <p>โทร: ${customer.phone || '-'}</p>
          ` : '<p>-</p>'}
        </div>
        <div class="info-box">
          <h3>ข้อมูลหุ่นยนต์</h3>
          <p><strong>รุ่น:</strong> ${model?.name || '-'}</p>
          <p><strong>หมายเลขซีเรียล:</strong> ${robot.serialNumber}</p>
          <p><strong>วันที่รับเข้า:</strong> ${robot.purchaseDate || '-'}</p>
          <p><strong>สถานะ:</strong> ${robotStatusLabels[robot.status] || robot.status}</p>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>รายการ</th>
            <th>หมายเลขซีเรียล</th>
            <th>วันที่รับมอบ</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>${model?.name || 'Robot'}</td>
            <td>${robot.serialNumber}</td>
            <td>${robot.purchaseDate || '-'}</td>
          </tr>
        </tbody>
      </table>

      <div class="sig-row">
        <div class="sig-box">
          <div class="sig-line"></div>
          <div class="sig-label">ผู้มอบ</div>
        </div>
        <div class="sig-box">
          <div class="sig-line"></div>
          <div class="sig-label">ผู้รับ</div>
        </div>
      </div>
    `;

    printPDF(html, `ใบส่งของ-${robot.serialNumber}`);
  };

  const handleBulkStatus = async () => {
    if (!selectedIds.size) return;
    if (!await confirm(`เปลี่ยนสถานะหุ่นยนต์ ${selectedIds.size} เครื่อง เป็น "${bulkStatus}" ?`, { title: 'ยืนยันการเปลี่ยนสถานะ', danger: true, confirmLabel: 'เปลี่ยนทั้งหมด' })) return;
    setBulkSaving(true);
    try {
      await api.post('/robots/bulk-status', { ids: Array.from(selectedIds), status: bulkStatus });
      setSelectedIds(new Set());
      await fetchData();
    } catch {}
    setBulkSaving(false);
  };

  const exportCSV = () => {
    const header = ['หมายเลขซีเรียล', 'รุ่น', 'สถานะ', 'ลูกค้า', 'วันซื้อ', 'วอร์แรนตี้หมด', 'หมายเหตุ'];
    const rows = filteredRobots.map(r => {
      const model = modelById.get(r.modelId);
      const customer = r.customerId ? customerById.get(r.customerId) : undefined;
      return [r.serialNumber, model?.name ?? '', robotStatusLabels[r.status] || r.status, customer?.name ?? '', r.purchaseDate, r.warrantyExpiresAt ?? '', r.notes ?? ''];
    });
    const csv = [header, ...rows].map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `robots-${todayISO()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page-container">
      <PageHeader
        title="คลังหุ่นยนต์"
        subtitle={`แสดง ${filteredRobots.length} จาก ${robots.length} เครื่อง`}
        actions={<div className="responsive-action-group">
          {isAdmin && (
            <button className="btn btn-primary" onClick={() => openForm()} disabled={models.length === 0}>
              <Plus size={16}/> เพิ่มหุ่นยนต์
            </button>
          )}
        </div>}
        overflowActions={[
          isAdmin && <button className="btn btn-outline" onClick={openScanAddModal} disabled={models.length === 0}><ScanLine size={16}/> สแกนเพิ่มหุ่นยนต์</button>,
          isAdmin && <button className="btn btn-outline" onClick={openImportModal}><Upload size={15} /> นำเข้า Excel</button>,
          <RefreshButton onClick={async () => { setRefreshing(true); await fetchData(); setRefreshing(false); }} loading={refreshing} />,
          <button className="btn btn-ghost" onClick={exportCSV}><Download size={15} /> CSV</button>,
        ].filter(Boolean) as React.ReactNode[]}
      />

      <div className="card" style={{ marginBottom: '0.75rem', padding: '1rem' }}>
        <div className="responsive-modal-top" style={{ alignItems: 'flex-start', marginBottom: '0.85rem' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>ค้นหาและกรองรายการ</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>แยกส่วนตัวกรองออกจากปุ่ม action เพื่อให้หาข้อมูลได้เร็วขึ้น</div>
          </div>
          {hasActiveFilters && (
            <button
              className="btn btn-outline"
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
              onClick={clearFilters}
            >
              ล้างตัวกรอง
            </button>
          )}
        </div>

        <div className="responsive-toolbar">
          <div className="responsive-toolbar-search">
            <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input aria-label="ค้นหา SN / รุ่น / ลูกค้า"
              className="form-control"
              style={{ paddingLeft: '2rem', paddingRight: '2rem', width: '100%' }}
              placeholder="ค้นหา SN / รุ่น / ลูกค้า"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {!search && <CameraScanButton variant="inline" onScan={setSearch} />}
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="ล้างคำค้นหา"
                title="ล้างคำค้นหา"
                style={{
                  position: 'absolute',
                  right: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--text-muted)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                <X size={14} />
              </button>
            )}
          </div>

          <select aria-label="กรองตามรุ่น"
            className="form-control"
            style={{ width: 'auto', minWidth: 140 }}
            value={modelFilter}
            onChange={e => setModelFilter(e.target.value)}
          >
            <option value="All">ทุกรุ่น</option>
            {models.map(m => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>

          <select aria-label="กรองตามลูกค้า"
            className="form-control"
            style={{ width: 'auto', minWidth: 160 }}
            value={customerFilter}
            onChange={e => setCustomerFilter(e.target.value)}
          >
            <option value="All">ทุกลูกค้า</option>
            {customers.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>

          {isAdmin && (
            <button className="btn btn-outline" type="button" onClick={openScanAddModal} disabled={models.length === 0}>
              <ScanLine size={15} /> สแกนเพิ่มหุ่นยนต์
            </button>
          )}
        </div>

        <div className="responsive-toolbar-filters" style={{ marginTop: '0.85rem' }}>
          {([['All','ทุกสถานะ'],['In Stock', robotStatusLabels['In Stock']],['Assigned', robotStatusLabels['Assigned']],['In Maintenance', robotStatusLabels['In Maintenance']],['Missing', robotStatusLabels['Missing']]] as [string,string][]).map(([v,l]) => (
            <button key={v} type="button" onClick={() => setFilter(v)} style={{ padding: '5px 12px', borderRadius: 999, fontSize: 12, fontWeight: filter===v?700:500, border: `1.5px solid ${filter===v?'var(--accent-primary)':'var(--border-color)'}`, background: filter===v?'var(--accent-subtle)':'transparent', color: filter===v?'var(--accent-primary)':'var(--text-secondary)', cursor: 'pointer', transition: 'all .15s' }}>{l}</button>
          ))}
        </div>
      </div>

      {/* Bulk action bar */}
      {isAdmin && selectedIds.size > 0 && (
        <div className="responsive-action-group" style={{ padding: '0.6rem 1rem', marginBottom: '0.5rem', background: 'var(--accent-subtle)', border: '1px solid var(--accent-primary)', borderRadius: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent-primary)' }}>เลือก {selectedIds.size} เครื่อง</span>
          <select aria-label="เปลี่ยนสถานะหลายรายการ" className="form-control" style={{ width: 'auto', fontSize: 13 }} value={bulkStatus} onChange={e => setBulkStatus(e.target.value as Robot['status'])}>
            {(['In Stock', 'Assigned', 'In Maintenance', 'Missing'] as Robot['status'][]).map(s => <option key={s} value={s}>{robotStatusLabels[s] || s}</option>)}
          </select>
          <button className="btn btn-primary" style={{ fontSize: 13, padding: '0.3rem 0.9rem' }} onClick={handleBulkStatus} disabled={bulkSaving}>
            {bulkSaving ? 'กำลังบันทึก...' : 'เปลี่ยนสถานะ'}
          </button>
          <button className="btn btn-outline" style={{ fontSize: 13, padding: '0.3rem 0.9rem' }} onClick={() => printSelectedRobotQR(selectedIds)}>
            <QrCode size={14} /> พิมพ์ป้าย QR
          </button>
          <button className="btn btn-outline" style={{ fontSize: 13, padding: '0.3rem 0.7rem' }} onClick={() => setSelectedIds(new Set())}>ยกเลิก</button>
        </div>
      )}

      <div className="card">
        <div className="table-container table-responsive-cards">
          <table>
            <thead>
              <tr>
                {isAdmin && <th style={{ width: 36, textAlign: 'center' }}>
                  <input aria-label="เลือกหุ่นยนต์ทั้งหมดในหน้านี้" type="checkbox" style={{ accentColor: 'var(--accent-primary)', cursor: 'pointer' }}
                    checked={paginated.length > 0 && paginated.every(r => selectedIds.has(r.id))}
                    onChange={e => {
                      const next = new Set(selectedIds);
                      if (e.target.checked) paginated.forEach(r => next.add(r.id));
                      else paginated.forEach(r => next.delete(r.id));
                      setSelectedIds(next);
                    }} />
                </th>}
                <SortableTh {...sort.th('serialNumber')}>หมายเลขซีเรียล</SortableTh>
                <SortableTh {...sort.th('model')}>รุ่น</SortableTh>
                <SortableTh {...sort.th('status')}>สถานะ</SortableTh>
                <SortableTh {...sort.th('location')}>ตำแหน่ง</SortableTh>
                <SortableTh {...sort.th('purchaseDate')}>วันที่ซื้อ</SortableTh>
                <SortableTh {...sort.th('customer')}>ลูกค้า</SortableTh>
                <th>การดำเนินการ</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map(robot => (
                <tr key={robot.id} style={{ cursor: 'pointer', background: selectedIds.has(robot.id) ? 'var(--accent-subtle)' : undefined }}>
                  {isAdmin && <td data-label="เลือก" style={{ textAlign: 'center' }}>
                    <input aria-label={`เลือก ${robot.serialNumber}`} type="checkbox" style={{ accentColor: 'var(--accent-primary)', cursor: 'pointer' }}
                      checked={selectedIds.has(robot.id)}
                      onChange={e => {
                        const next = new Set(selectedIds);
                        if (e.target.checked) next.add(robot.id); else next.delete(robot.id);
                        setSelectedIds(next);
                      }} />
                  </td>}
                  <td data-label="หมายเลขซีเรียล" style={{ fontWeight: 600 }}>
                    <button
                      onClick={() => setSelectedRobot(robot)}
                      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent-primary)', fontWeight: 600, fontSize: 'inherit', fontVariantNumeric: 'tabular-nums', textAlign: 'left' }}
                    >
                      {robot.serialNumber}
                    </button>
                  </td>
                  <td data-label="รุ่น">
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <ModelAvatar name={getModelName(robot.modelId)} imageUrl={models.find(m => m.id === robot.modelId)?.imageUrl} size={32} />
                      {getModelName(robot.modelId)}
                    </span>
                  </td>
                  <td data-label="สถานะ">
                    <RobotStatusBadge status={robot.status} />
                  </td>
                  <td data-label="ตำแหน่ง" className="text-muted" style={{ fontSize: '0.82rem' }}>
                    {robot.locationId ? warehouseNameById.get(robot.locationId) || '—' : '—'}
                  </td>
                  <td data-label="วันที่ซื้อ" className="text-muted">{robot.purchaseDate}</td>
                  <td data-label="ลูกค้า">{getCustomerName(robot.customerId)}</td>
                  <td data-label="การดำเนินการ">
                    <div className="responsive-table-actions" style={{ justifyContent: 'flex-start' }}>
                      <button 
                        className="btn btn-outline" 
                        onClick={() => navigate('/delivery-notes', { state: { robotId: robot.id, customerId: robot.customerId } })}
                        disabled={robot.status !== 'Assigned'}
                        style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                        title={robot.status !== 'Assigned' ? 'สร้างใบส่งของได้เฉพาะหุ่นยนต์ที่มอบหมายแล้ว' : 'สร้างใบส่งของ'}
                        aria-label={`สร้างใบส่งของ ${robot.serialNumber}`}
                      >
                        <FileText size={14}/> ใบส่งของ
                      </button>
                      <button
                        className="btn btn-outline"
                        style={{ padding: '0.25rem 0.5rem' }}
                        onClick={() => printRobotQR(robot)}
                        title="พิมพ์ QR Label"
                        aria-label={`พิมพ์ QR ${robot.serialNumber}`}
                      >
                        <QrCode size={14}/>
                      </button>
                      {isAdmin && (
                        <>
                          <button
                            className="btn btn-outline"
                            style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                            onClick={() => openTransferModal(robot)}
                            aria-label={`โอน ${robot.serialNumber}`}
                            title={`โอน ${robot.serialNumber}`}
                          >
                            โอน
                          </button>
                          <button className="btn btn-outline" style={{ padding: '0.25rem 0.5rem' }} onClick={() => openForm(robot)} aria-label={`แก้ไข ${robot.serialNumber}`} title={`แก้ไข ${robot.serialNumber}`}>
                            <Edit2 size={14}/>
                          </button>
                          <button className="btn" style={{ padding: '0.25rem 0.5rem', color: 'var(--status-danger)' }} onClick={() => handleDelete(robot.id)} aria-label={`ลบ ${robot.serialNumber}`} title={`ลบ ${robot.serialNumber}`}>
                            <Trash2 size={14}/>
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
      {loading && robots.length === 0 && <TableSkeleton cols={isAdmin ? 8 : 7} />}
              {!loading && filteredRobots.length === 0 && (
                <EmptyState
                  mascot={hasActiveFilters ? 'noResults' : 'emptyList'}
                  icon={<RefreshCw size={36} />}
                  title="ไม่พบหุ่นยนต์"
                  description={hasActiveFilters ? 'ลองเปลี่ยนตัวกรองหรือค้นหาใหม่' : 'ยังไม่มีหุ่นยนต์ในระบบ'}
                  colSpan={isAdmin ? 8 : 7}
                />
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageSize={pageSize} total={filteredRobots.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
      </div>

      {/* Robot Detail Drawer */}
      {selectedRobot && (() => {
        const robot = selectedRobot;
        const model = modelById.get(robot.modelId);
        const customer = robot.customerId ? customerById.get(robot.customerId) : undefined;
        const robotTickets = tickets.filter(t => t.robotId === robot.id).sort((a, b) => b.reportDate.localeCompare(a.reportDate));
        const activeTickets = robotTickets.filter(t => t.status !== 'Completed');
        const warehouse = robot.locationId ? { name: warehouseNameById.get(robot.locationId) || '' } : undefined;
        const isWarrantyExpired = robot.warrantyExpiresAt ? new Date(robot.warrantyExpiresAt) < new Date() : false;
        const warrantyDaysLeft = robot.warrantyExpiresAt
          ? Math.ceil((new Date(robot.warrantyExpiresAt).getTime() - Date.now()) / 86400000)
          : null;
        const statusColor: Record<string, string> = { 'In Stock': 'var(--status-success)', 'Assigned': 'var(--accent-primary)', 'In Maintenance': 'var(--status-warning)', 'Missing': 'var(--status-danger)' };
        const statusBg: Record<string, string> = { 'In Stock': 'var(--status-success-bg)', 'Assigned': 'rgba(59,130,246,0.12)', 'In Maintenance': 'var(--status-warning-bg)', 'Missing': 'var(--status-danger-bg)' };
        const statusLabel: Record<string, string> = { 'In Stock': 'ในคลัง', 'Assigned': 'ติดตั้งแล้ว', 'In Maintenance': 'ซ่อมบำรุง', 'Missing': '⚠️ สูญหาย' };
        const ticketStatusLabel: Record<string, string> = { 'Pending': 'รอดำเนินการ', 'Waiting Quotation': 'รอทำใบเสนอราคา', 'In Progress': 'กำลังซ่อม', 'Ready to Ship': 'รอเตรียมส่ง', 'Completed': 'เสร็จสิ้น' };
        const ticketStatusColor: Record<string, string> = { 'Pending': 'var(--status-warning)', 'Waiting Quotation': 'var(--status-secondary)', 'In Progress': 'var(--accent-primary)', 'Ready to Ship': '#0891b2', 'Completed': 'var(--status-success)' };
        return (
          <BodyPortal>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`รายละเอียด ${robot.serialNumber}`}
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15,30,80,0.4)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1100, padding: '1rem' }}
            onClick={() => setSelectedRobot(null)}
          >
            <div
              className="detail-sheet"
              style={{ width: '600px', maxWidth: '96vw', maxHeight: '88vh', backgroundColor: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(30,58,138,0.2)', overflowY: 'auto', borderRadius: 12, border: '1px solid var(--border-color)' }}
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-muted)', fontSize: '0.78rem', marginBottom: '0.3rem' }}>
                    <span>คลัง</span><ChevronRight size={12}/><span>รายละเอียดหุ่นยนต์</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <ModelAvatar name={model?.name} imageUrl={model?.imageUrl} size={56} />
                    <div>
                      <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>{model?.name || 'ไม่ทราบ'}</h2>
                      <div style={{ fontVariantNumeric: 'tabular-nums', fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>{robot.serialNumber}</div>
                    </div>
                  </div>
                </div>
                <button className="btn btn-ghost" style={{ padding: '0.3rem' }} onClick={() => setSelectedRobot(null)} aria-label="ปิดรายละเอียดหุ่นยนต์" title="ปิดรายละเอียดหุ่นยนต์"><X size={18}/></button>
              </div>

              {/* Status + nickname */}
              <div style={{ padding: '0.9rem 1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 600, padding: '0.25rem 0.7rem', borderRadius: 999, backgroundColor: statusBg[robot.status], color: statusColor[robot.status] }}>
                  {statusLabel[robot.status] || robot.status}
                </span>
                {robot.notes && (
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>ชื่อเล่น: <strong style={{ color: 'var(--text-primary)' }}>{robot.notes}</strong></span>
                )}
              </div>

              {/* Info sections */}
              <div style={{ padding: '1rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

                {/* Model specs */}
                <div>
                  <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: '0.6rem' }}>ข้อมูลรุ่น</div>
                  <div style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '0.85rem 1rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem' }}>
                    {model?.type && <div><div className="text-muted" style={{ fontSize: '0.7rem' }}>ประเภท</div><div style={{ fontSize: '0.85rem', fontWeight: 500 }}>{model.type}</div></div>}
                    {model?.payloadCapacity && <div><div className="text-muted" style={{ fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: 3 }}><Weight size={10}/> รับน้ำหนัก</div><div style={{ fontSize: '0.85rem', fontWeight: 500 }}>{model.payloadCapacity}</div></div>}
                    {model?.batteryLife && <div><div className="text-muted" style={{ fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: 3 }}><Battery size={10}/> แบตเตอรี่</div><div style={{ fontSize: '0.85rem', fontWeight: 500 }}>{model.batteryLife}</div></div>}
                  </div>
                </div>

                {/* Device info */}
                <div>
                  <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: '0.6rem' }}>ข้อมูลอุปกรณ์</div>
                  <div style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '0.85rem 1rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem' }}>
                    <div>
                      <div className="text-muted" style={{ fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: 3 }}><CalendarClock size={10}/> วันรับเข้า</div>
                      <div style={{ fontSize: '0.85rem', fontWeight: 500 }}>{robot.purchaseDate || '–'}</div>
                    </div>
                    <div>
                      <div className="text-muted" style={{ fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: 3 }}><ShieldCheck size={10}/> ประกัน</div>
                      {robot.warrantyExpiresAt ? (
                        <div style={{ fontSize: '0.85rem', fontWeight: 500, color: isWarrantyExpired ? 'var(--status-danger)' : warrantyDaysLeft! <= 90 ? 'var(--status-warning)' : 'inherit' }}>
                          {robot.warrantyExpiresAt}
                          <span style={{ fontSize: '0.72rem', marginLeft: '0.3rem', opacity: 0.75 }}>
                            {isWarrantyExpired ? '(หมดแล้ว)' : `(${warrantyDaysLeft} วัน)`}
                          </span>
                        </div>
                      ) : <div className="text-muted" style={{ fontSize: '0.85rem' }}>–</div>}
                    </div>
                    {robot.puduMac && (
                      <div style={{ gridColumn: '1/-1' }}>
                        <div className="text-muted" style={{ fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: 3 }}><Wifi size={10}/> MAC Address</div>
                        <div style={{ fontSize: '0.83rem', fontVariantNumeric: 'tabular-nums' }}>{robot.puduMac}</div>
                      </div>
                    )}
                    {warehouse && (
                      <div style={{ gridColumn: '1/-1' }}>
                        <div className="text-muted" style={{ fontSize: '0.7rem' }}>ตำแหน่ง / คลัง</div>
                        <div style={{ fontSize: '0.85rem', fontWeight: 500 }}>{warehouse.name}</div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Customer */}
                {customer && (
                  <div>
                    <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: '0.6rem' }}>ลูกค้า / ร้านค้า</div>
                    <div style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '0.85rem 1rem' }}>
                      <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>{customer.name}</div>
                      {customer.contactPerson && <div className="text-muted" style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 4 }}><User size={11}/> {customer.contactPerson}</div>}
                      {customer.phone && customer.phone !== '-' && <div className="text-muted" style={{ fontSize: '0.82rem', marginTop: '0.15rem' }}>📞 {customer.phone}</div>}
                      {customer.address && <div className="text-muted" style={{ fontSize: '0.8rem', marginTop: '0.25rem', lineHeight: 1.5 }}>{customer.address}</div>}
                    </div>
                  </div>
                )}

                {/* Unified robot history */}
                <div>
                  <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: '0.6rem' }}>ประวัติ</div>
                  <div style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '0.5rem 1rem' }}>
                    <Timeline entityType="Robot" entityId={robot.id} />
                  </div>
                </div>

                {/* Maintenance history */}
                <div>
                  <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: '0.6rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Wrench size={12}/> ประวัติซ่อมบำรุง
                    {robotTickets.length > 0 && <span style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 999, padding: '0 0.45rem', fontSize: '0.72rem', fontWeight: 600 }}>{robotTickets.length}</span>}
                    {activeTickets.length > 0 && <span style={{ background: 'var(--status-warning-bg)', color: 'var(--status-warning)', borderRadius: 999, padding: '0 0.45rem', fontSize: '0.72rem', fontWeight: 600 }}>{activeTickets.length} กำลังดำเนินการ</span>}
                  </div>
                  {robotTickets.length === 0 ? (
                    <div style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '1rem', textAlign: 'center' }}>
                      <span className="text-muted" style={{ fontSize: '0.83rem' }}>ไม่มีประวัติซ่อมบำรุง</span>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {robotTickets.map(t => (
                        <div key={t.id} style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '0.75rem 1rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.3rem' }}>
                            <span style={{ fontSize: '0.83rem', fontWeight: 600, flex: 1, marginRight: '0.5rem', lineHeight: 1.4 }}>{t.issueDescription}</span>
                            <span style={{ fontSize: '0.7rem', fontWeight: 600, padding: '0.15rem 0.5rem', borderRadius: 999, color: ticketStatusColor[t.status] ?? 'var(--text-secondary)', background: t.status === 'Completed' ? 'var(--status-success-bg)' : t.status === 'In Progress' ? 'rgba(59,130,246,0.12)' : t.status === 'Ready to Ship' ? 'rgba(8,145,178,0.12)' : t.status === 'Waiting Quotation' ? 'rgba(124,58,237,0.12)' : 'var(--status-warning-bg)', whiteSpace: 'nowrap', flexShrink: 0 }}>{ticketStatusLabel[t.status] ?? t.status}</span>
                          </div>
                          <div className="text-muted" style={{ fontSize: '0.75rem' }}>วันที่: {t.reportDate}</div>
                          {t.resolution && <div style={{ fontSize: '0.78rem', marginTop: '0.3rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>✅ {t.resolution}</div>}
                          {t.replacedParts && t.replacedParts !== 'None' && t.replacedParts !== 'ไม่มี' && <div style={{ fontSize: '0.75rem', marginTop: '0.2rem', color: 'var(--text-muted)' }}>🔧 อะไหล่: {t.replacedParts}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Loan history */}
                <div>
                  <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: '0.6rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Archive size={12}/> ประวัติการยืม
                    {robotLoans.length > 0 && <span style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 999, padding: '0 0.45rem', fontSize: '0.72rem', fontWeight: 600 }}>{robotLoans.length}</span>}
                  </div>
                  {robotLoansLoading || robotLoans.length === 0 ? (
                    <div style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '1rem', textAlign: 'center' }}>
                      <span className="text-muted" style={{ fontSize: '0.83rem' }}>{robotLoansLoading ? 'กำลังโหลด…' : 'ไม่มีประวัติการยืม'}</span>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {robotLoans.map((loan: any) => {
                        const lItem = loan.items.find((it: any) => it.robotId === robot.id);
                        const loanStatusColor: Record<string, string> = { Active: 'var(--status-success)', Returned: 'var(--text-muted)', Cancelled: 'var(--status-danger)', Pending: 'var(--status-warning)', Approved: 'var(--accent-primary)' };
                        return (
                          <div key={loan.id} style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '0.75rem 1rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.3rem' }}>
                              <span style={{ fontSize: '0.83rem', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{loan.docNumber}</span>
                              <span style={{ fontSize: '0.7rem', fontWeight: 600, padding: '0.15rem 0.5rem', borderRadius: 999, background: 'var(--bg-secondary)', color: loanStatusColor[loan.status] || 'var(--text-muted)', whiteSpace: 'nowrap' }}>{loanStatusLabels[loan.status] || loan.status}</span>
                            </div>
                            <div className="text-muted" style={{ fontSize: '0.75rem' }}>ผู้ยืม: {loan.borrowerName}{loan.borrowerDept ? ` · ${loan.borrowerDept}` : ''}</div>
                            <div className="text-muted" style={{ fontSize: '0.75rem' }}>ยืม: {loan.loanDate} → {loan.expectedReturn}</div>
                            {lItem?.returnedAt && <div style={{ fontSize: '0.75rem', marginTop: '0.2rem', color: 'var(--status-success)' }}>✅ คืนแล้ว: {lItem.returnedAt}{lItem.condition ? ` (${lItem.condition})` : ''}</div>}
                            <button
                              type="button"
                              className="btn btn-outline"
                              style={{ marginTop: '0.45rem', padding: '0.2rem 0.55rem', fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                              title={`ดูรูปหลักฐานส่งมอบ/รับคืนของ ${loan.docNumber}`}
                              onClick={() => navigate(`/robot-loans?q=${encodeURIComponent(loan.docNumber)}&open=${encodeURIComponent(loan.id)}`)}
                            >
                              <Paperclip size={11}/> ดูหลักฐาน
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: '0.6rem', paddingBottom: '0.5rem' }}>
                  <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => navigate('/delivery-notes', { state: { robotId: robot.id, customerId: robot.customerId } })} disabled={robot.status !== 'Assigned'}>
                    <FileText size={14}/> ใบส่งของ
                  </button>
                  {isAdmin && (
                    <>
                      <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => openTransferModal(robot)}>
                        โอนไปลูกค้า
                      </button>
                      <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => { setSelectedRobot(null); openForm(robot); }}>
                        <Edit2 size={14}/> แก้ไข
                      </button>
                    </>
                  )}
                </div>

              </div>
            </div>
          </div>
          </BodyPortal>
        );
      })()}

      {isModalOpen && (
        <Modal open={isModalOpen} onClose={() => setIsModalOpen(false)} title={editingRobot ? 'แก้ไขหุ่นยนต์' : 'เพิ่มหุ่นยนต์'} width={400} describedById="robot-form-description">
            <p id="robot-form-description" style={{ marginTop: 0, marginBottom: '0.75rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              กรอกข้อมูลหุ่นยนต์ เช่น serial number, รุ่น, สถานะ, ลูกค้าที่รับมอบ และวันรับเข้า
            </p>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '0.5rem' }}>
              <div>
                <label className="form-label" htmlFor="robot-sn">หมายเลขซีเรียล <span style={{ color: 'var(--status-danger)' }}>*</span></label>
                <input id="robot-sn" required className={`form-control${formErrors.serialNumber ? ' is-invalid' : ''}`} type="text" value={formData.serialNumber} onChange={e => setFormData({...formData, serialNumber: e.target.value})} />
                {formErrors.serialNumber && <div style={{ color: 'var(--status-danger)', fontSize: 11, marginTop: 3 }}>{formErrors.serialNumber}</div>}
              </div>
              <div>
                <label className="form-label" htmlFor="robot-model">รุ่น <span style={{ color: 'var(--status-danger)' }}>*</span></label>
                <select id="robot-model" required className={`form-control${formErrors.modelId ? ' is-invalid' : ''}`} value={formData.modelId} onChange={e => setFormData({...formData, modelId: e.target.value})}>
                  {models.map(m => (
                    <option key={m.id} value={m.id}>{m.name} ({m.type})</option>
                  ))}
                </select>
                {formErrors.modelId && <div style={{ color: 'var(--status-danger)', fontSize: 11, marginTop: 3 }}>{formErrors.modelId}</div>}
              </div>
              <div>
                <span className="form-label" id="robot-status-label">สถานะ</span>
                <div role="radiogroup" aria-labelledby="robot-status-label" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                  {([['In Stock', robotStatusLabels['In Stock']],['Assigned', robotStatusLabels['Assigned']],['In Maintenance', robotStatusLabels['In Maintenance']],['Missing', robotStatusLabels['Missing']]] as [string,string][]).map(([v,l]) => (
                    <button key={v} type="button" role="radio" aria-checked={formData.status === v} onClick={() => setFormData({...formData, status: v as Robot['status']})} style={{ padding: '6px 14px', borderRadius: 999, fontSize: 12, fontWeight: 600, border: `1.5px solid ${formData.status===v?'var(--accent-primary)':'var(--border-color)'}`, background: formData.status===v?'var(--accent-subtle)':'transparent', color: formData.status===v?'var(--accent-primary)':'var(--text-secondary)', cursor: 'pointer', transition: 'all .15s' }}>{l}</button>
                  ))}
                </div>
              </div>
              
              {formData.status === 'Assigned' && (
                <div>
                  <label className="form-label" htmlFor="robot-assign-customer">มอบหมายให้ลูกค้า <span style={{ color: 'var(--status-danger)' }}>*</span></label>
                  <CustomerCombobox
                    id="robot-assign-customer"
                    value={formData.customerId}
                    onChange={id => setFormData({...formData, customerId: id})}
                    customers={customers}
                    pendingName={pendingCustName}
                    onPendingName={setPendingCustName}
                    required
                    placeholder="ค้นหาลูกค้า..."
                  />
                  {formErrors.customerId && <div style={{ color: 'var(--status-danger)', fontSize: 11, marginTop: 3 }}>{formErrors.customerId}</div>}
                </div>
              )}

              <div>
                <label className="form-label" htmlFor="robot-date">วันที่ซื้อ</label>
                <ThaiDateInput id="robot-date" required className="form-control" value={formData.purchaseDate} onChange={e => setFormData({...formData, purchaseDate: e.target.value})} />
              </div>

              <div>
                <label className="form-label" htmlFor="robot-location">ตำแหน่ง</label>
                <select id="robot-location" className="form-control" value={formData.locationId} onChange={e => setFormData({...formData, locationId: e.target.value})}>
                  <option value="">— ไม่ระบุ —</option>
                  {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>

              <div>
                <label className="form-label" htmlFor="robot-warranty">ว้อร์แรนตี้หมด</label>
                <ThaiDateInput id="robot-warranty" className="form-control" value={formData.warrantyExpiresAt} onChange={e => setFormData({...formData, warrantyExpiresAt: e.target.value})} />
              </div>

              <div>
                <label className="form-label" htmlFor="robot-notes">หมายเหตุ</label>
                <textarea id="robot-notes" className="form-control" rows={2} value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} placeholder="หมายเหตุ..." />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button type="button" className="btn btn-outline" onClick={() => setIsModalOpen(false)}>ยกเลิก</button>
                <FormSubmitButton loading={formSaving}>{editingRobot ? 'บันทึกการแก้ไข' : 'เพิ่มหุ่นยนต์'}</FormSubmitButton>
              </div>
            </form>
        </Modal>
      )}

      <Modal
        open={transferOpen}
        onClose={() => { if (!transferSaving) setTransferOpen(false); }}
        title={transferRobot ? `โอนหุ่นยนต์ ${transferRobot.serialNumber}` : 'โอนหุ่นยนต์'}
        width={420}
        preventClose={transferSaving}
        describedById="robot-transfer-description"
      >
        <p id="robot-transfer-description" style={{ marginTop: 0, marginBottom: '0.85rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
          เลือกลูกค้าปลายทางเพื่อโอนหุ่นยนต์เครื่องนี้ หากยังไม่มีลูกค้าในระบบ สามารถพิมพ์ชื่อใหม่เพื่อสร้างและโอนได้ทันที
        </p>
        <form onSubmit={handleTransferRobot} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label className="form-label" htmlFor="robot-transfer-customer">ลูกค้าปลายทาง</label>
            <CustomerCombobox
              id="robot-transfer-customer"
              value={transferCustomerId}
              onChange={id => setTransferCustomerId(id)}
              customers={customers}
              pendingName={transferPendingCustName}
              onPendingName={setTransferPendingCustName}
              required
              placeholder="ค้นหาลูกค้า..."
            />
            {transferError && <div style={{ color: 'var(--status-danger)', fontSize: 11, marginTop: 3 }}>{transferError}</div>}
          </div>
          <div className="responsive-action-group" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-outline" onClick={() => setTransferOpen(false)} disabled={transferSaving}>ยกเลิก</button>
            <FormSubmitButton loading={transferSaving}>ยืนยันโอน</FormSubmitButton>
          </div>
        </form>
      </Modal>

      <Modal
        open={scanAddOpen}
        onClose={() => !scanSubmitting && setScanAddOpen(false)}
        title={<><ScanLine size={18} style={{ color: 'var(--accent-primary)' }} /> เพิ่มหุ่นยนต์ด้วยการสแกน</>}
        width={540}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            ใช้สำหรับรับหุ่นยนต์เข้าคลังแบบเร็ว สแกน <strong>SKU</strong> เพื่อหารุ่นก่อน จากนั้นสแกน <strong>หมายเลขซีเรียล</strong> แล้วเลือกคลัง วันรับเข้า และหมายเหตุ
          </p>
          <div className="card" style={{ padding: '1rem', display: 'grid', gap: '0.85rem' }}>
            <div>
              <label className="form-label" htmlFor="robot-scan-sku">SKU</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '0.5rem' }}>
              <input
                id="robot-scan-sku"
                ref={scanSkuRef}
                className="form-control"
                value={scanForm.sku}
                onChange={e => {
                  setScanForm(prev => ({ ...prev, sku: e.target.value }));
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    resolveScanSku();
                  }
                }}
                placeholder="สแกนหรือกรอก SKU"
                autoComplete="off"
              />
              <CameraScanButton
                disabled={scanSubmitting}
                onScan={value => { setScanForm(prev => ({ ...prev, sku: value })); resolveScanSku(value); }}
              />
              <button className="btn btn-outline" type="button" onClick={() => resolveScanSku()} disabled={!scanForm.sku.trim() || scanSubmitting}>
                ยืนยัน SKU
              </button>
              </div>
            </div>
            <div>
              <label className="form-label" htmlFor="robot-scan-location">คลัง</label>
              <select
                id="robot-scan-location"
                className="form-control"
                value={scanForm.locationId}
                onChange={e => {
                  const nextValue = e.target.value;
                  setScanForm(prev => ({ ...prev, locationId: nextValue }));
                  if (nextValue) window.localStorage.setItem('robots.scanAdd.locationId', nextValue);
                  else window.localStorage.removeItem('robots.scanAdd.locationId');
                }}
              >
                <option value="">— ไม่ระบุ —</option>
                {[...warehouses].sort((a, b) => a.name.localeCompare(b.name)).map(warehouse => (
                  <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label" htmlFor="robot-scan-sn">หมายเลขซีเรียล</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.5rem' }}>
                <input
                  id="robot-scan-sn"
                  ref={scanSerialRef}
                  className="form-control"
                  value={scanForm.serialNumber}
                  onChange={e => setScanForm(prev => ({ ...prev, serialNumber: e.target.value }))}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleScanAddSubmit();
                    }
                  }}
                  placeholder="สแกนหรือกรอก SN"
                  autoComplete="off"
                />
                <CameraScanButton disabled={scanSubmitting} onScan={value => setScanForm(prev => ({ ...prev, serialNumber: value }))} />
              </div>
            </div>
            <div>
              <label className="form-label" htmlFor="robot-scan-date">วันที่รับเข้า</label>
              <ThaiDateInput
                id="robot-scan-date"
                className="form-control"
                value={scanForm.purchaseDate}
                onChange={e => setScanForm(prev => ({ ...prev, purchaseDate: e.target.value }))}
              />
            </div>
            <div>
              <label className="form-label" htmlFor="robot-scan-notes">หมายเหตุ</label>
              <textarea
                id="robot-scan-notes"
                className="form-control"
                rows={2}
                value={scanForm.notes}
                onChange={e => setScanForm(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="เช่น ล็อตรับเข้า / ชื่อเล่น / หมายเหตุภายใน"
              />
            </div>
          </div>
          <div style={{ border: '1px solid var(--border-color)', borderRadius: 10, padding: '0.85rem 1rem', background: 'var(--bg-secondary)', fontSize: 12, color: 'var(--text-muted)' }}>
            สถานะที่จะบันทึก: <strong style={{ color: 'var(--text-primary)' }}>{robotStatusLabels['In Stock']}</strong>
            {scanForm.sku.trim() ? ` | SKU: ${scanForm.sku.trim()}` : ''}
            {resolvedScanModel && resolvedScanModel !== 'AMBIGUOUS' ? ` | รุ่น: ${resolvedScanModel.name}` : ''}
            {resolvedScanModel === 'AMBIGUOUS' ? ' | SKU นี้ซ้ำหลายรุ่น' : ''}
            {scanForm.locationId ? ` | คลัง: ${warehouseNameById.get(scanForm.locationId) || '-'}` : ''}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
            <button className="btn btn-outline" onClick={() => setScanAddOpen(false)} disabled={scanSubmitting}>ปิด</button>
            <FormSubmitButton loading={scanSubmitting} onClick={handleScanAddSubmit} type="button">
              บันทึกหุ่นยนต์
            </FormSubmitButton>
          </div>
        </div>
      </Modal>

      {/* ── Import Excel Modal ── */}
      <Modal open={importOpen} onClose={() => { if (!importLoading) setImportOpen(false); }} title={<><FileSpreadsheet size={20} style={{ marginRight: 8, verticalAlign: 'middle' }} />นำเข้า Excel อัปเดตสถานะ</>} width={620} preventClose={importLoading} describedById="robot-import-description">

        <p id="robot-import-description" style={{ marginTop: 0, marginBottom: '1rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
          อัปโหลดไฟล์ Excel เพื่อ preview และยืนยันการเพิ่มหรืออัปเดตสถานะหุ่นยนต์จากข้อมูลภายนอก
        </p>

            {/* Step: Select File */}
            {importStep === 'select' && (
              <div>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1rem' }}>
                  อัปโหลดไฟล์ <b>Unbound Machine List</b> (.xlsx) จาก Pudu Cloud<br/>
                  ระบบจะตรวจ SN(PID) แล้วอัปเดตสถานะเป็น "ในคลัง" หรือเพิ่มหุ่นยนต์ใหม่เข้าระบบ
                </p>
                <input aria-label="เลือกไฟล์ Excel รายการหุ่นยนต์"
                  ref={importFileRef}
                  type="file"
                  accept=".xlsx,.xls"
                  style={{ display: 'none' }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleImportFile(f); }}
                />
                <div
                  onClick={() => importFileRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
                  onDrop={e => { e.preventDefault(); e.stopPropagation(); const f = e.dataTransfer.files?.[0]; if (f) handleImportFile(f); }}
                  style={{ border: '2px dashed var(--border-color)', borderRadius: 12, padding: '2.5rem 1.5rem', textAlign: 'center', cursor: 'pointer', transition: 'border-color .15s' }}
                >
                  {importLoading ? (
                    <div style={{ color: 'var(--text-muted)' }}>
                      <RefreshCw size={28} style={{ animation: 'spin 1s linear infinite', marginBottom: 8 }} />
                      <div>กำลังวิเคราะห์ไฟล์...</div>
                    </div>
                  ) : (
                    <>
                      <Upload size={36} style={{ color: 'var(--accent-primary)', marginBottom: 8 }} />
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>คลิกเพื่อเลือกไฟล์ หรือลากวางที่นี่</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>รองรับ .xlsx / .xls</div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Step: Preview */}
            {importStep === 'preview' && importPreview && (
              <div>
                <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 100, padding: '0.75rem', borderRadius: 8, background: 'var(--accent-subtle)', textAlign: 'center' }}>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--status-success)' }}>{importPreview.summary.created}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>+ เพิ่มใหม่</div>
                  </div>
                  <div style={{ flex: 1, minWidth: 100, padding: '0.75rem', borderRadius: 8, background: 'var(--accent-subtle)', textAlign: 'center' }}>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--accent-primary)' }}>{importPreview.summary.updated}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>~ อัปเดต</div>
                  </div>
                  <div style={{ flex: 1, minWidth: 100, padding: '0.75rem', borderRadius: 8, background: 'var(--accent-subtle)', textAlign: 'center' }}>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-muted)' }}>{importPreview.summary.skipped}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>– ข้าม</div>
                  </div>
                </div>

                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>ทั้งหมด {importPreview.totalRows} แถว{importPreview.rows.length < importPreview.totalRows ? ` (แสดง ${importPreview.rows.length} รายการแรก)` : ''}</div>

                {importPreview.warnings?.length > 0 && (
                  <div style={{ marginBottom: '0.75rem', padding: '0.6rem 0.8rem', backgroundColor: 'var(--status-warning-bg)', border: '1px solid var(--status-warning)', borderRadius: 8, fontSize: '0.8rem', color: 'var(--text-primary)' }}>
                    {importPreview.warnings.map((w: string, i: number) => <div key={i}>⚠ {w}</div>)}
                  </div>
                )}

                <div className="table-container" style={{ maxHeight: 320, overflowY: 'auto' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>SN</th>
                        <th>รุ่น</th>
                        <th>ตัวแทน</th>
                        <th>การดำเนินการ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importPreview.rows.map((r: any, i: number) => (
                        <tr key={i}>
                          <td style={{ fontVariantNumeric: 'tabular-nums', fontSize: '0.82rem' }}>{r.sn}</td>
                          <td style={{ fontSize: '0.82rem' }}>
                            {r.modelName || '-'}
                            {r.guessedModel && <span style={{ fontSize: '0.65rem', color: 'var(--status-warning)', marginLeft: 4 }} title="เดาจาก SN prefix">⚡ เดา</span>}
                          </td>
                          <td style={{ fontSize: '0.82rem' }}>
                            {r.agentName
                              ? <span className="badge warning" style={{ fontSize: '0.72rem' }}>{r.agentName}</span>
                              : <span style={{ color: 'var(--text-muted)' }}>OZONE</span>}
                          </td>
                          <td>
                            <span className={`badge ${r.action === 'create' ? 'success' : r.action === 'update' ? 'info' : 'secondary'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.75rem' }}>
                              {r.action === 'create' && <Plus size={11} />}
                              {r.action === 'update' && <RefreshCw size={11} />}
                              {r.action === 'skip' && <SkipForward size={11} />}
                              {r.reason}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
                  <button className="btn btn-outline" onClick={openImportModal} disabled={importLoading}>เลือกไฟล์ใหม่</button>
                  <button className="btn btn-primary" onClick={handleImportConfirm} disabled={importLoading || (importPreview.summary.created === 0 && importPreview.summary.updated === 0)}>
                    {importLoading ? (
                      <><RefreshCw size={14} style={{ animation: 'spin 1s linear infinite', marginRight: 6 }} /> กำลังนำเข้า...</>
                    ) : (
                      <><CheckCircle size={14} style={{ marginRight: 4 }} /> ยืนยันนำเข้า</>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Step: Done */}
            {importStep === 'done' && importResult && (
              <div style={{ textAlign: 'center', padding: '1rem 0' }}>
                <CheckCircle size={48} style={{ color: 'var(--status-success)', marginBottom: 12 }} />
                <h3 style={{ marginBottom: '1rem' }}>นำเข้าเรียบร้อยแล้ว</h3>
                <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
                  <div><span style={{ fontWeight: 700, color: 'var(--status-success)' }}>{importResult.created}</span> เพิ่มใหม่</div>
                  <div><span style={{ fontWeight: 700, color: 'var(--accent-primary)' }}>{importResult.updated}</span> อัปเดต</div>
                  <div><span style={{ fontWeight: 700, color: 'var(--text-muted)' }}>{importResult.skipped}</span> ข้าม</div>
                </div>
                {importResult.errors?.length > 0 && (
                  <div style={{ textAlign: 'left', marginBottom: '1rem', padding: '0.75rem', background: 'rgba(220,38,38,0.07)', borderRadius: 8, fontSize: '0.82rem', color: 'var(--status-danger)' }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}><AlertCircle size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />พบข้อผิดพลาด {importResult.errors.length} รายการ</div>
                    {importResult.errors.slice(0, 10).map((e: string, i: number) => <div key={i}>• {e}</div>)}
                    {importResult.errors.length > 10 && <div>...และอีก {importResult.errors.length - 10} รายการ</div>}
                  </div>
                )}
                <button className="btn btn-primary" onClick={() => setImportOpen(false)}>ปิด</button>
              </div>
            )}
          </Modal>
    </div>
  );
};

export default Robots;
