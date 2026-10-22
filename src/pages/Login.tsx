import React, { useState, useEffect, useRef } from 'react';
import RobotMascot from '../components/RobotMascot';
import { useAuth } from '../context/AuthContext';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../api';
import { Lock, KeyRound } from 'lucide-react';

const SLIDES = [
  {
    img: 'https://d1baueb6wfhxkz.cloudfront.net/6479b7c62a200d011c898070/large/1768290778315866.webp',
    badge: 'รางวัลออกแบบยอดเยี่ยมระดับนานาชาติ',
    title: 'PuduBot 2',
    sub: 'หุ่นยนต์ส่งของอเนกประสงค์',
  },
  {
    img: 'https://d1baueb6wfhxkz.cloudfront.net/6479b7c62a200d011c898070/large/1700540375108135.webp',
    badge: 'หุ่นยนต์เสิร์ฟ — ร้านอาหารและโรงแรม',
    title: 'PuduBot 2',
    sub: 'ส่งของอัตโนมัติหลายถาด',
  },
  {
    img: 'https://d1baueb6wfhxkz.cloudfront.net/6479b7c62a200d011c898070/large/1754722630460796.jpg',
    badge: 'ส่งของทางการแพทย์และในอาคาร',
    title: 'FlashBot Max',
    sub: 'หุ่นยนต์ส่งของอัจฉริยะข้ามชั้น',
  },
  {
    img: 'https://d1baueb6wfhxkz.cloudfront.net/6479b7c62a200d011c898070/large/1754120733191362.webp',
    badge: 'หุ่นยนต์ทำความสะอาด — รางวัล Red Dot 2023',
    title: 'Pudu CC1',
    sub: 'หุ่นยนต์ทำความสะอาดอัจฉริยะ 4 ขั้นตอน',
  },
];

const Login: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Only same-site paths, so a crafted link can't bounce users to another site after login.
  const returnTo = (() => {
    const raw = searchParams.get('returnTo') || '/';
    return raw.startsWith('/') && !raw.startsWith('//') && !raw.startsWith('/login') ? raw : '/';
  })();
  const goAfterLogin = () => navigate(returnTo, { replace: true });
  const [loggingIn, setLoggingIn] = useState(false);

  // Slider
  const [slide, setSlide] = useState(0);

  // Force-change-password state
  const [pendingUser, setPendingUser] = useState<any>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changeError, setChangeError] = useState('');
  const [changing, setChanging] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const googleBtnRef = useRef<HTMLDivElement>(null);

  // Auto-advance slides every 4s (not for people who asked the OS to reduce motion)
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const timer = setInterval(() => setSlide(s => (s + 1) % SLIDES.length), 4000);
    return () => clearInterval(timer);
  }, []);

  const handleGoogleCredential = async (response: any) => {
    setError('');
    setGoogleLoading(true);
    try {
      const res = await api.post('/auth/google', { credential: response.credential });
      login(res.data.user);
      goAfterLogin();
    } catch (err: any) {
      setError(err.response?.data?.error || 'เข้าสู่ระบบด้วย Google ไม่สำเร็จ');
    } finally {
      setGoogleLoading(false);
    }
  };

  useEffect(() => {
    const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string;
    if (!GOOGLE_CLIENT_ID) return;
    const initGIS = () => {
      const g = (window as any).google;
      if (!g?.accounts?.id || !googleBtnRef.current) return;
      g.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: handleGoogleCredential });
      g.accounts.id.renderButton(googleBtnRef.current, { theme: 'outline', size: 'large', width: 336, text: 'signin_with' });
    };
    if ((window as any).google?.accounts?.id) {
      initGIS();
    } else {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true; s.defer = true;
      s.onload = initGIS;
      document.head.appendChild(s);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loggingIn) return;
    setError('');
    setLoggingIn(true);
    try {
      const res = await api.post('/auth/login', { username, password });
      if (res.data.requirePasswordChange) {
        setPendingUser(res.data.user);
        setCurrentPassword(password);
      } else {
        login(res.data.user);
        goAfterLogin();
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'เข้าสู่ระบบไม่สำเร็จ');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setChangeError('');
    if (newPassword !== confirmPassword) {
      setChangeError('รหัสผ่านใหม่ไม่ตรงกัน');
      return;
    }
    if (newPassword.length < 8) {
      setChangeError('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');
      return;
    }
    setChanging(true);
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword });
      login(pendingUser); goAfterLogin();
    } catch (err: any) {
      setChangeError(err.response?.data?.error || 'เปลี่ยนรหัสผ่านไม่สำเร็จ');
    } finally {
      setChanging(false);
    }
  };

  // ── Force change password screen ──────────────────────────────────────────
  if (pendingUser) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg-primary)' }}>
        <div className="card animate-fade-in" style={{ width: '100%', maxWidth: '420px', padding: '2rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '1.5rem' }}>
            <KeyRound size={36} style={{ color: 'var(--accent-primary)', marginBottom: '0.75rem' }} />
            <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700 }}>เปลี่ยนรหัสผ่าน</h2>
            <p className="text-muted" style={{ fontSize: '0.85rem', marginTop: '0.4rem', textAlign: 'center' }}>
              {pendingUser.username} &mdash; รหัสผ่านหมดอายุหรือถูก Reset กรุณาตั้งรหัสผ่านใหม่ก่อนเข้าใช้งาน
            </p>
          </div>

          {changeError && (
            <div role="alert" aria-live="assertive" style={{ padding: '0.75rem', backgroundColor: 'var(--status-danger-bg)', color: 'var(--status-danger)', borderRadius: 'var(--radius-md)', marginBottom: '1rem', fontSize: '0.875rem' }}>
              {changeError}
            </div>
          )}

          <form onSubmit={handleChangePassword}>
            <div className="form-group">
              <label className="form-label" htmlFor="login-newPassword">รหัสผ่านใหม่</label>
              <input id="login-newPassword"
                type="password"
                className="form-control"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="login-confirmPassword">ยืนยันรหัสผ่านใหม่</label>
              <input id="login-confirmPassword"
                type="password"
                className="form-control"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>
            <p className="text-muted" style={{ fontSize: '0.78rem', marginBottom: '1rem' }}>รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร</p>
            <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={changing}>
              <KeyRound size={16} /> {changing ? 'กำลังบันทึก...' : 'บันทึกรหัสผ่านใหม่'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ── Login screen ──────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', display: 'flex', backgroundColor: 'var(--bg-primary)' }}>

      {/* ── Left panel: hero slider ── */}
      <div
        className="login-left-panel"
        style={{ flex: 1, display: 'none', position: 'relative', overflow: 'hidden', backgroundColor: '#0f172a' }}
      >
        {/* Slide images — cross-fade */}
        {SLIDES.map((s, i) => (
          <div
            key={i}
            style={{
              position: 'absolute', inset: 0,
              opacity: i === slide ? 1 : 0,
              transition: 'opacity 1s ease',
            }}
          >
            <img
              src={s.img}
              alt={s.title}
              style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center top' }}
            />
          </div>
        ))}

        {/* Dark gradient overlay */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(to bottom, rgba(10,18,40,0.25) 0%, rgba(10,18,40,0.45) 50%, rgba(10,18,40,0.88) 100%)',
        }} />

        {/* Top-left: logo */}
        <div style={{ position: 'absolute', top: 28, left: 32, zIndex: 3 }}>
          <img src="/ozone360-logo-real.png" alt="OZONE360" style={{ height: 38, filter: 'brightness(0) invert(1)' }} />
        </div>

        {/* Center: slide title block */}
        <div style={{
          position: 'absolute', left: 0, right: 0, top: '48%', transform: 'translateY(-50%)',
          zIndex: 3, padding: '0 3rem',
        }}>
          <div style={{
            fontSize: '0.68rem', fontWeight: 700, color: '#f97316',
            textTransform: 'uppercase', letterSpacing: '0.18em', marginBottom: 10,
          }}>
            {SLIDES[slide].badge}
          </div>
          <div style={{ fontSize: '3.2rem', fontWeight: 900, color: 'white', lineHeight: 1.05, marginBottom: 10 }}>
            {SLIDES[slide].title}
          </div>
          <div style={{ fontSize: '1rem', color: 'rgba(255,255,255,0.8)' }}>
            {SLIDES[slide].sub}
          </div>
        </div>

        {/* Bottom: stats + dots */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 3, padding: '1.75rem 3rem' }}>
          {/* Stats row */}
          <div style={{ display: 'flex', gap: '2rem', marginBottom: '1.25rem' }}>
            {[
              { v: '15+', l: 'ปีประสบการณ์' },
              { v: '100+', l: 'ลูกค้า' },
              { v: '24/7', l: 'ติดตามได้' },
            ].map(st => (
              <div key={st.l}>
                <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#f97316' }}>{st.v}</div>
                <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.65)', marginTop: 2 }}>{st.l}</div>
              </div>
            ))}
          </div>

          {/* Slide dots */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {SLIDES.map((_, i) => (
              <button
                key={i}
                onClick={() => setSlide(i)}
                style={{
                  width: i === slide ? 28 : 8, height: 8, borderRadius: 4,
                  border: 'none', cursor: 'pointer', padding: 0,
                  background: i === slide ? '#f97316' : 'rgba(255,255,255,0.4)',
                  transition: 'all 0.35s ease',
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* ── Right panel: form ── */}
      <div
        className="login-right-panel"
        style={{ width: '100%', maxWidth: 460, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem', backgroundColor: 'var(--bg-primary)' }}
      >
        <div style={{ width: '100%', maxWidth: 380 }} className="animate-fade-in">

          {/* Logo */}
          <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
            <img src="/ozone360-logo-real.png" alt="OZONE360 Robotics Service" style={{ height: 52, width: 'auto', objectFit: 'contain', marginBottom: '0.75rem' }} />
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>ระบบบริหารจัดการหุ่นยนต์</div>
          </div>

          {/* Form card */}
          <div className="card" style={{ padding: '2rem' }}>
            <div style={{ marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.25rem' }}>เข้าสู่ระบบ</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>กรอกชื่อผู้ใช้และรหัสผ่านของคุณ</div>
              </div>
              <RobotMascot scene="login" size={76} style={{ marginTop: -36, marginBottom: -8 }} />
            </div>

            {error && (
              <div role="alert" aria-live="assertive" style={{ padding: '0.75rem', backgroundColor: 'var(--status-danger-bg)', color: 'var(--status-danger)', borderRadius: 'var(--radius-md)', marginBottom: '1rem', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span aria-hidden="true">&#9888;</span> {error}
              </div>
            )}

            <form onSubmit={handleLogin}>
              <div className="form-group">
                <label className="form-label" htmlFor="login-username">ชื่อผู้ใช้</label>
                <input id="login-username"
                  type="text"
                  className="form-control"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  required
                  autoComplete="username"
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="login-password">รหัสผ่าน</label>
                <input id="login-password"
                  type="password"
                  className="form-control"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </div>
              <button type="submit" className="btn btn-primary" disabled={loggingIn} style={{ width: '100%', marginTop: '1.25rem', justifyContent: 'center', padding: '0.65rem' }}>
                <Lock size={16} /> {loggingIn ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
              </button>
            </form>

            {import.meta.env.VITE_GOOGLE_CLIENT_ID && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '1.25rem 0 1rem' }}>
                  <div style={{ flex: 1, height: 1, background: 'var(--border-color)' }} />
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>หรือ</span>
                  <div style={{ flex: 1, height: 1, background: 'var(--border-color)' }} />
                </div>
                <div ref={googleBtnRef} style={{ display: 'flex', justifyContent: 'center', minHeight: 44 }} />
                {googleLoading && <p style={{ textAlign: 'center', fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: 8 }}>กำลังเข้าสู่ระบบ...</p>}
              </>
            )}
          </div>

          {/* Footer */}
          <div style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            &copy; {new Date().getFullYear()} OZONE360 AI &amp; Robotics Solutions
          </div>
        </div>
      </div>

      <style>{`
        @media (min-width: 768px) {
          .login-left-panel { display: block !important; }
        }
        @media (max-width: 767px) {
          .login-right-panel { max-width: 100% !important; }
        }
        .login-left-panel * { transition-property: opacity, transform, width, background; }
      `}</style>
    </div>
  );
};

export default Login;
