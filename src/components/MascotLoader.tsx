import React from 'react';
import RobotMascot from './RobotMascot';

/** Full-area loading state: the MT1 sweeper sweeping back and forth. */
const MascotLoader: React.FC<{ label?: string; minHeight?: number | string; size?: number }> = ({ label = 'กำลังโหลด...', minHeight = '50vh', size = 120 }) => (
  <div role="status" aria-live="polite" style={{ minHeight, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--text-muted)', fontSize: '0.85rem' }}>
    <RobotMascot scene="loading" size={size} />
    {label}
  </div>
);

export default MascotLoader;
