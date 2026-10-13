// Prints a summary of the Excel file: sheets, headers, and every distinct panel / inverter value.
// Usage: node scripts/inspect-excel.js "<path to xlsx>" "<output txt>"
import fs from 'node:fs';
import ExcelJS from 'exceljs';

const [src, out] = process.argv.slice(2);
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(src);

const text = (v) => {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v.result !== undefined) return String(v.result ?? '');
    if (v.text !== undefined) return String(v.text);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return JSON.stringify(v);
  }
  return String(v);
};

const lines = [];
lines.push('SHEETS: ' + wb.worksheets.map((ws) => `${ws.name} (${ws.rowCount}x${ws.columnCount})`).join(' | '));

for (const ws of wb.worksheets) {
  if (!['residential', 'pashupalak', 'commercial'].includes(ws.name.trim().toLowerCase())) continue;
  lines.push('', `===== ${ws.name} =====`);
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    const vals = [];
    for (let c = 1; c <= ws.columnCount; c++) vals.push(text(row.getCell(c).value).trim());
    rows.push({ n, vals });
  });
  for (const r of rows.slice(0, 5)) lines.push(`row${r.n}: ${JSON.stringify(r.vals)}`);
  const headerRow = rows.find((r) => r.n === 2);
  const headers = headerRow ? headerRow.vals : [];
  const data = rows.filter((r) => r.n >= 3 && r.vals.some((v) => v));
  lines.push(`data rows: ${data.length}`);

  const count = (i) => {
    const m = new Map();
    for (const r of data) {
      const v = r.vals[i] || '<blank>';
      m.set(v, (m.get(v) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };

  headers.forEach((h, i) => {
    if (h === 'પેનલ' || h.includes('ઇન્વ') || h.includes('કિલો') || h.includes('નંગ') || h.includes('તાલુકા')) {
      const c = count(i);
      lines.push(`--- col '${h}' distinct=${c.length}`);
      for (const [v, n] of c) lines.push(`   ${String(n).padStart(5)}  ${v}`);
    }
  });

  const mi = headers.findIndex((h) => h.includes('મોબાઈલ') || h.includes('મોબાઇલ'));
  if (mi >= 0) {
    const mob = data.map((r) => r.vals[mi]);
    const m = new Map();
    for (const v of mob) if (v) m.set(v, (m.get(v) || 0) + 1);
    const dup = [...m.entries()].filter(([, n]) => n > 1);
    lines.push(`--- MOBILE: blank=${mob.filter((v) => !v).length} distinct=${m.size} duplicated=${dup.length}`);
    lines.push('   samples: ' + mob.slice(0, 8).join(', '));
    lines.push('   dup samples: ' + dup.slice(0, 15).map(([v, n]) => `${v}x${n}`).join(', '));
    const odd = [...m.keys()].filter((v) => !/^[0-9૦-૯]{10}$/.test(v));
    lines.push(`   not-10-digit: ${odd.length} e.g. ${odd.slice(0, 15).join(' ; ')}`);
  }
}

fs.writeFileSync(out, lines.join('\n'), 'utf8');
console.log('ok', lines.length);
