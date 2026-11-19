import crypto from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs';
import { storage } from './storage.js';
import { learnDcrPanels } from './dcr.js';
import { toAscii } from './gujarati.js';
import { matchByName, nearNames, nameKeys, namesAgree, plainName, sameWord, soundKey } from './names.js';
import { englishName } from './transliterate.js';

// Load the PDF reader's worker at startup. Left alone, pdf.js imports it the first time a PDF is
// read, and under `node --watch` (npm run dev) that late import restarts the server mid-upload.
globalThis.pdfjsWorker = pdfjsWorker;

// Documents that come from the PM Surya Ghar portal, in print order.
export const UPLOAD_TYPES = {
  dcr: 'DCR certificate',
  agreement: 'Model Agreement',
  fl: 'Feasibility Letter (FL)',
};

// Optional PDFs: printed at the end of the customer file when uploaded; never needed for "Ready".
export const OPTIONAL_UPLOADS = {
  bill: 'Bill (Tally invoice)',
  insurance: 'Insurance policy',
};
export const ALL_UPLOADS = { ...UPLOAD_TYPES, ...OPTIONAL_UPLOADS };

const isJpeg = (b) => b?.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const isPng = (b) => b?.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
export const isImage = (b) => isJpeg(b) || isPng(b);

/** A photo of a bill or policy as a one-page A4 PDF, the photo fitted inside a 10 mm margin. */
export async function imageToPdf(buffer) {
  const doc = await PDFDocument.create();
  const img = isPng(buffer) ? await doc.embedPng(buffer) : await doc.embedJpg(buffer);
  const landscape = img.width > img.height;
  const [W, H] = landscape ? [841.89, 595.28] : [595.28, 841.89];
  const m = 28.35;
  const scale = Math.min((W - 2 * m) / img.width, (H - 2 * m) / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  doc.addPage([W, H]).drawImage(img, { x: (W - w) / 2, y: (H - h) / 2, width: w, height: h });
  return Buffer.from(await doc.save());
}

// Where each PDF is kept (see storage.js).
export const uploadKey = (customerId, type) => `uploads/${customerId}/${type}.pdf`;
export const pendingKey = (storedName) => `pending/${storedName}`;

export const isPdf = (buffer) => buffer.subarray(0, 1024).includes('%PDF-');

/** Save a customer's PDF. A PDF it replaces is moved to "removed", never deleted. */
export async function saveUpload(customerId, type, buffer) {
  await storage.setAside(uploadKey(customerId, type));
  await storage.put(uploadKey(customerId, type), buffer, fileHash(buffer));
  // The DCR says which modules were really supplied; the panel datasheet follows it.
  if (type === 'dcr') await learnDcrPanels(customerId, buffer).catch((err) => console.error('DCR not read:', err.message));
}

/** Fingerprint of a PDF: two files with the same fingerprint are the same file. */
export const fileHash = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

/** Text of the first pages; empty for scanned PDFs. */
export async function extractText(buffer, maxPages = 3) {
  try {
    const doc = await getDocument({ data: new Uint8Array(buffer), verbosity: 0, useSystemFonts: true }).promise;
    let text = '';
    for (let p = 1; p <= Math.min(maxPages, doc.numPages); p++) {
      const content = await (await doc.getPage(p)).getTextContent();
      text += content.items.map((i) => i.str).join(' ') + '\n';
    }
    await doc.destroy();
    return text;
  } catch {
    return '';
  }
}

/** Text of each of the first `max` pages, and how many pages the PDF has. */
export async function pageTexts(buffer, max = 3) {
  try {
    const doc = await getDocument({ data: new Uint8Array(buffer), verbosity: 0, useSystemFonts: true }).promise;
    const texts = [];
    for (let p = 1; p <= Math.min(max, doc.numPages); p++) {
      const content = await (await doc.getPage(p)).getTextContent();
      texts.push(content.items.map((i) => i.str).join(' '));
    }
    const pages = doc.numPages;
    await doc.destroy();
    return { texts, pages };
  } catch {
    return { texts: [], pages: 0 };
  }
}

/** A new PDF made of the given pages (0-based) of an already loaded one. */
async function cut(src, indexes) {
  // updateMetadata: false keeps today's date out of the file, so cutting the same pages twice gives the very same
  // bytes (and the same fingerprint): scanning the same pendrive again finds everything "already there".
  const out = await PDFDocument.create({ updateMetadata: false });
  for (const p of await out.copyPages(src, indexes)) out.addPage(p);
  return Buffer.from(await out.save());
}

/** Pages `from`..`to` (1-based) of a PDF as a PDF of their own. */
export async function cutPages(buffer, from, to) {
  const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const last = Math.min(to, src.getPageCount());
  return cut(src, Array.from({ length: Math.max(0, last - from + 1) }, (_, i) => from - 1 + i));
}

/**
 * The page of an insurance policy that goes in the customer file: the first of the first six pages that
 * names the insured and the policy number (normally page 1; a cover page in front is skipped).
 * `page` is 0 when the PDF could not be cut and is kept whole.
 */
export async function policyFrontPage(buffer) {
  const { texts, pages } = await pageTexts(buffer, 6);
  if (pages <= 1) return { buffer, page: 1, pages, text: texts[0] || '' };
  let at = texts.findIndex((t) => /insured/i.test(t) && /policy\s*(?:no|number)/i.test(t));
  if (at < 0) at = 0;
  try {
    const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
    return { buffer: await cut(src, [at]), page: at + 1, pages, text: texts[at] || '' };
  } catch {
    return { buffer, page: 0, pages, text: texts.join('\n') };
  }
}

// An invoice page is judged by how it starts: the body of a solar invoice says "Insurance Charges",
// while an insurance policy says "Insurance" in its heading.
const isInvoicePage = (t) => {
  const s = String(t || '').trim();
  const head = s.slice(0, 400);
  // An e-way bill (or its e-invoice print) is not the invoice, even though it mentions one.
  if (/^(?:e[\s-]*way|eway|e[\s-]*invoice)/i.test(s)) return false;
  return /buyer\s*\(\s*bill\s*to\s*\)/i.test(s) || (/\b(?:tax\s*invoice|invoice\s*no)\b/i.test(head) && !/insurance|policy/i.test(head));
};

/** The policy number, e.g. "12B50099": the same policy again is "already there", even if the PDF bytes differ. */
export const policyRef = (text) => ((String(text || '').match(/\bpolicy\s*(?:no\.?|number)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\/\-]{4,24})/i) || [, ''])[1] || '').toUpperCase();

/** The invoice number as Tally prints it, e.g. "26-27/SS/12". Used to see that two PDFs are the same invoice. */
export const invoiceRef = (text) => (String(text || '').match(/\b\d{2}-\d{2}\s*\/\s*[A-Za-z]{1,6}\s*\/\s*\d{1,6}\b/) || [''])[0].replace(/\s+/g, '').toUpperCase();

/** A document in an insurer's folder that is not the policy itself (customer information sheet, wording, terms). */
export const isInfoSheet = (text, fileName = '') =>
  /customer\s+information\s+sheet|policy\s+wording|terms\s+and\s+conditions|prospectus/i.test(String(text || '').slice(0, 400)) ||
  /(?:^|[^a-z])cis(?:[^a-z]|$)|cis$|information[\s_-]*sheet|wording/i.test(String(fileName).split(/[\\/]/).pop().replace(/\.pdf$/i, ''));

/**
 * One PDF holding many invoices (a month of Tally invoices) → one PDF per invoice, and only its FIRST page: the Tax
 * Invoice itself. The pages after it (the e-way bill, a printed copy "Duplicate for Transporter", terms) are left out.
 * Returns null when the PDF holds fewer than `minInvoices` invoices.
 */
export async function splitInvoices(buffer, minInvoices = 2) {
  const { texts, pages } = await pageTexts(buffer, 800);
  const first = [];
  let lastRef = '';
  texts.forEach((t, i) => {
    if (!isInvoicePage(t)) return; // an e-way bill, terms, a blank page
    const ref = invoiceRef(t);
    if (ref && ref === lastRef) return; // another printed copy of the invoice just before
    lastRef = ref;
    first.push(i);
  });
  if (pages < 1 || first.length < minInvoices) return null;
  let src;
  try {
    src = await PDFDocument.load(buffer, { ignoreEncryption: true });
  } catch {
    return null;
  }
  const out = [];
  for (const i of first) out.push({ buffer: await cut(src, [i]), text: texts[i], pages: [i + 1] });
  return out;
}

/** The first page of a bill, whatever follows it (an e-way bill, a copy, terms). Unchanged when it has one page. */
export async function billFirstPage(buffer) {
  const { pages } = await pageTexts(buffer, 0);
  if (pages <= 1) return { buffer, pages: Math.max(pages, 1), cut: false };
  try {
    return { buffer: await cutPages(buffer, 1, 1), pages, cut: true };
  } catch {
    return { buffer, pages, cut: false };
  }
}

/** The folder a file sits in ("D:\\Policies\\Ramesh Patel\\x.pdf" → "Ramesh Patel"): often the customer's name. */
export function folderHint(path) {
  const parts = String(path || '').split(/[\\/]/).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 2] : '';
}

const TYPE_WORDS = {
  fl: [/feasib/],
  dcr: [/\bdcr\b/, /domestic\s+content/],
  agreement: [/agreement/, /annex/],
  // Electricity bill: words a bill has and the portal documents do not.
  bill: [/\btax\s+invoice\b/, /\binvoice\s+no\b/, /\bbuyer\s*\(\s*bill\s*to\s*\)/, /\bgstin\s*\/\s*uin\b/, /\blight\s*bill\b/, /\belectricity\s+bill\b/, /\benergy\s+bill\b/, /\bbill\s+(?:of\s+supply|date|month|amount|no)\b/, /\bunits?\s+consumed\b/, /\b(?:previous|present|current)\s+reading\b/, /\bnet\s+payable\b/, /વીજ\s*બ[ીિ]લ|લાઈટ\s*બ[ીિ]લ/],
  insurance: [/insurance/, /\bpolicy\s*(?:no|number|schedule|period|holder)\b/, /\bsum\s+insured\b/, /\bthe\s+insured\b/, /\bpremium\b/, /વીમ/],
};
// In a file name one word is enough.
const NAME_WORDS = { bill: /\bbill\b|બીલ|બિલ/, insurance: /insurance|\bpolicy\b|વીમ/ };

/** Which document is this? File name first, then the title area, then the whole text. */
export function detectType(fileName, text) {
  const hit = (s, type) => TYPE_WORDS[type].some((re) => re.test(s));
  const name = fileName.toLowerCase().replace(/[_\-.]+/g, ' ');
  const t = text.toLowerCase();
  // "Annexure B: Customer Information Sheet" comes with every policy; it is not an agreement (and not what goes in the file).
  if (/customer\s+information\s+sheet/.test(t.slice(0, 400))) return 'insurance';
  // An insurance policy schedule is itself called a "Tax Invoice": a policy is never a bill.
  // (The invoice itself can say "Insurance Charges"; only a Tally invoice has a "Buyer (Bill to)" block.)
  const tallyInvoice = /buyer\s*\(\s*bill\s*to\s*\)/i.test(t);
  const settle = (found) => (found.includes('insurance') && found.includes('bill') ? found.filter((x) => x !== (tallyInvoice ? 'insurance' : 'bill')) : found);
  const byName = settle(Object.keys(TYPE_WORDS).filter((type) => hit(name, type) || NAME_WORDS[type]?.test(name)));
  if (byName.length === 1) return byName[0];
  const inTitle = settle(Object.keys(TYPE_WORDS).filter((type) => hit(t.slice(0, 600), type)));
  if (inTitle.length === 1) return inTitle[0];
  const counts = Object.keys(TYPE_WORDS)
    .map((type) => [type, TYPE_WORDS[type].reduce((n, re) => n + (t.match(new RegExp(re.source, 'g')) || []).length, 0)])
    .sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 && counts[0][1] > counts[1][1] ? counts[0][0] : null;
}

/**
 * Application reference numbers printed on every portal PDF, e.g. NP-GJMG25-1234567.
 * Unlike the name, the number is never spelled two ways, so it is the safest way to tie
 * a customer's Agreement and DCR to their FL.
 */
export function applicationNumbers(text) {
  const found = toAscii(String(text || '')).toUpperCase().match(/\bNP\s*-\s*[A-Z0-9]{3,8}\s*-\s*\d{5,12}\b/g) || [];
  return [...new Set(found.map((n) => n.replace(/\s+/g, '')))];
}

/**
 * The applicant's name exactly as the portal spells it, read from the FL
 * ("2 Name of Applicant RAJESHBHAI BHIKHABHAI THAKOR 3 Mobile No. …").
 * The Model Agreement carries no application number or mobile number, only this name,
 * so knowing the portal's own spelling is what lets the Agreement be matched.
 */
export function applicantName(text) {
  const m = String(text || '').replace(/\s+/g, ' ').match(/Name of Applicant\s+([A-Za-z][A-Za-z .]{2,80}?)\s+\d*\s*Mobile/i);
  return m ? m[1].replace(/\s+/g, ' ').trim().toUpperCase() : '';
}

/** The person's name as printed on the document, whichever document it is. */
export function documentName(text, type) {
  const t = String(text || '').replace(/\s+/g, ' ');
  const pick = (re) => {
    const m = t.match(re);
    return m ? m[1].replace(/\s+/g, ' ').trim().toUpperCase() : '';
  };
  const title = String.raw`(?:(?:Mr|Mrs|Ms|Shri|Smt)\.?\s+)?`;
  const stop = String.raw`\s*(?=\b(?:Address|Consumer|Customer|Client|Corresponding|Mobile|Contact|Phone|Email|Village|At|Ta|Taluka|District|Pin|Bill|Meter|Tariff|Units?|Net|Due|Amount|Sanctioned|Load|Category|Connection|Account|Service|Reading|Division|Circle|Date|Policy|Period|Insured|Sum|Premium|Plan|Nominee|Age|Gender|CKYC|KYC|GSTIN)\b|\d|,|$)`;
  if (type === 'bill') {
    return (
      pick(new RegExp(String.raw`\b(?:Consumer|Customer)(?:'s)?\s+Name\s*[:\-]?\s*` + title + String.raw`([A-Za-z][A-Za-z .]{3,60}?)` + stop, 'i')) ||
      gujaratiName(t, /(?:ગ્રાહકનું\s*નામ|ગ્રાહકનુ\s*નામ|નામ)\s*[:：\-]?\s*/)
    );
  }
  if (type === 'insurance') {
    return pick(
      new RegExp(
        String.raw`(?<!\bsum\s)(?<!\bthe\s)\b(?:Name\s+of\s+(?:the\s+)?(?:Insured|Proposer|Policy\s*holder)|Insured(?:'s)?\s+Name|Proposer(?:'s)?\s+Name|Policy\s*holder(?:'s)?\s+Name|Insured|Proposer|Policy\s*holder)\s*[:\-]?\s*` +
          title + String.raw`([A-Za-z][A-Za-z .]{3,60}?)` + stop,
        'i'
      )
    );
  }
  return (
    applicantName(t) || // FL table: "Name of Applicant …"
    // Model Agreement: "… Between <NAME> ( CONSUMER NAME)" (the title also says "between"; take the last one)
    pick(/\bBetween\s+((?:(?!\bbetween\b)[A-Za-z .]){4,80}?)\s*\(\s*CONSUMER NAME/i) ||
    // DCR certificate: "To whomsoever it may concern To <Name>, State : …" (take the last "To")
    pick(/\bTo\s+((?:(?!\bTo\s)[A-Za-z .]){4,80}?)\s*,\s*State\b/i) ||
    pick(/Sh\/Smt\.?\s+([A-Za-z][A-Za-z .]{4,80}?)\s+Date\b/i) // FL heading
  );
}

/** A Gujarati name after a label ("ગ્રાહકનું નામ : …"), written in English letters for matching. */
function gujaratiName(t, label) {
  const m = t.match(new RegExp(label.source + String.raw`([\u0A80-\u0AFF]+(?:\s+[\u0A80-\u0AFF]+){1,3})`));
  return m ? englishName(m[1]).toUpperCase() : '';
}

const letters = (s) => String(s || '').toUpperCase().replace(/[^A-Z]+/g, ' ').trim();
const mobilesIn = (s) => new Set(toAscii(s).match(/(?<!\d)[6-9]\d{9}(?!\d)/g) || []);

/** Fields the matching reads from each customer, worked out once. */
export function prepareCustomer(c, shownName, villageEnglish, ownName) {
  c.englishName = shownName;
  c.keys = nameKeys(shownName);
  // the name as it stands in the Excel: what a mobile or application number match is checked against
  if (ownName) c.ownKeys = nameKeys(ownName);
  // the village as it would be written in English, to recognise it in a PDF's address
  c.villageKeys = letters(villageEnglish).split(' ').filter((w) => w.length >= 4).map(soundKey);
  // The taluka, and what the Excel says about the system (kW, panel, inverter): used to tell customers with the same
  // name apart, by what an invoice or a policy says about the installation.
  c.talukaKeys = letters(englishName(c.taluka || '')).split(' ').filter((w) => w.length >= 4).map(soundKey);
  const panel = toAscii(c.panelRaw || '');
  c.watts = [...new Set((panel.match(/(?<![\d.])\d{3}(?![\d.])/g) || []).map(Number).filter((w) => w >= 400 && w <= 750))];
  c.panelBrands = [['અદાણી', 'adani'], ['વારી', 'waaree'], ['ટાટા', 'tata'], ['aps', 'aps']].filter(([gu]) => new RegExp(gu, 'i').test(panel)).map(([, en]) => en);
  const size = toAscii(c.inverterRaw || '').match(/\d+(?:\.\d+)?/);
  c.invSize = size ? Number(size[0]) : null;
  return c;
}

/** Does this PDF carry the mobile number of any customer? (Those are read first: they teach the rest.) */
export const hasCustomerMobile = (fileName, text, customers) => {
  const found = mobilesIn(`${fileName} ${text}`);
  return found.size > 0 && customers.some((c) => (c.mobiles || []).some((m) => found.has(m)));
};

/**
 * Who does this PDF belong to? Every clue in it is read and cross-checked:
 *   1. application number (already known for a customer)
 *   2. mobile number
 *   3. the name printed on the document, matched by sound, in any word order
 *   4. the village in the address, to choose between customers with the same name
 * Returns { matches, how, appNo, docName, certain, note, conflict, weak, suggestions }.
 *   matches      exactly one = found; several = cannot tell them apart; none = not found
 *   certain      safe to learn the application number / portal name from this PDF
 *   conflict     two clues point at different customers: a person must decide
 *   suggestions  closest customers when nothing matched
 */
export function matchCustomer(fileName, text, customers, type) {
  text = toAscii(String(text || ''));
  const hay = `${fileName} ${text}`;
  const numbers = applicationNumbers(hay);
  const appNo = numbers.length === 1 ? numbers[0] : '';
  let docName = documentName(text, type);
  // A scanned bill or policy has no text; the file name often is the customer's name ("12b49960 solanki jayantibhai punambhai_1354.pdf").
  let fromFile = false;
  if (!docName && !text.trim() && OPTIONAL_UPLOADS[type]) {
    const base = String(fileName).split(/[\\/]/).pop().replace(/\.[a-z0-9]+$/i, '').replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase().split(' ').filter((w) => !/\d/.test(w)).join(' '); // "12B49960" is the policy number
    if (base.split(' ').filter((w) => w.length >= 3).length >= 2) {
      docName = base;
      fromFile = true;
    }
  }
  const found = mobilesIn(hay);
  const textKeys = new Set(letters(text).split(' ').filter((w) => w.length >= 4).map(soundKey));
  // Where the customer lives is read only from the part of the file that is about the customer: the buyer's block of an
  // invoice, the insured's address on a policy. The rest of the page is the seller's or the insurer's own address
  // ("Petlad, Anand"), which would make every customer in Petlad look right.
  const flatText = text.replace(/\s+/g, ' ');
  const buyerBlock = type === 'bill' ? (flatText.match(/Buyer\s*\(\s*Bill\s*to\s*\)\s+(.{0,220}?)(?=\s+Place\s+of\s+Supply|\s+Invoice\s+No|$)/i) || [, ''])[1] : '';
  const part = (re, n) => (flatText.match(re) || [''])[0].slice(0, n);
  // Every portal document also carries the company's own address ("Petlad Sojitra Taluka …, Petlad, Anand"), so each type
  // is read only where the customer's address stands: the FL's "Address of Premises for Installation", the Agreement's
  // "having address at"; the DCR has no customer address at all.
  const placeText =
    type === 'bill' ? buyerBlock || text // a layout that is not Tally's: the whole bill
    : type === 'insurance' ? part(/(?<!sum\s)\b(?:Insured|Policy\s+For)\b.{0,400}/i, 420)
    : type === 'fl' ? part(/Address\s+of\s+Premises\s+for\s+Installation.{0,200}/i, 230) || text
    : type === 'agreement' ? part(/having\s+address\s+at.{0,160}/i, 180) || text
    : type === 'dcr' ? ''
    : text;
  // (an insurance policy whose layout has no "Insured" / "Policy For" spot falls back to the whole text too)
  // When a portal document had to be read in full, the company's own place names are left out of it.
  const OWN_PLACES = ['petlad', 'anand', 'sojitra', 'gujarat', 'taluka', 'sayaji', 'station', 'road', 'compound', 'apmc', 'market', 'yard', 'shopping', 'college', 'chokdi', 'sardar', 'anaj'].map(soundKey);
  const readText = placeText || (type === 'insurance' ? text : '');
  const placeKeys = new Set(
    letters(readText)
      .split(' ')
      .filter((w) => w.length >= 4)
      .map(soundKey)
      .filter((k) => !(readText === text && (type === 'fl' || type === 'agreement')) || !OWN_PLACES.includes(k))
  );
  // the village written in English letters, or exactly as the Excel writes it (a Gujarati bill)
  const inVillage = (c) => (c.villageKeys.length > 0 && c.villageKeys.every((k) => placeKeys.has(k))) || (!!c.village && c.village.trim().length >= 2 && placeText.includes(c.village.trim()));
  const same = (a, b) => String(a._id) === String(b._id);

  // ---- Several customers can carry the same name. Everything the file says is weighed, not only the name. ----
  const kwsInText = [...text.matchAll(/(\d+(?:\.\d+)?)\s*kw\b/gi)].map((m) => Number(m[1]));
  const wattsInText = new Set([...text.matchAll(/(?<![\d.])(\d{3})\s*w(?:att|p)?\b/gi)].map((m) => Number(m[1])));
  const invSizesInText = [...text.matchAll(/inverter\s*[-:=]?\s*(\d+(?:\.\d+)?)/gi)].map((m) => Number(m[1]));
  const lowerText = text.toLowerCase();
  const evidence = (c) => ({
    appNo: !!appNo && c.applicationNumber === appNo,
    mobile: (c.mobiles || []).some((m) => found.has(m)),
    village: inVillage(c),
    // kW, panel and inverter describe the installation only on an invoice (an FL's kW is the sanctioned load)
    kw: type === 'bill' && c.kw != null && kwsInText.some((k) => Math.abs(k - c.kw) < 0.06),
    panel: type === 'bill' && (c.watts || []).some((w) => wattsInText.has(w)) && (!(c.panelBrands || []).length || c.panelBrands.some((b) => lowerText.includes(b))),
    taluka: (c.talukaKeys || []).length > 0 && c.talukaKeys.every((k) => placeKeys.has(k)),
    inverter: type === 'bill' && c.invSize != null && invSizesInText.some((s) => Math.abs(s - c.invSize) < 0.06),
  });
  const WEIGHT = { appNo: 6, mobile: 4, village: 3, kw: 3, panel: 2, taluka: 1, inverter: 1 };
  const LABEL = { appNo: 'application number', mobile: 'mobile', village: 'village', kw: 'kW', panel: 'panel', taluka: 'taluka', inverter: 'inverter' };
  const scoreOf = (c) => {
    const e = evidence(c);
    return { c, e, score: Object.entries(WEIGHT).reduce((n, [k, w]) => n + (e[k] ? w : 0), 0) };
  };
  const signals = (e) => {
    const l = Object.keys(WEIGHT).filter((k) => e[k]).map((k) => LABEL[k]);
    return l.length > 1 ? `${l.slice(0, -1).join(', ')} and ${l[l.length - 1]}` : l[0] || '';
  };
  // The best candidate wins only when it clearly leads: at least village / kW level evidence, and 2 points ahead.
  const choose = (cands) => {
    const ranked = cands.map(scoreOf).sort((a, b) => b.score - a.score);
    const [a, b] = ranked;
    return { ranked, winner: a && a.score >= 3 && (!b || a.score - b.score >= 2) ? a.c : null };
  };
  const out = (o) => ({
    appNo,
    docName,
    suggestions: [],
    ...o,
    ...(fromFile && o.matches?.length === 1 && !o.conflict ? { note: [o.note, 'matched by the file name only, because this PDF is a scan'].filter(Boolean).join('; ') } : {}),
  });
  // One mobile number is often used for several people, so a number only counts when the name agrees.
  // Is this customer's name written on the file? (A Tally invoice or a policy does not label the name in a way we can always pick out.)
  const inText = (c) => {
    const ks = c.keys || [];
    return ks.length > 0 && ks.filter((k) => textKeys.has(k.full)).length >= Math.min(2, ks.length);
  };
  const otherPerson = (c) =>
    docName
      ? !namesAgree(docName, c.ownKeys || c.keys) && !namesAgree(docName, c.keys) && !(c.nameAliases || []).includes(plainName(docName))
      : OPTIONAL_UPLOADS[type] && !inText(c);
  const theirName = docName ? `the PDF is in the name of ${docName}` : 'their name is not on the file';

  let byMobile = customers.filter((c) => (c.mobiles || []).some((m) => found.has(m)));
  let byName = { hits: [], quality: null };
  if (docName) byName = matchByName(docName, customers);
  // A Tally invoice names the buyer in one block: "Buyer (Bill to)  NAME  VILLAGE,TALUKA.MO. 9…  A.NO. #NP-…  Place of Supply".
  // The Excel may write the same name in another word order, so the words are compared as a set, and only
  // inside that block (the seller's name is elsewhere on the page).
  if (!docName && type === 'bill') {
    const block = buyerBlock;
    if (block) {
      const bk = nameKeys(block);
      const fits = customers.filter((c) => (c.keys || []).length >= 2 && c.keys.every((k) => bk.some((b) => sameWord(k, b) > 0)));
      // "RAMESH PATEL" fits inside "RAMESH SOMABHAI PATEL": the customer whose name has the most words fitting wins
      const most = Math.max(0, ...fits.map((c) => c.keys.length));
      const best = fits.filter((c) => c.keys.length === most);
      if (best.length) byName = { hits: best, quality: 'same' };
    }
  }
  if (!byName.hits.length) {
    // no name line, or none that matched: look for a customer's whole name anywhere in the text,
    // in English or exactly as the Excel writes it in Gujarati
    const flat = ` ${letters(hay)} `;
    const gu = ` ${hay.replace(/\s+/g, ' ')} `;
    const whole = (s) => String(s || '').trim().replace(/\s+/g, ' ');
    const hits = customers.filter(
      (c) => (c.keys.length >= 2 && flat.includes(` ${letters(c.englishName)} `)) || (whole(c.name).includes(' ') && gu.includes(` ${whole(c.name)} `))
    );
    if (hits.length || !docName) byName = { hits, quality: hits.length ? 'same' : null };
  }

  // The customer's name as the portal spells it can differ from the Excel (BHARWA / BHARVAD): try the name made from the
  // Excel's own Gujarati too. Both are the customer's name, so either may agree.
  if (!byName.hits.length && docName) {
    const alt = matchByName(docName, customers.filter((c) => (c.ownKeys || []).length).map((c) => ({ c, keys: c.ownKeys })));
    if (alt.hits.length) byName = { hits: alt.hits.map((h) => h.c), quality: alt.quality };
  }
  // A policy or invoice often shows fewer words than the Excel (the father's name is left out). That alone is not enough,
  // but with the village on the file agreeing it is the same person; without it, it is only a suggestion.
  if (!byName.hits.length && docName && OPTIONAL_UPLOADS[type]) {
    const want = nameKeys(docName);
    const covers = (keys) => (keys || []).length > want.length && want.every((w) => keys.some((k) => sameWord(w, k) > 0));
    const fits = want.length >= 2 ? customers.filter((c) => covers(c.keys) || covers(c.ownKeys)) : [];
    const ch = choose(fits);
    const ev = ch.winner ? evidence(ch.winner) : {};
    if (ch.winner && (ev.village || ev.kw || ev.mobile)) return out({ how: `name and ${signals(ev)}`, matches: [ch.winner], note: `the file shows only part of the name; ${signals(ev)} agree` });
    if (fits.length) return out({ how: 'name', matches: [], suggestions: fits.slice(0, 5), weak: `The name on the file (${docName}) is part of ${fits[0].englishName}'s name, but the village does not confirm it` });
  }

  // 0a. The Tally invoice number: every DCR prints the invoice it belongs to (PSSU/446), so an invoice
  //     carrying that number is that customer's. Layout-free: any "ABC/123" in the text is looked up.
  if (type === 'bill') {
    const refs = new Set((hay.match(/[A-Za-z][A-Za-z0-9]{1,7}\s*\/\s*\d{1,7}/g) || []).map((x) => x.replace(/\s+/g, '').toUpperCase()));
    const owners = refs.size ? customers.filter((c) => c.invoiceNo && refs.has(c.invoiceNo)) : [];
    if (owners.length === 1) {
      const c = owners[0];
      if (docName && otherPerson(c)) return out({ how: 'invoice number', matches: [c], conflict: `The invoice number is ${c.name}'s (from their DCR), but ${theirName}` });
      return out({ how: 'invoice number', matches: [c] });
    }
  }

  // 0. Electricity consumer number (bills and policies). It is known from the portal list, where it
  //    was saved only for customers whose name agreed; the name on the document is still checked.
  if (OPTIONAL_UPLOADS[type]) {
    const runs = new Set(hay.match(/\d{8,15}/g) || []);
    const owners = runs.size ? customers.filter((c) => c.consumerNo && runs.has(c.consumerNo)) : [];
    if (owners.length === 1) {
      const c = owners[0];
      const mobileOwners = byMobile.filter((m) => !otherPerson(m));
      if (mobileOwners.length && !mobileOwners.some((m) => same(m, c))) {
        return out({ how: 'consumer number', matches: [c, ...mobileOwners], conflict: 'The consumer number and the mobile number in this file belong to different customers' });
      }
      if (otherPerson(c)) return out({ how: 'consumer number', matches: [c], conflict: `The consumer number in this file is ${c.name}'s, but ${theirName}` });
      return out({ how: docName ? 'consumer number and name' : 'consumer number', matches: [c] });
    }
  }

  // 1. application number
  const owners = appNo ? customers.filter((c) => c.applicationNumber === appNo) : [];
  if (owners.length === 1) {
    if (byMobile.length && !byMobile.some((m) => same(m, owners[0]))) {
      return out({ how: 'application number', matches: [owners[0], ...byMobile], conflict: 'The application number and the mobile number in this PDF belong to different customers' });
    }
    if (otherPerson(owners[0])) return out({ how: 'application number', matches: owners, conflict: `The application number in this PDF is ${owners[0].name}'s, but ${theirName}` });
    return out({ how: 'application number', matches: owners, certain: true });
  }
  const otherNumber = (c, how) => (appNo && c.applicationNumber && c.applicationNumber !== appNo ? `The ${how} fits ${c.name}, but that customer has a different application number (${c.applicationNumber})` : '');

  // 2. mobile number (a shared number is settled by the name, then by the village)
  if (byMobile.length > 1 && byName.hits.length) {
    const narrowed = byMobile.filter((c) => byName.hits.some((h) => same(h, c)));
    if (narrowed.length === 1) byMobile = narrowed;
  }
  if (byMobile.length > 1) {
    const ch = choose(byMobile);
    if (ch.winner) byMobile = [ch.winner];
  }
  if (byMobile.length === 1) {
    const c = byMobile[0];
    const conflict = otherNumber(c, 'mobile number');
    if (conflict) return out({ how: 'mobile number', matches: [c], conflict });
    if (otherPerson(c)) return out({ how: 'mobile number', matches: [c], conflict: `The mobile number in this PDF is ${c.name}'s in your Excel, but ${theirName}` });
    // a mobile number with no readable name on the PDF is not enough to learn from
    return out({ how: docName ? 'mobile number and name' : 'mobile number', matches: [c], certain: !!docName });
  }
  if (byMobile.length > 1) return out({ how: 'mobile number', matches: byMobile });

  // 3. name, 4. village
  let hits = byName.hits;
  let how = 'name';
  if (hits.length > 1) {
    const ch = choose(hits);
    if (ch.winner) [hits, how] = [[ch.winner], `name and ${signals(evidence(ch.winner))}`];
  }
  if (hits.length === 1) {
    const c = hits[0];
    const conflict = otherNumber(c, 'name');
    if (conflict) return out({ how, matches: [c], conflict });
    const village = inVillage(c);
    const ev = evidence(c);
    // A name that only differs in its ending (BHAI / KUMAR) is accepted when something else on the file agrees too:
    // the village, the kW, the mobile number or the application number.
    if (byName.quality === 'ending' && !(ev.village || ev.kw || ev.mobile || ev.appNo)) {
      return out({ how, matches: [], suggestions: [c], weak: `The name on the PDF (${docName}) is close to ${c.englishName}, but nothing else on the file (village, kW, mobile) confirms it` });
    }
    const why = signals(ev);
    return out({
      how: why ? `name and ${why}` : how,
      matches: [c],
      certain: village && byName.quality !== 'ending',
      note: byName.quality === 'ending' ? `The name on the PDF is ${docName}` : '',
    });
  }
  if (hits.length > 1) return out({ how: 'name', matches: hits, tied: true });
  const hint = docName || folderHint(fileName);
  return out({ how: '', matches: [], suggestions: hint ? nearNames(hint, customers) : [] });
}
