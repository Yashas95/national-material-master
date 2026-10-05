import test from 'node:test';
import assert from 'node:assert';
import { MatchingService, MatchableRecord } from './matchingService';
import { EmbeddingService } from './embeddingService';
import { NormalizationService } from './normalizationService';

test('MatchingService - Jaro-Winkler Metric', () => {
  assert.strictEqual(MatchingService.jaroWinkler('HEX BOLT', 'HEX BOLT'), 1.0);
  assert.strictEqual(MatchingService.jaroWinkler('', 'TEST'), 0.0);
  const typoScore = MatchingService.jaroWinkler('STAINLESS STEEL', 'STAINLES STEEL');
  assert.ok(typoScore > 0.95, `Expected typo score > 0.95, got ${typoScore}`);
});

test('MatchingService - International Standard Equivalence', () => {
  assert.strictEqual(MatchingService.stdRelation('ISO 4014', 'ISO 4014').score, 1.0);
  // ISO 4014 and DIN 931 are part-threaded hex bolt equivalents
  const eq = MatchingService.stdRelation('ISO 4014', 'DIN 931');
  assert.strictEqual(eq.rel, 'equivalent');
  assert.strictEqual(eq.score, 0.95);
  // Unrelated standards
  const diff = MatchingService.stdRelation('ISO 4014', 'DIN 933');
  assert.strictEqual(diff.rel, 'different');
  assert.strictEqual(diff.score, 0.30);
});

test('MatchingService - Unit Compatibility Matrix', () => {
  const uCount1 = NormalizationService.normalizeUnit('NOS');
  const uCount2 = NormalizationService.normalizeUnit('PCS');
  const uLength1 = NormalizationService.normalizeUnit('MTR');
  const uLength2 = NormalizationService.normalizeUnit('KM');
  const uMass = NormalizationService.normalizeUnit('KG');

  // Count to Count (same factor)
  assert.strictEqual(MatchingService.compareUnits(uCount1, uCount2).rel, 'equivalent');
  assert.strictEqual(MatchingService.compareUnits(uCount1, uCount2).score, 1.0);

  // Length to Length (convertible: 1 M to 1000 M)
  assert.strictEqual(MatchingService.compareUnits(uLength1, uLength2).rel, 'convertible');
  assert.strictEqual(MatchingService.compareUnits(uLength1, uLength2).score, 0.8);

  // Length to Mass (strictly incompatible!)
  assert.strictEqual(MatchingService.compareUnits(uLength1, uMass).rel, 'incompatible');
  assert.strictEqual(MatchingService.compareUnits(uLength1, uMass).score, 0.0);
});

test('MatchingService - Demo Bolt Matching across CPSEs', async () => {
  const r1: MatchableRecord = {
    id: 'REC-001',
    code: 'BOLT-10021',
    cpseId: 'A',
    rawDesc: 'HEX BOLT M16X50 SS304',
    normDesc: NormalizationService.normalizeText('HEX BOLT M16X50 SS304'),
    category: 'HEX_BOLT',
    attrs: { diameter: 16, length: 50, grade: 'SS304' },
    unitInfo: NormalizationService.normalizeUnit('NOS'),
    history: [{ price: 45, qty: 1000, supplier: 'Apex Fasteners' }],
  };

  const r2: MatchableRecord = {
    id: 'REC-002',
    code: 'MAT-98231',
    cpseId: 'B',
    rawDesc: 'HEXAGONAL HEAD BOLT M16 x 50 STAINLESS STEEL 304',
    normDesc: NormalizationService.normalizeText('HEXAGONAL HEAD BOLT M16 x 50 STAINLESS STEEL 304'),
    category: 'HEX_BOLT',
    attrs: { diameter: 16, length: 50, grade: 'SS304' },
    unitInfo: NormalizationService.normalizeUnit('PCS'),
    history: [{ price: 46, qty: 1200, supplier: 'Apex Fasteners' }],
  };

  const comp = await MatchingService.compareRecords(r1, r2);

  assert.ok(comp.score >= 0.95, `Expected composite score >= 0.95, got ${comp.score}`);
  assert.strictEqual(comp.band, 'STRONG');
  assert.ok(comp.cls === 'EXACT_MATCH' || comp.cls === 'NEAR_DUPLICATE');
  assert.strictEqual(comp.conflicts.length, 0);
  assert.ok(comp.matchedAttrs.includes('diameter'));
  assert.ok(comp.matchedAttrs.includes('length'));
  assert.ok(comp.matchedAttrs.includes('grade'));
});

test('MatchingService - Rule R-01: Critical Conflict Blocks Merge (SS304 vs SS316)', async () => {
  const r1: MatchableRecord = {
    id: 'REC-001',
    code: 'BOLT-10021',
    cpseId: 'A',
    rawDesc: 'HEX BOLT M16X50 SS304',
    normDesc: NormalizationService.normalizeText('HEX BOLT M16X50 SS304'),
    category: 'HEX_BOLT',
    attrs: { diameter: 16, length: 50, grade: 'SS304' },
    unitInfo: NormalizationService.normalizeUnit('NOS'),
  };

  const r2: MatchableRecord = {
    id: 'REC-003',
    code: 'BOLT-316',
    cpseId: 'B',
    rawDesc: 'HEX BOLT M16X50 SS316',
    normDesc: NormalizationService.normalizeText('HEX BOLT M16X50 SS316'),
    category: 'HEX_BOLT',
    attrs: { diameter: 16, length: 50, grade: 'SS316' },
    unitInfo: NormalizationService.normalizeUnit('NOS'),
  };

  const comp = await MatchingService.compareRecords(r1, r2);

  // Even though text is 90%+ similar, Rule R-01 MUST classify as VARIANT!
  assert.strictEqual(comp.cls, 'VARIANT');
  assert.ok(comp.conflicts.includes('grade'));
});

test('MatchingService - Incompatible Units Route to REQUIRES_REVIEW', async () => {
  const r1: MatchableRecord = {
    id: 'REC-PIPE-1',
    rawDesc: 'SEAMLESS PIPE 4 IN SCH 40 A106-B',
    normDesc: NormalizationService.normalizeText('SEAMLESS PIPE 4 IN SCH 40 A106-B'),
    category: 'SEAMLESS_PIPE',
    attrs: { size_in: 4, schedule: '40', grade: 'A106-B' },
    unitInfo: NormalizationService.normalizeUnit('MTR'), // Length
  };

  const r2: MatchableRecord = {
    id: 'REC-PIPE-2',
    rawDesc: 'SEAMLESS PIPE 4 IN SCH 40 A106-B',
    normDesc: NormalizationService.normalizeText('SEAMLESS PIPE 4 IN SCH 40 A106-B'),
    category: 'SEAMLESS_PIPE',
    attrs: { size_in: 4, schedule: '40', grade: 'A106-B' },
    unitInfo: NormalizationService.normalizeUnit('KG'), // Mass (cannot convert without density)
  };

  const comp = await MatchingService.compareRecords(r1, r2);
  assert.strictEqual(comp.unitRel, 'incompatible');
  assert.strictEqual(comp.cls, 'REQUIRES_REVIEW');
});

test('EmbeddingService - Deterministic Vector & Cosine Similarity', async () => {
  const v1 = await EmbeddingService.generateEmbedding('HEX BOLT M16X50 SS304');
  const v2 = await EmbeddingService.generateEmbedding('HEX BOLT M16X50 SS304');
  const v3 = await EmbeddingService.generateEmbedding('GATE VALVE 4 IN CLASS 150');

  assert.strictEqual(v1.length, 384);
  const simIdentical = EmbeddingService.cosineSimilarity(v1, v2);
  const simDifferent = EmbeddingService.cosineSimilarity(v1, v3);

  assert.ok(Math.abs(simIdentical - 1.0) < 1e-4, 'Identical text should yield cosine similarity ~1.0');
  assert.ok(simDifferent < 0.6, `Unrelated items should yield low similarity, got ${simDifferent}`);
});
