import fs from 'node:fs';
import puppeteer from 'puppeteer';
import { PDFDocument, degrees } from 'pdf-lib';

let browserPromise = null;

/** "2-3, 5" → [1, 2, 4]; anything empty or unreadable means every page. */
export function pageIndices(spec, count) {
  const all = Array.from({ length: count }, (_, i) => i);
  if (!spec) return all;
  const out = [];
  for (const piece of String(spec).split(',')) {
    const m = piece.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) return all;
    for (let p = Number(m[1]); p <= Number(m[2] || m[1]); p++) if (p >= 1 && p <= count) out.push(p - 1);
  }
  return out.length ? out : all;
}

function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer
      .launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] })
      .catch((err) => {
        browserPromise = null;
        throw err;
      });
  }
  return browserPromise;
}

export async function closeBrowser() {
  if (!browserPromise) return;
  const b = await browserPromise.catch(() => null);
  browserPromise = null;
  if (b) await b.close();
}

/** Render a full HTML page to an A4 PDF. Fonts and images must be embedded in the HTML. */
export async function htmlToPdf(html, { landscape = false } = {}) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const pdf = await page.pdf({ format: 'A4', landscape, printBackground: true, preferCSSPageSize: true });
    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}

/**
 * Join PDFs (buffers or file paths) into one, in the given order.
 * padOdd: for double-sided printing, add a blank page after any document with an odd
 * number of pages so the next document starts on a fresh sheet.
 */
export async function mergePdfs(parts, { padOdd = false } = {}) {
  const out = await PDFDocument.create();
  const cache = new Map(); // the same datasheet is reused across many customers
  for (const part of parts) {
    // A part is a PDF buffer, a file path, or { file, pages: "2-3" } for some pages of a file.
    const file = typeof part === 'string' ? part : Buffer.isBuffer(part) ? null : part.file;
    let src = file ? cache.get(file) : null;
    if (!src) {
      src = await PDFDocument.load(file ? fs.readFileSync(file) : part, { ignoreEncryption: true });
      if (file) cache.set(file, src);
    }
    const wanted = pageIndices(file && part.pages, src.getPageCount());
    const pages = await out.copyPages(src, wanted);
    for (const p of pages) {
      // A sideways (landscape) page, such as the warranty certificate, is turned so that the whole
      // file is upright A4. It then prints full size on one sheet with any printer setting, instead
      // of being shrunk to fit; in the file it reads with its top at the binding edge.
      const { width, height } = p.getSize();
      const angle = p.getRotation().angle % 360;
      const sideways = (width > height) !== (angle === 90 || angle === 270);
      if (sideways) p.setRotation(degrees((angle + 270) % 360));
      out.addPage(p);
    }
    if (padOdd && pages.length % 2 === 1) {
      out.addPage([595.28, 841.89]); // blank upright A4
    }
  }
  return { buffer: Buffer.from(await out.save()), pages: out.getPageCount() };
}
