import React, { useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';

interface PageHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  overflowActions?: React.ReactNode[];
  /** Optional left-aligned status / chips slot rendered next to the title */
  meta?: React.ReactNode;
}

/**
 * Shared page header used by all top-level pages so that title, subtitle,
 * meta chips and action buttons follow a single visual rhythm.
 */
export const PageHeader: React.FC<PageHeaderProps> = ({ title, subtitle, actions, overflowActions = [], meta }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape); };
  }, [open]);
  return (
  <header
    className="page-header"
    style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: '1rem',
      flexWrap: 'wrap',
      marginBottom: '1.25rem',
    }}
  >
    <div className="page-header-main">
      <h1
        className="h1"
        style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}
      >
        <span>{title}</span>
        {meta}
      </h1>
      {subtitle && (
        <p
          style={{
            margin: '0.25rem 0 0',
            color: 'var(--text-muted)',
            fontSize: '0.85rem',
          }}
        >
          {subtitle}
        </p>
      )}
    </div>
    {(actions || overflowActions.length > 0) && (
      <div className="page-header-actions" style={{ gap: '0.6rem' }}>
        {actions}
        {overflowActions.length > 0 && <div ref={ref} style={{ position: 'relative' }}>
          <button className="btn btn-outline" type="button" aria-label="การดำเนินการเพิ่มเติม" aria-haspopup="menu" aria-expanded={open} aria-controls="page-header-overflow-menu" onClick={() => setOpen(value => !value)}>
            <MoreHorizontal size={17} />
          </button>
          {open && <div id="page-header-overflow-menu" role="menu" style={{ position: 'absolute', right: 0, top: 'calc(100% + 0.4rem)', zIndex: 20, minWidth: 190, padding: '0.4rem', border: '1px solid var(--border-color)', borderRadius: 8, background: 'var(--surface-1)', boxShadow: 'var(--shadow-md)', display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
            {overflowActions.map((action, index) => <div key={index} role="none" onClick={() => setOpen(false)}>{action}</div>)}
          </div>}
        </div>}
      </div>
    )}
  </header>
  );
};

export default PageHeader;
