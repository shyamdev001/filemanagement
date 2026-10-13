import crypto from 'node:crypto';
import express from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import { config } from './config.js';
import fs from 'node:fs';
import { Customer, Pending, getSetting, setSetting } from './models.js';
import {
  UPLOAD_TYPES,
  uploadKey,
  pendingKey,
  isPdf,
  saveUpload,
  extractText,
  detectType,
  findCustomers,
  matchCustomer,
  applicationNumbers,
  applicantName,
} from './lib/uploads.js';
import { toAscii, clean } from './lib/gujarati.js';
import { parseWorkbook } from './lib/excelImport.js';
import {
  loadDatasheetConfig,
  saveDatasheetConfig,
  listDatasheetFiles,
  datasheetPath,
  customerStatus,
} from './lib/datasheets.js';
import { payeeHtml, warrantyHtml } from './lib/templates.js';
import { htmlToPdf, mergePdfs, closeBrowser } from './lib/pdf.js';
import { englishName } from './lib/transliterate.js';
import { storage } from './lib/storage.js';
import { findByName, matchByName, nearNames, nameKeys } from './lib/names.js';
import { parseLine, suggestSerial, usualLength } from './lib/smartPaste.js';
import { parseInverter } from './lib/parsers.js';
import { Batch } from './models.js';
import path from 'node:path';

export const api = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// ---------- login (only when APP_PASSWORD is set) ----------
const sessionToken = () => crypto.createHmac('sha256', config.appPassword).update('solar-file-session').digest('hex');
const readCookie = (req, name) =>
  (req.headers.cookie || '')
    .split(';')
    .map((p) => p.trim().split('='))
    .find(([k]) => k === name)?.[1];
const loggedIn = (req) => !config.appPassword || readCookie(req, 'sfs') === sessionToken();

api.get('/me', (req, res) => res.json({ loginRequired: !!config.appPassword, loggedIn: loggedIn(req) }));

api.post('/login', (req, res) => {
  const given = Buffer.from(String(req.body?.password ?? ''));
  const want = Buffer.from(config.appPassword);
  if (!config.appPassword || (given.length === want.length && crypto.timingSafeEqual(given, want))) {
    res.setHeader('Set-Cookie', `sfs=${sessionToken()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${config.hosted ? '; Secure' : ''}`);
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Wrong password' });
});

api.post('/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'sfs=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});

api.use((req, res, next) => (loggedIn(req) ? next() : res.status(401).json({ error: 'Login required' })));

// ---------- customers ----------
async function statusContext() {
  return { cfg: await loadDatasheetConfig(), files: listDatasheetFiles() };
}

// englishNameShown: the typed English name, or the one made from the Gujarati name (for search and display).
const withStatus = (c, ctx) => ({ ...c, englishNameShown: c.englishName || englishName(c.name), status: customerStatus(c, ctx.cfg, ctx.files) });

api.get(
  '/customers',
  wrap(async (req, res) => {
    const ctx = await statusContext();
    const docs = await Customer.find({}, { extra: 0 }).sort({ sheet: 1, excelRow: 1 }).lean();
    res.json({ customers: docs.map((c) => withStatus(c, ctx)) });
  })
);

async function findCustomer(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(404).json({ error: 'Customer not found' });
    return null;
  }
  const c = await Customer.findById(req.params.id).lean();
  if (!c) res.status(404).json({ error: 'Customer not found' });
  return c;
}

api.get(
  '/customers/:id',
  wrap(async (req, res) => {
    const c = await findCustomer(req, res);
    if (c) res.json({ customer: withStatus(c, await statusContext()) });
  })
);

api.patch(
  '/customers/:id',
  wrap(async (req, res) => {
    const c = await findCustomer(req, res);
    if (!c) return;
    const files = listDatasheetFiles();
    const set = {};
    const b = req.body || {};
    if (typeof b.englishName === 'string') set.englishName = clean(b.englishName);
    if (typeof b.applicationNumber === 'string') set.applicationNumber = clean(b.applicationNumber).toUpperCase().replace(/\s+/g, '');
    if (typeof b.inverterSerial === 'string') set.inverterSerial = clean(b.inverterSerial).toUpperCase();
    if (typeof b.warrantyModel === 'string') set.warrantyModel = clean(b.warrantyModel);
    if (Array.isArray(b.manualDatasheets)) set.manualDatasheets = b.manualDatasheets.filter((f) => files.includes(f));
    // Only un-marking is done here; marking happens through a print batch.
    if (b.printed === false) Object.assign(set, { printedAt: null, printBatch: null });
    if (typeof b.billAttached === 'boolean') set.billAttached = b.billAttached;
    if (typeof b.insuranceAttached === 'boolean') set.insuranceAttached = b.insuranceAttached;
    if (typeof b.manualInverterDatasheet === 'string') {
      set.manualInverterDatasheet = files.includes(b.manualInverterDatasheet) ? b.manualInverterDatasheet : '';
    }
    for (const [field, label] of [['inverterSerial', 'serial number'], ['applicationNumber', 'application number']]) {
      if (!set[field]) continue;
      const other = await Customer.findOne({ [field]: set[field], _id: { $ne: c._id } }, { name: 1 }).lean();
      if (other) return res.status(409).json({ error: `This ${label} is already saved for ${other.name}` });
    }
    const updated = await Customer.findByIdAndUpdate(c._id, { $set: set }, { new: true }).lean();
    if (set.applicationNumber) await resolvePending(await customersForMatching());
    res.json({ customer: withStatus(updated, await statusContext()) });
  })
);

// ---------- generated documents ----------
const sendPdf = (res, buf, name) => {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${name}"`);
  res.send(buf);
};

api.get(
  '/customers/:id/payee.pdf',
  wrap(async (req, res) => {
    const c = await findCustomer(req, res);
    if (c) sendPdf(res, await htmlToPdf(payeeHtml(c)), `payee-${c.mobile || c._id}.pdf`);
  })
);

api.get(
  '/customers/:id/warranty.pdf',
  wrap(async (req, res) => {
    const c = await findCustomer(req, res);
    if (!c) return;
    const st = customerStatus(c, await loadDatasheetConfig(), listDatasheetFiles());
    if (st.inverter.type !== 'warranty') return res.status(400).json({ error: 'Warranty card is only for SOLARYAAN inverters' });
    sendPdf(res, await htmlToPdf(warrantyHtml({ ...c, englishName: st.inverter.englishName }, st.inverter.model), { landscape: true }), `warranty-${c.mobile || c._id}.pdf`);
  })
);

/** The customer's documents in print order. withUploads=false leaves out DCR / Agreement / FL. */
export async function buildCustomerFile(c, st, withUploads = true) {
  const parts = [];
  if (st.payee.ok) parts.push(await htmlToPdf(payeeHtml(c)));
  const sheet = (f, pages) => (datasheetPath(f) ? { file: datasheetPath(f), pages: pages[f] } : null);
  for (const f of st.datasheet.files) parts.push(sheet(f, st.datasheet.pages));
  if (st.inverter.type === 'warranty' && st.inverter.ok) {
    parts.push(await htmlToPdf(warrantyHtml({ ...c, englishName: st.inverter.englishName }, st.inverter.model), { landscape: true }));
  }
  for (const f of st.inverter.files) parts.push(sheet(f, st.inverter.pages));
  for (const type of withUploads ? Object.keys(UPLOAD_TYPES) : []) {
    const pdf = c.uploads?.[type] && (await storage.get(uploadKey(c._id, type)));
    if (pdf) parts.push(pdf);
  }
  return parts.filter(Boolean);
}

api.get(
  '/customers/:id/file.pdf',
  wrap(async (req, res) => {
    const c = await findCustomer(req, res);
    if (!c) return;
    const st = customerStatus(c, await loadDatasheetConfig(), listDatasheetFiles());
    const parts = await buildCustomerFile(c, st);
    if (!parts.length) return res.status(400).json({ error: 'Nothing can be generated for this customer yet' });
    sendPdf(res, (await mergePdfs(parts)).buffer, `file-${c.mobile || c._id}.pdf`);
  })
);

api.get('/datasheet', (req, res) => {
  const p = datasheetPath(String(req.query.file || ''));
  if (!p) return res.status(404).json({ error: 'Datasheet not found' });
  res.sendFile(p);
});

// ---------- Excel import ----------
api.post(
  '/import',
  upload.single('file'),
  wrap(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Choose the Excel file first' });
    let parsed;
    try {
      parsed = await parseWorkbook(req.file.buffer);
    } catch {
      return res.status(400).json({ error: 'This file could not be read. Is it the .xlsx file?' });
    }
    if (!parsed.customers.length) {
      return res.status(400).json({ error: 'No customers found. Sheets needed: Residential, PASHUPALAK, commercial.', skipped: parsed.skipped });
    }

    const existing = await Customer.find({}, { key: 1, sheet: 1, mobile: 1, inExcel: 1 }).lean();
    const byKey = new Map(existing.map((e) => [e.key, e]));
    const incomingKeys = new Set(parsed.customers.map((c) => c.key));
    const orphans = existing.filter((e) => !incomingKeys.has(e.key));

    // A name corrected in Excel changes the key; if exactly one old record with the same
    // sheet + mobile lost its row, treat it as the same customer so typed data is kept.
    const fresh = parsed.customers.filter((c) => !byKey.has(c.key));
    const renamed = new Map();
    for (const c of fresh) {
      if (!c.mobile) continue;
      const candidates = orphans.filter((o) => o.sheet === c.sheet && o.mobile === c.mobile && !renamed.has(String(o._id)));
      const rivals = fresh.filter((f) => f.sheet === c.sheet && f.mobile === c.mobile);
      if (candidates.length === 1 && rivals.length === 1) renamed.set(String(candidates[0]._id), c);
    }
    const renamedKeys = new Set([...renamed.values()].map((c) => c.key));

    const ops = [];
    for (const c of parsed.customers) {
      if (renamedKeys.has(c.key)) continue;
      ops.push({ updateOne: { filter: { key: c.key }, update: { $set: { ...c, inExcel: true } }, upsert: true } });
    }
    for (const [id, c] of renamed) {
      ops.push({ updateOne: { filter: { _id: new mongoose.Types.ObjectId(id) }, update: { $set: { ...c, inExcel: true } } } });
    }
    const gone = orphans.filter((o) => !renamed.has(String(o._id)));
    if (gone.length) {
      ops.push({ updateMany: { filter: { _id: { $in: gone.map((o) => o._id) } }, update: { $set: { inExcel: false } } } });
    }
    await Customer.bulkWrite(ops, { ordered: false });

    const mobileCount = new Map();
    for (const c of parsed.customers) if (c.mobile) mobileCount.set(c.mobile, (mobileCount.get(c.mobile) || 0) + 1);

    const report = {
      at: new Date().toISOString(),
      fileName: req.file.originalname,
      sheets: parsed.sheets,
      total: parsed.customers.length,
      added: fresh.length - renamed.size,
      updated: parsed.customers.length - fresh.length + renamed.size,
      notInExcelAnymore: gone.length,
      skipped: parsed.skipped,
      rowsWithIssues: parsed.customers
        .filter((c) => c.issues.length)
        .map((c) => ({ sheet: c.sheet, row: c.excelRow, name: c.name, issues: c.issues })),
      sharedMobiles: [...mobileCount.entries()]
        .filter(([, n]) => n > 1)
        .map(([mobile, n]) => ({ mobile, count: n, names: parsed.customers.filter((c) => c.mobile === mobile).map((c) => `${c.name} (${c.sheet})`) })),
    };
    await setSetting('lastImport', report);
    res.json({ report });
  })
);

api.get('/import/last', wrap(async (req, res) => res.json({ report: await getSetting('lastImport') })));

// ---------- bulk paste: "mobile <tab> value" or "English name <tab> value" per line ----------
const compact = (v) => v.toUpperCase().replace(/\s+/g, '');
const BULK_FIELDS = { englishName: (v) => v, inverterSerial: compact, applicationNumber: compact };

api.post(
  '/bulk',
  wrap(async (req, res) => {
    const { field, text, apply } = req.body || {};
    if (!BULK_FIELDS[field]) return res.status(400).json({ error: 'Unknown field' });

    const cfg = await loadDatasheetConfig();
    const all = await Customer.find({}, { name: 1, sheet: 1, village: 1, mobile: 1, mobiles: 1, englishName: 1, inverterSerial: 1, applicationNumber: 1, inverterRaw: 1 }).lean();
    const byMobile = new Map();
    for (const c of all) {
      for (const m of c.mobiles || []) byMobile.set(m, [...(byMobile.get(m) || []), c]);
      c.keys = nameKeys(c.englishName || englishName(c.name));
      c.solaryaan = parseInverter(c.inverterRaw, cfg.inverterBrands).brand === 'solaryaan';
    }
    // A serial number only belongs on a SOLARYAAN customer, which also narrows down same-name customers.
    const namePool = field === 'inverterSerial' ? all.filter((c) => c.solaryaan) : all;

    const rows = [];
    const lines = String(text || '').split(/\r?\n/);
    // Most serial numbers have the same length; one that differs is probably a typing mistake.
    const lengths = new Map();
    lines.forEach((raw, i) => {
      const line = toAscii(raw).trim();
      if (!line) return;
      // Pasted from Excel the columns are tab-separated; typed by hand, the last word is the value.
      const cells = line.split(/[\t,;|]+/).map((s) => s.trim()).filter(Boolean);
      const firstWord = line.split(/\s+/)[0];
      const firstDigits = (cells.length > 1 ? cells[0] : firstWord).replace(/\D/g, '');
      const mobile = firstDigits.length === 10 || (firstDigits.length === 12 && firstDigits.startsWith('91')) ? firstDigits.slice(-10) : '';

      let who;
      let rest;
      if (mobile) {
        who = mobile;
        rest = cells.length > 1 ? cells.slice(1).join(' ') : line.replace(/^\S+\s*/, '');
      } else if (cells.length > 1) {
        who = cells[0];
        rest = cells.slice(1).join(' ');
      } else {
        const parts = line.split(/\s+/);
        rest = parts.pop();
        who = parts.join(' ');
      }
      const value = BULK_FIELDS[field](clean(rest));
      const row = { line: i + 1, mobile: who, value };
      if (!who || !/[A-Za-z0-9]/.test(who)) return rows.push({ ...row, result: 'bad', message: 'Each line needs a mobile number or an English name, then the value' });
      if (!value) return rows.push({ ...row, result: 'bad', message: 'No value on this line' });

      let hits;
      let how;
      if (mobile) {
        hits = byMobile.get(mobile) || [];
        how = 'mobile number';
        if (!hits.length) return rows.push({ ...row, result: 'notFound', message: 'No customer with this mobile number' });
      } else {
        hits = findByName(who, namePool);
        how = 'name';
        if (!hits.length) {
          const elsewhere = field === 'inverterSerial' && findByName(who, all).length;
          return rows.push({ ...row, result: 'notFound', message: elsewhere ? 'A customer has this name, but their inverter is not SOLARYAAN' : 'No customer with this name. Use the mobile number, or type it on the customer page' });
        }
      }
      if (hits.length > 1) {
        return rows.push({ ...row, result: 'ambiguous', message: `${hits.length} customers fit this ${how}. Type it on the customer page`, names: hits.map((h) => `${h.name} (${h.village || h.sheet})`) });
      }
      const c = hits[0];
      lengths.set(value.length, (lengths.get(value.length) || 0) + 1);
      rows.push({ ...row, id: String(c._id), name: c.name, village: c.village, how, old: c[field] || '', result: c[field] === value ? 'same' : 'ok' });
    });

    // Two lines for the same customer: neither is saved, a person must decide.
    const perCustomer = new Map();
    for (const r of rows) if (r.id) perCustomer.set(r.id, (perCustomer.get(r.id) || 0) + 1);
    for (const r of rows) {
      if (r.id && perCustomer.get(r.id) > 1) Object.assign(r, { result: 'ambiguous', message: 'Two lines here match the same customer. Check both names' });
    }
    if (field === 'inverterSerial' && lengths.size > 1) {
      const usual = [...lengths.entries()].sort((a, b) => b[1] - a[1])[0][0];
      for (const r of rows) if (r.result === 'ok' && r.value.length !== usual) r.warning = `This serial has ${r.value.length} characters; the others have ${usual}. Check it`;
    }

    const ok = rows.filter((r) => r.result === 'ok');
    if (apply && ok.length) {
      await Customer.bulkWrite(
        ok.map((r) => ({ updateOne: { filter: { _id: new mongoose.Types.ObjectId(r.id) }, update: { $set: { [field]: r.value } } } }))
      );
    }
    if (apply && ok.length && field === 'applicationNumber') await resolvePending(await customersForMatching());
    res.json({ applied: !!apply, saved: apply ? ok.length : 0, rows });
  })
);

// ---------- smart paste: paste anything, the app works out the rest ----------
// Each line may hold a mobile number, an English or Gujarati name, an inverter serial number and an
// application number, in any order. The app finds the customer, checks the values, saves what it is
// sure about, and returns the rest with the reason and its best suggestions.
api.post(
  '/smart-paste',
  wrap(async (req, res) => {
    const cfg = await loadDatasheetConfig();
    const all = await Customer.find({}, { name: 1, sheet: 1, village: 1, mobile: 1, mobiles: 1, englishName: 1, inverterSerial: 1, applicationNumber: 1, inverterRaw: 1 }).lean();
    const byMobile = new Map();
    const bySerial = new Map();
    const byAppNo = new Map();
    for (const c of all) {
      for (const m of c.mobiles || []) byMobile.set(m, [...(byMobile.get(m) || []), c]);
      if (c.inverterSerial) bySerial.set(c.inverterSerial, c);
      if (c.applicationNumber) byAppNo.set(c.applicationNumber, c);
      c.shownName = c.englishName || englishName(c.name);
      c.keys = nameKeys(c.shownName);
      c.solaryaan = parseInverter(c.inverterRaw, cfg.inverterBrands).brand === 'solaryaan';
    }
    const solaryaan = all.filter((c) => c.solaryaan);
    const card = (c) => ({ id: String(c._id), name: c.name, english: c.shownName, village: c.village, mobile: c.mobile, inverter: c.inverterRaw, serial: c.inverterSerial || '' });

    const parsed = String(req.body?.text || '').split(/\r?\n/).map((raw, i) => ({ line: i + 1, raw: raw.trim(), p: parseLine(raw) })).filter((x) => x.p);
    const usual = usualLength([...bySerial.keys(), ...parsed.map((x) => x.p.serial)]);
    const goodSerials = [...bySerial.keys(), ...parsed.map((x) => x.p.serial)].filter((s) => s && s.length === usual);

    const rows = [];
    const writes = new Map(); // customer id → { fields }
    for (const { line, raw, p } of parsed) {
      const row = { line, raw, values: { serial: p.serial, appNo: p.appNo, name: p.name, mobile: p.mobile } };
      const needs = (reason, extra = {}) => rows.push({ ...row, status: 'needs', reason, ...extra });
      const pool = p.serial ? solaryaan : all;

      // ---- who is it? mobile number, then application number, then name ----
      let c = null;
      let how = '';
      let note = '';
      if (p.mobile) {
        let hits = byMobile.get(p.mobile) || [];
        if (hits.length > 1 && p.name) {
          const narrowed = matchByName(p.name, hits).hits;
          if (narrowed.length === 1) hits = narrowed;
        }
        if (hits.length === 1) [c, how] = [hits[0], 'mobile number'];
        else if (hits.length > 1) {
          needs(`${hits.length} customers share the mobile number ${p.mobile}`, { suggestions: hits.map(card) });
          continue;
        }
      }
      if (!c && p.appNo && byAppNo.has(p.appNo) && (p.serial || p.name)) [c, how] = [byAppNo.get(p.appNo), 'application number'];
      if (!c && p.name) {
        let m = matchByName(p.name, pool);
        if (!m.hits.length && pool !== all && matchByName(p.name, all).hits.length) {
          needs('A customer has this name, but their inverter in Excel is not SOLARYAAN', { suggestions: matchByName(p.name, all).hits.map(card) });
          continue;
        }
        if (m.hits.length === 1) {
          [c, how] = [m.hits[0], 'name'];
          if (m.quality === 'ending') note = `Name is written a little differently here (${c.shownName}). Saved, please glance`;
        } else if (m.hits.length > 1) {
          needs(`${m.hits.length} customers have this name`, { suggestions: m.hits.map(card) });
          continue;
        }
      }
      if (!c) {
        const near = p.name ? nearNames(p.name, pool).map(card) : [];
        needs(
          p.mobile ? `No customer has the mobile number ${p.mobile}` : p.name ? (near.length ? 'No customer has exactly this name. Is it one of these?' : 'No customer has this name') : 'This line has no mobile number or name to find the customer by',
          { suggestions: near }
        );
        continue;
      }
      row.customer = card(c);
      row.how = how;

      // ---- what is there to save, and is each value sound? ----
      const set = {};
      const same = [];
      let problem = null;
      if (p.serial) {
        const owner = bySerial.get(p.serial);
        const twice = parsed.filter((x) => x.p.serial === p.serial).length > 1;
        if (c.inverterSerial === p.serial) same.push('serial');
        else if (!c.solaryaan) problem = { reason: `This customer's inverter is not SOLARYAAN (${c.inverterRaw || 'blank in Excel'}), so it has no warranty serial` };
        else if (usual && p.serial.length !== usual) {
          const fix = suggestSerial(p.serial, goodSerials);
          problem = { reason: `Serial ${p.serial} has ${p.serial.length} characters; the others have ${usual}`, suggestedSerial: fix && !bySerial.has(fix) ? fix : '' };
        } else if (owner && String(owner._id) !== String(c._id)) problem = { reason: `Serial ${p.serial} is already saved for ${owner.name}` };
        else if (twice) problem = { reason: `Serial ${p.serial} appears on more than one line` };
        else if (c.inverterSerial) problem = { reason: `This customer already has serial ${c.inverterSerial}`, replace: { inverterSerial: p.serial } };
        else set.inverterSerial = p.serial;
      }
      if (!problem && p.appNo && how !== 'application number') {
        const owner = byAppNo.get(p.appNo);
        if (c.applicationNumber === p.appNo) same.push('application number');
        else if (owner && String(owner._id) !== String(c._id)) problem = { reason: `Application number ${p.appNo} is already saved for ${owner.name}` };
        else if (c.applicationNumber) problem = { reason: `This customer already has application number ${c.applicationNumber}`, replace: { applicationNumber: p.appNo } };
        else set.applicationNumber = p.appNo;
      }
      // A name beside a mobile or application number is the English name to print.
      if (!problem && p.name && how !== 'name') {
        if (c.englishName === p.name) same.push('name');
        else if (c.englishName) problem = { reason: `This customer already has the English name ${c.englishName}`, replace: { englishName: p.name } };
        else set.englishName = p.name;
      }
      const earlier = writes.get(String(c._id));
      if (!problem && earlier && Object.keys(set).some((k) => earlier[k] && earlier[k] !== set[k])) problem = { reason: 'Another line gives this customer a different value' };

      if (problem) {
        needs(problem.reason, { suggestedSerial: problem.suggestedSerial || '', replace: problem.replace || null });
        continue;
      }
      if (!Object.keys(set).length) {
        rows.push(same.length ? { ...row, status: 'same' } : { ...row, status: 'needs', reason: 'Nothing to save on this line: add the serial number, application number or name' });
        continue;
      }
      writes.set(String(c._id), { ...(earlier || {}), ...set });
      rows.push({ ...row, status: 'saved', saved: set, undo: Object.fromEntries(Object.keys(set).map((k) => [k, c[k] || ''])), note });
    }

    if (writes.size) {
      await Customer.bulkWrite([...writes.entries()].map(([id, set]) => ({ updateOne: { filter: { _id: new mongoose.Types.ObjectId(id) }, update: { $set: set } } })));
      if ([...writes.values()].some((s) => s.applicationNumber)) await resolvePending(await customersForMatching());
    }
    res.json({ rows });
  })
);

// ---------- datasheet settings ----------
api.get(
  '/settings/datasheets',
  wrap(async (req, res) => res.json({ config: await loadDatasheetConfig(), files: listDatasheetFiles(), folder: config.datasheetDir }))
);

api.put(
  '/settings/datasheets',
  wrap(async (req, res) => {
    const current = await loadDatasheetConfig();
    const files = listDatasheetFiles();
    const rules = [];
    for (const r of req.body?.rules || []) {
      const kind = r.kind === 'inverter' ? 'inverter' : 'panel';
      const brands = kind === 'panel' ? current.panelBrands : current.inverterBrands;
      if (!brands[r.brand]) return res.status(400).json({ error: `Unknown brand: ${r.brand}` });
      const rule = {
        id: clean(r.id) || `${kind}-${r.brand}-${Date.now()}-${rules.length}`,
        kind,
        label: clean(r.label) || r.brand,
        brand: r.brand,
        file: files.includes(r.file) ? r.file : null,
      };
      if (kind === 'panel') {
        rule.topcon = r.topcon === true || r.topcon === false ? r.topcon : null;
        rule.minWatt = Number(r.minWatt);
        rule.maxWatt = Number(r.maxWatt);
        if (!(rule.minWatt > 0) || !(rule.maxWatt >= rule.minWatt)) {
          return res.status(400).json({ error: `Check the watt range of "${rule.label}"` });
        }
      }
      if (kind === 'inverter') {
        rule.minKw = r.minKw == null || r.minKw === '' ? null : Number(r.minKw);
        rule.maxKw = r.maxKw == null || r.maxKw === '' ? null : Number(r.maxKw);
      }
      // Optional: print only some pages of the PDF, e.g. "2-3".
      const pages = clean(r.pages).replace(/\s+/g, '');
      if (pages && !/^\d+(-\d+)?(,\d+(-\d+)?)*$/.test(pages)) return res.status(400).json({ error: `Pages for "${rule.label}" must look like 2-3 or 1,4` });
      rule.pages = pages;
      rules.push(rule);
    }
    const next = { ...current, rules };
    await saveDatasheetConfig(next);
    res.json({ config: next, files });
  })
);

// ---------- uploaded PDFs: DCR, Model Agreement, FL ----------
const uploadMeta = (file) => ({ originalName: file.originalname, size: file.size, uploadedAt: new Date() });
// Browsers send non-English file names as latin1 bytes.
const fixName = (file) => {
  file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
  return file;
};

// Fields the matching needs for every customer.
const MATCH_FIELDS = { name: 1, sheet: 1, village: 1, mobile: 1, mobiles: 1, englishName: 1, uploads: 1, applicationNumber: 1 };
async function customersForMatching() {
  const customers = await Customer.find({}, MATCH_FIELDS).lean();
  // Portal PDFs carry the English name; fall back to the one made from the Gujarati name.
  for (const c of customers) {
    c.typedName = c.englishName;
    c.englishName = c.englishName || englishName(c.name);
  }
  return customers;
}

/** Remember a customer's application number (never replaces one that is already there). */
async function learnNumber(c, appNo) {
  if (!appNo || c.applicationNumber) return false;
  await Customer.updateOne({ _id: c._id }, { $set: { applicationNumber: appNo } });
  c.applicationNumber = appNo;
  return true;
}

/**
 * Take the customer's English name from their FL, exactly as the portal spells it. It is then
 * used to match their Model Agreement and printed on the warranty card. A name typed by staff is kept.
 */
async function learnName(c, flText) {
  const name = applicantName(flText);
  if (!name || c.typedName) return false;
  await Customer.updateOne({ _id: c._id }, { $set: { englishName: name } });
  c.englishName = c.typedName = name;
  return true;
}

/** Customers who got PDFs before application numbers existed: read the number from their own PDFs. */
let storedUploadsRead = false;
async function learnFromStoredUploads(customers) {
  // Once per start is enough: it re-reads stored PDFs, which is slow when they are in the cloud.
  if (storedUploadsRead) return;
  storedUploadsRead = true;
  for (const c of customers) {
    if (!c.uploads || !Object.keys(c.uploads).length) continue;
    if (!c.typedName && c.uploads.fl) {
      const fl = await storage.get(uploadKey(c._id, 'fl'));
      if (fl) await learnName(c, await extractText(fl));
    }
    if (c.applicationNumber) continue;
    const found = new Set();
    for (const type of Object.keys(UPLOAD_TYPES)) {
      const pdf = c.uploads[type] && (await storage.get(uploadKey(c._id, type)));
      if (pdf) applicationNumbers(await extractText(pdf)).forEach((n) => found.add(n));
    }
    if (found.size === 1) await learnNumber(c, [...found][0]);
  }
}

/**
 * PDFs in "Waiting for you" are matched again whenever something new has been learned (an
 * application number or the portal's spelling of a name), and filed by themselves if they now fit
 * exactly one customer. This is what lets the Agreement and DCR be dropped before the FL.
 */
async function resolvePending(customers) {
  const filed = [];
  for (const p of await Pending.find()) {
    const buffer = await storage.get(pendingKey(p.storedName));
    if (!buffer) continue;
    const text = await extractText(buffer);
    const type = p.detectedType || detectType(p.originalName, text);
    const m = matchCustomer(p.originalName, text, customers);
    if (m.conflict || m.matches.length !== 1 || !UPLOAD_TYPES[type] || m.matches[0].uploads?.[type]) continue;
    const c = m.matches[0];
    await saveUpload(c._id, type, buffer);
    const meta = { originalName: p.originalName, size: p.size, uploadedAt: new Date() };
    await Customer.updateOne({ _id: c._id }, { $set: { [`uploads.${type}`]: meta } });
    c.uploads = { ...(c.uploads || {}), [type]: meta };
    if (m.certain) {
      await learnNumber(c, m.appNo);
      if (type === 'fl') await learnName(c, text);
    }
    await storage.remove(pendingKey(p.storedName));
    await p.deleteOne();
    filed.push({ name: p.originalName, type, customer: { id: String(c._id), name: c.name, mobile: c.mobile } });
  }
  return filed;
}

api.post(
  '/customers/:id/uploads/:type',
  upload.single('file'),
  wrap(async (req, res) => {
    const c = await findCustomer(req, res);
    if (!c) return;
    const { type } = req.params;
    if (!UPLOAD_TYPES[type]) return res.status(400).json({ error: 'Unknown document type' });
    if (!req.file || !isPdf(req.file.buffer)) return res.status(400).json({ error: 'Please choose a PDF file' });
    await saveUpload(c._id, type, req.file.buffer);
    await Customer.updateOne({ _id: c._id }, { $set: { [`uploads.${type}`]: uploadMeta(fixName(req.file)) } });

    // A person chose this customer, so the PDF's application number can be trusted for them.
    const text = await extractText(req.file.buffer);
    const numbers = applicationNumbers(text);
    let warning = '';
    let learned = type === 'fl' && (await learnName({ _id: c._id, typedName: c.englishName }, text));
    if (numbers.length === 1 && c.applicationNumber && c.applicationNumber !== numbers[0]) {
      warning = `Check this PDF: it shows application number ${numbers[0]}, but this customer's number is ${c.applicationNumber}.`;
    } else if (numbers.length === 1 && (await learnNumber(c, numbers[0]))) learned = true;
    if (learned) await resolvePending(await customersForMatching());
    const updated = await Customer.findById(c._id).lean();
    res.json({ customer: withStatus(updated, await statusContext()), warning });
  })
);

api.delete(
  '/customers/:id/uploads/:type',
  wrap(async (req, res) => {
    const c = await findCustomer(req, res);
    if (!c) return;
    const { type } = req.params;
    if (!UPLOAD_TYPES[type]) return res.status(400).json({ error: 'Unknown document type' });
    await storage.setAside(uploadKey(c._id, type));
    const updated = await Customer.findByIdAndUpdate(c._id, { $unset: { [`uploads.${type}`]: 1 } }, { new: true }).lean();
    res.json({ customer: withStatus(updated, await statusContext()) });
  })
);

api.get(
  '/customers/:id/uploads/:type',
  wrap(async (req, res) => {
    const c = await findCustomer(req, res);
    if (!c) return;
    const pdf = UPLOAD_TYPES[req.params.type] && (await storage.get(uploadKey(c._id, req.params.type)));
    if (!pdf) return res.status(404).json({ error: 'This PDF could not be found. Upload it again.' });
    res.setHeader('Content-Type', 'application/pdf');
    res.send(pdf);
  })
);

// Many PDFs at once: place each one automatically, or queue it for a person to place.
api.post(
  '/uploads/bulk',
  upload.array('files', 200),
  wrap(async (req, res) => {
    const customers = await customersForMatching();
    await learnFromStoredUploads(customers);

    // Read everything first, then handle the PDFs that carry a mobile number (the FLs) before
    // the rest, so their application numbers are known when the Agreement and DCR are placed.
    const items = [];
    for (const [index, file] of (req.files || []).map(fixName).entries()) {
      const name = file.originalname;
      if (!isPdf(file.buffer)) {
        items.push({ index, name, rejected: true });
        continue;
      }
      const text = await extractText(file.buffer);
      const first = findCustomers(name, text, customers);
      items.push({ index, name, file, text, type: detectType(name, text), hasMobile: first.how === 'mobile number' && first.matches.length > 0 });
    }
    items.sort((a, b) => Number(!!b.hasMobile) - Number(!!a.hasMobile) || a.index - b.index);

    const results = [];
    for (const it of items) {
      const { index, name, file, type } = it;
      if (it.rejected) {
        results.push({ index, name, result: 'rejected', reason: 'Not a PDF file' });
        continue;
      }
      const m = matchCustomer(name, it.text, customers);

      let reason = '';
      if (m.conflict) reason = m.conflict;
      else if (!m.matches.length) reason = m.appNo ? `No customer is known yet for application number ${m.appNo}. Upload that customer's FL and this will be filed by itself` : 'No application number, mobile number or English name of a customer found in this PDF';
      else if (m.matches.length > 1) reason = `${m.matches.length} customers fit (same ${m.how})`;
      else if (!type) reason = 'Could not tell if this is the DCR, Agreement or FL';
      else if (m.matches[0].uploads?.[type]) reason = `This customer already has a ${UPLOAD_TYPES[type]}`;

      if (!reason) {
        const c = m.matches[0];
        await saveUpload(c._id, type, file.buffer);
        const meta = uploadMeta(file);
        await Customer.updateOne({ _id: c._id }, { $set: { [`uploads.${type}`]: meta } });
        c.uploads = { ...(c.uploads || {}), [type]: meta };
        if (m.certain) {
          await learnNumber(c, m.appNo);
          if (type === 'fl') await learnName(c, it.text);
        }
        results.push({ index, name, result: 'saved', type, customer: { id: String(c._id), name: c.name, mobile: c.mobile }, how: m.how });
        continue;
      }
      const storedName = `${crypto.randomUUID()}.pdf`;
      await storage.put(pendingKey(storedName), file.buffer);
      await Pending.create({ originalName: name, storedName, size: file.size, detectedType: type || '', applicationNumber: m.appNo, candidates: m.matches.slice(0, 5).map((c) => c._id), reason });
      results.push({ index, name, result: 'pending', type, reason });
    }

    // Anything that was waiting (from this upload or an earlier one) and can now be placed.
    const alsoFiled = await resolvePending(customers);
    const done = new Set(alsoFiled.map((f) => f.name));
    res.json({
      results: results
        .sort((a, b) => a.index - b.index)
        .map((r) => (r.result === 'pending' && done.has(r.name) ? { ...alsoFiled.find((f) => f.name === r.name), result: 'saved', how: 'application number' } : r)),
      alsoFiled: alsoFiled.filter((f) => !results.some((r) => r.name === f.name)),
    });
  })
);

api.get(
  '/pending',
  wrap(async (req, res) => {
    const pending = await Pending.find().sort({ createdAt: 1 }).populate('candidates', 'name village mobile sheet').lean();
    res.json({ pending });
  })
);

async function findPending(req, res) {
  const p = mongoose.isValidObjectId(req.params.id) ? await Pending.findById(req.params.id) : null;
  if (!p) res.status(404).json({ error: 'This file is no longer in the list' });
  return p;
}

api.get(
  '/pending/:id/file',
  wrap(async (req, res) => {
    const p = await findPending(req, res);
    if (!p) return;
    const pdf = await storage.get(pendingKey(p.storedName));
    if (!pdf) return res.status(404).json({ error: 'This PDF could not be found. Upload it again.' });
    res.setHeader('Content-Type', 'application/pdf');
    res.send(pdf);
  })
);

api.post(
  '/pending/:id/assign',
  wrap(async (req, res) => {
    const p = await findPending(req, res);
    if (!p) return;
    const { customerId, type } = req.body || {};
    if (!UPLOAD_TYPES[type]) return res.status(400).json({ error: 'Choose which document this is' });
    const c = mongoose.isValidObjectId(customerId) ? await Customer.findById(customerId).lean() : null;
    if (!c) return res.status(400).json({ error: 'Choose the customer' });
    const buffer = await storage.get(pendingKey(p.storedName));
    if (!buffer) return res.status(404).json({ error: 'This PDF could not be found. Upload it again.' });
    await saveUpload(c._id, type, buffer);
    await Customer.updateOne({ _id: c._id }, { $set: { [`uploads.${type}`]: { originalName: p.originalName, size: p.size, uploadedAt: new Date() } } });
    const gotName = type === 'fl' && (await learnName({ _id: c._id, typedName: c.englishName }, await extractText(buffer)));
    await storage.remove(pendingKey(p.storedName));
    const appNo = p.applicationNumber;
    await p.deleteOne();
    // A person placed it, so its application number now belongs to this customer; their other
    // waiting PDFs with the same number follow by themselves.
    let alsoFiled = [];
    if ((await learnNumber(c, appNo)) || gotName) alsoFiled = await resolvePending(await customersForMatching());
    res.json({ ok: true, alsoFiled });
  })
);

api.delete(
  '/pending/:id',
  wrap(async (req, res) => {
    const p = await findPending(req, res);
    if (!p) return;
    await storage.setAside(pendingKey(p.storedName));
    await p.deleteOne();
    res.json({ ok: true });
  })
);

// ---------- print batches ----------
const batchFile = (storedName) => {
  const dir = path.join(config.dataDir, 'batches');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, storedName);
};

api.get(
  '/batches',
  wrap(async (req, res) => {
    const batches = await Batch.find().sort({ number: -1 }).limit(100).populate('customers', 'name mobile').lean();
    res.json({ batches });
  })
);

// Build one merged PDF for the chosen customers, each customer's documents in print order.
api.post(
  '/batches',
  wrap(async (req, res) => {
    const { customerIds, mode = 'full', doubleSided = false } = req.body || {};
    const ids = (Array.isArray(customerIds) ? customerIds : []).filter((id) => mongoose.isValidObjectId(id));
    if (!ids.length) return res.status(400).json({ error: 'Choose at least one customer' });
    if (ids.length > 60) return res.status(400).json({ error: 'Choose 60 customers or fewer for one print file' });

    const ctx = await statusContext();
    const found = await Customer.find({ _id: { $in: ids } }).lean();
    const byId = new Map(found.map((c) => [String(c._id), c]));
    const chosen = ids.map((id) => byId.get(id)).filter(Boolean); // keep the order the user saw

    const key = mode === 'generated' ? 'generated' : 'ready';
    const notReady = chosen.filter((c) => !customerStatus(c, ctx.cfg, ctx.files)[key]);
    if (notReady.length) {
      return res.status(400).json({ error: `Not ready, take them out and try again: ${notReady.slice(0, 5).map((c) => c.name).join(', ')}${notReady.length > 5 ? '…' : ''}` });
    }

    const parts = [];
    for (const c of chosen) {
      try {
        parts.push(...(await buildCustomerFile(c, customerStatus(c, ctx.cfg, ctx.files), mode !== 'generated')));
      } catch {
        return res.status(500).json({ error: `Could not build the file for ${c.name}. Open that customer and check each document.` });
      }
    }
    if (config.hosted) await closeBrowser(); // free memory on a small server before joining the PDFs
    let merged;
    try {
      merged = await mergePdfs(parts, { padOdd: !!doubleSided });
    } catch {
      return res.status(500).json({ error: 'One of the PDFs could not be read. Open each customer file to find the damaged PDF, then try again.' });
    }

    const last = await Batch.findOne().sort({ number: -1 }).lean();
    const number = (last?.number || 0) + 1;
    const storedName = `batch-${String(number).padStart(4, '0')}.pdf`;
    fs.writeFileSync(batchFile(storedName), merged.buffer);
    const batch = await Batch.create({
      number,
      mode: mode === 'generated' ? 'generated' : 'full',
      doubleSided: !!doubleSided,
      customers: chosen.map((c) => c._id),
      pages: merged.pages,
      storedName,
    });
    res.json({ batch: { ...batch.toObject(), customers: chosen.map((c) => ({ _id: c._id, name: c.name, mobile: c.mobile })) } });
  })
);

async function findBatch(req, res) {
  const b = mongoose.isValidObjectId(req.params.id) ? await Batch.findById(req.params.id) : null;
  if (!b) res.status(404).json({ error: 'Print file not found' });
  return b;
}

api.get(
  '/batches/:id/file.pdf',
  wrap(async (req, res) => {
    const b = await findBatch(req, res);
    if (!b) return;
    const file = batchFile(b.storedName);
    if (!fs.existsSync(file)) {
      // A hosting server without a disk loses its files on restart: build the same batch again.
      const ctx = await statusContext();
      const found = await Customer.find({ _id: { $in: b.customers } }).lean();
      const byId = new Map(found.map((c) => [String(c._id), c]));
      const parts = [];
      for (const cid of b.customers) {
        const c = byId.get(String(cid));
        if (c) parts.push(...(await buildCustomerFile(c, customerStatus(c, ctx.cfg, ctx.files), b.mode !== 'generated')));
      }
      if (!parts.length) return res.status(404).json({ error: 'This print file could not be rebuilt. Make a new one.' });
      if (config.hosted) await closeBrowser();
      fs.writeFileSync(file, (await mergePdfs(parts, { padOdd: !!b.doubleSided })).buffer);
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${b.storedName}"`);
    res.sendFile(file);
  })
);

// Mark (or un-mark) every customer in the batch as printed.
api.post(
  '/batches/:id/printed',
  wrap(async (req, res) => {
    const b = await findBatch(req, res);
    if (!b) return;
    const printed = req.body?.printed !== false;
    b.printedAt = printed ? new Date() : null;
    await b.save();
    if (printed) await Customer.updateMany({ _id: { $in: b.customers } }, { $set: { printedAt: b.printedAt, printBatch: b.number } });
    else await Customer.updateMany({ _id: { $in: b.customers }, printBatch: b.number }, { $set: { printedAt: null, printBatch: null } });
    res.json({ ok: true, printedAt: b.printedAt });
  })
);

api.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server. Please try again.' });
});
