// Endpoints used by the portal helper: a small script that staff start, by a bookmark, inside their own
// logged-in PM Surya Ghar vendor portal tab. The helper never makes portal requests of its own. It only
// reads what the portal page itself loads when staff use it (the application list, an application's
// details, a PDF opened with "View") and passes that here, so nothing has to be saved and uploaded by hand.
import crypto from 'node:crypto';
import express from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import { Customer, getSetting, setSetting } from './models.js';
import { loadDatasheetConfig } from './lib/datasheets.js';
import { parseInverter } from './lib/parsers.js';
import { englishName } from './lib/transliterate.js';
import { nameKeys, namesAgree, plainName, sharedWords } from './lib/names.js';
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

const FIELDS = { name: 1, village: 1, sheet: 1, mobile: 1, mobiles: 1, kw: 1, englishName: 1, applicationNumber: 1, inverterRaw: 1, inverterSerial: 1, uploads: 1, portal: 1, nameAliases: 1 };
async function loadCustomers() {
  const customers = await Customer.find({}, FIELDS).lean();
  // ownKeys: the customer's name as it stands in the Excel (Gujarati), the one thing we can trust.
  for (const c of customers) c.ownKeys = nameKeys(englishName(c.name));
  return customers;
}
/** The portal name is this customer's: it agrees with the Excel name, or a person confirmed it. */
const agrees = (name, c) => namesAgree(name, c.ownKeys) || (c.nameAliases || []).includes(plainName(name));
const digits = (s) => String(s || '').replace(/\D/g, '').slice(-10);
/** Two mobile numbers that differ by one wrong, missing, extra or swapped digit: most likely one number with a typo. */
function near(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length === b.length) {
    let d = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
    if (d <= 1) return true;
    for (let i = 0; i < a.length - 1; i++) {
      if (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(0, i) === b.slice(0, i) && a.slice(i + 2) === b.slice(i + 2)) return true;
    }
    return false;
  }
  if (Math.abs(a.length - b.length) !== 1) return false;
  const [s, l] = a.length < b.length ? [a, b] : [b, a];
  for (let i = 0; i < l.length; i++) if (l.slice(0, i) + l.slice(i + 1) === s) return true;
  return false;
}
const appNo = (s) => String(s || '').toUpperCase().replace(/\s+/g, '');
const has = (c) => Object.fromEntries(Object.keys(UPLOAD_TYPES).map((t) => [t, !!c.uploads?.[t]]));
const sameName = (c, customers) => (customers || []).filter((o) => String(o._id) !== String(c._id) && String(o.name || '').replace(/\s+/g, ' ').trim() === String(c.name || '').replace(/\s+/g, ' ').trim()).length;
const brief = (c, customers) => ({ id: String(c._id), name: c.name, english: c.englishName || englishName(c.name), village: c.village, kw: c.kw, sameName: customers ? sameName(c, customers) : 0, has: has(c) });

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
    if (agrees(name, byNo[0])) return { c: byNo[0], how: 'application number and name' };
    return { c: null, mismatch: byNo[0] };
  }
  const m = digits(mobile);
  const hits = m.length === 10 ? customers.filter((c) => (c.mobiles || []).includes(m)) : [];
  const agreeing = hits.filter((c) => agrees(name, c));
  if (agreeing.length === 1) return { c: agreeing[0], how: 'mobile number and name' };
  if (agreeing.length > 1) return { c: null, several: true };
  // The customers whose Excel name agrees and who have no application yet.
  const byName = customers.filter((c) => !c.applicationNumber && agrees(name, c));
  // The name agrees and the Excel number is the portal's number with one digit wrong (a typo on either side):
  // this is the same person. Only when exactly one such customer exists; the difference is shown to staff.
  const nearNumber = m.length === 10 ? byName.filter((c) => (c.mobiles || []).some((x) => near(x, m))) : [];
  if (nearNumber.length === 1) {
    return { c: nearNumber[0], how: 'name and a mobile number one digit different', mobileDiffers: { portal: m, excel: (nearNumber[0].mobiles || []).find((x) => near(x, m)) } };
  }
  // Otherwise nothing is chosen by itself: the mobile's owner (if any) and the customers with this name are offered.
  return { c: null, mismatch: hits[0] || null, byName };
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
      if (!r || agrees(r.consumerName, c)) continue;
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
      const agreeing = hits.filter((c) => agrees(r.consumerName, c));
      if (hits.length && !agreeing.length) out.nameDiffers++;
      if (agreeing.length === 1) mine.set(agreeing[0], [...(mine.get(agreeing[0]) || []), r]);
      else if (!agreeing.length) {
        // No exact number, but exactly one customer without an application whose name agrees and whose Excel number is
        // this one with a single wrong digit (a typo on the portal or in the Excel): the same person.
        const m = digits(r.mobileNo);
        const close = m.length === 10 ? customers.filter((c) => !c.applicationNumber && (c.mobiles || []).some((x) => near(x, m)) && agrees(r.consumerName, c)) : [];
        if (close.length === 1) {
          mine.set(close[0], [...(mine.get(close[0]) || []), r]);
          out.nearMobile = (out.nearMobile || 0) + 1;
        }
      }
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
          mobile: digits(r.mobileNo),
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
    const { c, several, mismatch, byName, mobileDiffers } = whose({ applicationNumber: d.applicationNumber, mobile: d.mobile, name: d.name }, customers);
    if (!c) {
      const reason = several
        ? 'Several customers in your Excel have this mobile number and this name'
        : mismatch && byName?.length
          ? `The mobile number on this application is ${mismatch.name}'s in your Excel, but the NAME matches the customer(s) below. Which one is it?`
          : mismatch
            ? `Not matched: this application is in the name of ${d.name}, but its mobile number is ${mismatch.name}'s in your Excel`
            : byName?.length
              ? `This application's mobile number (${digits(d.mobile)}) is not in your Excel, but the name is. Is it one of these?`
              : 'This application is not in the app: its mobile number and name are not in your Excel';
      // The person the number points at, so staff can say "same person" with one click. Not offered again when
      // that person is already among the name matches.
      const shared = mismatch ? sharedWords(d.name, mismatch.ownKeys) : 0;
      const candidate = mismatch && !mismatch.applicationNumber && !(byName || []).some((x) => String(x._id) === String(mismatch._id)) ? { ...brief(mismatch), shared, words: nameKeys(d.name).length } : null;
      // Name matches first, those whose Excel number is closest to the portal's number leading.
      const m = digits(d.mobile);
      const others = (byName || [])
        .slice()
        .sort((a, b) => Number((b.mobiles || []).some((x) => near(x, m))) - Number((a.mobiles || []).some((x) => near(x, m))))
        .slice(0, 5)
        .map((x) => ({ ...brief(x, customers), mobile: x.mobile, numberNear: (x.mobiles || []).some((y) => near(y, m)) }));
      return res.json({ found: false, reason, candidate, others, portalMobile: m });
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
    // The mobile number the portal has for this application (kept to show when it is not the Excel's).
    set.portal = { ...(c.portal || {}), available, checkedAt: new Date(), mobile: digits(d.mobile) };
    let matchNote = '';
    if (mobileDiffers) {
      matchNote = `Found by the name. The portal has mobile ${mobileDiffers.portal}, your Excel has ${mobileDiffers.excel}: one digit differs. Check which is right.`;
    } else if (digits(d.mobile) && !(c.mobiles || []).includes(digits(d.mobile))) {
      matchNote = `The portal has mobile ${digits(d.mobile)}, which is not the number in your Excel (${(c.mobiles || []).join(', ') || 'none'}).`;
    }
    if (Object.keys(set).length) await Customer.updateOne({ _id: c._id }, { $set: set });
    Object.assign(c, set);
    res.json({ found: true, matchNote, customer: brief(c, customers), available, learned: Object.keys(set).filter((k) => k !== 'portal'), serial, portalSerial: serials[0] || '', appSerial: c.inverterSerial || '' });
  })
);

// Staff say the application whose name differs is this customer after all (a surname spelled
// differently on the portal, a married name …). The portal spelling is remembered for them, so the
// helper, the list import and Upload PDFs all accept it from now on.
portal.post(
  '/confirm',
  wrap(async (req, res) => {
    const { customerId, name, applicationNumber } = req.body || {};
    const portalName = plainName(name);
    if (!portalName || !mongoose.isValidObjectId(customerId)) return res.status(400).json({ error: 'Missing customer or name' });
    const c = await Customer.findById(customerId, FIELDS).lean();
    if (!c) return res.status(404).json({ error: 'Customer not found' });
    const no = appNo(applicationNumber);
    if (no && c.applicationNumber && c.applicationNumber !== no) return res.status(409).json({ error: `${c.name} already has application ${c.applicationNumber}` });
    if (no && (await Customer.exists({ applicationNumber: no, _id: { $ne: c._id } }))) return res.status(409).json({ error: `Application ${no} is already saved for another customer` });
    const set = {};
    if (no && !c.applicationNumber) set.applicationNumber = no;
    if (!c.englishName) set.englishName = portalName;
    await Customer.updateOne({ _id: c._id }, { $addToSet: { nameAliases: portalName }, ...(Object.keys(set).length ? { $set: set } : {}) });
    res.json({ ok: true });
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
    if (have?.hash === hash) return res.json({ result: 'same', customer: brief(c, customers) });
    if (have && replace !== 'yes') return res.json({ result: 'different', customer: brief(c, customers) });

    await saveUpload(c._id, type, req.file.buffer);
    const meta = { originalName: Buffer.from(req.file.originalname, 'latin1').toString('utf8'), size: req.file.size, uploadedAt: new Date(), hash, from: 'portal' };
    await Customer.updateOne({ _id: c._id }, { $set: { [`uploads.${type}`]: meta } });
    c.uploads = { ...(c.uploads || {}), [type]: meta };
    res.json({ result: 'saved', customer: brief(c, customers) });
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
