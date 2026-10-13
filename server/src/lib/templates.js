import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { config } from '../config.js';
import { toGujarati } from './gujarati.js';

const require = createRequire(import.meta.url);

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

// Gujarati font is bundled so the PDFs look the same on any PC or server.
let fontCss = null;
function gujaratiFontCss() {
  if (fontCss) return fontCss;
  const dir = path.dirname(require.resolve('@fontsource/noto-sans-gujarati/package.json'));
  const face = (weight) => {
    const b64 = fs.readFileSync(path.join(dir, 'files', `noto-sans-gujarati-gujarati-${weight}-normal.woff2`)).toString('base64');
    return `@font-face{font-family:"Noto Sans Gujarati";font-weight:${weight};src:url(data:font/woff2;base64,${b64}) format("woff2");}`;
  };
  fontCss = face(400) + face(700);
  return fontCss;
}

// Windows fonts (Calibri, Arial, Arial Black, Arial Narrow) do not exist on a hosting server.
// These free fonts have the same shapes and widths and are only used when the Windows one is missing.
const STAND_INS = [
  ['Carlito', 'carlito', [400, 700]], // for Calibri
  ['Arimo', 'arimo', [400, 700]], // for Arial
  ['Archivo Black', 'archivo-black', [400]], // for Arial Black
  ['Archivo Narrow', 'archivo-narrow', [400, 700]], // for Arial Narrow
];
let standInCss = null;
function standInFontsCss() {
  if (standInCss) return standInCss;
  standInCss = STAND_INS.map(([family, pkg, weights]) => {
    const dir = path.dirname(require.resolve(`@fontsource/${pkg}/package.json`));
    return weights
      .map((w) => {
        const b64 = fs.readFileSync(path.join(dir, 'files', `${pkg}-latin-${w}-normal.woff2`)).toString('base64');
        return `@font-face{font-family:"${family}";font-weight:${w};src:url(data:font/woff2;base64,${b64}) format("woff2");}`;
      })
      .join('');
  }).join('');
  return standInCss;
}

// Optional images in server/assets (png/jpg). When a file is missing the text version is used.
function asset(name) {
  for (const ext of ['png', 'jpg', 'jpeg']) {
    const p = path.join(config.assetsDir, `${name}.${ext}`);
    if (fs.existsSync(p)) {
      const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
      return `data:${mime};base64,${fs.readFileSync(p).toString('base64')}`;
    }
  }
  return null;
}

// Wording and measurements below are taken from the office's Word file (payeee.docx).
const ENCLOSED = [
  '૧.સોલાર સીસ્ટમ બીલ/પાવતી',
  '૨.પેનલ વોરંટી કાર્ડ',
  '૩.ઈન્વેટર વોરંટી કાર્ડ',
  '૪. FEASIBILITY LETTER',
  '5. DCR CERTIFICATE',
  '6. INSURANCE POLICY',
];

function letterhead() {
  const img = asset('letterhead');
  if (img) return `<img class="lh-img" src="${img}">`;
  return `
  <div class="lh-text">
    <div class="lh-title">Petlad Sojitra Taluka Sauraurja<br>Utpadak Sahkari Mandali Limited</div>
    <div class="lh-line">Sayaji Day Workers Compound, Station Road, Petlad, Di. Anand - 388450</div>
    <div class="lh-line">Electrical Contractors License No. : G/AND/C - 7743</div>
    <div class="lh-line">Email : pssumandali@gmail.com &nbsp;&nbsp;&nbsp;&nbsp; Contact No : +91 81409 68999</div>
    <div class="lh-line">GSTIN : 24AAGAP8392R1ZL</div>
  </div>`;
}

/** Detail Payee Certificate (cover page, Gujarati, A4 portrait). */
export function payeeHtml(c) {
  const address = [c.village, c.taluka].filter(Boolean).join(', ');
  const rows = [
    ['નામ', c.name],
    ['સરનામું', address, 'tall'],
    ['મોબાઈલ નંબર', toGujarati(c.mobile)],
    ['સીસ્ટમ સાઈઝ', toGujarati(c.kw ?? '')],
    ['પેનલ કંપની', c.panelRaw],
    ['ઈન્વેટર કંપની', c.inverterRaw],
  ];
  // New letterpad (NEW LETTERPAD.docx): one full-page background image; the text starts
  // 3500 twips (61.7 mm) from the top with 1152 twips (20.3 mm) at each side.
  const pad = asset('letterpad');
  const page = pad
    ? `@page{size:A4;margin:0;}
html,body{width:210mm;height:297mm;}
body{position:relative;overflow:hidden;}
.bg{position:absolute;left:0;top:0;width:210mm;height:297mm;}
.sheet{position:absolute;left:20.3mm;right:20.3mm;top:62mm;}
.sheet table{width:100%;margin-top:0;}`
    : // Old letterhead (payeee.docx): A4, 1 inch margins, header 708 twips from the top.
      '@page{size:A4;margin:12.5mm 25.4mm 25.4mm 25.4mm;}';
  return `<!doctype html><html lang="gu"><head><meta charset="utf-8"><style>
${gujaratiFontCss()}
${standInFontsCss()}
*{box-sizing:border-box;}
body{margin:0;font-family:"Arial Narrow","Archivo Narrow","Shruti","Nirmala UI","Noto Sans Gujarati",Arial,Arimo,sans-serif;font-size:12pt;line-height:1.158;color:#000;}
.lh-img{display:block;width:159.2mm;height:41mm;}
.lh-text{text-align:center;font-family:Arial,sans-serif;height:41mm;border-bottom:1.2pt solid #c8650a;}
.lh-title{font-size:19pt;font-weight:900;color:#e36c0a;line-height:1.15;}
.lh-line{font-size:8.5pt;font-weight:700;color:#e36c0a;line-height:1.35;}
table{width:159mm;border-collapse:collapse;margin-top:10.5mm;line-height:1.4;}
td{border:0.5pt solid #000;padding:0 1.9mm;vertical-align:top;}
td.k{width:34.9mm;white-space:nowrap;}
td.v{font-size:11pt;}
tr.tall td{height:2.6em;}
p{margin:0 0 8pt;min-height:1.158em;}
table + p{margin-top:8pt;}
${page}
</style></head><body>
${pad ? `<img class="bg" src="${pad}"><div class="sheet">` : letterhead()}
<table>${rows.map(([k, v, cls]) => `<tr class="${cls || ''}"><td class="k">${esc(k)}</td><td class="v">${esc(v)}</td></tr>`).join('')}</table>
<p></p>
<p>નીચે જણાવેલ તમામ ડોક્યુંમેન્ટ ફાઈલમાં સામેલ કરેલ છે.</p>
<p></p><p></p>
${ENCLOSED.map((t) => `<p>${esc(t)}</p>`).join('')}
${pad ? '</div>' : ''}
</body></html>`;
}

/**
 * SOLARYAAN inverter warranty certificate (English, A4 landscape).
 * Positions, fonts and wording are taken from the office's Word file (WARRANTY CARD SOLARYAN.docx):
 * margins 19.4 / 19.75 / 4.9 / 26.1 mm, 3 pt page border 24 pt from the edge, 16 pt Calibri body.
 */
export function warrantyHtml(c, model) {
  const logo = asset('solaryaan-logo');
  const badge = asset('warranty-badge');
  const stamp = asset('howd-stamp');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
${standInFontsCss()}
@page{size:A4 landscape;margin:0;}
*{box-sizing:border-box;}
html,body{margin:0;width:297mm;height:210mm;}
body{position:relative;overflow:hidden;font-family:Calibri,Carlito,Arial,Arimo,sans-serif;font-size:16pt;color:#000;}
.frame{position:absolute;inset:24pt;border:3pt solid #000;}
.logo{position:absolute;left:203mm;top:17.8mm;width:72.2mm;height:26.5mm;}
.badge{position:absolute;left:147mm;top:26mm;width:54.8mm;height:39.8mm;}
.sheet{position:absolute;left:26.1mm;top:19.4mm;width:251.15mm;}
p{margin:0;}
.w1{margin-top:5pt;padding-left:2.6mm;font-family:"Arial Black","Archivo Black",Arial,sans-serif;font-weight:900;font-size:48pt;line-height:59.45pt;}
.w2{padding-left:1.8mm;font-family:Arial,Arimo,sans-serif;font-size:72pt;line-height:74.55pt;}
.body{margin-top:2.25pt;padding:0 12mm 0 2.7mm;text-indent:1.27mm;line-height:22.5pt;}
.gap{height:22.5pt;}
.f{position:relative;font-weight:700;line-height:19.5pt;white-space:nowrap;}
.f.tall{line-height:22.6pt;}
.f .v{position:absolute;left:50.8mm;top:0;}
.f .v2{display:block;padding-left:63.5mm;}
.close{padding:0 10.4mm 0 2.7mm;line-height:22.5pt;}
.stamp{display:block;margin-left:203.2mm;width:32.45mm;height:28.1mm;transform:rotate(180deg);}
</style></head><body>
<div class="frame"></div>
${logo ? `<img class="logo" src="${logo}">` : ''}
${badge ? `<img class="badge" src="${badge}">` : ''}
<div class="sheet">
<p class="w1">WARRANTY</p>
<p class="w2">Certificate</p>
<p class="body">This certificate extends the warranty to all the models of <b>2.5kw to 125kw</b> providing <b>10-year</b> Warranty as per the company (<b>HowD Innovations Pvt. Ltd</b>. i.e. under the brand name <b>SOLARYAAN</b>) terms and conditions. The purchase date is to be considered the Warranty Date.</p>
<div class="gap" style="margin-top:2.25pt"></div>
<div class="f tall" style="padding-left:4mm">EPC NAME<span class="v">: PETLAD SOJITRA TALUKA SAURURJA UTPADAK</span><span class="v2">SAHKARI MANDALI LTD.</span></div>
<div class="f" style="padding-left:2.8mm">CUSTOMER NAME<span class="v">: ${esc(String(c.englishName || '').toUpperCase())}</span></div>
<div class="f" style="padding-left:2.8mm">MODEL No.<span class="v">:&nbsp; ${esc(model)}</span></div>
<div class="f tall" style="padding-left:2.7mm;line-height:22.5pt">SERIAL NO.<span class="v">: ${esc(c.inverterSerial)}</span></div>
<div class="gap"></div>
<p class="close">We hereby guarantee the warranty of all products owned. From the time the product is in possession of the owner, HowD Innovations Pvt Ltd. will repair and replace defective components at its discretion, i.e., without any additional amount charged to the product owner.</p>
${stamp ? `<img class="stamp" src="${stamp}">` : ''}
</div>
</body></html>`;
}
