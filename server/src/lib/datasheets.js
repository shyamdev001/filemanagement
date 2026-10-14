import fs from 'node:fs';
import path from 'node:path';
import { config, SERVER_DIR } from '../config.js';
import { getSetting, setSetting } from '../models.js';
import { parsePanels, parseInverter, solaryaanModel } from './parsers.js';
import { englishName } from './transliterate.js';
import { squash } from './dcr.js';

const DEFAULTS = JSON.parse(
  fs.readFileSync(path.join(SERVER_DIR, 'config', 'datasheets.default.json'), 'utf8')
);

/** Datasheet rules live in the database so they can be edited from the Settings page. */
export async function loadDatasheetConfig() {
  const saved = await getSetting('datasheetConfig');
  if (saved && (saved.dcrVersion || 0) < 1) {
    const next = learnFromDcrs(saved);
    await setSetting('datasheetConfig', next);
    return next;
  }
  if (saved) return saved;
  await setSetting('datasheetConfig', DEFAULTS);
  return DEFAULTS;
}

export async function saveDatasheetConfig(cfg) {
  await setSetting('datasheetConfig', cfg);
}

/**
 * 2026-10-14: the DCR certificates show which modules were really supplied. Rules get the model
 * codes printed on the DCR, and the defaults follow what the DCRs showed:
 * every Waaree 540 W was a BI-55 glass-glass bifacial module, the APS 550 W was APSBF bifacial.
 * Rules the user changed keep their file; only codes and missing rules are added.
 */
function learnFromDcrs(cfg) {
  const byId = new Map(DEFAULTS.rules.map((r) => [r.id, r]));
  const rules = cfg.rules.map((r) => {
    const d = byId.get(r.id);
    if (!d) return r;
    const out = { ...r, dcr: r.dcr || d.dcr || '' };
    // Waaree 520–550: the bifacial BI-55 sheet, and it is checked before the Mono PERC sheet.
    if (r.id === 'waaree-bifacial-550') Object.assign(out, { label: d.label, minWatt: d.minWatt, maxWatt: d.maxWatt });
    if (r.id === 'aps-550' && r.file === 'APS/Mono-Facial_530W-to-560W_144C.pdf') Object.assign(out, { label: d.label, file: d.file });
    return out;
  });
  for (const d of DEFAULTS.rules) if (!rules.some((r) => r.id === d.id)) rules.push(d);
  // Same order as the defaults; the user's own rules stay after them.
  const order = DEFAULTS.rules.map((r) => r.id);
  const pos = (r) => (order.includes(r.id) ? order.indexOf(r.id) : order.length);
  rules.sort((a, b) => pos(a) - pos(b));
  return { ...cfg, rules, dcrVersion: 1 };
}

let cache = { at: 0, files: [] };

/** Every PDF under the datasheet folder, as forward-slash relative paths. */
export function listDatasheetFiles() {
  if (Date.now() - cache.at < 5000) return cache.files;
  const out = [];
  const walk = (dir, rel) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else if (e.name.toLowerCase().endsWith('.pdf')) out.push(r);
    }
  };
  walk(config.datasheetDir, '');
  cache = { at: Date.now(), files: out.sort((a, b) => a.localeCompare(b)) };
  return cache.files;
}

/** Absolute path of a datasheet, or null when it is not one of the listed files. */
export function datasheetPath(rel) {
  return listDatasheetFiles().includes(rel) ? path.join(config.datasheetDir, ...rel.split('/')) : null;
}

const BRAND_NAMES = {
  adani: 'Adani', waaree: 'Waaree', aps: 'APS', tata: 'Tata', solaryaan: 'Solaryaan', velox: 'VELOX',
  polycab: 'Polycab', solex: 'Solex', goodwe: 'GoodWe', havells: 'Havells',
};
const brandName = (b) => BRAND_NAMES[b] || b;

function matchPanelRule(item, rules) {
  return rules.find(
    (r) =>
      r.kind === 'panel' &&
      r.brand === item.brand &&
      item.watt >= r.minWatt &&
      item.watt <= r.maxWatt &&
      (r.topcon == null || r.topcon === item.topcon)
  );
}

/** Codes of a rule ("BI-55, BiN-21") that, printed on a DCR, pick that rule. */
const dcrCodes = (r) => String(r.dcr || '').split(/[,|]/).map(squash).filter(Boolean);

/**
 * The rule for one module listed on a DCR: a rule whose code is printed on the DCR wins; otherwise
 * brand, watt and TOPCon decide, as for the Excel. `guess` when no code confirmed it.
 */
function matchDcrRule(item, rules) {
  const fits = rules.filter((r) => r.kind === 'panel' && r.brand === item.brand && item.watt >= r.minWatt && item.watt <= r.maxWatt);
  const text = squash(`${item.code} ${item.desc}`);
  const byCode = fits.find((r) => dcrCodes(r).some((k) => text.includes(k)));
  if (byCode) return { rule: byCode, guess: false };
  const typeFits = (r) => r.topcon == null || r.topcon === item.topcon;
  const rule = fits.find((r) => !dcrCodes(r).length && typeFits(r)) || fits.find(typeFits);
  return { rule, guess: !!rule };
}

const describe = (it) => `${brandName(it.brand) || it.code} ${it.watt} W${it.topcon ? ' TOPCon' : ''}`;

/**
 * Work out which documents a customer has and what is still missing.
 * `files` is the set of PDFs that exist in the datasheet folder.
 */
export function customerStatus(c, cfg, files) {
  const exists = (f) => files.includes(f);

  // 1. Payee certificate: only needs Excel data.
  const payeeMissing = [];
  if (!c.name) payeeMissing.push('name');
  if (!c.village && !c.taluka) payeeMissing.push('address');
  if (!c.mobile) payeeMissing.push('mobile number');
  if (c.kw == null) payeeMissing.push('kW');
  if (!c.panelRaw) payeeMissing.push('panel');
  if (!c.inverterRaw) payeeMissing.push('inverter');
  const payee = { ok: !payeeMissing.length, problems: payeeMissing.map((m) => `Excel: ${m} is missing`) };

  // 2. Panel datasheet(s).
  // pages: file → "2-3" when only some pages of that PDF belong in the customer file
  const datasheet = { ok: false, files: [], pages: {}, problems: [], notes: [], manual: false, source: 'excel' };
  const add = (rule, what, into = datasheet) => {
    if (!rule.file) into.problems.push(`${what}: datasheet not chosen yet (Settings → "${rule.label}")`);
    else if (!exists(rule.file)) into.problems.push(`${what}: file not found – ${rule.file}`);
    else if (!into.files.includes(rule.file)) {
      into.files.push(rule.file);
      if (rule.pages) into.pages[rule.file] = rule.pages;
    }
  };
  const dcrInfo = c.uploads?.dcr ? c.dcrPanels : null;
  if (dcrInfo?.read) datasheet.dcr = [...new Set(dcrInfo.items.map((it) => `${it.code} (${it.watt} W)`))];
  if (c.manualDatasheets?.length) {
    datasheet.manual = true;
    datasheet.files = c.manualDatasheets.filter(exists);
    for (const f of c.manualDatasheets) if (!exists(f)) datasheet.problems.push(`File not found: ${f}`);
  } else if (dcrInfo?.read) {
    // The DCR lists the modules that were really supplied, so it decides over the Excel text.
    datasheet.source = 'dcr';
    for (const it of dcrInfo.items) {
      const { rule, guess } = matchDcrRule(it, cfg.rules);
      if (!rule) datasheet.problems.push(`The DCR shows ${describe(it)} (${it.code}): no datasheet rule fits – choose by hand or add a rule`);
      else {
        add(rule, describe(it));
        if (guess) datasheet.notes.push(`${it.code} is not a model code any rule knows; the closest datasheet was used`);
      }
    }
    const excel = parsePanels(c.panelRaw, cfg.panelBrands).filter((p) => p.brand && p.watt);
    const differs = excel.some((p) => !dcrInfo.items.some((it) => it.brand === p.brand && it.watt === p.watt));
    if (excel.length && differs) datasheet.notes.push(`Excel says "${c.panelRaw}", the DCR says ${dcrInfo.items.map(describe).join(' + ')}. The DCR was followed.`);
  } else {
    if (c.uploads?.dcr && dcrInfo && !dcrInfo.read) datasheet.notes.push('The DCR is a scan with no text, so the datasheet comes from the Excel');
    const items = parsePanels(c.panelRaw, cfg.panelBrands);
    if (!items.length) datasheet.problems.push('Panel is blank in Excel');
    // Watt not written in Excel (e.g. just "વારી"): work it out from kW ÷ panel count
    // when that lands on a panel we have a rule for.
    if (items.length === 1 && items[0].brand && !items[0].watt && c.kw && c.panelCount) {
      const watt = Math.round((c.kw * 1000) / c.panelCount);
      if (matchPanelRule({ ...items[0], watt }, cfg.rules)) {
        items[0] = { ...items[0], watt };
        datasheet.inferredWatt = watt;
      }
    }
    for (const it of items) {
      if (!it.brand || !it.watt) {
        datasheet.problems.push(`Panel "${c.panelRaw}": ${!it.brand ? 'brand' : 'watt'} not given – choose datasheet`);
        continue;
      }
      const rule = matchPanelRule(it, cfg.rules);
      const what = `${brandName(it.brand)} ${it.watt} W${it.topcon ? ' TOPCon' : ''}`;
      if (!rule) datasheet.problems.push(`No datasheet rule for ${what}`);
      else add(rule, what);
    }
  }
  datasheet.ok = datasheet.files.length > 0 && !datasheet.problems.length;

  // 3. Inverter: SOLARYAAN gets a warranty card, every other brand gets its datasheet.
  const inv = parseInverter(c.inverterRaw, cfg.inverterBrands);
  const inverter = { type: 'unknown', ok: false, brand: inv.brand, model: '', files: [], pages: {}, problems: [] };
  if (inv.brand === 'solaryaan') {
    inverter.type = 'warranty';
    inverter.model = c.warrantyModel || solaryaanModel(inv.size);
    if (!inverter.model) inverter.problems.push('Inverter size not readable from Excel');
    // No English name typed: make one from the Gujarati name.
    inverter.englishName = c.englishName || englishName(c.name);
    inverter.englishNameAuto = !c.englishName;
    if (!inverter.englishName) inverter.problems.push('English name not entered');
    if (!c.inverterSerial) inverter.problems.push('Inverter serial number not entered');
  } else if (inv.brand) {
    inverter.type = 'datasheet';
    // A brand can have several rules split by inverter size (e.g. single phase / three phase).
    const fits = (r) => (r.minKw == null || inv.size >= r.minKw) && (r.maxKw == null || inv.size <= r.maxKw);
    const rule = cfg.rules.find((r) => r.kind === 'inverter' && r.brand === inv.brand && fits(r));
    const file = c.manualInverterDatasheet || rule?.file;
    if (!file) inverter.problems.push(`${brandName(inv.brand)} inverter datasheet not chosen yet (Settings)`);
    else if (!exists(file)) inverter.problems.push(`File not found: ${file}`);
    else {
      inverter.files.push(file);
      if (!c.manualInverterDatasheet && rule.pages) inverter.pages[file] = rule.pages;
    }
  } else {
    inverter.problems.push(c.inverterRaw ? `Inverter brand not recognised: "${c.inverterRaw}"` : 'Inverter is blank in Excel');
  }
  inverter.ok = !inverter.problems.length;

  // 4-6. PDFs uploaded from the portal.
  const uploaded = (type, label) => {
    const u = c.uploads?.[type];
    return u
      ? { ok: true, problems: [], originalName: u.originalName, uploadedAt: u.uploadedAt }
      : { ok: false, problems: [`${label} PDF not uploaded`] };
  };
  const dcr = uploaded('dcr', 'DCR certificate');
  const agreement = uploaded('agreement', 'Model Agreement');
  const fl = uploaded('fl', 'Feasibility Letter');

  // Optional: a PDF in the app (printed at the end of the file) or a paper copy ticked by hand.
  // Neither is needed for "Ready".
  const optional = (type, ticked) => {
    const u = c.uploads?.[type];
    return { ok: true, optional: true, uploaded: !!u, ticked: !!ticked, inFile: !!u || !!ticked, problems: [], originalName: u?.originalName, uploadedAt: u?.uploadedAt };
  };
  const bill = optional('bill', c.billAttached);
  const insurance = optional('insurance', c.insuranceAttached);

  const generated = payee.ok && datasheet.ok && inverter.ok;
  return { payee, datasheet, inverter, dcr, agreement, fl, bill, insurance, generated, ready: generated && dcr.ok && agreement.ok && fl.ok };
}
