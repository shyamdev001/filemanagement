import { Customer } from '../models.js';
import { storage } from './storage.js';
import { extractText, uploadKey } from './uploads.js';

/** Bump when the reader changes, so stored DCRs are read again. */
const VERSION = 4;

/** Upper case without spaces, so "BI - 55 - 540" and "BI-55-540" compare equal. */
export const squash = (s) => String(s || '').toUpperCase().replace(/\s+/g, '');

/** Brand from the model code first (an OEM can make another brand's module), then the maker. */
function brandOf(code, maker) {
  const c = squash(code);
  const m = squash(maker);
  if (/^AB-G12R|^ASB/.test(c)) return 'adani';
  if (/^BIN?-\d/.test(c)) return 'waaree';
  if (/^APS/.test(c)) return 'aps';
  if (/^TP\d|LG10/.test(c)) return 'tata';
  if (/MUNDRA|ADANI/.test(m)) return 'adani';
  if (/WAAREE/.test(m)) return 'waaree';
  if (/AUSTRALIANPREMIUM/.test(m)) return 'aps';
  if (/TPSOLAR|TATA/.test(m)) return 'tata';
  return '';
}

/**
 * The modules a DCR certificate lists: maker, model code, watt and quantity of each item.
 * `read: false` when the PDF has no text (a scan) or the item table could not be found.
 */
export function readDcrPanels(text) {
  const t = String(text || '').replace(/\s+/g, ' ');
  const maker = (t.match(/Solar Module Manufactured By\s*:\s*(.+?)\s+Address/i) || [])[1] || '';
  const start = t.search(/Item Description\s+Quantity\s+KW/i);
  const table = start >= 0 ? t.slice(start).replace(/^Item Description\s+Quantity\s+KW/i, '') : '';
  const items = [];
  const re = /(\S.{0,60}?)\s*\(\s*Wp\s*:\s*(\d{3})[^)]*\)\s*(.+?)\s+(\d{1,4})\s+(\d+\.\d+)/g;
  const seen = new Set();
  for (const m of table.matchAll(re)) {
    const [, rawCode, watt, desc, qty, kw] = m;
    // Page 2 repeats every item in a "Solar Cells to Solar Panels Conversion - <maker> <code>" table.
    const code = rawCode.replace(/^.*\b(Limited|Ltd\.?|Quantity\s+KW)\s+/i, '');
    const key = `${squash(code)}|${watt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const all = `${code} ${desc}`;
    items.push({
      code: code.trim(),
      desc: desc.trim(),
      watt: Number(watt),
      qty: Number(qty),
      kw: Number(kw),
      brand: brandOf(code, maker),
      topcon: /TOPCON|N-TYPE|^BIN-|^ASBT|G12R/.test(squash(all)) || /^BIN-|^ASBT/.test(squash(code)),
    });
  }
  return { read: items.length > 0, maker: maker.trim(), items };
}

/** Read a customer's stored DCR and remember what modules it lists. */
export async function learnDcrPanels(customerId, buffer) {
  const pdf = buffer || (await storage.get(uploadKey(customerId, 'dcr')));
  if (!pdf) return null;
  const dcrPanels = { ...readDcrPanels(await extractText(pdf, 4)), v: VERSION, at: new Date() };
  await Customer.updateOne({ _id: customerId }, { $set: { dcrPanels } });
  return dcrPanels;
}

/** DCRs filed before the app could read them: read them once, in the background. */
export async function backfillDcrPanels() {
  const todo = await Customer.find({ 'uploads.dcr': { $exists: true }, $or: [{ dcrPanels: null }, { 'dcrPanels.v': { $ne: VERSION } }] }, { _id: 1 }).lean();
  for (const c of todo) {
    try {
      await learnDcrPanels(c._id);
    } catch (err) {
      console.error('Could not read DCR of', String(c._id), err.message);
    }
  }
  if (todo.length) console.log(`Read the panel details of ${todo.length} DCR certificates.`);
}
