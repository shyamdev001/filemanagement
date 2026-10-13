import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs';
import { storage } from './storage.js';
import { toAscii } from './gujarati.js';

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
  await storage.put(uploadKey(customerId, type), buffer);
}

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

/**
 * Who does this PDF belong to? Tries, in order: a known application number, a mobile number,
 * the English name. `conflict` is set when two of these point at different customers; such a
 * PDF must go to a person, never be filed automatically.
 * `certain` is true when the match is safe to learn the application number from.
 */
export function matchCustomer(fileName, text, customers) {
  const numbers = applicationNumbers(`${fileName} ${text}`);
  const appNo = numbers.length === 1 ? numbers[0] : '';
  const base = findCustomers(fileName, text, customers);
  const byMobile = base.how === 'mobile number' && base.matches.length > 0;
  const same = (a, b) => String(a._id) === String(b._id);

  if (appNo) {
    const owners = customers.filter((c) => c.applicationNumber === appNo);
    if (owners.length === 1) {
      if (byMobile && !base.matches.some((m) => same(m, owners[0]))) {
        return { how: 'application number', matches: [owners[0], ...base.matches], appNo, conflict: 'The application number and the mobile number in this PDF belong to different customers' };
      }
      return { how: 'application number', matches: owners, appNo, certain: true };
    }
    const only = base.matches.length === 1 ? base.matches[0] : null;
    if (only?.applicationNumber && only.applicationNumber !== appNo) {
      return { ...base, appNo, conflict: `The ${base.how} fits ${only.name}, but that customer has a different application number (${only.applicationNumber})` };
    }
  }
  return { ...base, appNo, certain: byMobile && base.matches.length === 1 };
}

const letters = (s) => String(s || '').toUpperCase().replace(/[^A-Z]+/g, ' ').trim();

/**
 * Customers this PDF could belong to: by a mobile number in the file name or text,
 * otherwise by the English name typed in the app. Names in Gujarati are never used.
 */
export function findCustomers(fileName, text, customers) {
  const hay = toAscii(`${fileName} ${text}`);
  const mobiles = new Set(hay.match(/(?<!\d)[6-9]\d{9}(?!\d)/g) || []);
  const byMobile = customers.filter((c) => (c.mobiles || []).some((m) => mobiles.has(m)));
  if (byMobile.length) return { how: 'mobile number', matches: byMobile };

  const flat = ` ${letters(hay)} `;
  const byName = customers.filter((c) => {
    const name = letters(c.englishName);
    return name.split(' ').length >= 2 && flat.includes(` ${name} `);
  });
  return { how: 'English name', matches: byName };
}
