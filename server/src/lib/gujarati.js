const GU_DIGITS = '૦૧૨૩૪૫૬૭૮૯';

// ૦૧૨૩ → 0123
export const toAscii = (s) => String(s ?? '').replace(/[૦-૯]/g, (d) => GU_DIGITS.indexOf(d));

// 0123 → ૦૧૨૩
export const toGujarati = (s) => String(s ?? '').replace(/[0-9]/g, (d) => GU_DIGITS[d]);

// Collapse runs of whitespace (including line breaks inside Excel cells).
export const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// All 10-digit mobile numbers found in a cell; a cell may hold two numbers.
export function parseMobiles(raw) {
  const s = toAscii(clean(raw));
  const found = s.match(/\d{10,}/g) || [];
  return [...new Set(found.filter((m) => m.length === 10))];
}

// "૪..૦૯" / ".૩.૨૪" / "3.24" → 4.09 / 3.24 / 3.24 (null when unreadable)
export function parseNumber(raw) {
  const s = toAscii(clean(raw)).replace(/\.{2,}/g, '.').replace(/^\./, '');
  const m = s.match(/\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}
