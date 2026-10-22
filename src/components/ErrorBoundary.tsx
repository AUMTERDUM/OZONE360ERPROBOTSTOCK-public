import React from 'react';
import RobotMascot from './RobotMascot';

interface State { error: Error | null }

/**
 * Catches a crash while rendering a page so the user sees what happened and a way out,
 * instead of a blank white screen. `resetKey` (e.g. the current path) clears it on navigation.
 */
export default class ErrorBoundary extends React.Component<{ children: React.ReactNode; resetKey?: string }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" style={{ minHeight: '60vh', display: 'grid', placeItems: 'center', padding: '1.5rem' }}>
        <div className="card" style={{ maxWidth: 440, textAlign: 'center', padding: '2rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <RobotMascot scene="crash" size={160} />
          <h2 style={{ margin: 0 }}>ขออภัย หน้านี้มีปัญหา</h2>
          <p className="text-muted" style={{ margin: 0 }}>ช่างหุ่นยนต์ของเรากำลังซ่อมอยู่ ลองโหลดหน้าใหม่ ถ้ายังไม่หายให้แจ้งทีมงาน</p>
          <code style={{ fontSize: 11, color: 'var(--text-muted)', wordBreak: 'break-word' }}>{this.state.error.message}</code>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn btn-outline" onClick={() => this.setState({ error: null })}>ลองอีกครั้ง</button>
            <button className="btn btn-primary" onClick={() => window.location.reload()}>โหลดหน้าใหม่</button>
          </div>
        </div>
      </div>
    );
  }
}
