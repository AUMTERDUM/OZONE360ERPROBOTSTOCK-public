/**
 * Robot QR stickers printed by the system encode a URL (…/robot/<SN>). Fields that take a serial
 * number want the SN itself, so unwrap our own robot URLs; anything else passes through trimmed.
 */
export function normalizeScan(raw: string): string {
  const text = raw.trim();
  const match = /\/robot\/([^/?#\s]+)/i.exec(text);
  if (match && /^(https?:\/\/|\/)/i.test(text)) {
    try { return decodeURIComponent(match[1]).trim(); } catch { return match[1].trim(); }
  }
  return text;
}
