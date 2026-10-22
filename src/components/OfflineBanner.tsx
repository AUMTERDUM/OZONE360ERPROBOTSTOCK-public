import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import RobotMascot from './RobotMascot';

/** Tells field staff the connection dropped, so a failing save isn't a mystery. */
const OfflineBanner: React.FC = () => {
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);
  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  if (!offline) return null;
  // Portalled: the page container is animated (transform), which would anchor position:fixed to it.
  return createPortal(
    <div role="alert" style={{
      position: 'fixed', left: '50%', bottom: '1rem', transform: 'translateX(-50%)', zIndex: 9998,
      display: 'flex', alignItems: 'center', gap: 10, padding: '6px 16px 6px 6px', maxWidth: 'calc(100% - 2rem)',
      background: 'var(--bg-secondary)', border: '1px solid var(--status-warning)', borderRadius: 999, boxShadow: 'var(--shadow-lg)',
      fontSize: '0.82rem', color: 'var(--text-primary)',
    }}>
      <RobotMascot scene="offline" size={44} />
      <span><strong>ไม่มีอินเทอร์เน็ต</strong> · ข้อมูลที่กรอกยังอยู่ รอสัญญาณกลับมาแล้วค่อยกดบันทึก</span>
    </div>,
    document.body,
  );
};

export default OfflineBanner;
