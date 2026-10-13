import { toAscii } from './gujarati.js';
import { englishName } from './transliterate.js';

/**
 * Work out what a pasted line contains, whatever the column order:
 *   mobile number, application number (NP-…), inverter serial number, and a name (English or Gujarati).
 */
export function parseLine(raw) {
  const line = toAscii(String(raw || '')).trim();
  const out = { mobile: '', appNo: '', serial: '', name: '' };
  if (!line) return null;
  const nameWords = [];
  const gujarati = [];
  for (const cell of line.split(/[\t,;|]+/)) {
    const c = cell.trim();
    if (!c) continue;
    const digits = c.replace(/\D/g, '');
    // a whole cell that is a phone number, even written "98765 43210" or "+91-…"
    if (/^[+\d][\d\s-]*$/.test(c) && (digits.length === 10 || (digits.length === 12 && digits.startsWith('91'))) && /^[6-9]/.test(digits.slice(-10))) {
      out.mobile = out.mobile || digits.slice(-10);
      continue;
    }
    for (const tok of c.split(/\s+/)) {
      const t = tok.replace(/^[^\p{L}\p{M}\p{N}+]+|[^\p{L}\p{M}\p{N}]+$/gu, '');
      if (!t) continue;
      const d = t.replace(/\D/g, '');
      if (/^NP-?[A-Z0-9]{3,8}-?\d{5,12}$/i.test(t.replace(/\s/g, ''))) out.appNo = out.appNo || t.toUpperCase();
      else if (/^\+?\d{10,12}$/.test(t) && /^[6-9]\d{9}$/.test(d.slice(-10)) && (d.length === 10 || d.startsWith('91'))) out.mobile = out.mobile || d.slice(-10);
      else if (/^[A-Z0-9]{9,22}$/i.test(t) && d.length >= 6) out.serial = out.serial || t.toUpperCase();
      else if (/[઀-૿]/.test(t)) gujarati.push(t);
      else if (/^[A-Za-z][A-Za-z.']*$/.test(t)) nameWords.push(t.replace(/[.']/g, '').toUpperCase());
    }
  }
  out.name = nameWords.length >= 2 ? nameWords.join(' ') : gujarati.length ? englishName(gujarati.join(' ')) : nameWords.join(' ');
  return out;
}

/**
 * A serial number with one character missing or extra, compared with the others in the list.
 * Returns the corrected serial when exactly one correction fits the pattern the others share, else ''.
 */
export function suggestSerial(odd, others) {
  if (!others.length) return '';
  const len = others[0].length;
  const same = others.filter((o) => o.length === len);
  // positions where every other serial has the same character, or at least the same kind of character
  const fits = (s) =>
    s.length === len &&
    [...s].every((ch, i) => {
      const col = same.map((o) => o[i]);
      if (col.every((x) => x === col[0])) return ch === col[0];
      if (col.every((x) => /\d/.test(x))) return /\d/.test(ch);
      if (col.every((x) => /[A-Z]/.test(x))) return /[A-Z]/.test(ch);
      return true;
    });
  const found = new Set();
  if (odd.length === len - 1) {
    for (let i = 0; i <= odd.length; i++) for (const ch of '0123456789') if (fits(odd.slice(0, i) + ch + odd.slice(i))) found.add(odd.slice(0, i) + ch + odd.slice(i));
  } else if (odd.length === len + 1) {
    for (let i = 0; i < odd.length; i++) if (fits(odd.slice(0, i) + odd.slice(i + 1))) found.add(odd.slice(0, i) + odd.slice(i + 1));
  }
  // A missing digit in a run of free digits could be anything; only suggest when one answer fits.
  return found.size === 1 ? [...found][0] : '';
}

/** The usual length of serial numbers, from the ones already saved and the ones being pasted. */
export function usualLength(serials) {
  const count = new Map();
  for (const s of serials) if (s) count.set(s.length, (count.get(s.length) || 0) + 1);
  const top = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
  return top && top[1] >= 3 ? top[0] : 0;
}
