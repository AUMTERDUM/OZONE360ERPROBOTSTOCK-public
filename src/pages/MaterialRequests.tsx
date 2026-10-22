import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../context/ConfirmContext';
import { Search, Plus, Trash2, ArrowRight, RefreshCw } from 'lucide-react';
import api from '../api';
import Pagination from '../components/Pagination';
import { TableSkeleton, EmptyState, Modal, FormSubmitButton, useUrlSearch, useTableSort, SortableTh, useOpenFromUrl } from '../components/UIUtils';
import PageHeader from '../components/PageHeader';
import CameraScanButton from '../components/CameraScanButton';
import { materialRequestStatusLabels, statusLabel } from '../utils/statusLabels';

interface MRItem {
  id: string;
  sparePartId: string;
  partName: string;
  sku: string;
  currentStock: number;
  minStock: number;
  requestedQty: number;
  remark?: string;
}

interface MaterialRequest {
  id: string;
  docNumber: string;
  status: string;
  requestDate: string;
  notes?: string;
  createdBy?: string;
  approvedBy?: string;
  approvedAt?: string;
  linkedPoId?: string;
  items: MRItem[];
}


const statusColors: Record<string, { bg: string; color: string; border: string }> = {
  Pending: { bg: 'var(--status-warning-bg)', color: '#b45309', border: 'var(--status-warning)' },
  Approved: { bg: 'var(--status-success-bg)', color: '#15803d', border: 'var(--status-success)' },
  Ordered: { bg: '#eff6ff', color: '#1d4ed8', border: 'var(--status-info)' },
  Cancelled: { bg: 'var(--surface-soft)', color: 'var(--status-neutral)', border: '#d1d5db' },
};

export default function MaterialRequests() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const isAdmin = user?.role === 'ADMIN';
  const [mrs, setMrs] = useState<MaterialRequest[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useUrlSearch();
  useOpenFromUrl(mrs, m => m.id, m => setSearch(m.docNumber));
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [generating, setGenerating] = useState(false);
  const [convertModalOpen, setConvertModalOpen] = useState(false);
  const [convertingMr, setConvertingMr] = useState<MaterialRequest | null>(null);
  const [supplier, setSupplier] = useState('');
  const [converting, setConverting] = useState(false);

  const fetchMRs = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/material-requests');
      setMrs(data); setLoadError(false);
    } catch { setLoadError(true); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchMRs(); }, []);

  const summary = useMemo(() => ({
    total: mrs.length,
    pending: mrs.filter(m => m.status === 'Pending').length,
    approved: mrs.filter(m => m.status === 'Approved').length,
    ordered: mrs.filter(m => m.status === 'Ordered').length,
    cancelled: mrs.filter(m => m.status === 'Cancelled').length,
  }), [mrs]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return mrs.filter(m => {
      const matchSearch = !q || m.docNumber.toLowerCase().includes(q) || m.items.some(i => i.partName.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q));
      const matchStatus = !statusFilter || m.status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [mrs, search, statusFilter]);

  const sort = useTableSort<typeof filtered[0]>({
    docNumber: r => r.docNumber,
    requestDate: r => r.requestDate,
    status: r => r.status,
    items: r => r.items.length,
    createdBy: r => r.createdBy || '',
    approvedBy: r => r.approvedBy || '',
  });
  const pageData = sort.apply(filtered).slice((page - 1) * pageSize, page * pageSize);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const { data } = await api.post('/material-requests/generate');
      if (data.created > 0) {
        showToast(`สร้าง MR อัตโนมัติ: ${data.partCount} รายการ`, 'success');
        await fetchMRs();
      } else {
        showToast('ไม่มีอะไหล่ที่ต่ำกว่า min stock', 'info');
      }
    } catch { showToast('เกิดข้อผิดพลาด', 'error'); }
    finally { setGenerating(false); }
  };

  const handleStatusChange = async (mr: MaterialRequest, status: string) => {
    if (statusBusy) return;
    if (['Cancelled', 'Rejected'].includes(status) && !await confirm('ยืนยันการยกเลิก / ปฏิเสธ ' + mr.docNumber + '?', { title: 'ยืนยันการเปลี่ยนสถานะ', danger: true, confirmLabel: 'ยืนยัน' })) return;
    setStatusBusy(true);
    try {
      await api.patch(`/material-requests/${mr.id}/status`, { status });
      showToast(`อัปเดตสถานะเป็น ${statusLabel(status, materialRequestStatusLabels)}`, 'success');
      await fetchMRs();
    } catch { showToast('อัปเดตสถานะไม่สำเร็จ', 'error'); }
  };

  const handleDelete = async (mr: MaterialRequest) => {
    const ok = await confirm(`ลบ ${mr.docNumber}?`, { title: 'ยืนยันการลบ', danger: true, confirmLabel: 'ลบ' });
    if (!ok) return;
    try {
      await api.delete(`/material-requests/${mr.id}`);
      showToast('ลบแล้ว', 'success');
      await fetchMRs();
    } catch { showToast('ลบไม่สำเร็จ', 'error'); }
  };

  const openConvert = (mr: MaterialRequest) => {
    setConvertingMr(mr);
    setSupplier('');
    setConvertModalOpen(true);
  };

  const handleConvert = async () => {
    if (!convertingMr || !supplier.trim()) return;
    setConverting(true);
    try {
      await api.post(`/material-requests/${convertingMr.id}/convert-to-po`, { supplier: supplier.trim() });
      showToast('สร้าง PO จาก MR สำเร็จ', 'success');
      setConvertModalOpen(false);
      await fetchMRs();
    } catch { showToast('สร้าง PO ไม่สำเร็จ', 'error'); }
    finally { setConverting(false); }
  };

  return (
    <div className="page-container">
      {loadError && <div role="alert" className="card" style={{ color: 'var(--status-danger)', marginBottom: '1rem' }}>โหลดไม่สำเร็จ <button className="btn btn-outline" disabled={loading} onClick={fetchMRs}>ลองใหม่</button></div>}
      <PageHeader
        title="ใบขอเบิกอะไหล่"
        subtitle="เบิกอะไหล่อัตโนมัติจากรายการที่ต่ำกว่า min stock"
        actions={isAdmin ? (
          <button className="btn btn-primary" onClick={handleGenerate} disabled={generating} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <RefreshCw size={14} className={generating ? 'spin' : ''} /> ตรวจสอบ & สร้าง MR
          </button>
        ) : undefined}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, marginBottom: '1rem' }}>
        {[
          { label: 'ทั้งหมด', value: summary.total, color: 'var(--accent-primary)' },
          { label: 'รอดำเนินการ', value: summary.pending, color: '#b45309' },
          { label: 'อนุมัติแล้ว', value: summary.approved, color: '#15803d' },
          { label: 'สั่งซื้อแล้ว', value: summary.ordered, color: '#1d4ed8' },
        ].map(card => (
          <div key={card.label} className="card" style={{ padding: '0.9rem 1rem' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{card.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: card.color }}>{loadError && mrs.length === 0 ? '—' : card.value}</div>
          </div>
        ))}
      </div>

      <div className="card" style={{ padding: '12px 16px', marginBottom: '1rem', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 240px', minWidth: 220 }}>
          <Search size={15} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input aria-label="ค้นหาเลขที่, SKU, หรือชื่ออะไหล่..." className="form-control" placeholder="ค้นหาเลขที่, SKU, หรือชื่ออะไหล่..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} style={{ paddingLeft: 32, paddingRight: 32 }} />
          {!search && <CameraScanButton variant="inline" onScan={v => { setSearch(v); setPage(1); }} />}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[
            { key: '', label: 'ทั้งหมด' },
            { key: 'Pending', label: 'รอดำเนินการ' },
            { key: 'Approved', label: 'อนุมัติแล้ว' },
            { key: 'Ordered', label: 'สั่งซื้อแล้ว' },
            { key: 'Cancelled', label: 'ยกเลิก' },
          ].map(({ key, label }) => {
            const active = statusFilter === key;
            const color = key ? (statusColors[key]?.color || 'var(--text-secondary)') : 'var(--accent-primary)';
            const bg = key ? (statusColors[key]?.bg || 'var(--bg-tertiary)') : 'var(--accent-subtle)';
            return (
              <button
                key={key || 'all'}
                type="button"
                onClick={() => { setStatusFilter(key); setPage(1); }}
                style={{
                  padding: '5px 12px',
                  borderRadius: 999,
                  fontSize: 12,
                  fontWeight: active ? 700 : 500,
                  border: `1.5px solid ${active ? color : 'var(--border-color)'}`,
                  background: active ? bg : 'transparent',
                  color: active ? color : 'var(--text-secondary)',
                  cursor: 'pointer',
                  transition: 'all .15s',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
        {(search || statusFilter) && (
          <button className="btn btn-outline" style={{ fontSize: 12 }} onClick={() => { setSearch(''); setStatusFilter(''); setPage(1); }}>
            ล้างตัวกรอง
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>{loadError && mrs.length === 0 ? '—' : filtered.length} รายการ</span>
      </div>

      {loading ? <TableSkeleton rows={5} cols={6} /> : loadError && mrs.length === 0 ? null : filtered.length === 0 ? <EmptyState title="ไม่มีใบขอเบิกอะไหล่" /> : (
        <>
          <div className="table-container table-responsive-cards">
            <table className="data-table">
              <thead>
                <tr>
                  <SortableTh {...sort.th('docNumber')}>เลขที่</SortableTh>
                  <SortableTh {...sort.th('requestDate')}>วันที่</SortableTh>
                  <SortableTh {...sort.th('status')}>สถานะ</SortableTh>
                  <SortableTh {...sort.th('items')}>รายการ</SortableTh>
                  <SortableTh {...sort.th('createdBy')}>ผู้สร้าง</SortableTh>
                  <SortableTh {...sort.th('approvedBy')}>อนุมัติโดย</SortableTh>
                  <th style={{ textAlign: 'center' }}>จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {pageData.map(mr => {
                  const sc = statusColors[mr.status] || statusColors.Pending;
                  return (
                    <tr key={mr.id}>
                      <td data-label="เลขที่" style={{ fontWeight: 600 }}>{mr.docNumber}</td>
                      <td data-label="วันที่">{mr.requestDate}</td>
                      <td data-label="สถานะ">
                        <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, background: sc.bg, color: sc.color, border: `1px solid ${sc.border}` }}>{statusLabel(mr.status, materialRequestStatusLabels)}</span>
                      </td>
                      <td data-label="รายการ">
                        <details>
                          <summary style={{ cursor: 'pointer', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                            {mr.items.length} รายการ{mr.items[0] ? ` • ${mr.items[0].partName}` : ''}
                          </summary>
                          <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
                            {mr.items.map(i => (
                              <div key={i.id} style={{ border: '1px solid var(--border-color)', borderRadius: 10, padding: '0.55rem 0.7rem', background: 'var(--bg-tertiary)' }}>
                                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>{i.partName}</div>
                                <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: 2 }}>SKU: {i.sku}</div>
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6, fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                                  <span>คงเหลือ {i.currentStock}</span>
                                  <span>ขอ {i.requestedQty}</span>
                                  {i.minStock > 0 && <span>Min {i.minStock}</span>}
                                </div>
                                {i.remark && <div style={{ marginTop: 6, fontSize: '0.74rem', color: 'var(--text-secondary)' }}>หมายเหตุ: {i.remark}</div>}
                              </div>
                            ))}
                          </div>
                        </details>
                      </td>
                      <td data-label="ผู้สร้าง" style={{ fontSize: '0.82rem' }}>{mr.createdBy || '-'}</td>
                      <td data-label="อนุมัติโดย" style={{ fontSize: '0.82rem' }}>{mr.approvedBy || '-'}</td>
                      <td data-label="จัดการ">
                        <div style={{ display: 'flex', gap: 4, justifyContent: 'center', flexWrap: 'wrap' }}>
                          {mr.status === 'Pending' && isAdmin && (
                            <button className="btn btn-outline" style={{ fontSize: 11, padding: '2px 8px' }} disabled={statusBusy} onClick={() => handleStatusChange(mr, 'Approved')}>อนุมัติ</button>
                          )}
                          {mr.status === 'Approved' && (
                            <button className="btn btn-primary" style={{ fontSize: 11, padding: '2px 8px', display: 'flex', alignItems: 'center', gap: 3 }} disabled={statusBusy} onClick={() => openConvert(mr)}>
                              <ArrowRight size={12} /> สร้าง PO
                            </button>
                          )}
                          {mr.status === 'Pending' && isAdmin && (
                            <button className="btn btn-outline" style={{ fontSize: 11, padding: '2px 8px', color: 'var(--status-danger)', borderColor: 'var(--status-danger)' }} disabled={statusBusy} onClick={() => handleStatusChange(mr, 'Cancelled')}>ยกเลิก</button>
                          )}
                          {isAdmin && mr.status !== 'Ordered' && (
                            <button className="btn btn-outline" style={{ fontSize: 11, padding: '2px 8px', color: 'var(--status-danger)' }} disabled={statusBusy} onClick={() => handleDelete(mr)} title="ลบ" aria-label={`ลบ ${mr.docNumber}`}><Trash2 size={12} /></button>
                          )}
                          {mr.linkedPoId && (
                            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>→ PO</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filtered.length > 0 && <Pagination page={page} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={size => { setPageSize(size); setPage(1); }} />}
        </>
      )}

      {/* Convert to PO modal */}
      {convertModalOpen && convertingMr && (
        <Modal open={convertModalOpen} title={`สร้าง PO จาก ${convertingMr.docNumber}`} onClose={() => setConvertModalOpen(false)} describedById="material-request-convert-description">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <p id="material-request-convert-description" style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              ระบุชื่อผู้จำหน่ายเพื่อสร้างใบสั่งซื้อ (PO) จากรายการอะไหล่ใน {convertingMr.docNumber}
            </p>
            <label>
              <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>ผู้จำหน่าย *</span>
              <input className="form-control" placeholder="ชื่อผู้จำหน่าย" value={supplier} onChange={e => setSupplier(e.target.value)} style={{ marginTop: 4 }} />
            </label>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              รายการ: {convertingMr.items.map(i => `${i.partName} x${i.requestedQty}`).join(', ')}
            </div>
            <FormSubmitButton onClick={handleConvert} loading={converting} disabled={!supplier.trim()}>
              สร้างใบสั่งซื้อ (PO)
            </FormSubmitButton>
          </div>
        </Modal>
      )}
    </div>
  );
}
