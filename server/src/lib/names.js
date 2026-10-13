// Matching an English name written by one person (ERP, portal, a list) to a customer whose English
// name was written by another, or made from the Gujarati name. The same name is often spelled
// differently (ISHWARBHAI / ISHVARBHAI, THAKKER / THAKKAR, IQBAL / IKBAL, PUJABHAI / PUNJABHAI),
// written in a different order (surname first or last), cut short, or given a different courtesy
// ending (KALPESHBHAI / KALPESHKUMAR, DHARMISTHA / DHARMISTHABEN).

/** A word reduced to how it sounds: spelling differences collapse to the same key. */
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
    // the nasal before a consonant is written or left out (PUNJA / PUJA, CHANDU / CHADU)
    .replace(/(?<=.)[NM](?=[BCDFGJKLPRSTV])/g, '');
  const rest = w.slice(1).replace(/[AEIOUH]/g, '');
  return (w[0] + rest).replace(/(.)\1+/g, '$1');
}

// Courtesy endings that people add, drop or swap freely.
const ENDING = /(BHAI|BEN|BAHEN|BEHN|KUMARI|KUMAR)$/;

const words = (name) => String(name || '').toUpperCase().split(/[^A-Z]+/).filter((w) => w.length > 1);
const form = (word) => {
  const bare = word.replace(ENDING, '');
  return { full: soundKey(word), stem: soundKey(bare.length >= 3 ? bare : word) };
};

/** A customer's name prepared for findByName. */
export const nameKeys = (englishName) => words(englishName).map(form).filter((f) => f.full);

// How alike two words are: 3 = same, 2 = one is the other cut short, 1 = same name with a different ending.
function sameWord(a, b) {
  if (a.full === b.full) return 3;
  const [short, long] = a.full.length <= b.full.length ? [a.full, b.full] : [b.full, a.full];
  if (short.length >= 4 && long.startsWith(short)) return 2;
  return a.stem.length >= 3 && a.stem === b.stem ? 1 : 0;
}

/**
 * Customers whose name has the same words as `name`, in any order.
 * Returns the best matches only: [] = nobody, one entry = found, several = cannot tell them apart.
 * `customers` items need { keys } prepared with nameKeys().
 */
export function findByName(name, customers) {
  return matchByName(name, customers).hits;
}

/**
 * Same as findByName, plus how sure the match is:
 *   'same'     every word sounds the same
 *   'short'    a word was cut short
 *   'ending'   a word has a different ending (BHAI / KUMAR): probably the same person, worth a glance
 */
export function matchByName(name, customers) {
  const want = nameKeys(name);
  if (want.length < 2) return { hits: [], quality: null };
  let best = 0;
  let hits = [];
  let weakest = 3;
  for (const c of customers) {
    if (c.keys.length !== want.length) continue;
    const free = [...c.keys];
    let score = 0;
    let low = 3;
    for (const w of want) {
      let pick = -1;
      let got = 0;
      free.forEach((k, i) => {
        const s = sameWord(w, k);
        if (s > got) [got, pick] = [s, i];
      });
      if (pick < 0) {
        score = -1;
        break;
      }
      score += got;
      low = Math.min(low, got);
      free.splice(pick, 1);
    }
    if (score < 0) continue;
    if (score > best) [best, hits, weakest] = [score, [c], low];
    else if (score === best) hits.push(c);
  }
  return { hits, quality: hits.length ? { 3: 'same', 2: 'short', 1: 'ending' }[weakest] : null };
}

/** Customers who share all but one word with `name`: offered as "did you mean" when nothing matched. */
export function nearNames(name, customers, limit = 3) {
  const want = nameKeys(name);
  if (want.length < 2) return [];
  return customers
    .map((c) => {
      const free = [...c.keys];
      let n = 0;
      for (const w of want) {
        const i = free.findIndex((k) => sameWord(w, k) > 0);
        if (i >= 0) {
          n++;
          free.splice(i, 1);
        }
      }
      return { c, n };
    })
    .filter((x) => x.n >= Math.max(2, want.length - 1))
    .sort((a, b) => b.n - a.n)
    .slice(0, limit)
    .map((x) => x.c);
}
