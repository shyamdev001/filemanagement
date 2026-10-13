import test from 'node:test';
import assert from 'node:assert/strict';
import { englishName } from '../src/lib/transliterate.js';

const cases = {
  'ડાભી રમેશભાઈ રામાભાઈ': 'DABHI RAMESHBHAI RAMABHAI',
  'ઝાલા જશવંતસિંહ મણિલાલ': 'ZALA JASHVANTSINH MANILAL',
  'પરમાર ફતેસિંહ હિંમતસિંહ': 'PARMAR FATESINH HIMMATSINH',
  'મફતભાઈ સોમાભાઈ પટેલ': 'MAFATBHAI SOMABHAI PATEL',
  'રામસિંગભાઈ શાંમતભાઈ પઢિયાર': 'RAMSINGBHAI SHAMMATBHAI PADHIYAR',
  'મલેક હસુભાઈ સુલતાનભાઇ': 'MALEK HASUBHAI SULTANBHAI',
  'ઠાકોર દિલીપભાઈ રમણભાઈ': 'THAKOR DILIPBHAI RAMANBHAI',
  'જહાંગીરખાન અહમદખાન પઠાણ': 'JAHANGIRKHAN AHMADKHAN PATHAN',
  'ઝાલા રાવજીભાઈ શનાભાઈ': 'ZALA RAVJIBHAI SHANABHAI',
  'ચીમનભાઈ વિઠ્ઠલભાઈ ઠાકોર': 'CHIMANBHAI VITHTHALBHAI THAKOR',
  'વિજયકુમાર નટુભાઈ પટેલ': 'VIJAYKUMAR NATUBHAI PATEL',
  'રમેશભાઈ અંબાલાલભાઈ વાળંદ': 'RAMESHBHAI AMBALALBHAI VALAND',
  'ચંદ્રકાંત ભગવાનદાસ શાહ': 'CHANDRAKANT BHAGVANDAS SHAH',
  'જમનાબેન રામુભાઈ વાઘરી': 'JAMNABEN RAMUBHAI VAGHRI',
  'ફિરોજખાન ચંદુભાઈ રાઠોડ': 'FIROJKHAN CHANDUBHAI RATHOD',
};

test('Gujarati names to English', () => {
  for (const [gu, en] of Object.entries(cases)) assert.equal(englishName(gu), en, gu);
});

test('blank input', () => {
  assert.equal(englishName(''), '');
  assert.equal(englishName(null), '');
});
