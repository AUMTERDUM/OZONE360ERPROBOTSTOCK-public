export type SortDir = 'asc' | 'desc';
export type SortState = { key: string; dir: SortDir } | null;

const isEmpty = (value: unknown) => value === null || value === undefined || value === '';

/**
 * Orders two non-empty table cells. Numbers compare numerically, everything else uses
 * localeCompare with `numeric` so Thai labels sort like a reader expects and "SN-10"
 * lands after "SN-9" instead of before it. ISO dates (YYYY-MM-DD) sort chronologically
 * as plain strings, so no date parsing is needed.
 */
export function compareCells(left: unknown, right: unknown): number {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  if (typeof left === 'boolean' && typeof right === 'boolean') return Number(left) - Number(right);
  return String(left).localeCompare(String(right), 'th', { numeric: true, sensitivity: 'base' });
}

/** Returns a new array; the input is usually React state and must not be mutated. */
export function sortRows<T>(rows: T[], sort: SortState, accessors: Record<string, (row: T) => unknown>): T[] {
  if (!sort) return rows;
  const get = accessors[sort.key];
  if (!get) return rows;
  const factor = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((left, right) => {
    const a = get(left);
    const b = get(right);
    // Empty cells sink to the bottom in BOTH directions — flipping a column should never
    // fill the first screen with blanks.
    if (isEmpty(a) || isEmpty(b)) return isEmpty(a) && isEmpty(b) ? 0 : isEmpty(a) ? 1 : -1;
    return compareCells(a, b) * factor;
  });
}

/** Click cycle for a column header: asc → desc → back to the page's default order. */
export function nextSort(current: SortState, key: string): SortState {
  if (current?.key !== key) return { key, dir: 'asc' };
  return current.dir === 'asc' ? { key, dir: 'desc' } : null;
}
