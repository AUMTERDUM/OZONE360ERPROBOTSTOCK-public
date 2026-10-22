import React, { useEffect, useMemo, useState } from 'react';
import { mascotForModel, type MascotRobot } from '../utils/mascots';
import RobotMascot from '../components/RobotMascot';
import MascotLoader from '../components/MascotLoader';
import { useParams } from 'react-router-dom';
import { Bot, Wrench, Truck, AlertCircle, Clock, CheckCircle, Send, ChevronDown, ChevronUp, Plus } from 'lucide-react';
import axios from 'axios';
import { formatThaiDate } from '../utils/thaiDate';
import { ticketStatusLabels, maVisitStatusLabels, robotStatusLabels, priorityLabels } from '../utils/statusLabels';
import { formatTicketNo } from '../utils/displayText';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

/* ── Types ───────────────────────────────────────────────────────────────────── */
interface RobotModel { id: string; name: string; type: string }
interface Robot { id: string; serialNumber: string; status: string; purchaseDate: string | null; warrantyExpiresAt: string | null; model: RobotModel | null }
interface Ticket { id: string; status: string; reportDate: string; issueDescription: string; resolution: string | null; priorityLevel: string; robotId: string; slaDueAt: string | null; slaBreachedAt: string | null }
interface DeliveryNote { id: string; docNumber: string; deliveryDate: string; status: string; trackingNumber: string | null; installedAt: string | null; acceptedAt: string | null }
interface MAVisit { id: string; visitNumber: number; scheduledDate: string; status: string; technician: string | null; summary: string | null }

type PortalBadgeTone = { label: string; color: string; bg: string; border: string };

const ROBOT_STATUS_CONFIG: Record<string, PortalBadgeTone> = {
  Active: { label: 'ใช้งานอยู่', color: '#047857', bg: '#d1fae5', border: '#10b981' },
  'In Maintenance': { label: robotStatusLabels['In Maintenance'], color: '#b45309', bg: '#fef3c7', border: '#f59e0b' },
  Inactive: { label: 'ไม่ใช้งาน', color: '#475569', bg: '#e2e8f0', border: '#94a3b8' },
};

const TICKET_STATUS_CONFIG: Record<string, PortalBadgeTone> = {
  Pending: { label: ticketStatusLabels.Pending, color: '#b45309', bg: '#fef3c7', border: '#f59e0b' },
  'In Progress': { label: 'กำลังซ่อม', color: '#1d4ed8', bg: '#dbeafe', border: '#60a5fa' },
  'Waiting Quotation': { label: 'รอใบเสนอราคา', color: '#6d28d9', bg: '#ede9fe', border: '#a78bfa' },
  'Ready to Ship': { label: 'พร้อมส่ง', color: '#0f766e', bg: '#ccfbf1', border: '#2dd4bf' },
  Completed: { label: 'เสร็จสิ้น', color: '#047857', bg: '#d1fae5', border: '#10b981' },
  Cancelled: { label: 'ยกเลิก', color: '#b91c1c', bg: '#fee2e2', border: '#f87171' },
};

const DELIVERY_STATUS_CONFIG: Record<string, PortalBadgeTone> = {
  Pending: { label: 'รอดำเนินการ', color: '#b45309', bg: '#fef3c7', border: '#f59e0b' },
  Packed: { label: 'แพ็คแล้ว', color: '#0f766e', bg: '#ccfbf1', border: '#2dd4bf' },
  'In Transit': { label: 'กำลังจัดส่ง', color: '#0f766e', bg: '#ccfbf1', border: '#2dd4bf' },
  Delivered: { label: 'ส่งถึงแล้ว', color: '#047857', bg: '#d1fae5', border: '#10b981' },
  Accepted: { label: 'ตรวจรับแล้ว', color: '#047857', bg: '#d1fae5', border: '#10b981' },
  Invoiced: { label: 'ส่งของสำเร็จ', color: '#047857', bg: '#d1fae5', border: '#10b981' },
};

/* ── Helpers ──────────────────────────────────────────────────────────────────── */
function formatDate(d: string | null) {
  if (!d) return '-';
  return formatThaiDate(d);
}

function StatusBadge({ label, color, bg, border }: { label: string; color: string; bg: string; border: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '2px 10px',
      borderRadius: 99,
      fontSize: '0.72rem',
      fontWeight: 600,
      color,
      background: bg,
      border: `1px solid ${border}`,
    }}>
      {label}
    </span>
  );
}

/* ── Main Component ──────────────────────────────────────────────────────────── */
export default function CustomerPortal() {
  const { token } = useParams<{ token: string }>();

  const [customerName, setCustomerName] = useState('');
  const [robots, setRobots] = useState<Robot[]>([]);
  // One cartoon per distinct model the customer owns (max 5), for the portal header.
  const lineup = useMemo(
    () => [...new Set(robots.map(r => mascotForModel(r.model?.name)).filter((m): m is MascotRobot => !!m))].slice(0, 5),
    [robots],
  );
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [deliveryNotes, setDeliveryNotes] = useState<DeliveryNote[]>([]);
  const [maVisits, setMaVisits] = useState<MAVisit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // New-ticket form
  const [showForm, setShowForm] = useState(false);
  const [formRobotId, setFormRobotId] = useState('');
  const [formIssue, setFormIssue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState('');

  // Active tab
  const [tab, setTab] = useState<'robots' | 'tickets' | 'ma' | 'delivery'>('robots');

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const [robotsRes, ticketsRes, visitsRes, dnRes] = await Promise.all([
          axios.get(`${API_BASE}/portal/${token}/robots`),
          axios.get(`${API_BASE}/portal/${token}/tickets`),
          axios.get(`${API_BASE}/portal/${token}/ma-visits`),
          axios.get(`${API_BASE}/portal/${token}/delivery-notes`),
        ]);
        setCustomerName(robotsRes.data.customer.name);
        setRobots(robotsRes.data.robots);
        setTickets(ticketsRes.data);
        setMaVisits(visitsRes.data);
        setDeliveryNotes(dnRes.data);
      } catch (err: any) {
        if (err.response?.status === 404) setError('ลิงก์ไม่ถูกต้อง หรือหมดอายุ');
        else setError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองใหม่อีกครั้ง');
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const handleSubmitTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formRobotId || !formIssue.trim()) return;
    setSubmitting(true);
    setSubmitMsg('');
    try {
      const res = await axios.post(`${API_BASE}/portal/${token}/tickets`, {
        robotId: formRobotId,
        issueDescription: formIssue.trim(),
      });
      setSubmitMsg(`แจ้งซ่อมสำเร็จ — เลขที่ ${res.data.id.slice(0, 8).toUpperCase()}`);
      setFormRobotId('');
      setFormIssue('');
      setShowForm(false);
      setTab('tickets');
      // The ticket is already created; a failed list refresh must not report the submit as failed.
      axios.get(`${API_BASE}/portal/${token}/tickets`).then(r => setTickets(r.data)).catch(() => {});
    } catch {
      setSubmitMsg('ไม่สามารถแจ้งซ่อมได้ กรุณาลองใหม่');
    } finally {
      setSubmitting(false);
    }
  };

  /* ── Render ─────────────────────────────────────────────────────────────────── */
  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #1e3a8a 0%, #1e40af 50%, #1d4ed8 100%)',
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'center',
      paddingTop: '2rem',
      paddingBottom: '3rem',
      fontFamily: "'Prompt', sans-serif",
    }}>
      <div style={{ width: '100%', maxWidth: 960, padding: '0 1rem' }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <img
            src="/ozone360-logo-real.png"
            alt="Ozone360"
            style={{ height: 52, marginBottom: '0.5rem', filter: 'brightness(0) invert(1)' }}
            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
          <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.85rem', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            พอร์ทัลลูกค้า
          </div>
          {customerName && (
            <div style={{ color: '#fff', fontWeight: 700, fontSize: '1.3rem', marginTop: 4 }}>
              {customerName}
            </div>
          )}
          {lineup.length > 0 && (
            <div aria-hidden="true" style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-end', gap: 4, marginTop: 10, flexWrap: 'wrap' }}>
              {lineup.map((robot, i) => (
                <RobotMascot key={robot} robot={robot} size={72} animation="float" style={{ animationDelay: `${i * 0.4}s` }} />
              ))}
            </div>
          )}
        </div>

        {/* Loading */}
        {loading && (
          <div style={{ background: '#fff', borderRadius: 16, padding: '1rem', color: '#3b5ca8' }}>
            <MascotLoader label="กำลังโหลดข้อมูล..." minHeight={180} />
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ background: '#fff', borderRadius: 16, padding: '2.5rem', textAlign: 'center' }}>
            <AlertCircle size={40} color="#dc2626" style={{ marginBottom: 12 }} />
            <div style={{ color: '#dc2626', fontWeight: 600 }}>{error}</div>
            <div style={{ color: '#5a6b94', fontSize: '0.85rem', marginTop: 8 }}>กรุณาตรวจสอบลิงก์อีกครั้ง หรือติดต่อเจ้าหน้าที่</div>
          </div>
        )}

        {/* Content */}
        {!loading && !error && (
          <>
            {/* Summary Cards */}
            <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
              {([
                { icon: <Bot size={20} />, label: 'หุ่นยนต์', count: robots.length, color: '#3b82f6' },
                { icon: <Wrench size={20} />, label: 'ใบแจ้งซ่อม', count: tickets.length, color: '#f59e0b' },
                { icon: <Truck size={20} />, label: 'ใบส่งของ', count: deliveryNotes.length, color: '#10b981' },
              ]).map(card => (
                <div key={card.label} style={{
                  flex: '1 1 140px',
                  background: 'rgba(255,255,255,0.15)',
                  borderRadius: 12,
                  padding: '0.85rem 1rem',
                  backdropFilter: 'blur(4px)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: 10,
                    background: card.color,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff',
                  }}>
                    {card.icon}
                  </div>
                  <div>
                    <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#fff', lineHeight: 1 }}>{card.count}</div>
                    <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.7)' }}>{card.label}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* New Ticket Button */}
            <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                onClick={() => setShowForm(v => !v)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '0.6rem 1.2rem',
                  background: '#f59e0b',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 10,
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                }}
              >
                {showForm ? <ChevronUp size={16} /> : <Plus size={16} />}
                {showForm ? 'ปิดฟอร์ม' : 'แจ้งซ่อมหุ่นยนต์'}
              </button>
              {submitMsg && (
                <span style={{
                  fontSize: '0.82rem',
                  fontWeight: 500,
                  color: submitMsg.includes('สำเร็จ') ? '#bbf7d0' : '#fca5a5',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                }}>
                  {submitMsg.includes('สำเร็จ') && <RobotMascot scene="reportSent" size={48} />}
                  {submitMsg}
                </span>
              )}
            </div>

            {/* New-Ticket Form */}
            {showForm && (
              <div style={{
                background: '#fff',
                borderRadius: 14,
                padding: '1.25rem 1.5rem',
                marginBottom: '1rem',
                boxShadow: '0 8px 30px rgba(0,0,0,0.15)',
              }}>
                <form onSubmit={handleSubmitTicket} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#1e3a8a', display: 'block', marginBottom: 4 }} htmlFor="customerportal-formRobotId">
                      เลือกหุ่นยนต์
                    </label>
                    <select id="customerportal-formRobotId"
                      value={formRobotId}
                      onChange={e => setFormRobotId(e.target.value)}
                      required
                      style={{
                        width: '100%', padding: '0.5rem 0.75rem',
                        borderRadius: 8, border: '1px solid #cbd5e1',
                        fontSize: '0.85rem', color: '#1e3a8a',
                      }}
                    >
                      <option value="">-- เลือกหุ่นยนต์ --</option>
                      {robots.map(r => (
                        <option key={r.id} value={r.id}>
                          {r.serialNumber} — {r.model?.name || 'ไม่มีข้อมูล'}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#1e3a8a', display: 'block', marginBottom: 4 }} htmlFor="customerportal-formIssue">
                      อาการ / ปัญหาที่พบ
                    </label>
                    <textarea id="customerportal-formIssue"
                      value={formIssue}
                      onChange={e => setFormIssue(e.target.value)}
                      required
                      rows={3}
                      placeholder="อธิบายอาการของหุ่นยนต์..."
                      style={{
                        width: '100%', padding: '0.5rem 0.75rem',
                        borderRadius: 8, border: '1px solid #cbd5e1',
                        fontSize: '0.85rem', resize: 'vertical',
                        fontFamily: 'inherit',
                      }}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={submitting}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      padding: '0.6rem',
                      background: submitting ? '#94a3b8' : '#1e40af',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 10,
                      fontWeight: 600,
                      fontSize: '0.85rem',
                      cursor: submitting ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <Send size={15} />
                    {submitting ? 'กำลังส่ง...' : 'ส่งแจ้งซ่อม'}
                  </button>
                </form>
              </div>
            )}

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 4, marginBottom: '0.75rem' }}>
              {([
                { key: 'robots' as const, label: 'หุ่นยนต์', icon: <Bot size={15} /> },
                { key: 'tickets' as const, label: 'ใบแจ้งซ่อม', icon: <Wrench size={15} /> },
                { key: 'ma' as const, label: 'ตาราง MA', icon: <Clock size={15} /> },
                { key: 'delivery' as const, label: 'ใบส่งของ', icon: <Truck size={15} /> },
              ]).map(t => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    padding: '0.5rem 1rem',
                    borderRadius: '10px 10px 0 0',
                    border: 'none',
                    fontWeight: 600,
                    fontSize: '0.82rem',
                    cursor: 'pointer',
                    background: tab === t.key ? '#fff' : 'rgba(255,255,255,0.2)',
                    color: tab === t.key ? '#1e3a8a' : 'rgba(255,255,255,0.8)',
                  }}
                >
                  {t.icon} {t.label}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            <div style={{
              background: '#fff',
              borderRadius: '0 14px 14px 14px',
              boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
              overflow: 'hidden',
            }}>

              {/* Robots Tab */}
              {tab === 'robots' && (
                <div style={{ padding: '1rem 1.25rem' }}>
                  {robots.length === 0 ? (
                    <div style={{ textAlign: 'center', color: '#94a3b8', padding: '2rem 0' }}>ยังไม่มีหุ่นยนต์</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                      {robots.map(r => (
                        <div key={r.id} style={{
                          display: 'flex', alignItems: 'center', gap: 12,
                          padding: '0.75rem 1rem',
                          background: '#f8fafc',
                          borderRadius: 10,
                          border: '1px solid #e2e8f0',
                        }}>
                          <Bot size={22} color="#3b82f6" style={{ flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 700, color: '#1e3a8a', fontSize: '0.9rem' }}>
                              {r.serialNumber}
                            </div>
                            <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                              {r.model?.name || '-'} • {r.model?.type || '-'}
                            </div>
                          </div>
                          <div style={{ textAlign: 'right', flexShrink: 0 }}>
                            <StatusBadge
                              {...(ROBOT_STATUS_CONFIG[r.status] || { label: r.status, color: '#475569', bg: '#e2e8f0', border: '#94a3b8' })}
                            />
                            {r.warrantyExpiresAt && (
                              <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: 2 }}>
                                ประกัน: {formatDate(r.warrantyExpiresAt)}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Tickets Tab */}
              {tab === 'tickets' && (
                <div style={{ padding: '1rem 1.25rem' }}>
                  {tickets.length === 0 ? (
                    <div style={{ textAlign: 'center', color: '#94a3b8', padding: '2rem 0' }}>ยังไม่มีใบแจ้งซ่อม</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                      {tickets.map(t => {
                        const robot = robots.find(r => r.id === t.robotId);
                        return (
                          <TicketCard key={t.id} ticket={t} robotSN={robot?.serialNumber} />
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* MA Visits Tab */}
              {tab === 'ma' && (
                <div style={{ padding: '1rem 1.25rem' }}>
                  <div style={{ color: '#64748b', fontSize: '0.78rem', marginBottom: 10 }}>แสดงรายการย้อนหลัง 12 เดือน และล่วงหน้า 6 เดือน</div>
                  {maVisits.length === 0 ? (
                    <div style={{ textAlign: 'center', color: '#94a3b8', padding: '2rem 0' }}>ยังไม่มีรายการเข้าบำรุงรักษา</div>
                  ) : maVisits.map(v => (
                    <div key={v.id} style={{ padding: '0.75rem 1rem', marginBottom: 8, background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                        <strong style={{ color: '#1e3a8a' }}>ครั้งที่ {v.visitNumber}</strong>
                        <StatusBadge {...({ label: maVisitStatusLabels[v.status] ?? v.status, color: '#1d4ed8', bg: '#dbeafe', border: '#60a5fa' })} />
                      </div>
                      <div style={{ color: '#475569', fontSize: '0.82rem', marginTop: 5 }}>{formatDate(v.scheduledDate)} · ช่าง: {v.technician || '-'}</div>
                      {v.summary && <div style={{ color: '#64748b', fontSize: '0.8rem', marginTop: 4 }}>{v.summary}</div>}
                    </div>
                  ))}
                </div>
              )}

              {/* Delivery Notes Tab */}
              {tab === 'delivery' && (
                <div style={{ padding: '1rem 1.25rem' }}>
                  {deliveryNotes.length === 0 ? (
                    <div style={{ textAlign: 'center', color: '#94a3b8', padding: '2rem 0' }}>ยังไม่มีใบส่งของ</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                      {deliveryNotes.map(dn => (
                        <div key={dn.id} style={{
                          padding: '0.75rem 1rem',
                          background: '#f8fafc',
                          borderRadius: 10,
                          border: '1px solid #e2e8f0',
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                            <div>
                              <div style={{ fontWeight: 700, color: '#1e3a8a', fontSize: '0.9rem' }}>
                                {dn.docNumber}
                              </div>
                              <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                                วันที่ส่ง: {formatDate(dn.deliveryDate)}
                              </div>
                            </div>
                            <StatusBadge
                              {...(DELIVERY_STATUS_CONFIG[dn.status] || { label: dn.status, color: '#475569', bg: '#e2e8f0', border: '#94a3b8' })}
                            />
                          </div>
                          {dn.trackingNumber && (
                            <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 4 }}>
                              เลขพัสดุ: {dn.trackingNumber}
                            </div>
                          )}
                          <div style={{ display: 'flex', gap: '1rem', marginTop: 4, fontSize: '0.72rem', color: '#94a3b8' }}>
                            {dn.installedAt && <span>ติดตั้ง: {formatDate(dn.installedAt)}</span>}
                            {dn.acceptedAt && <span>ตรวจรับ: {formatDate(dn.acceptedAt)}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Contact / Footer */}
            <div style={{
              marginTop: '1.25rem',
              background: 'rgba(255,255,255,0.12)',
              borderRadius: 12,
              padding: '0.85rem 1.25rem',
              backdropFilter: 'blur(4px)',
            }}>
              <div style={{ fontWeight: 700, color: '#fff', fontSize: '0.82rem', marginBottom: '0.5rem' }}>
                ติดต่อทีมงาน
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {([
                  { href: 'tel:0800000000', label: '📞 080-000-0000' },
                  { href: 'tel:052000634', label: '📞 052-000-634' },
                  { href: 'mailto:sales@example.com', label: '✉️ Email' },
                  { href: 'https://line.me/R/ti/p/@example', label: '💬 LINE: @example', external: true },
                ] as { href: string; label: string; external?: boolean }[]).map(item => (
                  <a
                    key={item.href}
                    href={item.href}
                    target={item.external ? '_blank' : undefined}
                    rel={item.external ? 'noopener noreferrer' : undefined}
                    style={{
                      padding: '0.4rem 0.8rem',
                      background: 'rgba(255,255,255,0.9)',
                      borderRadius: 8,
                      color: '#1e3a8a',
                      textDecoration: 'none',
                      fontSize: '0.75rem',
                      fontWeight: 500,
                    }}
                  >
                    {item.label}
                  </a>
                ))}
              </div>
            </div>

            <div style={{ textAlign: 'center', fontSize: '0.68rem', color: 'rgba(255,255,255,0.4)', marginTop: '0.75rem' }}>
              Ozone360 ERP — Customer Portal
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Ticket Card (expandable) ───────────────────────────────────────────────── */
function TicketCard({ ticket, robotSN }: { ticket: Ticket; robotSN?: string }) {
  const [expanded, setExpanded] = useState(false);
  const statusCfg = TICKET_STATUS_CONFIG[ticket.status] || { label: ticket.status, color: '#475569', bg: '#e2e8f0', border: '#94a3b8' };

  return (
    <div style={{
      padding: '0.75rem 1rem',
      background: '#f8fafc',
      borderRadius: 10,
      border: '1px solid #e2e8f0',
      cursor: 'pointer',
    }}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      onClick={() => setExpanded(v => !v)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(v => !v); } }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontWeight: 700, color: '#1e3a8a', fontSize: '0.85rem' }}>
              {formatTicketNo(ticket.id)}
            </span>
            <StatusBadge {...statusCfg} />
          </div>
          <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: 2 }}>
            {robotSN && <span>SN: {robotSN} • </span>}
            {formatDate(ticket.reportDate)}
          </div>
        </div>
        {expanded ? <ChevronUp size={16} color="#94a3b8" /> : <ChevronDown size={16} color="#94a3b8" />}
      </div>
      {expanded && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '0.8rem', color: '#1e3a8a', marginBottom: 4 }}>
            <strong>ปัญหา:</strong> {ticket.issueDescription}
          </div>
          {ticket.resolution && (
            <div style={{ fontSize: '0.8rem', color: '#059669' }}>
              <strong>ผลการซ่อม:</strong> {ticket.resolution}
            </div>
          )}
          {ticket.priorityLevel && ticket.priorityLevel !== 'Normal' && (
            <div style={{ fontSize: '0.72rem', color: '#d97706', marginTop: 4 }}>
              ความเร่งด่วน: {priorityLabels[ticket.priorityLevel] ?? ticket.priorityLevel}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
