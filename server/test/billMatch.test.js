import test from 'node:test';
import assert from 'node:assert/strict';
import { detectType, documentName, matchCustomer, prepareCustomer } from '../src/lib/uploads.js';

// Made-up customers: names, villages, mobiles and consumer numbers are not real.
const make = (id, name, english, village, villageEn, mobile, consumerNo) =>
  prepareCustomer({ _id: id, name, village, mobiles: [mobile], consumerNo }, english, villageEn, english);
const customers = () => [
  make('a', 'રમેશભાઈ સોમાભાઈ પટેલ', 'RAMESHBHAI SOMABHAI PATEL', 'ધર્મજ', 'DHARMAJ', '9000000001', '11122233344'),
  make('b', 'રમેશભાઈ સોમાભાઈ પટેલ', 'RAMESHBHAI SOMABHAI PATEL', 'સોજીત્રા', 'SOJITRA', '9000000002', '11122233355'),
  make('c', 'કિરણબેન મહેશભાઈ પરમાર', 'KIRANBEN MAHESHBHAI PARMAR', 'પેટલાદ', 'PETLAD', '9000000003', ''),
];

test('bills and policies are told apart from the portal documents', () => {
  assert.equal(detectType('light bill.pdf', ''), 'bill');
  assert.equal(detectType('scan_001.pdf', 'MGVCL Bill of Supply Bill Date 01-09-2026 Units Consumed 120'), 'bill');
  assert.equal(detectType('policy.pdf', ''), 'insurance');
  assert.equal(detectType('doc.pdf', 'Rooftop Solar Insurance Policy Schedule Policy No 123 Sum Insured 150000'), 'insurance');
  assert.equal(detectType('10934882_feasibilityLetter_2.pdf', 'Approval of Feasibility'), 'fl');
});

test('name on a bill and a policy', () => {
  assert.equal(documentName('Consumer Name : RAMESHBHAI SOMABHAI PATEL Address : AT DHARMAJ', 'bill'), 'RAMESHBHAI SOMABHAI PATEL');
  assert.equal(documentName('Name of the Insured : Mrs. KIRANBEN MAHESHBHAI PARMAR Address : Petlad', 'insurance'), 'KIRANBEN MAHESHBHAI PARMAR');
});

test('a bill is filed by its consumer number, even when two customers share the name', () => {
  const m = matchCustomer('bill.pdf', 'Consumer No : 11122233355 Consumer Name : RAMESHBHAI SOMABHAI PATEL', customers(), 'bill');
  assert.deepEqual(m.matches.map((c) => c._id), ['b']);
  assert.ok(!m.conflict);
});

test('a consumer number whose name disagrees goes to a person', () => {
  const m = matchCustomer('bill.pdf', 'Consumer No : 11122233344 Consumer Name : KIRANBEN MAHESHBHAI PARMAR', customers(), 'bill');
  assert.ok(m.conflict);
});

test('same name: the village on the bill decides', () => {
  const m = matchCustomer('bill.pdf', 'Consumer Name : RAMESHBHAI SOMABHAI PATEL Address : AT SOJITRA', customers(), 'bill');
  assert.deepEqual(m.matches.map((c) => c._id), ['b']);
});

test('a Gujarati bill: the Gujarati name and village as in the Excel', () => {
  const m = matchCustomer('bill.pdf', 'વીજ બીલ ગ્રાહકનું નામ : રમેશભાઈ સોમાભાઈ પટેલ મુ. ધર્મજ', customers(), 'bill');
  assert.deepEqual(m.matches.map((c) => c._id), ['a']);
});

test('a policy with mobile number and name', () => {
  const m = matchCustomer('policy.pdf', 'Insured Name : KIRANBEN MAHESHBHAI PARMAR Mobile 9000000003', customers(), 'insurance');
  assert.deepEqual(m.matches.map((c) => c._id), ['c']);
});

test('the name ends where the next field of the bill starts', () => {
  assert.equal(documentName('Consumer No : 11122233344 Consumer Name : RAMESHBHAI SOMABHAI PATEL Units Consumed : 132', 'bill'), 'RAMESHBHAI SOMABHAI PATEL');
});
