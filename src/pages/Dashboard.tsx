import React, { useState, useEffect, useMemo, useCallback } from 'react';
import RobotMascot from '../components/RobotMascot';
import { greetingForNow } from '../utils/mascots';
import { useData } from '../context/DataContext';
import { Package, Wrench, Users, AlertCircle, Bot, ShoppingCart, ClipboardList, AlertTriangle, ShieldAlert, CalendarX, ArrowRight, Boxes, PackageSearch, FileText, TrendingUp, TrendingDown } from 'lucide-react';
import api from '../api';
import { usePolling } from '../lib/usePolling';
import { Link } from 'react-router-dom';
import { SkeletonCard, RefreshButton, TableSkeleton, TicketStatusBadge } from '../components/UIUtils';
import PageHeader from '../components/PageHeader';
import { useAuth } from '../context/AuthContext';
import { formatTicketNo } from '../utils/displayText';

interface SparePart { id: string; sku: string; name: string; stock: number; minStock: number; }
interface PurchaseOrder { id: string; docNumber: string; status: string; totalAmount: number; orderDate: string; }
interface RobotLoan { id: string; docNumber: string; status: string; expectedReturn: string; borrowerName: string; }
interface TrendPoint { date: string; label: string; tickets: number; purchaseOrders: number; stockAlerts: number; }
interface MaVisit { id: string; scheduledDate: string; status: string; plan?: { customer?: { name: string } } }
interface TodayItem { id: string; icon: React.ReactNode; tone: 'danger' | 'warning'; title: string; detail: string; href: string; }

const DAY_MS = 86400000;

const today = new Date();
today.setHours(0, 0, 0, 0);

const parseDate = (dateStr: string) => {
  const parsed = new Date(dateStr);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setHours(0, 0, 0, 0);
  return parsed;
};

const daysFromNow = (dateStr: string) => {
  if (!dateStr) return Infinity;
  const parsed = parseDate(dateStr);
  if (!parsed) return Infinity;
  return Math.ceil((parsed.getTime() - today.getTime()) / DAY_MS);
};

const daysAgo = (dateStr: string) => {
  const parsed = parseDate(dateStr);
  if (!parsed) return Infinity;
  return Math.floor((today.getTime() - parsed.getTime()) / DAY_MS);
};

const priorityWeight: Record<string, number> = {
  Critical: 4,
  High: 3,
  Normal: 2,
  Low: 1,
};

function compareWindow(current: number, previous: number) {
  const delta = current - previous;
  const direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  return { delta, direction };
}

function buildPolyline(values: number[], width: number, height: number, padding = 10) {
  if (values.length === 0) return '';
  const max = Math.max(...values, 1);
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;
  return values.map((value, index) => {
    const x = padding + (values.length === 1 ? innerWidth / 2 : (index / (values.length - 1)) * innerWidth);
    const y = padding + innerHeight - (value / max) * innerHeight;
    return `${x},${y}`;
  }).join(' ');
}

const TrendChartCard: React.FC<{
  title: string;
  subtitle: string;
  color: string;
  values: number[];
  labels: string[];
}> = ({ title, subtitle, color, values, labels }) => {
  const hasData = values.length > 0 && values.some(value => value > 0);
  const total = values.reduce((sum, value) => sum + value, 0);
  const recent = values.slice(-7).reduce((sum, value) => sum + value, 0);
  const previous = values.slice(-14, -7).reduce((sum, value) => sum + value, 0);
  const compare = compareWindow(recent, previous);
  const points = buildPolyline(values, 320, 110);
  const peak = Math.max(...values, 0);

  return (
    <div className="card" style={{ padding: '1rem 1.1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>{title}</div>
          <div className="text-muted" style={{ fontSize: '0.76rem', marginTop: 2 }}>{subtitle}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--text-primary)' }}>{total}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end', color: compare.delta > 0 ? 'var(--status-danger)' : compare.delta < 0 ? 'var(--status-success)' : 'var(--text-muted)', fontSize: '0.74rem', fontWeight: 700 }}>
            {compare.direction === 'up' ? <TrendingUp size={13} /> : compare.direction === 'down' ? <TrendingDown size={13} /> : <ArrowRight size={13} />}
            7 วัน {Math.abs(compare.delta)}
          </div>
        </div>
      </div>
      {hasData ? (
        <svg viewBox="0 0 320 110" width="100%" height="110" role="img" aria-label={title}>
          <polyline fill="none" stroke="rgba(148,163,184,0.25)" strokeWidth="1" points="10,100 310,100" />
          <polyline fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" points={points} />
        </svg>
      ) : (
        <div style={{ height: 110, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: '0.8rem' }} className="text-muted">
          <RobotMascot scene="quiet" size={72} />
          ยังไม่มีข้อมูลใน 30 วัน
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginTop: 8 }}>
        <div className="text-muted" style={{ fontSize: '0.74rem' }}>{hasData ? `${labels[0]} - ${labels[labels.length - 1]}` : '-'}</div>
        <div className="text-muted" style={{ fontSize: '0.74rem' }}>{peak > 0 ? `peak ${peak}` : 'flat'}</div>
      </div>
    </div>
  );
};

const MiniMetricCard: React.FC<{
  label: string;
  value: number | string;
  hint: string;
  tone: string;
  icon: React.ReactNode;
  href?: string;
}> = ({ label, value, hint, tone, icon, href }) => {
  const content = (
    <div className="card" style={{ padding: '1rem 1.05rem', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <div className="text-muted" style={{ fontSize: '0.76rem', marginBottom: 6 }}>{label}</div>
          <div style={{ fontSize: '1.65rem', fontWeight: 800, lineHeight: 1.05, color: 'var(--text-primary)' }}>{value}</div>
          <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: 8 }}>{hint}</div>
        </div>
        <div style={{ width: 42, height: 42, borderRadius: 14, display: 'grid', placeItems: 'center', color: tone, background: `color-mix(in srgb, ${tone} 16%, transparent)`, flexShrink: 0 }}>
          {icon}
        </div>
      </div>
    </div>
  );

  if (!href) return content;
  return (
    <Link to={href} style={{ textDecoration: 'none', color: 'inherit' }}>
      {content}
    </Link>
  );
};

const Dashboard: React.FC = () => {
  const { robots, customers, tickets, models, sparePartSummary, loading, fetchData } = useData();
  const { user } = useAuth();
  const greeting = greetingForNow();

  const lowStock: SparePart[] = sparePartSummary?.lowStock ?? [];
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [loans, setLoans] = useState<RobotLoan[]>([]);
  const [trendSeries, setTrendSeries] = useState<TrendPoint[]>([]);
  const [maVisits, setMaVisits] = useState<MaVisit[]>([]);
  const [loadingStats, setLoadingStats] = useState(true);

  const fetchStats = useCallback(async () => {
    setLoadingStats(true);
    await Promise.all([
      api.get('/purchase-orders').then(r => setPurchaseOrders(r.data)).catch(() => {}),
      api.get('/loans').then(r => setLoans(r.data)).catch(() => {}),
      api.get('/stats/dashboard-trends').then(r => setTrendSeries(r.data)).catch(() => setTrendSeries([])),
      api.get('/ma-visits', { params: { upcomingDays: 30, includeOverdue: 1 } }).then(r => setMaVisits(r.data)).catch(() => {}),
    ]);
    setLoadingStats(false);
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);
  usePolling(fetchStats, 300_000);

  const robotById = useMemo(() => new Map(robots.map(robot => [robot.id, robot])), [robots]);

  const totalRobots = robots.length;
  const assigned = robots.filter(r => r.status === 'Assigned').length;
  const activeTickets = tickets.filter(t => t.status !== 'Completed').length;
  const overdueLoans = loans.filter(l => ['Active', 'Approved'].includes(l.status) && daysFromNow(l.expectedReturn) < 0);
  const outStockCount = sparePartSummary?.outOfStock ?? 0;
  const warrantyWarning = robots.filter(r => {
    if (!r.warrantyExpiresAt) return false;
    const d = daysFromNow(r.warrantyExpiresAt);
    return d >= 0 && d <= 30;
  });
  const criticalTickets = tickets
    .filter(ticket => ticket.status !== 'Completed')
    .slice()
    .sort((left, right) => {
      const priorityDelta = (priorityWeight[right.priorityLevel || 'Normal'] || 0) - (priorityWeight[left.priorityLevel || 'Normal'] || 0);
      if (priorityDelta !== 0) return priorityDelta;
      return daysAgo(right.reportDate) - daysAgo(left.reportDate);
    });
  const pendingPO = purchaseOrders.filter(o => o.status === 'Draft');
  const orderedPO = purchaseOrders.filter(o => o.status === 'Ordered');
  const activeLoans = loans.filter(l => ['Active', 'Approved'].includes(l.status)).length;
  // lowStock (stock<=minStock) กับ outStock (stock<=0) ทับกัน — อะไหล่ที่หมดและมี minStock
  // เคยถูกนับสองรอบ ทำให้ตัวเลขบนการ์ดสูงกว่าจำนวนอะไหล่จริง — outOfStock นับเฉพาะอะไหล่ที่ track stock เท่านั้น
  const stockRiskCount = sparePartSummary?.stockRisk ?? 0;
  const trendLabels = trendSeries.map(point => point.label);
  const poOrdered = orderedPO.length;
  const criticalCount = criticalTickets.filter(ticket => (priorityWeight[ticket.priorityLevel || 'Normal'] || 0) >= 3).length;

  // MA visits: overdue = ยังนัดหมายอยู่ (Scheduled) แต่วันนัดผ่านไปแล้ว, ถึงกำหนดใน 7 วันข้างหน้า
  const maOverdueVisits = maVisits.filter(v => v.status === 'Scheduled' && daysFromNow(v.scheduledDate) < 0);
  const maDueSoonVisits = maVisits.filter(v => v.status === 'Scheduled' && daysFromNow(v.scheduledDate) >= 0 && daysFromNow(v.scheduledDate) <= 7);

  const kpiCards = [
    { label: 'หุ่นยนต์ทั้งหมด', value: totalRobots, hint: `ติดตั้งแล้ว ${assigned}`, tone: 'var(--status-info)', icon: <Bot size={18} />, href: '/inventory' },
    { label: 'งานซ่อมที่เปิดอยู่', value: activeTickets, hint: `เร่งด่วน ${criticalCount}`, tone: 'var(--status-warning)', icon: <Wrench size={18} />, href: '/maintenance' },
    { label: 'MA เลยกำหนด / ถึงกำหนด 7 วัน', value: maOverdueVisits.length, hint: `ถึงกำหนด 7 วัน ${maDueSoonVisits.length}`, tone: 'var(--status-danger)', icon: <ShieldAlert size={18} />, href: '/ma-schedule' },
    { label: 'ใบยืมเกินกำหนด', value: overdueLoans.length, hint: `กำลังยืม ${activeLoans}`, tone: 'var(--status-danger)', icon: <CalendarX size={18} />, href: '/robot-loans' },
    { label: 'อะไหล่ต่ำกว่าขั้นต่ำ', value: stockRiskCount, hint: `${outStockCount} รายการหมดสต๊อก`, tone: 'var(--status-warning)', icon: <PackageSearch size={18} />, href: '/spare-parts' },
    { label: 'PO รออนุมัติ/สั่งซื้อ', value: pendingPO.length, hint: `สั่งซื้อแล้ว ${poOrdered}`, tone: 'var(--accent-primary)', icon: <ShoppingCart size={18} />, href: '/purchase-orders' },
  ];

  // ── งานวันนี้: รวมงานค้างที่ต้องจัดการจากข้อมูลที่โหลดมาแล้ว ─────────────
  const todayItems: TodayItem[] = [
    ...maOverdueVisits.map((v): TodayItem => ({
      id: `ma-overdue-${v.id}`,
      icon: <ShieldAlert size={15} />,
      tone: 'danger',
      title: `MA เลยกำหนด · ${v.plan?.customer?.name || 'ลูกค้าไม่ระบุ'}`,
      detail: `เลยกำหนด ${Math.abs(daysFromNow(v.scheduledDate))} วัน`,
      href: '/ma-schedule',
    })),
    ...maDueSoonVisits.map((v): TodayItem => ({
      id: `ma-due-${v.id}`,
      icon: <ShieldAlert size={15} />,
      tone: 'warning',
      title: `MA ถึงกำหนด · ${v.plan?.customer?.name || 'ลูกค้าไม่ระบุ'}`,
      detail: daysFromNow(v.scheduledDate) === 0 ? 'ถึงกำหนดวันนี้' : `อีก ${daysFromNow(v.scheduledDate)} วัน`,
      href: '/ma-schedule',
    })),
    ...criticalTickets
      .filter(ticket => (priorityWeight[ticket.priorityLevel || 'Normal'] || 0) >= 3)
      .slice(0, 4)
      .map((ticket): TodayItem => ({
        id: `ticket-${ticket.id}`,
        icon: <Wrench size={15} />,
        tone: 'danger',
        title: `${formatTicketNo(ticket.id)} · ${robotById.get(ticket.robotId)?.serialNumber || 'ไม่ระบุเครื่อง'}`,
        detail: ticket.issueDescription,
        href: '/maintenance',
      })),
    ...overdueLoans.map((loan): TodayItem => ({
      id: `loan-${loan.id}`,
      icon: <CalendarX size={15} />,
      tone: 'danger',
      title: `ใบยืม ${loan.docNumber} เกินกำหนดคืน`,
      detail: `${loan.borrowerName} · เกิน ${Math.abs(daysFromNow(loan.expectedReturn))} วัน`,
      href: '/robot-loans',
    })),
    ...(lowStock.length > 0 ? [{
      id: 'low-stock-summary',
      icon: <PackageSearch size={15} />,
      tone: 'warning' as const,
      title: `อะไหล่ต่ำกว่าขั้นต่ำ ${lowStock.length} รายการ`,
      detail: lowStock.slice(0, 3).map(p => p.name).join(', '),
      href: '/spare-parts',
    }] : []),
  ].slice(0, 8);

  const recentTickets = tickets
    .slice()
    .sort((left, right) => right.reportDate.localeCompare(left.reportDate))
    .slice(0, 6);

  const chartDefs: { key: 'tickets' | 'purchaseOrders' | 'stockAlerts'; title: string; subtitle: string; color: string }[] = [
    { key: 'tickets', title: 'แนวโน้มใบงานซ่อม 30 วัน', subtitle: 'จำนวนใบงานที่ถูกเปิดในแต่ละวัน', color: 'var(--status-info)' },
    { key: 'purchaseOrders', title: 'แนวโน้มใบสั่งซื้อ 30 วัน', subtitle: 'จำนวน PO ใหม่ในแต่ละวัน', color: 'var(--status-warning)' },
    { key: 'stockAlerts', title: 'แนวโน้มการแจ้งเตือนสต็อกต่ำ 30 วัน', subtitle: 'จำนวนการแจ้งเตือนสต็อกต่ำรายวัน', color: 'var(--status-danger)' },
  ];
  const visibleCharts = chartDefs.filter(def => trendSeries.some(point => (point[def.key] || 0) > 0));

  const quickActions = useMemo(() => {
    const base = [
      { href: '/maintenance', label: 'เปิดงานซ่อม', icon: <Wrench size={16} /> },
      { href: '/robots', label: 'ดูหุ่นยนต์', icon: <Bot size={16} /> },
      { href: '/spare-parts', label: 'เช็กสต็อก', icon: <Boxes size={16} /> },
    ];
    if (user?.role === 'WAREHOUSE') {
      return [
        ...base,
        { href: '/purchase-orders', label: 'รับของเข้า', icon: <ShoppingCart size={16} /> },
        { href: '/warehouses', label: 'จัดการคลัง', icon: <Package size={16} /> },
      ];
    }
    if (user?.role === 'SALES') {
      return [
        ...base,
        { href: '/customers', label: 'ดูลูกค้า', icon: <Users size={16} /> },
        { href: '/delivery-notes', label: 'ออกใบส่งของ', icon: <FileText size={16} /> },
      ];
    }
    return [
      ...base,
      { href: '/purchase-orders', label: 'ดูใบสั่งซื้อ', icon: <ShoppingCart size={16} /> },
      { href: '/delivery-notes', label: 'พื้นที่ใบส่งของ', icon: <FileText size={16} /> },
    ];
  }, [user?.role]);

  return (
    <div className="page-container">
      {/* Greeting that changes with the time of day (Thai time). */}
      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0.6rem 1rem', marginBottom: '1rem', overflow: 'hidden' }}>
        <RobotMascot scene={greeting.scene} size={64} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: '1rem' }}>{greeting.text}{user?.username ? ` คุณ${user.username}` : ''}</div>
          <div className="text-muted" style={{ fontSize: '0.8rem' }}>
            {!loading && todayItems.length > 0 ? `วันนี้มีงานที่ต้องดู ${todayItems.length} รายการ` : 'วันนี้ยังไม่มีงานค้าง'}
          </div>
        </div>
      </div>

      <PageHeader
        title="ภาพรวมระบบ"
        subtitle="ภาพรวมงานเร่งและทางลัดสำหรับวันนี้"
        actions={<RefreshButton onClick={async () => { await Promise.all([fetchStats(), fetchData()]); }} loading={loadingStats || loading} />}
      />

      {/* KPI row — at most 6 cards, each linking to the relevant page */}
      {loadingStats ? (
        <div className="dashboard-kpi-grid">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} height={110} />)}
        </div>
      ) : (
        <div className="dashboard-kpi-grid">
          {kpiCards.map(card => (
            <MiniMetricCard key={card.label} {...card} />
          ))}
        </div>
      )}

      {/* Quick shortcuts — compact single row */}
      <div className="card">
        <div className="card-header-info">
          <ArrowRight size={16} /> ทางลัดการทำงาน
        </div>
        <div className="dashboard-shortcuts-row">
          {quickActions.map(action => (
            <Link key={action.href} to={action.href} className="dashboard-shortcut-chip">
              {action.icon}
              {action.label}
            </Link>
          ))}
        </div>
      </div>

      {/* Today + recent tickets */}
      <div className="responsive-grid-2">
        <div className="card">
          <div className="card-header-primary">
            <ClipboardList size={16} /> งานวันนี้
          </div>
          <div className="dashboard-today-list">
            {todayItems.map(item => (
              <Link key={item.id} to={item.href} className="dashboard-today-item">
                <span style={{ color: item.tone === 'danger' ? 'var(--status-danger)' : 'var(--status-warning)', flexShrink: 0, marginTop: 2 }}>
                  {item.icon}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 700, fontSize: '0.84rem' }}>{item.title}</span>
                  <span className="text-muted" style={{ display: 'block', fontSize: '0.78rem', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.detail}</span>
                </span>
              </Link>
            ))}
            {loading && todayItems.length === 0 && (
              <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>กำลังโหลด…</div>
            )}
            {!loading && todayItems.length === 0 && (
              <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--text-muted)', fontSize: '0.85rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <RobotMascot scene="allClear" size={110} fallback={<span aria-hidden="true">🎉</span>} />
                วันนี้ไม่มีงานค้าง
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header-primary">
            <AlertCircle size={16} /> ซ่อมบำรุงล่าสุด
          </div>
          <div className="table-container" style={{ border: 'none', borderRadius: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>เลขที่ใบงาน</th>
                  <th>SN</th>
                  <th>ปัญหา</th>
                  <th>วันที่</th>
                  <th>สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {recentTickets.map(ticket => {
                  const robot = robotById.get(ticket.robotId);
                  return (
                    <tr key={ticket.id}>
                      <td style={{ fontWeight: 700, fontSize: '0.78rem', fontVariantNumeric: 'tabular-nums', color: 'var(--accent-primary)' }}>
                        {formatTicketNo(ticket.id)}
                      </td>
                      <td style={{ fontWeight: 600, fontSize: '0.8rem', fontVariantNumeric: 'tabular-nums' }}>
                        {robot?.serialNumber ?? '-'}
                      </td>
                      <td style={{ fontSize: '0.8rem', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ticket.issueDescription}</td>
                      <td className="text-muted" style={{ fontSize: '0.78rem' }}>{ticket.reportDate}</td>
                      <td>
                        <TicketStatusBadge status={ticket.status} />
                      </td>
                    </tr>
                  );
                })}
                {loading && tickets.length === 0 && <TableSkeleton cols={5} rows={4} />}
                {!loading && tickets.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      ยังไม่มีใบงานซ่อมบำรุง
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Trend charts — only series with real data; a flat-zero board just shows one muted line */}
      {loadingStats ? (
        <div className="dashboard-charts-grid">
          {Array.from({ length: 3 }).map((_, index) => <SkeletonCard key={index} height={220} />)}
        </div>
      ) : visibleCharts.length > 0 ? (
        <div className="dashboard-charts-grid">
          {visibleCharts.map(def => (
            <TrendChartCard
              key={def.key}
              title={def.title}
              subtitle={def.subtitle}
              color={def.color}
              values={trendSeries.map(point => point[def.key])}
              labels={trendLabels}
            />
          ))}
        </div>
      ) : (
        <div className="card text-muted" style={{ padding: '1rem', fontSize: '0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <RobotMascot scene="quiet" size={72} fallback={<TrendingUp size={16} style={{ opacity: 0.6 }} />} />
          ยังไม่มีข้อมูลใน 30 วัน
        </div>
      )}

      {/* Low-stock parts table */}
      {lowStock.length > 0 && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderBottom: '1px solid var(--border-color)', fontWeight: 600, fontSize: 13 }}>
            <AlertTriangle size={15} style={{ color: 'var(--status-warning)' }} />
            อะไหล่ใกล้หมด
          </div>
          <div className="table-container" style={{ border: 'none', borderRadius: 0, maxHeight: 220, overflowY: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>อะไหล่</th>
                  <th style={{ textAlign: 'center' }}>สต๊อก</th>
                  <th style={{ textAlign: 'center' }}>สต๊อกขั้นต่ำ</th>
                </tr>
              </thead>
              <tbody>
                {lowStock.map(p => (
                  <tr key={p.id}>
                    <td style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12, fontWeight: 700, color: 'var(--accent-primary)' }}>{p.sku}</td>
                    <td style={{ fontSize: 13 }}>{p.name}</td>
                    <td style={{ textAlign: 'center', fontWeight: 700, color: p.stock <= 0 ? 'var(--status-danger)' : 'var(--status-warning)' }}>{p.stock}</td>
                    <td style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: 12 }}>{p.minStock}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Warranty expiring within 30 days */}
      {warrantyWarning.length > 0 && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderBottom: '1px solid var(--border-color)', fontWeight: 600, fontSize: 13 }}>
            <ShieldAlert size={15} style={{ color: 'var(--status-warning)' }} />
            ว้อร์แรนตี้ใกล้หมด (30 days)
          </div>
          <div className="table-container" style={{ border: 'none', borderRadius: 0, maxHeight: 200, overflowY: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>SN</th>
                  <th>รุ่น</th>
                  <th>ลูกค้า</th>
                  <th>ว้อร์แรนตี้หมด</th>
                  <th style={{ textAlign: 'center' }}>ถึง</th>
                </tr>
              </thead>
              <tbody>
                {warrantyWarning.map(r => {
                  const model = models.find(m => m.id === r.modelId);
                  const customer = r.customerId ? customers.find(c => c.id === r.customerId) : null;
                  const d = daysFromNow(r.warrantyExpiresAt!);
                  return (
                    <tr key={r.id}>
                      <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, fontSize: 12 }}>{r.serialNumber}</td>
                      <td style={{ fontSize: 13 }}>{model?.name ?? '-'}</td>
                      <td style={{ fontSize: 13 }}>{customer?.name ?? '-'}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{r.warrantyExpiresAt}</td>
                      <td style={{ textAlign: 'center', fontWeight: 700, color: d <= 7 ? 'var(--status-danger)' : 'var(--status-warning)' }}>{d}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
