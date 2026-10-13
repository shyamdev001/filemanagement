// Gujarati name → English spelling, the way names are usually written in Gujarat
// (રમેશભાઈ → RAMESHBHAI, જશવંતસિંહ → JASHVANTSINH). It is a suggestion: spellings on a
// customer's own documents can differ, so the app always lets staff overwrite it.

const CONSONANTS = {
  ક: 'k', ખ: 'kh', ગ: 'g', ઘ: 'gh', ઙ: 'n',
  ચ: 'ch', છ: 'chh', જ: 'j', ઝ: 'z', ઞ: 'n',
  ટ: 't', ઠ: 'th', ડ: 'd', ઢ: 'dh', ણ: 'n',
  ત: 't', થ: 'th', દ: 'd', ધ: 'dh', ન: 'n',
  પ: 'p', ફ: 'f', બ: 'b', ભ: 'bh', મ: 'm',
  ય: 'y', ર: 'r', લ: 'l', વ: 'v', શ: 'sh', ષ: 'sh', સ: 's', હ: 'h', ળ: 'l',
};
const VOWELS = { અ: 'a', આ: 'a', ઇ: 'i', ઈ: 'i', ઉ: 'u', ઊ: 'u', ઋ: 'ru', એ: 'e', ઍ: 'e', ઐ: 'ai', ઓ: 'o', ઑ: 'o', ઔ: 'au' };
const MATRAS = { 'ા': 'a', 'િ': 'i', 'ી': 'i', 'ુ': 'u', 'ૂ': 'u', 'ૃ': 'ru', 'ે': 'e', 'ૅ': 'e', 'ૈ': 'ai', 'ો': 'o', 'ૉ': 'o', 'ૌ': 'au' };
const VIRAMA = '્';
const ANUSVARA = 'ં';
const LABIALS = new Set(['પ', 'ફ', 'બ', 'ભ', 'મ']);

// Name endings that are separate words in speech: each part ends without the inherent "a".
const SUFFIXES = ['ભાઈ', 'ભાઇ', 'બેન', 'બહેન', 'સિંહ', 'સિંગ', 'સિહ', 'કુમાર', 'કુમારી', 'લાલ', 'દાસ', 'ચંદ', 'ખાન', 'રાય', 'રાજ', 'ગીરી', 'ગિરી', 'શંકર', 'પ્રસાદ', 'ઉદીન', 'ઉદ્દીન'];

function splitSuffixes(word) {
  const parts = [];
  let rest = word;
  for (;;) {
    const s = SUFFIXES.find((x) => rest.length > x.length + 1 && rest.endsWith(x));
    if (!s) break;
    parts.unshift(s);
    rest = rest.slice(0, -s.length);
  }
  return [rest, ...parts];
}

// Usual spellings the rules below get wrong. Add to this list as staff report them.
const FIXED = {
  પ્રજાપતિ: 'prajapati',
  ઘનશ્યામ: 'ghanshyam',
  બેંક: 'bank',
};

/** One spoken part (no suffix inside) → Latin letters. */
function part(word) {
  if (FIXED[word]) return FIXED[word];
  // Units: { c: consonant letters, v: vowel or null for the inherent "a", bare: no vowel at all, joined: follows a virama }
  const units = [];
  const chars = [...word];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (CONSONANTS[ch]) {
      const u = { c: CONSONANTS[ch], v: null, bare: false, joined: chars[i - 1] === VIRAMA };
      const next = chars[i + 1];
      if (next === VIRAMA) {
        u.bare = true;
        i++;
      } else if (MATRAS[next]) {
        u.v = MATRAS[next];
        i++;
      }
      units.push(u);
    } else if (VOWELS[ch]) {
      units.push({ c: '', v: VOWELS[ch], bare: false, joined: false });
    } else if (ch === ANUSVARA) {
      units.push({ c: LABIALS.has(chars[i + 1]) ? 'm' : 'n', v: null, bare: true, joined: false });
    } else if (ch === 'ઃ') {
      units.push({ c: 'h', v: null, bare: true, joined: false });
    } else if (/[a-zA-Z0-9.]/.test(ch)) {
      units.push({ c: ch.toLowerCase(), v: null, bare: true, joined: false });
    }
  }

  // Drop the inherent "a" where it is not spoken, working from the end of the word.
  const syllables = units.filter((u) => !u.bare).length;
  for (let i = units.length - 1; i >= 0; i--) {
    const u = units[i];
    if (u.bare || u.v !== null || !u.c) continue;
    const prev = units[i - 1];
    const next = units[i + 1];
    const afterVowel = prev && !prev.bare;
    if (!next) {
      // word end: silent, except after a conjunct (ચંદ્ર → chandra) or in a one-syllable word
      if (!u.joined && syllables > 1) u.bare = true;
    } else if (afterVowel && !u.joined && !next.bare && next.c) {
      // between a vowel and a full syllable (રમેશભાઈ: શ, પરમાર: ર)
      u.bare = true;
    }
  }
  return units.map((u) => u.c + (u.bare ? '' : (u.v ?? 'a'))).join('');
}

export function englishName(gujarati) {
  return String(gujarati || '')
    .normalize('NFC')
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((word) => splitSuffixes(word.replace(/[()]/g, '')).map(part).join(''))
    .filter(Boolean)
    .join(' ')
    .toUpperCase();
}
