import test from 'node:test';
import assert from 'node:assert';
import { NormalizationService } from './normalizationService';

test('NormalizationService - Text Normalization', async (t) => {
  await t.test('standardizes stainless steel notations to canonical SS304/SS316', () => {
    assert.strictEqual(
      NormalizationService.normalizeText('S.S. 304 HEX BOLT'),
      'SS304 HEX BOLT'
    );
    assert.strictEqual(
      NormalizationService.normalizeText('STAINLESS STEEL 316 VALVE'),
      'SS316 VALVE'
    );
  });

  await t.test('standardizes metric nominal pipe sizes to inches', () => {
    assert.strictEqual(
      NormalizationService.normalizeText('GATE VALVE DN100 CLASS 150'),
      'GATE VALVE 4 IN CLASS 150'
    );
    assert.strictEqual(
      NormalizationService.normalizeText('FLANGE 50 NB CLASS 300'),
      'FLANGE 2 IN CLASS 300'
    );
  });

  await t.test('standardizes equipment abbreviations and separates units', () => {
    assert.strictEqual(
      NormalizationService.normalizeText('IND MTR 10HP'),
      'INDUCTION MOTOR 10 HP'
    );
    assert.strictEqual(
      NormalizationService.normalizeText('HEX HD BOLT M16*50'),
      'HEX HEAD BOLT M16 X 50'
    );
  });

  await t.test('tokenSort produces order-invariant string', () => {
    const s1 = NormalizationService.tokenSort('SS304 HEX BOLT M16 50MM');
    const s2 = NormalizationService.tokenSort('HEX BOLT M16 50MM SS304');
    assert.strictEqual(s1, s2);
  });
});

test('NormalizationService - Unit Normalization', async (t) => {
  await t.test('normalizes count units to canonical EA', () => {
    const u1 = NormalizationService.normalizeUnit('NOS');
    const u2 = NormalizationService.normalizeUnit('PCS');
    const u3 = NormalizationService.normalizeUnit('EACH');
    assert.strictEqual(u1?.canon, 'EA');
    assert.strictEqual(u2?.canon, 'EA');
    assert.strictEqual(u3?.canon, 'EA');
    assert.strictEqual(u1?.factor, 1);
  });

  await t.test('normalizes length units and metric scaling factors', () => {
    const m = NormalizationService.normalizeUnit('MTR');
    const km = NormalizationService.normalizeUnit('KM');
    assert.strictEqual(m?.canon, 'M');
    assert.strictEqual(m?.factor, 1);
    assert.strictEqual(km?.canon, 'M');
    assert.strictEqual(km?.factor, 1000);
  });

  await t.test('returns null for unrecognized or invalid units', () => {
    assert.strictEqual(NormalizationService.normalizeUnit('UNKNOWN_XYZ'), null);
    assert.strictEqual(NormalizationService.normalizeUnit(null), null);
  });
});
