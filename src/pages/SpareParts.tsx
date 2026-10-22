import React, { useRef, useState, useEffect, useMemo } from 'react';
import { todayISO } from '../utils/thaiDate';
import { Package, Plus, Edit2, Trash2, Search, X, AlertTriangle, Download, Tag, FileText, Send, Upload, FileSpreadsheet, ScanLine, LogOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../context/ConfirmContext';
import { useToast } from '../context/ToastContext';
import Pagination from '../components/Pagination';
import { ThaiDateInput } from '../components/ThaiDateInput';
import { TableSkeleton, EmptyState, RefreshButton, useEscapeKey, Modal, FormSubmitButton, useUrlSearch, useTableSort, SortableTh, useOpenFromUrl } from '../components/UIUtils';
import PageHeader from '../components/PageHeader';
import CameraScanButton from '../components/CameraScanButton';
import SinglePhoto from '../components/SinglePhoto';
import PartThumb from '../components/PartThumb';
import CopyButton from '../components/CopyButton';
import PartCatalogPdf from '../components/PartCatalogPdf';
import { useData } from '../context/DataContext';
import { extractDisplayEnglish, sanitizeCategoryDisplay } from '../utils/displayText';

interface SparePart {
  id: string;
  sku: string;
  name: string;
  description?: string;
  category?: string;
  productModel?: string;
  partType?: string;
  location?: string;
  warehouseId?: string;
  warehouse?: { id: string; name: string };
  stock: number;
  minStock: number;
  unitPrice: number;
  supplier?: string;
  status?: string;
  sourceFile?: string;
  sourceSheet?: string;
}

interface SparePartItem {
  id: string;
  sparePartId: string;
  serialNumber: string;
  receivedDate: string;
  warehouseId?: string | null;
  notes?: string | null;
  createdAt?: string;
}

const SpareParts: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const confirm = useConfirm();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const { fetchData: refreshSharedData } = useData();

  const [parts, setParts] = useState<SparePart[]>([]);
  const [loading, setLoading] = useState(true);
  const [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([]);
  const [search, setSearch] = useUrlSearch();
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [stockFilter, setStockFilter] = useState<'All' | 'InStock' | 'Low' | 'Out'>('InStock');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<SparePart | null>(null);

  const [form, setForm] = useState({ sku: '', name: '', description: '', category: '', location: '', warehouseId: '', stock: '0', minStock: '0', unitPrice: '0', supplier: '' });
  const [saving, setSaving] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [transferPart, setTransferPart] = useState<SparePart | null>(null);
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const [transferForm, setTransferForm] = useState({ customerId: '', quantity: '1', serialNumbers: [] as string[], note: '' });
  const [transferItems, setTransferItems] = useState<SparePartItem[]>([]);
  const [transferSnSearch, setTransferSnSearch] = useState('');
  const [transferItemsLoading, setTransferItemsLoading] = useState(false);
  const [transferItemsLoadError, setTransferItemsLoadError] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState<{ created: number; updated: number; skipped: number; total: number; errors: string[]; itemCreated?: number; itemUpdated?: number } | null>(null);
  const [importWarehouseId, setImportWarehouseId] = useState('');
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [itemModalPart, setItemModalPart] = useState<SparePart | null>(null);
  const [detailPartId, setDetailPartId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  useOpenFromUrl(parts, p => p.id, p => setDetailPartId(p.id));
  const [pdfOpen, setPdfOpen] = useState(false);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  // Serial-number rows of the part shown in the detail popup, used to count stock per warehouse.
  const [detailItems, setDetailItems] = useState<SparePartItem[] | null>(null);

  useEffect(() => {
    setDetailItems(null);
    if (!detailPartId) return;
    let cancelled = false;
    api.get(`/spare-parts/${detailPartId}/items`)
      .then(res => { if (!cancelled) setDetailItems(res.data.items || []); })
      .catch(() => { if (!cancelled) setDetailItems([]); });
    return () => { cancelled = true; };
  }, [detailPartId]);

  const loadPhotos = () => {
    api.get<{ elementId: string; url: string }[]>('/attachments/photos/SparePart')
      .then(res => setPhotoUrls(Object.fromEntries(res.data.map(photo => [photo.elementId, photo.url]))))
      .catch(() => {});
  };
  const [partItems, setPartItems] = useState<SparePartItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemSaving, setItemSaving] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [itemForm, setItemForm] = useState({ serialNumber: '', receivedDate: '', notes: '' });
  const [scanInOpen, setScanInOpen] = useState(false);
  const [scanOutOpen, setScanOutOpen] = useState(false);
  const [scanSubmitting, setScanSubmitting] = useState(false);
  const [scanInForm, setScanInForm] = useState({ sku: '', serialNumber: '', receivedDate: todayISO(), warehouseId: '' });
  const [scanOutSerialNumber, setScanOutSerialNumber] = useState('');
  const [scanOutSearchResults, setScanOutSearchResults] = useState<SparePartItem[]>([]);
  const [scanOutSearching, setScanOutSearching] = useState(false);
  const [scanOutDetails, setScanOutDetails] = useState('');
  const [scanOutUseDetails, setScanOutUseDetails] = useState(true);
  const [scanOutCustomerId, setScanOutCustomerId] = useState('');
  const [scanInPart, setScanInPart] = useState<SparePart | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);
  const scanInSkuRef = useRef<HTMLInputElement>(null);
  const scanInSnRef = useRef<HTMLInputElement>(null);
  const scanOutSnRef = useRef<HTMLInputElement>(null);
  const scanInSubmittingRef = useRef(false);
  const scanOutSubmittingRef = useRef(false);

  useEscapeKey(() => setShowModal(false), showModal);
  useEscapeKey(() => setTransferPart(null), !!transferPart && !transferring);
  useEscapeKey(() => setImportOpen(false), importOpen && !importLoading);
  useEscapeKey(() => setItemModalPart(null), !!itemModalPart && !itemSaving);
  useEscapeKey(() => setScanInOpen(false), scanInOpen && !scanSubmitting);
  useEscapeKey(() => setScanOutOpen(false), scanOutOpen && !scanSubmitting);

  const fetchParts = async () => {
    setLoading(true);
    try { const res = await api.get('/spare-parts'); setParts(res.data); setLoadError(false); }
    catch { setLoadError(true); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    fetchParts();
    loadPhotos();
    api.get('/warehouses').then(r => setWarehouses(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    const savedWarehouseId = window.localStorage.getItem('spare-parts.importWarehouseId');
    if (savedWarehouseId) setImportWarehouseId(savedWarehouseId);
  }, []);

  useEffect(() => {
    const savedScanWarehouseId = window.localStorage.getItem('spare-parts.scanInWarehouseId');
    if (!savedScanWarehouseId) return;
    setScanInForm(prev => ({ ...prev, warehouseId: savedScanWarehouseId }));
  }, []);

  useEffect(() => {
    setSelectedIds(prev => new Set(Array.from(prev).filter(id => parts.some(part => part.id === id))));
  }, [parts]);

  useEffect(() => {
    if (!scanInOpen) return;
    setTimeout(() => scanInSkuRef.current?.focus(), 0);
  }, [scanInOpen]);

  useEffect(() => {
    if (!scanOutOpen) return;
    setTimeout(() => scanOutSnRef.current?.focus(), 0);
  }, [scanOutOpen]);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    parts.forEach(p => {
      const sanitized = sanitizeCategoryDisplay(p.category);
      if (sanitized) sanitized.split(',').forEach(c => cats.add(c.trim()));
    });
    return [...cats].sort();
  }, [parts]);

  const displayParts = useMemo(() => parts.map(part => ({
    ...part,
    displayName: extractDisplayEnglish(part.name, part.sku),
    displayDescription: extractDisplayEnglish(part.description, ''),
    displayCategory: sanitizeCategoryDisplay(part.category),
    displayProductModel: extractDisplayEnglish(part.productModel, ''),
    displaySupplier: extractDisplayEnglish(part.supplier, ''),
  })), [parts]);

  const getQuantity = (part: SparePart) => Math.max(0, Number(part.stock) || 0);
  const getLowStockThreshold = (part: SparePart) => {
    const minStock = Math.max(0, Number(part.minStock) || 0);
    return minStock > 0 ? minStock : 1;
  };
  const isOutOfStock = (part: SparePart) => getQuantity(part) === 0;
  const isLowStock = (part: SparePart) => {
    const quantity = getQuantity(part);
    return quantity > 0 && quantity <= getLowStockThreshold(part);
  };

  const filtered = useMemo(() => displayParts.filter(p => {
    const q = search.toLowerCase();
    const matchSearch = !q
      || p.sku.toLowerCase().includes(q)
      || p.name.toLowerCase().includes(q)
      || (p.description || '').toLowerCase().includes(q)
      || p.displayName.toLowerCase().includes(q)
      || p.displayDescription.toLowerCase().includes(q)
      || p.displayCategory.toLowerCase().includes(q)
      || p.displayProductModel.toLowerCase().includes(q)
      || p.displaySupplier.toLowerCase().includes(q);
    const matchCat = categoryFilter === 'All' || p.displayCategory.includes(categoryFilter);
    const quantity = getQuantity(p);
    const matchStock =
      stockFilter === 'All' ||
      (stockFilter === 'InStock' && quantity > 0) ||
      (stockFilter === 'Out' && isOutOfStock(p)) ||
      (stockFilter === 'Low' && isLowStock(p));
    return matchSearch && matchCat && matchStock;
  }), [displayParts, search, categoryFilter, stockFilter]);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  useEffect(() => { setPage(1); }, [search, categoryFilter, stockFilter]);
  const sort = useTableSort<typeof filtered[0]>({
    sku: p => p.sku,
    name: p => p.displayName,
    category: p => p.displayCategory,
    warehouse: p => p.warehouse?.name || p.location || '',
    stock: p => getQuantity(p),
    unitPrice: p => p.unitPrice,
    value: p => getQuantity(p) * p.unitPrice,
    supplier: p => p.displaySupplier,
  });
  const paginated = sort.apply(filtered).slice((page - 1) * pageSize, page * pageSize);
  const allVisibleSelected = paginated.length > 0 && paginated.every(part => selectedIds.has(part.id));

  const openAdd = () => {
    setEditing(null);
    setFormErrors({});
    setForm({ sku: '', name: '', description: '', category: '', location: '', warehouseId: '', stock: '0', minStock: '0', unitPrice: '0', supplier: '' });
    setShowModal(true);
  };

  const openEdit = (p: SparePart) => {
    setEditing(p);
    setFormErrors({});
    setForm({
      sku: p.sku, name: p.name, description: p.description || '', category: p.category || '',
      location: p.location || '', warehouseId: p.warehouseId || '', stock: String(p.stock), minStock: String(p.minStock),
      unitPrice: String(p.unitPrice), supplier: p.supplier || '',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    // Validate
    const errors: Record<string, string> = {};
    if (!form.sku.trim()) errors.sku = 'กรุณากรอก SKU';
    if (!form.name.trim()) errors.name = 'กรุณากรอกชื่ออะไหล่';
    const stockNum = parseInt(form.stock) || 0;
    const minStockNum = parseInt(form.minStock) || 0;
    if (minStockNum > stockNum) errors.minStock = `สต๊อกขั้นต่ำ (${minStockNum}) มากกว่าสต๊อกปัจจุบัน (${stockNum})`;
    if (Object.keys(errors).length) { setFormErrors(errors); return; }
    setFormErrors({});
    setSaving(true);
    try {
      const payload = {
        sku: form.sku.trim(), name: form.name.trim(),
        description: form.description || null, category: form.category || null,
        location: form.location || null, warehouseId: form.warehouseId || null,
        stock: parseInt(form.stock) || 0,
        minStock: parseInt(form.minStock) || 0, unitPrice: parseFloat(form.unitPrice) || 0,
        supplier: form.supplier || null,
      };
      if (editing) await api.put(`/spare-parts/${editing.id}`, payload);
      else await api.post('/spare-parts', payload);
      setShowModal(false);
      showToast(editing ? 'แก้ไขอะไหล่สำเร็จ' : 'เพิ่มอะไหล่สำเร็จ', 'success');
      await Promise.all([fetchParts(), refreshSharedData()]);
    } catch (err) {
      const response = (err as { response?: { data?: { error?: string }; status?: number } }).response;
      const message = response?.data?.error || (response?.status ? `บันทึกไม่สำเร็จ (รหัส ${response.status})` : 'บันทึกไม่สำเร็จ ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์');
      setFormErrors({ form: message });
      showToast(message, 'error');
    } finally { setSaving(false); }
  };

  const handleDelete = async (p: SparePart) => {
    const displayName = extractDisplayEnglish(p.name, p.sku);
    if (!await confirm(`ลบอะไหล่ "${displayName}"?`, { title: 'ยืนยันการลบ', danger: true, confirmLabel: 'ลบ' })) return;
    await api.delete(`/spare-parts/${p.id}`);
    showToast(`ลบ "${displayName}" แล้ว`, 'success');
    fetchParts();
  };

  const handleBulkDelete = async () => {
    if (!selectedIds.size) return;
    if (!await confirm(`ลบอะไหล่ ${selectedIds.size} รายการ?`, { title: 'ยืนยันการลบหลายรายการ', danger: true, confirmLabel: 'ลบทั้งหมด' })) return;
    setBulkDeleting(true);
    try {
      const res = await api.post('/spare-parts/bulk-delete', { ids: Array.from(selectedIds) });
      setSelectedIds(new Set());
      showToast(`ลบอะไหล่แล้ว ${res.data.deleted ?? 0} รายการ`, 'success');
      await fetchParts();
    } catch (err: any) {
      showToast(err?.response?.data?.error || 'ลบหลายรายการไม่สำเร็จ', 'error');
    } finally {
      setBulkDeleting(false);
    }
  };

  const openTransfer = async (p: SparePart) => {
    setTransferForm({ customerId: '', quantity: '1', serialNumbers: [], note: '' });
    setTransferSnSearch('');
    setTransferPart(p);
    setTransferItems([]);
    setTransferItemsLoading(true);
    setTransferItemsLoadError(false);
    if (customers.length === 0) {
      try { const r = await api.get('/customers'); setCustomers(r.data); } catch {}
    }
    try {
      const r = await api.get(`/spare-parts/${p.id}/items`);
      setTransferItems(r.data.items || []);
    } catch {
      setTransferItemsLoadError(true);
      showToast('โหลดรายการ SN ไม่สำเร็จ', 'error');
    } finally {
      setTransferItemsLoading(false);
    }
  };

  const handleTransferSnScan = (scannedValue?: string) => {
    const raw = (scannedValue ?? transferSnSearch).trim();
    const scanned = raw.toLowerCase();
    if (!scanned) return;
    const match = transferItems.find(item => item.serialNumber.toLowerCase() === scanned);
    if (!match) { showToast(`ไม่พบ SN "${raw}" ในอะไหล่นี้`, 'error'); return; }
    setTransferForm(f => f.serialNumbers.includes(match.serialNumber) ? f : { ...f, serialNumbers: [...f.serialNumbers, match.serialNumber] });
    setTransferSnSearch('');
    showToast(`เลือก SN ${match.serialNumber} แล้ว`, 'success');
  };

  const handleTransfer = async () => {
    if (!transferPart) return;
    if (transferItemsLoading || transferItemsLoadError) { showToast('ยังโหลดรายการ SN ไม่เสร็จ กรุณาลองใหม่', 'error'); return; }
    const qty = parseInt(transferForm.quantity) || 0;
    if (!transferForm.customerId) { showToast('กรุณาเลือกลูกค้า', 'error'); return; }
    const hasTrackedItems = transferItems.length > 0;
    if (hasTrackedItems) {
      if (transferForm.serialNumbers.length === 0) { showToast('กรุณาเลือก SN ที่ต้องการโอน', 'error'); return; }
      if (transferForm.serialNumbers.length > transferPart.stock) { showToast(`เลือก SN ได้ไม่เกิน ${transferPart.stock} ชิ้น`, 'error'); return; }
    } else if (qty <= 0 || qty > transferPart.stock) { showToast(`ระบุจำนวน 1–${transferPart.stock}`, 'error'); return; }
    setTransferring(true);
    try {
      const res = await api.post(`/spare-parts/${transferPart.id}/transfer`, {
        customerId: transferForm.customerId,
        quantity: hasTrackedItems ? transferForm.serialNumbers.length : qty,
        serialNumbers: hasTrackedItems ? transferForm.serialNumbers : undefined,
        note: transferForm.note || null,
      });
      const transferredQty = transferItems.length > 0 ? transferForm.serialNumbers.length : qty;
      showToast(`โอน ${transferredQty} ชิ้น → ${res.data.customerName ?? 'ลูกค้า'} สำเร็จ`, 'success');
      setTransferPart(null);
      fetchParts();
    } catch (err: any) {
      showToast(err?.response?.data?.error || 'เกิดข้อผิดพลาด', 'error');
    } finally { setTransferring(false); }
  };

  const openItemModal = async (part: SparePart) => {
    setItemModalPart(part);
    setEditingItemId(null);
    setItemForm({ serialNumber: '', receivedDate: todayISO(), notes: '' });
    setItemsLoading(true);
    try {
      const res = await api.get(`/spare-parts/${part.id}/items`);
      setPartItems(res.data.items || []);
    } catch {
      setPartItems([]);
      showToast('โหลดรายการ SN ไม่สำเร็จ', 'error');
    } finally {
      setItemsLoading(false);
    }
  };

  const resetItemEditor = () => {
    setEditingItemId(null);
    setItemForm({ serialNumber: '', receivedDate: todayISO(), notes: '' });
  };

  const findPartBySku = (sku: string) => {
    const normalized = sku.trim().toLowerCase();
    if (!normalized) return null;
    return parts.find(part => part.sku.trim().toLowerCase() === normalized) ?? null;
  };

  const resolveScanInPart = (skuOverride?: string) => {
    const matchedPart = findPartBySku(skuOverride ?? scanInForm.sku);
    if (!matchedPart) {
      setScanInPart(null);
      showToast('ไม่พบ SKU นี้ในรายการอะไหล่', 'error');
      return null;
    }
    setScanInPart(matchedPart);
    setTimeout(() => scanInSnRef.current?.focus(), 0);
    return matchedPart;
  };

  const openScanInModal = () => {
    setScanInPart(null);
    const savedWarehouseId = window.localStorage.getItem('spare-parts.scanInWarehouseId') || '';
    setScanInForm({ sku: '', serialNumber: '', receivedDate: todayISO(), warehouseId: savedWarehouseId });
    setScanInOpen(true);
  };

  const openScanOutModal = () => {
    setScanOutSerialNumber('');
    setScanOutSearchResults([]);
    setScanOutSearching(false);
    setScanOutDetails('');
    setScanOutUseDetails(true);
    setScanOutCustomerId('');
    setScanOutOpen(true);
    if (customers.length === 0) {
      api.get('/customers').then(r => setCustomers(r.data)).catch(() => showToast('โหลดรายชื่อลูกค้าไม่สำเร็จ', 'error'));
    }
  };

  const handleScanInSubmit = async () => {
    if (scanInSubmittingRef.current) return;
    const matchedPart = scanInPart ?? resolveScanInPart();
    if (!matchedPart) return;
    if (!scanInForm.warehouseId) {
      showToast('กรุณาเลือกคลังสำหรับการรับอะไหล่เข้า', 'error');
      return;
    }
    if (!scanInForm.serialNumber.trim()) {
      showToast('กรุณาสแกน SN', 'error');
      scanInSnRef.current?.focus();
      return;
    }
    scanInSubmittingRef.current = true;
    setScanSubmitting(true);
    try {
      const res = await api.post(`/spare-parts/${matchedPart.id}/items`, {
        serialNumber: scanInForm.serialNumber.trim(),
        receivedDate: scanInForm.receivedDate,
        warehouseId: scanInForm.warehouseId,
      });
      const selectedWarehouse = warehouses.find(warehouse => warehouse.id === scanInForm.warehouseId);
      setParts(prev => prev.map(part => part.id === matchedPart.id ? {
        ...part,
        stock: res.data.stock ?? part.stock,
        warehouseId: scanInForm.warehouseId,
        location: selectedWarehouse?.name ?? part.location,
        warehouse: selectedWarehouse ? { id: selectedWarehouse.id, name: selectedWarehouse.name } : part.warehouse,
      } : part));
      showToast(`รับอะไหล่เข้าแล้ว: ${matchedPart.sku} / ${scanInForm.serialNumber.trim()} / ${selectedWarehouse?.name ?? '-'}`, 'success');
      await fetchParts();
      try { window.localStorage.setItem('spare-parts.scanInWarehouseId', scanInForm.warehouseId); } catch { /* storage blocked */ }
      setScanInForm(prev => ({ ...prev, serialNumber: '' }));
      setTimeout(() => scanInSnRef.current?.focus(), 0);
    } catch (err: any) {
      showToast(err?.response?.data?.error || 'บันทึกรายการสแกนเข้าไม่สำเร็จ', 'error');
    } finally {
      scanInSubmittingRef.current = false;
      setScanSubmitting(false);
    }
  };

  const handleScanOutSubmit = async () => {
    if (scanOutSubmittingRef.current) return;
    if (!scanOutSerialNumber.trim()) {
      showToast('กรุณาสแกน SN', 'error');
      scanOutSnRef.current?.focus();
      return;
    }
    if (scanOutUseDetails && !scanOutDetails.trim()) {
      showToast('กรุณากรอกรายละเอียดการนำอะไหล่ออก', 'error');
      return;
    }
    if (!scanOutUseDetails && !scanOutCustomerId) {
      showToast('กรุณาเลือกลูกค้าที่ต้องการส่งให้', 'error');
      return;
    }
    const normalizedSerialNumber = scanOutSerialNumber.trim();
    const normalizedDetails = scanOutDetails.trim();
    scanOutSubmittingRef.current = true;
    setScanSubmitting(true);
    try {
      const res = await api.post('/spare-parts/scan-out', {
        serialNumber: normalizedSerialNumber,
        details: scanOutUseDetails ? normalizedDetails : '',
        customerId: scanOutUseDetails ? null : scanOutCustomerId,
      });
      const updatedPart = res.data.part as SparePart | undefined;
      if (updatedPart) {
        setParts(prev => prev.map(part => part.id === updatedPart.id ? updatedPart : part));
      }
      showToast(`นำอะไหล่ออกแล้ว: ${res.data.item?.serialNumber ?? normalizedSerialNumber}`, 'success');
      setScanOutSerialNumber('');
      setScanOutSearchResults([]);
      setScanOutDetails('');
      setScanOutCustomerId('');
      setTimeout(() => scanOutSnRef.current?.focus(), 0);
    } catch (err: any) {
      const message = err?.response?.data?.error;
      showToast(message || 'นำอะไหล่ออกไม่สำเร็จ', 'error');
    } finally {
      scanOutSubmittingRef.current = false;
      setScanSubmitting(false);
    }
  };

  const handleScanOutSearch = async () => {
    const query = scanOutSerialNumber.trim();
    if (query.length < 5) {
      showToast('กรุณาพิมพ์ SN อย่างน้อย 5 ตัวอักษร', 'error');
      return;
    }
    setScanOutSearching(true);
    try {
      const res = await api.get('/spare-parts/scan-out/search', { params: { query } });
      setScanOutSearchResults(res.data.items || []);
      if (!(res.data.items || []).length) showToast('ไม่พบ SN ที่ตรงกัน', 'error');
    } catch (err: any) {
      showToast(err?.response?.data?.error || 'ค้นหา SN ไม่สำเร็จ', 'error');
      setScanOutSearchResults([]);
    } finally {
      setScanOutSearching(false);
    }
  };

  const handleSaveItem = async () => {
    if (!itemModalPart) return;
    if (!itemForm.serialNumber.trim()) { showToast('กรุณากรอก SN', 'error'); return; }
    if (!itemForm.receivedDate) { showToast('กรุณากรอกวันที่นำของเข้า', 'error'); return; }
    setItemSaving(true);
    try {
      const url = editingItemId
        ? `/spare-parts/${itemModalPart.id}/items/${editingItemId}`
        : `/spare-parts/${itemModalPart.id}/items`;
      const method = editingItemId ? api.put : api.post;
      const res = await method(url, itemForm);
      const itemsRes = await api.get(`/spare-parts/${itemModalPart.id}/items`);
      setPartItems(itemsRes.data.items || []);
      setParts(prev => prev.map(part => part.id === itemModalPart.id ? { ...part, stock: res.data.stock ?? part.stock } : part));
      showToast(editingItemId ? 'อัปเดตรายการ SN แล้ว' : 'เพิ่มรายการ SN แล้ว', 'success');
      resetItemEditor();
      await fetchParts();
    } catch (err: any) {
      showToast(err?.response?.data?.error || 'บันทึกรายการ SN ไม่สำเร็จ', 'error');
    } finally {
      setItemSaving(false);
    }
  };

  const handleDeleteItem = async (item: SparePartItem) => {
    if (!itemModalPart) return;
    if (!await confirm(`ลบ SN "${item.serialNumber}"?`, { title: 'ยืนยันการลบรายการ SN', danger: true, confirmLabel: 'ลบ' })) return;
    setItemSaving(true);
    try {
      const res = await api.delete(`/spare-parts/${itemModalPart.id}/items/${item.id}`);
      setPartItems(prev => prev.filter(row => row.id !== item.id));
      setParts(prev => prev.map(part => part.id === itemModalPart.id ? { ...part, stock: res.data.stock ?? part.stock } : part));
      showToast(`ลบ ${item.serialNumber} แล้ว`, 'success');
      await fetchParts();
    } catch (err: any) {
      showToast(err?.response?.data?.error || 'ลบรายการ SN ไม่สำเร็จ', 'error');
    } finally {
      setItemSaving(false);
    }
  };

  const inStockParts = parts.filter(p => getQuantity(p) > 0);
  const totalValue = inStockParts.reduce((s, p) => s + getQuantity(p) * p.unitPrice, 0);
  const lowCount = parts.filter(isLowStock).length;
  const outCount = parts.filter(p => p.minStock > 0 && p.stock <= 0).length;

  const exportCSV = () => {
    const header = ['SKU', 'ชื่ออะไหล่', 'หมวดหมู่', 'ที่เก็บ', 'จำนวนคงเหลือ', 'สต๊อกขั้นต่ำ', 'ราคา/หน่วย', 'ผู้จัดจำหน่าย'];
    const rows = displayParts.map(p => [p.sku, p.displayName, p.displayCategory ?? '', p.location ?? '', p.stock, p.minStock, p.unitPrice, p.displaySupplier ?? '']);
    const csv = [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `spare-parts-${new Date().toISOString().slice(0,10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (file: File) => {
    if (!importWarehouseId) {
      showToast('กรุณาเลือกคลังสำหรับการนำเข้าอะไหล่', 'error');
      return;
    }
    setImportLoading(true);
    setImportResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('warehouseId', importWarehouseId);
      const res = await api.post('/spare-parts/import', fd);
      setImportResult(res.data);
      await fetchParts();
      showToast(`นำเข้าอะไหล่สำเร็จ: SKU เพิ่ม ${res.data.created} / SKU อัปเดต ${res.data.updated} / SN เพิ่ม ${res.data.itemCreated ?? 0} / SN อัปเดต ${res.data.itemUpdated ?? 0}`, 'success');
    } catch (err: any) {
      showToast(err?.response?.data?.error || 'นำเข้าไฟล์ไม่สำเร็จ', 'error');
    } finally {
      setImportLoading(false);
      if (importFileRef.current) importFileRef.current.value = '';
    }
  };

  return (
    <div className="page-container">
      <PageHeader
        title="อะไหล่"
        subtitle={`แสดง ${filtered.length} จาก ${parts.length} รายการอะไหล่`}
        meta={<span className="badge info">{parts.length}</span>}
        actions={<>
          {isAdmin && (
            <button className="btn btn-primary" onClick={openAdd}>
              <Plus size={16} /> เพิ่มอะไหล่
            </button>
          )}
          <button className="btn btn-ghost" onClick={() => navigate('/delivery-notes')} title="ใบส่งอะไหล่">
            <FileText size={15} /> ใบส่งอะไหล่
          </button>
          <button className="btn btn-ghost" onClick={() => setPdfOpen(true)} title="ส่งออก PDF ส่งให้ลูกค้า">
            <FileText size={15} /> PDF ให้ลูกค้า
          </button>
          <RefreshButton onClick={fetchParts} loading={loading} />
        </>}
        overflowActions={[
          <button className="btn btn-ghost" onClick={exportCSV} title="ส่งออก CSV">
            <Download size={15} /> CSV
          </button>,
          isAdmin && (
            <button className="btn btn-outline" onClick={() => { setImportResult(null); setImportOpen(true); }}>
              <Upload size={16} /> นำเข้า Excel
            </button>
          ),
        ].filter(Boolean) as React.ReactNode[]}
      />

      {pdfOpen && (
        <PartCatalogPdf
          parts={displayParts}
          photoUrls={photoUrls}
          initialIds={Array.from(selectedIds)}
          onClose={() => setPdfOpen(false)}
        />
      )}

      {/* Stats */}
      <div className="responsive-stats-grid" style={{ gap: '1rem', marginBottom: '1.5rem' }}>
        {[
          { label: 'รายการทั้งหมด', value: parts.length, color: 'var(--accent-primary)' },
          { label: `มูลค่ารวม (${inStockParts.length} รายการ)`, value: `฿${totalValue.toLocaleString()}`, color: 'var(--status-success)' },
          { label: 'สต๊อกต่ำ', value: lowCount, color: 'var(--status-warning)' },
          { label: 'หมดสต๊อก', value: outCount, color: 'var(--status-danger)' },
        ].map(s => (
          <div key={s.label} className="card" style={{ padding: '1rem 1.25rem' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="responsive-toolbar">
        <div className="responsive-toolbar-search">
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input aria-label="ค้นหา SKU / ชื่อ / รายละเอียด..." className="form-control" style={{ paddingLeft: '2rem', paddingRight: '2rem' }} placeholder="ค้นหา SKU / ชื่อ / รายละเอียด..." value={search} onChange={e => setSearch(e.target.value)} />
          {!search && <CameraScanButton variant="inline" onScan={setSearch} />}
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="ล้างคำค้นหาอะไหล่"
              title="ล้างคำค้นหา"
              style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', padding: 0 }}
            >
              <X size={13} />
            </button>
          )}
        </div>
        {isAdmin && (
          <button className="btn btn-outline" type="button" onClick={openScanInModal}>
            <ScanLine size={15} /> รับอะไหล่เข้า
          </button>
        )}
        {isAdmin && (
          <button className="btn btn-outline" type="button" onClick={openScanOutModal}>
            <LogOut size={15} /> นำอะไหล่ออก
          </button>
        )}
        <select aria-label="กรองตามหมวดหมู่" className="form-control" style={{ minWidth: 160 }} value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
          <option value="All">— หมวดหมู่ทั้งหมด —</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <div className="responsive-toolbar-filters">
          {([['All','สต๊อกทั้งหมด'],['InStock','มีของ'],['Low','สต๊อกต่ำ'],['Out','หมดสต๊อก']] as [string,string][]).map(([v,l]) => (
            <button key={v} type="button" onClick={() => setStockFilter(v as any)} style={{ padding: '5px 12px', borderRadius: 999, fontSize: 12, fontWeight: stockFilter===v?700:500, border: `1.5px solid ${stockFilter===v?'var(--accent-primary)':'var(--border-color)'}`, background: stockFilter===v?'var(--accent-subtle)':'transparent', color: stockFilter===v?'var(--accent-primary)':'var(--text-secondary)', cursor: 'pointer', transition: 'all .15s' }}>{l}</button>
          ))}
        </div>
        {(search || categoryFilter !== 'All' || stockFilter !== 'InStock') && (
          <button className="btn btn-outline" style={{ fontSize: 13 }} onClick={() => { setSearch(''); setCategoryFilter('All'); setStockFilter('InStock'); }}>
            <X size={13} /> ล้าง
          </button>
        )}
        <span className="responsive-toolbar-meta">{filtered.length} รายการ</span>
      </div>

      {/* Table */}
      {isAdmin && selectedIds.size > 0 && (
        <div className="card responsive-action-group" style={{ marginBottom: '1rem', padding: '0.75rem 1rem' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent-primary)' }}>เลือก {selectedIds.size} รายการ</span>
          <button className="btn" style={{ color: 'var(--status-danger)' }} onClick={handleBulkDelete} disabled={bulkDeleting}>
            <Trash2 size={14} /> {bulkDeleting ? 'กำลังลบ...' : 'ลบที่เลือก'}
          </button>
          <button className="btn btn-outline" onClick={() => setSelectedIds(new Set())}>ยกเลิก</button>
        </div>
      )}
      <div className="card">
        <div className="table-container">
          <table className="parts-table no-cards">
            <thead>
              <tr>
                {isAdmin && (
                  <th style={{ width: 42, textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      style={{ accentColor: 'var(--accent-primary)', cursor: 'pointer' }}
                      checked={allVisibleSelected}
                      onChange={() => {
                        const next = new Set(selectedIds);
                        if (allVisibleSelected) paginated.forEach(part => next.delete(part.id));
                        else paginated.forEach(part => next.add(part.id));
                        setSelectedIds(next);
                      }}
                      aria-label="เลือกอะไหล่ทั้งหมดในหน้านี้"
                    />
                  </th>
                )}
                <SortableTh {...sort.th('sku')}>SKU</SortableTh>
                <th style={{ width: 52 }}>รูป</th>
                <SortableTh {...sort.th('name')}>ชื่อ</SortableTh>
                <SortableTh {...sort.th('category')}>หมวดหมู่</SortableTh>
                <SortableTh {...sort.th('warehouse')}>คลัง</SortableTh>
                <SortableTh {...sort.th('stock')} style={{ textAlign: 'center' }}>สต๊อก</SortableTh>
                <SortableTh {...sort.th('unitPrice')} style={{ textAlign: 'right' }}>ราคา (฿)</SortableTh>
                <SortableTh {...sort.th('value')} style={{ textAlign: 'right' }}>มูลค่า (฿)</SortableTh>
                <SortableTh {...sort.th('supplier')}>ผู้จัดจำหน่าย</SortableTh>
                <th>การดำเนินการ</th>
              </tr>
            </thead>
            <tbody>
              {loading && <TableSkeleton cols={isAdmin ? 11 : 10} />}
              {!loading && filtered.length === 0 && (
                <EmptyState
                  mascot={loadError ? 'loadError' : parts.length > 0 ? 'noResults' : 'emptyList'}
                  icon={<Package size={40} />}
                  title={loadError ? 'โหลดรายการอะไหล่ไม่สำเร็จ' : parts.length > 0 ? 'ไม่มีอะไหล่ตรงกับตัวกรอง' : 'ยังไม่มีอะไหล่ในระบบ'}
                  description={loadError ? 'กดปุ่มรีเฟรชเพื่อลองใหม่' : parts.length > 0 ? `มีอะไหล่ทั้งหมด ${parts.length} รายการ แต่ถูกซ่อนด้วยการค้นหาหรือตัวกรอง` : undefined}
                  action={!loadError && parts.length > 0 ? (
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => { setSearch(''); setCategoryFilter('All'); setStockFilter('All'); }}>ดูอะไหล่ทั้งหมด</button>
                  ) : loadError ? (
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => void fetchParts()}>ลองใหม่</button>
                  ) : undefined}
                  colSpan={isAdmin ? 11 : 10}
                />
              )}
              {paginated.map(p => {
                const quantity = getQuantity(p);
                const isLow = isLowStock(p);
                const isOut = isOutOfStock(p);
                return (
                  <tr key={p.id} style={{ background: selectedIds.has(p.id) ? 'var(--accent-subtle)' : undefined }}>
                    {isAdmin && (
                      <td className="part-cb" style={{ textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          style={{ accentColor: 'var(--accent-primary)', cursor: 'pointer' }}
                          checked={selectedIds.has(p.id)}
                          onChange={() => {
                            const next = new Set(selectedIds);
                            if (next.has(p.id)) next.delete(p.id);
                            else next.add(p.id);
                            setSelectedIds(next);
                          }}
                          aria-label={`เลือกอะไหล่ ${p.displayName}`}
                        />
                      </td>
                    )}
                    <td className="part-sku" style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12, fontWeight: 600 }}>{p.sku}</td>
                    <td className="part-photo">
                      <PartThumb url={photoUrls[p.id]} label={`รูปของ ${p.displayName}`} onEmptyClick={() => setDetailPartId(p.id)} />
                    </td>
                    <td className="part-name">
                      <button
                        type="button"
                        onClick={() => setDetailPartId(p.id)}
                        title="ดูรายละเอียดและรูปอะไหล่"
                        aria-label={`ดูรายละเอียด ${p.displayName}`}
                        style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 500, color: 'var(--accent-primary)', cursor: 'pointer', textAlign: 'left' }}
                      >
                        {p.displayName}
                      </button>
                      {p.displayDescription && <div style={{ fontSize: 11, color: 'var(--text-muted)', maxWidth: 240, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.displayDescription}</div>}
                    </td>
                    <td className="part-cat">
                      {p.displayCategory && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                          {p.displayCategory.split(',').slice(0, 3).map(c => (
                            <span key={c} className="badge" style={{ fontSize: 10 }}>{c.trim()}</span>
                          ))}
                          {p.displayCategory.split(',').length > 3 && <span className="badge" style={{ fontSize: 10 }}>+{p.displayCategory.split(',').length - 3}</span>}
                        </div>
                      )}
                    </td>
                    <td className="part-wh" style={{ fontSize: 12 }}>
                      <span className="badge" style={{ fontSize: 10 }}>
                        {p.warehouse?.name || p.location || '—'}
                      </span>
                    </td>
                    <td className="part-stock" style={{ textAlign: 'center' }}>
                      <button
                        type="button"
                        onClick={() => openItemModal(p)}
                        className={`badge ${isOut ? 'danger' : isLow ? 'warning' : 'info'}`}
                        style={{ minWidth: 40, display: 'inline-flex', alignItems: 'center', gap: 3, border: 'none', cursor: 'pointer' }}
                        title="ดูรายการ SN และวันที่นำของเข้า"
                      >
                        {(isOut || isLow) && <AlertTriangle size={10} />}
                        {quantity}
                      </button>
                    </td>
                    <td className="part-price" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 13 }}>฿{p.unitPrice.toLocaleString()}</td>
                    <td className="part-value" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 13, color: quantity > 0 ? 'var(--status-success)' : 'var(--text-muted)' }}>
                      {quantity > 0 ? `฿${(quantity * p.unitPrice).toLocaleString()}` : '—'}
                    </td>
                    <td className="text-muted part-sup" style={{ fontSize: 12 }}>{p.displaySupplier || '—'}</td>
                    <td className="part-act">
                      {isAdmin && (
                        <div className="responsive-table-actions" style={{ justifyContent: 'flex-start' }}>
                          <button className="btn btn-outline" style={{ padding: '0.3rem 0.5rem', color: 'var(--accent-primary)' }} title="โอนให้ลูกค้า" aria-label={`โอนอะไหล่ ${p.displayName} ให้ลูกค้า`} onClick={() => openTransfer(p)}><Send size={13} /></button>
                          <button className="btn btn-outline" style={{ padding: '0.3rem 0.5rem' }} title="แก้ไข" aria-label={`แก้ไขอะไหล่ ${p.displayName}`} onClick={() => openEdit(p)}><Edit2 size={13} /></button>
                          <button className="btn" style={{ padding: '0.3rem 0.5rem', color: 'var(--status-danger)' }} title="ลบ" aria-label={`ลบอะไหล่ ${p.displayName}`} onClick={() => handleDelete(p)}><Trash2 size={13} /></button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
      </div>

      {/* Modal */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title={<><Tag size={18} style={{ color: 'var(--accent-primary)' }} /> {editing ? 'แก้ไขอะไหล่' : 'เพิ่มอะไหล่'}</>} width={580} describedById="spare-part-form-description">

        <p id="spare-part-form-description" style={{ marginTop: 0, marginBottom: '0.9rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
          กำหนด SKU ชื่ออะไหล่ หมวดหมู่ จำนวนคงเหลือ จุดจัดเก็บ และราคาต่อหน่วยของอะไหล่ในคลัง
        </p>

            {/* Body */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <div className="responsive-form-grid-2">
                <div>
                  <label className="form-label" htmlFor="sp-sku">SKU <span style={{ color: 'var(--status-danger)' }}>*</span></label>
                  <input id="sp-sku" className={`form-control${formErrors.sku ? ' is-invalid' : ''}`} value={form.sku} onChange={e => setForm(f => ({ ...f, sku: e.target.value }))} placeholder="เช่น 19999-000848" />
                  {formErrors.sku && <div style={{ color: 'var(--status-danger)', fontSize: 11, marginTop: 3 }}>{formErrors.sku}</div>}
                </div>
                <div>
                  <label className="form-label" htmlFor="sp-name">ชื่ออะไหล่ <span style={{ color: 'var(--status-danger)' }}>*</span></label>
                  <input id="sp-name" className={`form-control${formErrors.name ? ' is-invalid' : ''}`} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="ชื่ออะไหล่" />
                  {formErrors.name && <div style={{ color: 'var(--status-danger)', fontSize: 11, marginTop: 3 }}>{formErrors.name}</div>}
                </div>
              </div>
              <div>
                <label className="form-label" htmlFor="sp-desc">รายละเอียด</label>
                <input id="sp-desc" className="form-control" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="คำอธิบาย" />
              </div>
              <div className="responsive-form-grid-2">
                <div>
                  <label className="form-label" htmlFor="sp-cat">หมวดหมู่</label>
                  <input id="sp-cat" className="form-control" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} placeholder="เช่น BellaBot, FlashBot" />
                </div>
                <div>
                  <label className="form-label" htmlFor="sp-supplier">ผู้จัดจำหน่าย</label>
                  <input id="sp-supplier" className="form-control" value={form.supplier} onChange={e => setForm(f => ({ ...f, supplier: e.target.value }))} placeholder="ชื่อผู้จัดจำหน่าย" />
                </div>
              </div>
              <div className="responsive-form-grid-3">
                <div>
                  <label className="form-label" htmlFor="sp-stock">สต๊อก</label>
                  <input id="sp-stock" className="form-control" type="number" min={0} value={form.stock} readOnly disabled />
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>นับจากจำนวน SN ที่มีในรายการเท่านั้น</div>
                </div>
                <div>
                  <label className="form-label" htmlFor="sp-min">สต๊อกขั้นต่ำ</label>
                  <input id="sp-min" className={`form-control${formErrors.minStock ? ' is-invalid' : ''}`} type="number" min={0} value={form.minStock} onChange={e => setForm(f => ({ ...f, minStock: e.target.value }))} />
                  {formErrors.minStock && <div style={{ color: 'var(--status-warning)', fontSize: 11, marginTop: 3 }}>{formErrors.minStock}</div>}
                </div>
                <div>
                  <label className="form-label" htmlFor="sp-price">ราคา / หน่วย (฿)</label>
                  <input id="sp-price" className="form-control" type="number" min={0} step={0.01} value={form.unitPrice} onChange={e => setForm(f => ({ ...f, unitPrice: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="form-label" htmlFor="sp-wh">ที่เก็บ (คลัง)</label>
                <select id="sp-wh" className="form-control" value={form.warehouseId} onChange={e => setForm(f => ({ ...f, warehouseId: e.target.value }))}>
                  <option value="">— ไม่ระบุ —</option>
                  {[...warehouses].sort((a, b) => a.name.localeCompare(b.name)).map(w => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label" htmlFor="sp-loc">ตำแหน่งจัดเก็บ (ข้อความ)</label>
                <input id="sp-loc" className="form-control" value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="เช่น ชั้น A / แถว 3" />
              </div>
            </div>

            {formErrors.form && (
              <div role="alert" style={{ marginTop: '1rem', background: 'rgba(239,68,68,0.1)', border: '1px solid var(--status-danger)', borderRadius: 6, padding: '0.6rem 0.75rem', color: 'var(--status-danger)', fontSize: 13 }}>
                {formErrors.form}
              </div>
            )}

            {/* Footer */}
            <div className="responsive-action-group" style={{ justifyContent: 'flex-end', marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)' }}>
              <button className="btn btn-outline" onClick={() => setShowModal(false)}>ยกเลิก</button>
              <FormSubmitButton loading={saving} onClick={handleSave} type="button">
                {editing ? 'บันทึกการแก้ไข' : 'เพิ่มอะไหล่'}
              </FormSubmitButton>
            </div>

      </Modal>

      <Modal open={importOpen} onClose={() => !importLoading && setImportOpen(false)} title={<><FileSpreadsheet size={18} style={{ color: 'var(--accent-primary)' }} /> นำเข้าอะไหล่จาก Excel</>} width={620} preventClose={importLoading} describedById="spare-part-import-description">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <p id="spare-part-import-description" style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            รองรับเฉพาะคอลัมน์ Date, SKU หรือ P/N, Product Name หรือ Name, Description หรือ Features/Operating Conditions, Product Model และถ้ามีคอลัมน์ SN ระบบจะเก็บ SN กับวันที่นำของเข้าให้ด้วย
          </p>
          <div>
            <label className="form-label" htmlFor="import-warehouse">คลังปลายทาง</label>
            <select
              id="import-warehouse"
              className="form-control"
              value={importWarehouseId}
              onChange={(e) => {
                const nextValue = e.target.value;
                setImportWarehouseId(nextValue);
                if (nextValue) window.localStorage.setItem('spare-parts.importWarehouseId', nextValue);
                else window.localStorage.removeItem('spare-parts.importWarehouseId');
              }}
              disabled={importLoading}
            >
              <option value="">— เลือกคลัง —</option>
              {[...warehouses].sort((a, b) => a.name.localeCompare(b.name)).map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
              ))}
            </select>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 4 }}>
              ระบบจะไม่เลือกค่าเริ่มต้นให้เอง และจะจำคลังที่คุณเลือกครั้งล่าสุดไว้
            </div>
          </div>
          <div
            onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
            onDrop={e => {
              e.preventDefault();
              e.stopPropagation();
              const file = e.dataTransfer.files[0];
              if (file) void handleImportFile(file);
            }}
            onClick={() => !importLoading && importFileRef.current?.click()}
            style={{ border: '2px dashed var(--border-color)', borderRadius: 12, padding: '1.5rem', textAlign: 'center', cursor: importLoading ? 'default' : 'pointer', background: 'var(--bg-secondary)' }}
          >
            <FileSpreadsheet size={34} style={{ color: 'var(--accent-primary)', marginBottom: 8 }} />
            <div style={{ fontWeight: 600, marginBottom: 4 }}>เลือกไฟล์ Excel สำหรับนำเข้า</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>ลากไฟล์มาวาง หรือคลิกเพื่อเลือกไฟล์ `.xlsx` / `.xls`</div>
            <input aria-label="เลือกไฟล์ Excel รายการอะไหล่"
              ref={importFileRef}
              type="file"
              accept=".xlsx,.xls"
              style={{ display: 'none' }}
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) void handleImportFile(file);
              }}
            />
          </div>

          {importLoading && (
            <div style={{ padding: '0.85rem 1rem', borderRadius: 10, background: 'var(--bg-secondary)', fontSize: '0.85rem' }}>
              กำลังนำเข้าข้อมูลอะไหล่...
            </div>
          )}

          {importResult && (
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '0.5rem' }}>
                <div className="card" style={{ padding: '0.75rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{importResult.total}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>ทั้งหมด</div>
                </div>
                <div className="card" style={{ padding: '0.75rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--status-success)' }}>{importResult.created}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>เพิ่มใหม่</div>
                </div>
                <div className="card" style={{ padding: '0.75rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--accent-primary)' }}>{importResult.updated}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>อัปเดต</div>
                </div>
                <div className="card" style={{ padding: '0.75rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--status-warning)' }}>{importResult.skipped}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>ข้าม</div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.5rem' }}>
                <div className="card" style={{ padding: '0.75rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--status-success)' }}>{importResult.itemCreated ?? 0}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>SN เพิ่มใหม่</div>
                </div>
                <div className="card" style={{ padding: '0.75rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--accent-primary)' }}>{importResult.itemUpdated ?? 0}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>SN อัปเดตวันที่</div>
                </div>
              </div>
              {importResult.errors.length > 0 && (
                <div style={{ border: '1px solid var(--border-color)', borderRadius: 10, padding: '0.9rem', background: 'var(--bg-secondary)' }}>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>รายการที่ข้าม / ผิดพลาด</div>
                  <div style={{ maxHeight: 180, overflow: 'auto', fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'grid', gap: 4 }}>
                    {importResult.errors.slice(0, 20).map((error, idx) => <div key={`${idx}-${error}`}>{error}</div>)}
                  </div>
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', paddingTop: '0.5rem' }}>
            <button className="btn btn-outline" onClick={() => setImportOpen(false)} disabled={importLoading}>ปิด</button>
          </div>
        </div>
      </Modal>

      {(() => {
        const detailPart = detailPartId ? displayParts.find(p => p.id === detailPartId) ?? null : null;
        const rows: [string, React.ReactNode][] = detailPart ? [
          ['SKU', <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>{detailPart.sku}<CopyButton text={detailPart.sku} label="SKU" /></span>],
          ['หมวดหมู่', detailPart.displayCategory || '—'],
          ['รุ่นที่ใช้', detailPart.displayProductModel || '—'],
          ['คงเหลือ', `${detailPart.stock} ชิ้น${detailPart.minStock > 0 ? ` (ขั้นต่ำ ${detailPart.minStock})` : ''}`],
          ['ราคา/หน่วย', `฿${Number(detailPart.unitPrice || 0).toLocaleString()}`],
          ['ผู้จัดจำหน่าย', detailPart.displaySupplier || '—'],
        ] : [];
        // Stock per warehouse: tracked parts are counted from their serial numbers, plain parts sit in their one warehouse.
        const stockByWarehouse: { name: string; count: number }[] = (() => {
          if (!detailPart || detailItems === null) return [];
          if (detailItems.length > 0) {
            const counts = new Map<string, number>();
            for (const item of detailItems) counts.set(item.warehouseId ?? '', (counts.get(item.warehouseId ?? '') ?? 0) + 1);
            return [...counts.entries()]
              .map(([id, count]) => ({ name: warehouses.find(w => w.id === id)?.name ?? 'ไม่ระบุคลัง', count }))
              .sort((a, b) => b.count - a.count);
          }
          return detailPart.stock > 0 ? [{ name: detailPart.warehouse?.name || detailPart.location || 'ไม่ระบุคลัง', count: detailPart.stock }] : [];
        })();
        return (
          <Modal open={!!detailPart} onClose={() => setDetailPartId(null)} title={<><Package size={18} style={{ color: 'var(--accent-primary)' }} /> รายละเอียดอะไหล่</>} width={640}>
            {detailPart && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>{detailPart.displayName}</div>
                  {detailPart.displayDescription && <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>{detailPart.displayDescription}</div>}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.6rem 1rem' }}>
                  {rows.map(([label, value]) => (
                    <div key={label}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</div>
                      <div style={{ fontSize: 14, fontWeight: 500 }}>{value}</div>
                    </div>
                  ))}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>สต๊อกแยกตามคลัง</div>
                  {detailItems === null ? (
                    <div className="text-muted" style={{ fontSize: 13 }}>กำลังโหลด...</div>
                  ) : stockByWarehouse.length === 0 ? (
                    <div className="text-muted" style={{ fontSize: 13 }}>ไม่มีสต๊อกในคลัง</div>
                  ) : (
                    <div style={{ border: '1px solid var(--border-color)', borderRadius: 8, overflow: 'hidden' }}>
                      {stockByWarehouse.map(row => (
                        <div key={row.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--border-color)', fontSize: 14 }}>
                          <span style={{ fontWeight: 500 }}>{row.name}</span>
                          <span style={{ fontWeight: 700 }}>{row.count} ชิ้น</span>
                        </div>
                      ))}
                      {stockByWarehouse.length > 1 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0.75rem', background: 'var(--bg-tertiary)', fontSize: 13 }}>
                          <span className="text-muted">รวม</span>
                          <span style={{ fontWeight: 700 }}>{stockByWarehouse.reduce((sum, row) => sum + row.count, 0)} ชิ้น</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>รูปอะไหล่</div>
                  <SinglePhoto elementType="SparePart" elementId={detailPart.id} onChange={loadPhotos} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                  <button className="btn btn-outline" onClick={() => setDetailPartId(null)}>ปิด</button>
                </div>
              </div>
            )}
          </Modal>
        );
      })()}

      <Modal open={!!itemModalPart} onClose={() => !itemSaving && setItemModalPart(null)} title={<><Package size={18} style={{ color: 'var(--accent-primary)' }} /> รายการ SN อะไหล่</>} width={720}>
        {itemModalPart && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ background: 'var(--bg-secondary)', borderRadius: 10, padding: '0.9rem 1rem' }}>
              <div style={{ fontWeight: 700 }}>{extractDisplayEnglish(itemModalPart.name, itemModalPart.sku)}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                SKU: {itemModalPart.sku} | คลัง: {itemModalPart.warehouse?.name || itemModalPart.location || '-'} | คงเหลือ {itemModalPart.stock} ชิ้น
              </div>
            </div>

            {isAdmin && (
              <div className="card" style={{ padding: '1rem', display: 'grid', gap: '0.75rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px auto', gap: '0.75rem', alignItems: 'end' }}>
                  <div>
                    <label htmlFor="spareparts-sn" className="form-label">SN</label>
                    <input id="spareparts-sn" className="form-control" value={itemForm.serialNumber} onChange={e => setItemForm(f => ({ ...f, serialNumber: e.target.value }))} placeholder="เช่น SN-0001" />
                  </div>
                  <div>
                    <label className="form-label" htmlFor="spareparts-date">วันที่นำของเข้า</label>
                    <ThaiDateInput id="spareparts-date" className="form-control" value={itemForm.receivedDate} onChange={e => setItemForm(f => ({ ...f, receivedDate: e.target.value }))} />
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <FormSubmitButton loading={itemSaving} onClick={handleSaveItem} type="button">
                      {editingItemId ? 'บันทึก' : 'เพิ่ม SN'}
                    </FormSubmitButton>
                    {editingItemId && <button className="btn btn-outline" onClick={resetItemEditor} disabled={itemSaving}>ยกเลิก</button>}
                  </div>
                </div>
                <div>
                  <label className="form-label" htmlFor="sp-item-notes">ข้อมูลเพิ่มเติม / หมายเหตุ</label>
                  <textarea
                    id="sp-item-notes"
                    className="form-control"
                    rows={2}
                    value={itemForm.notes}
                    onChange={e => setItemForm(f => ({ ...f, notes: e.target.value }))}
                    placeholder="เช่น อาการเสีย, ตำแหน่งติดตั้ง, ผู้รับผิดชอบ หรือรายละเอียดอื่น ๆ"
                  />
                </div>
              </div>
            )}

            <div className="card" style={{ padding: 0 }}>
              <div style={{ padding: '0.85rem 1rem', borderBottom: '1px solid var(--border-color)', fontWeight: 600 }}>
                รายการทั้งหมด {partItems.length} ชิ้น
              </div>
              {itemsLoading ? (
                <div style={{ padding: '1rem' }}>กำลังโหลดรายการ SN...</div>
              ) : partItems.length === 0 ? (
                <div style={{ padding: '1rem', color: 'var(--text-muted)' }}>ยังไม่มีรายการ SN สำหรับ SKU นี้</div>
              ) : (
                <div className="table-container">
                  <table>
                    <thead>
                      <tr>
                        <th>SN</th>
                        <th>วันที่นำของเข้า</th>
                        <th>ข้อมูลเพิ่มเติม</th>
                        {isAdmin && <th style={{ width: 120 }}>การดำเนินการ</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {partItems.map(item => (
                        <tr key={item.id}>
                          <td style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12, fontWeight: 600 }}>{item.serialNumber}</td>
                          <td>{item.receivedDate}</td>
                          <td style={{ maxWidth: 260, whiteSpace: 'pre-wrap', fontSize: 12 }}>
                            <div style={{ color: 'var(--accent-primary)', fontWeight: 600, marginBottom: item.notes ? 2 : 0 }}>
                              {warehouses.find(w => w.id === item.warehouseId)?.name || 'ไม่ระบุคลัง'}
                            </div>
                            {item.notes && <div style={{ color: 'var(--text-primary)' }}>{item.notes}</div>}
                          </td>
                          {isAdmin && (
                            <td>
                              <div style={{ display: 'flex', gap: '0.4rem' }}>
                                <button className="btn btn-outline" style={{ padding: '0.3rem 0.5rem' }} title="แก้ไขข้อมูลเพิ่มเติม" aria-label={`แก้ไขข้อมูล SN ${item.serialNumber}`} onClick={() => { setEditingItemId(item.id); setItemForm({ serialNumber: item.serialNumber, receivedDate: item.receivedDate, notes: item.notes || '' }); }}><Edit2 size={13} /></button>
                                <button className="btn" style={{ padding: '0.3rem 0.5rem', color: 'var(--status-danger)' }} onClick={() => handleDeleteItem(item)}><Trash2 size={13} /></button>
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-outline" onClick={() => setItemModalPart(null)} disabled={itemSaving}>ปิด</button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={scanInOpen} onClose={() => !scanSubmitting && setScanInOpen(false)} title={<><ScanLine size={18} style={{ color: 'var(--accent-primary)' }} /> รับอะไหล่เข้าด้วยการสแกน</>} width={520}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            สแกนที่ช่อง <strong>SKU</strong> ก่อน ระบบจะย้ายโฟกัสไปช่อง <strong>SN</strong> ให้ จากนั้นกดบันทึกเพื่อรับอะไหล่เข้าคลัง
          </p>
          <div className="card" style={{ padding: '1rem', display: 'grid', gap: '0.85rem' }}>
            <div>
              <label className="form-label" htmlFor="scan-in-sku">SKU</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '0.5rem' }}>
                <input
                  id="scan-in-sku"
                  ref={scanInSkuRef}
                  className="form-control"
                  value={scanInForm.sku}
                  onChange={e => {
                    setScanInForm(f => ({ ...f, sku: e.target.value }));
                    setScanInPart(null);
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      resolveScanInPart();
                    }
                  }}
                  placeholder="สแกนหรือกรอก SKU"
                  autoComplete="off"
                />
                <CameraScanButton
                  disabled={scanSubmitting}
                  onScan={value => { setScanInForm(f => ({ ...f, sku: value })); resolveScanInPart(value); }}
                />
                <button className="btn btn-outline" type="button" onClick={() => resolveScanInPart()} disabled={!scanInForm.sku.trim() || scanSubmitting}>
                  ยืนยัน SKU
                </button>
              </div>
            </div>
            <div>
              <label className="form-label" htmlFor="scan-in-warehouse">คลัง</label>
              <select
                id="scan-in-warehouse"
                className="form-control"
                value={scanInForm.warehouseId}
                onChange={e => {
                  const nextValue = e.target.value;
                  setScanInForm(f => ({ ...f, warehouseId: nextValue }));
                  if (nextValue) window.localStorage.setItem('spare-parts.scanInWarehouseId', nextValue);
                  else window.localStorage.removeItem('spare-parts.scanInWarehouseId');
                }}
              >
                <option value="">เลือกคลัง</option>
                {[...warehouses].sort((a, b) => a.name.localeCompare(b.name)).map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label" htmlFor="scan-in-sn">SN</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.5rem' }}>
                <input
                  id="scan-in-sn"
                  ref={scanInSnRef}
                  className="form-control"
                  value={scanInForm.serialNumber}
                  onChange={e => setScanInForm(f => ({ ...f, serialNumber: e.target.value }))}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleScanInSubmit();
                    }
                  }}
                  placeholder="สแกนหรือกรอก SN"
                  autoComplete="off"
                />
                <CameraScanButton disabled={scanSubmitting} onScan={value => setScanInForm(f => ({ ...f, serialNumber: value }))} />
              </div>
            </div>
            <div>
              <label className="form-label" htmlFor="scan-in-date">วันที่นำของเข้า</label>
              <ThaiDateInput
                id="scan-in-date"
                className="form-control"
                value={scanInForm.receivedDate}
                onChange={e => setScanInForm(f => ({ ...f, receivedDate: e.target.value }))}
              />
            </div>
          </div>
          <div style={{ border: '1px solid var(--border-color)', borderRadius: 10, padding: '0.85rem 1rem', background: 'var(--bg-secondary)' }}>
            {scanInPart ? (
              <>
                <div style={{ fontWeight: 700 }}>{extractDisplayEnglish(scanInPart.name, scanInPart.sku)}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  SKU: {scanInPart.sku} | คงเหลือ {scanInPart.stock} ชิ้น | คลังปัจจุบัน: {scanInPart.warehouse?.name || scanInPart.location || '-'}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>ยังไม่ได้ยืนยัน SKU</div>
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
            <button className="btn btn-outline" onClick={() => setScanInOpen(false)} disabled={scanSubmitting}>ปิด</button>
            <FormSubmitButton loading={scanSubmitting} onClick={handleScanInSubmit} type="button">
              บันทึกรับเข้า
            </FormSubmitButton>
          </div>
        </div>
      </Modal>

      <Modal open={scanOutOpen} onClose={() => !scanSubmitting && setScanOutOpen(false)} title={<><LogOut size={18} style={{ color: 'var(--accent-primary)' }} /> นำอะไหล่ออกด้วยการสแกน</>} width={460}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            สแกนเฉพาะ <strong>SN</strong> ของอะไหล่ที่ต้องการนำออก แล้วเลือกว่าจะกรอกรายละเอียดหรือส่งให้ลูกค้า
          </p>
          <div className="card" style={{ padding: '1rem' }}>
            <label className="form-label" htmlFor="scan-out-sn">SN</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.5rem' }}>
              <input
                id="scan-out-sn"
                ref={scanOutSnRef}
                className="form-control"
                value={scanOutSerialNumber}
                onChange={e => setScanOutSerialNumber(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleScanOutSubmit();
                  }
                }}
                placeholder="สแกนหรือกรอก SN"
                autoComplete="off"
              />
              <CameraScanButton disabled={scanSubmitting} onScan={value => { setScanOutSerialNumber(value); setScanOutSearchResults([]); }} />
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.55rem' }}>
              <button className="btn btn-outline" type="button" onClick={handleScanOutSearch} disabled={scanOutSearching || scanSubmitting}>
                <Search size={14} /> {scanOutSearching ? 'กำลังค้นหา...' : 'สแกนหา SN'}
              </button>
              <span style={{ alignSelf: 'center', fontSize: 11, color: 'var(--text-muted)' }}>พิมพ์อย่างน้อย 5 ตัวอักษร</span>
            </div>
            {scanOutSearchResults.length > 0 && (
              <div style={{ marginTop: '0.65rem', border: '1px solid var(--border-color)', borderRadius: 6, maxHeight: 160, overflowY: 'auto' }}>
                {scanOutSearchResults.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => { setScanOutSerialNumber(item.serialNumber); setScanOutSearchResults([]); setTimeout(() => scanOutSnRef.current?.focus(), 0); }}
                    style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '0.55rem 0.7rem', border: 0, borderBottom: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer', textAlign: 'left' }}
                  >
                    <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12, fontWeight: 600 }}>{item.serialNumber}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>เลือก SN นี้</span>
                  </button>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: '1rem', marginTop: '0.9rem', flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', fontSize: '0.86rem', fontWeight: 600, color: 'var(--text-primary)', cursor: 'pointer' }}>
                <input type="radio" name="scan-out-destination" checked={scanOutUseDetails} onChange={() => setScanOutUseDetails(true)} />
                ใส่รายละเอียดการนำออก
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', fontSize: '0.86rem', fontWeight: 600, color: 'var(--text-primary)', cursor: 'pointer' }}>
                <input type="radio" name="scan-out-destination" checked={!scanOutUseDetails} onChange={() => setScanOutUseDetails(false)} />
                ส่งให้ลูกค้า
              </label>
            </div>
            {scanOutUseDetails && (
              <>
                <label className="form-label" htmlFor="scan-out-details" style={{ marginTop: '0.75rem' }}>
                  รายละเอียดการนำออก <span style={{ color: 'var(--status-danger)' }}>*</span>
                </label>
                <textarea
                  id="scan-out-details"
                  className="form-control"
                  value={scanOutDetails}
                  onChange={e => setScanOutDetails(e.target.value)}
                  placeholder="เช่น ใช้ซ่อมงานลูกค้า / เบิกภายใน / ส่งทดแทน"
                  rows={3}
                />
              </>
            )}
            {!scanOutUseDetails && (
              <div style={{ marginTop: '0.75rem' }}>
                <label className="form-label" htmlFor="scan-out-customer">
                  ลูกค้าปลายทาง <span style={{ color: 'var(--status-danger)' }}>*</span>
                </label>
                <select id="scan-out-customer" className="form-control" value={scanOutCustomerId} onChange={e => setScanOutCustomerId(e.target.value)}>
                  <option value="">— เลือกลูกค้า —</option>
                  {[...customers].sort((a, b) => a.name.localeCompare(b.name, 'th')).map(customer => (
                    <option key={customer.id} value={customer.id}>{customer.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
            <button className="btn btn-outline" onClick={() => setScanOutOpen(false)} disabled={scanSubmitting}>ปิด</button>
            <FormSubmitButton loading={scanSubmitting} onClick={handleScanOutSubmit} type="button">
              บันทึกนำออก
            </FormSubmitButton>
          </div>
        </div>
      </Modal>

      {/* ── Transfer Modal ──────────────────────────────────────────── */}
      <Modal open={!!transferPart} onClose={() => !transferring && setTransferPart(null)} title={<><Send size={18} style={{ color: 'var(--accent-primary)' }} /> โอนอะไหล่ให้ลูกค้า</>} width={480} describedById="spare-part-transfer-description">
        {transferPart && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <p id="spare-part-transfer-description" style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              เลือกลูกค้าปลายทาง เลือก SN (ถ้ามี) และใส่หมายเหตุสำหรับการโอนอะไหล่ออกจากคลัง
            </p>
            {/* Part summary */}
            <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '0.75rem 1rem', display: 'flex', gap: 12, alignItems: 'center' }}>
              <Package size={22} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
              <div>
                <div style={{ fontWeight: 600 }}>{extractDisplayEnglish(transferPart.name, transferPart.sku)}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  SKU: {transferPart.sku}&nbsp;&nbsp;|&nbsp;&nbsp;คงเหลือ:&nbsp;
                  <strong style={{ color: transferPart.stock === 0 ? 'var(--status-danger)' : 'var(--status-success)' }}>{transferPart.stock} ชิ้น</strong>
                </div>
              </div>
            </div>

            {/* Customer picker */}
            <div>
              <label className="form-label" htmlFor="spareparts-field2">ลูกค้า / ตัวแทน <span style={{ color: 'var(--status-danger)' }}>*</span></label>
              <select id="spareparts-field2" className="form-control" value={transferForm.customerId} onChange={e => setTransferForm(f => ({ ...f, customerId: e.target.value }))}>
                <option value="">— เลือกลูกค้า —</option>
                {[...customers].sort((a, b) => a.name.localeCompare(b.name, 'th')).map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            {/* Serial number picker / quantity for untracked stock */}
            {transferItemsLoading ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>กำลังโหลดรายการ SN...</div>
            ) : transferItems.length > 0 ? (
              <div>
                <span className="form-label" id="spareparts-sn-label">เลือก SN <span style={{ color: 'var(--status-danger)' }}>*</span></span>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.5rem', marginBottom: '0.4rem' }}>
                  <input
                    aria-label="สแกนหรือค้นหา SN"
                    className="form-control"
                    style={{ fontSize: 12, height: 32 }}
                    placeholder="สแกนหรือพิมพ์ SN แล้วกด Enter เพื่อเลือก"
                    value={transferSnSearch}
                    onChange={e => setTransferSnSearch(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleTransferSnScan(); } }}
                  />
                  <CameraScanButton onScan={value => handleTransferSnScan(value)} />
                </div>
                <div role="group" aria-labelledby="spareparts-sn-label" style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 6 }}>
                  {transferItems.filter(item => !transferSnSearch.trim() || item.serialNumber.toLowerCase().includes(transferSnSearch.trim().toLowerCase())).map(item => {
                    const checked = transferForm.serialNumbers.includes(item.serialNumber);
                    return (
                      <label key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.55rem 0.7rem', borderBottom: '1px solid var(--border-color)', cursor: 'pointer' }}>
                        <input type="checkbox" checked={checked} onChange={() => setTransferForm(f => ({
                          ...f,
                          serialNumbers: checked ? f.serialNumbers.filter(sn => sn !== item.serialNumber) : [...f.serialNumbers, item.serialNumber],
                        }))} />
                        <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{item.serialNumber}</span>
                        <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 11 }}>{item.receivedDate}</span>
                      </label>
                    );
                  })}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>เลือกแล้ว {transferForm.serialNumbers.length} ชิ้น</div>
              </div>
            ) : (
              <div>
                <label className="form-label" htmlFor="spareparts-number">จำนวน (ชิ้น) <span style={{ color: 'var(--status-danger)' }}>*</span></label>
                <input id="spareparts-number" className="form-control" type="number" min={1} max={transferPart.stock} value={transferForm.quantity} onChange={e => setTransferForm(f => ({ ...f, quantity: e.target.value }))} />
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>อะไหล่นี้ไม่มี SN — สูงสุด {transferPart.stock} ชิ้น</div>
              </div>
            )}

            {/* Note */}
            <div>
              <label className="form-label" htmlFor="spareparts-field5">หมายเหตุ</label>
              <input id="spareparts-field5"
                className="form-control" placeholder="วัตถุประสงค์ / เหตุผล (ไม่บังคับ)"
                value={transferForm.note}
                onChange={e => setTransferForm(f => ({ ...f, note: e.target.value }))}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-color)' }}>
              <button className="btn btn-outline" onClick={() => setTransferPart(null)} disabled={transferring}>ยกเลิก</button>
              <FormSubmitButton loading={transferring} onClick={handleTransfer} type="button">
                <Send size={14} /> โอนอะไหล่
              </FormSubmitButton>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default SpareParts;
