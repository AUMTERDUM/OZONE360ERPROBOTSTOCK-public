import React, { useState, useEffect, useMemo } from 'react';
import { MapPin, Plus, Edit2, Trash2, ChevronRight, X, Bot, Search, PackagePlus, PackageMinus, Package } from 'lucide-react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../context/ConfirmContext';
import { useToast } from '../context/ToastContext';
import { useData, type Robot, type RobotModel } from '../context/DataContext';
import { TableSkeleton, EmptyState, RefreshButton, Modal, FormSubmitButton, BodyPortal } from '../components/UIUtils';
import PageHeader from '../components/PageHeader';
import CameraScanButton from '../components/CameraScanButton';
import { extractDisplayEnglish, sanitizeCategoryDisplay } from '../utils/displayText';
import { robotStatusLabels } from '../utils/statusLabels';

interface SparePart {
  id: string;
  sku: string;
  name: string;
  description?: string;
  category?: string;
  warehouseId?: string;
  warehouseIds?: string[];
  warehouseStock?: Record<string, number>;
  location?: string;
  stock: number;
  minStock: number;
  unitPrice: number;
  supplier?: string;
}

interface Warehouse {
  id: string;
  name: string;
  notes?: string;
  parentId?: string;
  _count?: { robots: number };
}

interface WarehouseStats {
  robots: number;
  robotsByStatus: Record<string, number>;
  robotsByModel: { name: string; count: number }[];
  skus: number;
  pieces: number;
  value: number;
  lowStock: number;
  topParts: { name: string; sku: string; pieces: number }[];
}

interface FormData {
  name: string;
  notes: string;
  parentId: string;
}

const EMPTY_FORM: FormData = { name: '', notes: '', parentId: '' };

const Warehouses: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const confirm = useConfirm();
  const { showToast } = useToast();
  const { robots, models, updateRobot, fetchData } = useData();

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<FormData>(EMPTY_FORM);
  const [loadError, setLoadError] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [nameError, setNameError] = useState('');
  const [saving, setSaving] = useState(false);

  // Drawer state
  const [selectedWarehouse, setSelectedWarehouse] = useState<Warehouse | null>(null);
  const [robotSearch, setRobotSearch] = useState('');
  const [addSearch, setAddSearch] = useState('');
  const [movingId, setMovingId] = useState<string | null>(null);

  // Drawer tab: 'robots' | 'parts'
  const [drawerTab, setDrawerTab] = useState<'robots' | 'parts'>('robots');

  // Spare parts state
  const [parts, setParts] = useState<SparePart[]>([]);
  const [partsError, setPartsError] = useState(false);
  const [partsLoading, setPartsLoading] = useState(false);
  const [partSearch, setPartSearch] = useState('');
  const [addPartSearch, setAddPartSearch] = useState('');
  const [movingPartId, setMovingPartId] = useState<string | null>(null);
  const [transferModal, setTransferModal] = useState<{ type: 'robot' | 'part'; itemId: string; label: string; fromWarehouseId?: string; toWarehouseId?: string } | null>(null);
  const [transferTargetId, setTransferTargetId] = useState('');
  const [transferPartItems, setTransferPartItems] = useState<{ id: string; serialNumber: string; warehouseId?: string; receivedDate: string }[]>([]);
  const [transferPartSelectedSNs, setTransferPartSelectedSNs] = useState<string[]>([]);
  const [transferPartItemsLoading, setTransferPartItemsLoading] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [partDetailModal, setPartDetailModal] = useState<SparePart | null>(null);
  const [partDetailItems, setPartDetailItems] = useState<{ id: string; serialNumber: string; warehouseId?: string; receivedDate: string }[]>([]);
  const [partDetailLoading, setPartDetailLoading] = useState(false);

  const fetchWarehouses = async () => {
    setLoading(true);
    try {
      const res = await api.get('/warehouses');
      setWarehouses(res.data); setLoadError(false);
    } catch { setLoadError(true); } finally { setLoading(false); }
  };

  const fetchParts = async () => {
    setPartsLoading(true);
    try { const res = await api.get('/spare-parts', { params: { withWarehouseStock: 1 } }); setParts(res.data); setPartsError(false); }
    catch { setPartsError(true); } finally { setPartsLoading(false); }
  };

  useEffect(() => { fetchWarehouses(); fetchParts(); }, []);

  const openAdd = () => {
    setEditingId(null);
    setNameError('');
    setFormData(EMPTY_FORM);
    setShowModal(true);
  };

  const openEdit = (w: Warehouse) => {
    setNameError('');
    setEditingId(w.id);
    setFormData({ name: w.name, notes: w.notes || '', parentId: w.parentId || '' });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (saving) return;
    if (!formData.name.trim()) { setNameError('กรุณากรอกชื่อคลังสินค้า'); return; }
    setNameError('');
    setSaving(true);
    try {
      const payload = {
        name: formData.name.trim(),
        notes: formData.notes || undefined,
        parentId: formData.parentId || undefined,
      };
      if (editingId) {
        await api.put(`/warehouses/${editingId}`, payload);
      } else {
        await api.post('/warehouses', payload);
      }
      setShowModal(false);
      fetchWarehouses();
    } catch { showToast('บันทึกไม่สำเร็จ', 'error'); } finally { setSaving(false); }
  };

  const handleDelete = async (w: Warehouse) => {
    if (deleting) return;
    const count = w._count?.robots ?? 0;
    const msg = count > 0
      ? `ลบ "${w.name}"? หุ่นยนต์ ${count} เครื่องจะถูกถอดออกจากคลังนี้`
      : `ลบคลัง "${w.name}"?`;
    if (!await confirm(msg, { title: 'ยืนยันการลบ', danger: true, confirmLabel: 'ลบ' })) return;
    try {
      setDeleting(true);
      await api.delete(`/warehouses/${w.id}`);
      fetchWarehouses();
    } catch { showToast('ลบไม่สำเร็จ', 'error'); } finally { setDeleting(false); }
  };

  const parentOptions = warehouses.filter(w => w.id !== editingId);

  // Drawer: robots in selected warehouse
  const warehouseRobots = useMemo(() => {
    if (!selectedWarehouse) return [];
    return robots.filter(r => r.locationId === selectedWarehouse.id && !r.customerId);
  }, [selectedWarehouse, robots]);

  // Robots that can be added (not already in this warehouse)
  const addableRobots = useMemo(() => {
    if (!selectedWarehouse) return [];
    return robots.filter(r =>
      !r.customerId &&
      r.locationId !== selectedWarehouse.id &&
      (addSearch === '' ||
        r.serialNumber.toLowerCase().includes(addSearch.toLowerCase()) ||
        models.find(m => m.id === r.modelId)?.name.toLowerCase().includes(addSearch.toLowerCase()))
    );
  }, [selectedWarehouse, robots, models, addSearch]);

  const getModel = (modelId: string): RobotModel | undefined => models.find(m => m.id === modelId);

  // What each warehouse holds: robots (by model / status) and spare parts (SKUs, pieces, value, low stock).
  const warehouseStats = useMemo(() => {
    const result = new Map<string, WarehouseStats>();
    for (const w of warehouses) {
      const byStatus: Record<string, number> = {};
      const byModel = new Map<string, number>();
      let robotCount = 0;
      for (const robot of robots) {
        if (robot.locationId !== w.id || robot.customerId) continue;
        robotCount += 1;
        byStatus[robot.status] = (byStatus[robot.status] ?? 0) + 1;
        const modelName = models.find(m => m.id === robot.modelId)?.name ?? '—';
        byModel.set(modelName, (byModel.get(modelName) ?? 0) + 1);
      }
      let skus = 0, pieces = 0, value = 0, lowStock = 0;
      const held: { name: string; sku: string; pieces: number }[] = [];
      for (const part of parts) {
        const qty = part.warehouseStock?.[w.id] ?? (part.warehouseId === w.id ? part.stock : 0);
        if (qty <= 0) continue;
        skus += 1;
        pieces += qty;
        value += qty * (part.unitPrice || 0);
        if (part.minStock > 0 && part.stock <= part.minStock) lowStock += 1;
        held.push({ name: extractDisplayEnglish(part.name, part.sku), sku: part.sku, pieces: qty });
      }
      held.sort((a, b) => b.pieces - a.pieces);
      result.set(w.id, {
        robots: robotCount,
        robotsByStatus: byStatus,
        robotsByModel: [...byModel.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
        skus, pieces, value, lowStock,
        topParts: held.slice(0, 4),
      });
    }
    return result;
  }, [warehouses, robots, models, parts]);

  const totals = useMemo(() => {
    const sum = { robots: 0, skus: 0, pieces: 0, value: 0 };
    for (const stats of warehouseStats.values()) {
      sum.robots += stats.robots;
      sum.skus += stats.skus;
      sum.pieces += stats.pieces;
      sum.value += stats.value;
    }
    return sum;
  }, [warehouseStats]);

  const openWarehouse = (w: Warehouse) => {
    setSelectedWarehouse(w);
    setRobotSearch('');
    setAddSearch('');
    setPartSearch('');
    setAddPartSearch('');
    setDrawerTab('robots');
  };

  const handleMoveIn = async (robot: Robot) => {
    setMovingId(robot.id);
    try { await updateRobot(robot.id, { locationId: selectedWarehouse!.id }); }
    finally { setMovingId(null); }
  };

  const handleMoveOut = async (robot: Robot) => {
    setTransferModal({ type: 'robot', itemId: robot.id, label: robot.serialNumber });
    setTransferTargetId('');
  };

  // ── Spare parts in this warehouse ──
  const warehouseParts = useMemo(() => {
    if (!selectedWarehouse) return [];
    return parts.filter(p => p.warehouseId === selectedWarehouse.id || p.warehouseIds?.includes(selectedWarehouse.id));
  }, [selectedWarehouse, parts]);

  const getWarehousePartStock = (part: SparePart) => selectedWarehouse
    ? part.warehouseStock?.[selectedWarehouse.id] ?? (part.warehouseId === selectedWarehouse.id ? part.stock : 0)
    : part.stock;

  const addableParts = useMemo(() => {
    if (!selectedWarehouse) return [];
    return parts.filter(p =>
      p.warehouseId !== selectedWarehouse.id &&
      (addPartSearch === '' ||
        p.sku.toLowerCase().includes(addPartSearch.toLowerCase()) ||
        p.name.toLowerCase().includes(addPartSearch.toLowerCase()) ||
        extractDisplayEnglish(p.name, p.sku).toLowerCase().includes(addPartSearch.toLowerCase()))
    );
  }, [selectedWarehouse, parts, addPartSearch]);

  const handlePartMoveIn = async (part: SparePart) => {
    setTransferPartItems([]);
    setTransferPartSelectedSNs([]);
    // Parts split across both warehouses have warehouseId === null; fall back to
    // "the other warehouse" so the transfer still has a valid source (only two warehouses exist).
    const inferredFromWarehouseId = part.warehouseId ?? warehouses.find(w => w.id !== selectedWarehouse!.id)?.id;
    setTransferModal({ type: 'part', itemId: part.id, label: `${part.sku} · ${extractDisplayEnglish(part.name, part.sku)}`, fromWarehouseId: inferredFromWarehouseId, toWarehouseId: selectedWarehouse!.id });
    setTransferTargetId(selectedWarehouse!.id);
    setTransferPartItemsLoading(true);
    try {
      const res = await api.get(`/spare-parts/${part.id}/items`);
      setTransferPartItems(res.data.items || []);
    } catch { showToast('โหลดรายการ SN ไม่สำเร็จ', 'error'); }
    finally { setTransferPartItemsLoading(false); }
  };

  const handleShowPartDetail = async (part: SparePart) => {
    setPartDetailModal(part);
    setPartDetailItems([]);
    setPartDetailLoading(true);
    try {
      const res = await api.get(`/spare-parts/${part.id}/items`);
      setPartDetailItems(res.data.items || []);
    } catch { showToast('โหลดรายละเอียดอะไหล่ไม่สำเร็จ', 'error'); }
    finally { setPartDetailLoading(false); }
  };

  const handlePartMoveOut = async (part: SparePart) => {
    setTransferPartItems([]);
    setTransferPartSelectedSNs([]);
    setTransferModal({ type: 'part', itemId: part.id, label: `${part.sku} · ${extractDisplayEnglish(part.name, part.sku)}`, fromWarehouseId: selectedWarehouse?.id });
    setTransferTargetId('');
    setTransferPartItemsLoading(true);
    try {
      const res = await api.get(`/spare-parts/${part.id}/items`);
      setTransferPartItems(res.data.items || []);
    } catch { showToast('โหลดรายการ SN ไม่สำเร็จ', 'error'); }
    finally { setTransferPartItemsLoading(false); }
  };

  const handleWarehouseTransfer = async () => {
    if (!transferModal || !transferTargetId) return;
    if (transferModal.type === 'part' && transferPartItems.length > 0 && transferPartSelectedSNs.length === 0) {
      showToast('กรุณาเลือก SN ที่ต้องการโอน', 'error');
      return;
    }
    setTransferring(true);
    try {
      await api.post('/warehouses/transfer', {
        type: transferModal.type,
        itemId: transferModal.itemId,
        fromWarehouseId: transferModal.fromWarehouseId,
        toWarehouseId: transferTargetId,
        serialNumbers: transferModal.type === 'part' && transferPartItems.length > 0
          ? transferPartItems.filter(item => transferPartSelectedSNs.includes(item.serialNumber)).map(item => item.serialNumber)
          : undefined,
      });
      await Promise.all([fetchData(), fetchParts()]);
      setTransferModal(null);
      setTransferPartSelectedSNs([]);
    } catch (err: any) {
      showToast(err?.response?.data?.error || 'โอนย้ายไม่สำเร็จ', 'error');
    } finally { setTransferring(false); }
  };

  return (
    <div>
      <PageHeader
        title="คลังสินค้า / สถานที่จัดเก็บ"
        subtitle={`แสดง ${warehouses.length} คลังคงที่ของระบบ`}
        meta={<span className="badge info">{warehouses.length}</span>}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
        {([
          ['หุ่นยนต์ในคลัง', `${totals.robots.toLocaleString()} เครื่อง`],
          ['รายการอะไหล่', `${totals.skus.toLocaleString()} รายการ`],
          ['อะไหล่ทั้งหมด', `${totals.pieces.toLocaleString()} ชิ้น`],
          ['มูลค่าอะไหล่รวม', `฿${totals.value.toLocaleString()}`],
        ] as const).map(([label, value]) => (
          <div key={label} className="card" style={{ padding: '0.85rem 1rem' }}>
            <div className="text-muted" style={{ fontSize: 12 }}>{label}</div>
            <div style={{ fontSize: '1.3rem', fontWeight: 700, marginTop: 2 }}>{(loadError && warehouses.length === 0) || (partsError && parts.length === 0) ? '—' : value}</div>
          </div>
        ))}
      </div>

      {loadError && <div role="alert" className="card" style={{ color: 'var(--status-danger)', marginBottom: '1rem' }}>โหลดไม่สำเร็จ <button className="btn btn-outline" disabled={loading} onClick={fetchWarehouses}>ลองใหม่</button></div>}
      {partsError && <div role="alert" className="card" style={{ color: 'var(--status-danger)', marginBottom: '1rem' }}>โหลดข้อมูลอะไหล่ไม่สำเร็จ <button className="btn btn-outline" disabled={partsLoading} onClick={fetchParts}>ลองใหม่</button></div>}
      {loading && <div className="card text-muted">กำลังโหลด...</div>}
      {!loading && !loadError && warehouses.length === 0 && (
        <div className="card"><EmptyState icon={<MapPin size={40} />} title="ไม่พบคลังสินค้า" description="ยังไม่มีคลังหรือตำแหน่งจัดเก็บ" /></div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: '1rem' }}>
        {warehouses.map(w => {
          const stats = warehouseStats.get(w.id);
          if (!stats) return null;
          return (
            <div
              key={w.id}
              className="card"
              role="button"
              tabIndex={0}
              aria-label={`ดูรายละเอียดคลัง ${w.name}`}
              onClick={() => openWarehouse(w)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openWarehouse(w); } }}
              style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '0.9rem' }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                <div>
                  <div style={{ fontSize: '1.15rem', fontWeight: 700 }}>🏭 {w.name}</div>
                  <div className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>{w.notes || 'กดเพื่อดูรายการหุ่นยนต์และอะไหล่'}</div>
                </div>
                <ChevronRight size={18} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              </div>

              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                  <Bot size={14} /> หุ่นยนต์ <span className="badge info">{stats.robots} เครื่อง</span>
                </div>
                {stats.robots === 0 ? (
                  <div className="text-muted" style={{ fontSize: 12 }}>ยังไม่มีหุ่นยนต์ในคลังนี้</div>
                ) : (
                  <>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {stats.robotsByModel.slice(0, 6).map(m => (
                        <span key={m.name} className="badge" style={{ fontSize: 11 }}>{m.name} × {m.count}</span>
                      ))}
                      {stats.robotsByModel.length > 6 && <span className="badge" style={{ fontSize: 11 }}>+{stats.robotsByModel.length - 6} รุ่น</span>}
                    </div>
                    <div className="text-muted" style={{ fontSize: 12, marginTop: 6 }}>
                      {Object.entries(stats.robotsByStatus).map(([status, count]) => `${robotStatusLabels[status] ?? status} ${count}`).join(' · ')}
                    </div>
                  </>
                )}
              </div>

              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                  <Package size={14} /> อะไหล่
                  {stats.lowStock > 0 && <span className="badge warning">สต๊อกต่ำ {stats.lowStock} รายการ</span>}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
                  {([
                    ['รายการ', stats.skus.toLocaleString()],
                    ['จำนวน (ชิ้น)', stats.pieces.toLocaleString()],
                    ['มูลค่า (฿)', stats.value.toLocaleString()],
                  ] as const).map(([label, value]) => (
                    <div key={label} style={{ background: 'var(--bg-tertiary)', borderRadius: 8, padding: '0.5rem 0.6rem' }}>
                      <div className="text-muted" style={{ fontSize: 11 }}>{label}</div>
                      <div style={{ fontWeight: 700 }}>{value}</div>
                    </div>
                  ))}
                </div>
                {stats.topParts.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div className="text-muted" style={{ fontSize: 11, marginBottom: 2 }}>สต๊อกมากที่สุด</div>
                    {stats.topParts.map(part => (
                      <div key={part.sku} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, padding: '2px 0' }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{part.name}</span>
                        <span style={{ fontWeight: 600, flexShrink: 0 }}>{part.pieces} ชิ้น</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editingId ? 'แก้ไขคลัง' : 'เพิ่มคลัง'} width={420} describedById="warehouse-form-description">
        <p id="warehouse-form-description" style={{ marginTop: 0, marginBottom: '0.85rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
          กำหนดชื่อคลัง คลังแม่ และหมายเหตุของตำแหน่งจัดเก็บเพื่อใช้จัดกลุ่มหุ่นยนต์และอะไหล่
        </p>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label" htmlFor="wh-name">ชื่อ *</label>
                <input
                  id="wh-name"
                  className="form-control"
                  value={formData.name}
                  onChange={e => setFormData(f => ({ ...f, name: e.target.value }))}
                  placeholder="เช่น คลังสินค้ากรุงเทพ"
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="wh-parent">คลังแม่</label>
                <select
                  id="wh-parent"
                  className="form-control"
                  value={formData.parentId}
                  onChange={e => setFormData(f => ({ ...f, parentId: e.target.value }))}
                >
                  <option value="">— ไม่มี (ระดับบนสุด) —</option>
                  {parentOptions.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="wh-notes">หมายเหตุ</label>
                <textarea
                  id="wh-notes"
                  className="form-control"
                  rows={3}
                  value={formData.notes}
                  onChange={e => setFormData(f => ({ ...f, notes: e.target.value }))}
                  placeholder="หมายเหตุเพิ่มเติม (ไม่บังคับ)"
                />
              </div>
            </div>
            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-color)' }}>
              <button className="btn btn-outline" onClick={() => setShowModal(false)}>ยกเลิก</button>
              {nameError && <div role="alert" style={{ color: 'var(--status-danger)' }}>{nameError}</div>}
              <FormSubmitButton loading={saving} onClick={handleSave} type="button">
                {editingId ? 'บันทึกการแก้ไข' : 'สร้าง'}
              </FormSubmitButton>
            </div>
      </Modal>

      {/* ── Warehouse Detail Drawer ── */}
      {selectedWarehouse && (
        <BodyPortal>
        <>
          {/* Overlay */}
          <div
            onClick={() => setSelectedWarehouse(null)}
            role="presentation"
            style={{ position: 'fixed', inset: 0, background: 'rgba(15,30,80,0.35)', zIndex: 900 }}
          />
          {/* Modal */}
          <div className="warehouse-drawer" role="dialog" aria-modal="true" aria-label={`รายละเอียดคลัง ${selectedWarehouse.name}`} style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 901,
            width: '560px', maxWidth: '96vw', maxHeight: '85vh',
            backgroundColor: 'var(--bg-secondary)',
            display: 'flex', flexDirection: 'column',
            boxShadow: '0 20px 60px rgba(30,58,138,0.2)',
            borderRadius: 12,
            border: '1px solid var(--border-color)',
          }}>
            {/* Header */}
            <div style={{ padding: '1.25rem 1.25rem 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 2 }}>
                    คลังสินค้า
                    {selectedWarehouse.parentId && (
                      <> › {warehouses.find(w => w.id === selectedWarehouse.parentId)?.name}</>
                    )}
                  </div>
                  <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>
                    {selectedWarehouse.name}
                  </div>
                  {selectedWarehouse.notes && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{selectedWarehouse.notes}</div>
                  )}
                </div>
                <button className="btn btn-outline" onClick={() => setSelectedWarehouse(null)} style={{ padding: '0.3rem 0.5rem' }} aria-label="ปิดรายละเอียดคลัง" title="ปิดรายละเอียดคลัง">
                  <X size={16} />
                </button>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', padding: '0.6rem 0.75rem', background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 8, marginBottom: '0.75rem' }}>
                <Bot size={16} style={{ color: 'var(--accent-primary)', marginTop: 1, flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  หุ่นยนต์ <strong style={{ color: 'var(--accent-primary)' }}>{warehouseRobots.length}</strong> เครื่อง
                  &nbsp;·&nbsp;
                  <Package size={12} style={{ verticalAlign: 'middle', marginRight: 2, color: 'var(--text-muted)' }} />
                  อะไหล่ <strong style={{ color: 'var(--accent-primary)' }}>{warehouseParts.length}</strong> รายการ
                </span>
              </div>

              {/* Tabs */}
              <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '0.75rem', background: 'var(--bg-primary)', borderRadius: 8, padding: '0.25rem' }}>
                <button
                  onClick={() => setDrawerTab('robots')}
                  style={{
                    flex: 1, padding: '0.4rem', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none',
                    background: drawerTab === 'robots' ? 'var(--accent-primary)' : 'transparent',
                    color: drawerTab === 'robots' ? 'var(--text-on-accent)' : 'var(--text-muted)',
                  }}
                >
                  <Bot size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />หุ่นยนต์ ({warehouseRobots.length})
                </button>
                <button
                  onClick={() => setDrawerTab('parts')}
                  style={{
                    flex: 1, padding: '0.4rem', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none',
                    background: drawerTab === 'parts' ? 'var(--accent-primary)' : 'transparent',
                    color: drawerTab === 'parts' ? 'var(--text-on-accent)' : 'var(--text-muted)',
                  }}
                >
                  <Package size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />อะไหล่ ({warehouseParts.length})
                </button>
              </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '0 1.25rem 1.25rem' }}>

              {/* ── Tab: Robots ── */}
              {drawerTab === 'robots' && (<>
              {/* ── Robots in this warehouse ── */}
              <div style={{ marginBottom: '1.25rem' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
                  หุ่นยนต์ในคลังนี้
                </div>
                {warehouseRobots.length === 0 ? (
                  <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: '1.5rem 0' }}>
                    ยังไม่มีหุ่นยนต์ในคลังนี้
                  </div>
                ) : (
                  <>
                    <div style={{ position: 'relative', marginBottom: '0.5rem' }}>
                      <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                      <input aria-label="ค้นหา Serial Number..."
                        className="form-control"
                        style={{ paddingLeft: '1.75rem', paddingRight: '2rem', fontSize: 12, height: 32 }}
                        placeholder="ค้นหา Serial Number..."
                        value={robotSearch}
                        onChange={e => setRobotSearch(e.target.value)}
                      />
                      {!robotSearch && <CameraScanButton variant="inline" onScan={setRobotSearch} />}
                    </div>
                    {warehouseRobots
                      .filter(r => !robotSearch || r.serialNumber.toLowerCase().includes(robotSearch.toLowerCase()))
                      .map(r => {
                        const m = getModel(r.modelId);
                        return (
                          <div key={r.id} style={{
                            display: 'flex', alignItems: 'center', gap: '0.75rem',
                            padding: '0.6rem 0.75rem', marginBottom: '0.35rem',
                            background: 'var(--bg-primary)', borderRadius: 8,
                            border: '1px solid var(--border-color)',
                          }}>
                            {m?.imageUrl
                              ? <img src={m.imageUrl} alt={m.name} style={{ width: 40, height: 40, objectFit: 'contain', borderRadius: 6, flexShrink: 0 }} />
                              : <div style={{ width: 40, height: 40, borderRadius: 6, background: 'rgba(99,102,241,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                  <Bot size={18} style={{ color: 'var(--accent-primary)' }} />
                                </div>
                            }
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontVariantNumeric: 'tabular-nums', fontSize: 13, fontWeight: 600 }}>{r.serialNumber}</div>
                              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{m?.name || 'ไม่ทราบรุ่น'}</div>
                            </div>
                            <span className={`badge ${r.status === 'In Stock' ? 'info' : r.status === 'Assigned' ? 'success' : 'warning'}`} style={{ fontSize: 10 }}>
                              {r.status === 'In Stock' ? 'ในคลัง' : r.status === 'Assigned' ? 'ติดตั้งแล้ว' : 'ซ่อมบำรุง'}
                            </span>
                            {isAdmin && (
                              <button
                                className="btn btn-outline"
                                style={{ padding: '0.25rem 0.5rem', flexShrink: 0, fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                                title="โอนออกไปคลังอื่น"
                                aria-label={`โอนหุ่นยนต์ ${r.serialNumber} ไปคลังอื่น`}
                                disabled={movingId === r.id}
                                onClick={() => handleMoveOut(r)}
                              >
                                <PackageMinus size={13} /> โอน
                              </button>
                            )}
                          </div>
                        );
                      })
                    }
                  </>
                )}
              </div>

              {/* ── Add robots from stock ── */}
              {isAdmin && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
                    โอนหุ่นยนต์จากคลังอื่นเข้าคลังนี้
                  </div>
                  <div style={{ position: 'relative', marginBottom: '0.5rem' }}>
                    <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input aria-label="ค้นหา SN หรือชื่อรุ่น..."
                      className="form-control"
                      style={{ paddingLeft: '1.75rem', paddingRight: '2rem', fontSize: 12, height: 32 }}
                      placeholder="ค้นหา SN หรือชื่อรุ่น..."
                      value={addSearch}
                      onChange={e => setAddSearch(e.target.value)}
                    />
                    {!addSearch && <CameraScanButton variant="inline" onScan={setAddSearch} />}
                  </div>
                  {addableRobots.length === 0 ? (
                    <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: '1rem 0' }}>
                      ไม่มีหุ่นยนต์ที่จะเพิ่มได้
                    </div>
                  ) : (
                    addableRobots.slice(0, 50).map(r => {
                      const m = getModel(r.modelId);
                      const srcWarehouse = r.locationId ? warehouses.find(w => w.id === r.locationId)?.name : null;
                      return (
                        <div key={r.id} style={{
                          display: 'flex', alignItems: 'center', gap: '0.75rem',
                          padding: '0.6rem 0.75rem', marginBottom: '0.35rem',
                          background: 'rgba(30,58,138,0.03)', borderRadius: 8,
                          border: '1px dashed var(--border-color)',
                        }}>
                          {m?.imageUrl
                            ? <img src={m.imageUrl} alt={m.name} style={{ width: 36, height: 36, objectFit: 'contain', borderRadius: 6, flexShrink: 0, opacity: 0.7 }} />
                            : <div style={{ width: 36, height: 36, borderRadius: 6, background: 'rgba(99,102,241,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                <Bot size={16} style={{ color: 'var(--text-muted)' }} />
                              </div>
                          }
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12, fontWeight: 600 }}>{r.serialNumber}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                              {m?.name || 'ไม่ทราบรุ่น'}
                              {srcWarehouse && <> · <span style={{ color: 'var(--status-warning)' }}>{srcWarehouse}</span></>}
                            </div>
                          </div>
                          <span className={`badge ${r.status === 'In Stock' ? 'info' : r.status === 'Assigned' ? 'success' : 'warning'}`} style={{ fontSize: 10, flexShrink: 0 }}>
                            {r.status === 'In Stock' ? 'ในคลัง' : r.status === 'Assigned' ? 'ติดตั้ง' : 'ซ่อม'}
                          </span>
                          <button
                            className="btn btn-primary"
                            style={{ padding: '0.25rem 0.5rem', flexShrink: 0, fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                            aria-label={`ย้ายหุ่นยนต์ ${r.serialNumber} เข้าคลัง`}
                            title={`โอนหุ่นยนต์ ${r.serialNumber} เข้าคลังนี้`}
                            disabled={movingId === r.id}
                            onClick={() => handleMoveIn(r)}
                          >
                            <PackagePlus size={13} /> โอนเข้า
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
              </>)}

              {/* ── Tab: Spare Parts ── */}
              {drawerTab === 'parts' && (<>
              {/* Parts in this warehouse */}
              <div style={{ marginBottom: '1.25rem' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
                  อะไหล่ในคลังนี้
                </div>
                {partsError && parts.length === 0 ? <div role="alert" style={{ color: 'var(--status-danger)' }}>โหลดข้อมูลอะไหล่ไม่สำเร็จ <button className="btn btn-outline" disabled={partsLoading} onClick={fetchParts}>ลองใหม่</button></div> : warehouseParts.length === 0 ? (
                  <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: '1.5rem 0' }}>
                    ยังไม่มีอะไหล่ในคลังนี้
                  </div>
                ) : (
                  <>
                    <div style={{ position: 'relative', marginBottom: '0.5rem' }}>
                      <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                      <input aria-label="ค้นหา SKU หรือชื่ออะไหล่..."
                        className="form-control"
                        style={{ paddingLeft: '1.75rem', paddingRight: '2rem', fontSize: 12, height: 32 }}
                        placeholder="ค้นหา SKU หรือชื่ออะไหล่..."
                        value={partSearch}
                        onChange={e => setPartSearch(e.target.value)}
                      />
                      {!partSearch && <CameraScanButton variant="inline" onScan={setPartSearch} />}
                    </div>
                    {warehouseParts
                      .filter(p => !partSearch || p.sku.toLowerCase().includes(partSearch.toLowerCase()) || extractDisplayEnglish(p.name, p.sku).toLowerCase().includes(partSearch.toLowerCase()))
                      .map(p => (
                        <div key={p.id} style={{
                          display: 'flex', alignItems: 'center', gap: '0.75rem',
                          padding: '0.6rem 0.75rem', marginBottom: '0.35rem',
                          background: 'var(--bg-primary)', borderRadius: 8,
                          border: '1px solid var(--border-color)',
                        }}>
                          <div style={{ width: 36, height: 36, borderRadius: 6, background: 'rgba(16,185,129,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <Package size={16} style={{ color: 'var(--status-success)' }} />
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{extractDisplayEnglish(p.name, p.sku)}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                              {p.sku}
                              {p.category && <> · {sanitizeCategoryDisplay(p.category)}</>}
                            </div>
                          </div>
                          <button
                            type="button"
                            className={`badge ${getWarehousePartStock(p) === 0 ? 'danger' : getWarehousePartStock(p) <= p.minStock ? 'warning' : 'success'}`}
                            style={{ fontSize: 10, flexShrink: 0, border: 'none', cursor: 'pointer' }}
                            title="ดูรายละเอียดจำนวนอะไหล่"
                            aria-label={`ดูรายละเอียดจำนวนอะไหล่ ${p.name}`}
                            onClick={() => handleShowPartDetail(p)}
                          >
                            {getWarehousePartStock(p)} ชิ้น
                          </button>
                          {isAdmin && (
                            <button
                              className="btn btn-outline"
                              style={{ padding: '0.25rem 0.5rem', flexShrink: 0, fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                              title="โอนออกไปคลังอื่น"
                              aria-label={`โอนอะไหล่ ${p.name} ไปคลังอื่น`}
                              disabled={movingPartId === p.id}
                              onClick={() => handlePartMoveOut(p)}
                            >
                              <PackageMinus size={13} /> โอน
                            </button>
                          )}
                        </div>
                      ))
                    }
                  </>
                )}
              </div>

              {/* Add spare parts */}
              {isAdmin && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
                    โอนอะไหล่จากคลังอื่นเข้าคลังนี้
                  </div>
                  <div style={{ position: 'relative', marginBottom: '0.5rem' }}>
                    <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input aria-label="ค้นหา SKU หรือชื่ออะไหล่..."
                      className="form-control"
                      style={{ paddingLeft: '1.75rem', paddingRight: '2rem', fontSize: 12, height: 32 }}
                      placeholder="ค้นหา SKU หรือชื่ออะไหล่..."
                      value={addPartSearch}
                      onChange={e => setAddPartSearch(e.target.value)}
                    />
                    {!addPartSearch && <CameraScanButton variant="inline" onScan={setAddPartSearch} />}
                  </div>
                  {addableParts.length === 0 ? (
                    <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: '1rem 0' }}>
                      ไม่มีอะไหล่ที่จะเพิ่มได้
                    </div>
                  ) : (
                    addableParts.slice(0, 50).map(p => (
                      <div key={p.id} style={{
                        display: 'flex', alignItems: 'center', gap: '0.75rem',
                        padding: '0.6rem 0.75rem', marginBottom: '0.35rem',
                        background: 'rgba(30,58,138,0.03)', borderRadius: 8,
                        border: '1px dashed var(--border-color)',
                      }}>
                        <div style={{ width: 36, height: 36, borderRadius: 6, background: 'rgba(16,185,129,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <Package size={15} style={{ color: 'var(--text-muted)' }} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{extractDisplayEnglish(p.name, p.sku)}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            {p.sku}
                            {p.location && <> · <span style={{ color: 'var(--status-warning)' }}>{p.location}</span></>}
                          </div>
                        </div>
                        <span className={`badge ${p.stock === 0 ? 'danger' : p.stock <= p.minStock ? 'warning' : 'success'}`} style={{ fontSize: 10, flexShrink: 0 }}>
                          {p.stock} ชิ้น
                        </span>
                        <button
                          className="btn btn-primary"
                          style={{ padding: '0.25rem 0.5rem', flexShrink: 0, fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                          aria-label={`ย้ายอะไหล่ ${p.name} เข้าคลัง`}
                          title={`ย้ายอะไหล่ ${p.name} เข้าคลัง`}
                          disabled={movingPartId === p.id}
                          onClick={() => handlePartMoveIn(p)}
                        >
                          <PackagePlus size={13} /> โอนเข้า
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}
              </>)}
            </div>
          </div>
        </>
        </BodyPortal>
      )}
      <Modal open={!!transferModal} onClose={() => !transferring && setTransferModal(null)} title={transferModal?.type === 'robot' ? 'โอนหุ่นยนต์ระหว่างคลัง' : 'โอนอะไหล่ระหว่างคลัง'} width={420}>
        {transferModal && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
            <div style={{ background: 'var(--bg-primary)', borderRadius: 8, padding: '0.75rem 1rem' }}>
              <div style={{ fontWeight: 600 }}>{transferModal.label}</div>
              <div className="text-muted" style={{ fontSize: 12, marginTop: 3 }}>ต้นทาง: {warehouses.find(w => w.id === transferModal.fromWarehouseId)?.name || selectedWarehouse?.name || '—'}</div>
            </div>
            {transferModal.type === 'part' && (
              transferPartItemsLoading ? <div className="text-muted" style={{ fontSize: 12 }}>กำลังโหลดรายการ SN...</div> : transferPartItems.length > 0 ? (
                <div>
                  <span className="form-label" id="warehouses-sn-label">เลือก SN ที่ต้องการโอน <span style={{ color: 'var(--status-danger)' }}>*</span></span>
                  <div role="group" aria-labelledby="warehouses-sn-label" style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 7 }}>
                    {transferPartItems.filter(item => !transferModal.fromWarehouseId || item.warehouseId === transferModal.fromWarehouseId).map(item => {
                      const checked = transferPartSelectedSNs.includes(item.serialNumber);
                      return <label key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.5rem 0.65rem', borderBottom: '1px solid var(--border-color)', cursor: 'pointer' }}>
                        <input type="checkbox" checked={checked} onChange={() => setTransferPartSelectedSNs(prev => checked ? prev.filter(sn => sn !== item.serialNumber) : [...prev, item.serialNumber])} />
                        <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{item.serialNumber}</span>
                        <span className="text-muted" style={{ marginLeft: 'auto', fontSize: 11 }}>{item.receivedDate}</span>
                      </label>;
                    })}
                  </div>
                  <div className="text-muted" style={{ fontSize: 11, marginTop: 3 }}>เลือกแล้ว {transferPartSelectedSNs.length} ชิ้น</div>
                </div>
              ) : null
            )}
            <div>
              <label className="form-label" htmlFor="warehouse-transfer-target">โอนไปยังคลัง <span style={{ color: 'var(--status-danger)' }}>*</span></label>
              {transferModal.toWarehouseId ? (
                <div className="form-control" style={{ background: 'var(--bg-primary)' }}>{warehouses.find(w => w.id === transferModal.toWarehouseId)?.name || '—'}</div>
              ) : (
                <select id="warehouse-transfer-target" className="form-control" value={transferTargetId} onChange={e => setTransferTargetId(e.target.value)}>
                  <option value="">— เลือกคลังปลายทาง —</option>
                  {warehouses.filter(w => w.id !== selectedWarehouse?.id).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem' }}>
              <button className="btn btn-outline" onClick={() => setTransferModal(null)} disabled={transferring}>ยกเลิก</button>
              <FormSubmitButton loading={transferring} disabled={!transferTargetId} onClick={handleWarehouseTransfer} type="button">
                โอนย้าย
              </FormSubmitButton>
            </div>
          </div>
        )}
      </Modal>
      <Modal open={!!partDetailModal} onClose={() => setPartDetailModal(null)} title="รายละเอียดจำนวนอะไหล่" width={460}>
        {partDetailModal && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
            <div style={{ background: 'var(--bg-primary)', borderRadius: 8, padding: '0.75rem 1rem' }}>
              <div style={{ fontWeight: 600 }}>{extractDisplayEnglish(partDetailModal.name, partDetailModal.sku)}</div>
              <div className="text-muted" style={{ fontSize: 12, marginTop: 3 }}>{partDetailModal.sku}</div>
              <div className="text-muted" style={{ fontSize: 12, marginTop: 3 }}>
                คลัง: {selectedWarehouse?.name || '—'} · จำนวน {getWarehousePartStock(partDetailModal)} ชิ้น
              </div>
            </div>
            {partDetailLoading ? (
              <div className="text-muted" style={{ fontSize: 12 }}>กำลังโหลดรายละเอียด...</div>
            ) : partDetailItems.length > 0 ? (
              <div>
                <span className="form-label">SN ในคลังนี้ ({partDetailItems.filter(item => item.warehouseId === selectedWarehouse?.id).length})</span>
                <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 7 }}>
                  {partDetailItems.filter(item => item.warehouseId === selectedWarehouse?.id).map(item => (
                    <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.5rem 0.65rem', borderBottom: '1px solid var(--border-color)' }}>
                      <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{item.serialNumber}</span>
                      <span className="text-muted" style={{ marginLeft: 'auto', fontSize: 11 }}>{item.receivedDate}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-muted" style={{ fontSize: 12 }}>อะไหล่นี้ไม่มีการติดตามด้วย SN รายชิ้น</div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem' }}>
              <button className="btn btn-outline" onClick={() => setPartDetailModal(null)}>ปิด</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default Warehouses;
