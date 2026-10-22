import React, { useState, useEffect } from 'react';
import { TrendingUp, Package, Wrench, ClipboardList, DollarSign, Download } from 'lucide-react';
import api from '../api';
import PageHeader from '../components/PageHeader';

interface MonthlyStat {
  label: string;
  deliveries: number;
  tickets: number;
  partsUsed: number;
  partsCost: number;
}

const BAR_MAX_HEIGHT = 120; // px

const Bar: React.FC<{ value: number; max: number; color: string; label: string }> = ({ value, max, color, label }) => {
  const height = max > 0 ? Math.max(4, Math.round((value / max) * BAR_MAX_HEIGHT)) : 4;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600 }}>{value > 0 ? value : ''}</span>
      <div style={{ width: 18, height: BAR_MAX_HEIGHT, display: 'flex', alignItems: 'flex-end' }}>
        <div style={{ width: '100%', height, background: color, borderRadius: '3px 3px 0 0', transition: 'height 0.3s' }} />
      </div>
    </div>
  );
};

const Report: React.FC = () => {
  const [stats, setStats] = useState<MonthlyStat[]>([]);
  const [loading, setLoading] = useState(true);

  const [loadError, setLoadError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const fetchStats = async () => {
    setLoading(true);
    try { const res = await api.get('/stats/monthly'); setStats(res.data); setLoaded(true); setLoadError(false); }
    catch { setLoadError(true); }
    finally { setLoading(false); }
  };
  useEffect(() => { fetchStats(); }, []);

  const maxDeliveries = Math.max(1, ...stats.map(s => s.deliveries));
  const maxTickets = Math.max(1, ...stats.map(s => s.tickets));
  const maxParts = Math.max(1, ...stats.map(s => s.partsUsed));
  const maxCost = Math.max(1, ...stats.map(s => s.partsCost));

  const totals = stats.reduce(
    (acc, s) => ({
      deliveries: acc.deliveries + s.deliveries,
      tickets: acc.tickets + s.tickets,
      partsUsed: acc.partsUsed + s.partsUsed,
      partsCost: acc.partsCost + s.partsCost,
    }),
    { deliveries: 0, tickets: 0, partsUsed: 0, partsCost: 0 }
  );

  const handleExportCSV = () => {
    const header = ['เดือน', 'ใบส่งของ', 'Tickets', 'อะไหล่ที่ใช้', 'ค่าใช้จ่าย (บาท)'];
    const rows = stats.map(s => [s.label, s.deliveries, s.tickets, s.partsUsed, s.partsCost.toFixed(2)]);
    rows.push(['รวม', totals.deliveries, totals.tickets, totals.partsUsed, totals.partsCost.toFixed(2)]);
    const csv = [header, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `monthly-report-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading && !loaded) return <div className="text-muted" style={{ padding: '2rem' }}>กำลังโหลดข้อมูล...</div>;

  return (
    <div>
      <PageHeader
        title={<><TrendingUp size={22} /> รายงานสรุป 12 เดือน</>}
        subtitle="สรุปปริมาณใบส่งของ งานซ่อม การใช้อะไหล่ และค่าใช้จ่ายรายเดือนย้อนหลัง"
        actions={<button className="btn btn-outline" disabled={loading || !loaded || loadError} onClick={handleExportCSV}>
          <Download size={15} /> ส่งออก CSV
        </button>}
      />

      {loadError && <div role="alert" className="card" style={{ color: 'var(--status-danger)', marginBottom: '1rem' }}>โหลดไม่สำเร็จ <button className="btn btn-outline" disabled={loading} onClick={fetchStats}>ลองใหม่</button></div>}
      {loaded && <>
      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        {[
          { icon: <ClipboardList size={20} />, label: 'ใบส่งของ (รวม)', value: totals.deliveries, color: 'var(--status-info)' },
          { icon: <Wrench size={20} />, label: 'ตั๋วซ่อม (รวม)', value: totals.tickets, color: 'var(--status-warning)' },
          { icon: <Package size={20} />, label: 'อะไหล่ที่ใช้ (รวม)', value: totals.partsUsed, color: 'var(--status-success)' },
          { icon: <DollarSign size={20} />, label: 'ค่าใช้จ่าย (รวม)', value: `฿${totals.partsCost.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`, color: '#8b5cf6' },
        ].map((c, i) => (
          <div key={i} className="card" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ color: c.color }}>{c.icon}</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{c.value}</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{c.label}</div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        {[
          { title: 'ใบส่งของ / เดือน', key: 'deliveries' as const, max: maxDeliveries, color: 'var(--status-info)' },
          { title: 'ตั๋วซ่อม / เดือน', key: 'tickets' as const, max: maxTickets, color: 'var(--status-warning)' },
          { title: 'อะไหล่ที่ใช้ / เดือน', key: 'partsUsed' as const, max: maxParts, color: 'var(--status-success)' },
          { title: 'ค่าใช้จ่ายอะไหล่ / เดือน', key: 'partsCost' as const, max: maxCost, color: '#8b5cf6' },
        ].map(chart => (
          <div key={chart.key} className="card" style={{ padding: '1rem' }}>
            <div style={{ fontWeight: 600, marginBottom: '0.75rem', fontSize: '0.88rem' }}>{chart.title}</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, overflowX: 'auto', paddingBottom: 4 }}>
              {stats.map(s => (
                <div key={s.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minWidth: 22 }}>
                  <Bar value={s[chart.key]} max={chart.max} color={chart.color} label={s.label} />
                  <span style={{ fontSize: 9, color: 'var(--text-muted)', writingMode: 'vertical-rl', textOrientation: 'mixed', transform: 'rotate(180deg)', maxHeight: 36 }}>
                    {s.label.slice(5)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Data table */}
      <div className="card">
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>เดือน</th>
                <th style={{ textAlign: 'center' }}>ใบส่งของ</th>
                <th style={{ textAlign: 'center' }}>ตั๋วซ่อม</th>
                <th style={{ textAlign: 'center' }}>อะไหล่ที่ใช้</th>
                <th style={{ textAlign: 'right' }}>ค่าใช้จ่าย (บาท)</th>
              </tr>
            </thead>
            <tbody>
              {stats.map(s => (
                <tr key={s.label}>
                  <td style={{ fontWeight: 600 }}>{s.label}</td>
                  <td style={{ textAlign: 'center' }}>{s.deliveries || '-'}</td>
                  <td style={{ textAlign: 'center' }}>{s.tickets || '-'}</td>
                  <td style={{ textAlign: 'center' }}>{s.partsUsed || '-'}</td>
                  <td style={{ textAlign: 'right' }}>{s.partsCost > 0 ? s.partsCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}</td>
                </tr>
              ))}
              <tr style={{ fontWeight: 700, background: 'var(--accent-subtle)' }}>
                <td>รวมทั้งหมด</td>
                <td style={{ textAlign: 'center' }}>{totals.deliveries}</td>
                <td style={{ textAlign: 'center' }}>{totals.tickets}</td>
                <td style={{ textAlign: 'center' }}>{totals.partsUsed}</td>
                <td style={{ textAlign: 'right' }}>{totals.partsCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      </>}
    </div>
  );
};

export default Report;
