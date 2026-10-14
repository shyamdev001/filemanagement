import crypto from 'node:crypto';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs';
import { storage } from './storage.js';
import { learnDcrPanels } from './dcr.js';
import { toAscii } from './gujarati.js';
import { matchByName, nearNames, nameKeys, namesAgree, soundKey } from './names.js';

// Load the PDF reader's worker at startup. Left alone, pdf.js imports it the first time a PDF is
// read, and under `node --watch` (npm run dev) that late import restarts the server mid-upload.
globalThis.pdfjsWorker = pdfjsWorker;

// Documents that come from the PM Surya Ghar portal, in print order.
export const UPLOAD_TYPES = {
  dcr: 'DCR certificate',
  agreement: 'Model Agreement',
  fl: 'Feasibility Letter (FL)',
};

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

const TYPE_WORDS = {
  fl: [/feasib/],
  dcr: [/\bdcr\b/, /domestic\s+content/],
  agreement: [/agreement/, /annex/],
};

/** Which document is this? File name first, then the title area, then the whole text. */
export function detectType(fileName, text) {
  const hit = (s, type) => TYPE_WORDS[type].some((re) => re.test(s));
  const name = fileName.toLowerCase().replace(/[_\-.]+/g, ' ');
  const t = text.toLowerCase();
  for (const part of [name, t.slice(0, 600)]) {
    const found = Object.keys(TYPE_WORDS).filter((type) => hit(part, type));
    if (found.length === 1) return found[0];
  }
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

/** The person's name as printed on the document, whichever of the three documents it is. */
export function documentName(text) {
  const t = String(text || '').replace(/\s+/g, ' ');
  const pick = (re) => {
    const m = t.match(re);
    return m ? m[1].replace(/\s+/g, ' ').trim().toUpperCase() : '';
  };
  return (
    applicantName(t) || // FL table: "Name of Applicant …"
    // Model Agreement: "… Between <NAME> ( CONSUMER NAME)" (the title also says "between"; take the last one)
    pick(/\bBetween\s+((?:(?!\bbetween\b)[A-Za-z .]){4,80}?)\s*\(\s*CONSUMER NAME/i) ||
    // DCR certificate: "To whomsoever it may concern To <Name>, State : …" (take the last "To")
    pick(/\bTo\s+((?:(?!\bTo\s)[A-Za-z .]){4,80}?)\s*,\s*State\b/i) ||
    pick(/Sh\/Smt\.?\s+([A-Za-z][A-Za-z .]{4,80}?)\s+Date\b/i) // FL heading
  );
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
export function matchCustomer(fileName, text, customers) {
  const hay = `${fileName} ${text}`;
  const numbers = applicationNumbers(hay);
  const appNo = numbers.length === 1 ? numbers[0] : '';
  const docName = documentName(text);
  const found = mobilesIn(hay);
  const textKeys = new Set(letters(text).split(' ').filter((w) => w.length >= 4).map(soundKey));
  const inVillage = (c) => c.villageKeys.length > 0 && c.villageKeys.every((k) => textKeys.has(k));
  const same = (a, b) => String(a._id) === String(b._id);
  const out = (o) => ({ appNo, docName, suggestions: [], ...o });
  // One mobile number is often used for several people, so a number only counts when the name agrees.
  const otherPerson = (c) => docName && !namesAgree(docName, c.ownKeys || c.keys) && !namesAgree(docName, c.keys);

  let byMobile = customers.filter((c) => (c.mobiles || []).some((m) => found.has(m)));
  let byName = { hits: [], quality: null };
  if (docName) byName = matchByName(docName, customers);
  else {
    // no recognisable name line: look for a customer's whole name anywhere in the text
    const flat = ` ${letters(hay)} `;
    const hits = customers.filter((c) => c.keys.length >= 2 && flat.includes(` ${letters(c.englishName)} `));
    byName = { hits, quality: hits.length ? 'same' : null };
  }

  // 1. application number
  const owners = appNo ? customers.filter((c) => c.applicationNumber === appNo) : [];
  if (owners.length === 1) {
    if (byMobile.length && !byMobile.some((m) => same(m, owners[0]))) {
      return out({ how: 'application number', matches: [owners[0], ...byMobile], conflict: 'The application number and the mobile number in this PDF belong to different customers' });
    }
    if (otherPerson(owners[0])) return out({ how: 'application number', matches: owners, conflict: `The application number in this PDF is ${owners[0].name}'s, but the PDF is in the name of ${docName}` });
    return out({ how: 'application number', matches: owners, certain: true });
  }
  const otherNumber = (c, how) => (appNo && c.applicationNumber && c.applicationNumber !== appNo ? `The ${how} fits ${c.name}, but that customer has a different application number (${c.applicationNumber})` : '');

  // 2. mobile number (a shared number is settled by the name, then by the village)
  if (byMobile.length > 1 && byName.hits.length) {
    const narrowed = byMobile.filter((c) => byName.hits.some((h) => same(h, c)));
    if (narrowed.length === 1) byMobile = narrowed;
  }
  if (byMobile.length > 1) {
    const narrowed = byMobile.filter(inVillage);
    if (narrowed.length === 1) byMobile = narrowed;
  }
  if (byMobile.length === 1) {
    const c = byMobile[0];
    const conflict = otherNumber(c, 'mobile number');
    if (conflict) return out({ how: 'mobile number', matches: [c], conflict });
    if (otherPerson(c)) return out({ how: 'mobile number', matches: [c], conflict: `The mobile number in this PDF is ${c.name}'s in your Excel, but the PDF is in the name of ${docName}` });
    // a mobile number with no readable name on the PDF is not enough to learn from
    return out({ how: docName ? 'mobile number and name' : 'mobile number', matches: [c], certain: !!docName });
  }
  if (byMobile.length > 1) return out({ how: 'mobile number', matches: byMobile });

  // 3. name, 4. village
  let hits = byName.hits;
  let how = 'name';
  if (hits.length > 1) {
    const narrowed = hits.filter(inVillage);
    if (narrowed.length === 1) [hits, how] = [narrowed, 'name and village'];
  }
  if (hits.length === 1) {
    const c = hits[0];
    const conflict = otherNumber(c, 'name');
    if (conflict) return out({ how, matches: [c], conflict });
    const village = inVillage(c);
    // A name that only differs in its ending (BHAI / KUMAR) is accepted when the village agrees too.
    if (byName.quality === 'ending' && !village) {
      return out({ how, matches: [], suggestions: [c], weak: `The name on the PDF (${docName}) is close to ${c.englishName}, but not the same` });
    }
    return out({
      how: village ? 'name and village' : how,
      matches: [c],
      certain: village && byName.quality !== 'ending',
      note: byName.quality === 'ending' ? `The name on the PDF is ${docName}` : '',
    });
  }
  if (hits.length > 1) return out({ how: 'name', matches: hits });
  return out({ how: '', matches: [], suggestions: docName ? nearNames(docName, customers) : [] });
}
