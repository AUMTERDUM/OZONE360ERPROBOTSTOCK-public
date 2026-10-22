import React, { useEffect, useState } from 'react';
import MascotLoader from '../components/MascotLoader';
import { useParams } from 'react-router-dom';
import { CheckCircle, Clock, Wrench, Bot, AlertCircle } from 'lucide-react';
import axios from 'axios';
import { formatThaiDate } from '../utils/thaiDate';
import { formatTicketNo } from '../utils/displayText';
import RobotMascot from '../components/RobotMascot';
import type { MascotScene } from '../utils/mascots';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

interface TrackData {
  id: string;
  status: 'Pending' | 'Waiting Quotation' | 'In Progress' | 'Ready to Ship' | 'Completed';
  reportDate: string;
  issueDescription: string;
  resolution: string | null;
  robot: { serialNumber: string; model: string; type: string };
}

const STEPS = ['Pending', 'Waiting Quotation', 'In Progress', 'Ready to Ship', 'Completed'] as const;
const STEP_LABEL: Record<string, string> = {
  Pending: 'รอดำเนินการ',
  'Waiting Quotation': 'รอทำใบเสนอราคา',
  'In Progress': 'กำลังซ่อม',
  'Ready to Ship': 'รอเตรียมส่ง',
  Completed: 'เสร็จสิ้น',
};
// Customer-facing: a cartoon robot that matches where the repair is.
const STEP_MASCOT: Record<string, MascotScene> = {
  Pending: 'repairPending',
  'Waiting Quotation': 'repairPending',
  'In Progress': 'repairPending',
  'Ready to Ship': 'repairShip',
  Completed: 'repairDone',
};
const STEP_COLOR: Record<string, string> = {
  Pending: '#d97706',
  'Waiting Quotation': '#7c3aed',
  'In Progress': '#1e40af',
  'Ready to Ship': '#0891b2',
  Completed: '#059669',
};

export default function TrackRepair() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<TrackData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Customers keep this page open while waiting, so it can be re-checked without reloading.
  const load = React.useCallback(async () => {
    if (!token) return;
    setRefreshing(true);
    try {
      const r = await axios.get(`${API_BASE}/track/${token}`);
      setData(r.data);
      setError('');
      setCheckedAt(new Date());
    } catch (err: any) {
      if (err.response?.status === 404) setError('ไม่พบข้อมูลการซ่อม หรือลิงก์ไม่ถูกต้อง');
      else if (!data) setError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const activeStep = data ? STEPS.indexOf(data.status) : -1;

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
      <div style={{ width: '100%', maxWidth: 900, padding: '0 1rem' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <img
            src="/ozone360-logo-real.png"
            alt="Ozone360"
            style={{ height: 52, marginBottom: '0.5rem', filter: 'brightness(0) invert(1)' }}
            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
          <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.85rem', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            ติดตามสถานะการซ่อม
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
            <div style={{ color: '#5a6b94', fontSize: '0.85rem', marginTop: 8 }}>กรุณาตรวจสอบลิงก์อีกครั้ง หรือติดต่อเจ้าหน้าที่</div>
          </div>
        )}

        {data && (
          <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>

            {/* ── Main repair card ── */}
            <div style={{ flex: '1 1 400px', background: '#fff', borderRadius: 16, overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
              {/* Status Banner */}
              <div style={{
                background: STEP_COLOR[data.status],
                padding: '1.25rem 1.5rem',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
              }}>
                {data.status === 'Completed'
                  ? <CheckCircle size={24} color="#fff" />
                  : data.status === 'In Progress' || data.status === 'Ready to Ship'
                  ? <Wrench size={24} color="#fff" />
                  : <Clock size={24} color="#fff" />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: '#fff', fontWeight: 700, fontSize: '1.1rem' }}>
                    {STEP_LABEL[data.status]}
                  </div>
                  <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.8rem' }}>
                    เลขที่ใบงาน: {formatTicketNo(data.id)}
                  </div>
                </div>
                <RobotMascot scene={STEP_MASCOT[data.status] ?? 'repairPending'} size={84} style={{ margin: '-0.75rem 0' }} />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '0.5rem 1.5rem', fontSize: '0.75rem', color: '#4b5d8a', borderBottom: '1px solid #eef2fb' }}>
                <span>ตรวจสอบล่าสุด {checkedAt ? checkedAt.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '-'} น.</span>
                <button type="button" onClick={() => void load()} disabled={refreshing}
                  style={{ border: '1px solid #c7d2fe', background: '#fff', color: '#1e40af', borderRadius: 8, padding: '6px 12px', minHeight: 36, fontWeight: 600, cursor: 'pointer', font: 'inherit' }}>
                  {refreshing ? 'กำลังตรวจสอบ...' : 'อัปเดตสถานะ'}
                </button>
              </div>

              {/* Progress Steps */}
              <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #eef2fb' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                  {STEPS.map((step, i) => {
                    const done = i <= activeStep;
                    const current = i === activeStep;
                    return (
                      <React.Fragment key={step}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
                          <div style={{
                            width: 32, height: 32, borderRadius: '50%',
                            background: done ? STEP_COLOR[data.status] : '#eef2fb',
                            border: current ? `3px solid ${STEP_COLOR[data.status]}` : 'none',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            transition: 'all 0.3s',
                          }}>
                            {done
                              ? <CheckCircle size={16} color="#fff" />
                              : <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#cbd5e1' }} />}
                          </div>
                          <div style={{
                            marginTop: 6,
                            fontSize: '0.72rem',
                            fontWeight: done ? 600 : 400,
                            color: done ? STEP_COLOR[data.status] : '#5a6b94',
                            textAlign: 'center',
                            whiteSpace: 'nowrap',
                          }}>
                            {STEP_LABEL[step]}{step === 'Waiting Quotation' && <span style={{ display: 'block', fontWeight: 400, opacity: 0.8 }}>(ถ้ามี)</span>}
                          </div>
                        </div>
                        {i < STEPS.length - 1 && (
                          <div style={{
                            height: 3, flex: 2,
                            background: i < activeStep ? STEP_COLOR[data.status] : '#eef2fb',
                            marginBottom: 22,
                            transition: 'all 0.3s',
                          }} />
                        )}
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>

              {/* Robot Info */}
              <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid #eef2fb' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <Bot size={18} color="#1e3a8a" />
                  <span style={{ fontWeight: 600, color: '#1e3a8a', fontSize: '0.9rem' }}>ข้อมูลหุ่นยนต์</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  <InfoRow label="ซีเรียล" value={data.robot.serialNumber} />
                  <InfoRow label="รุ่น" value={data.robot.model} />
                  <InfoRow label="ประเภท" value={data.robot.type} />
                </div>
              </div>

              {/* Issue */}
              <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid #eef2fb' }}>
                <div style={{ fontSize: '0.78rem', color: '#5a6b94', marginBottom: 4 }}>ปัญหาที่แจ้ง</div>
                <div style={{ color: '#1e3a8a', fontSize: '0.9rem', lineHeight: 1.6 }}>{data.issueDescription}</div>
                <div style={{ fontSize: '0.78rem', color: '#5a6b94', marginTop: 6 }}>
                  วันที่แจ้งซ่อม: {formatThaiDate(data.reportDate, {
                    year: 'numeric', month: 'long', day: 'numeric'
                  })}
                </div>
              </div>

              {/* Resolution */}
              {data.resolution && (
                <div style={{ padding: '1rem 1.5rem' }}>
                  <div style={{ fontSize: '0.78rem', color: '#5a6b94', marginBottom: 4 }}>สรุปผลการซ่อม</div>
                  <div style={{ color: '#059669', fontSize: '0.9rem', lineHeight: 1.6 }}>{data.resolution}</div>
                </div>
              )}
            </div>

            {/* ── Contact sidebar ── */}
            <div style={{ flex: '0 0 210px', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              <div style={{ background: 'rgba(255,255,255,0.15)', borderRadius: 12, padding: '0.9rem 1rem', backdropFilter: 'blur(4px)' }}>
                <div style={{ fontWeight: 700, color: '#fff', fontSize: '0.85rem', marginBottom: '0.75rem', letterSpacing: '0.02em' }}>
                  ติดต่อทีมงาน
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                  {([
                    { href: 'tel:0800000000',                           emoji: '📞', label: '080-000-0000',             bg: '#e0e7ff' },
                    { href: 'tel:052000634',                             emoji: '📞', label: '052-000-634',             bg: '#e0e7ff' },
                    { href: 'mailto:sales@example.com',       emoji: '✉️', label: 'อีเมล',                  bg: '#e0e7ff' },
                    { href: 'https://line.me/R/ti/p/@example',          emoji: '💬', label: 'LINE: @example',        bg: '#dcfce7', external: true },
                    { href: 'https://facebook.com/example',            emoji: '📘', label: 'Facebook',              bg: '#dbeafe', external: true },
                    { href: 'https://example.com',              emoji: '🌐', label: 'example.com',  bg: '#ede9fe', external: true },
                  ] as { href: string; emoji: string; label: string; bg: string; external?: boolean }[]).map(item => (
                    <a
                      key={item.href}
                      href={item.href}
                      target={item.external ? '_blank' : undefined}
                      rel={item.external ? 'noopener noreferrer' : undefined}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '0.55rem 0.75rem',
                        background: 'rgba(255,255,255,0.92)',
                        borderRadius: 8,
                        color: '#1e3a8a', textDecoration: 'none',
                        fontSize: '0.78rem', fontWeight: 500,
                      }}
                    >
                      <span style={{
                        width: 28, height: 28, borderRadius: '50%', background: item.bg,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.85rem', flexShrink: 0,
                      }}>
                        {item.emoji}
                      </span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.label}
                      </span>
                    </a>
                  ))}
                </div>
              </div>
              <div style={{ textAlign: 'center', fontSize: '0.68rem', color: 'rgba(255,255,255,0.45)', paddingTop: '0.25rem' }}>
                Ozone360 ERP — ระบบติดตามการซ่อม
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: '0.72rem', color: '#5a6b94' }}>{label}</div>
      <div style={{ fontWeight: 600, color: '#1e3a8a', fontSize: '0.85rem' }}>{value}</div>
    </div>
  );
}
