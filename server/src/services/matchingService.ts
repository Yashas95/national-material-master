import { CATEGORY_DEFINITIONS } from './extractionService';
export { CATEGORY_DEFINITIONS };
import { NormalizationService, CanonicalUnit } from './normalizationService';
import { EmbeddingService } from './embeddingService';

export interface MatchableRecord {
  id: string;
  code?: string;
  cpseId?: string;
  rawDesc: string;
  normDesc: string;
  category: string;
  attrs: Record<string, unknown>;
  unitInfo?: CanonicalUnit | null;
  history?: Array<{ price: number; qty: number; supplier: string }>;
  embedding?: number[];
}

export interface MatchingWeights {
  semantic: number;
  attribute: number;
  specification: number;
  category: number;
  unit: number;
  procurement: number;
}

export interface MatchingThresholds {
  strong: number;
  review: number;
  manual: number;
}

export interface MatchingConfig {
  weights: MatchingWeights;
  thresholds: MatchingThresholds;
}

export const DEFAULT_CONFIG: MatchingConfig = {
  weights: {
    semantic: 25,
    attribute: 25,
    specification: 20,
    category: 10,
    unit: 10,
    procurement: 10,
  },
  thresholds: {
    strong: 0.95,
    review: 0.80,
    manual: 0.60,
  },
};

export const STANDARD_GROUPS = [
  ['ISO 4014', 'DIN 931', 'IS 1364'],
];

export type MatchClassification =
  | 'EXACT_MATCH'
  | 'NEAR_DUPLICATE'
  | 'FUNCTIONALLY_EQUIVALENT'
  | 'VARIANT'
  | 'RELATED'
  | 'NON_MATCH'
  | 'REQUIRES_REVIEW';

export interface ComparisonResult {
  score: number;
  cls: MatchClassification;
  band: 'STRONG' | 'REVIEW' | 'INVESTIGATE' | 'NO_MATCH';
  components: {
    semantic: number;
    attribute: number;
    specification: number;
    category: number;
    unit: number;
    procurement: number;
  };
  matchedAttrs: string[];
  conflicts: string[];
  missingAttrs: Array<{ key: string; side: 'A' | 'B' | 'both' }>;
  unitRel: string;
  stdRel: string;
  supplierOverlap: number;
  priceProximity: number;
}

export class MatchingService {
  static jaroWinkler(s1: string, s2: string): number {
    if (s1 === s2) return 1.0;
    const l1 = s1.length;
    const l2 = s2.length;
    if (!l1 || !l2) return 0.0;

    const matchDistance = Math.max(0, Math.floor(Math.max(l1, l2) / 2) - 1);
    const m1 = new Array(l1).fill(false);
    const m2 = new Array(l2).fill(false);

    let matches = 0;
    for (let i = 0; i < l1; i++) {
      const lo = Math.max(0, i - matchDistance);
      const hi = Math.min(i + matchDistance + 1, l2);
      for (let j = lo; j < hi; j++) {
        if (!m2[j] && s1[i] === s2[j]) {
          m1[i] = m2[j] = true;
          matches++;
          break;
        }
      }
    }

    if (matches === 0) return 0.0;

    let transpositions = 0;
    let k = 0;
    for (let i = 0; i < l1; i++) {
      if (m1[i]) {
        while (!m2[k]) k++;
        if (s1[i] !== s2[k]) transpositions++;
        k++;
      }
    }

    const jaro = (matches / l1 + matches / l2 + (matches - transpositions / 2) / matches) / 3.0;

    let prefix = 0;
    while (prefix < 4 && s1[prefix] === s2[prefix]) prefix++;

    return jaro + prefix * 0.1 * (1.0 - jaro);
  }

  static stdRelation(s1?: string, s2?: string): { score: number; rel: string } {
    if (!s1 && !s2) return { score: 0.85, rel: 'none' };
    if (!s1 || !s2) return { score: 0.60, rel: 'one-missing' };
    if (s1 === s2) return { score: 1.0, rel: 'same' };
    if (STANDARD_GROUPS.some(g => g.includes(s1) && g.includes(s2))) {
      return { score: 0.95, rel: 'equivalent' };
    }
    return { score: 0.30, rel: 'different' };
  }

  static compareUnits(u1?: CanonicalUnit | null, u2?: CanonicalUnit | null): { score: number; rel: string } {
    if (!u1 || !u2) return { score: 0.0, rel: 'invalid' };
    if (u1.raw === u2.raw) return { score: 1.0, rel: 'same' };
    if (u1.family === u2.family && u1.factor === u2.factor) return { score: 1.0, rel: 'equivalent' };
    if (u1.family === u2.family) return { score: 0.8, rel: 'convertible' };
    return { score: 0.0, rel: 'incompatible' };
  }

  static async compareRecords(
    r1: MatchableRecord,
    r2: MatchableRecord,
    cfg: MatchingConfig = DEFAULT_CONFIG
  ): Promise<ComparisonResult> {
    const W = cfg.weights;
    const def = CATEGORY_DEFINITIONS[r1.category] || { critical: [] };
    const critical = def.critical;

    let sem = 0.5;
    if (r1.embedding && r2.embedding) {
      sem = Math.max(0, Math.min(1, EmbeddingService.cosineSimilarity(r1.embedding, r2.embedding)));
    } else {
      const v1 = EmbeddingService.generateDeterministicVector(r1.normDesc);
      const v2 = EmbeddingService.generateDeterministicVector(r2.normDesc);
      sem = Math.max(0, Math.min(1, EmbeddingService.cosineSimilarity(v1, v2)));
    }

    const keys = new Set(critical);
    if ((r1.attrs && r1.attrs.manufacturer) || (r2.attrs && r2.attrs.manufacturer)) keys.add('manufacturer');

    const matchedAttrs: string[] = [];
    const conflicts: string[] = [];
    const missingAttrs: Array<{ key: string; side: 'A' | 'B' | 'both' }> = [];
    let attrScoreSum = 0;
    let attrCount = 0;

    for (const k of keys) {
      attrCount++;
      const v1 = r1.attrs[k];
      const v2 = r2.attrs[k];

      if (v1 !== undefined && v2 !== undefined) {
        if (String(v1) === String(v2)) {
          attrScoreSum += 1.0;
          matchedAttrs.push(k);
        } else if (critical.includes(k)) {
          conflicts.push(k);
        } else {
          attrScoreSum += 0.4;
        }
      } else if (v1 === undefined && v2 === undefined) {
        attrScoreSum += 0.5;
        missingAttrs.push({ key: k, side: 'both' });
      } else {
        attrScoreSum += 0.5;
        missingAttrs.push({ key: k, side: v1 === undefined ? 'A' : 'B' });
      }
    }

    const attributeScore = attrCount > 0 ? attrScoreSum / attrCount : 0;

    const jw = this.jaroWinkler(
      NormalizationService.tokenSort(r1.normDesc),
      NormalizationService.tokenSort(r2.normDesc)
    );
    const sr = this.stdRelation(
      r1.attrs.standard as string | undefined,
      r2.attrs.standard as string | undefined
    );
    const specificationScore = 0.55 * jw + 0.45 * sr.score;

    const categoryScore = r1.category === r2.category ? 1.0 : 0.0;

    const unitEval = this.compareUnits(r1.unitInfo, r2.unitInfo);
    const unitScore = unitEval.score;

    const suppliers1 = new Set((r1.history || []).map(h => h.supplier));
    const suppliers2 = new Set((r2.history || []).map(h => h.supplier));
    const sharedCount = [...suppliers1].filter(s => suppliers2.has(s)).length;
    const totalVendors = new Set([...suppliers1, ...suppliers2]).size;
    const supplierOverlap = totalVendors > 0 ? sharedCount / totalVendors : 0;

    const avgP1 = this.avgPrice(r1);
    const avgP2 = this.avgPrice(r2);
    const priceProximity =
      avgP1 && avgP2 && r1.unitInfo && r2.unitInfo && r1.unitInfo.family === r2.unitInfo.family
        ? Math.min(avgP1, avgP2) / Math.max(avgP1, avgP2)
        : 0.5;

    const procurementScore = 0.3 * supplierOverlap + 0.7 * priceProximity;

    const weightSum =
      W.semantic + W.attribute + W.specification + W.category + W.unit + W.procurement || 1.0;

    const rawScore =
      (sem * W.semantic +
        attributeScore * W.attribute +
        specificationScore * W.specification +
        categoryScore * W.category +
        unitScore * W.unit +
        procurementScore * W.procurement) /
      weightSum;

    const finalScore = Math.max(0, Math.min(1, rawScore));

    const critMissing = missingAttrs.filter(m => critical.includes(m.key));
    const isSameTokens =
      NormalizationService.tokenSort(r1.normDesc) === NormalizationService.tokenSort(r2.normDesc);

    let cls: MatchClassification;
    if (r1.category !== r2.category) {
      cls = 'NON_MATCH';
    } else if (conflicts.length === 1) {
      cls = 'VARIANT';
    } else if (conflicts.length > 1) {
      cls = 'RELATED';
    } else if (critMissing.length > 0) {
      cls = 'REQUIRES_REVIEW';
    } else if (unitEval.rel === 'incompatible' || unitEval.rel === 'invalid') {
      cls = 'REQUIRES_REVIEW';
    } else if (isSameTokens && (unitEval.rel === 'same' || unitEval.rel === 'equivalent')) {
      cls = 'EXACT_MATCH';
    } else if (finalScore >= cfg.thresholds.strong) {
      cls = 'NEAR_DUPLICATE';
    } else {
      cls = 'FUNCTIONALLY_EQUIVALENT';
    }

    const bandRating = this.band(finalScore, cfg.thresholds);

    return {
      score: finalScore,
      cls,
      band: bandRating,
      components: {
        semantic: sem,
        attribute: attributeScore,
        specification: specificationScore,
        category: categoryScore,
        unit: unitScore,
        procurement: procurementScore,
      },
      matchedAttrs,
      conflicts,
      missingAttrs,
      unitRel: unitEval.rel,
      stdRel: sr.rel,
      supplierOverlap,
      priceProximity,
    };
  }

  static band(score: number, th: MatchingThresholds): 'STRONG' | 'REVIEW' | 'INVESTIGATE' | 'NO_MATCH' {
    if (score >= th.strong) return 'STRONG';
    if (score >= th.review) return 'REVIEW';
    if (score >= th.manual) return 'INVESTIGATE';
    return 'NO_MATCH';
  }

  private static avgPrice(r: MatchableRecord): number | null {
    if (!r.history || !r.history.length || !r.unitInfo) return null;
    let qty = 0;
    let spend = 0;
    for (const h of r.history) {
      qty += h.qty * r.unitInfo.factor;
      spend += h.qty * h.price;
    }
    return qty > 0 ? spend / qty : null;
  }

  static matchPair = MatchingService.compareRecords;
}
