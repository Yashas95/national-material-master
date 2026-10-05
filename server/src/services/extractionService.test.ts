import test from 'node:test';
import assert from 'node:assert';
import { ExtractionService } from './extractionService';

test('ExtractionService - Hex Bolt Extraction', async () => {
  const result = await ExtractionService.extract('HEX BOLT M16X50 SS304 DIN 931');
  assert.strictEqual(result.category, 'HEX_BOLT');
  assert.strictEqual(result.attrs.diameter, 16);
  assert.strictEqual(result.attrs.length, 50);
  assert.strictEqual(result.attrs.grade, 'SS304');
  assert.strictEqual(result.attrs.standard, 'DIN 931');
  assert.strictEqual(result.missingCritical.length, 0);
  assert.strictEqual(result.confidence, 1.0);
});

test('ExtractionService - Gate Valve with DN and Cast Metallurgy Conversion', async () => {
  const result = await ExtractionService.extract('GATE VALVE DN100 CLASS 150 CF8M BODY');
  assert.strictEqual(result.category, 'GATE_VALVE');
  assert.strictEqual(result.attrs.size_in, 4);
  assert.strictEqual(result.attrs.pressure_class, 150);
  assert.strictEqual(result.attrs.body_material, 'SS316'); // CF8M reconciles to SS316
  assert.strictEqual(result.missingCritical.length, 0);
});

test('ExtractionService - Induction Motor with HP to kW Conversion', async () => {
  const result = await ExtractionService.extract('MOTOR 3PH 10HP 415V 1440RPM');
  assert.strictEqual(result.category, 'INDUCTION_MOTOR');
  assert.strictEqual(result.attrs.power_kw, 7.5); // 10 HP = 7.5 kW
  assert.strictEqual(result.attrs.voltage, 415);
  assert.strictEqual(result.attrs.poles, 4); // 1440 RPM = 4 poles
  assert.strictEqual(result.missingCritical.length, 0);
});

test('ExtractionService - Ball Bearing with Seal Suffix Reconciliation', async () => {
  const result = await ExtractionService.extract('BALL BEARING 6205-2RS1 SKF');
  assert.strictEqual(result.category, 'BALL_BEARING');
  assert.strictEqual(result.attrs.bearing_no, '6205');
  assert.strictEqual(result.attrs.seal, '2RS'); // 2RS1 reconciles to 2RS
  assert.strictEqual(result.attrs.manufacturer, 'SKF');
  assert.strictEqual(result.missingCritical.length, 0);
});

test('ExtractionService - Incomplete Record Detection (Safety Rule)', async () => {
  // Description is missing grade (SS304 vs SS316)
  const result = await ExtractionService.extract('HEX BOLT M16X50');
  assert.strictEqual(result.category, 'HEX_BOLT');
  assert.strictEqual(result.attrs.diameter, 16);
  assert.strictEqual(result.attrs.length, 50);
  assert.ok(result.missingCritical.includes('grade'));
  assert.ok(result.confidence < 1.0);
});

test('ExtractionService - Instant Deterministic Extraction (Tier 1)', () => {
  const t0 = performance.now();
  const result = ExtractionService.extractDeterministic('SS316 GATE VALVE 4 IN CLASS 150');
  const elapsed = performance.now() - t0;

  assert.strictEqual(result.category, 'GATE_VALVE');
  assert.strictEqual(result.attrs.size_in, 4);
  assert.strictEqual(result.attrs.pressure_class, 150);
  assert.strictEqual(result.attrs.body_material, 'SS316');
  assert.strictEqual(result.missingCritical.length, 0);
  assert.ok(elapsed < 10, `Expected Tier 1 extraction to complete under 10ms, took ${elapsed}ms`);
});
