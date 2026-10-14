import test from 'node:test';
import assert from 'node:assert/strict';
import { readDcrPanels } from '../src/lib/dcr.js';

const dcr = (maker, table) => `Solar Module Manufactured By : ${maker} Address : Somewhere Item Description Quantity KW ${table} Printed on`;

test('Waaree BI-55 glass-glass module', () => {
  const r = readDcrPanels(dcr('Waaree Energies Limited', 'BI - 55 - 540(DCR) (Wp : 540 Efficiency : 20.98) SPGS G - G MODULE 540 WP(MONO - DCR) - 144 CELL 6 3.24'));
  assert.equal(r.read, true);
  assert.deepEqual(r.items.map((i) => [i.brand, i.watt, i.qty, i.topcon]), [['waaree', 540, 6, false]]);
});

test('an Adani TOPCon module made by another company is still Adani', () => {
  const [i] = readDcrPanels(dcr('Goldi Sun Private Limited', 'AB - G12R - 132 - 620 (Wp : 620 Efficiency : 25.3) SPV Module 6 3.72')).items;
  assert.deepEqual([i.brand, i.watt, i.topcon], ['adani', 620, true]);
});

test('brand from the maker when the code says nothing', () => {
  const [i] = readDcrPanels(dcr('TP Solar Limited', '585 W (Wp : 585 Efficiency : 23) TP585LG10B - MONO PERC 6 3.51')).items;
  assert.deepEqual([i.brand, i.watt], ['tata', 585]);
});

test('APS TOPCon', () => {
  const [i] = readDcrPanels(dcr('Australian Premium Solar (India) Limited', 'APSTM - 600/144 (Wp : 600 Efficiency : 23.2) N - Type TOPCon Module 8 4.80')).items;
  assert.deepEqual([i.brand, i.watt, i.qty, i.topcon], ['aps', 600, 8, true]);
});

test('a scan has nothing to read', () => {
  assert.equal(readDcrPanels('').read, false);
});

test('the repeat of each item on page 2 is not counted twice', () => {
  const item = 'BiN - 08 - 585(DCR) (Wp : 585 Efficiency : 22.65) M10 TOPCon - 16BB G - G Module 585Wp DCR 6 3.51';
  const r = readDcrPanels(dcr('Waaree Energies Limited', `${item} 25 - Mar - 26 Wafer to Cell Conversion - Jupiter Solar Cells to Solar Panels Conversion - Waaree Energies Limited ${item}`));
  assert.deepEqual(r.items.map((i) => [i.code, i.qty]), [['BiN - 08 - 585(DCR)', 6]]);
});
