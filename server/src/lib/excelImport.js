import ExcelJS from 'exceljs';
import { clean, toAscii, parseMobiles, parseNumber } from './gujarati.js';

const SHEETS = ['residential', 'pashupalak', 'commercial'];
const HEADER_ROW = 2;

// Field → words that identify its header. Columns are matched by name, never by position.
const COLUMNS = {
  srNo: ['અં.નંબર', 'અં. નંબર'],
  name: ['નામ'],
  village: ['ગામ'],
  taluka: ['તાલુકા'],
  mobile: ['મોબાઈલ', 'મોબાઇલ'],
  kw: ['કિલો વોટ', 'કિલો'],
  panelCount: ['પેનલ નંગ'],
  panelRaw: ['પેનલ'],
  inverterRaw: ['ઇન્વટર', 'ઇન્વેટર', 'ઇન્વર્ટર'],
  installer: ['ઇન્સ્ટોલર'],
  note: ['નોંધ'],
};

function cellText(v) {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v.result !== undefined) return cellText(v.result);
    if (v.text !== undefined) return String(v.text);
    if (v.error) return '';
    return '';
  }
  return String(v);
}

// Exact header match first, then "contains"; the first matching column wins
// (the commercial sheet has a second "ઇન્વટર" column that holds an amount).
function mapColumns(headers) {
  const map = {};
  const used = new Set();
  for (const [field, words] of Object.entries(COLUMNS)) {
    let idx = headers.findIndex((h, i) => !used.has(i) && words.includes(h));
    if (idx < 0) idx = headers.findIndex((h, i) => !used.has(i) && words.some((w) => h.includes(w)));
    if (idx >= 0) {
      map[field] = idx;
      used.add(idx);
    }
  }
  return map;
}

/**
 * Read the workbook into plain customer records.
 * Returns { customers, skipped, sheets } – nothing is written to the database here.
 */
export async function parseWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const customers = [];
  const skipped = [];
  const sheets = [];
  const keyCount = new Map();

  for (const ws of wb.worksheets) {
    const sheet = ws.name.trim();
    if (!SHEETS.includes(sheet.toLowerCase())) continue;

    const width = ws.columnCount;
    const read = (row) => {
      const out = [];
      for (let c = 1; c <= width; c++) out.push(clean(cellText(row.getCell(c).value)));
      return out;
    };
    const headers = read(ws.getRow(HEADER_ROW));
    const col = mapColumns(headers);
    const missing = ['name', 'mobile', 'panelRaw', 'inverterRaw'].filter((f) => col[f] == null);
    if (missing.length) {
      skipped.push({ sheet, row: HEADER_ROW, reason: `Header not found: ${missing.join(', ')} – sheet skipped` });
      continue;
    }
    const mapped = new Set(Object.values(col));
    let count = 0;

    ws.eachRow({ includeEmpty: false }, (row, n) => {
      if (n <= HEADER_ROW) return;
      const v = read(row);
      if (!v.some(Boolean)) return;
      const get = (f) => (col[f] != null ? v[col[f]] : '');

      const name = get('name');
      if (!name || name === 'કુલ' || get('taluka') === 'કુલ') return; // blank or totals row

      const mobiles = parseMobiles(get('mobile'));
      const issues = [];
      if (!mobiles.length) {
        issues.push(get('mobile') ? `Mobile number is not 10 digits: ${toAscii(get('mobile'))}` : 'Mobile number is blank');
      }
      const kw = parseNumber(get('kw'));
      if (kw == null) issues.push('kW is blank');
      if (!get('panelRaw')) issues.push('Panel is blank');
      if (!get('inverterRaw')) issues.push('Inverter is blank');

      const extra = {};
      headers.forEach((h, i) => {
        if (h && !mapped.has(i) && v[i]) extra[h] = v[i];
      });

      // A person can appear twice with the same mobile (two systems); number the repeats.
      const base = `${sheet}|${mobiles[0] || 'no-mobile'}|${name}`;
      const seen = (keyCount.get(base) || 0) + 1;
      keyCount.set(base, seen);

      customers.push({
        key: seen === 1 ? base : `${base}#${seen}`,
        sheet,
        srNo: toAscii(get('srNo')),
        excelRow: n,
        name,
        village: get('village'),
        taluka: get('taluka'),
        mobile: mobiles[0] || '',
        mobiles,
        kw,
        panelCount: parseNumber(get('panelCount')),
        panelRaw: get('panelRaw'),
        inverterRaw: get('inverterRaw'),
        installer: get('installer'),
        note: get('note'),
        extra,
        issues,
      });
      count++;
    });
    sheets.push({ sheet, rows: count });
  }

  return { customers, skipped, sheets };
}
