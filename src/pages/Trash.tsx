import React, { useState, useEffect, useMemo } from 'react';
import { Trash2, RotateCcw, AlertTriangle, Search, X, Package, User, Bot, Wrench, FileText, Boxes } from 'lucide-react';
import api from '../api';
import { useConfirm } from '../context/ConfirmContext';
import { useToast } from '../context/ToastContext';
import PageHeader from '../components/PageHeader';
import { formatThaiDateTime } from '../utils/thaiDate';
import { useUrlSearch, useTableSort, SortableTh } from '../components/UIUtils';

interface TrashItem {
  id: string;
  entityType: string;
  entityId: string;
  entityName: string | null;
  entityData: string;
  deletedBy: string | null;
  deletedAt: string;
}

const TYPE_LABEL: Record<string, string> = {
  Robot: 'หุ่นยนต์',
  Customer: 'ลูกค้า',
  RobotModel: 'รุ่นหุ่นยนต์',
  SparePart: 'อะไหล่',
  DeliveryNote: 'ใบส่งของ',
};

const TYPE_COLOR: Record<string, string> = {
  Robot: 'var(--status-info)',
  Customer: 'var(--status-success)',
  RobotModel: 'var(--status-secondary)',
  SparePart: 'var(--status-warning)',
  DeliveryNote: 'var(--accent-primary)',
};

const TYPE_BG: Record<string, string> = {
  Robot: 'var(--status-info-bg)',
  Customer: 'var(--status-success-bg)',
  RobotModel: 'var(--status-secondary-bg)',
  SparePart: 'var(--status-warning-bg)',
  DeliveryNote: 'var(--accent-subtle)',
};

function TypeIcon({ type }: { type: string }) {
  const s = { size: 14 };
  if (type === 'Robot') return <Bot {...s} />;
  if (type === 'Customer') return <User {...s} />;
  if (type === 'RobotModel') return <Package {...s} />;
  if (type === 'SparePart') return <Wrench {...s} />;
  if (type === 'DeliveryNote') return <FileText {...s} />;
  return <Boxes {...s} />;
}

function formatDate(iso: string) {
  return formatThaiDateTime(iso, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function PreviewData({ entityType, entityData }: { entityType: string; entityData: string }) {
  try {
    const d = JSON.parse(entityData);
    if (entityType === 'Robot') return (
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
        SN: <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-secondary)' }}>{d.serialNumber}</span>
        {d.status && <span style={{ marginLeft: '0.75rem' }}>สถานะ: {({ Pending: 'รอดำเนินการ', Completed: 'เสร็จสิ้น', Draft: 'ร่าง', Cancelled: 'ยกเลิก', Approved: 'อนุมัติแล้ว', Ordered: 'สั่งซื้อแล้ว' } as Record<string, string>)[d.status] || d.status}</span>}
      </div>
    );
    if (entityType === 'Customer') return (
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
        {d.contactPerson && <span>ผู้ติดต่อ: {d.contactPerson}</span>}
        {d.phone && <span style={{ marginLeft: '0.75rem' }}>โทร: {d.phone}</span>}
      </div>
    );
    if (entityType === 'SparePart') return (
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
        SKU: <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-secondary)' }}>{d.sku}</span>
        <span style={{ marginLeft: '0.75rem' }}>สต็อก: {d.stock ?? 0}</span>
        {d.category && <span style={{ marginLeft: '0.75rem' }}>หมวด: {d.category}</span>}
      </div>
    );
    if (entityType === 'DeliveryNote') return (
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
        วันที่: {d.deliveryDate}
        {d.items?.length > 0 && <span style={{ marginLeft: '0.75rem' }}>{d.items.length} รายการ</span>}
      </div>
    );
    if (entityType === 'RobotModel') return (
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
        ประเภท: {d.type}
        {d.batteryLife && <span style={{ marginLeft: '0.75rem' }}>แบต: {d.batteryLife}</span>}
      </div>
    );
  } catch { /* ignore */ }
  return null;
}

const Trash: React.FC = () => {
  const [items, setItems] = useState<TrashItem[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useUrlSearch();
  const [filterType, setFilterType] = useState('');
  const [restoring, setRestoring] = useState<string | null>(null);
  const confirm = useConfirm();
  const toast = useToast();

  const fetchTrash = async () => {
    setLoading(true);
    try { const res = await api.get('/trash'); setItems(res.data); setLoadError(false); }
    catch { setLoadError(true); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchTrash(); }, []);

  const filtered = useMemo(() => items.filter(it => {
    const q = search.toLowerCase();
    const matchSearch = !q || (it.entityName || '').toLowerCase().includes(q) || it.entityType.toLowerCase().includes(q);
    return matchSearch && (!filterType || it.entityType === filterType);
  }), [items, search, filterType]);

  const sort = useTableSort<typeof items[0]>({
    entityType: it => it.entityType,
    entityName: it => it.entityName || it.entityId,
    deletedBy: it => it.deletedBy || '',
    deletedAt: it => it.deletedAt,
  });
  const visible = sort.apply(filtered);

  const handleRestore = async (item: TrashItem) => {
    if (busy || restoring) return;
    const label = `"${item.entityName || item.entityId}" (${TYPE_LABEL[item.entityType] || item.entityType})`;
    if (!await confirm(`กู้คืน ${label} กลับสู่ระบบ?`, { title: 'ยืนยันการกู้คืน', confirmLabel: 'กู้คืน' })) return;
    setRestoring(item.id);
    try {
      await api.post(`/trash/${item.id}/restore`);
      toast.showToast(`กู้คืน ${label} สำเร็จ`, 'success');
      await fetchTrash();
    } catch (err: any) {
      toast.showToast(err.response?.data?.error || 'กู้คืนไม่สำเร็จ — อาจมีข้อมูลซำ้หรือ ID ขัดแย้ง', 'error');
    } finally { setRestoring(null); }
  };

  const handlePermDelete = async (item: TrashItem) => {
    if (busy || restoring) return;
    const label = `"${item.entityName || item.entityId}"`;
    if (!await confirm(`ลบ ${label} ถาวร? ไม่สามารถกู้คืนได้อีก`, { title: 'ลบถาวร', danger: true, confirmLabel: 'ลบถาวร', requireText: 'DELETE', description: 'การลบนี้ถาวรและไม่สามารถย้อนกลับได้' })) return;
    setBusy(true);
    try {
    await api.delete(`/trash/${item.id}`);
    toast.showToast('ลบถาวรแล้ว', 'success');
    await fetchTrash();
    } catch { toast.showToast('ลบไม่สำเร็จ', 'error'); } finally { setBusy(false); }
  };

  const handleEmptyTrash = async () => {
    if (busy || restoring) return;
    if (!await confirm(`ล้างถังขยะทั้งหมด ${items.length} รายการ? ไม่สามารถกู้คืนได้อีก`, { title: 'ล้างถังขยะ', danger: true, confirmLabel: 'ล้างทั้งหมด', requireText: 'EMPTY', description: 'รายการทั้งหมดจะถูกลบถาวรพร้อมกัน' })) return;
    setBusy(true);
    try {
    await api.delete('/trash');
    toast.showToast('ล้างถังขยะแล้ว', 'success');
    await fetchTrash();
    } catch { toast.showToast('ลบไม่สำเร็จ', 'error'); } finally { setBusy(false); }
  };

  // Summary counts by type
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const it of items) counts[it.entityType] = (counts[it.entityType] || 0) + 1;
    return counts;
  }, [items]);

  return (
    <div>
      <PageHeader
        title={<>ถังขยะ</>}
        subtitle="รายการที่ถูกลบและยังสามารถกู้คืนกลับเข้าสู่ระบบได้"
        meta={<div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(239,68,68,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Trash2 size={20} style={{ color: 'var(--status-danger)' }} />
        </div>}
        actions={items.length > 0 ? (
          <button className="btn btn-outline" style={{ color: 'var(--status-danger)', borderColor: 'var(--status-danger)', fontSize: 13 }} disabled={busy || !!restoring || loading || loadError} onClick={handleEmptyTrash}>
            <Trash2 size={14} /> ล้างถังขยะ ({items.length})
          </button>
        ) : undefined}
      />

      {loadError && <div role="alert" className="card" style={{ color: 'var(--status-danger)', marginBottom: '1rem' }}>โหลดไม่สำเร็จ <button className="btn btn-outline" disabled={loading} onClick={fetchTrash}>ลองใหม่</button></div>}
      {/* Type Summary chips */}
      {Object.keys(typeCounts).length > 0 && (
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
          <button
            onClick={() => setFilterType('')}
            style={{ padding: '0.3rem 0.75rem', borderRadius: 20, border: `1px solid ${filterType === '' ? 'var(--accent-primary)' : 'var(--border-color)'}`, background: filterType === '' ? 'rgba(249,115,22,0.08)' : 'transparent', cursor: 'pointer', fontSize: 12, color: filterType === '' ? 'var(--accent-primary)' : 'var(--text-secondary)', fontWeight: filterType === '' ? 600 : 400 }}
          >
            ทั้งหมด ({items.length})
          </button>
          {Object.entries(typeCounts).map(([type, cnt]) => (
            <button key={type}
              onClick={() => setFilterType(f => f === type ? '' : type)}
              style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.3rem 0.75rem', borderRadius: 20, border: `1px solid ${filterType === type ? TYPE_COLOR[type] || 'var(--border-color)' : 'var(--border-color)'}`, background: filterType === type ? (TYPE_BG[type] || 'transparent') : 'transparent', cursor: 'pointer', fontSize: 12, color: filterType === type ? (TYPE_COLOR[type] || 'var(--text-secondary)') : 'var(--text-secondary)', fontWeight: filterType === type ? 600 : 400 }}
            >
              <TypeIcon type={type} />
              {TYPE_LABEL[type] || type} ({cnt})
            </button>
          ))}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 320 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input aria-label="ค้นหาชื่อรายการ..." className="form-control" style={{ paddingLeft: '2rem' }} placeholder="ค้นหาชื่อรายการ..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {(search || filterType) && (
          <button className="btn btn-outline" style={{ fontSize: 13 }} onClick={() => { setSearch(''); setFilterType(''); }}>
            <X size={13} /> ล้าง
          </button>
        )}
        <span style={{ fontSize: 13, color: 'var(--text-muted)', marginLeft: 'auto' }}>{loadError && items.length === 0 ? '—' : filtered.length} รายการ</span>
      </div>

      {/* Content */}
      {loading ? (
        <div className="card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>กำลังโหลด...</div>
      ) : items.length === 0 ? (
        <div className="card" style={{ padding: '4rem', textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: '1rem' }}>🗑️</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>ถังขยะว่างเปล่า</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>ไม่มีรายการที่ถูกลบ</div>
        </div>
      ) : loadError && items.length === 0 ? null : filtered.length === 0 ? (
        <div className="card" style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>ไม่พบรายการที่ค้นหา</div>
      ) : (
        <div className="card">
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <SortableTh {...sort.th('entityType')}>ประเภท</SortableTh>
                  <SortableTh {...sort.th('entityName')}>ชื่อ / รายละเอียด</SortableTh>
                  <SortableTh {...sort.th('deletedBy')}>ลบโดย</SortableTh>
                  <SortableTh {...sort.th('deletedAt')}>วันที่ลบ</SortableTh>
                  <th style={{ textAlign: 'right' }}>การดำเนินการ</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(item => (
                  <tr key={item.id}>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.2rem 0.6rem', borderRadius: 20, fontSize: 12, fontWeight: 600, background: TYPE_BG[item.entityType] || 'var(--bg-tertiary)', color: TYPE_COLOR[item.entityType] || 'var(--text-secondary)' }}>
                        <TypeIcon type={item.entityType} />
                        {TYPE_LABEL[item.entityType] || item.entityType}
                      </span>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{item.entityName || item.entityId}</div>
                      <PreviewData entityType={item.entityType} entityData={item.entityData} />
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: 13 }}>{item.deletedBy || '-'}</td>
                    <td style={{ color: 'var(--text-muted)', fontSize: 13, whiteSpace: 'nowrap' }}>{formatDate(item.deletedAt)}</td>
                    <td>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.4rem' }}>
                        <button
                          className="btn btn-outline"
                          style={{ padding: '0.3rem 0.65rem', fontSize: 12, color: 'var(--status-success)', borderColor: 'var(--status-success)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                          disabled={busy || !!restoring}
                          onClick={() => handleRestore(item)}
                          title="กู้คืน"
                        >
                          <RotateCcw size={13} />
                          {restoring === item.id ? 'กำลังกู้คืน...' : 'กู้คืน'}
                        </button>
                        <button
                          className="btn btn-outline"
                          style={{ padding: '0.3rem 0.5rem', color: 'var(--status-danger)' }}
                          disabled={busy || !!restoring} onClick={() => handlePermDelete(item)}
                          title="ลบถาวร"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Info banner */}
      {items.length > 0 && (
        <div style={{ marginTop: '1.25rem', padding: '0.75rem 1rem', borderRadius: 8, background: 'rgba(249,115,22,0.06)', border: '1px solid rgba(249,115,22,0.15)', display: 'flex', alignItems: 'flex-start', gap: '0.6rem' }}>
          <AlertTriangle size={15} style={{ color: 'var(--accent-primary)', flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            รายการในถังขยะสามารถกู้คืนได้ด้วยปุ่ม <strong>กู้คืน</strong> — หลังจากกู้คืนข้อมูลจะกลับไปแสดงในหน้าเดิมทันที
            <br />
            การลบถาวรจะไม่สามารถกู้คืนได้อีก
          </div>
        </div>
      )}
    </div>
  );
};

export default Trash;
