import { toAscii, clean } from './gujarati.js';

const norm = (s) => toAscii(clean(s)).toLowerCase();

// Positions of every brand alias in the text, in reading order.
function findBrands(text, brands) {
  const hits = [];
  for (const [brand, aliases] of Object.entries(brands)) {
    for (const alias of aliases) {
      const a = alias.toLowerCase();
      let from = 0;
      for (;;) {
        const i = text.indexOf(a, from);
        if (i < 0) break;
        hits.push({ brand, at: i });
        from = i + a.length;
      }
    }
  }
  return hits.sort((x, y) => x.at - y.at);
}

/**
 * Parse the પેનલ cell into one item per distinct panel.
 *   "અદાણી ૫૩૫(૪) ૫૫૫(૨)"                  → adani 535, adani 555
 *   "APS ૬૦૦(૫) વારી ૬૧૫ નોન DCR (૦૩)"     → aps 600, waaree 615 (nonDcr)
 *   "વારી"                                  → waaree, watt null (user must choose)
 */
export function parsePanels(raw, brands) {
  let s = norm(raw);
  if (!s) return [];
  // Drop panel counts: "(4)", "( 3 )", "09 પેનલ"
  s = s.replace(/\(\s*\d+\s*\)/g, ' ').replace(/\d+\s*પેનલ/g, ' ');

  const hits = findBrands(s, brands);
  const segments = hits.length
    ? hits.map((h, i) => ({
        brand: h.brand,
        text: s.slice(i === 0 ? 0 : h.at, i + 1 < hits.length ? hits[i + 1].at : s.length),
      }))
    : [{ brand: null, text: s }];

  const items = [];
  for (const seg of segments) {
    const topcon = /ટોપ\s*કોન|topcon/.test(seg.text);
    const nonDcr = /નોન|non/.test(seg.text);
    const watts = [...seg.text.matchAll(/(?<![\d.])\d{3}(?![\d.])/g)]
      .map((m) => Number(m[0]))
      .filter((w) => w >= 400 && w <= 750);
    const distinct = [...new Set(watts)];
    if (!distinct.length) items.push({ brand: seg.brand, watt: null, topcon, nonDcr });
    for (const watt of distinct) items.push({ brand: seg.brand, watt, topcon, nonDcr });
  }
  // Same brand+watt written twice counts once.
  const seen = new Set();
  return items.filter((it) => {
    const k = `${it.brand}|${it.watt}|${it.topcon}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** "સોલારયાન ૩.૬" → { brand: 'solaryaan', size: 3.6 } */
export function parseInverter(raw, brands) {
  const s = norm(raw);
  if (!s) return { brand: null, size: null };
  const hits = findBrands(s, brands);
  const m = s.match(/\d+(\.\d+)?/);
  return { brand: hits[0]?.brand ?? null, size: m ? parseFloat(m[0]) : null };
}

/** 3.6 → "SYS- 3.6", 6 → "SYS- 6.0" */
export function solaryaanModel(size) {
  if (size == null) return '';
  return `SYS- ${Number.isInteger(size) ? size.toFixed(1) : String(size)}`;
}
