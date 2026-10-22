import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Package, RefreshCw, Search, ChevronDown, ChevronRight } from 'lucide-react';
import api from '../api';
import Pagination from '../components/Pagination';
import CameraScanButton from '../components/CameraScanButton';
import PageHeader from '../components/PageHeader';
import { TableSkeleton, EmptyState, useUrlSearch } from '../components/UIUtils';
import { formatThaiDateTime } from '../utils/thaiDate';

interface PartEntry {
  id: string;
  action: 'transferred' | 'item_scanned_out';
  performedAt: string;
  performedBy: string | null;
  partId: string;
  sku: string | null;
  partName: string;
  quantity: number;
  serialNumbers: string[];
  customerId: string | null;
  customerName: string | null;
  robotSerialNumber: string | null;
  note: string | null;
}

interface Holding {
  key: string;
  customerId: string;
  customerName: string;
  partId: string;
  sku: string | null;
  partName: string;
  quantity: number;
  serialNumbers: string[];
  robots: string[];
  lastAt: string;
}

interface Group {
  id: string;
  title: string;
  subtitle: string | null;
  total: number;
  items: Holding[];
}

type Tab = 'holdings' | 'takeouts';
type View = 'customer' | 'part';

const includesText = (values: (string | null | undefined)[], q: string) =>
  values.some(value => (value || '').toLowerCase().includes(q));

const pillStyle = (active: boolean): React.CSSProperties => ({
  padding: '6px 14px', borderRadius: 999, fontSize: 13, fontWeight: active ? 700 : 500, cursor: 'pointer',
  border: `1.5px solid ${active ? 'var(--accent-primary)' : 'var(--border-color)'}`,
  background: active ? 'var(--accent-subtle)' : 'transparent',
  color: active ? 'var(--accent-primary)' : 'var(--text-secondary)', transition: 'all .15s',
});

const SerialList: React.FC<{ values: string[] }> = ({ values }) => (
  values.length === 0
    ? <span className="text-muted">—</span>
    : <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12, wordBreak: 'break-all' }}>{values.join(', ')}</span>
);

const CustomerParts: React.FC = () => {
  const [entries, setEntries] = useState<PartEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [tab, setTab] = useState<Tab>('holdings');
  const [view, setView] = useState<View>('customer');
  const [search, setSearch] = useUrlSearch();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await api.get<PartEntry[]>('/customer-parts');
      setEntries(res.data);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchEntries(); }, [fetchEntries]);
  useEffect(() => { setPage(1); }, [search, tab]);

  const query = search.trim().toLowerCase();

  const holdings = useMemo(() => {
    const map = new Map<string, Holding>();
    // Entries arrive newest first, so the first one seen for a key carries its latest date.
    for (const entry of entries) {
      if (!entry.customerId) continue;
      const key = `${entry.customerId}::${entry.partId}`;
      let holding = map.get(key);
      if (!holding) {
        holding = {
          key, customerId: entry.customerId, customerName: entry.customerName || 'ไม่ทราบชื่อลูกค้า',
          partId: entry.partId, sku: entry.sku, partName: entry.partName,
          quantity: 0, serialNumbers: [], robots: [], lastAt: entry.performedAt,
        };
        map.set(key, holding);
      }
      holding.quantity += entry.quantity;
      for (const sn of entry.serialNumbers) if (!holding.serialNumbers.includes(sn)) holding.serialNumbers.push(sn);
      if (entry.robotSerialNumber && !holding.robots.includes(entry.robotSerialNumber)) holding.robots.push(entry.robotSerialNumber);
    }
    return [...map.values()];
  }, [entries]);

  const filteredHoldings = useMemo(() => (
    query
      ? holdings.filter(h => includesText([h.customerName, h.sku, h.partName, ...h.serialNumbers, ...h.robots], query))
      : holdings
  ), [holdings, query]);

  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>();
    for (const holding of filteredHoldings) {
      const id = view === 'customer' ? holding.customerId : holding.partId;
      let group = map.get(id);
      if (!group) {
        group = view === 'customer'
          ? { id, title: holding.customerName, subtitle: null, total: 0, items: [] }
          : { id, title: holding.partName, subtitle: holding.sku, total: 0, items: [] };
        map.set(id, group);
      }
      group.total += holding.quantity;
      group.items.push(holding);
    }
    return [...map.values()].sort((a, b) => a.title.localeCompare(b.title, 'th'));
  }, [filteredHoldings, view]);

  const takeouts = useMemo(() => {
    const rows = entries.filter(entry => !entry.customerId);
    return query
      ? rows.filter(e => includesText([e.sku, e.partName, e.note, e.performedBy, ...e.serialNumbers], query))
      : rows;
  }, [entries, query]);

  const takeoutCount = useMemo(() => entries.filter(entry => !entry.customerId).length, [entries]);
  const customerCount = useMemo(() => new Set(holdings.map(h => h.customerId)).size, [holdings]);
  const totalPieces = useMemo(() => holdings.reduce((sum, h) => sum + h.quantity, 0), [holdings]);

  const toggleGroup = (id: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const formatTime = (iso: string) => formatThaiDateTime(iso, { dateStyle: 'short', timeStyle: 'short' });
  const pagedTakeouts = takeouts.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div>
      <PageHeader
        title="อะไหล่ที่ลูกค้า"
        subtitle="ยอดสะสมของอะไหล่ที่ส่งหรือโอนให้ลูกค้าแต่ละราย นับจากประวัติการส่ง (ยังไม่หักของที่ลูกค้าส่งคืน)"
        meta={<span className="badge info">{totalPieces} ชิ้น · {customerCount} ลูกค้า</span>}
        actions={
          <button className="btn btn-outline" onClick={() => void fetchEntries()} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
            รีเฟรช
          </button>
        }
      />

      <div className="card" style={{ marginBottom: '1rem', padding: '0.75rem 1rem', display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" style={pillStyle(tab === 'holdings')} onClick={() => setTab('holdings')}>ส่งให้ลูกค้าแล้ว (สะสม) ({holdings.length})</button>
          <button type="button" style={pillStyle(tab === 'takeouts')} onClick={() => setTab('takeouts')}>รายละเอียดการนำออก ({takeoutCount})</button>
        </div>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={15} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            aria-label="ค้นหาลูกค้า, SKU, ชื่ออะไหล่, SN..."
            className="form-control"
            style={{ paddingLeft: '2rem', paddingRight: '2rem' }}
            placeholder="ค้นหาลูกค้า, SKU, ชื่ออะไหล่, SN..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {!search && <CameraScanButton variant="inline" onScan={setSearch} />}
        </div>
      </div>

      {tab === 'holdings' && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: '0.75rem', flexWrap: 'wrap' }}>
            <button type="button" style={pillStyle(view === 'customer')} onClick={() => setView('customer')}>แยกตามลูกค้า</button>
            <button type="button" style={pillStyle(view === 'part')} onClick={() => setView('part')}>แยกตามอะไหล่</button>
          </div>

          {loading && <div className="card"><div className="table-container"><table><tbody><TableSkeleton cols={5} /></tbody></table></div></div>}
          {!loading && loadError && (
            <div className="card"><EmptyState mascot="loadError" icon={<Package size={40} />} title="โหลดข้อมูลไม่สำเร็จ" description="กรุณากดรีเฟรชเพื่อลองใหม่" /></div>
          )}
          {!loading && !loadError && groups.length === 0 && (
            <div className="card">
              <EmptyState
                mascot={query ? 'noResults' : 'emptyList'}
                icon={<Package size={40} />}
                title={query ? 'ไม่พบรายการที่ค้นหา' : 'ยังไม่เคยส่งอะไหล่ให้ลูกค้า'}
                description={query ? undefined : 'อะไหล่ที่โอนให้ลูกค้าจากหน้าอะไหล่จะแสดงที่นี่'}
              />
            </div>
          )}

          {!loading && groups.map(group => {
            const open = !!query || expanded.has(group.id);
            return (
              <div key={group.id} className="card" style={{ marginBottom: '0.6rem', padding: 0 }}>
                <button
                  type="button"
                  onClick={() => toggleGroup(group.id)}
                  aria-expanded={open}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '0.8rem 1rem', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', color: 'var(--text-primary)' }}
                >
                  {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <span style={{ fontWeight: 600, flex: 1, minWidth: 0 }}>
                    {group.title}
                    {group.subtitle && <span className="text-muted" style={{ fontWeight: 400, fontSize: 12, marginLeft: 8 }}>{group.subtitle}</span>}
                  </span>
                  <span className="badge info">{group.total} ชิ้น</span>
                  <span className="badge">{group.items.length} {view === 'customer' ? 'รายการอะไหล่' : 'ลูกค้า'}</span>
                </button>
                {open && (
                  <div className="table-container" style={{ borderTop: '1px solid var(--border-color)' }}>
                    <table>
                      <thead>
                        <tr>
                          {view === 'customer' ? <><th>SKU</th><th>ชื่ออะไหล่</th></> : <th>ลูกค้า</th>}
                          <th>จำนวน</th>
                          <th>SN</th>
                          <th>หุ่นยนต์</th>
                          <th>โอนล่าสุด</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.items.map(item => (
                          <tr key={item.key}>
                            {view === 'customer'
                              ? <><td style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{item.sku || '—'}</td><td>{item.partName}</td></>
                              : <td>{item.customerName}</td>}
                            <td>{item.quantity}</td>
                            <td><SerialList values={item.serialNumbers} /></td>
                            <td><SerialList values={item.robots} /></td>
                            <td className="text-muted" style={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }}>{formatTime(item.lastAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      {tab === 'takeouts' && (
        <div className="card">
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>เวลา</th>
                  <th>SKU</th>
                  <th>ชื่ออะไหล่</th>
                  <th>SN</th>
                  <th>จำนวน</th>
                  <th>รายละเอียดการนำออก</th>
                  <th>โดย</th>
                </tr>
              </thead>
              <tbody>
                {loading && <TableSkeleton cols={7} />}
                {!loading && takeouts.length === 0 && (
                  <EmptyState
                    mascot={query ? 'noResults' : 'emptyList'}
                    icon={<Package size={40} />}
                    title={query ? 'ไม่พบรายการที่ค้นหา' : 'ยังไม่มีรายการนำออก'}
                    description={query ? undefined : 'รายการที่นำอะไหล่ออกโดยใส่รายละเอียด (ไม่ได้ส่งให้ลูกค้า) จะแสดงที่นี่'}
                    colSpan={7}
                  />
                )}
                {pagedTakeouts.map(entry => (
                  <tr key={entry.id}>
                    <td className="text-muted" style={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }}>{formatTime(entry.performedAt)}</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{entry.sku || '—'}</td>
                    <td>{entry.partName}</td>
                    <td><SerialList values={entry.serialNumbers} /></td>
                    <td>{entry.quantity}</td>
                    <td style={{ maxWidth: 320, whiteSpace: 'pre-wrap', fontSize: 13 }}>{entry.note || <span className="text-muted">—</span>}</td>
                    <td className="text-muted" style={{ fontSize: '0.8rem' }}>{entry.performedBy || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={pageSize} total={takeouts.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
        </div>
      )}
    </div>
  );
};

export default CustomerParts;
