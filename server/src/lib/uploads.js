import crypto from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs';
import { storage } from './storage.js';
import { learnDcrPanels } from './dcr.js';
import { toAscii } from './gujarati.js';
import { matchByName, nearNames, nameKeys, namesAgree, soundKey } from './names.js';
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
  bill: 'Electricity bill',
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

const TYPE_WORDS = {
  fl: [/feasib/],
  dcr: [/\bdcr\b/, /domestic\s+content/],
  agreement: [/agreement/, /annex/],
  // Electricity bill: words a bill has and the portal documents do not.
  bill: [/\blight\s*bill\b/, /\belectricity\s+bill\b/, /\benergy\s+bill\b/, /\bbill\s+(?:of\s+supply|date|month|amount|no)\b/, /\bunits?\s+consumed\b/, /\b(?:previous|present|current)\s+reading\b/, /\bnet\s+payable\b/, /વીજ\s*બ[ીિ]લ|લાઈટ\s*બ[ીિ]લ/],
  insurance: [/insurance/, /\bpolicy\s*(?:no|number|schedule|period|holder)\b/, /\bsum\s+insured\b/, /\bthe\s+insured\b/, /\bpremium\b/, /વીમ/],
};
// In a file name one word is enough.
const NAME_WORDS = { bill: /\bbill\b|બીલ|બિલ/, insurance: /insurance|\bpolicy\b|વીમ/ };

/** Which document is this? File name first, then the title area, then the whole text. */
export function detectType(fileName, text) {
  const hit = (s, type) => TYPE_WORDS[type].some((re) => re.test(s));
  const name = fileName.toLowerCase().replace(/[_\-.]+/g, ' ');
  const t = text.toLowerCase();
  const byName = Object.keys(TYPE_WORDS).filter((type) => hit(name, type) || NAME_WORDS[type]?.test(name));
  if (byName.length === 1) return byName[0];
  const inTitle = Object.keys(TYPE_WORDS).filter((type) => hit(t.slice(0, 600), type));
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
  const stop = String.raw`\s*(?=\b(?:Address|Consumer|Customer|Mobile|Contact|Phone|Email|Village|At|Ta|Taluka|District|Pin|Bill|Meter|Tariff|Units?|Net|Due|Amount|Sanctioned|Load|Category|Connection|Account|Service|Reading|Division|Circle|Date|Policy|Period|Insured|Sum|Premium|Plan|Nominee|Age|Gender)\b|\d|,|$)`;
  if (type === 'bill') {
    return (
      pick(new RegExp(String.raw`\b(?:Consumer|Customer)(?:'s)?\s+Name\s*[:\-]?\s*` + title + String.raw`([A-Za-z][A-Za-z .]{3,60}?)` + stop, 'i')) ||
      pick(new RegExp(String.raw`\bName\s*[:\-]\s*` + title + String.raw`([A-Za-z][A-Za-z .]{3,60}?)` + stop, 'i')) ||
      gujaratiName(t, /(?:ગ્રાહકનું\s*નામ|ગ્રાહકનુ\s*નામ|નામ)\s*[:：\-]?\s*/)
    );
  }
  if (type === 'insurance') {
    return pick(
      new RegExp(
        String.raw`\b(?:Name\s+of\s+(?:the\s+)?(?:Insured|Proposer|Policy\s*holder)|Insured(?:'s)?\s+Name|Proposer(?:'s)?\s+Name|Policy\s*holder(?:'s)?\s+Name|Insured|Proposer|Policy\s*holder)\s*[:\-]\s*` +
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
  const docName = documentName(text, type);
  const found = mobilesIn(hay);
  const textKeys = new Set(letters(text).split(' ').filter((w) => w.length >= 4).map(soundKey));
  // the village written in English letters, or exactly as the Excel writes it (a Gujarati bill)
  const inVillage = (c) => (c.villageKeys.length > 0 && c.villageKeys.every((k) => textKeys.has(k))) || (!!c.village && c.village.trim().length >= 2 && text.includes(c.village.trim()));
  const same = (a, b) => String(a._id) === String(b._id);
  const out = (o) => ({ appNo, docName, suggestions: [], ...o });
  // One mobile number is often used for several people, so a number only counts when the name agrees.
  const otherPerson = (c) => docName && !namesAgree(docName, c.ownKeys || c.keys) && !namesAgree(docName, c.keys);

  let byMobile = customers.filter((c) => (c.mobiles || []).some((m) => found.has(m)));
  let byName = { hits: [], quality: null };
  if (docName) byName = matchByName(docName, customers);
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
      if (otherPerson(c)) return out({ how: 'consumer number', matches: [c], conflict: `The consumer number in this file is ${c.name}'s, but the file is in the name of ${docName}` });
      return out({ how: docName ? 'consumer number and name' : 'consumer number', matches: [c] });
    }
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
