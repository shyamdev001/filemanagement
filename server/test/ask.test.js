import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ask } from '../src/lib/ask.js';
import { englishName } from '../src/lib/transliterate.js';

const cfg = JSON.parse(fs.readFileSync(new URL('../config/datasheets.default.json', import.meta.url), 'utf8'));

// Made-up customers: names, villages and numbers are not real.
let n = 0;
const ok = (v = true) => ({ ok: v, problems: v ? [] : ['missing'] });
function make(o) {
  n++;
  const c = {
    _id: `c${n}`,
    sheet: 'Residential',
    name: 'રમેશભાઈ સોમાભાઈ પટેલ',
    village: 'પીપળાવ',
    taluka: 'પેટલાદ',
    mobile: `900000${String(n).padStart(4, '0')}`,
    mobiles: [`900000${String(n).padStart(4, '0')}`],
    kw: 3.24,
    panelRaw: 'અદાણી ૫૪૫ વોટ',
    inverterRaw: 'સોલારયાન ૩.૬',
    inverterSerial: 'S1',
    ...o,
  };
  const has = { dcr: true, fl: true, agreement: true, payee: true, datasheet: true, ...(o.has || {}) };
  c.englishNameShown = o.english || englishName(c.name);
  c.status = {
    payee: ok(has.payee),
    datasheet: ok(has.datasheet),
    inverter: { ...ok(!!c.inverterSerial || !/સોલારયાન/.test(c.inverterRaw)), type: /સોલારયાન/.test(c.inverterRaw) ? 'warranty' : 'datasheet', problems: c.inverterSerial ? [] : ['Inverter serial number not entered'] },
    dcr: ok(has.dcr),
    fl: ok(has.fl),
    agreement: ok(has.agreement),
    bill: { inFile: !!o.bill },
    insurance: { inFile: false },
  };
  c.status.ready = Object.values({ a: c.status.payee, b: c.status.datasheet, c: c.status.inverter, d: c.status.dcr, e: c.status.fl, f: c.status.agreement }).every((x) => x.ok);
  delete c.has;
  delete c.english;
  delete c.bill;
  return c;
}

const people = () => {
  n = 0; // the same numbers every time
  return [
  make({ name: 'રમેશભાઈ સોમાભાઈ પટેલ' }), // 1 Pipalav, ready
  make({ name: 'કિરણબેન મહેશભાઈ પરમાર', has: { dcr: false } }), // 2 Pipalav, no DCR
  make({ name: 'મનુભાઈ ગોપાળભાઈ મકવાણા', village: 'સોજીત્રા', taluka: 'સોજીત્રા', kw: 4.32, panelRaw: 'વારી ૫૪૦ વોટ', inverterRaw: 'VELOX 4.6', inverterSerial: '' }), // 3 Sojitra
  make({ name: 'સુરેશભાઈ રામભાઈ રબારી', village: 'પેટલાદ', taluka: 'પેટલાદ', kw: 5.4, panelRaw: 'APS ટોપકોન ૬૦૦ વોટ', inverterSerial: '', printedAt: new Date() }), // 4 Petlad, printed, no serial
  make({ name: 'દિનેશભાઈ કાળાભાઈ ઠાકોર', sheet: 'PASHUPALAK', village: 'રાસ', taluka: 'બોરસદ', kw: 2.16, printedAt: new Date(), sentAt: new Date(), has: { fl: false, agreement: false } }), // 5 Ras, sent
  ];
};
const find = (q) => ask(q, people(), cfg);
const names = (r) => r.customers.map((c) => c.englishNameShown.split(' ')[0]);

test('the example: a village and files ready', () => {
  const r = find('tell me customers who has village piplav and files is ready');
  assert.equal(r.total, 1);
  assert.deepEqual([...r.filters].sort(), ['Files ready', 'Village PIPLAV']);
});

test('village written in Gujarati letters, and spelled differently', () => {
  assert.equal(find('પીપળાવ').total, 2);
  assert.equal(find('pipalav customers').total, 2);
  assert.equal(find('sojitra').total, 1);
});

test('several villages are OR', () => {
  assert.equal(find('pipalav or ras').total, 3);
});

test('not ready and missing documents', () => {
  assert.equal(find('not ready').total, 3);
  assert.equal(find('pipalav missing dcr').total, 1);
  assert.equal(find('without dcr').total, 1);
  assert.equal(find('fl and agreement missing').total, 1);
  assert.equal(find('with dcr').total, 4);
});

test('a negation covers the whole list', () => {
  assert.equal(find('without fl, agreement').total, 1);
  assert.equal(find('no fl or agreement').total, 1);
});

test('printed and sent', () => {
  assert.equal(find('printed').total, 2);
  assert.equal(find('printed not sent').total, 1);
  assert.equal(find('to send').total, 1);
  assert.equal(find('sent').total, 1);
  assert.equal(find('not printed').total, 3);
  assert.equal(find('ready to print').total, 2); // Ramesh and Manu: ready, not printed
});

test('size, comparisons and ranges', () => {
  assert.equal(find('above 4 kw').total, 2);
  assert.equal(find('more than 5 kw').total, 1);
  assert.equal(find('below 3 kw').total, 1);
  assert.equal(find('3.24 kw').total, 2);
  assert.equal(find('between 4 and 5 kw').total, 1);
  assert.equal(find('4kw or more').total, 2);
  assert.equal(find('> 5 kw').total, 1);
});

test('brands, with or without saying inverter or panel', () => {
  assert.equal(find('adani').total, 3);
  assert.equal(find('waaree').total, 1);
  assert.equal(find('velox inverter').total, 1);
  assert.equal(find('solaryaan').total, 4);
  assert.equal(find('aps topcon').total, 1);
  assert.equal(find('545 w').total, 3);
});

test('serial only matters for SOLARYAAN', () => {
  const r = find('solaryaan without serial');
  assert.equal(r.total, 1);
  assert.equal(find('missing serial').total, 1);
});

test('sheet, and filters combined', () => {
  assert.equal(find('pashupalak').total, 1);
  assert.equal(find('residential ready').total, 2);
  assert.equal(find('petlad printed solaryaan missing serial').total, 1);
});

test('names, and a mobile number', () => {
  assert.equal(find('named ramesh patel').total, 1);
  assert.equal(find('kiranben').total, 1);
  assert.equal(find('ramesh ready').total, 1);
  assert.equal(find('mobile 9000000003').total, 1);
  assert.equal(find('9000000003').total, 1);
});

test('first N, and a village that does not exist', () => {
  const r = find('first 2 customers');
  assert.equal(r.shown, 2);
  assert.equal(r.total, 5);
  const none = find('village sakarpura ready');
  assert.equal(none.total, 0);
  assert.ok(none.notes.some((x) => /could not find a village/.test(x)));
});

test('a village that is also a taluka uses the village', () => {
  const r = find('petlad');
  assert.equal(r.total, 1);
  assert.ok(r.notes.some((x) => /also a taluka/.test(x)));
  assert.equal(find('taluka petlad').total, 3);
});

test('nothing understood: everyone, with a hint', () => {
  const r = ask('', people(), cfg);
  assert.equal(r.total, 5);
  assert.ok(r.notes.length);
});

test('waaree topcon means the panel', () => {
  const r = find('waaree topcon');
  assert.deepEqual(r.filters, ['Waaree panels', 'TOPCon panels']);
});
