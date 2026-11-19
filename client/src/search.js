// Searching customers by words: "kanu lalji rabari" finds KANUBHAI LALJIBHAI RABARI, "rabari kanu" too.
// Every word you type must be found somewhere in the customer, in any order. A word is found when a word of the customer
// starts with it, sounds the same (spelling variants), or is the same name without BHAI / BEN / KUMAR.

const GU_DIGITS = '૦૧૨૩૪૫૬૭૮૯';
export const toAscii = (s) => String(s ?? '').replace(/[૦-૯]/g, (d) => GU_DIGITS.indexOf(d));
const ENDING = /(BHAI|BEN|BAHEN|BEHN|KUMARI|KUMAR)$/;

/** A word reduced to how it sounds (the same rules as the server's names.js). */
export function soundKey(word) {
  let w = String(word || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (!w) return '';
  w = w
    .replace(/SINGH?$|SINH$|SIH$/, 'SINH')
    .replace(/PH/g, 'F')
    .replace(/W/g, 'V')
    .replace(/Q/g, 'K')
    .replace(/Z/g, 'J')
    .replace(/X/g, 'KS')
    .replace(/CHH?/g, 'C')
    .replace(/C/g, 'K')
    .replace(/SH/g, 'S')
    .replace(/([BDGJKPT])H/g, '$1')
    .replace(/Y/g, 'I')
    .replace(/(?<=.)[NM](?=[BCDFGJKLPRSTV])/g, '');
  const rest = w.slice(1).replace(/[AEIOUH]/g, '');
  return (w[0] + rest).replace(/(.)\1+/g, '$1');
}

const split = (s) => toAscii(s).toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);
const hasGu = (s) => /[઀-૿]/.test(s);
const bare = (w) => {
  const b = w.toUpperCase().replace(ENDING, '');
  return (b.length >= 3 ? b : w.toUpperCase());
};

const cache = new WeakMap();
/** What a customer can be found by, worked out once. */
function prepared(c) {
  let p = cache.get(c);
  if (p) return p;
  const latin = [c.englishNameShown, c.englishName, c.villageEnglish, c.talukaEnglish]
    .flatMap((x) => split(x))
    .filter((w) => /^[a-z0-9]+$/.test(w));
  const words = [...new Set(latin)].map((w) => ({ w, sound: soundKey(w), bare: bare(w) }));
  const gu = split([c.name, c.village, c.taluka].join(' ')).filter(hasGu);
  const other = toAscii([c.inverterSerial, c.applicationNumber, ...(c.mobiles || []), c.mobile, ...(c.notes || []).map((n) => n.text), c.note].join(' ')).toLowerCase();
  p = { words, gu, other };
  cache.set(c, p);
  return p;
}

function tokenMatches(token, p) {
  if (hasGu(token)) return p.gu.some((g) => g.startsWith(token) || (token.length >= 3 && g.includes(token))) || p.other.includes(token);
  if (/^\d+$/.test(token)) return p.other.includes(token);
  const sound = soundKey(token);
  const tb = bare(token);
  return (
    p.words.some(
      (x) =>
        x.w.startsWith(token) ||
        (token.length >= 3 && (x.sound === sound || (sound.length >= 2 && x.sound.startsWith(sound)) || (tb.length >= 3 && x.bare === tb)))
    ) || (token.length >= 3 && p.other.includes(token))
  );
}

/** A function that says whether a customer fits what was typed. An empty query fits everyone. */
export function matcher(query) {
  const tokens = split(query);
  if (!tokens.length) return () => true;
  return (c) => {
    const p = prepared(c);
    return tokens.every((t) => tokenMatches(t, p));
  };
}

/** Brand of the panels in an Excel panel cell ("અદાણી ૫૪૫ વોટ" → ["adani"]). */
export function panelBrands(raw) {
  const s = String(raw || '');
  return [['અદાણી', 'adani'], ['વારી', 'waaree'], ['ટાટા', 'tata'], ['aps', 'aps']].filter(([gu]) => new RegExp(gu, 'i').test(s)).map(([, en]) => en);
}
