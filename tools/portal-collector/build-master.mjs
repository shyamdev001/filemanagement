// Builds the MASTER SHEET from three Excel files (read only, nothing is changed in the web app or the database):
//   1. My_Applications_List  (the portal's export: one row per application)
//   2. ALL CUSTOMER DATA     (your Excel, all years)
//   3. File Status           (your Excel: file status, subsidy, ERP number, policy)
// and, if you give it, the collector's panels-and-inverters.csv (panel / inverter company from the portal).
//
// Run:  node build-master.mjs ["C:\path\panels-and-inverters.csv"]
// Result: MASTER SHEET.xlsx in this folder (git-ignored: it holds customer data).
//
// A row of your Excel is tied to a portal application only when the MOBILE NUMBER and the NAME both agree
// (the same rule as the web app: a mobile number alone never identifies a person).
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(HERE, '../../server');
const require = createRequire(SERVER + '/package.json');
const ExcelJS = require('exceljs');
const N = await import(pathToFileURL(`${SERVER}/src/lib/names.js`));
const { englishName } = await import(pathToFileURL(`${SERVER}/src/lib/transliterate.js`));

const DOWNLOADS = process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'Downloads') : 'C:/Users/ASUS/Downloads';
const FILES = {
  portal: path.join(DOWNLOADS, 'My_Applications_List (4).xlsx'),
  all: path.join(DOWNLOADS, 'ALL CUSTOMER DATA.xlsx'),
  status: path.join(DOWNLOADS, 'File Status (1).xlsx'),
};
const collectorCsv = process.argv[2] || null;
const OUT = path.join(HERE, 'MASTER SHEET.xlsx');

const text = (v) => (v == null ? '' : typeof v === 'object' ? (v.text ?? v.result ?? (v.richText ? v.richText.map((x) => x.text).join('') : '')) : String(v));
const asc = (s) => String(s).replace(/[૦-૯]/g, (d) => '૦૧૨૩૪૫૬૭૮૯'.indexOf(d));
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const mobilesOf = (s) => {
  const a = asc(s);
  const found = (a.match(/\d{10,}/g) || []).map((x) => x.slice(-10));
  const plain = a.replace(/\D/g, '');
  if (!found.length && plain.length === 10) found.push(plain);
  return [...new Set(found)];
};
const dateOf = (s) => {
  const m = /(\d{4})-(\d\d)-(\d\d)/.exec(String(s));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : clean(s);
};
const num = (s) => {
  const x = Number(asc(clean(s)).replace(/,/g, ''));
  return Number.isFinite(x) && clean(s) !== '' ? x : clean(s);
};

async function rowsOf(file, sheetName, firstRow) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet(sheetName);
  if (!ws) throw new Error(`sheet "${sheetName}" not found in ${file}`);
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row, n) => { if (n >= firstRow) rows.push(row.values.slice(1).map(text)); });
  return rows;
}

// ---- 1. the portal list ----
const portalRows = (await rowsOf(FILES.portal, 'Sheet1', 2)).filter((v) => /^NP[-/]/i.test(clean(v[1])));
const entities = [];
const byMobile = new Map();
const byApp = new Map();
const link = (e, mob) => { if (!byMobile.has(mob)) byMobile.set(mob, []); if (!byMobile.get(mob).includes(e)) byMobile.get(mob).push(e); };
for (const v of portalRows) {
  const e = {
    portal: {
      sr: v[0], app: clean(v[1]).toUpperCase(), discom: clean(v[2]), circle: clean(v[3]), division: clean(v[4]), sub: clean(v[5]),
      cons: clean(v[6]), name: clean(v[7]), mobile: asc(v[8]).replace(/\D/g, '').slice(-10), kw: num(v[9]), status: clean(v[10]), submitted: clean(v[11]),
      reverification: clean(v[12]), duplicate: clean(v[13]),
    },
    mobiles: new Set(), own: {}, sources: [], dupRows: 0, hint: '',
  };
  e.engName = e.portal.name;
  e.keys = N.nameKeys(e.engName);
  e.mobiles.add(e.portal.mobile);
  link(e, e.portal.mobile);
  entities.push(e);
  byApp.set(e.portal.app, e);
}

// ---- 2. your Excel rows, mapped to common field names ----
const SOURCES = [];
const add = (label, category, rows, map) => SOURCES.push({ label, category, rows, map });
add('ALL CUSTOMER DATA', '', await rowsOf(FILES.all, 'Sheet1', 3), (v) => ({
  name: v[1], village: v[2], taluka: v[3], mobile: v[4], kw: v[5], panels: v[6], panel: v[7], inverter: v[8], payMode: v[9], payDate: v[10], payAmount: v[11], installer: v[12], note: v[13],
}));
add('File Status: Residential', 'Residential', await rowsOf(FILES.status, 'Residential', 3), (v) => ({
  name: v[1], village: v[2], taluka: v[3], mobile: v[4], kw: v[5], panels: v[6], filer: v[7], fileStatus: v[8], subsidy: v[9], erp: v[10], policyNo: v[11], policyPrice: v[12], note: v[13], policyTerm: v[15],
}));
add('File Status: data sheet', 'Residential', await rowsOf(FILES.status, 'The data has not been received;', 3), (v) => ({
  name: v[1], village: v[2], taluka: v[3], mobile: v[4], kw: v[5], panels: v[6], panel: v[7], inverter: v[8], installer: v[9], filer: v[10], fileStatus: v[11], subsidy: v[12], erp: v[13], policyNo: v[14], policyTerm: v[18] || v[15], note: v[16], policyPrice: v[17],
}));
add('File Status: Pashupalak', 'Pashupalak', await rowsOf(FILES.status, 'PASHUPALAK', 2), (v) => ({
  name: v[1], village: v[2], taluka: v[3], mobile: v[4], filer: v[5], fileStatus: v[6], erp: v[7], policyNo: v[8], policyPrice: v[9], policyTerm: v[10],
}));
add('File Status: Commercial', 'Commercial', await rowsOf(FILES.status, 'commercial', 3), (v) => ({
  name: v[1], village: v[2], taluka: v[3], mobile: v[4], kw: v[5], panels: v[6], panel: v[7], inverter: v[8], payMode: v[9], payDate: v[10], payAmount: v[11], installer: v[15], note: v[16],
}));

const kwOf = (x) => { const n = Number(asc(clean(x))); return Number.isFinite(n) && clean(x) !== '' ? n : null; };
const agree = (e, r) => N.namesAgree(e.engName, r.keys) || N.namesAgree(r.engName, e.keys);
let skipped = 0;
const FIELDS = ['name', 'village', 'taluka', 'kw', 'panels', 'panel', 'inverter', 'payMode', 'payDate', 'payAmount', 'installer', 'filer', 'fileStatus', 'subsidy', 'erp', 'policyNo', 'policyPrice', 'policyTerm', 'note'];
const notes = new Map(); // entity -> list of distinct notes

for (const src of SOURCES) {
  for (const v of src.rows) {
    const r = src.map(v);
    r.name = clean(r.name);
    // skip title / header / total rows: a real customer row starts with a serial number and has a name
    if (!r.name || !/^\d+$/.test(asc(clean(v[0])))) { skipped++; continue; }
    r.engName = englishName(r.name);
    r.keys = N.nameKeys(r.engName);
    r.mobiles = mobilesOf(r.mobile);
    const sameMobile = [...new Set(r.mobiles.flatMap((m) => byMobile.get(m) || []))];
    const label = src.label;
    const hits = sameMobile.filter((e) => agree(e, r));
    // The same person can have several installations (several application numbers, same name and mobile).
    // A row belongs to the installation with the same kW; the same installation listed twice is one record.
    const kwR = kwOf(r.kw);
    const kwKnown = (h) => (h.portal ? kwOf(h.portal.kw) : kwOf(h.own.kw));
    const kwEqual = (h) => kwR != null && kwKnown(h) != null && Math.abs(kwKnown(h) - kwR) <= 0.06;
    let e;
    if (hits.length) {
      const free = hits.filter((h) => !h.sources.includes(label));
      const taken = hits.filter((h) => h.sources.includes(label));
      if (hits.length === 1 && free.length === 1) e = free[0];
      else if (free.length && (e = free.find(kwEqual) || (hits.length > 1 ? null : free[0]))) { /* free installation with the same kW */ }
      else if ((e = taken.find(kwEqual))) { /* the same installation listed again */ }
      else if (taken.length === 1 && free.length === 0 && (kwR == null || kwKnown(taken[0]) == null)) e = taken[0];
      else if (free.length && (e = free.find((h) => h.portal && kwKnown(h) == null) || free.find((h) => h.portal))) { /* several installations, none with this kW: closest free one */ }
      else e = null;
    }
    if (!e) {
      e = { portal: null, mobiles: new Set(), own: {}, sources: [], dupRows: 0, engName: r.engName, keys: r.keys, hint: '' };
      const other = sameMobile.find((x) => x.portal && !hits.includes(x));
      if (other) e.hint = `Same mobile as portal application ${other.portal.app} (${other.portal.name}) but the name differs`;
      if (hits.length) e.secondOf = hits[0];
      entities.push(e);
    }
    r.mobiles.forEach((m) => { e.mobiles.add(m); link(e, m); });
    if (e.sources.includes(label)) {
      // the same customer listed again in the same file: one record, but say so if the two rows disagree
      e.dupRows++;
      const a = e.firstRows[label];
      for (const [f, nm] of [['kw', 'kW'], ['payAmount', 'payment amount'], ['payDate', 'payment date'], ['panels', 'panel count'], ['panel', 'panel'], ['inverter', 'inverter']]) {
        if (clean(a[f]) && clean(r[f]) && clean(a[f]) !== clean(r[f])) (e.conflicts ||= []).push(`${label}: ${nm} ${clean(a[f])} vs ${clean(r[f])}`);
      }
      continue;
    }
    e.sources.push(label);
    (e.firstRows ||= {})[label] = r;
    e.category = e.category || src.category;
    for (const f of FIELDS) {
      const val = clean(r[f]);
      if (f === 'note') { if (val) { if (!notes.has(e)) notes.set(e, []); if (!notes.get(e).includes(val)) notes.get(e).push(val); } continue; }
      if (val !== '' && (e.own[f] === undefined || e.own[f] === '')) e.own[f] = val;
    }
    if (!e.own.mobile && r.mobiles.length) e.own.mobile = r.mobiles.join(', ');
  }
}

// ---- 2b. same person, spelled differently: join on more evidence than the name ----
// A row of your Excel that shares a mobile number with a portal application nobody has claimed, whose capacity
// (kW) is the same and which shares at least one name word (father's name / surname), is the same installation.
// Joined only when it is clear-cut: exactly one such portal application, and exactly one such Excel record.
const owners = entities.filter((e) => !e.portal);
const open = (p) => p.portal && !p.sources.length;
const proposals = new Map(); // own entity -> [portal entity]
for (const o of owners) {
  const k = kwOf(o.own.kw);
  const cands = [...new Set([...o.mobiles].flatMap((m) => byMobile.get(m) || []))].filter(open);
  const good = cands.filter((p) => k != null && Math.abs(kwOf(p.portal.kw) - k) <= 0.06 && N.sharedWords(p.portal.name, o.keys) >= 1);
  proposals.set(o, { cands, good });
}
const claims = new Map();
for (const [o, { good }] of proposals) if (good.length === 1) claims.set(good[0], [...(claims.get(good[0]) || []), o]);
let joinedLate = 0;
for (const [o, { good, cands }] of proposals) {
  o.suggest = cands;
  if (good.length === 1 && claims.get(good[0]).length === 1) {
    const p = good[0];
    // merge o into p
    p.own = o.own; p.sources = o.sources; p.category = o.category; p.dupRows = o.dupRows; p.firstRows = o.firstRows;
    o.mobiles.forEach((m) => { p.mobiles.add(m); });
    p.joinedBy = 'mobile + kW + a name word (the name is spelled differently)';
    if (notes.has(o)) notes.set(p, notes.get(o));
    o.merged = true;
    joinedLate++;
  }
}
for (let i = entities.length - 1; i >= 0; i--) if (entities[i].merged) entities.splice(i, 1);

// ---- 3. panel / inverter company from the collector (optional) ----
const collected = new Map();
if (collectorCsv) {
  const wb = new ExcelJS.Workbook();
  await wb.csv.readFile(collectorCsv);
  const ws = wb.worksheets[0];
  const head = [];
  ws.getRow(1).eachCell((c, i) => { head[i] = text(c.value).replace(/^\uFEFF/, ''); });
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const o = {};
    row.eachCell({ includeEmpty: true }, (c, i) => { o[head[i]] = text(c.value); });
    if (o['Application Number']) collected.set(clean(o['Application Number']).toUpperCase(), o);
  });
}

// ---- 4. write the workbook ----
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('Master');
const COLS = [
  ['Sr', 6], ['Match', 22], ['Application Number', 21], ['Portal status', 24], ['Customer name (portal, English)', 30], ['Customer name (your Excel, Gujarati)', 30],
  ['Village', 16], ['Taluka', 14], ['Mobile', 13], ['Consumer Number', 14], ['Category', 12],
  ['Discom', 22], ['Circle', 12], ['Division', 16], ['Sub Division', 18], ['Submitted On', 11], ['Reverification', 8], ['Duplicate (portal)', 8],
  ['Capacity kWp (portal)', 11], ['kW (your Excel)', 9], ['Panels (nos)', 8], ['Panel (your Excel)', 24], ['Inverter (your Excel)', 20], ['Installer', 20],
  ['Payment mode', 12], ['Payment date', 12], ['Payment amount', 12],
  ['File status', 16], ['Subsidy status', 14], ['Filed by', 14], ['ERP SOL NO', 10], ['Policy number', 14], ['Policy price', 10], ['Policy term (yrs)', 8],
  ['Panel company (portal)', 26], ['Panel watt (portal)', 9], ['Panels nos (portal)', 9], ['Inverter company (portal)', 26], ['Inverter kW (portal)', 9], ['Inverters nos (portal)', 9], ['Portal note', 24], ['Panel & inverter info', 26],
  ['Notes (your Excel)', 36], ['Found in', 36], ['To check', 40],
];
ws.columns = COLS.map(([header, width]) => ({ header, width }));

const matchLabel = (e) => (e.portal && e.joinedBy ? 'Portal + your Excel (name spelled differently)' : e.portal && e.sources.length ? 'Portal + your Excel' : e.portal ? 'Portal only' : e.suggest && e.suggest.length ? 'Check: maybe a portal application' : 'Your Excel only');
let sr = 0;
const pinfoCounts = {};
const needList = [];
const counts = {};
const checks = [];
const ordered = [...entities.filter((e) => e.portal), ...entities.filter((e) => !e.portal)];
for (const e of ordered) {
  const p = e.portal || {};
  const o = e.own;
  const c = e.portal ? collected.get(p.app) : null;
  const m = matchLabel(e);
  counts[m] = (counts[m] || 0) + 1;
  const toCheck = [];
  if (e.joinedBy) toCheck.push(`Joined by ${e.joinedBy}: your Excel says ${o.name}, the portal says ${p.name}`);
  if (!e.portal && e.suggest && e.suggest.length) toCheck.push('Same mobile as ' + e.suggest.map((s) => `${s.portal.app} (${s.portal.name}, ${s.portal.kw} kWp)`).join(' / ') + ': not joined because the name and kW do not both agree');
  if (e.conflicts) toCheck.push('Listed twice in your Excel with different values: ' + [...new Set(e.conflicts)].join('; '));
  if (e.secondOf && !e.portal) toCheck.push(`Another installation (different kW) of the same person as ${e.secondOf.portal ? e.secondOf.portal.app : 'another row'}: not on the portal list`);
  if (e.portal && e.portal.duplicate === 'Yes') toCheck.push('The portal marks this as a duplicate application');
  const haveExcel = !!(o.panel && o.inverter);
  const haveCollected = !!(c && (c['Panel company'] || c['Inverter company']));
  const pinfo = haveCollected ? 'Have (portal)' : haveExcel ? 'Have (your Excel)' : !e.portal ? 'Missing (no portal application)' : /^Upload Agreement/i.test(p.status || '') ? 'Not entered on portal yet' : 'NEED FROM PORTAL';
  pinfoCounts[pinfo] = (pinfoCounts[pinfo] || 0) + 1;
  if (pinfo === 'NEED FROM PORTAL') needList.push([p.app, p.name, p.mobile, p.status, p.kw, o.panel || '', o.inverter || '']);
  const row = ws.addRow([
    ++sr, m, p.app || '', p.status || '', p.name || '', o.name || '',
    o.village || '', o.taluka || '', p.mobile || o.mobile || '', p.cons || '', e.category || '',
    p.discom || '', p.circle || '', p.division || '', p.sub || '', p.submitted || '', p.reverification || '', p.duplicate || '',
    p.kw ?? '', o.kw ? num(o.kw) : '', o.panels ? num(o.panels) : '', o.panel || '', o.inverter || '', o.installer || '',
    o.payMode || '', o.payDate ? dateOf(o.payDate) : '', o.payAmount ? num(o.payAmount) : '',
    o.fileStatus || '', o.subsidy || '', o.filer || '', o.erp || '', o.policyNo || '', o.policyPrice ? num(o.policyPrice) : '', o.policyTerm ? num(o.policyTerm) : '',
    c ? c['Panel company'] : '', c ? c['Panel watt'] : '', c ? c['Panels (nos)'] : '', c ? c['Inverter company'] : '', c ? c['Inverter kW'] : '', c ? c['Inverters (nos)'] : '', c ? c['Note'] : '', pinfo,
    (notes.get(e) || []).join(' | '), e.sources.join(' + '), toCheck.filter(Boolean).join('; '),
  ]);
  if (m === 'Check: maybe a portal application') row.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE699' } };
  else if (m === 'Your Excel only') row.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
  else if (m === 'Portal only') row.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8CBAD' } };
  else row.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6E0B4' } };
  if (toCheck.filter(Boolean).length) checks.push([sr, m, p.app || '', p.name || '', o.name || '', p.mobile || o.mobile || '', toCheck.filter(Boolean).join('; ')]);
}
ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F1B33' } };
ws.getRow(1).alignment = { vertical: 'middle', wrapText: true };
ws.getRow(1).height = 32;
ws.views = [{ state: 'frozen', xSplit: 6, ySplit: 1 }];
ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLS.length } };

const wc = wb.addWorksheet('To check');
wc.columns = [['Sr', 7], ['Match', 22], ['Application Number', 22], ['Portal name', 32], ['Your Excel name', 32], ['Mobile', 14], ['What to check', 80]].map(([header, width]) => ({ header, width }));
checks.forEach((c) => wc.addRow(c));
wc.getRow(1).font = { bold: true };
wc.views = [{ state: 'frozen', ySplit: 1 }];

const wn = wb.addWorksheet('Need from portal');
wn.columns = [['Application Number', 24], ['Portal name', 34], ['Mobile', 14], ['Portal status', 26], ['kWp', 8], ['Panel (your Excel)', 24], ['Inverter (your Excel)', 24]].map(([header, width]) => ({ header, width }));
needList.forEach((x) => wn.addRow(x));
wn.getRow(1).font = { bold: true };
wn.views = [{ state: 'frozen', ySplit: 1 }];

const wsum = wb.addWorksheet('Summary');
const portalCount = entities.filter((e) => e.portal).length;
const statusCounts = {};
entities.filter((e) => e.portal).forEach((e) => { statusCounts[e.portal.status] = (statusCounts[e.portal.status] || 0) + 1; });
wsum.addRows([
  ['MASTER SHEET', ''], ['Built', new Date().toLocaleString('en-IN')], ['', ''],
  ['Portal applications', portalCount],
  ...Object.entries(counts).map(([k, v]) => [k, v]),
  ['Total rows in Master', ordered.length], ['', ''],
  ['PANEL & INVERTER INFO', ''], ...Object.entries(pinfoCounts).map(([k, v]) => [k, v]), ['("Need from portal" tab = the applications the collector still has to open)', ''], ['', ''],
  ['Rows of your Excel that were not customer rows (titles, headers, totals) and were skipped', skipped], ['', ''],
  ['Panel / inverter company from the portal', collectorCsv ? `${[...collected.keys()].filter((a) => byApp.has(a)).length} applications filled from ${path.basename(collectorCsv)}` : 'not added yet (give the collector CSV: node build-master.mjs "path\\panels-and-inverters.csv")'],
  ['', ''], ['How rows were joined', 'Your Excel row is tied to a portal application only when the mobile number AND the name both agree.'],
  ['Colour of "Match"', 'green = portal + your Excel; orange = portal only (not in your Excel); blue = your Excel only; light green = joined although the name is spelled differently (same mobile, same kW, a shared name word); yellow = same mobile as a portal application but not clear enough to join (please check)'],
  ['', ''], ['Portal status', 'Applications'], ...Object.entries(statusCounts).sort((a, b) => b[1] - a[1]),
]);
wsum.getColumn(1).width = 70;
wsum.getColumn(2).width = 90;
wsum.getRow(1).font = { bold: true, size: 14 };

await wb.xlsx.writeFile(OUT);
console.log('written', OUT);
console.log(counts, 'rows', ordered.length, 'skipped non-customer rows', skipped, 'to check', checks.length);
