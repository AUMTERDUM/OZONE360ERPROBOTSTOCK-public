const LATIN_REGEX = /[A-Za-z]/;

function normalizeDisplayText(value?: string | null) {
  return (value || '')
    .replace(/\s+/g, ' ')
    .replace(/[，、；]+/g, ', ')
    .replace(/\s*\/\s*/g, ' / ')
    .trim();
}

export function extractDisplayEnglish(value?: string | null, fallback = '—') {
  const text = normalizeDisplayText(value);
  if (!text) return fallback;

  const candidates = text
    .split(/\s*\/\s*|\s+\|\s+|\s+｜\s+/)
    .flatMap(segment => segment.split(/\s+[–—-]\s+/))
    .map(segment => segment.trim())
    .filter(Boolean);

  let best = '';
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    const latinChars = (candidate.match(/[A-Za-z]/g) || []).length;
    const digitChars = (candidate.match(/[0-9]/g) || []).length;
    const cjkChars = (candidate.match(/[\u3400-\u9FFF\uF900-\uFAFF]/g) || []).length;
    const score = latinChars * 5 + digitChars - cjkChars * 6;
    if (score > bestScore && latinChars > 0) {
      best = candidate;
      bestScore = score;
    }
  }

  if (best) return best;

  const stripped = text
    .replace(/[\u3400-\u9FFF\uF900-\uFAFF]/g, ' ')
    .replace(/[（）【】《》「」]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (LATIN_REGEX.test(stripped) || /[0-9]/.test(stripped)) return stripped;

  return text || fallback;
}

export function sanitizeCategoryDisplay(value?: string | null) {
  const parts = (value || '')
    .split(',')
    .map(part => extractDisplayEnglish(part, '').trim())
    .filter(Boolean);
  return Array.from(new Set(parts)).join(', ');
}
export function formatTicketNo(id: string): string {
  return `#${id.slice(0, 8).toUpperCase()}`;
}
