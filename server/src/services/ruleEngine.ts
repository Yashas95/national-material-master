import { GoogleGenAI, Type } from '@google/genai';
import { config } from '../config/env';
import { CATEGORY_DEFINITIONS } from './extractionService';
import { NormalizationService } from './normalizationService';

export interface DomainRuleDefinition {
  id: string;
  name: string;
  detail: string;
}

export const DOMAIN_RULES: DomainRuleDefinition[] = [
  { id: 'R-01', name: 'Critical attribute conflict blocks merge', detail: 'If two records share a category but differ on any critical attribute (grade, size, length, rating, voltage, class, schedule), they are never merged, whatever the text similarity or procurement signal.' },
  { id: 'R-02', name: 'Motor rating equivalence', detail: 'Standard motor ratings are equivalent across units: 5 HP = 3.7 kW, 10 HP = 7.5 kW, 20 HP = 15 kW, 50 HP = 37 kW.' },
  { id: 'R-03', name: 'Nominal pipe size equivalence', detail: 'DN and NB sizes map to inch sizes: DN50 = 2 in, DN100 = 4 in, DN150 = 6 in, DN200 = 8 in.' },
  { id: 'R-04', name: 'Bearing seal suffix equivalence', detail: 'Manufacturer seal suffixes 2RS1 and 2RSH are treated as 2RS; 2Z is treated as ZZ.' },
  { id: 'R-05', name: 'Electrode diameter equivalence', detail: 'Electrode core diameter 3.2 mm is the commercial designation of 3.15 mm.' },
  { id: 'R-06', name: 'Cast and wrought grade equivalence', detail: 'Valve body CF8M is the cast equivalent of SS316; WCB and A216 are carbon steel bodies.' },
  { id: 'R-07', name: 'Bolt standard equivalence', detail: 'ISO 4014, DIN 931 and IS 1364 describe the same part-threaded hexagon head bolt.' },
  { id: 'R-08', name: 'Unit-of-measure families', detail: 'EA, NOS, NO and PCS are counts; M, MTR, RM and KM are lengths (KM = 1000 M); KG and KGS are mass. PKT cannot be converted without a pack size.' },
  { id: 'R-09', name: 'Procurement is supporting evidence only', detail: 'Supplier overlap and price proximity can raise or lower confidence but can never override a technical conflict.' },
  { id: 'R-10', name: 'Insufficient information is not a match', detail: 'Records missing a critical attribute are routed to human review instead of being merged automatically.' },
];

export const STANDARD_GROUPS = [
  ['ISO 4014', 'DIN 931', 'IS 1364'],
];

export const METALLURGY_EQUIVALENCES: Record<string, string> = {
  CF8M: 'SS316',
  CF8: 'SS304',
  WCB: 'CARBON_STEEL',
  A216: 'CARBON_STEEL',
  A106B: 'CARBON_STEEL',
};

export const DN_INCH_MAP: Record<number, number> = {
  15: 0.5, 20: 0.75, 25: 1, 50: 2, 80: 3, 100: 4, 150: 6, 200: 8, 250: 10, 300: 12,
};

export const HP_KW_MAP: Record<number, number> = {
  5: 3.7, 7.5: 5.5, 10: 7.5, 15: 11, 20: 15, 25: 18.5, 30: 22, 50: 37,
};

export interface RuleEvaluationResult {
  ruleId: string;
  passed: boolean;
  message: string;
  details?: Record<string, unknown>;
}

export class RuleEngine {
  private static geminiClient: GoogleGenAI | null = null;

  private static getGeminiClient(): GoogleGenAI | null {
    if (!config.gemini.isConfigured) return null;
    if (!this.geminiClient) {
      this.geminiClient = new GoogleGenAI({ apiKey: config.gemini.apiKey });
    }
    return this.geminiClient;
  }

  static evalR01(category: string, attrsA: Record<string, unknown>, attrsB: Record<string, unknown>): RuleEvaluationResult {
    const def = CATEGORY_DEFINITIONS[category] || { critical: [] };
    const conflicts: string[] = [];

    for (const k of def.critical) {
      const vA = attrsA[k];
      const vB = attrsB[k];
      if (vA !== undefined && vB !== undefined && String(vA) !== String(vB)) {
        conflicts.push(`${k} (${vA} vs ${vB})`);
      }
    }

    if (conflicts.length > 0) {
      return {
        ruleId: 'R-01',
        passed: false,
        message: `Merge blocked by Rule R-01. Critical attribute conflict: ${conflicts.join(', ')}.`,
        details: { conflicts },
      };
    }

    return {
      ruleId: 'R-01',
      passed: true,
      message: 'No critical attribute conflicts detected.',
    };
  }

  static evalR02(valA: number, unitA: 'HP' | 'KW', valB: number, unitB: 'HP' | 'KW'): boolean {
    const kwA = unitA === 'KW' ? valA : HP_KW_MAP[valA] || valA * 0.746;
    const kwB = unitB === 'KW' ? valB : HP_KW_MAP[valB] || valB * 0.746;
    return Math.abs(kwA - kwB) < 0.1;
  }

  static evalR03(valA: number, unitA: 'DN' | 'IN', valB: number, unitB: 'DN' | 'IN'): boolean {
    const inA = unitA === 'IN' ? valA : DN_INCH_MAP[valA];
    const inB = unitB === 'IN' ? valB : DN_INCH_MAP[valB];
    if (inA === undefined || inB === undefined) return false;
    return Math.abs(inA - inB) < 0.01;
  }

  static evalR04(sealA: string, sealB: string): boolean {
    const canon = (s: string) => {
      const u = s.toUpperCase().trim();
      if (/2RS1|2RSH|2RS|\bRS\b/.test(u)) return '2RS';
      if (/2Z|ZZ|\bZ\b/.test(u)) return 'ZZ';
      return u;
    };
    return canon(sealA) === canon(sealB);
  }

  static evalR05(diaA: number, diaB: number): boolean {
    if (diaA === diaB) return true;
    const set = new Set([diaA, diaB]);
    return set.has(3.2) && set.has(3.15);
  }

  static evalR06(gradeA: string, gradeB: string): boolean {
    const canonA = METALLURGY_EQUIVALENCES[gradeA.toUpperCase().trim()] || gradeA.toUpperCase().trim();
    const canonB = METALLURGY_EQUIVALENCES[gradeB.toUpperCase().trim()] || gradeB.toUpperCase().trim();
    return canonA === canonB;
  }

  static evalR07(stdA: string, stdB: string): boolean {
    const sA = stdA.toUpperCase().trim();
    const sB = stdB.toUpperCase().trim();
    if (sA === sB) return true;
    return STANDARD_GROUPS.some(group => group.includes(sA) && group.includes(sB));
  }

  static evalR08(rawUnitA: string, rawUnitB: string): { compatible: boolean; familyA?: string; familyB?: string } {
    const uA = NormalizationService.normalizeUnit(rawUnitA);
    const uB = NormalizationService.normalizeUnit(rawUnitB);
    if (!uA || !uB) return { compatible: false };
    return {
      compatible: uA.family === uB.family,
      familyA: uA.family,
      familyB: uB.family,
    };
  }

  static evalR09(hasCriticalConflict: boolean, procurementScore: number): boolean {
    if (hasCriticalConflict) {
      return false;
    }
    return procurementScore >= 0.5;
  }

  static evalR10(category: string, attrs: Record<string, unknown>): { canAutoMerge: boolean; missing: string[] } {
    const def = CATEGORY_DEFINITIONS[category] || { critical: [] };
    const missing = def.critical.filter(k => attrs[k] === undefined);
    return {
      canAutoMerge: missing.length === 0,
      missing,
    };
  }

  static async verifyUncommonEquivalenceWithGemini(
    domain: 'standard' | 'metallurgy' | 'spec',
    specA: string,
    specB: string
  ): Promise<{ equivalent: boolean; confidence: number; rationale: string }> {
    const client = this.getGeminiClient();
    if (!client) {
      return {
        equivalent: false,
        confidence: 0.5,
        rationale: 'Gemini offline: relying on deterministic standard tables only.',
      };
    }

    try {
      const prompt = `You are a materials and mechanical engineering verification auditor.
Evaluate whether the following two ${domain} designations describe identical/functionally equivalent engineering specifications:
Specification A: "${specA}"
Specification B: "${specB}"

Requirements:
- Distinguish between true equivalents (e.g. JIS B1180 vs ISO 4014) and variants with differing thread lengths, tolerances, or chemistry.
- Answer in JSON.`;

      const response = await client.models.generateContent({
        model: config.gemini.model,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              equivalent: { type: Type.BOOLEAN },
              confidence: { type: Type.NUMBER },
              rationale: { type: Type.STRING },
            },
            required: ['equivalent', 'confidence', 'rationale'],
          },
        },
      });

      if (!response.text) {
        return { equivalent: false, confidence: 0.5, rationale: 'Empty Gemini response.' };
      }

      const parsed = JSON.parse(response.text);
      return {
        equivalent: Boolean(parsed.equivalent),
        confidence: Number(parsed.confidence) || 0.8,
        rationale: parsed.rationale || 'Gemini verified.',
      };
    } catch (error) {
      console.warn('⚠️  [RuleEngine] Gemini verification call failed:', error);
      return {
        equivalent: false,
        confidence: 0.5,
        rationale: 'Gemini verification unavailable.',
      };
    }
  }
}
