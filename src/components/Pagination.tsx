import React from 'react';

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

export default function Pagination({ page, pageSize, total, onPageChange, onPageSizeChange }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const pages: (number | string)[] = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= page - 1 && i <= page + 1)) {
      pages.push(i);
    } else if (pages[pages.length - 1] !== '…') {
      pages.push('…');
    }
  }

  const btnBase: React.CSSProperties = {
    minWidth: 40, height: 40, padding: '0 0.5rem', borderRadius: 6, fontSize: '0.82rem',
    fontWeight: 500, cursor: 'pointer', border: '1px solid var(--border-color)',
    background: 'transparent', color: 'var(--text-secondary)', transition: 'all .12s',
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      flexWrap: 'wrap', gap: '0.5rem',
      padding: '0.65rem 1rem',
      borderTop: '1px solid var(--border-color)',
      fontSize: '0.82rem',
      color: 'var(--text-muted)',
    }}>
      {/* Left: page size + total */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
        <span>แสดง</span>
        <select aria-label="จำนวนแถวต่อหน้า"
          value={pageSize}
          onChange={e => { onPageSizeChange(Number(e.target.value)); onPageChange(1); }}
          style={{
            padding: '0.2rem 0.4rem', borderRadius: 6,
            border: '1px solid var(--border-color)',
            background: 'var(--bg-primary)', color: 'var(--text-primary)',
            fontSize: '0.82rem', cursor: 'pointer',
          }}
        >
          {[10, 20, 50, 100].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <span>รายการ/หน้า · ทั้งหมด <strong style={{ color: 'var(--text-primary)' }}>{total}</strong> รายการ</span>
        {totalPages > 1 && (
          <span style={{ marginLeft: '0.25rem' }}>· หน้า {page}/{totalPages}</span>
        )}
      </div>

      {/* Right: page buttons */}
      {totalPages > 1 && (
        <nav role="navigation" aria-label="แบ่งหน้า" style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
          <button
            aria-label="หน้าก่อนหน้า"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            style={{ ...btnBase, opacity: page <= 1 ? 0.35 : 1, cursor: page <= 1 ? 'not-allowed' : 'pointer' }}
          >‹</button>

          {pages.map((p, i) =>
            typeof p === 'string' ? (
              <span key={`e${i}`} style={{ padding: '0 0.15rem', color: 'var(--text-muted)', userSelect: 'none' }}>…</span>
            ) : (
              <button
                key={p}
                onClick={() => onPageChange(p)}
                aria-label={`หน้า ${p}`}
                aria-current={p === page ? 'page' : undefined}
                style={{
                  ...btnBase,
                  background: p === page ? 'var(--accent-primary)' : 'transparent',
                  color: p === page ? 'var(--text-on-accent)' : 'var(--text-secondary)',
                  borderColor: p === page ? 'var(--accent-primary)' : 'var(--border-color)',
                  fontWeight: p === page ? 700 : 500,
                }}
              >{p}</button>
            )
          )}

          <button
aria-label="หน้าถัดไป"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            style={{ ...btnBase, opacity: page >= totalPages ? 0.35 : 1, cursor: page >= totalPages ? 'not-allowed' : 'pointer' }}
          >›</button>
        </nav>
      )}
    </div>
  );
}
