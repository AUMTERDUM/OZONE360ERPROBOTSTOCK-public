import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Activity, RefreshCw, Filter, Search, FileSpreadsheet } from 'lucide-react';
import api from '../api';
import { useToast } from '../context/ToastContext';
import { usePolling } from '../lib/usePolling';
import Pagination from '../components/Pagination';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { TableSkeleton, EmptyState, Modal, useUrlSearch, useTableSort, SortableTh } from '../components/UIUtils';
import PageHeader from '../components/PageHeader';
import { formatThaiDateTime, parseThaiDateValue } from '../utils/thaiDate';

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

const ACTION_BADGE: Record<string, string> = {
  created: 'success',
  updated: 'info',
  deleted: 'danger',
  status_changed: 'warning',
  synced: 'info',
  attachment_added: 'info',
  item_scanned_out: 'warning',
};

const ACTION_LABELS: Record<string, string> = {
  created: 'สร้างใหม่',
  updated: 'แก้ไข',
  deleted: 'ลบ',
  status_changed: 'เปลี่ยนสถานะ',
  synced: 'ซิงค์ข้อมูล',
  attachment_added: 'เพิ่มไฟล์แนบ',
  item_scanned_out: 'สแกนออก',
};

const ENTITY_TYPE_LABELS: Record<string, string> = {
  Robot: 'หุ่นยนต์',
  Customer: 'ลูกค้า',
  RobotModel: 'รุ่นหุ่นยนต์',
  MaintenanceTicket: 'ตั๋วซ่อมบำรุง',
  SparePart: 'อะไหล่',
  PurchaseOrder: 'ใบสั่งซื้อ',
  RobotLoan: 'การยืมหุ่นยนต์',
};

const parseJSON = (s?: string) => {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
};

const stringifyLogDetails = (log: LogEntry) => {
  const old = parseJSON(log.oldValues);
  const nw = parseJSON(log.newValues);
  if (log.action === 'item_scanned_out') {
    return [
      nw?.details ? `รายละเอียด: ${nw.details}` : null,
      old?.serialNumber ? `SN: ${old.serialNumber}` : null,
      old?.stock !== undefined && nw?.stock !== undefined ? `สต๊อก: ${old.stock} → ${nw.stock}` : null,
    ].filter(Boolean).join(' | ');
  }
  if (log.action === 'status_changed' && old?.status && nw?.status) {
    return `${old.status} → ${nw.status}`;
  }
  if (log.action === 'attachment_added' && nw?.filename) {
    return `ไฟล์แนบ: ${nw.filename}`;
  }
  if (log.action === 'created') {
    return 'สร้างรายการใหม่';
  }
  if (log.action === 'deleted') {
    return 'ลบรายการแล้ว';
  }
  if (log.action === 'updated' && old && nw) {
    const changedKeys = Object.keys(nw).filter(k => nw[k] !== old[k] && nw[k] !== undefined);
    if (changedKeys.length > 0) return `แก้ไข: ${changedKeys.join(', ')}`;
  }
  return '';
};

const ActivityLog: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [entityTypeFilter, setEntityTypeFilter] = useState('');
  const [search, setSearch] = useUrlSearch();
  const { showToast } = useToast();
  const [exporting, setExporting] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportDateFrom, setExportDateFrom] = useState('');
  const [exportDateTo, setExportDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  useEffect(() => {
    if (user && user.role !== 'ADMIN') navigate('/');
  }, [navigate, user]);

  const filtered = useMemo(() => {
    return logs.filter(l => {
      if (search) {
        const q = search.toLowerCase();
        if (!(l.entityName || '').toLowerCase().includes(q) && !l.entityType.toLowerCase().includes(q) && !(l.performedBy || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [logs, search]);

  const sort = useTableSort<typeof filtered[0]>({
    performedAt: l => l.performedAt,
    entityType: l => l.entityType,
    entity: l => l.entityName || l.entityId,
    action: l => l.action,
    performedBy: l => l.performedBy || '',
  });
  const paginated = sort.apply(filtered).slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => { setPage(1); }, [entityTypeFilter, search]);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = entityTypeFilter ? `?entityType=${entityTypeFilter}` : '';
      const res = await api.get(`/logs${params}`);
      setLogs(res.data);
    } catch { } finally { setLoading(false); }
  }, [entityTypeFilter]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);
  usePolling(fetchLogs, 300_000);

  const formatTime = (iso: string) => formatThaiDateTime(iso, { dateStyle: 'short', timeStyle: 'medium' });

  const renderChanges = (log: LogEntry) => {
    const detailText = stringifyLogDetails(log);
    return detailText ? <span className="text-muted" style={{ fontSize: '0.8rem' }}>{detailText}</span> : null;
  };

  const handleExportExcel = async () => {
    if (exporting) return;
    setExporting(true);
    try {
    const XLSX = await import('xlsx');
    const rows = filtered.filter((log) => {
      const performedAtMs = parseThaiDateValue(log.performedAt).getTime();
      const fromMs = exportDateFrom ? new Date(`${exportDateFrom}T00:00:00+07:00`).getTime() : null;
      const toMs = exportDateTo ? new Date(`${exportDateTo}T23:59:59.999+07:00`).getTime() : null;
      if (fromMs !== null && !Number.isNaN(fromMs) && performedAtMs < fromMs) return false;
      if (toMs !== null && !Number.isNaN(toMs) && performedAtMs > toMs) return false;
      return true;
    }).map((log) => ({
      วันที่เวลา: formatTime(log.performedAt),
      ประเภท: log.entityType,
      รายการ: log.entityName || `${log.entityId.slice(0, 8)}…`,
      การทำงาน: ACTION_LABELS[log.action] || log.action.replace(/_/g, ' '),
      ผู้ดำเนินการ: log.performedBy || '—',
      รายละเอียด: stringifyLogDetails(log),
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'บันทึกกิจกรรม');
    const normalizeFileStamp = (value: string) => value ? value.replace(/[:T]/g, '-').replace(/\s+/g, '-') : 'all';
    const suffix = [normalizeFileStamp(exportDateFrom), normalizeFileStamp(exportDateTo)].join('_to_');
    XLSX.writeFile(workbook, `activity-log_${suffix}.xlsx`);
    setExportOpen(false);
    } catch { showToast('ส่งออกไม่สำเร็จ', 'error'); } finally { setExporting(false); }
  };

  return (
    <div>
      <PageHeader
        title="บันทึกกิจกรรม"
        subtitle="ตรวจสอบประวัติการเปลี่ยนแปลงและกิจกรรมที่เกิดขึ้นในระบบ"
        meta={<span className="badge info">{filtered.length} รายการ</span>}
        actions={<div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            className="btn btn-outline"
            onClick={() => setExportOpen(true)}
            disabled={loading || filtered.length === 0}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <FileSpreadsheet size={14} />
            ส่งออก Excel
          </button>
          <button
            className="btn btn-outline"
            onClick={fetchLogs}
            disabled={loading}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
            รีเฟรช
          </button>
        </div>}
      />

      {/* Filter bar */}
      <div className="card" style={{ marginBottom: '1rem', padding: '0.75rem 1rem', display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={15} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input aria-label="ค้นหาชื่อ, ผู้ดำเนินการ..." className="form-control" style={{ paddingLeft: '2rem' }} placeholder="ค้นหาชื่อ, ผู้ดำเนินการ..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <Filter size={14} style={{ color: 'var(--text-muted)' }} />
          {([['','ทั้งหมด'],['Robot','หุ่นยนต์'],['Customer','ลูกค้า'],['RobotModel','รุ่น'],['MaintenanceTicket','ตั๋วซ่อม'],['SparePart','อะไหล่'],['PurchaseOrder','PO'],['RobotLoan','ยืม']] as [string,string][]).map(([v,l]) => (
            <button key={v} type="button" onClick={() => setEntityTypeFilter(v)} style={{ padding: '5px 12px', borderRadius: 999, fontSize: 12, fontWeight: entityTypeFilter===v?700:500, border: `1.5px solid ${entityTypeFilter===v?'var(--accent-primary)':'var(--border-color)'}`, background: entityTypeFilter===v?'var(--accent-subtle)':'transparent', color: entityTypeFilter===v?'var(--accent-primary)':'var(--text-secondary)', cursor: 'pointer', transition: 'all .15s' }}>{l}</button>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <SortableTh {...sort.th('performedAt')}>เวลา</SortableTh>
                <SortableTh {...sort.th('entityType')}>ประเภท</SortableTh>
                <SortableTh {...sort.th('entity')}>รายการ</SortableTh>
                <SortableTh {...sort.th('action')}>การดำเนินการ</SortableTh>
                <SortableTh {...sort.th('performedBy')}>โดย</SortableTh>
                <th>รายละเอียด</th>
              </tr>
            </thead>
            <tbody>
              {loading && <TableSkeleton cols={6} />}
              {!loading && logs.length === 0 && (
                <EmptyState mascot="quiet" icon={<Activity size={40} />} title="ไม่พบประวัติการทำงาน" description="ยังไม่มีบันทึกกิจกรรมในระบบ" colSpan={6} />
              )}
              {paginated.map(log => (
                <tr key={log.id}>
                  <td className="text-muted" style={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
                    {formatTime(log.performedAt)}
                  </td>
                  <td>
                    <span className="badge info" style={{ fontSize: '0.68rem' }}>{ENTITY_TYPE_LABELS[log.entityType] || log.entityType}</span>
                  </td>
                  <td style={{ fontWeight: 600, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {log.entityName || log.entityId.slice(0, 8) + '…'}
                  </td>
                  <td>
                    <span className={`badge ${ACTION_BADGE[log.action] || 'info'}`} style={{ fontSize: '0.68rem' }}>
                      {ACTION_LABELS[log.action] || log.action.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="text-muted" style={{ fontSize: '0.85rem' }}>{log.performedBy || '—'}</td>
                  <td>{renderChanges(log)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
      </div>

      <Modal open={exportOpen} onClose={() => setExportOpen(false)} title={<><FileSpreadsheet size={18} style={{ color: 'var(--accent-primary)' }} /> ส่งออกบันทึกกิจกรรม</>} width={520}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            เลือกช่วงวันที่และเวลาก่อนส่งออก Excel
          </p>
          <div>
            <label className="form-label" htmlFor="activitylog-exportDateFrom">วันที่เริ่มต้น</label>
            <input id="activitylog-exportDateFrom" type="date" className="form-control" value={exportDateFrom} onChange={e => setExportDateFrom(e.target.value)} />
          </div>
          <div>
            <label className="form-label" htmlFor="activitylog-exportDateTo">วันที่สิ้นสุด</label>
            <input id="activitylog-exportDateTo" type="date" className="form-control" value={exportDateTo} onChange={e => setExportDateTo(e.target.value)} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
            <button className="btn btn-outline" onClick={() => setExportOpen(false)}>ยกเลิก</button>
            <button className="btn btn-primary" disabled={exporting} onClick={handleExportExcel}>ตกลง</button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default ActivityLog;
