import { toAscii } from './gujarati.js';
import { soundKey, nameKeys, sameWord } from './names.js';
import { englishName } from './transliterate.js';
import { parsePanels, parseInverter } from './parsers.js';

/**
 * "Ask": a plain-words question turned into filters, with no AI. The sentence is cut into words, every
 * word that means a filter is taken out (and shown back as a chip), and what is left is read as a name.
 * Filters are combined with AND; several villages, brands or sheets in one question are OR.
 *
 *   customers of Pipalav with files ready
 *   not ready, missing DCR, Petlad
 *   printed not sent
 *   solaryaan above 3.5 kw without serial
 */

const STOP = new Set(
  ('tell me show list give get find display customers customer people persons files file who whose which that are is was be been have has having with and or the of in from a an all please pls plz also their there them those these to for at on by any only just now today ' +
    'status where what how many much number count total bro sir village taluka town name named called it its do does did data details info entries entry records row rows mobile phone contact ending starts begin begins ' +
    'inverter inverters panel panels model everyone everything one who whom want need see check kindly oh ok okay yes no not').split(' ')
);
const NEG = new Set(['missing', 'without', 'no', 'not', 'lacking', 'lacks', 'pending', 'baki', 'nahi', 'nathi', 'never', 'wo']);
const POS = new Set(['with', 'has', 'have', 'having', 'uploaded', 'done', 'ok', 'available', 'got', 'attached', 'there']);
const JOIN = new Set(['and', 'or', ',', '&', '+', 'plus']);
const FILLER = new Set(['the', 'a', 'any', 'their', 'its', 'his', 'her', 'of']);

const CMP = {
  ge: ['atleast', 'least', 'minimum', 'min'],
  le: ['atmost', 'most', 'maximum', 'max'],
  gt: ['above', 'over', 'more', 'greater', 'exceeding', 'bigger', 'higher'],
  lt: ['below', 'under', 'less', 'smaller', 'lower'],
  eq: ['exactly', 'equal', 'equals'],
};
const CMP_TEXT = { gt: 'above', ge: 'at least', lt: 'below', le: 'at most', eq: '' };
const compare = (op, a, b) => (op === 'gt' ? a > b : op === 'ge' ? a >= b : op === 'lt' ? a < b : op === 'le' ? a <= b : Math.abs(a - b) < 0.006);

const DOCS = {
  dcr: { words: ['dcr'], label: 'DCR', has: (r) => r.c.status.dcr.ok },
  fl: { words: ['fl', 'feasibility'], label: 'FL', has: (r) => r.c.status.fl.ok },
  agreement: { words: ['agreement', 'agr'], label: 'Agreement', has: (r) => r.c.status.agreement.ok },
  // the serial is only needed for SOLARYAAN inverters
  serial: { words: ['serial', 'serials', 'sn'], label: 'Inverter serial', has: (r) => !!r.c.inverterSerial, missing: (r) => r.c.status.inverter.type === 'warranty' && !r.c.inverterSerial },
  payee: { words: ['payee'], label: 'Payee certificate', has: (r) => r.c.status.payee.ok },
  datasheet: { words: ['datasheet', 'datasheets'], label: 'Panel datasheet', has: (r) => r.c.status.datasheet.ok },
  warranty: { words: ['warranty'], label: 'Inverter card', has: (r) => r.c.status.inverter.ok },
  bill: { words: ['bill', 'bills'], label: 'Bill', has: (r) => !!r.c.status.bill?.inFile },
  insurance: { words: ['insurance', 'policy'], label: 'Insurance', has: (r) => !!r.c.status.insurance?.inFile },
  application: { words: ['application'], label: 'Application number', has: (r) => !!r.c.applicationNumber },
  notes: { words: ['note', 'notes'], label: 'Notes', has: (r) => (r.c.notes || []).length > 0 },
};
const isMissing = (key, r) => (DOCS[key].missing ? DOCS[key].missing(r) : !DOCS[key].has(r));

const BRANDS = {
  solaryaan: { inv: 'solaryaan', name: 'SOLARYAAN' }, solaryan: { inv: 'solaryaan', name: 'SOLARYAAN' }, solarian: { inv: 'solaryaan', name: 'SOLARYAAN' }, solariyan: { inv: 'solaryaan', name: 'SOLARYAAN' },
  velox: { inv: 'velox', name: 'VELOX' }, polycab: { inv: 'polycab', name: 'Polycab' }, solex: { inv: 'solex', name: 'Solex' }, solax: { inv: 'solex', name: 'Solex' },
  goodwe: { inv: 'goodwe', name: 'GoodWe' }, havells: { inv: 'havells', name: 'Havells' },
  adani: { pan: 'adani', name: 'Adani' }, tata: { pan: 'tata', name: 'Tata' },
  waaree: { pan: 'waaree', inv: 'waaree', name: 'Waaree' }, waree: { pan: 'waaree', inv: 'waaree', name: 'Waaree' }, vari: { pan: 'waaree', inv: 'waaree', name: 'Waaree' },
  aps: { pan: 'aps', inv: 'aps', name: 'APS' },
};
const SHEETS = { residential: 'Residential', resi: 'Residential', pashupalak: 'PASHUPALAK', pashupalan: 'PASHUPALAK', pashu: 'PASHUPALAK', commercial: 'commercial', comm: 'commercial' };

const PHRASES = [
  [['printed', 'but', 'not', 'sent'], ['printed', 'notsent']],
  [['printed', 'and', 'not', 'sent'], ['printed', 'notsent']],
  [['printed', 'not', 'sent'], ['printed', 'notsent']],
  [['ready', 'to', 'print'], ['ready', 'unprinted']],
  [['yet', 'to', 'be', 'sent'], ['printed', 'notsent']],
  [['to', 'be', 'sent'], ['printed', 'notsent']],
  [['to', 'send'], ['printed', 'notsent']],
  [['to', 'print'], ['ready', 'unprinted']],
  [['not', 'yet', 'printed'], ['unprinted']],
  [['not', 'yet', 'sent'], ['notsent']],
  [['yet', 'to', 'print'], ['unprinted']],
  [['not', 'printed'], ['unprinted']],
  [['non', 'printed'], ['unprinted']],
  [['not', 'sent'], ['notsent']],
  [['not', 'ready'], ['notready']],
  [['not', 'complete'], ['notready']],
  [['not', 'completed'], ['notready']],
  [['added', 'by', 'hand'], ['manual']],
  [['by', 'hand'], ['manual']],
].sort((a, b) => b[0].length - a[0].length);
const STATUS_WORDS = {
  ready: ['ready', 'complete', 'completed', 'finished', 'tayar', 'done'],
  notready: ['notready', 'unready', 'incomplete', 'pending', 'baki'],
  printed: ['printed'],
  unprinted: ['unprinted'],
  sent: ['sent'],
  notsent: ['unsent'],
  manual: ['manual', 'manually'],
};
const STATUS = {
  ready: { text: 'Files ready', test: (r) => r.c.status.ready },
  notready: { text: 'Files not ready', test: (r) => !r.c.status.ready },
  printed: { text: 'Printed', test: (r) => !!r.c.printedAt },
  unprinted: { text: 'Not printed', test: (r) => !r.c.printedAt },
  sent: { text: 'Sent', test: (r) => !!r.c.sentAt },
  notsent: { text: 'Not sent', test: (r) => !r.c.sentAt },
  manual: { text: 'Added by hand', test: (r) => !!r.c.manual },
};

export function tokenize(q) {
  const s = toAscii(String(q || ''))
    .toLowerCase()
    .replace(/>=/g, ' atleast ')
    .replace(/<=/g, ' atmost ')
    .replace(/>/g, ' above ')
    .replace(/</g, ' below ')
    .replace(/(\d)\s*(kw|kilowatts?|wp|watts?|w)(?![\p{L}\p{N}])/gu, '$1 $2')
    .replace(/,/g, ' , ')
    .replace(/[?!;:()"'`]+/g, ' ');
  return s.match(/[\p{L}\p{M}\p{N}]+(?:[.\-][\p{L}\p{M}\p{N}]+)*|,|&|\+/gu) || [];
}

const isNum = (s) => /^\d+(\.\d+)?$/.test(s || '');
const hasGu = (s) => /[઀-૿]/.test(s);
const plain = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const list = (items) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}` : items[0]);

/** Rows ready for filtering: the parsed panel / inverter, name keys, places. */
function prepare(customers, cfg) {
  return customers.map((c) => ({
    c,
    panels: parsePanels(c.panelRaw, cfg.panelBrands) || [],
    inv: parseInverter(c.inverterRaw, cfg.inverterBrands) || {},
    nk: nameKeys(c.englishNameShown || c.englishName || ''),
  }));
}

/** Villages and talukas as they would be typed in English letters. */
function placeIndex(rows) {
  const index = { village: new Map(), taluka: new Map(), gu: { village: new Set(), taluka: new Set() }, names: [] };
  for (const field of ['village', 'taluka']) {
    for (const r of rows) {
      const value = plain(r.c[field]);
      if (!value) continue;
      index.gu[field].add(value);
      const en = englishName(value);
      const key = soundKey(en.replace(/[^A-Za-z]/g, ''));
      if (!key) continue;
      if (!index[field].has(key)) index[field].set(key, new Set());
      index[field].get(key).add(value);
      index.names.push({ field, value, en: en.toLowerCase() });
    }
  }
  return index;
}

export function ask(query, customers, cfg) {
  const t = tokenize(query);
  const used = t.map(() => false);
  const filters = [];
  const notes = [];
  const rows = prepare(customers, cfg);
  const add = (text, test) => filters.push({ text, test });
  const free = (i) => i >= 0 && i < t.length && !used[i];
  const take = (i, n = 1) => {
    for (let k = 0; k < n; k++) used[i + k] = true;
  };
  const phraseAt = (i, words) => words.every((w, k) => free(i + k) && t[i + k] === w);
  let limit = 0;
  let wantCount = false;

  // ---- A. status phrases ("not ready", "printed but not sent", "to send") ----
  const flags = new Set();
  for (let i = 0; i < t.length; i++) {
    if (!free(i)) continue;
    if (phraseAt(i, ['how', 'many'])) {
      take(i, 2);
      wantCount = true;
      continue;
    }
    for (const [words, set] of PHRASES) {
      if (phraseAt(i, words)) {
        take(i, words.length);
        set.forEach((f) => flags.add(f));
        break;
      }
    }
  }

  // ---- B. small things: first N, batch N, sheets ----
  const sheets = new Set();
  for (let i = 0; i < t.length; i++) {
    if (!free(i)) continue;
    if (['first', 'top', 'limit', 'next'].includes(t[i]) && free(i + 1) && /^\d+$/.test(t[i + 1])) {
      limit = Number(t[i + 1]);
      take(i, 2);
    } else if (t[i] === 'batch' && free(i + 1) && /^\d+$/.test(t[i + 1])) {
      const n = Number(t[i + 1]);
      add(`Print batch ${n}`, (r) => r.c.printBatch === n);
      take(i, 2);
    } else if (SHEETS[t[i]]) {
      sheets.add(SHEETS[t[i]]);
      take(i);
    } else if (['count', 'total'].includes(t[i])) {
      wantCount = true;
      take(i);
    }
  }
  if (sheets.size) add(`Sheet: ${[...sheets].join(' or ')}`, (r) => [...sheets].some((s) => s.toLowerCase() === String(r.c.sheet).toLowerCase()));

  // ---- C. numbers with a unit: "3.5 kw", "above 3 kw", "between 3 and 5 kw", "545 w" ----
  const compareBefore = (i) => {
    for (let k = i - 1; k >= Math.max(0, i - 3); k--) {
      for (const [op, ws] of Object.entries(CMP)) {
        if (ws.includes(t[k]) && free(k)) {
          take(k);
          for (let m = k + 1; m < i; m++) if (['than', 'to', 'equal'].includes(t[m]) && free(m)) take(m);
          return op;
        }
      }
    }
    return null;
  };
  const compareAfter = (i) => {
    // "3 kw or more", "3 kw and above", "3 kw or less"
    let j = i + 1;
    if (free(j) && (t[j] === 'or' || t[j] === 'and') && free(j + 1)) {
      const w = t[j + 1];
      if (['more', 'above', 'higher', 'greater', 'plus', 'up'].includes(w)) {
        take(j, 2);
        return 'ge';
      }
      if (['less', 'below', 'lower', 'under'].includes(w)) {
        take(j, 2);
        return 'le';
      }
    }
    return null;
  };
  for (let i = 1; i < t.length; i++) {
    if (!free(i) || !free(i - 1) || !isNum(t[i - 1])) continue;
    const n = Number(t[i - 1]);
    if (['kw', 'kilowatt', 'kilowatts'].includes(t[i])) {
      if (t[i - 2] === 'and' && isNum(t[i - 3]) && free(i - 3) && free(i - 2) && t[i - 4] === 'between' && free(i - 4)) {
        const [lo, hi] = [Number(t[i - 3]), n].sort((a, b) => a - b);
        take(i - 4, 5);
        take(i);
        add(`System size ${lo} to ${hi} kW`, (r) => r.c.kw != null && r.c.kw >= lo && r.c.kw <= hi);
        continue;
      }
      take(i - 1, 2);
      const op = compareBefore(i - 1) || compareAfter(i) || 'eq';
      add(`System size ${CMP_TEXT[op] ? CMP_TEXT[op] + ' ' : ''}${n} kW`, (r) => r.c.kw != null && compare(op, r.c.kw, n));
    } else if (['w', 'watt', 'watts', 'wp'].includes(t[i]) && n >= 300 && n <= 800) {
      take(i - 1, 2);
      const op = compareBefore(i - 1) || compareAfter(i) || 'eq';
      add(`Panel ${CMP_TEXT[op] ? CMP_TEXT[op] + ' ' : ''}${n} W`, (r) => r.panels.some((p) => p.watt != null && compare(op, p.watt, n)));
    }
  }

  // ---- D. documents: "missing DCR", "without FL", "with agreement", "dcr and fl missing" ----
  const docIdx = [];
  const docWords = Object.entries(DOCS).flatMap(([k, d]) => d.words.map((w) => [w, k]));
  const portalWords = ['documents', 'docs', 'document', 'pdfs', 'pdf'];
  t.forEach((w, i) => {
    if (!free(i)) return;
    const hit = docWords.find(([word]) => word === w);
    if (hit) docIdx.push({ i, key: hit[1] });
    else if (portalWords.includes(w)) docIdx.push({ i, key: 'portal' });
  });
  const docs = [];
  let anyOr = false;
  for (const d of docIdx) {
    let neg = null;
    let lead = false;
    let j = d.i - 1;
    while (j >= 0 && FILLER.has(t[j])) j--;
    if (j >= 0 && free(j) && NEG.has(t[j])) {
      neg = true;
      lead = true;
      take(j);
    } else if (j >= 0 && free(j) && POS.has(t[j])) {
      neg = false;
      lead = true;
      take(j);
    } else if (j >= 0 && JOIN.has(t[j])) {
      let k = j;
      while (k >= 0 && JOIN.has(t[k])) k--;
      const prev = docs[docs.length - 1];
      if (prev && prev.i === k && prev.lead) {
        neg = prev.neg;
        lead = true;
      }
      if (t.slice(k + 1, d.i).includes('or')) anyOr = true;
    }
    if (neg === null) {
      const f = t[d.i + 1];
      if (free(d.i + 1) && f === 'not') {
        neg = true;
        take(d.i + 1);
        if (free(d.i + 2) && ['uploaded', 'available', 'done', 'there', 'yet', 'attached'].includes(t[d.i + 2])) take(d.i + 2);
      } else if (free(d.i + 1) && NEG.has(f)) {
        neg = true;
        take(d.i + 1);
      } else if (free(d.i + 1) && ['uploaded', 'done', 'available', 'attached'].includes(f)) {
        neg = false;
        take(d.i + 1);
      }
      if (neg === true) {
        // "dcr and fl missing": the word after them covers the bare ones before
        for (let m = docs.length - 1; m >= 0 && docs[m].bare; m--) {
          const between = t.slice(docs[m].i + 1, m === docs.length - 1 ? d.i : docs[m + 1].i);
          if (!between.every((w) => JOIN.has(w))) break;
          docs[m].neg = true;
        }
      }
    }
    const bare = neg === null;
    take(d.i);
    // "serial number", "application no"
    if (['serial', 'serials', 'application'].includes(t[d.i]) && free(d.i + 1) && ['number', 'no', 'numbers'].includes(t[d.i + 1])) take(d.i + 1);
    docs.push({ ...d, neg: neg === true, lead, bare });
  }
  if (docs.length) {
    const portal = docs.filter((d) => d.key === 'portal');
    const single = docs.filter((d) => d.key !== 'portal');
    for (const d of portal) {
      const keys = ['dcr', 'fl', 'agreement'];
      if (d.neg) add('Missing a portal document (DCR, FL or Agreement)', (r) => keys.some((k) => isMissing(k, r)));
      else add('Has all portal documents (DCR, FL and Agreement)', (r) => keys.every((k) => DOCS[k].has(r)));
    }
    if (single.length) {
      const text = (d) => (d.neg ? `Missing ${DOCS[d.key].label}` : `Has ${DOCS[d.key].label}`);
      const test = (d) => (r) => (d.neg ? isMissing(d.key, r) : DOCS[d.key].has(r));
      if (anyOr && single.length > 1) add(single.map(text).join(' or '), (r) => single.some((d) => test(d)(r)));
      else single.forEach((d) => add(text(d), test(d)));
    }
  }

  // ---- E. brands and panel type: "adani", "solaryaan inverter", "waaree panel", "topcon" ----
  const panelSet = new Set();
  const invSet = new Set();
  const eitherSet = new Set();
  let topcon = false;
  for (let i = 0; i < t.length; i++) {
    if (!free(i)) continue;
    if (t[i] === 'topcon' || t[i] === 'topcons') {
      topcon = true;
      take(i);
      continue;
    }
    const b = BRANDS[t[i]];
    if (!b) continue;
    take(i);
    const near = (w) => [i - 1, i + 1].find((k) => free(k) && w.includes(t[k]));
    const ni = near(['inverter', 'inverters']);
    const np = near(['panel', 'panels']);
    if (ni != null) {
      take(ni);
      if (b.inv) invSet.add(b.name + '|' + b.inv);
    } else if (np != null) {
      take(np);
      if (b.pan) panelSet.add(b.name + '|' + b.pan);
    } else if (b.inv && b.pan) eitherSet.add(b.name + '|' + b.pan + '|' + b.inv);
    else if (b.inv) invSet.add(b.name + '|' + b.inv);
    else panelSet.add(b.name + '|' + b.pan);
  }
  // only panels can be TOPCon, so "waaree topcon" means the panel
  if (topcon) for (const e of eitherSet) {
    const [name, pan] = e.split('|');
    panelSet.add(`${name}|${pan}`);
    eitherSet.delete(e);
  }
  const nameOf = (s) => s.split('|')[0];
  const second = (s) => s.split('|')[1];
  if (panelSet.size) add(`${list([...panelSet].map(nameOf))} panels`, (r) => r.panels.some((p) => [...panelSet].some((s) => second(s) === p.brand)));
  if (invSet.size) add(`${list([...invSet].map(nameOf))} inverter`, (r) => [...invSet].some((s) => second(s) === r.inv.brand));
  if (eitherSet.size) {
    add(`${list([...eitherSet].map(nameOf))} (panel or inverter)`, (r) => [...eitherSet].some((s) => r.panels.some((p) => p.brand === s.split('|')[1]) || r.inv.brand === s.split('|')[2]));
  }
  if (topcon) add('TOPCon panels', (r) => r.panels.some((p) => p.topcon));

  // ---- F. single status words ----
  for (let i = 0; i < t.length; i++) {
    if (!free(i)) continue;
    for (const [flag, words] of Object.entries(STATUS_WORDS)) {
      if (words.includes(t[i])) {
        flags.add(flag);
        take(i);
        break;
      }
    }
  }
  for (const f of ['ready', 'notready', 'printed', 'unprinted', 'sent', 'notsent', 'manual']) if (flags.has(f)) add(STATUS[f].text, STATUS[f].test);

  // ---- G. numbers: mobile, application number, serial, consumer number ----
  for (let i = 0; i < t.length; i++) {
    if (!free(i)) continue;
    const w = t[i];
    const app = /^np-?[a-z0-9]+-?\d{4,}$/.test(w);
    const serial = /^\d{6,}[a-z][0-9a-z]{3,}$/.test(w);
    const digits = /^\d{4,}$/.test(w);
    if (!app && !serial && !digits) continue;
    take(i);
    const needle = w.replace(/-/g, '');
    add(app ? `Application ${w.toUpperCase()}` : serial ? `Serial ${w.toUpperCase()}` : `Number ${w}`, (r) => {
      const c = r.c;
      const fields = [...(c.mobiles || []), c.mobile, c.applicationNumber, c.inverterSerial, c.portal?.consumerNo].map((x) => String(x || '').toLowerCase().replace(/-/g, ''));
      return fields.some((f) => f && f.includes(needle));
    });
  }

  // ---- H. "named Ramesh Patel" ----
  const nameWords = [];
  for (let i = 0; i < t.length; i++) {
    if (!free(i) || !['named', 'called', 'name'].includes(t[i])) continue;
    take(i);
    if (free(i + 1) && t[i + 1] === 'is') take(i + 1);
    for (let k = i + 1; k < t.length && nameWords.length < 6 && free(k) && !JOIN.has(t[k]) && !STOP.has(t[k]) && !isNum(t[k]); k++) {
      nameWords.push(t[k]);
      take(k);
    }
  }

  // ---- I. places: villages and talukas, English or Gujarati letters ----
  const index = placeIndex(rows);
  const villages = new Set();
  const talukas = new Set();
  const placeText = [];
  const notFound = [];
  const bothNames = [];
  const candidate = (i) => free(i) && t[i] && !STOP.has(t[i]) && !JOIN.has(t[i]) && !/\d/.test(t[i]) && t[i].length >= 3;
  const lookup = (word, field) => {
    if (hasGu(word)) {
      const hit = [...index.gu[field]].filter((v) => v === word || (word.length >= 3 && v.startsWith(word)));
      return hit.length ? new Set(hit) : null;
    }
    return index[field].get(soundKey(word.replace(/[^a-z]/g, ''))) || null;
  };
  for (let i = 0; i < t.length; i++) {
    const explicit = free(i) && (t[i] === 'village' || t[i] === 'taluka' || t[i] === 'town') ? (t[i] === 'taluka' ? 'taluka' : 'village') : null;
    const start = explicit ? i + 1 : i;
    if (!candidate(start)) continue;
    // two words first ("nar pura"), then one
    let width = 0;
    let got = null;
    for (const w of [2, 1]) {
      if (w === 2 && !candidate(start + 1)) continue;
      const word = t.slice(start, start + w).join('');
      const v = explicit !== 'taluka' ? lookup(word, 'village') : null;
      const tk = explicit !== 'village' ? lookup(word, 'taluka') : null;
      if (v || tk) {
        width = w;
        got = { word, v, tk };
        break;
      }
    }
    if (!got) {
      if (explicit) {
        // the person named a village that does not exist: say so, with the closest ones
        take(i, 2);
        notFound.push(t[start]);
        const near = [...new Set(index.names.filter((n) => n.field === (explicit === 'taluka' ? 'taluka' : 'village') && n.en.startsWith(t[start].slice(0, 3))).map((n) => `${n.en.toUpperCase()}`))].slice(0, 6);
        notes.push(`I could not find a ${explicit} called "${t[start]}".${near.length ? ` Did you mean: ${near.join(', ')}?` : ''}`);
        placeText.push(`${explicit === 'taluka' ? 'Taluka' : 'Village'} ${t[start]} (not found)`);
      }
      continue;
    }
    if (explicit) take(i);
    take(start, width);
    if (got.v && (explicit !== 'taluka')) {
      got.v.forEach((x) => villages.add(x));
      placeText.push(`Village ${got.word.toUpperCase()}`);
      if (got.tk && !explicit) bothNames.push(got.word.toUpperCase());
    } else if (got.tk) {
      got.tk.forEach((x) => talukas.add(x));
      placeText.push(`Taluka ${got.word.toUpperCase()}`);
    }
  }
  if (placeText.length) {
    const noMatch = notFound.length > 0 && !villages.size && !talukas.size;
    add(placeText.join(' or '), (r) => !noMatch && (villages.has(plain(r.c.village)) || talukas.has(plain(r.c.taluka))));
    if (bothNames.length) notes.push(`${bothNames.join(', ')} is also a taluka. I used the village; write "taluka ${bothNames[0].toLowerCase()}" for everyone in the taluka.`);
  }

  // ---- J. whatever is left is read as a name ----
  for (let i = 0; i < t.length; i++) {
    if (free(i) && !STOP.has(t[i]) && !JOIN.has(t[i]) && !isNum(t[i]) && t[i].length >= 2) {
      nameWords.push(t[i]);
      take(i);
    }
  }
  if (nameWords.length) {
    const wants = nameWords.map((w) => (hasGu(w) ? { gu: w } : { k: nameKeys(w)[0], w })).filter((x) => x.gu || x.k);
    const same = (want, k) => sameWord(want, k) > 0 || (want.full.length >= 3 && k.full.startsWith(want.full));
    add(`Name: ${nameWords.join(' ')}`, (r) => wants.every((x) => (x.gu ? String(r.c.name || '').includes(x.gu) : r.nk.some((k) => same(x.k, k)))));
  }

  const ignored = t.filter((w, i) => free(i) && isNum(w));
  const matched = rows.filter((r) => filters.every((f) => f.test(r)));
  let out = matched.map((r) => r.c);
  const total = out.length;
  if (limit) out = out.slice(0, limit);
  if (!filters.length) notes.push(t.length ? 'I could not find a filter in this, so this is everyone. Try: "village Petlad, files ready".' : 'Type what you want to see.');
  if (ignored.length) notes.push(`I did not use: ${ignored.join(', ')}.`);
  return { filters: filters.map((f) => f.text), total, limit, shown: out.length, notes, wantCount, customers: out };
}

/** The short row the Ask page shows for each customer, with what is missing in plain words. */
export function askRow(c) {
  const st = c.status;
  const missing = [];
  if (!st.payee.ok) missing.push('Payee');
  if (!st.datasheet.ok) missing.push('Datasheet');
  if (!st.inverter.ok) missing.push(st.inverter.problems.some((p) => /serial/i.test(p)) ? 'Serial' : 'Inverter');
  if (!st.dcr.ok) missing.push('DCR');
  if (!st.agreement.ok) missing.push('Agreement');
  if (!st.fl.ok) missing.push('FL');
  return {
    id: String(c._id),
    name: c.name,
    english: c.englishNameShown || '',
    village: c.village || '',
    taluka: c.taluka || '',
    mobile: c.mobile || '',
    sheet: c.sheet,
    kw: c.kw ?? null,
    panel: c.panelRaw || '',
    inverter: c.inverterRaw || '',
    ready: !!st.ready,
    printed: !!c.printedAt,
    sent: !!c.sentAt,
    missing,
    notes: (c.notes || []).length,
  };
}
