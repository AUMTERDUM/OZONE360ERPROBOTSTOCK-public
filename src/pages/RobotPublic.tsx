import React, { useEffect, useState } from 'react';
import RobotMascot from '../components/RobotMascot';
import MascotLoader from '../components/MascotLoader';
import { useParams } from 'react-router-dom';
import { Bot, AlertCircle, CheckCircle, Wrench, User, Calendar, ShieldCheck, Send, MessageCircle } from 'lucide-react';
import axios from 'axios';
import { formatThaiDate } from '../utils/thaiDate';
import { robotStatusLabels, ticketStatusLabels } from '../utils/statusLabels';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

interface RobotPublicData {
  id: string;
  serialNumber: string;
  model: string;
  type: string;
  status: string;
  purchaseDate: string;
  warrantyExpiresAt: string | null;
  customer: { name: string } | null;
  location: string | null;
  recentTickets: {
    id: string;
    status: string;
    reportDate: string;
    issueDescription: string;
    resolution: string | null;
  }[];
}

const STATUS_COLOR: Record<string, string> = {
  'In Stock': '#059669',
  'Assigned': '#1e40af',
  'In Maintenance': '#d97706',
};
const STATUS_LABEL = robotStatusLabels;
const TICKET_STATUS_LABEL = ticketStatusLabels;
const TICKET_STATUS_COLOR: Record<string, string> = {
  Pending: '#d97706',
  'Waiting Quotation': '#7c3aed',
  'In Progress': '#1e40af',
  'Ready to Ship': '#0891b2',
  Completed: '#059669',
};

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 0', borderBottom: '1px solid #eef2fb', fontSize: '0.85rem' }}>
      <span style={{ color: '#5a6b94', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ color: '#1e3a8a', fontWeight: 600, textAlign: 'right' }}>{value}</span>
    </div>
  );
}

export default function RobotPublic() {
  const { sn } = useParams<{ sn: string }>();
  const [data, setData] = useState<RobotPublicData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Report-issue form
  const [showReport, setShowReport] = useState(false);
  const [issueText, setIssueText] = useState('');
  const [reporterName, setReporterName] = useState('');
  const [reporterPhone, setReporterPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!sn) return;
    axios
      .get(`${API_BASE}/robots/public/${encodeURIComponent(sn)}`)
      .then((r: { data: RobotPublicData }) => { setData(r.data); setLoading(false); })
      .catch((err: any) => {
        if (err.response?.status === 404) setError('ไม่พบข้อมูลหุ่นยนต์นี้ในระบบ');
        else setError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองใหม่อีกครั้ง');
        setLoading(false);
      });
  }, [sn]);


  const [trackToken, setTrackToken] = useState<string | null>(null);
  const handleSubmitIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sn || !issueText.trim()) return;
    setSubmitting(true);
    setSubmitMsg(null);
    try {
      const res = await axios.post(`${API_BASE}/robots/public/${encodeURIComponent(sn)}/report`, {
        issueDescription: issueText.trim(),
        reporterName: reporterName.trim() || undefined,
        reporterPhone: reporterPhone.trim() || undefined,
      });
      setSubmitMsg({ ok: true, text: `แจ้งซ่อมสำเร็จ — เลขที่ ${(res.data.id as string).slice(0, 8).toUpperCase()}` });
      setIssueText('');
      setReporterName('');
      setReporterPhone('');
      setShowReport(false);
      if (res.data.trackingToken) setTrackToken(res.data.trackingToken);
      // Refresh robot data to show new ticket. The ticket already exists, so a failed refresh must
      // not turn the success message into "could not report" (people would report twice).
      axios.get(`${API_BASE}/robots/public/${encodeURIComponent(sn)}`).then(r => setData(r.data)).catch(() => {});
    } catch (err: any) {
      const msg = err.response?.data?.error || 'ไม่สามารถแจ้งซ่อมได้ กรุณาลองใหม่อีกครั้ง';
      setSubmitMsg({ ok: false, text: msg });
    } finally {
      setSubmitting(false);
    }
  };

  const statusColor = data ? (STATUS_COLOR[data.status] ?? '#6b7280') : '#1e3a8a';

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
      <div style={{ width: '100%', maxWidth: 560, padding: '0 1rem' }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <img
            src="/ozone360-logo-real.png"
            alt="Ozone360"
            style={{ height: 52, marginBottom: '0.5rem', filter: 'brightness(0) invert(1)' }}
            onError={(e: React.SyntheticEvent<HTMLImageElement>) => { e.currentTarget.style.display = 'none'; }}
          />
          <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.85rem', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            ข้อมูลหุ่นยนต์
          </div>
        </div>

        {loading && (
          <div style={{ background: '#fff', borderRadius: 16, padding: '1rem', color: '#3b5ca8' }}>
            <MascotLoader label="กำลังโหลดข้อมูล..." minHeight={180} />
          </div>
        )}

        {error && (
          <div style={{ background: '#fff', borderRadius: 16, padding: '2.5rem', textAlign: 'center' }}>
            <AlertCircle size={40} color="#dc2626" style={{ marginBottom: 12 }} />
            <div style={{ color: '#dc2626', fontWeight: 600 }}>{error}</div>
            <div style={{ color: '#5a6b94', fontSize: '0.85rem', marginTop: 8 }}>
              กรุณาตรวจสอบ QR Code หรือติดต่อเจ้าหน้าที่
            </div>
          </div>
        )}

        {data && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

            {/* ── Status Banner ── */}
            <div style={{ background: '#fff', borderRadius: 16, overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
              <div style={{ background: statusColor, padding: '1.25rem 1.5rem', display: 'flex', alignItems: 'center', gap: 12 }}>
                <Bot size={28} color="#fff" />
                <div>
                  <div style={{ color: '#fff', fontWeight: 700, fontSize: '1.2rem', fontVariantNumeric: 'tabular-nums', letterSpacing: '0.05em' }}>
                    {data.serialNumber}
                  </div>
                  <div style={{ color: 'rgba(255,255,255,0.85)', fontSize: '0.85rem' }}>
                    {data.model} · {data.type}
                  </div>
                </div>
                <div style={{ marginLeft: 'auto', background: 'rgba(255,255,255,0.2)', borderRadius: 20, padding: '4px 14px', fontSize: '0.8rem', color: '#fff', fontWeight: 600 }}>
                  {STATUS_LABEL[data.status] ?? data.status}
                </div>
              </div>

              {/* Robot Details */}
              <div style={{ padding: '1.25rem 1.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <Bot size={16} color="#1e3a8a" />
                  <span style={{ fontWeight: 600, color: '#1e3a8a', fontSize: '0.88rem' }}>รายละเอียดหุ่นยนต์</span>
                </div>
                <InfoRow label="หมายเลขซีเรียล" value={data.serialNumber} />
                <InfoRow label="รุ่น" value={data.model} />
                <InfoRow label="ประเภท" value={data.type} />
                <InfoRow label="วันนำเข้า" value={formatThaiDate(data.purchaseDate, { year: 'numeric', month: 'long', day: 'numeric' })} />
                {data.warrantyExpiresAt && (
                  <InfoRow
                    label="รับประกันถึง"
                    value={formatThaiDate(data.warrantyExpiresAt, { year: 'numeric', month: 'long', day: 'numeric' })}
                  />
                )}
                {data.location && <InfoRow label="ที่ตั้ง" value={data.location} />}
              </div>
            </div>

            {/* ── Customer ── */}
            {data.customer && (
              <div style={{ background: '#fff', borderRadius: 16, padding: '1.25rem 1.5rem', boxShadow: '0 8px 32px rgba(0,0,0,0.15)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <User size={16} color="#1e3a8a" />
                  <span style={{ fontWeight: 600, color: '#1e3a8a', fontSize: '0.88rem' }}>ข้อมูลลูกค้า</span>
                </div>
                <InfoRow label="ชื่อ" value={data.customer.name} />
              </div>
            )}

            {/* ── Recent Tickets ── */}
            {data.recentTickets.length > 0 && (
              <div style={{ background: '#fff', borderRadius: 16, padding: '1.25rem 1.5rem', boxShadow: '0 8px 32px rgba(0,0,0,0.15)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <Wrench size={16} color="#1e3a8a" />
                  <span style={{ fontWeight: 600, color: '#1e3a8a', fontSize: '0.88rem' }}>ประวัติการซ่อมล่าสุด</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {data.recentTickets.map(ticket => {
                    const color = TICKET_STATUS_COLOR[ticket.status] ?? '#6b7280';
                    return (
                      <div
                        key={ticket.id}
                        style={{
                          border: `1px solid ${color}22`,
                          borderLeft: `4px solid ${color}`,
                          borderRadius: 8,
                          padding: '0.75rem 1rem',
                          background: `${color}08`,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <span style={{ fontSize: '0.78rem', fontWeight: 700, color, background: `${color}18`, padding: '2px 10px', borderRadius: 12 }}>
                            {TICKET_STATUS_LABEL[ticket.status] ?? ticket.status}
                          </span>
                          <span style={{ fontSize: '0.75rem', color: '#5a6b94' }}>
                            <Calendar size={11} style={{ verticalAlign: 'middle', marginRight: 3 }} />
                            {formatThaiDate(ticket.reportDate)}
                          </span>
                        </div>
                        <div style={{ fontSize: '0.83rem', color: '#374151', lineHeight: 1.5 }}>{ticket.issueDescription}</div>
                        {ticket.resolution && (
                          <div style={{ fontSize: '0.78rem', color: '#059669', marginTop: 4 }}>
                            <CheckCircle size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                            {ticket.resolution}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {data.recentTickets.length === 0 && (
              <div style={{ background: '#fff', borderRadius: 16, padding: '1.5rem', textAlign: 'center', boxShadow: '0 8px 32px rgba(0,0,0,0.15)' }}>
                <ShieldCheck size={32} color="#059669" style={{ marginBottom: 8 }} />
                <div style={{ color: '#059669', fontWeight: 600 }}>ไม่มีประวัติการซ่อม</div>
                <div style={{ color: '#5a6b94', fontSize: '0.83rem', marginTop: 4 }}>หุ่นยนต์เครื่องนี้ยังไม่เคยเข้ารับการซ่อม</div>
              </div>
            )}

            {/* ── Report Issue (แจ้งปัญหา) — ใครก็แจ้งได้ ── */}
            <div style={{ background: '#fff', borderRadius: 16, overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.15)' }}>
              {!showReport ? (
                <button
                  onClick={() => { setShowReport(true); setSubmitMsg(null); }}
                  style={{
                    width: '100%', padding: '1rem 1.5rem',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                    background: '#dc2626', color: '#fff',
                    border: 'none', borderRadius: 16, cursor: 'pointer',
                    fontWeight: 700, fontSize: '1rem',
                    fontFamily: 'inherit',
                    boxShadow: '0 4px 16px rgba(220,38,38,0.35)',
                  }}
                >
                  <MessageCircle size={20} />
                  แจ้งปัญหา / แจ้งซ่อม
                </button>
              ) : (
                <form onSubmit={handleSubmitIssue} style={{ padding: '1.25rem 1.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <Wrench size={16} color="#dc2626" />
                    <span style={{ fontWeight: 600, color: '#dc2626', fontSize: '0.88rem' }}>แจ้งปัญหาสำหรับ {data.serialNumber}</span>
                  </div>
                  <textarea aria-label="กรุณาอธิบายปัญหาที่พบ เช่น หุ่นยนต์ไม่เคลื่อนที่ หน้าจอค้าง ฯลฯ"
                    value={issueText}
                    onChange={e => setIssueText(e.target.value)}
                    placeholder="กรุณาอธิบายปัญหาที่พบ เช่น หุ่นยนต์ไม่เคลื่อนที่ หน้าจอค้าง ฯลฯ"
                    required
                    rows={4}
                    style={{
                      width: '100%', padding: '0.75rem', borderRadius: 10,
                      border: '1.5px solid #e2e8f0', fontSize: '0.88rem',
                      fontFamily: 'inherit', resize: 'vertical',
                      outline: 'none', boxSizing: 'border-box',
                    }}
                    onFocus={e => { e.currentTarget.style.borderColor = '#dc2626'; }}
                    onBlur={e => { e.currentTarget.style.borderColor = '#e2e8f0'; }}
                  />
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <input aria-label="ชื่อผู้แจ้ง (ไม่บังคับ)"
                      value={reporterName}
                      onChange={e => setReporterName(e.target.value)}
                      placeholder="ชื่อผู้แจ้ง (ไม่บังคับ)"
                      maxLength={100}
                      style={{
                        flex: 1, padding: '0.6rem 0.75rem', borderRadius: 10,
                        border: '1.5px solid #e2e8f0', fontSize: '0.84rem',
                        fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
                      }}
                      onFocus={e => { e.currentTarget.style.borderColor = '#dc2626'; }}
                      onBlur={e => { e.currentTarget.style.borderColor = '#e2e8f0'; }}
                    />
                    <input aria-label="เบอร์โทร (ไม่บังคับ)"
                      value={reporterPhone}
                      onChange={e => setReporterPhone(e.target.value)}
                      placeholder="เบอร์โทร (ไม่บังคับ)"
                      maxLength={20}
                      type="tel"
                      style={{
                        flex: 1, padding: '0.6rem 0.75rem', borderRadius: 10,
                        border: '1.5px solid #e2e8f0', fontSize: '0.84rem',
                        fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
                      }}
                      onFocus={e => { e.currentTarget.style.borderColor = '#dc2626'; }}
                      onBlur={e => { e.currentTarget.style.borderColor = '#e2e8f0'; }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <button
                      type="button"
                      onClick={() => { setShowReport(false); setIssueText(''); setReporterName(''); setReporterPhone(''); }}
                      style={{
                        flex: 1, padding: '0.65rem',
                        background: '#f1f5f9', color: '#64748b',
                        border: 'none', borderRadius: 10, cursor: 'pointer',
                        fontWeight: 600, fontSize: '0.85rem', fontFamily: 'inherit',
                      }}
                    >
                      ยกเลิก
                    </button>
                    <button
                      type="submit"
                      disabled={submitting || !issueText.trim()}
                      style={{
                        flex: 2, padding: '0.65rem',
                        background: submitting ? '#9ca3af' : '#dc2626', color: '#fff',
                        border: 'none', borderRadius: 10, cursor: submitting ? 'not-allowed' : 'pointer',
                        fontWeight: 700, fontSize: '0.85rem', fontFamily: 'inherit',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      }}
                    >
                      <Send size={14} />
                      {submitting ? 'กำลังส่ง...' : 'ส่งแจ้งซ่อม'}
                    </button>
                  </div>
                </form>
              )}
            </div>

            {/* Submit result message */}
            {submitMsg && (
              <div style={{
                background: submitMsg.ok ? '#ecfdf5' : '#fef2f2',
                borderRadius: 12, padding: '0.75rem 1.25rem',
                display: 'flex', alignItems: 'center', gap: 8,
                fontSize: '0.85rem', fontWeight: 600,
                color: submitMsg.ok ? '#059669' : '#dc2626',
              }}>
                {submitMsg.ok ? <RobotMascot scene="reportSent" size={56} fallback={<CheckCircle size={16} />} /> : <AlertCircle size={16} />}
                <span>
                  {submitMsg.text}
                  {submitMsg.ok && trackToken && (
                    <> · <a href={`/track/${encodeURIComponent(trackToken)}`} style={{ color: 'inherit', textDecoration: 'underline' }}>ติดตามสถานะงานซ่อม</a></>
                  )}
                </span>
              </div>
            )}


            {/* ── Contact ── */}
            <div style={{ background: 'rgba(255,255,255,0.12)', borderRadius: 12, padding: '1rem 1.25rem', backdropFilter: 'blur(4px)' }}>
              <div style={{ fontWeight: 700, color: '#fff', fontSize: '0.85rem', marginBottom: 10 }}>ติดต่อทีมงาน</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {([
                  { href: 'tel:0800000000', emoji: '📞', label: '080-000-0000' },
                  { href: 'https://line.me/R/ti/p/@example', emoji: '💬', label: 'LINE: @example' },
                  { href: 'https://facebook.com/example', emoji: '📘', label: 'Facebook' },
                ] as { href: string; emoji: string; label: string }[]).map(item => (
                  <a
                    key={item.href}
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      padding: '0.5rem 0.9rem',
                      background: 'rgba(255,255,255,0.9)',
                      borderRadius: 20,
                      color: '#1e3a8a', textDecoration: 'none',
                      fontSize: '0.8rem', fontWeight: 500,
                    }}
                  >
                    {item.emoji} {item.label}
                  </a>
                ))}
              </div>
            </div>

            <div style={{ textAlign: 'center', fontSize: '0.68rem', color: 'rgba(255,255,255,0.4)', paddingTop: '0.25rem' }}>
              Ozone360 ERP · ข้อมูลหุ่นยนต์
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
