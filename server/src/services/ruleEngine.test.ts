import test from 'node:test';
import assert from 'node:assert';
import { RuleEngine } from './ruleEngine';

test('RuleEngine - R-01: Critical Attribute Conflict Blocks Merge', () => {
  // Hex bolt: grade conflict
  const rConflict = RuleEngine.evalR01('HEX_BOLT', { diameter: 16, length: 50, grade: 'SS304' }, { diameter: 16, length: 50, grade: 'SS316' });
  assert.strictEqual(rConflict.passed, false);
  assert.strictEqual(rConflict.ruleId, 'R-01');
  assert.ok(rConflict.message.includes('grade'));

  // Hex bolt: identical attributes
  const rPassed = RuleEngine.evalR01('HEX_BOLT', { diameter: 16, length: 50, grade: 'SS304' }, { diameter: 16, length: 50, grade: 'SS304' });
  assert.strictEqual(rPassed.passed, true);
});

test('RuleEngine - R-02: Motor Rating Equivalence (HP vs kW)', () => {
  assert.strictEqual(RuleEngine.evalR02(10, 'HP', 7.5, 'KW'), true);
  assert.strictEqual(RuleEngine.evalR02(20, 'HP', 15, 'KW'), true);
  assert.strictEqual(RuleEngine.evalR02(50, 'HP', 37, 'KW'), true);
  assert.strictEqual(RuleEngine.evalR02(10, 'HP', 15, 'KW'), false);
});

test('RuleEngine - R-03: Nominal Pipe Size Equivalence (DN vs Inch)', () => {
  assert.strictEqual(RuleEngine.evalR03(100, 'DN', 4, 'IN'), true);
  assert.strictEqual(RuleEngine.evalR03(50, 'DN', 2, 'IN'), true);
  assert.strictEqual(RuleEngine.evalR03(150, 'DN', 6, 'IN'), true);
  assert.strictEqual(RuleEngine.evalR03(100, 'DN', 2, 'IN'), false);
});

test('RuleEngine - R-04: Bearing Seal Suffix Equivalence', () => {
  assert.strictEqual(RuleEngine.evalR04('2RS1', '2RS'), true);
  assert.strictEqual(RuleEngine.evalR04('2RSH', '2RS'), true);
  assert.strictEqual(RuleEngine.evalR04('2Z', 'ZZ'), true);
  assert.strictEqual(RuleEngine.evalR04('2RS', 'ZZ'), false);
});

test('RuleEngine - R-05: Electrode Diameter Equivalence', () => {
  assert.strictEqual(RuleEngine.evalR05(3.2, 3.15), true);
  assert.strictEqual(RuleEngine.evalR05(3.15, 3.2), true);
  assert.strictEqual(RuleEngine.evalR05(3.2, 4.0), false);
});

test('RuleEngine - R-06: Cast and Wrought Metallurgy Equivalence', () => {
  assert.strictEqual(RuleEngine.evalR06('CF8M', 'SS316'), true);
  assert.strictEqual(RuleEngine.evalR06('CF8', 'SS304'), true);
  assert.strictEqual(RuleEngine.evalR06('WCB', 'A216'), true);
  assert.strictEqual(RuleEngine.evalR06('CF8M', 'SS304'), false);
});

test('RuleEngine - R-07: Hex Bolt Standard Equivalence', () => {
  assert.strictEqual(RuleEngine.evalR07('ISO 4014', 'DIN 931'), true);
  assert.strictEqual(RuleEngine.evalR07('DIN 931', 'IS 1364'), true);
  assert.strictEqual(RuleEngine.evalR07('ISO 4014', 'DIN 933'), false); // DIN 933 is fully-threaded
});

test('RuleEngine - R-08: Unit Family Compatibility', () => {
  const countMatch = RuleEngine.evalR08('NOS', 'PCS');
  assert.strictEqual(countMatch.compatible, true);
  assert.strictEqual(countMatch.familyA, 'count');

  const lengthMatch = RuleEngine.evalR08('MTR', 'KM');
  assert.strictEqual(lengthMatch.compatible, true);
  assert.strictEqual(lengthMatch.familyA, 'length');

  const incompatible = RuleEngine.evalR08('MTR', 'KG');
  assert.strictEqual(incompatible.compatible, false);
});

test('RuleEngine - R-09: Procurement Supporting Only', () => {
  // When physical conflict exists, even 100% procurement similarity CANNOT merge!
  assert.strictEqual(RuleEngine.evalR09(true, 1.0), false);
  // When no conflict exists, high procurement confidence passes
  assert.strictEqual(RuleEngine.evalR09(false, 0.85), true);
});

test('RuleEngine - R-10: Insufficient Information Routes to Review', () => {
  // Missing grade on hex bolt
  const incomplete = RuleEngine.evalR10('HEX_BOLT', { diameter: 16, length: 50 });
  assert.strictEqual(incomplete.canAutoMerge, false);
  assert.ok(incomplete.missing.includes('grade'));

  // Complete hex bolt
  const complete = RuleEngine.evalR10('HEX_BOLT', { diameter: 16, length: 50, grade: 'SS304' });
  assert.strictEqual(complete.canAutoMerge, true);
  assert.strictEqual(complete.missing.length, 0);
});

test('RuleEngine - Gemini Verification Guard Offline Fallback', async () => {
  const result = await RuleEngine.verifyUncommonEquivalenceWithGemini('standard', 'JIS B1180', 'ISO 4014');
  assert.strictEqual(typeof result.equivalent, 'boolean');
  assert.ok(result.rationale.length > 0);
});
