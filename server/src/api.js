import crypto from 'node:crypto';
import zlib from 'node:zlib';
import express from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import { config } from './config.js';
import fs from 'node:fs';
import { Customer, Pending, Setting, getSetting, setSetting } from './models.js';
import {
  UPLOAD_TYPES,
  OPTIONAL_UPLOADS,
  ALL_UPLOADS,
  isImage,
  imageToPdf,
  policyFrontPage,
  billFirstPage,
  splitInvoices,
  cutPages,
  pageTexts,
  invoiceRef,
  policyRef,
  isInfoSheet,
  uploadKey,
  pendingKey,
  isPdf,
  saveUpload,
  fileHash,
  extractText,
  detectType,
  matchCustomer,
  prepareCustomer,
  hasCustomerMobile,
  applicationNumbers,
  applicantName,
} from './lib/uploads.js';
import { toAscii, clean, parseMobiles, parseNumber } from './lib/gujarati.js';
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
import { helperKey, PORTAL_ORIGIN } from './portal.js';
import { findByName, matchByName, nearNames, nameKeys, namesAgree } from './lib/names.js';
import { parseLine, suggestSerial, usualLength } from './lib/smartPaste.js';
import { parseInverter } from './lib/parsers.js';
import { ask, askRow } from './lib/ask.js';
import { Batch } from './models.js';
import path from 'node:path';

export const api = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// Signing in is handled by staff.js, which runs before these routes: every request here has req.staff.

// ---------- customers ----------
async function statusContext() {
  return { cfg: await loadDatasheetConfig(), files: listDatasheetFiles() };
}

// englishNameShown: the typed English name, or the one made from the Gujarati name (for search and display).
const withStatus = (c, ctx) => ({ ...c, englishNameShown: c.englishName || englishName(c.name), villageEnglish: englishName(c.village || ''), talukaEnglish: englishName(c.taluka || ''), status: customerStatus(c, ctx.cfg, ctx.files) });

// The whole list (1,400+ customers with their status) is built once and reused until a customer,
// the datasheet rules or the datasheet folder changes. Checking for a change is three tiny queries.
let listCache = { version: '', body: null, gz: null };
async function listVersion() {
  const [last, count, rules] = await Promise.all([
    Customer.findOne({}, { updatedAt: 1 }).sort({ updatedAt: -1 }).lean(),
    Customer.estimatedDocumentCount(),
    Setting.findOne({ key: 'datasheetConfig' }, { updatedAt: 1 }).lean(),
  ]);
  const files = crypto.createHash('sha1').update(listDatasheetFiles().join('|')).digest('hex').slice(0, 8);
  return [last?.updatedAt?.getTime() || 0, count, rules?.updatedAt?.getTime() || 0, files].join('-');
}

async function ensureList() {
  const version = await listVersion();
  if (listCache.version !== version) {
    const ctx = await statusContext();
    const docs = await Customer.find({}, { extra: 0 }).sort({ sheet: 1, excelRow: 1 }).lean();
    const body = Buffer.from(JSON.stringify({ customers: docs.map((c) => withStatus(c, ctx)) }));
    listCache = { version, body, gz: zlib.gzipSync(body, { level: 6 }), items: null };
  }
  return version;
}

// "Ask": a question in plain words, turned into filters over the same list (see lib/ask.js).
api.post(
  '/ask',
  wrap(async (req, res) => {
    const q = String(req.body?.q || '').slice(0, 300);
    await ensureList();
    listCache.items ||= JSON.parse(listCache.body.toString('utf8')).customers;
    const r = ask(q, listCache.items, await loadDatasheetConfig());
    res.json({ q, filters: r.filters, total: r.total, limit: r.limit, notes: r.notes, wantCount: r.wantCount, shown: Math.min(r.customers.length, 300), rows: r.customers.slice(0, 300).map(askRow) });
  })
);

api.get(
  '/customers',
  wrap(async (req, res) => {
    const version = await ensureList();
    const tag = `"${version}"`;
    res.setHeader('ETag', tag);
    res.setHeader('Cache-Control', 'private, no-cache');
    if (req.headers['if-none-match'] === tag) return res.status(304).end(); // the browser already has this list
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      res.setHeader('Content-Encoding', 'gzip');
      return res.end(listCache.gz);
    }
    res.end(listCache.body);
  })
);

/** A customer's uploaded PDF. A local copy is used when there is one (see storage.js). */
async function getUpload(c, type) {
  const meta = c.uploads?.[type];
  if (!meta) return null;
  const pdf = await storage.get(uploadKey(c._id, type), meta.hash);
  if (pdf && !meta.hash) {
    // uploaded before fingerprints existed: add one now so the next read is instant
    meta.hash = fileHash(pdf);
    await Customer.updateOne({ _id: c._id }, { $set: { [`uploads.${type}.hash`]: meta.hash } }, { timestamps: false });
    storage.keep(uploadKey(c._id, type), meta.hash, pdf);
  }
  return pdf;
}

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
    if (!c) return;
    const customer = withStatus(c, await statusContext());
    res.json({ customer });
    getReady(c, customer.status);
  })
);

// Someone has opened this customer: prepare their documents in the background, so that Preview
// and "Open customer file" answer at once. Failures here are silent; the real request reports them.
const gettingReady = new Set();
function getReady(c, st) {
  const id = String(c._id);
  if (gettingReady.has(id)) return;
  gettingReady.add(id);
  (async () => {
    if (config.hosted) {
      // a small server: only fetch the uploaded PDFs, one after the other
      for (const type of Object.keys(ALL_UPLOADS)) await getUpload(c, type);
    } else {
      const parts = await buildCustomerFile(c, st);
      if (parts.length) await mergePdfs(parts);
    }
  })()
    .catch(() => {})
    .finally(() => gettingReady.delete(id));
}

// ---------- details typed by hand ----------
const DETAIL_FIELDS = ['name', 'village', 'taluka', 'mobiles', 'mobile', 'kw', 'panelCount', 'panelRaw', 'inverterRaw', 'installer', 'note'];

/** Check and tidy the details form. Only the fields that were sent are returned. */
function readDetails(d, current = {}) {
  const values = {};
  const text = (k) => {
    if (typeof d[k] === 'string') values[k] = clean(d[k]);
  };
  ['name', 'village', 'taluka', 'panelRaw', 'inverterRaw', 'installer', 'note'].forEach(text);
  if ('name' in values && !values.name) return { error: 'The name cannot be empty' };
  if (typeof d.mobiles === 'string') {
    const raw = toAscii(d.mobiles).trim();
    const mobiles = parseMobiles(raw);
    const digits = raw.match(/\d+/g) || [];
    if (digits.some((x) => x.length !== 10)) return { error: 'A mobile number must have 10 digits. Separate two numbers with a comma.' };
    values.mobiles = mobiles;
  }
  for (const k of ['kw', 'panelCount']) {
    if (d[k] === undefined) continue;
    const s = String(d[k] ?? '').trim();
    const n = s === '' ? null : parseNumber(s);
    if (s !== '' && (n == null || n <= 0)) return { error: k === 'kw' ? 'kW must be a number, for example 3.24' : 'Panel count must be a number' };
    values[k] = n;
  }
  return { values, current };
}

/** The same checks the Excel import makes. */
function detailIssues(c) {
  const issues = [];
  if (!c.mobiles?.length) issues.push('Mobile number is blank');
  if (c.kw == null) issues.push('kW is blank');
  if (!c.panelRaw) issues.push('Panel is blank');
  if (!c.inverterRaw) issues.push('Inverter is blank');
  return issues;
}

const sameName = (a, b) => clean(a).replace(/\s+/g, ' ') === clean(b).replace(/\s+/g, ' ');

// A customer who is not in the Excel yet.
api.post(
  '/customers',
  wrap(async (req, res) => {
    const b = req.body || {};
    const sheets = await Customer.distinct('sheet');
    const sheet = sheets.includes(b.sheet) ? b.sheet : null;
    if (!sheet) return res.status(400).json({ error: 'Choose the sheet (Residential, PASHUPALAK or commercial)' });
    const { values, error } = readDetails({ name: '', ...b });
    if (error) return res.status(400).json({ error });
    const mobiles = values.mobiles || [];
    // The same person in the same sheet already: open that one instead.
    const twin = mobiles.length
      ? (await Customer.find({ sheet, mobiles: { $in: mobiles } }, { name: 1 }).lean()).find((x) => sameName(x.name, values.name))
      : null;
    if (twin) return res.status(409).json({ error: `${twin.name} with this mobile number is already in ${sheet}`, id: String(twin._id) });
    const created = await Customer.create({
      ...values,
      mobiles,
      mobile: mobiles[0] || '',
      key: `manual|${crypto.randomUUID()}`,
      sheet,
      manual: true,
      inExcel: false,
      issues: detailIssues({ ...values, mobiles }),
      notes: clean(b.why) ? [{ id: crypto.randomUUID(), text: clean(b.why), by: req.staff?.name || '', at: new Date() }] : [],
    });
    res.json({ customer: withStatus(created.toObject(), await statusContext()) });
  })
);

// Notes: why the file is not ready, why it is not printed, anything staff need to know.
api.post(
  '/customers/:id/notes',
  wrap(async (req, res) => {
    const c = await findCustomer(req, res);
    if (!c) return;
    const text = String(req.body?.text || '').trim().slice(0, 1000);
    if (!text) return res.status(400).json({ error: 'Type the note first' });
    const note = { id: crypto.randomUUID(), text, by: req.staff?.name || '', byId: String(req.staff?._id || ''), at: new Date() };
    const updated = await Customer.findByIdAndUpdate(c._id, { $push: { notes: note } }, { new: true }).lean();
    res.json({ customer: withStatus(updated, await statusContext()) });
  })
);

api.delete(
  '/customers/:id/notes/:noteId',
  wrap(async (req, res) => {
    const c = await findCustomer(req, res);
    if (!c) return;
    const note = (c.notes || []).find((n) => n.id === req.params.noteId);
    if (!note) return res.status(404).json({ error: 'This note is no longer there' });
    // Only the person who wrote it, or an admin.
    if (note.byId && note.byId !== String(req.staff?._id) && !req.staff?.admin) return res.status(403).json({ error: `Only ${note.by} or an admin can remove this note` });
    const updated = await Customer.findByIdAndUpdate(c._id, { $pull: { notes: { id: note.id } } }, { new: true }).lean();
    res.json({ customer: withStatus(updated, await statusContext()) });
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
    // Printed: by a print batch, or marked here when the file was finished another way.
    if (b.printed === false) Object.assign(set, { printedAt: null, printBatch: null, printedBy: '' });
    if (b.printed === true && !c.printedAt) Object.assign(set, { printedAt: new Date(), printBatch: null, printedBy: req.staff?.name || '' });
    // Sent: ticked by staff when the finished file has gone out.
    if (b.sent === true && !c.sentAt) {
      if (!c.printedAt && !set.printedAt) return res.status(400).json({ error: 'Print the file first: only a printed file can be sent' });
      Object.assign(set, { sentAt: new Date(), sentBy: req.staff?.name || '' });
    }
    if (b.sent === false) Object.assign(set, { sentAt: null, sentBy: '' });
    // Details from the Excel, corrected by hand.
    if (b.details && typeof b.details === 'object') {
      const { values, error } = readDetails(b.details, c);
      if (error) return res.status(400).json({ error });
      const edited = { ...(c.edited || {}) };
      for (const [field, value] of Object.entries(values)) {
        if (JSON.stringify(value) === JSON.stringify(c[field] ?? (field === 'mobiles' ? [] : field === 'kw' || field === 'panelCount' ? null : ''))) continue;
        set[field] = value;
        if (!c.manual) edited[field === 'mobile' ? 'mobiles' : field] = true;
      }
      if (set.mobiles) set.mobile = set.mobiles[0] || '';
      if (Object.keys(set).some((k) => DETAIL_FIELDS.includes(k))) {
        set.edited = edited;
        set.issues = detailIssues({ ...c, ...set });
      }
    }
    if (typeof b.removeAlias === 'string') set.nameAliases = (c.nameAliases || []).filter((a) => a !== b.removeAlias);
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

/** The customer's documents in print order, then the bill and insurance policy when uploaded.
 * withUploads=false leaves out every uploaded PDF. */
export async function buildCustomerFile(c, st, withUploads = true) {
  // Everything is started together (two documents to make, three PDFs to fetch) and joined in print order.
  const parts = [];
  if (st.payee.ok) parts.push(htmlToPdf(payeeHtml(c)));
  const sheet = (f, pages) => (datasheetPath(f) ? { file: datasheetPath(f), pages: pages[f] } : null);
  for (const f of st.datasheet.files) parts.push(sheet(f, st.datasheet.pages));
  if (st.inverter.type === 'warranty' && st.inverter.ok) {
    parts.push(htmlToPdf(warrantyHtml({ ...c, englishName: st.inverter.englishName }, st.inverter.model), { landscape: true }));
  }
  for (const f of st.inverter.files) parts.push(sheet(f, st.inverter.pages));
  for (const type of withUploads ? Object.keys(ALL_UPLOADS) : []) parts.push(getUpload(c, type));
  return (await Promise.all(parts)).filter(Boolean);
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

    const existing = await Customer.find({}, { key: 1, sheet: 1, mobile: 1, mobiles: 1, name: 1, inExcel: 1, manual: 1, edited: 1 }).lean();
    const byKey = new Map(existing.map((e) => [e.key, e]));
    const incomingKeys = new Set(parsed.customers.map((c) => c.key));
    // Customers added by hand are never "gone from the Excel".
    const orphans = existing.filter((e) => !incomingKeys.has(e.key) && !e.manual);
    // Fields corrected in the app are kept; the Excel fills in everything else.
    const keepEdited = (c, old) => {
      const out = { ...c };
      for (const f of Object.keys(old?.edited || {})) {
        delete out[f];
        if (f === 'mobiles') delete out.mobile;
      }
      if (old?.edited && Object.keys(old.edited).length) delete out.issues;
      return out;
    };

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
    // A customer added by hand who is now in the Excel (same sheet, mobile and name): the same record.
    const manual = existing.filter((e) => e.manual);
    for (const c of fresh) {
      if (!c.mobile || [...renamed.values()].includes(c)) continue;
      const twins = manual.filter((m) => m.sheet === c.sheet && (m.mobiles || []).includes(c.mobile) && sameName(m.name, c.name) && !renamed.has(String(m._id)));
      if (twins.length === 1) renamed.set(String(twins[0]._id), c);
    }
    const renamedKeys = new Set([...renamed.values()].map((c) => c.key));
    const oldById = new Map(existing.map((e) => [String(e._id), e]));

    const ops = [];
    for (const c of parsed.customers) {
      if (renamedKeys.has(c.key)) continue;
      ops.push({ updateOne: { filter: { key: c.key }, update: { $set: { ...keepEdited(c, byKey.get(c.key)), inExcel: true } }, upsert: true } });
    }
    for (const [id, c] of renamed) {
      ops.push({ updateOne: { filter: { _id: new mongoose.Types.ObjectId(id) }, update: { $set: { ...keepEdited(c, oldById.get(id)), inExcel: true, manual: false } } } });
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
      c.ownKeys = nameKeys(englishName(c.name));
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
      // Several name-like cells on the line (a whole row from the portal export): use the one that is a customer.
      if (!p.name && p.names.length > 1) p.name = p.names.find((n) => matchByName(n, all).hits.length === 1) || '';

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
        if (hits.length === 1 && p.name && !namesAgree(p.name, hits[0].ownKeys) && !namesAgree(p.name, hits[0].keys)) {
          needs(`The mobile number ${p.mobile} is ${hits[0].name}'s in your Excel, but this line names ${p.name}`, { suggestions: nearNames(p.name, pool).map(card) });
          continue;
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

// ---------- portal helper: what the page needs to build the bookmark ----------
api.get(
  '/portal-setup',
  wrap(async (req, res) =>
    res.json({
      key: await helperKey(),
      portal: PORTAL_ORIGIN,
      // The address of this server, for the bookmark. On a PC it is always the server's own port, even when
      // the page was opened through the developer screens (port 5173), which cannot serve the helper.
      appUrl: config.hosted ? req.protocol + '://' + req.get('host') : 'http://localhost:' + config.port,
    })
  )
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
        // Model codes printed on DCR certificates that mean this datasheet, e.g. "BI-55, BiN-21".
        rule.dcr = clean(r.dcr);
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
const MATCH_FIELDS = { name: 1, sheet: 1, village: 1, mobile: 1, mobiles: 1, englishName: 1, uploads: 1, applicationNumber: 1, 'portal.consumerNo': 1, nameAliases: 1, 'dcrPanels.invoice': 1, taluka: 1, kw: 1, panelRaw: 1, inverterRaw: 1 };
async function customersForMatching() {
  const customers = await Customer.find({}, MATCH_FIELDS).lean();
  for (const c of customers) {
    c.typedName = c.englishName;
    c.consumerNo = String(c.portal?.consumerNo || '').replace(/\D/g, '');
    c.invoiceNo = c.dcrPanels?.invoice?.no || ''; // the Tally invoice printed on their DCR
    // Portal PDFs carry the English name; fall back to the one made from the Gujarati name.
    prepareCustomer(c, c.englishName || englishName(c.name), englishName(c.village), englishName(c.name));
  }
  return customers;
}

const brief = (c) => ({ id: String(c._id), name: c.name, english: c.englishName, village: c.village, mobile: c.mobile });

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
  c.typedName = name;
  if (c.keys) prepareCustomer(c, name, englishName(c.village));
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

/** Is this exact PDF already stored for the customer? (Old uploads have no fingerprint: compare the files.) */
async function sameAsStored(c, type, hash) {
  const have = c.uploads?.[type];
  if (!have) return false;
  if (have.hash) return have.hash === hash;
  const stored = await storage.get(uploadKey(c._id, type));
  return !!stored && fileHash(stored) === hash;
}

/**
 * Decide what to do with one PDF, using every clue in it, and do it when the answer is certain.
 * Returns { result: 'saved' | 'same' | 'pending', … }. 'pending' means a person must decide; the
 * reason and the closest customers are returned for the "Waiting for you" list.
 */
async function placePdf({ name, buffer, text, type, dry = false }, customers) {
  // An insurance policy has many pages; only the page naming the insured and the policy number is kept.
  let kept = '';
  if (type === 'insurance') {
    // The customer information sheet and the policy wording sit next to the policy: not what goes in the file.
    if (isInfoSheet(text, name)) return { name, type, appNo: '', result: 'ignored', reason: 'Not the policy schedule (customer information sheet or wording). Only the policy page is filed.' };
    const fp = await policyFrontPage(buffer);
    buffer = fp.buffer;
    if (fp.text.trim()) text = fp.text;
    if (fp.pages > 1) kept = fp.page ? `kept page ${fp.page} of ${fp.pages}` : `could not cut the pages, kept all ${fp.pages}`;
  }
  // A bill is the first page only (the Tax Invoice): not the e-way bill or copies that follow it.
  if (type === 'bill') {
    const fp = await billFirstPage(buffer);
    buffer = fp.buffer;
    if (fp.cut) kept = `kept page 1 of ${fp.pages}`;
  }
  const m = matchCustomer(name, text, customers, type);
  const hash = fileHash(buffer);
  const c = m.matches.length === 1 && !m.conflict ? m.matches[0] : null;
  const base = { name, type, appNo: m.appNo };
  // The same Tally invoice again (a month exported twice) is the same bill, even if the PDF bytes differ.
  const ref = type === 'bill' ? invoiceRef(text) : type === 'insurance' ? policyRef(text) : '';

  if (c && type && (await sameAsStored(c, type, hash))) return { ...base, result: 'same', customer: c, how: m.how };
  if (c && ref && c.uploads?.[type]?.ref === ref) return { ...base, result: 'same', customer: c, how: m.how };

  let reason = '';
  if (m.conflict) reason = m.conflict;
  else if (m.weak) reason = m.weak;
  else if (!m.matches.length) {
    if (!text.trim()) reason = 'This is a scan or a photo: there is no text in it to read. Choose the customer';
    else if (m.docName) reason = m.suggestions.length ? `No customer is named ${m.docName}. Is it one of these?` : `No customer is named ${m.docName}`;
    else if (m.appNo) reason = `No customer is known yet for application number ${m.appNo}. Upload that customer's FL and this will be filed by itself`;
    else reason = 'No customer name, mobile number or application number could be found in this PDF';
  } else if (m.matches.length > 1) reason = `${m.matches.length} customers have this ${m.how}. Village, taluka, kW, panel, inverter and mobile on the file were compared and none of them settles it`;
  else if (!type) reason = 'Could not tell which document this is (DCR, Agreement, FL, bill or insurance policy)';
  else if (c.uploads?.[type]) reason = `${c.name} already has a different ${ALL_UPLOADS[type]}. Replace it?`;

  if (reason) return { ...base, result: 'pending', reason, candidates: (m.matches.length ? m.matches : m.suggestions).slice(0, 5) };

  if (!dry) await saveUpload(c._id, type, buffer);
  return { ...base, result: 'saved', customer: c, how: m.how, note: [m.note, kept].filter(Boolean).join('; '), certain: !!m.certain, hash, ref };
}

/** Record a PDF that placePdf saved, and learn from it. */
async function recordSaved(placed, meta, text) {
  const c = placed.customer;
  const full = { ...meta, hash: placed.hash, ...(placed.ref ? { ref: placed.ref } : {}), uploadedAt: new Date() };
  await Customer.updateOne({ _id: c._id }, { $set: { [`uploads.${placed.type}`]: full } });
  c.uploads = { ...(c.uploads || {}), [placed.type]: full };
  // A bill or policy never teaches an application number or a portal name.
  if (placed.certain && UPLOAD_TYPES[placed.type]) {
    await learnNumber(c, placed.appNo);
    if (placed.type === 'fl') await learnName(c, text);
  }
}

/**
 * PDFs in "Waiting for you" are tried again whenever something new has been learned (an
 * application number, the portal's spelling of a name), and filed by themselves if they now fit
 * exactly one customer. This is what lets the Agreement and DCR be dropped before the FL.
 */
async function resolvePending(customers) {
  const filed = [];
  for (const p of await Pending.find()) {
    const buffer = await storage.get(pendingKey(p.storedName), 'w');
    if (!buffer) continue;
    const text = await extractText(buffer);
    const type = p.detectedType || detectType(p.originalName, text);
    const placed = await placePdf({ name: p.originalName, buffer, text, type }, customers);
    if (placed.result === 'pending') continue;
    if (placed.result === 'saved') await recordSaved(placed, { originalName: p.originalName, size: p.size }, text);
    await storage.remove(pendingKey(p.storedName));
    await p.deleteOne();
    filed.push({ name: p.originalName, type, result: placed.result, how: placed.how, customer: brief(placed.customer) });
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
    if (!ALL_UPLOADS[type]) return res.status(400).json({ error: 'Unknown document type' });
    // The bill and policy may also be a photo (JPG / PNG); it is kept as a one-page PDF.
    if (OPTIONAL_UPLOADS[type] && req.file && isImage(req.file.buffer)) {
      req.file.buffer = await imageToPdf(req.file.buffer);
      req.file.size = req.file.buffer.length;
      req.file.originalname = req.file.originalname.replace(/\.(jpe?g|png)$/i, '') + '.pdf';
    }
    if (!req.file || !isPdf(req.file.buffer)) return res.status(400).json({ error: OPTIONAL_UPLOADS[type] ? 'Please choose a PDF or a photo (JPG / PNG)' : 'Please choose a PDF file' });
    if (type === 'insurance') {
      req.file.buffer = (await policyFrontPage(req.file.buffer)).buffer;
      req.file.size = req.file.buffer.length;
    }
    if (type === 'bill') {
      req.file.buffer = (await billFirstPage(req.file.buffer)).buffer;
      req.file.size = req.file.buffer.length;
    }
    await saveUpload(c._id, type, req.file.buffer);
    await Customer.updateOne({ _id: c._id }, { $set: { [`uploads.${type}`]: { ...uploadMeta(fixName(req.file)), hash: fileHash(req.file.buffer) } } });
    // A bill or policy carries no application number or portal name to learn from.
    if (OPTIONAL_UPLOADS[type]) {
      const updated = await Customer.findById(c._id).lean();
      return res.json({ customer: withStatus(updated, await statusContext()), warning: '' });
    }

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
    if (!ALL_UPLOADS[type]) return res.status(400).json({ error: 'Unknown document type' });
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
    const pdf = ALL_UPLOADS[req.params.type] && (await getUpload(c, req.params.type));
    if (!pdf) return res.status(404).json({ error: 'This PDF could not be found. Upload it again.' });
    res.setHeader('Content-Type', 'application/pdf');
    res.send(pdf);
  })
);

/**
 * Turn raw files (uploaded, or read from a folder) into items ready to place: a photo becomes a one-page
 * PDF, a PDF holding a month of Tally invoices is split into one PDF per invoice, the same file twice is
 * skipped. `seen` remembers fingerprints across calls.
 */
async function readItems(files, customers, seen = new Set(), kind = '') {
  const items = [];
  const push = (o) => items.push({ index: items.length, ...o });
  for (const file of files) {
    let name = file.originalname;
    let photo = false;
    // A photo can only be a bill or a policy; it is kept as a one-page PDF.
    if (isImage(file.buffer)) {
      file.buffer = await imageToPdf(file.buffer);
      file.size = file.buffer.length;
      name = file.originalname = name.replace(/\.(jpe?g|png)$/i, '') + '.pdf';
      photo = true;
    }
    if (!isPdf(file.buffer)) {
      push({ name, skip: 'rejected', reason: 'Not a PDF file or a photo' });
      continue;
    }
    const hash = fileHash(file.buffer);
    if (seen.has(hash)) {
      push({ name, skip: 'same', reason: 'The same PDF is in this upload twice' });
      continue;
    }
    seen.add(hash);
    const text = await extractText(file.buffer);
    let type = detectType(name, text);
    // The customer information sheet and the policy wording sit next to every policy: skipped, not an error.
    if ((kind === 'insurance' || type === 'insurance') && isInfoSheet(text, name)) {
      push({ name, skip: 'ignored', reason: 'Not the policy schedule (customer information sheet or wording). Only the policy page is filed.' });
      continue;
    }
    // A folder said to hold policies (or invoices): a scan with no readable text is taken as that; anything that
    // clearly is something else is left out.
    if (kind) {
      if (type && type !== kind) {
        push({ name, skip: 'rejected', reason: `This does not look like ${ALL_UPLOADS[kind].toLowerCase()}: it looks like ${ALL_UPLOADS[type].toLowerCase()}` });
        continue;
      }
      type = kind;
    }
    if (photo && !OPTIONAL_UPLOADS[type]) type = null; // a photo is never a portal document
    if (type === 'bill' && !photo) {
      const off = file.pageOffset || 0; // a piece of a big PDF: page numbers count from the start of the whole file
      const parts = await splitInvoices(file.buffer, file.pageOffset != null ? 1 : 2);
      if (parts) {
        for (const p of parts) {
          const where = p.pages.length > 1 ? `pages ${p.pages[0] + off}-${p.pages[p.pages.length - 1] + off}` : `page ${p.pages[0] + off}`;
          push({ name: `${name} (${where})`, file: { buffer: p.buffer, size: p.buffer.length }, text: p.text, type: 'bill', first: false });
        }
        continue;
      }
    }
    push({ name, file, text, type, first: !OPTIONAL_UPLOADS[type] && hasCustomerMobile(name, text, customers) });
  }
  // The PDFs that carry a mobile number (the FLs) go first, so their application numbers and names are
  // known when the others are placed.
  items.sort((a, b) => Number(!!b.first) - Number(!!a.first) || a.index - b.index);
  return items;
}

/** File every item that can be settled; park the rest in "Waiting for you". */
async function placeItems(items, customers, dry = false, scan = false) {
  const results = [];
  const touched = new Map();
  for (const it of items) {
    const { index, name, file, type, text } = it;
    if (it.skip) {
      results.push({ index, name, result: it.skip, reason: it.reason });
      continue;
    }
    const placed = await placePdf({ name, buffer: file.buffer, text, type, dry }, customers);
    if (placed.result === 'ignored') {
      results.push({ index, name, result: 'ignored', type, reason: placed.reason });
      continue;
    }
    // From a folder scan: a file nobody in the customer list fits (not even as a guess) is only reported, not queued.
    if (placed.result === 'pending' && scan && !placed.candidates.length) {
      results.push({ index, name, result: 'unmatched', type, reason: placed.reason });
      continue;
    }
    if (placed.result === 'pending' && dry) {
      results.push({ index, name, result: 'pending', type, reason: placed.reason });
      continue;
    }
    if (placed.result === 'pending') {
      const storedName = `${crypto.randomUUID()}.pdf`;
      await storage.put(pendingKey(storedName), file.buffer, 'w');
      await Pending.create({ originalName: name, storedName, size: file.size, detectedType: type || '', applicationNumber: placed.appNo, candidates: placed.candidates.map((c) => c._id), reason: placed.reason });
      results.push({ index, name, result: 'pending', type, reason: placed.reason });
      continue;
    }
    if (placed.result === 'saved' && !dry) await recordSaved(placed, { originalName: name, size: file.size }, text);
    if (UPLOAD_TYPES[type]) touched.set(String(placed.customer._id), placed.customer);
    results.push({ index, name, result: placed.result, type, customer: brief(placed.customer), how: placed.how, note: placed.note || '' });
  }
  return { results, touched };
}

/** What a bulk upload or a folder scan answers with: the results, the waiting PDFs that could now be placed, who is still missing a document. */
async function finishBatch(results, touched, customers, dry = false) {
  // Anything that was waiting (from this batch or an earlier one) and can now be placed.
  const alsoFiled = dry ? [] : await resolvePending(customers);
  for (const f of alsoFiled) {
    const c = customers.find((x) => String(x._id) === f.customer.id);
    if (c && UPLOAD_TYPES[f.type]) touched.set(f.customer.id, c);
  }
  const done = new Map(alsoFiled.map((f) => [f.name, f]));
  return {
    results: results.sort((a, b) => a.index - b.index).map((r) => (r.result === 'pending' && done.has(r.name) ? { ...r, ...done.get(r.name), reason: '' } : r)),
    alsoFiled: alsoFiled.filter((f) => !results.some((r) => r.name === f.name)),
    // For every customer this batch touched: which of the three portal documents they now have.
    customers: [...touched.values()].map((c) => ({ ...brief(c), has: Object.fromEntries(Object.keys(UPLOAD_TYPES).map((t) => [t, !!c.uploads?.[t]])) })),
  };
}

// Many PDFs at once. Every PDF is read, every clue cross-checked, and whatever is certain is filed.
// Only the PDFs the app cannot settle are left for a person, each with the reason and its best guesses.
api.post(
  '/uploads/bulk',
  upload.array('files', 200),
  wrap(async (req, res) => {
    const customers = await customersForMatching();
    await learnFromStoredUploads(customers);
    const items = await readItems((req.files || []).map(fixName), customers);
    const { results, touched } = await placeItems(items, customers);
    res.json(await finishBatch(results, touched, customers));
  })
);

// ---------- a folder on this PC (for example the pendrive with the insurance policies) ----------
const SKIP_DIRS = /^(\$|\.|system volume information$)/i;
const MAX_SCAN = 5000;
const MAX_SCAN_FILE = 40 * 1024 * 1024;

function scanRoot(req, res) {
  if (config.hosted) {
    res.status(400).json({ error: 'Folder scan only works when the app runs on your own PC' });
    return null;
  }
  const folder = String(req.body?.folder || '').trim().replace(/^["']|["']$/g, '');
  if (!folder) {
    res.status(400).json({ error: 'Type the folder, for example E:\\Policies' });
    return null;
  }
  try {
    if (!fs.statSync(folder).isDirectory()) throw new Error('not a folder');
  } catch {
    res.status(400).json({ error: `The folder "${folder}" was not found on this PC. Check the path, and that the pendrive is plugged in.` });
    return null;
  }
  return path.resolve(folder);
}

/** Every PDF under a folder, folders inside folders included, as paths relative to it. */
function walkPdfs(root) {
  const out = [];
  const walk = (dir, rel) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (out.length >= MAX_SCAN) return;
      if (SKIP_DIRS.test(e.name)) continue;
      const r = rel ? `${rel}\\${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else if (/\.pdf$/i.test(e.name)) out.push(r);
    }
  };
  walk(root, '');
  return out;
}

api.post(
  '/uploads/scan/list',
  wrap(async (req, res) => {
    const root = scanRoot(req, res);
    if (!root) return;
    const files = walkPdfs(root);
    // A month of invoices is one PDF with hundreds of pages: it is read ten pages at a time, so no single request is long
    // and an interrupted run simply carries on (what is filed is "already there" next time).
    let chunks;
    if (req.body?.kind === 'bill') {
      chunks = [];
      for (const rel of files) {
        const { pages } = await pageTexts(fs.readFileSync(path.join(root, rel)), 0);
        for (let from = 1; from <= Math.max(pages, 1); from += 10) chunks.push({ file: rel, from, to: Math.min(from + 9, pages) });
      }
    }
    res.json({ folder: root, count: files.length, files, chunks, capped: files.length >= MAX_SCAN });
  })
);

// A few of the listed files at a time, so a big pendrive does not run into one very long request.
api.post(
  '/uploads/scan/run',
  wrap(async (req, res) => {
    const root = scanRoot(req, res);
    if (!root) return;
    const files = [];
    const results = [];
    for (const ch of (Array.isArray(req.body?.chunks) ? req.body.chunks : []).slice(0, 3)) {
      const rel = String(ch?.file || '');
      const full = path.resolve(root, rel);
      if (!full.toLowerCase().startsWith(root.toLowerCase() + path.sep) || !/\.pdf$/i.test(full)) continue;
      try {
        const part = await cutPages(fs.readFileSync(full), Number(ch.from) || 1, Number(ch.to) || 1);
        files.push({ originalname: rel, buffer: part, size: part.length, pageOffset: (Number(ch.from) || 1) - 1 });
      } catch (err) {
        results.push({ index: 9e6 + results.length, name: rel, result: 'rejected', reason: `Could not be read: ${err.message}` });
      }
    }
    for (const rel of (Array.isArray(req.body?.files) ? req.body.files : []).slice(0, 20)) {
      const full = path.resolve(root, String(rel));
      // only PDFs inside the chosen folder
      if (!full.toLowerCase().startsWith(root.toLowerCase() + path.sep) || !/\.pdf$/i.test(full)) continue;
      try {
        if (fs.statSync(full).size > MAX_SCAN_FILE) {
          results.push({ index: 9e6 + results.length, name: String(rel), result: 'rejected', reason: 'This PDF is larger than 40 MB' });
          continue;
        }
        const buffer = fs.readFileSync(full);
        files.push({ originalname: String(rel), buffer, size: buffer.length });
      } catch (err) {
        results.push({ index: 9e6 + results.length, name: String(rel), result: 'rejected', reason: `Could not be read: ${err.message}` });
      }
    }
    const customers = await customersForMatching();
    const kind = OPTIONAL_UPLOADS[req.body?.kind] ? req.body.kind : '';
    const items = await readItems(files, customers, new Set(), kind);
    const dry = req.body?.dry === true; // "check only": nothing is saved
    const placed = await placeItems(items, customers, dry, true);
    const out = await finishBatch([...placed.results, ...results], placed.touched, customers, dry);
    res.json({ ...out, dry });
  })
);

api.get(
  '/pending',
  wrap(async (req, res) => {
    const pending = await Pending.find().sort({ createdAt: 1 }).populate('candidates', 'name village taluka mobile sheet kw panelRaw excelRow englishName').lean();
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
    const pdf = await storage.get(pendingKey(p.storedName), 'w');
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
    if (!ALL_UPLOADS[type]) return res.status(400).json({ error: 'Choose which document this is' });
    const c = mongoose.isValidObjectId(customerId) ? await Customer.findById(customerId).lean() : null;
    if (!c) return res.status(400).json({ error: 'Choose the customer' });
    let buffer = await storage.get(pendingKey(p.storedName), 'w');
    if (!buffer) return res.status(404).json({ error: 'This PDF could not be found. Upload it again.' });
    if (type === 'insurance') buffer = (await policyFrontPage(buffer)).buffer;
    if (type === 'bill') buffer = (await billFirstPage(buffer)).buffer;
    await saveUpload(c._id, type, buffer);
    await Customer.updateOne({ _id: c._id }, { $set: { [`uploads.${type}`]: { originalName: p.originalName, size: p.size, uploadedAt: new Date(), hash: fileHash(buffer) } } });
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
