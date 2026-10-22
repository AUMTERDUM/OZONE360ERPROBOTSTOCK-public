const THAI_LOCALE = 'th-TH';
const THAI_TIME_ZONE = 'Asia/Bangkok';
const SQLITE_UTC_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;

export function parseThaiDateValue(value: string): Date {
  if (SQLITE_UTC_TIMESTAMP_RE.test(value) && !/[zZ]|[+-]\d{2}:\d{2}$/.test(value)) {
    return new Date(`${value.replace(' ', 'T')}Z`);
  }
  return new Date(value);
}

export function formatThaiDate(
  value: string,
  options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' },
): string {
  if (!value) return '-';
  return parseThaiDateValue(value).toLocaleDateString(THAI_LOCALE, {
    ...options,
    timeZone: THAI_TIME_ZONE,
  });
}

export function formatThaiDateTime(
  value: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'short', timeStyle: 'short' },
): string {
  if (!value) return '-';
  return parseThaiDateValue(value).toLocaleString(THAI_LOCALE, {
    ...options,
    timeZone: THAI_TIME_ZONE,
  });
}

/** Today's date (YYYY-MM-DD) in Thai time. `toISOString()` is UTC, which is still "yesterday" before 07:00 in Thailand. */
export function todayISO(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
}
