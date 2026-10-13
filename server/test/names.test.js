import test from 'node:test';
import assert from 'node:assert/strict';
import { findByName, nameKeys, soundKey } from '../src/lib/names.js';

// made-up people
const customers = [
  'MAFATBHAI ISHVARBHAI THAKKAR',
  'DINESHBHAI VITHTHALBHAI THAKKAR',
  'HAMIDABEN IKBALBHAI VOHRA',
  'PRATULSINH PRADYUMANSINH MAHIDA',
  'DHARMISHTHABEN KALIDAS PATEL',
  'MAHIJIBHAI PUNJABHAI THAKOR',
  'KALPESHKUMAR GOVINDBHAI PATEL',
  'BACHUBHAI PRATAPBHAI RABARI',
  'RAMESHBHAI SOMABHAI PATEL',
  'RAMESHBHAI SOMABHAI PARMAR',
].map((n, i) => ({ id: i, name: n, keys: nameKeys(n) }));
const find = (n) => findByName(n, customers).map((c) => c.name);

test('same sound, different spelling', () => {
  assert.equal(soundKey('ISHWARBHAI'), soundKey('ISHVARBHAI'));
  assert.equal(soundKey('THAKKER'), soundKey('THAKKAR'));
  assert.equal(soundKey('IQBALBHAI'), soundKey('IKBALBHAI'));
  assert.equal(soundKey('PUJABHAI'), soundKey('PUNJABHAI'));
});

test('order, spelling, short forms and endings', () => {
  assert.deepEqual(find('MAFATBHAI ISHWARBHAI THAKKER'), ['MAFATBHAI ISHVARBHAI THAKKAR']);
  assert.deepEqual(find('THAKKAR DINESHBHAI VITTHALBHAI'), ['DINESHBHAI VITHTHALBHAI THAKKAR']);
  assert.deepEqual(find('HAMIDABEN IQBALBHAI VOHRA'), ['HAMIDABEN IKBALBHAI VOHRA']);
  assert.deepEqual(find('MAHIDA PRATULSINH PRADHYUMANSI'), ['PRATULSINH PRADYUMANSINH MAHIDA']);
  assert.deepEqual(find('DHARMISTHA KALIDAS PATEL'), ['DHARMISHTHABEN KALIDAS PATEL']);
  assert.deepEqual(find('MAHIJIBHAI PUJABHAI THAKOR'), ['MAHIJIBHAI PUNJABHAI THAKOR']);
  assert.deepEqual(find('KALPESHBHAI GOVINDBHAI PATEL'), ['KALPESHKUMAR GOVINDBHAI PATEL']);
});

test('a different person is not matched', () => {
  assert.deepEqual(find('BACHUBHAI PRABHATBHAI RABARI'), []);
  assert.deepEqual(find('RAMESHBHAI SOMABHAI SOLANKI'), []);
  assert.deepEqual(find('RAMESHBHAI PATEL'), []);
  assert.deepEqual(find('PATEL'), []);
});

test('the exact surname decides between two close customers', () => {
  assert.deepEqual(find('PATEL RAMESHBHAI SOMABHAI'), ['RAMESHBHAI SOMABHAI PATEL']);
});
