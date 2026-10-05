import { GoogleGenAI, Type } from '@google/genai';
import { config } from '../config/env';
import { NormalizationService } from './normalizationService';

export interface ExtractionResult {
  category: string;
  attrs: Record<string, unknown>;
  confidence: number;
  usedGemini: boolean;
  missingCritical: string[];
}

export const CATEGORY_DEFINITIONS: Record<string, { label: string; critical: string[] }> = {
  HEX_BOLT: { label: 'Hex bolt', critical: ['diameter', 'length', 'grade'] },
  BALL_BEARING: { label: 'Ball bearing', critical: ['bearing_no', 'seal'] },
  GATE_VALVE: { label: 'Gate valve', critical: ['size_in', 'pressure_class', 'body_material'] },
  FLANGE: { label: 'Flange', critical: ['size_in', 'pressure_class', 'flange_type', 'grade'] },
  INDUCTION_MOTOR: { label: 'Induction motor', critical: ['power_kw', 'voltage', 'poles'] },
  SEAMLESS_PIPE: { label: 'Seamless pipe', critical: ['size_in', 'schedule', 'grade'] },
  SPIRAL_WOUND_GASKET: { label: 'Spiral wound gasket', critical: ['size_in', 'pressure_class', 'grade'] },
  POWER_CABLE: { label: 'Power cable', critical: ['cores', 'area_sqmm', 'conductor', 'voltage_kv'] },
  WELDING_ELECTRODE: { label: 'Welding electrode', critical: ['aws_class', 'dia_mm'] },
  UNCLASSIFIED: { label: 'Unclassified', critical: [] },
};

const HP_TO_KW: Record<number, number> = {
  5: 3.7, 7.5: 5.5, 10: 7.5, 15: 11, 20: 15, 25: 18.5, 30: 22, 50: 37,
};

const RPM_TO_POLES: Record<number, number> = {
  2880: 2, 2900: 2, 2950: 2, 3000: 2, 1440: 4, 1450: 4, 1470: 4, 1500: 4, 960: 6, 1000: 6,
};

export class ExtractionService {
  private static geminiClient: GoogleGenAI | null = null;

  private static getGeminiClient(): GoogleGenAI | null {
    if (!config.gemini.isConfigured) return null;
    if (!this.geminiClient) {
      this.geminiClient = new GoogleGenAI({ apiKey: config.gemini.apiKey });
    }
    return this.geminiClient;
  }

  static async extract(rawText: string): Promise<ExtractionResult> {
    const norm = NormalizationService.normalizeText(rawText);

    const tier1 = this.extractDeterministic(norm);

    if (tier1.category !== 'UNCLASSIFIED' && tier1.missingCritical.length === 0) {
      return {
        ...tier1,
        usedGemini: false,
      };
    }

    const client = this.getGeminiClient();
    if (client) {
      try {
        const geminiResult = await this.extractWithGemini(rawText, norm);
        if (geminiResult) {
          const mergedAttrs = { ...tier1.attrs, ...geminiResult.attrs };
          const category = geminiResult.category && geminiResult.category !== 'UNCLASSIFIED'
            ? geminiResult.category
            : tier1.category;
          const def = CATEGORY_DEFINITIONS[category] || { critical: [] };
          const missingCritical = def.critical.filter(k => mergedAttrs[k] === undefined);

          return {
            category,
            attrs: mergedAttrs,
            confidence: Math.max(tier1.confidence, geminiResult.confidence),
            missingCritical,
            usedGemini: true,
          };
        }
      } catch (err) {
        console.warn('⚠️  [ExtractionService] Gemini extraction failed, falling back to deterministic result:', err);
      }
    }

    return {
      ...tier1,
      usedGemini: false,
    };
  }

  static extractDeterministic(norm: string): { category: string; attrs: Record<string, unknown>; confidence: number; missingCritical: string[] } {
    const attrs: Record<string, unknown> = {};
    let category = 'UNCLASSIFIED';

    if (/\b(HEX|BOLT|STUD|FASTENER)\b/.test(norm)) category = 'HEX_BOLT';
    else if (/\b(BEARING|BRG|DEEP\s+GROOVE)\b/.test(norm)) category = 'BALL_BEARING';
    else if (/\b(GATE\s+VALVE|GLOBE\s+VALVE|CHECK\s+VALVE|VALVE)\b/.test(norm)) category = 'GATE_VALVE';
    else if (/\bFLANGE\b/.test(norm)) category = 'FLANGE';
    else if (/\b(MOTOR|INDUCTION\s+MOTOR)\b/.test(norm)) category = 'INDUCTION_MOTOR';
    else if (/\b(SEAMLESS\s+PIPE|PIPE|SMLS\s+PIPE)\b/.test(norm)) category = 'SEAMLESS_PIPE';
    else if (/\b(GASKET|SPIRAL\s+WOUND)\b/.test(norm)) category = 'SPIRAL_WOUND_GASKET';
    else if (/\b(CABLE|POWER\s+CABLE)\b/.test(norm)) category = 'POWER_CABLE';
    else if (/\b(ELECTRODE|WELDING\s+ELECTRODE)\b/.test(norm)) category = 'WELDING_ELECTRODE';

    switch (category) {
      case 'HEX_BOLT': {
        const m = norm.match(/\bM\s*(\d+)/i) || norm.match(/(\d+)\s*MM\s+DIA/i);
        if (m) attrs.diameter = parseInt(m[1], 10);

        const l = norm.match(/[Xx*]\s*(\d+)(?:\s*MM)?/i) || norm.match(/(\d+)\s*MM\s+LG/i);
        if (l) attrs.length = parseInt(l[1], 10);

        if (/\bSS\s*316\b/i.test(norm)) attrs.grade = 'SS316';
        else if (/\bSS\s*304\b/i.test(norm)) attrs.grade = 'SS304';
        else if (/\b8\.8\b/.test(norm)) attrs.grade = '8.8';
        else if (/\b10\.9\b/.test(norm)) attrs.grade = '10.9';

        if (/ISO\s*4014/i.test(norm)) attrs.standard = 'ISO 4014';
        else if (/DIN\s*931/i.test(norm)) attrs.standard = 'DIN 931';
        else if (/IS\s*1364/i.test(norm)) attrs.standard = 'IS 1364';
        break;
      }

      case 'BALL_BEARING': {
        const b = norm.match(/\b(6\d{3}|7\d{3}|2\d{4})\b/);
        if (b) attrs.bearing_no = b[1];

        if (/2RS1|2RSH|2RS|\bRS\b/i.test(norm)) attrs.seal = '2RS';
        else if (/2Z|ZZ|\bZ\b/i.test(norm)) attrs.seal = 'ZZ';
        else if (/\bOPEN\b/i.test(norm)) attrs.seal = 'OPEN';
        else attrs.seal = 'OPEN';

        const mfg = norm.match(/\b(SKF|FAG|TIMKEN|NTN)\b/i);
        if (mfg) attrs.manufacturer = mfg[1].toUpperCase();
        break;
      }

      case 'GATE_VALVE': {
        const sz = norm.match(/(\d+(?:\.\d+)?)\s*IN/i) || norm.match(/(\d+)\s*MM/i);
        if (sz) attrs.size_in = parseFloat(sz[1]);

        const cl = norm.match(/CLASS\s*(\d+)|CL\s*(\d+)|#\s*(\d+)|(\d+)\s*LBS?|(\d+)\s*#/i);
        if (cl) attrs.pressure_class = parseInt(cl[1] || cl[2] || cl[3] || cl[4] || cl[5], 10);

        if (/CF8M|SS\s*316/i.test(norm)) attrs.body_material = 'SS316';
        else if (/CF8|SS\s*304/i.test(norm)) attrs.body_material = 'SS304';
        else if (/WCB|A216/i.test(norm)) attrs.body_material = 'WCB';
        break;
      }

      case 'INDUCTION_MOTOR': {
        const hp = norm.match(/(\d+(?:\.\d+)?)\s*HP/i);
        const kw = norm.match(/(\d+(?:\.\d+)?)\s*KW/i);
        if (kw) attrs.power_kw = parseFloat(kw[1]);
        else if (hp) attrs.power_kw = HP_TO_KW[parseFloat(hp[1])] || parseFloat(hp[1]) * 0.746;

        const v = norm.match(/(\d{3})\s*V/i);
        if (v) attrs.voltage = parseInt(v[1], 10);

        const rpm = norm.match(/(\d{3,4})\s*RPM/i);
        if (rpm) attrs.poles = RPM_TO_POLES[parseInt(rpm[1], 10)] || 4;
        break;
      }

      case 'SEAMLESS_PIPE': {
        const sz = norm.match(/(\d+(?:\.\d+)?)\s*IN/i);
        if (sz) attrs.size_in = parseFloat(sz[1]);

        const sch = norm.match(/SCH\s*(\d+|STD|XS|XXS)/i);
        if (sch) attrs.schedule = sch[1].toUpperCase();

        if (/A106\s*GR\s*B|A106B|CS/i.test(norm)) attrs.grade = 'A106-B';
        else if (/A312\s*TP316|SS\s*316/i.test(norm)) attrs.grade = 'SS316';
        else if (/A312\s*TP304|SS\s*304/i.test(norm)) attrs.grade = 'SS304';
        break;
      }
    }

    const def = CATEGORY_DEFINITIONS[category] || { critical: [] };
    const missingCritical = def.critical.filter(k => attrs[k] === undefined);

    let confidence = 0.5;
    if (category !== 'UNCLASSIFIED') {
      const matchRatio = def.critical.length > 0
        ? (def.critical.length - missingCritical.length) / def.critical.length
        : 1.0;
      confidence = 0.6 + matchRatio * 0.4;
    }

    return {
      category,
      attrs,
      confidence,
      missingCritical,
    };
  }

  private static async extractWithGemini(
    rawText: string,
    normText: string
  ): Promise<{ category: string; attrs: Record<string, unknown>; confidence: number; missingCritical: string[] } | null> {
    const ai = this.getGeminiClient();
    if (!ai) return null;

    const prompt = `You are an expert industrial mechanical, electrical and piping engineer for Central Public Sector Enterprises (CPSEs).
Analyze the following noisy procurement description and extract its standard engineering equipment category and physical dimensions:

Raw description: "${rawText}"
Normalized tokens: "${normText}"

Available Categories:
- HEX_BOLT (critical: diameter, length, grade)
- BALL_BEARING (critical: bearing_no, seal)
- GATE_VALVE (critical: size_in, pressure_class, body_material)
- FLANGE (critical: size_in, pressure_class, flange_type, grade)
- INDUCTION_MOTOR (critical: power_kw, voltage, poles)
- SEAMLESS_PIPE (critical: size_in, schedule, grade)
- SPIRAL_WOUND_GASKET (critical: size_in, pressure_class, grade)
- POWER_CABLE (critical: cores, area_sqmm, conductor, voltage_kv)
- WELDING_ELECTRODE (critical: aws_class, dia_mm)
- UNCLASSIFIED

Instructions:
1. Reconcile metric and imperial units (e.g. DN100 is 4 IN; 10 HP is 7.5 KW; CF8M is SS316).
2. Do not invent attributes that are not indicated in the text.`;

    const response = await ai.models.generateContent({
      model: config.gemini.model,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            category: { type: Type.STRING },
            attributes: { type: Type.OBJECT },
            confidence: { type: Type.NUMBER },
          },
          required: ['category', 'attributes', 'confidence'],
        },
      },
    });

    if (!response.text) return null;

    const parsed = JSON.parse(response.text);
    const category = parsed.category || 'UNCLASSIFIED';
    const attrs = parsed.attributes || {};
    const def = CATEGORY_DEFINITIONS[category] || { critical: [] };
    const missingCritical = def.critical.filter(k => attrs[k] === undefined);

    let confidence = Number(parsed.confidence) || 0.85;
    if (missingCritical.length > 0) {
      confidence = Math.min(confidence, 0.85);
    }

    return {
      category,
      attrs,
      confidence,
      missingCritical,
    };
  }
}
