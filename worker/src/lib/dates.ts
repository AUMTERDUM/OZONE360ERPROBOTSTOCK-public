export function addDays(isoDate: string, days: number): string {
  const next = new Date(isoDate);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}

export function addMonths(isoDate: string, months: number): string {
  const [y, m, day] = isoDate.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + months, day));
  // Handle month-end overflow (e.g. Jan 31 + 1m → roll back to Feb 28).
  if (d.getUTCDate() !== day) { d.setUTCDate(0); }
  return d.toISOString().slice(0, 10);
}
