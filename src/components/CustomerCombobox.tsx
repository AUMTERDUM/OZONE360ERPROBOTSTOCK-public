import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Search, X, Plus } from 'lucide-react';
import type { Customer } from '../context/DataContext';

interface Props {
  value: string;
  onChange: (id: string) => void;
  customers: Customer[];
  /** Name of a new customer staged locally (not yet in DB) */
  pendingName?: string;
  /** Called when user stages a new name (pass '' to clear) */
  onPendingName?: (name: string) => void;
  required?: boolean;
  placeholder?: string;
  /** ไปอยู่บน <input> ข้างใน เพื่อให้ <label htmlFor> ของหน้าที่เรียกใช้ผูกได้ */
  id?: string;
}

export const CustomerCombobox: React.FC<Props> = ({
  value,
  onChange,
  customers,
  pendingName = '',
  onPendingName,
  required,
  placeholder = 'ค้นหาหรือเพิ่มลูกค้า...',
  id,
}) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = customers.find(c => c.id === value);

  const filtered = useMemo(() => {
    const list = [...customers].sort((a, b) => a.name.localeCompare(b.name, 'th'));
    if (!query.trim()) return list.slice(0, 30);
    const q = query.toLowerCase();
    return list.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.contactPerson && c.contactPerson.toLowerCase().includes(q))
    );
  }, [query, customers]);

  const exactMatch = customers.some(c => c.name.toLowerCase() === query.trim().toLowerCase());
  const showAdd = query.trim().length >= 2 && !exactMatch;

  // Total selectable items = filtered customers + (showAdd ? 1 : 0)
  const totalItems = filtered.length + (showAdd ? 1 : 0);

  // Reset activeIdx when list changes
  useEffect(() => { setActiveIdx(-1); }, [query, open]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(prev => (prev + 1) % totalItems);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(prev => (prev <= 0 ? totalItems - 1 : prev - 1));
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault();
      if (activeIdx < filtered.length) {
        handleSelect(filtered[activeIdx].id);
      } else if (showAdd) {
        handleStagePending();
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }, [open, activeIdx, totalItems, filtered, showAdd]);

  // Scroll active item into view
  useEffect(() => {
    if (activeIdx >= 0 && listRef.current) {
      const items = listRef.current.querySelectorAll('[role="option"]');
      items[activeIdx]?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIdx]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSelect = (id: string) => {
    onChange(id);
    onPendingName?.('');
    setQuery('');
    setOpen(false);
  };

  const handleClearSelected = () => {
    onChange('');
    setQuery('');
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleClearPending = () => {
    onPendingName?.('');
    setQuery('');
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleStagePending = () => {
    if (!query.trim()) return;
    // Just stage the name locally — DB write happens when parent form submits
    onPendingName?.(query.trim());
    onChange('');
    setQuery('');
    setOpen(false);
  };

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      {/* Existing customer chip */}
      {selected ? (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 12px', borderRadius: 8,
          border: '1.5px solid var(--accent-primary)',
          background: 'var(--accent-subtle)',
        }}>
          <span style={{ flex: 1, fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>
            {selected.name}
          </span>
          {selected.contactPerson && (
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{selected.contactPerson}</span>
          )}
          <button
            type="button"
            onClick={handleClearSelected}
            title="เปลี่ยนลูกค้า"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', color: 'var(--text-muted)',
              padding: 2, borderRadius: 4, flexShrink: 0,
            }}
          >
            <X size={14} />
          </button>
        </div>
      ) : pendingName ? (
        /* Pending new customer chip — will be created on form submit */
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 12px', borderRadius: 8,
          border: '1.5px dashed var(--accent-primary)',
          background: 'var(--accent-subtle)',
        }}>
          <span style={{ flex: 1, fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>
            {pendingName}
          </span>
          <span style={{
            fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
            background: 'var(--accent-primary)', color: 'var(--text-on-accent)',
            borderRadius: 4, padding: '1px 5px', flexShrink: 0,
          }}>ใหม่</span>
          <button
            type="button"
            onClick={handleClearPending}
            title="ยกเลิก"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', color: 'var(--text-muted)',
              padding: 2, borderRadius: 4, flexShrink: 0,
            }}
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <>
          {/* Input */}
          <div style={{ position: 'relative' }}>
            <Search
              size={14}
              style={{
                position: 'absolute', left: 10, top: '50%',
                transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none',
              }}
            />
            {/* ไม่มี id = หน้าที่เรียกไม่ได้ผูก <label> ไว้ ใช้ placeholder เป็นชื่อแทน */}
            <input
              id={id}
              aria-label={id ? undefined : placeholder}
              ref={inputRef}
              className="form-control"
              style={{ paddingLeft: 32 }}
              value={query}
              onChange={e => { setQuery(e.target.value); setOpen(true); }}
              onFocus={() => setOpen(true)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              required={required && !value && !pendingName}
              autoComplete="off"
              role="combobox"
              aria-expanded={open}
              aria-haspopup="listbox"
              aria-autocomplete="list"
              aria-activedescendant={activeIdx >= 0 ? `cust-opt-${activeIdx}` : undefined}
            />
          </div>

          {/* Item panel */}
          {open && (
            <div ref={listRef} role="listbox" style={{
              position: 'absolute', top: '110%', left: 0, right: 0, zIndex: 1100,
              background: 'var(--bg-secondary)', border: '1px solid var(--border-color-strong)',
              borderRadius: 10, boxShadow: 'var(--shadow-lg)',
              maxHeight: 300, overflowY: 'auto',
              padding: 6, display: 'flex', flexDirection: 'column', gap: 3,
            }}>
              {filtered.map((c, idx) => (
                <CustomerItem key={c.id} customer={c} onSelect={handleSelect} isActive={idx === activeIdx} id={`cust-opt-${idx}`} />
              ))}

              {showAdd && (
                <button
                  type="button"
                  id={`cust-opt-${filtered.length}`}
                  role="option"
                  aria-selected={activeIdx === filtered.length}
                  onClick={handleStagePending}
                  style={{
                    textAlign: 'left', padding: '9px 12px', borderRadius: 8,
                    border: '1.5px dashed var(--accent-primary)',
                    background: activeIdx === filtered.length ? 'var(--accent-subtle)' : 'none', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 8,
                    color: 'var(--accent-primary)',
                    flexShrink: 0,
                  }}
                >
                  <Plus size={14} />
                  <span style={{ fontSize: 13, fontWeight: 600 }}>
                    เพิ่ม &ldquo;{query.trim()}&rdquo; เป็นลูกค้าใหม่
                  </span>
                </button>
              )}

              {filtered.length === 0 && !showAdd && (
                <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                  ไม่พบลูกค้า
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

const CustomerItem: React.FC<{ customer: Customer; onSelect: (id: string) => void; isActive?: boolean; id?: string }> = ({ customer, onSelect, isActive, id }) => {
  const [hovered, setHovered] = useState(false);
  const highlight = hovered || isActive;
  return (
    <button
      type="button"
      id={id}
      role="option"
      aria-selected={isActive}
      onClick={() => onSelect(customer.id)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        textAlign: 'left', padding: '8px 12px', borderRadius: 8,
        border: `1px solid ${highlight ? 'var(--accent-primary)' : 'var(--border-color)'}`,
        background: highlight ? 'var(--accent-subtle)' : 'none',
        cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 2,
        transition: 'border-color 0.1s, background 0.1s', flexShrink: 0,
      }}
    >
      <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{customer.name}</span>
      {customer.contactPerson && (
        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{customer.contactPerson}</span>
      )}
    </button>
  );
};
