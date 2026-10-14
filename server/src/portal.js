// Endpoints used by the portal helper: a small script that staff start, by a bookmark, inside their own
// logged-in PM Surya Ghar vendor portal tab. The helper never makes portal requests of its own. It only
// reads what the portal page itself loads when staff use it (the application list, an application's
// details, a PDF opened with "View") and passes that here, so nothing has to be saved and uploaded by hand.
import crypto from 'node:crypto';
import express from 'express';
import multer from 'multer';
import { Customer, getSetting, setSetting } from './models.js';
import { loadDatasheetConfig } from './lib/datasheets.js';
import { parseInverter } from './lib/parsers.js';
import { englishName } from './lib/transliterate.js';
import { nameKeys, namesAgree } from './lib/names.js';
import { UPLOAD_TYPES, fileHash, isPdf, saveUpload } from './lib/uploads.js';

export const PORTAL_ORIGIN = 'https://vendor.pmsuryaghar.gov.in';
export const portal = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

/** The key the bookmark carries. Made once and kept in the database; shown only to logged-in staff. */
export async function helperKey() {
  let key = await getSetting('helperKey');
  if (!key) {
    key = crypto.randomBytes(24).toString('hex');
    await setSetting('helperKey', key);
  }
  return key;
}

/** Only the portal's own pages may call these endpoints from a browser. */
export function portalCors(req, res, next) {
  if (req.headers.origin === PORTAL_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', PORTAL_ORIGIN);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'content-type, x-helper-key');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Private-Network', 'true'); // the app may run on this PC (localhost)
    res.setHeader('Access-Control-Max-Age', '600');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
}

portal.use(portalCors);
portal.use(
  wrap(async (req, res, next) => {
    const given = Buffer.from(String(req.headers['x-helper-key'] || ''));
    const want = Buffer.from(await helperKey());
    if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return res.status(401).json({ error: 'The helper key is wrong. Add the bookmark again from the app.' });
    next();
  })
);

const FIELDS = { name: 1, village: 1, sheet: 1, mobile: 1, mobiles: 1, kw: 1, englishName: 1, applicationNumber: 1, inverterRaw: 1, inverterSerial: 1, uploads: 1, portal: 1 };
async function loadCustomers() {
  const customers = await Customer.find({}, FIELDS).lean();
  // ownKeys: the customer's name as it stands in the Excel (Gujarati), the one thing we can trust.
  for (const c of customers) c.ownKeys = nameKeys(englishName(c.name));
  return customers;
}
const digits = (s) => String(s || '').replace(/\D/g, '').slice(-10);
const appNo = (s) => String(s || '').toUpperCase().replace(/\s+/g, '');
const has = (c) => Object.fromEntries(Object.keys(UPLOAD_TYPES).map((t) => [t, !!c.uploads?.[t]]));
const brief = (c) => ({ id: String(c._id), name: c.name, english: c.englishName || englishName(c.name), village: c.village, has: has(c) });

/**
 * The customer an application belongs to.
 * One mobile number is often used for several people's applications (a relative, an agent), so a
 * mobile number or an application number is only accepted when the name on the portal is also the
 * customer's name. `mismatch` is the customer the number pointed at when the name did not agree.
 */
function whose({ applicationNumber, mobile, name }, customers) {
  const no = appNo(applicationNumber);
  const byNo = no ? customers.filter((c) => c.applicationNumber === no) : [];
  if (byNo.length === 1) {
    if (namesAgree(name, byNo[0].ownKeys)) return { c: byNo[0], how: 'application number and name' };
    return { c: null, mismatch: byNo[0] };
  }
  const m = digits(mobile);
  const hits = m.length === 10 ? customers.filter((c) => (c.mobiles || []).includes(m)) : [];
  const agreeing = hits.filter((c) => namesAgree(name, c.ownKeys));
  if (agreeing.length === 1) return { c: agreeing[0], how: 'mobile number and name' };
  if (agreeing.length > 1) return { c: null, several: true };
  return { c: null, mismatch: hits[0] || null };
}

portal.get('/ping', wrap(async (req, res) => res.json({ ok: true, customers: await Customer.estimatedDocumentCount() })));

// The portal's whole application list (loaded by the "My Application" page): teaches the app each
// customer's application number and the portal's spelling of their name, in one go.
portal.post(
  '/list',
  wrap(async (req, res) => {
    const rows = Array.isArray(req.body?.applications) ? req.body.applications : [];
    const customers = await loadCustomers();
    const byMobile = new Map();
    for (const c of customers) for (const m of c.mobiles || []) byMobile.set(m, [...(byMobile.get(m) || []), c]);
    const rowByNo = new Map(rows.map((r) => [appNo(r.appRefNo), r]));
    const out = { applications: rows.length, matched: 0, numbers: 0, names: 0, already: 0, nameDiffers: 0, severalApplications: 0, undone: 0 };
    const ops = new Map(); // customer id → { $set, $unset }
    const op = (c) => ops.get(String(c._id)) || ops.set(String(c._id), { set: {}, unset: {} }).get(String(c._id));

    // 1. Undo anything saved earlier from a row whose name is not this customer's name.
    for (const c of customers) {
      const r = c.applicationNumber && rowByNo.get(c.applicationNumber);
      if (!r || namesAgree(r.consumerName, c.ownKeys)) continue;
      const o = op(c);
      o.unset.applicationNumber = 1;
      o.unset.portal = 1;
      if (c.englishName && c.englishName === String(r.consumerName || '').replace(/\s+/g, ' ').trim().toUpperCase()) {
        o.unset.englishName = 1;
        c.englishName = '';
      }
      c.applicationNumber = '';
      out.undone++;
    }

    // 2. For each customer: the portal rows with their mobile number AND their name.
    const mine = new Map();
    for (const r of rows) {
      const hits = byMobile.get(digits(r.mobileNo)) || [];
      const agreeing = hits.filter((c) => namesAgree(r.consumerName, c.ownKeys));
      if (hits.length && !agreeing.length) out.nameDiffers++;
      if (agreeing.length === 1) mine.set(agreeing[0], [...(mine.get(agreeing[0]) || []), r]);
    }
    const taken = new Map(customers.filter((c) => c.applicationNumber).map((c) => [c.applicationNumber, String(c._id)]));
    for (const [c, list] of mine) {
      // the same person with two applications: the one with this customer's kW, if only one fits
      let r = list.length === 1 ? list[0] : null;
      if (!r) {
        const byKw = list.filter((x) => c.kw != null && Math.abs(Number(x.appliedCapacity) - c.kw) < 0.06);
        if (byKw.length === 1) r = byKw[0];
      }
      if (!r) {
        out.severalApplications++;
        continue;
      }
      out.matched++;
      const no = appNo(r.appRefNo);
      const o = op(c);
      if (c.applicationNumber === no) out.already++;
      else if (!c.applicationNumber && !taken.has(no)) {
        o.set.applicationNumber = no;
        delete o.unset.applicationNumber;
        c.applicationNumber = no;
        taken.set(no, String(c._id));
        out.numbers++;
      }
      const portalName = String(r.consumerName || '').replace(/\s+/g, ' ').trim().toUpperCase();
      if (portalName && !c.englishName) {
        o.set.englishName = portalName;
        delete o.unset.englishName;
        out.names++;
      }
      if (c.applicationNumber === no) {
        o.set.portal = {
          ...(c.portal || {}),
          appId: r.appId,
          consumerNo: String(r.consumerNo || ''),
          stage: String(r.stageName || ''),
          status: String(r.statusName || ''),
        };
        delete o.unset.portal;
      }
    }

    const writes = [...ops.entries()]
      .map(([id, o]) => {
        const update = {};
        if (Object.keys(o.set).length) update.$set = o.set;
        if (Object.keys(o.unset).length) update.$unset = o.unset;
        return Object.keys(update).length ? { updateOne: { filter: { _id: id }, update } } : null;
      })
      .filter(Boolean);
    if (writes.length) await Customer.bulkWrite(writes, { ordered: false });
    res.json(out);
  })
);

// One application's details (loaded when staff press "View Application").
portal.post(
  '/application',
  wrap(async (req, res) => {
    const d = req.body || {};
    const customers = await loadCustomers();
    const { c, several, mismatch } = whose({ applicationNumber: d.applicationNumber, mobile: d.mobile, name: d.name }, customers);
    if (!c) {
      const reason = several
        ? 'Several customers in your Excel have this mobile number and this name'
        : mismatch
          ? `Not matched: this application is in the name of ${d.name}, but its mobile number is ${mismatch.name}'s in your Excel`
          : 'This application is not in the app: its mobile number is not in your Excel';
      return res.json({ found: false, reason });
    }

    const set = {};
    const no = appNo(d.applicationNumber);
    if (no && !c.applicationNumber) set.applicationNumber = no;
    const portalName = String(d.name || '').replace(/\s+/g, ' ').trim().toUpperCase();
    if (portalName && !c.englishName) set.englishName = portalName;

    // The inverter serial number entered on the portal: used for the SOLARYAAN warranty card.
    const cfg = await loadDatasheetConfig();
    const solaryaan = parseInverter(c.inverterRaw, cfg.inverterBrands).brand === 'solaryaan';
    const serials = [...new Set((d.inverters || []).flatMap((i) => i.serials || []).map((s) => String(s || '').toUpperCase().replace(/\s+/g, '')).filter(Boolean))];
    let serial = 'none';
    if (solaryaan && serials.length === 1) {
      if (c.inverterSerial === serials[0]) serial = 'same';
      else if (c.inverterSerial) serial = 'differs';
      else if (await Customer.exists({ inverterSerial: serials[0], _id: { $ne: c._id } })) serial = 'onAnother';
      else {
        set.inverterSerial = serials[0];
        serial = 'saved';
      }
    } else if (solaryaan && serials.length > 1) serial = 'several';
    else if (!solaryaan) serial = 'notNeeded';

    const labels = new Set((d.documents || []).map((x) => x.type));
    const available = { fl: labels.has('Feasibility Document'), dcr: labels.has('DCR Declaration'), agreement: labels.has('Vendor And Customer Agreement') };
    set.portal = { ...(c.portal || {}), available, checkedAt: new Date() };
    if (Object.keys(set).length) await Customer.updateOne({ _id: c._id }, { $set: set });
    Object.assign(c, set);
    res.json({ found: true, customer: brief(c), available, learned: Object.keys(set).filter((k) => k !== 'portal'), serial, portalSerial: serials[0] || '', appSerial: c.inverterSerial || '' });
  })
);

// One PDF that staff opened with "View" on the portal.
portal.post(
  '/document',
  upload.single('file'),
  wrap(async (req, res) => {
    const { type, applicationNumber, mobile, name, replace } = req.body || {};
    if (!UPLOAD_TYPES[type]) return res.status(400).json({ error: 'Unknown document type' });
    if (!req.file || !isPdf(req.file.buffer)) return res.status(400).json({ error: 'Not a PDF' });
    const customers = await loadCustomers();
    const { c } = whose({ applicationNumber, mobile, name }, customers);
    if (!c) return res.json({ result: 'noCustomer' });

    const hash = fileHash(req.file.buffer);
    const have = c.uploads?.[type];
    if (have?.hash === hash) return res.json({ result: 'same', customer: brief(c) });
    if (have && replace !== 'yes') return res.json({ result: 'different', customer: brief(c) });

    await saveUpload(c._id, type, req.file.buffer);
    const meta = { originalName: Buffer.from(req.file.originalname, 'latin1').toString('utf8'), size: req.file.size, uploadedAt: new Date(), hash, from: 'portal' };
    await Customer.updateOne({ _id: c._id }, { $set: { [`uploads.${type}`]: meta } });
    c.uploads = { ...(c.uploads || {}), [type]: meta };
    res.json({ result: 'saved', customer: brief(c) });
  })
);

// Who still needs documents: shown in the helper so staff know which application to open next.
portal.get(
  '/queue',
  wrap(async (req, res) => {
    const customers = await Customer.find({ applicationNumber: { $nin: [null, ''] } }, FIELDS).sort({ sheet: -1, excelRow: 1 }).lean();
    const missing = (c) => Object.keys(UPLOAD_TYPES).filter((t) => !c.uploads?.[t]);
    const waiting = customers.filter((c) => missing(c).length);
    // Opened before and the portal did not have any of the documents still needed: nothing to fetch yet.
    const notYet = (c) => c.portal?.available && missing(c).every((t) => !c.portal.available[t]);
    // How far the application is on the portal. From Inspection onwards all three documents are there.
    const rank = (c) => {
      const s = `${c.portal?.stage || ''} ${c.portal?.status || ''}`.toLowerCase();
      if (/disburs/.test(s)) return 10;
      if (/subsidy|redeem|claim/.test(s)) return 9;
      if (/commission/.test(s)) return 8;
      if (/inspection/.test(s)) return 7;
      if (/installation/.test(s)) return 6;
      if (/agreement/.test(s)) return 2;
      if (/vendor|feasib|application|registration/.test(s)) return 1;
      return 5; // stage not known yet
    };
    const ready = waiting.filter((c) => !notYet(c) && rank(c) >= 6).sort((a, b) => rank(b) - rank(a));
    const early = waiting.filter((c) => !notYet(c) && rank(c) < 6);
    const blocked = waiting.filter(notYet);
    const row = (c) => ({ ...brief(c), applicationNumber: c.applicationNumber, consumerNo: c.portal?.consumerNo || '', mobile: c.mobile, stage: c.portal?.stage || c.portal?.status || '', missing: missing(c) });
    res.json({
      withNumber: customers.length,
      complete: customers.length - waiting.length,
      waiting: waiting.length,
      ready: ready.length, // documents should be on the portal now
      early: early.length, // application not far enough on the portal
      notOnPortalYet: blocked.length, // opened before; the portal did not have the documents
      next: ready.slice(0, 60).map(row),
      later: [...blocked, ...early].slice(0, 30).map(row),
    });
  })
);

portal.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'The app could not save this. Try again.' });
});
