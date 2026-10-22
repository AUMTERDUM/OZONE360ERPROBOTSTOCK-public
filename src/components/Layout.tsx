import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import ErrorBoundary from './ErrorBoundary';
import OfflineBanner from './OfflineBanner';
import RobotMascot from './RobotMascot';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { BarChart2, Users, LayoutDashboard, LogOut, UserCog, MapPin, Activity, FileText, ClipboardList, ClipboardCheck, Wrench, Bot, ChevronRight, Home, Package, Trash2, Database, Palette, ShoppingCart, Search, X, Menu, Briefcase, Upload, TrendingUp, Bell, DollarSign, Layers, CalendarDays } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { useTheme, THEMES } from '../context/ThemeContext';
import api from '../api';
import { usePolling } from '../lib/usePolling';
import { formatThaiDateTime, todayISO } from '../utils/thaiDate';
import CameraScanButton from './CameraScanButton';
import MobileTableCards from './MobileTableCards';
import SearchHistory from './SearchHistory';

const routeMeta: Record<string, { label: string; parent?: string }> = {
  '/': { label: 'แดชบอร์ด' },
  '/inventory': { label: 'หุ่นยนต์ทั้งหมด', parent: 'คลังหุ่นยนต์' },
  '/models': { label: 'รุ่นหุ่นยนต์', parent: 'คลังหุ่นยนต์' },
  '/warehouses': { label: 'คลังสินค้า', parent: 'คลังหุ่นยนต์' },
  '/spare-parts': { label: 'อะไหล่', parent: 'คลังหุ่นยนต์' },
  '/customers': { label: 'ลูกค้า', parent: 'ลูกค้า & บริการ' },
  '/customer-parts': { label: 'อะไหล่ที่ลูกค้า', parent: 'ลูกค้า & บริการ' },
  '/maintenance': { label: 'ซ่อมบำรุง', parent: 'ลูกค้า & บริการ' },
  '/ma-schedule': { label: 'ตาราง MA', parent: 'ลูกค้า & บริการ' },
  '/site-survey': { label: 'Site Survey', parent: 'ลูกค้า & บริการ' },
  '/pudu/import': { label: 'นำเข้าข้อมูล', parent: 'ลูกค้า & บริการ' },
  '/report': { label: 'รายงานสรุป', parent: 'เอกสาร' },
  '/delivery-notes': { label: 'ใบส่งของ', parent: 'เอกสาร' },
  '/robot-loans': { label: 'ใบยืมหุ่นยนต์', parent: 'เอกสาร' },
  '/purchase-orders': { label: 'ใบสั่งซื้ออะไหล่', parent: 'เอกสาร' },
  '/project-requests': { label: 'ใบเปิดโปรเจค', parent: 'เอกสาร' },
  '/accounts': { label: 'บัญชี / การเงิน', parent: 'เอกสาร' },
  '/material-requests': { label: 'เบิกอะไหล่', parent: 'เอกสาร' },
  '/travel-expenses': { label: 'ใบเบิกต่างจังหวัด', parent: 'เอกสาร' },
  '/users': { label: 'จัดการผู้ใช้', parent: 'ผู้ดูแลระบบ' },
  '/activity-log': { label: 'บันทึกกิจกรรม', parent: 'ผู้ดูแลระบบ' },
  '/trash': { label: 'ถังขยะ', parent: 'ผู้ดูแลระบบ' },
  '/backup': { label: 'สำรองข้อมูล', parent: 'ผู้ดูแลระบบ' },
};

export const Layout: React.FC = () => {
  const { user, logout } = useAuth();
  const { tickets, robots, customers, models, sparePartSummary } = useData();
  const lowStockCount = sparePartSummary?.lowStock.length ?? 0;
  const navigate = useNavigate();
  const location = useLocation();
  const { themeId, setTheme } = useTheme();
  const [themeOpen, setThemeOpen] = useState(false);
  const themeRef = useRef<HTMLDivElement>(null);
  const [gSearch, setGSearch] = useState('');
  const [gDebounced, setGDebounced] = useState('');
  const [gFocus, setGFocus] = useState(false);
  const [gActiveIdx, setGActiveIdx] = useState(-1);
  const gRef = useRef<HTMLDivElement>(null);
  const gDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Debounce search input by 250ms
  useEffect(() => {
    gDebounceRef.current = setTimeout(() => setGDebounced(gSearch), 250);
    return () => clearTimeout(gDebounceRef.current);
  }, [gSearch]);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // ── Notification bell ────────────────────────────────────────────────────
  interface Notif { id: string; type: string; title: string; body?: string; read: boolean; entityType?: string; entityId?: string; createdAt: string; }
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const unreadCount = notifs.filter(n => !n.read).length;

  const [notifError, setNotifError] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const fetchNotifs = useCallback(() => {
    if (document.hidden) return Promise.resolve();
    return api.get('/notifications')
      .then(r => { setNotifs(r.data); setNotifError(false); })
      .catch(() => setNotifError(true));
  }, []);

  useEffect(() => { void fetchNotifs(); }, [fetchNotifs]);
  usePolling(fetchNotifs, 60_000);

  const markRead = async (id: string) => {
    await api.patch(`/notifications/${id}/read`);
    setNotifs(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  };

  const markAllRead = async () => {
    if (markingAll) return;
    setMarkingAll(true);
    try {
      await api.patch('/notifications/read-all');
      setNotifs(prev => prev.map(n => ({ ...n, read: true })));
      setNotifOpen(false);
    } catch {
      setNotifError(true);
    } finally {
      setMarkingAll(false);
    }
  };

  const notifIcon: Record<string, string> = { pudu_alert: '🚨', low_stock: '📦', overdue_loan: '⏰', ticket_updated: '🔧', system: 'ℹ️', ma_weekly: '📅', warranty_expiring: '🛡️', system_error: '⚠️', po_draft: '🧾' };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (themeRef.current && !themeRef.current.contains(e.target as Node)) setThemeOpen(false);
      if (gRef.current && !gRef.current.contains(e.target as Node)) setGFocus(false);
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Keyboard shortcut Ctrl+K / Cmd+K to focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        gRef.current?.querySelector('input')?.focus();
      }
      if (e.key === 'Escape') setGFocus(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const modelNameById = useMemo(() => new Map(models.map(model => [model.id, model.name])), [models]);
  const robotSerialById = useMemo(() => new Map(robots.map(robot => [robot.id, robot.serialNumber])), [robots]);

  // Where a notification leads: the page of its record, with ?open=<id> so that page opens it.
  const notifPath = (n: Notif): string | null => {
    const id = n.entityId ? encodeURIComponent(n.entityId) : '';
    switch (n.entityType) {
      case 'MaintenanceTicket': {
        const ticket = tickets.find(t => t.id === n.entityId);
        const serial = ticket ? robotSerialById.get(ticket.robotId) : undefined;
        return `/maintenance?${serial ? `q=${encodeURIComponent(serial)}&` : ''}open=${id}`;
      }
      case 'Robot': {
        const serial = robotSerialById.get(n.entityId ?? '');
        // PUDU alerts for robots not in the system carry the serial number instead of an id.
        return serial ? `/inventory?q=${encodeURIComponent(serial)}&open=${id}` : `/inventory?q=${id}`;
      }
      case 'SparePart': return `/spare-parts?open=${id}`;
      case 'PurchaseOrder': return `/purchase-orders?open=${id}`;
      case 'MaterialRequest': return `/material-requests?open=${id}`;
      case 'RobotLoan': return `/robot-loans?open=${id}`;
      case 'MaintenanceVisit': return '/ma-schedule';
      default: return null;
    }
  };

  const openNotif = (n: Notif) => {
    if (!n.read) void markRead(n.id).catch(() => {});
    const path = notifPath(n);
    if (!path) return;
    setNotifOpen(false);
    navigate(path);
  };


  const gResults = useMemo(() => {
    if (!gDebounced.trim() || gDebounced.length < 2) return [];
    const q = gDebounced.toLowerCase();
    // ?q= ทำให้หน้าปลายทางกรองมาให้เลย — เดิมพาไปหน้า list เปล่าๆ แล้วต้องไล่หาแถวเดิมซ้ำ
    const results: { label: string; sub: string; path: string }[] = [];
    robots.filter(r => r.serialNumber.toLowerCase().includes(q)).slice(0, 4).forEach(r => {
      results.push({ label: r.serialNumber, sub: `หุ่นยนต์ · ${modelNameById.get(r.modelId) ?? ''}`, path: `/inventory?q=${encodeURIComponent(r.serialNumber)}` });
    });
    customers.filter(c => c.name.toLowerCase().includes(q) || c.contactPerson.toLowerCase().includes(q)).slice(0, 3).forEach(c => {
      results.push({ label: c.name, sub: `ลูกค้า · ${c.contactPerson}`, path: `/customers?q=${encodeURIComponent(c.name)}` });
    });
    const qNo = q.replace(/^#/, '');
    tickets.filter(t => t.issueDescription.toLowerCase().includes(q) || (qNo.length >= 4 && t.id.toLowerCase().startsWith(qNo))).slice(0, 3).forEach(t => {
      const serial = robotSerialById.get(t.robotId) ?? t.robotId.slice(0, 8);
      results.push({ label: `#${t.id.slice(0, 8).toUpperCase()} · ${serial}`, sub: `ใบงานซ่อม · ${t.issueDescription.split('\n')[0].slice(0, 50)}`, path: `/maintenance?q=${encodeURIComponent(serial)}&open=${t.id}` });
    });
    return results.slice(0, 8);
  }, [gDebounced, robots, customers, tickets, modelNameById, robotSerialById]);

  // Reset active index when results change
  useEffect(() => { setGActiveIdx(-1); }, [gResults]);

  const handleGSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!gFocus || gResults.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setGActiveIdx(prev => (prev + 1) % gResults.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setGActiveIdx(prev => (prev <= 0 ? gResults.length - 1 : prev - 1));
    } else if (e.key === 'Enter' && gActiveIdx >= 0) {
      e.preventDefault();
      navigate(gResults[gActiveIdx].path);
      setGSearch(''); setGFocus(false);
    }
  }, [gFocus, gResults, gActiveIdx, navigate]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const activeTickets = tickets.filter(t => t.status !== 'Completed').length;

  // MA upcoming/overdue badge — only changes when a visit is due/done, so poll every 10 min
  const [maOverdueCount, setMaOverdueCount] = useState(0);
  const fetchMa = useCallback(() =>
    api.get('/ma-visits', { params: { upcomingDays: 30, includeOverdue: 1 } })
      .then(r => {
        const today = todayISO();
        const count = (r.data as Array<{ scheduledDate: string; status: string }>)
          .filter(v => v.status === 'Scheduled' && v.scheduledDate <= today).length;
        setMaOverdueCount(count);
      })
      .catch(() => {}), []);
  useEffect(() => { void fetchMa(); }, [fetchMa]);
  usePolling(fetchMa, 600_000);

  const meta = routeMeta[location.pathname] || { label: '' };
  return (
    <div className="app-layout">
      <MobileTableCards />
      <SearchHistory />
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="sidebar-overlay"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`sidebar${sidebarOpen ? ' sidebar-open' : ''}`} aria-label="เมนูหลัก">
        <div className="sidebar-header">
          <img src="/ozone360-logo-real.png" alt="OZONE360 Robotics Service" style={{ height: 36, width: 'auto', objectFit: 'contain', filter: 'brightness(0) invert(1)' }} />
          <button className="sidebar-close-btn" onClick={() => setSidebarOpen(false)} aria-label="ปิดเมนู">
            <X size={18} />
          </button>
        </div>
        <nav className="nav-links" aria-label="เมนูหลัก" onClick={() => setSidebarOpen(false)}>

          {/* ── ภาพรวม ── */}
          <NavLink to="/" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <LayoutDashboard size={18} />
            <span>แดชบอร์ด</span>
          </NavLink>

          <div className="nav-divider" />

          {/* ── คลังหุ่นยนต์ ── */}
          <h2 className="nav-section-label">คลังหุ่นยนต์</h2>
          <NavLink to="/inventory" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <Bot size={18} />
            <span>หุ่นยนต์ทั้งหมด</span>
          </NavLink>
          <NavLink to="/models" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <BarChart2 size={18} />
            <span>รุ่นหุ่นยนต์</span>
          </NavLink>
          <NavLink to="/warehouses" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <MapPin size={18} />
            <span>คลังสินค้า</span>
          </NavLink>
          <NavLink to="/spare-parts" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <Package size={18} />
            <span>อะไหล่</span>
            {lowStockCount > 0 && <span className="nav-badge" style={{ background: 'var(--status-warning)', color: 'var(--text-on-accent)' }}>{lowStockCount}</span>}
          </NavLink>

          <div className="nav-divider" />

          {/* ── ลูกค้า & บริการ ── */}
          <h2 className="nav-section-label">ลูกค้า & บริการ</h2>
          <NavLink to="/customers" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <Users size={18} />
            <span>ลูกค้า</span>
          </NavLink>
          <NavLink to="/customer-parts" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <Package size={18} />
            <span>อะไหล่ที่ลูกค้า</span>
          </NavLink>
          <NavLink to="/maintenance" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <Wrench size={18} />
            <span>ซ่อมบำรุง</span>
            {activeTickets > 0 && <span className="nav-badge">{activeTickets}</span>}
          </NavLink>
          <NavLink to="/ma-schedule" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <CalendarDays size={18} />
            <span>ตาราง MA</span>
            {maOverdueCount > 0 && <span className="nav-badge" style={{ background: 'var(--status-danger)', color: 'var(--text-on-accent)' }}>{maOverdueCount}</span>}
          </NavLink>
          <NavLink to="/pudu/import" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} style={{ paddingLeft: '2.25rem' }}>
            <Upload size={16} />
            <span style={{ fontSize: '0.85rem' }}>นำเข้าข้อมูล</span>
          </NavLink>
          <NavLink to="/site-survey" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <ClipboardCheck size={18} />
            <span>Site Survey</span>
          </NavLink>
          <div className="nav-divider" />

          {/* ── เอกสาร ── */}
          <h2 className="nav-section-label">เอกสาร</h2>
          <NavLink to="/report" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <TrendingUp size={18} />
            <span>รายงานสรุป</span>
          </NavLink>
          <NavLink to="/delivery-notes" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <FileText size={18} />
            <span>ใบส่งของ</span>
          </NavLink>
          <NavLink to="/robot-loans" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <ClipboardList size={18} />
            <span>ใบยืมหุ่นยนต์</span>
          </NavLink>
          <NavLink to="/purchase-orders" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <ShoppingCart size={18} />
            <span>ใบสั่งซื้ออะไหล่</span>
          </NavLink>
          <NavLink to="/project-requests" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <Briefcase size={18} />
            <span>ใบเปิดโปรเจค</span>
          </NavLink>
          <NavLink to="/accounts" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <DollarSign size={18} />
            <span>บัญชี / การเงิน</span>
          </NavLink>
          <NavLink to="/material-requests" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <Layers size={18} />
            <span>เบิกอะไหล่</span>
          </NavLink>
          <NavLink to="/travel-expenses" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <MapPin size={18} />
            <span>ใบเบิกต่างจังหวัด</span>
          </NavLink>

          {/* ── ผู้ดูแลระบบ ── */}
          {user?.role === 'ADMIN' && (
            <>
              <div className="nav-divider" />
              <h2 className="nav-section-label">ผู้ดูแลระบบ</h2>
              <NavLink to="/users" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                <UserCog size={18} />
                <span>จัดการผู้ใช้</span>
              </NavLink>
              <NavLink to="/activity-log" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                <Activity size={18} />
                <span>บันทึกกิจกรรม</span>
              </NavLink>
              <NavLink to="/trash" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                <Trash2 size={18} />
                <span>ถังขยะ</span>
              </NavLink>
              <NavLink to="/backup" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                <Database size={18} />
                <span>สำรองข้อมูล</span>
              </NavLink>
            </>
          )}

        </nav>
        {/* Little robot at the foot of the menu; waves when there are unread notifications. */}
        <button type="button" className="sidebar-mascot" onClick={() => setNotifOpen(true)}
          title={unreadCount > 0 ? `มีแจ้งเตือนใหม่ ${unreadCount} รายการ` : 'OZONE360'} aria-label={unreadCount > 0 ? `เปิดการแจ้งเตือน (${unreadCount})` : 'เปิดการแจ้งเตือน'}>
          <RobotMascot scene={unreadCount > 0 ? 'sidebarAlert' : 'sidebar'} size={unreadCount > 0 ? 64 : 56} />
          {unreadCount > 0 && <span className="sidebar-mascot-bubble">มี {unreadCount > 9 ? '9+' : unreadCount} แจ้งเตือน!</span>}
        </button>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        <header className="topbar">
          <div className="topbar-left">
            <button className="btn btn-ghost hamburger-btn" onClick={() => setSidebarOpen(o => !o)} title="เมนู">
              <Menu size={20} />
            </button>
            <nav className="breadcrumb" aria-label="เส้นทางหน้า">
              <span className="breadcrumb-item">
                <NavLink to="/" style={{ display: 'flex', alignItems: 'center' }}>
                  <Home size={14} />
                </NavLink>
              </span>
              {meta.parent && (
                <>
                  <ChevronRight size={12} className="breadcrumb-separator" />
                  <span className="breadcrumb-item">{meta.parent}</span>
                </>
              )}
              {location.pathname !== '/' && (
                <>
                  <ChevronRight size={12} className="breadcrumb-separator" />
                  <span className="breadcrumb-item active">{meta.label}</span>
                </>
              )}
            </nav>
          </div>

          {/* Global Search */}
          <div ref={gRef} className="topbar-search" style={{ position: 'relative', flex: '0 1 280px' }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input aria-label="ค้นหา... (Ctrl+K)"
              className="form-control"
              style={{ paddingLeft: '2rem', paddingRight: gSearch ? '2rem' : '5.5rem', fontSize: 13, height: 34 }}
              placeholder="ค้นหา... (Ctrl+K)"
              value={gSearch}
              onChange={e => setGSearch(e.target.value)}
              onFocus={() => setGFocus(true)}
              onKeyDown={handleGSearchKeyDown}
              role="combobox"
              aria-expanded={gFocus && gResults.length > 0}
              aria-haspopup="listbox"
              aria-autocomplete="list"
              aria-activedescendant={gActiveIdx >= 0 ? `gsearch-${gActiveIdx}` : undefined}
            />
            {gSearch ? (
              <button onClick={() => { setGSearch(''); setGFocus(false); }} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2, display: 'flex' }}>
                <X size={13} />
              </button>
            ) : (
              <>
              <CameraScanButton variant="inline" right={40} onScan={value => { setGSearch(value); setGFocus(true); }} />
              <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 10, color: 'var(--text-muted)', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 4, padding: '1px 5px', pointerEvents: 'none' }}>⌘K</span>
              </>
            )}
            {gFocus && gDebounced.trim().length >= 2 && gResults.length === 0 && (
              <div role="status" style={{
                position: 'absolute', top: '110%', left: 0, right: 0, zIndex: 1200, padding: '10px 14px', fontSize: 12,
                background: 'var(--bg-secondary)', border: '1px solid var(--border-color-strong)', borderRadius: 10, boxShadow: 'var(--shadow-lg)', color: 'var(--text-muted)',
              }}>
                ไม่พบ "{gDebounced.trim()}" ในหุ่นยนต์ ลูกค้า หรือใบงานซ่อม — ค้นหาอะไหล่/เอกสารได้ในหน้านั้น ๆ
              </div>
            )}
            {gFocus && gResults.length > 0 && (
              <div role="listbox" style={{
                position: 'absolute', top: '110%', left: 0, right: 0, zIndex: 1200,
                background: 'var(--bg-secondary)', border: '1px solid var(--border-color-strong)',
                borderRadius: 10, boxShadow: 'var(--shadow-lg)', overflow: 'hidden',
              }}>
                {gResults.map((r, i) => (
                  <button key={i} id={`gsearch-${i}`} role="option" aria-selected={i === gActiveIdx} onClick={() => { navigate(r.path); setGSearch(''); setGFocus(false); }} style={{
                    display: 'flex', flexDirection: 'column', gap: 2, padding: '9px 14px', width: '100%',
                    textAlign: 'left', background: i === gActiveIdx ? 'var(--accent-subtle)' : 'none', border: 'none', cursor: 'pointer',
                    borderBottom: i < gResults.length - 1 ? '1px solid var(--border-color)' : 'none',
                  }}
                    onMouseEnter={e => { (e.currentTarget.style.background = 'var(--accent-subtle)'); setGActiveIdx(i); }}
                    onMouseLeave={e => { if (i !== gActiveIdx) e.currentTarget.style.background = 'none'; }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{r.label}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{r.sub}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="topbar-actions" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {/* Theme Picker */}
            <div ref={themeRef} style={{ position: 'relative' }}>
              <button
                className="btn btn-ghost"
                onClick={() => setThemeOpen(o => !o)}
                title="เปลี่ยนธีมสี"
                style={{ padding: '0.3rem 0.5rem' }}
              >
                <Palette size={16} />
              </button>
              {themeOpen && (
                <div style={{
                  position: 'absolute', right: 0, top: '110%', zIndex: 999,
                  background: 'var(--bg-secondary)', border: '1px solid var(--border-color-strong)',
                  borderRadius: 12, padding: 12, boxShadow: 'var(--shadow-lg)',
                  minWidth: 200,
                }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.8 }}>ธีมสี</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {THEMES.map(t => (
                      <button
                        key={t.id}
                        onClick={() => { setTheme(t.id); setThemeOpen(false); }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '7px 10px', borderRadius: 8, border: 'none',
                          background: themeId === t.id ? 'var(--accent-subtle)' : 'transparent',
                          cursor: 'pointer', width: '100%', textAlign: 'left',
                          outline: themeId === t.id ? '2px solid var(--accent-primary)' : 'none',
                        }}
                      >
                        <span style={{
                          display: 'inline-flex', gap: 3, flexShrink: 0,
                        }}>
                          <span style={{ width: 14, height: 14, borderRadius: '50%', background: t.sidebar, display: 'inline-block', border: '2px solid rgba(0,0,0,0.1)' }} />
                          <span style={{ width: 14, height: 14, borderRadius: '50%', background: t.accent, display: 'inline-block', border: '2px solid rgba(0,0,0,0.1)' }} />
                        </span>
                        <span style={{ fontSize: 13, fontWeight: themeId === t.id ? 600 : 400, color: 'var(--text-primary)' }}>{t.name}</span>
                        {themeId === t.id && <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--accent-primary)' }}>✓</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <span className="badge info pill" style={{ fontSize: '0.68rem' }}>{user?.role}</span>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', fontWeight: 500 }}>{user?.username}</span>

            {/* Notification Bell */}
            <div ref={notifRef} style={{ position: 'relative' }}>
              <button className="btn btn-ghost" onClick={() => { setNotifOpen(o => !o); if (!notifOpen) fetchNotifs(); }} title="การแจ้งเตือน" aria-label={`การแจ้งเตือน${unreadCount > 0 ? ` (ยังไม่ได้อ่าน ${unreadCount} รายการ)` : ''}`} aria-expanded={notifOpen} aria-haspopup="menu" style={{ position: 'relative', padding: '0.3rem 0.5rem' }}>
                <Bell size={16} />
                {unreadCount > 0 && (
                  <span aria-hidden="true" style={{ position: 'absolute', top: 1, right: 1, minWidth: 16, height: 16, borderRadius: '50%', background: 'var(--status-danger)', color: 'var(--text-on-accent)', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px', lineHeight: 1 }}>{unreadCount > 9 ? '9+' : unreadCount}</span>
                )}
              </button>
              {notifOpen && (
                <div role="menu" aria-live="polite" style={{ position: 'absolute', right: 0, top: '110%', zIndex: 1300, width: 340, maxHeight: 420, overflowY: 'auto', background: 'var(--bg-secondary)', border: '1px solid var(--border-color-strong)', borderRadius: 12, boxShadow: 'var(--shadow-lg)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px 8px', borderBottom: '1px solid var(--border-color)', position: 'sticky', top: 0, background: 'var(--bg-secondary)' }}>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>การแจ้งเตือน {unreadCount > 0 && <span style={{ background: 'var(--status-danger)', color: 'var(--text-on-accent)', borderRadius: 9, padding: '1px 6px', fontSize: 10, marginLeft: 4 }}>{unreadCount}</span>}</span>
                    {unreadCount > 0 && <button onClick={markAllRead} disabled={markingAll} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--accent-primary)', fontWeight: 600 }}>อ่านทั้งหมด</button>}
                  </div>
                  {notifError && (
                    <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', fontSize: 12, color: 'var(--status-danger)', borderBottom: '1px solid var(--border-color)' }}>
                      โหลดการแจ้งเตือนไม่สำเร็จ
                      <button type="button" className="btn btn-outline btn-sm" style={{ marginLeft: 'auto' }} onClick={() => void fetchNotifs()}>ลองใหม่</button>
                    </div>
                  )}
                  {notifs.length === 0 && !notifError && <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>ไม่มีการแจ้งเตือน</div>}
                  {notifs.map(n => (
                    <button key={n.id} type="button" onClick={() => openNotif(n)} title={notifPath(n) ? 'เปิดรายการนี้' : undefined} style={{ display: 'flex', gap: 10, padding: '10px 14px', cursor: 'pointer', background: n.read ? 'transparent' : 'var(--accent-subtle)', borderBottom: '1px solid var(--border-color)', transition: 'background .15s', width: '100%', textAlign: 'left', border: 'none', borderLeft: 'none', borderRight: 'none', borderTop: 'none', font: 'inherit', color: 'inherit' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-tertiary)'}
                      onMouseLeave={e => e.currentTarget.style.background = n.read ? 'transparent' : 'var(--accent-subtle)'}
                    >
                      <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>{notifIcon[n.type] || 'ℹ️'}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: n.read ? 400 : 600, color: 'var(--text-primary)', marginBottom: 2 }}>{n.title}</div>
                        {n.body && <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.body}</div>}
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{formatThaiDateTime(n.createdAt)}</div>
                      </div>
                      {!n.read && <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent-primary)', flexShrink: 0, marginTop: 4 }} />}
                      {notifPath(n) && <ChevronRight size={14} style={{ flexShrink: 0, marginTop: 2, color: 'var(--text-muted)' }} aria-hidden="true" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button onClick={handleLogout} className="btn btn-ghost" title="ออกจากระบบ">
              <LogOut size={16} />
            </button>
          </div>
        </header>

        <section className="page-content animate-fade-in">
          <ErrorBoundary resetKey={location.pathname}>
            <Outlet />
          </ErrorBoundary>
          <OfflineBanner />
        </section>
      </main>
    </div>
  );
};
