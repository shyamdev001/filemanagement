import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parsePanels, parseInverter, solaryaanModel } from '../src/lib/parsers.js';
import { parseMobiles, parseNumber, toGujarati } from '../src/lib/gujarati.js';

const cfg = JSON.parse(fs.readFileSync(new URL('../config/datasheets.default.json', import.meta.url), 'utf8'));
const panels = (raw) => parsePanels(raw, cfg.panelBrands).map((p) => `${p.brand} ${p.watt}${p.topcon ? ' T' : ''}${p.nonDcr ? ' N' : ''}`);

test('single panel', () => {
  assert.deepEqual(panels('વારી ૫૪૦ વોટ'), ['waaree 540']);
  assert.deepEqual(panels('APS 550 વોટ'), ['aps 550']);
  assert.deepEqual(panels('અદાણી ૬૨૫વોટ'), ['adani 625']);
  assert.deepEqual(panels('અદાણી ૬૨૦ કિલો વોટ'), ['adani 620']);
});

test('topcon written before, after, or split', () => {
  assert.deepEqual(panels('APS ટોપકોન ૬૦૦ વોટ'), ['aps 600 T']);
  assert.deepEqual(panels('વારી ૫૮૫ વોટ  ટોપકોન'), ['waaree 585 T']);
  assert.deepEqual(panels('અદાણી ટોપ કોન ૬૩૦ વોટ'), ['adani 630 T']);
});

test('mixed panels with counts', () => {
  assert.deepEqual(panels('અદાણી ૫૩૫(૪) ૫૫૫(2)'), ['adani 535', 'adani 555']);
  assert.deepEqual(panels('અદાણી ૫૩૫(૦૧)૫૫૫(૦૨)૫૫૦(૦૬)'), ['adani 535', 'adani 555', 'adani 550']);
  assert.deepEqual(panels('અદાણી વોટ ૫૩૫ (૩) ૫૪૫ (૩ )'), ['adani 535', 'adani 545']);
  assert.deepEqual(panels('APS ૬૦૦(૫) વારી ૬૧૫ નોન DCR (૦૩)'), ['aps 600', 'waaree 615 N']);
  assert.deepEqual(panels('APS ૬૦૦ વોટ ૦૯ પેનલ વારી નોન DCR ૬૧૫ વોટ ૦૧ પેનલ'), ['aps 600', 'waaree 615 N']);
  assert.deepEqual(panels('વારી ૫૪૦ વોટ(૦૬) વારી ૬૧૫ વોટ નોન-DCR(૦૪)'), ['waaree 540', 'waaree 615 N']);
  assert.deepEqual(panels('અદાણી ૫૪૫ (૫) વારી ૫૪૦(1)'), ['adani 545', 'waaree 540']);
  assert.deepEqual(panels('અદાણી ટોપકોન ૬૦૫(૩)૬૧૫(૩) વોટ'), ['adani 605 T', 'adani 615 T']);
});

test('missing watt or blank', () => {
  assert.deepEqual(panels('વારી'), ['waaree null']);
  assert.deepEqual(panels('વારી NON DCR'), ['waaree null N']);
  assert.deepEqual(panels(''), []);
});

test('inverter', () => {
  const inv = (raw) => parseInverter(raw, cfg.inverterBrands);
  assert.deepEqual(inv('સોલારયાન ૩.૬'), { brand: 'solaryaan', size: 3.6 });
  assert.deepEqual(inv('સોલારયાન ૫.૫.'), { brand: 'solaryaan', size: 5.5 });
  assert.deepEqual(inv('VELOX ૬.'), { brand: 'velox', size: 6 });
  assert.deepEqual(inv('ગૂડ વે ૫.૦૦'), { brand: 'goodwe', size: 5 });
  assert.deepEqual(inv(''), { brand: null, size: null });
  assert.equal(solaryaanModel(3.6), 'SYS- 3.6');
  assert.equal(solaryaanModel(6), 'SYS- 6.0');
});

test('mobile and number cleaning', () => {
  // made-up numbers, not real customers
  assert.deepEqual(parseMobiles('૯૮૭૬૫૪૩૨૧૦'), ['9876543210']);
  assert.deepEqual(parseMobiles('9876543210 9876501234'), ['9876543210', '9876501234']);
  assert.deepEqual(parseMobiles('987654321'), []);
  assert.equal(parseNumber('૪..૦૯'), 4.09);
  assert.equal(parseNumber('.૩.૨૪'), 3.24);
  assert.equal(toGujarati('9876543210'), '૯૮૭૬૫૪૩૨૧૦');
});
