import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { detectType, documentName, matchCustomer, prepareCustomer, splitInvoices, billFirstPage, policyFrontPage, pageTexts, invoiceRef, isInfoSheet } from '../src/lib/uploads.js';

// Made-up customers and numbers.
const make = (id, name, english, village, villageEn, mobile, extra = {}) =>
  prepareCustomer({ _id: id, name, village, mobiles: mobile ? [mobile] : [], ...extra }, english, villageEn, english);
const customers = () => [
  make('a', 'ઝાલા જશવંતસિંહ મણિલાલ', 'ZALA JASHVANTSINH MANILAL', 'છીપડી', 'CHHIPDI', '9000000001'),
  make('b', 'ગોપાલભાઈ કરશનભાઈ રબારી', 'GOPALBHAI KARSHANBHAI RABARI', 'પીપળાવ', 'PIPLAV', '9000000002', { applicationNumber: 'NP-GJMG26-10000002' }),
  make('c', 'વિજયસિંહ દીપસંગજી ગોહેલ', 'VIJAYSINH DIPSANGJI GOHEL', 'વરસડા', 'VARSADA', '9000000003'),
  make('d', 'વિજયસિંહ બળવંતસિંહ ગોહેલ', 'VIJAYSINH BALVANTSINH GOHEL', 'ખંભાત', 'KHAMBHAT', '9000000004'),
  make('e', 'રમેશભાઈ સોમાભાઈ પટેલ', 'RAMESHBHAI SOMABHAI PATEL', 'ધર્મજ', 'DHARMAJ', '9000000005', { dcrPanels: { invoice: { no: 'PSSU/446' } } }),
].map((c) => ({ ...c, invoiceNo: c.dcrPanels?.invoice?.no || '' }));

const invoice = (buyer, no = '26-27/SS/12') =>
  `Tax Invoice Petlad Sojitra Taluka Sauraurja Utpadak Sahkari Mandli Limited FY 26.27 1219/34, Moraji Shopping Center, Petlad GSTIN/UIN: 24AAGAP8392R1ZL State Name : Gujarat, Code : 24 ` +
  `Consignee (Ship to) ${buyer} Buyer (Bill to) ${buyer} Place of Supply : Gujarat Invoice No. e-Way Bill No. ${no} 602111228533 Dated 1-Apr-26 ` +
  `Solar System 1,21,969.70 Insurance Charges 1,250.00 Total ₹ 1,91,000.00 Remarks: BILL.NO.${no}.`;
const policy = (insured, village) =>
  `IFFCO-TOKIO GENERAL INSURANCE CO. LTD Regd. Office: IFFCO Sadan, New Delhi IFFCO TOKIO Flexi Home Protector Policy - Schedule Cum Tax Invoice UIN: IRDAN106RP0026V01202324 ` +
  `Insured ${insured} Client Number CX020762 Corresponding Address 1241, RABARI VAS, ${village}, ANAND, 388460, Gujarat, INDIA Policy Number 12B50099 Policy Issuance Date 24/09/2026 ` +
  `Location Description SOLAR SYSTEM BUILDING SUM INSURED Page 1 of 17`;

test('an invoice is a bill, a policy schedule (also called "Tax Invoice") is a policy', () => {
  assert.equal(detectType('APRIL 26.pdf', invoice('Atulbhai Manubhai Bhatt Anand.Mo.9429013323')), 'bill');
  assert.equal(detectType('FHM-12B50099PolicyScheduleDigitalSign.pdf', policy('RABARI GOPALBHAI KARSHANBHAI', 'PIPLAV')), 'insurance');
  assert.equal(detectType('scan.pdf', 'Annexure B CUSTOMER INFORMATION SHEET This document provides only key information about your policy Insured Name: RABARI'), 'insurance');
});

test('the customer information sheet is not the policy', () => {
  assert.equal(isInfoSheet('Annexure B CUSTOMER INFORMATION SHEET This document provides only key information'), true);
  assert.equal(isInfoSheet('x', '12B50099_FHM-PolicyCIS.pdf'), true);
  assert.equal(isInfoSheet(policy('RABARI GOPALBHAI KARSHANBHAI', 'PIPLAV'), 'FHM-12B50099PolicyScheduleDigitalSign.pdf'), false);
});

test('the insured on a policy schedule (label without a colon)', () => {
  assert.equal(documentName(policy('RABARI GOPALBHAI KARSHANBHAI', 'PIPLAV'), 'insurance'), 'RABARI GOPALBHAI KARSHANBHAI');
});

test('a policy is matched by name (any order) and village', () => {
  const m = matchCustomer('Ari Gopalbhai\\FHM-12B50099Schedule.pdf', policy('RABARI GOPALBHAI KARSHANBHAI', 'PIPLAV'), customers(), 'insurance');
  assert.deepEqual(m.matches.map((c) => c._id), ['b']);
});

test('a policy that leaves out the father\'s name: filed with the village, only suggested without it', () => {
  const sure = matchCustomer('p.pdf', policy('GOHEL VIJAYSINH', 'VARSADA'), customers(), 'insurance');
  assert.deepEqual(sure.matches.map((c) => c._id), ['c']);
  const unsure = matchCustomer('p.pdf', policy('GOHEL VIJAYSINH', 'SOMEWHERE'), customers(), 'insurance');
  assert.equal(unsure.matches.length, 0);
  assert.ok(unsure.weak && unsure.suggestions.length === 2);
});

test('an invoice: the buyer is matched in any word order, inside the buyer block only', () => {
  const m = matchCustomer('MAY 26.pdf', invoice('JASHVANTSINH MANILAL ZALA Chhipdi , Kathlal'), customers(), 'bill');
  assert.deepEqual(m.matches.map((c) => c._id), ['a']);
});

test('an invoice: the mobile number needs the name too', () => {
  const ok = matchCustomer('x.pdf', invoice('Ramesh Somabhai Patel Dharmaj.Mo.9000000005'), customers(), 'bill');
  assert.deepEqual(ok.matches.map((c) => c._id), ['e']);
  const other = matchCustomer('x.pdf', invoice('Somebody Else Entirely Dharmaj.Mo.9000000005'), customers(), 'bill');
  assert.ok(other.conflict);
});

test('an invoice carries the application number', () => {
  const m = matchCustomer('x.pdf', invoice('Gopalbhai Karshanbhai Rabari Piplav,Anand, A.NO. #NP-GJMG26-10000002'), customers(), 'bill');
  assert.deepEqual(m.matches.map((c) => c._id), ['b']);
  assert.equal(m.how, 'application number');
});

test('the Tally invoice number from the customer\'s DCR', () => {
  const m = matchCustomer('x.pdf', invoice('Ramesh Somabhai Patel Dharmaj', 'PSSU/446'), customers(), 'bill');
  assert.deepEqual(m.matches.map((c) => c._id), ['e']);
  assert.equal(m.how, 'invoice number');
});

test('a scanned policy is matched by the name in its file name, and flagged', () => {
  const m = matchCustomer('12b49960 gopalbhai karshanbhai rabari_1354.pdf', '', customers(), 'insurance');
  assert.deepEqual(m.matches.map((c) => c._id), ['b']);
  assert.match(m.note, /file name/);
});

test('the invoice number', () => {
  assert.equal(invoiceRef(invoice('X', '26-27/SS/123')), '26-27/SS/123');
  assert.equal(invoiceRef('no number here'), '');
});

// ---- PDFs ----
async function makePdf(pages) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const t of pages) {
    const page = doc.addPage([595, 842]);
    // wrapped into lines, like a real page
    (t.match(/.{1,70}(\s|$)/g) || [t]).forEach((line, i) => page.drawText(line.trim(), { x: 40, y: 780 - i * 14, size: 10, font }));
  }
  return Buffer.from(await doc.save());
}

test('a PDF of many invoices is cut into one PDF per invoice, first page only', async () => {
  const buf = await makePdf([
    'Tax Invoice Petlad Sojitra Buyer (Bill to) One Person Invoice No. 26-27/SS/1',
    'e-Way Bill EWB No 602111228533 Generated Date 13-Aug-26 Bill To: One Person',
    'Tax Invoice Petlad Sojitra Buyer (Bill to) Two Person Invoice No. 26-27/SS/2',
    'Tax Invoice Petlad Sojitra Buyer (Bill to) Two Person Invoice No. 26-27/SS/2 Duplicate for Transporter',
    'Terms and conditions continued',
    'Tax Invoice Petlad Sojitra Buyer (Bill to) Three Person Invoice No. 26-27/SS/3',
  ]);
  const parts = await splitInvoices(buf);
  assert.deepEqual(parts.map((p) => p.pages), [[1], [3], [6]]); // no e-way bill, no second copy, no terms
  for (const p of parts) assert.equal((await pageTexts(p.buffer, 5)).pages, 1);
  assert.equal(await splitInvoices(await makePdf(['Tax Invoice Petlad Sojitra Invoice No. 26-27/SS/1'])), null);
  assert.equal((await splitInvoices(await makePdf(['Tax Invoice Petlad Sojitra Invoice No. 26-27/SS/1', 'e-Way Bill EWB No 1']), 1)).length, 1);
});

test('a single bill PDF with an e-way bill behind it keeps only the first page', async () => {
  const two = await makePdf(['Tax Invoice Petlad Sojitra Buyer (Bill to) One Person Invoice No. 26-27/SS/1', 'e-Way Bill EWB No 602111228533']);
  const r = await billFirstPage(two);
  assert.equal(r.cut, true);
  assert.equal((await pageTexts(r.buffer, 5)).pages, 1);
  assert.match((await pageTexts(r.buffer, 1)).texts[0], /Tax Invoice/);
  const one = await billFirstPage(await makePdf(['Tax Invoice']));
  assert.equal(one.cut, false);
});

test('only the front page of a policy is kept', async () => {
  const cover = 'IFFCO-TOKIO cover letter dear customer';
  const front = policy('RABARI GOPALBHAI KARSHANBHAI', 'PIPLAV');
  const one = await policyFrontPage(await makePdf([front, 'terms', 'terms']));
  assert.equal(one.page, 1);
  assert.equal((await pageTexts(one.buffer, 5)).pages, 1);
  const skipped = await policyFrontPage(await makePdf([cover, front, 'terms']));
  assert.equal(skipped.page, 2);
  assert.match(skipped.text, /RABARI GOPALBHAI/);
});

// ---- same name, several customers: everything on the file is weighed ----
const twins = () => [
  make('p', 'ભગુભાઈ ધુળાભાઈ પટેલ', 'BHAGUBHAI DHULABHAI PATEL', 'પીપળાવ', 'PIPLAV', '9000000011', { taluka: 'પેટલાદ', kw: 4.32, panelRaw: 'અદાણી ૫૪૫ વોટ', inverterRaw: 'સોલારયાન ૩.૬' }),
  make('q', 'ભગુભાઈ ધુળાભાઈ પટેલ', 'BHAGUBHAI DHULABHAI PATEL', 'સોજીત્રા', 'SOJITRA', '9000000012', { taluka: 'સોજીત્રા', kw: 3.24, panelRaw: 'વારી ૫૪૦ વોટ', inverterRaw: 'VELOX 3.3' }),
];
const inv2 = (buyer, extra = '') =>
  `Tax Invoice Petlad Sojitra Taluka Sahkari Mandli Limited GSTIN/UIN: 24AAGAP8392R1ZL Buyer (Bill to) ${buyer} Place of Supply : Gujarat Invoice No. 26-27/SS/5 ${extra}`;

test('same name: the village on the file tells them apart', () => {
  const m = matchCustomer('x.pdf', inv2('Bhagubhai Dhulabhai Patel Sojitra,Anand.'), twins(), 'bill');
  assert.deepEqual(m.matches.map((c) => c._id), ['q']);
  assert.match(m.how, /village/);
});

test('same name: the kW and panel on the invoice tell them apart when no village is written', () => {
  const m = matchCustomer('x.pdf', inv2('Bhagubhai Dhulabhai Patel', 'Solar Power Generating System 4.32 Kw Pannel - Adani 545 Watt 8nos Inverter - 3.6 Solaryaan'), twins(), 'bill');
  assert.deepEqual(m.matches.map((c) => c._id), ['p']);
  assert.match(m.how, /kW/);
});

test('same name and nothing tells them apart: a person decides, with both offered', () => {
  const m = matchCustomer('x.pdf', inv2('Bhagubhai Dhulabhai Patel'), twins(), 'bill');
  assert.equal(m.matches.length, 2);
  assert.ok(m.tied);
});

test('same name, one clue is not enough when the other customer fits as well as it does', () => {
  // the village of one, the kW of the other: nobody leads clearly
  const m = matchCustomer('x.pdf', inv2('Bhagubhai Dhulabhai Patel Piplav', 'Solar Power Generating System 3.24 Kw'), twins(), 'bill');
  assert.equal(m.matches.length, 2);
});

// ---- the same name in another word order and with the BHAI left out ----
const kanu = () => [make('k', 'કનુભાઈ લાલજીભાઈ રબારી', 'KANUBHAI LALJIBHAI RABARI', 'પેટલાદ', 'PETLAD', '9000000021', { taluka: 'પેટલાદ', kw: 4.36 })];

test('RABARI KANU LALJI is KANUBHAI LALJIBHAI RABARI when the village or kW agrees', () => {
  const byVillage = matchCustomer('x.pdf', policy('RABARI KANU LALJI', 'PETLAD'), kanu(), 'insurance');
  assert.deepEqual(byVillage.matches.map((c) => c._id), ['k']);
  const byKw = matchCustomer('x.pdf', inv2('Rabari Kanu Lalji', 'System 4.36 Kw'), kanu(), 'bill');
  assert.deepEqual(byKw.matches.map((c) => c._id), ['k']);
});

test('the same name in another order with nothing else to confirm it is only suggested', () => {
  const m = matchCustomer('x.pdf', policy('RABARI KANU LALJI', 'SOMEWHERE ELSE'), kanu(), 'insurance');
  assert.equal(m.matches.length, 0);
  assert.ok(m.weak && m.suggestions.length === 1);
});
