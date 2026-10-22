import React, { useEffect, useId, useRef, useState } from 'react';
import RobotMascot from './RobotMascot';
import type { MascotScene } from '../utils/mascots';
import { createPortal } from 'react-dom';
import { robotStatusLabels, ticketStatusLabels } from '../utils/statusLabels';
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { sortRows, nextSort, type SortDir, type SortState } from '../lib/table-sort';

/** True when enough listed rows contain a meaningful value for a column. */
export const hasPopulatedColumn = <T,>(rows: T[], getValue: (row: T) => unknown, minimumRatio = 0.1) =>
  rows.length > 0 && rows.filter(row => { const value = getValue(row); return value !== null && value !== undefined && String(value).trim() !== '' && String(value).trim() !== '-'; }).length / rows.length >= minimumRatio;

// ── Spinner ──────────────────────────────────────────────────────────────────
export const Spinner: React.FC<{ size?: number; color?: string }> = ({
  size = 20,
  color = 'var(--accent-primary)',
}) => (
  <div
    style={{
      width: size,
      height: size,
      border: `2.5px solid var(--border-color)`,
      borderTop: `2.5px solid ${color}`,
      borderRadius: '50%',
      animation: 'spin 0.7s linear infinite',
      flexShrink: 0,
    }}
  />
);

// ── Skeleton row for table ────────────────────────────────────────────────────
export const TableSkeleton: React.FC<{ cols: number; rows?: number }> = ({ cols, rows = 5 }) => (
  <>
    {Array.from({ length: rows }).map((_, i) => (
      <tr key={i} style={{ opacity: 1 - i * 0.12 }}>
        {Array.from({ length: cols }).map((_, j) => (
          <td key={j}>
            <div
              style={{
                height: 14,
                borderRadius: 6,
                background: 'linear-gradient(90deg, var(--bg-tertiary) 25%, var(--bg-elevated) 50%, var(--bg-tertiary) 75%)',
                backgroundSize: '200% 100%',
                animation: 'shimmer 1.4s infinite',
                width: j === 0 ? '60%' : j % 3 === 0 ? '40%' : '75%',
              }}
            />
          </td>
        ))}
      </tr>
    ))}
  </>
);

// ── Skeleton card ─────────────────────────────────────────────────────────────
export const SkeletonCard: React.FC<{ height?: number }> = ({ height = 90 }) => (
  <div
    className="card"
    style={{
      height,
      background: 'linear-gradient(90deg, var(--bg-tertiary) 25%, var(--bg-elevated) 50%, var(--bg-tertiary) 75%)',
      backgroundSize: '200% 100%',
      animation: 'shimmer 1.4s infinite',
    }}
  />
);

// ── Empty state ───────────────────────────────────────────────────────────────
interface EmptyStateProps {
  icon?: React.ReactNode;
  /** Cartoon robot shown above the title (falls back to `icon`); pass false to show only the icon. */
  mascot?: MascotScene | false;
  title: string;
  description?: string;
  action?: React.ReactNode;
  colSpan?: number;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  mascot = 'emptyList',
  title,
  description,
  action,
  colSpan,
}) => {
  const content = (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '3rem 1.5rem',
        gap: '0.6rem',
        textAlign: 'center',
      }}
    >
      {(() => {
        const iconEl = icon ? <div style={{ color: 'var(--text-muted)', opacity: 0.4, marginBottom: 4 }}>{icon}</div> : null;
        return mascot ? <RobotMascot scene={mascot} size={110} fallback={iconEl} /> : iconEl;
      })()}
      <div style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-secondary)' }}>
        {title}
      </div>
      {description && (
        <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{description}</div>
      )}
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );

  if (colSpan !== undefined) {
    return (
      <tr>
        <td colSpan={colSpan}>{content}</td>
      </tr>
    );
  }
  return content;
};

// ── Status badge helpers ──────────────────────────────────────────────────────
export type RobotStatus = 'In Stock' | 'Assigned' | 'In Maintenance' | 'Missing';
export type TicketStatus = 'Pending' | 'Waiting Quotation' | 'In Progress' | 'Ready to Ship' | 'Completed';

const ROBOT_STATUS_BADGE: Record<RobotStatus, { cls: string; label: string }> = {
  'In Stock':       { cls: 'success', label: robotStatusLabels['In Stock'] },
  'Assigned':       { cls: 'info',    label: robotStatusLabels.Assigned },
  'In Maintenance': { cls: 'warning', label: robotStatusLabels['In Maintenance'] },
  'Missing':        { cls: 'danger',  label: robotStatusLabels.Missing },
};

const TICKET_STATUS_BADGE: Record<TicketStatus, { cls: string; label: string }> = {
  'Pending':           { cls: 'danger',  label: ticketStatusLabels.Pending },
  'Waiting Quotation': { cls: 'danger',  label: ticketStatusLabels['Waiting Quotation'] },
  'In Progress':       { cls: 'warning', label: ticketStatusLabels['In Progress'] },
  'Ready to Ship':     { cls: 'info',    label: ticketStatusLabels['Ready to Ship'] },
  'Completed':         { cls: 'success', label: ticketStatusLabels.Completed },
};

export const getRobotStatusBadge = (status: string) =>
  ROBOT_STATUS_BADGE[status as RobotStatus] ?? { cls: 'secondary', label: status };

export const getTicketStatusBadge = (status: string) =>
  TICKET_STATUS_BADGE[status as TicketStatus] ?? { cls: 'secondary', label: status };

export const RobotStatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const { cls, label } = getRobotStatusBadge(status);
  return <span className={`badge ${cls}`}>{label}</span>;
};

export const TicketStatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const { cls, label } = getTicketStatusBadge(status);
  return <span className={`badge ${cls}`}>{label}</span>;
};

// ── useEscapeKey — close modals on Escape ─────────────────────────────────────
export const useEscapeKey = (onEscape: () => void, active = true) => {
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onEscape(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onEscape, active]);
};

// ── Upload progress bar ───────────────────────────────────────────────────────
export const UploadProgressBar: React.FC<{ progress: number; label?: string }> = ({
  progress,
  label = 'กำลังอัพโหลด...',
}) => (
  <div style={{ marginTop: 8 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
      <span>{label}</span>
      <span>{progress}%</span>
    </div>
    <div
      style={{
        height: 6,
        background: 'var(--bg-tertiary)',
        borderRadius: 999,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          height: '100%',
          width: `${progress}%`,
          background: 'var(--accent-primary)',
          borderRadius: 999,
          transition: 'width 0.2s ease',
        }}
      />
    </div>
  </div>
);

// ── Refresh button ────────────────────────────────────────────────────────────
export const RefreshButton: React.FC<{
  onClick: () => void;
  loading?: boolean;
}> = ({ onClick, loading = false }) => (
  <button
    className="btn btn-ghost"
    onClick={onClick}
    disabled={loading}
    title="รีเฟรชข้อมูล"
    style={{ display: 'flex', alignItems: 'center', gap: 6 }}
  >
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ animation: loading ? 'spin 0.7s linear infinite' : undefined }}
    >
      <path d="M21 2v6h-6" />
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M3 22v-6h6" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
    </svg>
    {loading ? 'กำลังโหลด...' : 'รีเฟรช'}
  </button>
);

// ── Modal — Accessible, focus-trapped, responsive ─────────────────────────────
interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  /** CSS max-width or px number. Uses responsive clamp by default */
  width?: number | string;
  /** If true, asks before close when form is dirty */
  preventClose?: boolean;
  /** Optional id of the element describing the dialog (announced by screen readers) */
  describedById?: string;
}

// Open dialogs, innermost last. Only the top one handles Escape/Tab, and the page stays
// scroll-locked until the last one closes (stacked modals used to fight over both).
const modalStack: string[] = [];

export const Modal: React.FC<ModalProps> = ({
  open,
  onClose,
  title,
  children,
  width,
  preventClose = false,
  describedById,
}) => {
  const overlayRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const modalId = useId();
  const titleId = `${modalId}-title`;

  // Register in the stack, focus the first field, and restore focus on close — including when the
  // page unmounts the modal instead of passing open={false}.
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    modalStack.push(modalId);
    document.body.style.overflow = 'hidden';
    const raf = requestAnimationFrame(() => {
      const first = contentRef.current?.querySelector<HTMLElement>(
        'input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      first?.focus();
    });
    return () => {
      cancelAnimationFrame(raf);
      const i = modalStack.lastIndexOf(modalId);
      if (i >= 0) modalStack.splice(i, 1);
      if (modalStack.length === 0) document.body.style.overflow = '';
      if (previous && document.contains(previous)) previous.focus();
    };
  }, [open, modalId]);

  // Focus trap + Escape (top-most dialog only)
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (modalStack[modalStack.length - 1] !== modalId) return;
      if (e.key === 'Escape') {
        if (!preventClose) onClose();
        return;
      }
      if (e.key === 'Tab' && contentRef.current) {
        const focusable = contentRef.current.querySelectorAll<HTMLElement>(
          'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose, preventClose, modalId]);

  if (!open) return null;

  const maxW = width
    ? typeof width === 'number' ? `${width}px` : width
    : 'clamp(320px, 90vw, 460px)';

  // Portalled to <body> so no page container (scroll area, animation, transform) can trap or clip it.
  return createPortal(
    <div
      ref={overlayRef}
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleId : undefined}
      aria-describedby={describedById}
      onClick={e => {
        if (e.target === overlayRef.current && !preventClose) onClose();
      }}
    >
      <div
        ref={contentRef}
        className="card modal-content"
        style={{ width: maxW, maxWidth: '96vw', overflowY: 'auto' }}
      >
        {title && (
          <div className="modal-header">
            <h2 id={titleId} style={{ margin: 0 }}>{title}</h2>
            <button
              type="button"
              className="btn btn-ghost modal-close-btn"
              onClick={() => { if (!preventClose) onClose(); }}
              disabled={preventClose}
              aria-label="ปิด"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
};

// ── FormSubmitButton — disables during submit, shows spinner ─────────────────
interface FormSubmitButtonProps {
  loading?: boolean;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
  type?: 'submit' | 'button';
}

export const FormSubmitButton: React.FC<FormSubmitButtonProps> = ({
  loading = false,
  children,
  className = 'btn btn-primary',
  disabled = false,
  onClick,
  type = 'submit',
}) => (
  <button
    type={type}
    className={className}
    disabled={disabled || loading}
    onClick={onClick}
    style={{ position: 'relative', minWidth: 80 }}
  >
    {loading && (
      <Spinner size={14} color="var(--text-on-accent)" />
    )}
    <span style={{ opacity: loading ? 0.6 : 1 }}>{children}</span>
  </button>
);

// ── useUnsavedWarning — warns on tab/window close when dirty ─────────────────
export const useUnsavedWarning = (isDirty: boolean) => {
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);
};

// ── Sortable table headers ──────────────────────────────────────────────────
/**
 * Column sorting for a client-side table. `accessors` maps a column key to the value
 * that column sorts on; spread `th(key)` onto a <SortableTh> and run the rows through
 * `apply()` before slicing them for pagination.
 */
export const useTableSort = <T,>(
  accessors: Record<string, (row: T) => unknown>,
  initial: SortState = null,
) => {
  const [sort, setSort] = useState<SortState>(initial);
  return {
    sort,
    apply: (rows: T[]) => sortRows(rows, sort, accessors),
    th: (key: string) => ({
      dir: sort?.key === key ? sort.dir : undefined,
      onSort: () => setSort(current => nextSort(current, key)),
    }),
  };
};

export const SortableTh: React.FC<{
  dir?: SortDir;
  onSort: () => void;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ dir, onSort, children, style }) => (
  <th style={{ ...style, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
    <button
      type="button"
      onClick={onSort}
      title="คลิกเพื่อเรียงลำดับ"
      style={{
        all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
        font: 'inherit', color: dir ? 'var(--primary-color)' : 'inherit',
      }}
    >
      {children}
      {dir === 'asc' ? <ChevronUp size={13} /> : dir === 'desc' ? <ChevronDown size={13} />
        : <ChevronsUpDown size={13} style={{ opacity: 0.35 }} />}
    </button>
  </th>
);

// ── useUrlSearch — keep a list filter in the URL ────────────────────────────
/**
 * Drop-in replacement for `useState('')` on a list page's search box. Parking the value
 * in the query string means refresh, browser-back and a pasted link all restore the same
 * filtered view, and the global search in the sidebar can deep-link straight into it.
 * Writes use `replace` so typing does not bury the previous page in history.
 *
 * The input binds to a local state value that updates synchronously on every keystroke;
 * the URL is only rewritten once typing pauses. Going through the router on each keystroke
 * used to drop characters from fast input — a barcode scanner "types" a 10+ digit code in
 * a few milliseconds, faster than the router could settle, so only the first 2-3 digits
 * landed. Debouncing the URL write keeps the field in sync with what was actually typed.
 */
export const useUrlSearch = (param = 'q') => {
  const [params, setParams] = useSearchParams();
  const urlValue = params.get(param) ?? '';
  const [value, setValue] = useState(urlValue);

  // Adopt external URL changes (browser back/forward, sidebar deep-link) that we did not
  // originate. Our own debounced write settles on urlValue === value, so this is a no-op then.
  useEffect(() => {
    setValue(prev => (prev === urlValue ? prev : urlValue));
  }, [urlValue]);

  // Push the current value into the query string once typing pauses.
  useEffect(() => {
    if (value === urlValue) return;
    const id = window.setTimeout(() => {
      setParams(prev => {
        const copy = new URLSearchParams(prev);
        if (value) copy.set(param, value);
        else copy.delete(param);
        return copy;
      }, { replace: true });
    }, 250);
    return () => window.clearTimeout(id);
  }, [value, urlValue, param, setParams]);

  return [value, setValue] as const;
};

/**
 * Deep link `?open=<id>`: once the record is in `items`, calls `open(item)` and drops the param so a
 * refresh or "back" doesn't reopen it. Used by notification links to land on the exact record.
 * If the list has loaded but the id isn't in it (deleted, filtered out server-side), the param is dropped.
 */
export function useOpenFromUrl<T>(items: T[], getId: (item: T) => string, open: (item: T) => void, loaded = items.length > 0) {
  const [params, setParams] = useSearchParams();
  const wanted = params.get('open');
  // Latest callbacks without re-running the effect on every render.
  const openRef = useRef(open);
  const getIdRef = useRef(getId);
  useEffect(() => {
    openRef.current = open;
    getIdRef.current = getId;
  });
  useEffect(() => {
    if (!wanted || !loaded) return;
    const item = items.find(i => getIdRef.current(i) === wanted);
    if (item) openRef.current(item);
    setParams(prev => {
      const copy = new URLSearchParams(prev);
      copy.delete('open');
      return copy;
    }, { replace: true });
  }, [wanted, items, loaded, setParams]);
}

/** Renders its children directly under <body> (for fixed overlays that must escape the page layout). */
export const BodyPortal: React.FC<{ children: React.ReactNode }> = ({ children }) => createPortal(children, document.body);
