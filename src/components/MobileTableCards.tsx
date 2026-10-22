import { useEffect } from 'react';

const PHONE_QUERY = '(max-width: 640px)';
const MIN_COLUMNS = 4;

const rowsOf = (table: HTMLTableElement) => Array.from(table.tBodies).flatMap(body => Array.from(body.rows));

// Copies each column header onto the cells beneath it (data-label) so the stylesheet can show
// "Header: value" rows when a wide table is rendered as cards on a phone.
function labelTable(table: HTMLTableElement) {
  if (table.closest('.modal-content, .no-cards, .table-responsive-cards')) return;
  const head = table.tHead;
  const headerRow = head?.rows[head.rows.length - 1];
  if (!headerRow) return;
  const headers = Array.from(headerRow.cells);
  if (headers.length < MIN_COLUMNS || headers.some(cell => cell.colSpan > 1)) return;

  const labels = headers.map(cell => (cell.textContent || '').replace(/\s+/g, ' ').trim());
  if (!table.hasAttribute('data-cards')) table.setAttribute('data-cards', '');
  for (const row of rowsOf(table)) {
    Array.from(row.cells).forEach((cell, index) => {
      const label = cell.colSpan > 1 ? '' : labels[index] ?? '';
      if (cell.getAttribute('data-label') !== label) cell.setAttribute('data-label', label);
    });
  }
}

const labelAllTables = () => document.querySelectorAll<HTMLTableElement>('table').forEach(labelTable);

/**
 * On phones, wide list tables are shown as one card per row (see the table[data-cards] rules in
 * index.css) instead of scrolling sideways. This labels the cells those rules need, and keeps
 * them labelled as pages load, filter and paginate.
 */
export default function MobileTableCards() {
  useEffect(() => {
    const media = window.matchMedia(PHONE_QUERY);
    let observer: MutationObserver | null = null;
    let frame = 0;

    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(labelAllTables);
    };
    const sync = () => {
      observer?.disconnect();
      observer = null;
      cancelAnimationFrame(frame);
      if (!media.matches) return;
      labelAllTables();
      // childList only: setting attributes must not retrigger the observer.
      observer = new MutationObserver(schedule);
      observer.observe(document.body, { childList: true, subtree: true });
    };
    sync();
    media.addEventListener('change', sync);
    return () => {
      media.removeEventListener('change', sync);
      observer?.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  return null;
}
