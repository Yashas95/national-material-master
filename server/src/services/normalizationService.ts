export interface CanonicalUnit {
  raw: string;
  family: 'count' | 'length' | 'mass' | 'pack' | 'set';
  factor: number;
  canon: 'EA' | 'M' | 'KG' | 'PKT' | 'SET';
}

const UNIT_TABLE: Record<string, ['count' | 'length' | 'mass' | 'pack' | 'set', number]> = {
  EA: ['count', 1], EACH: ['count', 1], NOS: ['count', 1], NO: ['count', 1],
  PCS: ['count', 1], PC: ['count', 1], NUMBER: ['count', 1], UNIT: ['count', 1],
  M: ['length', 1], MTR: ['length', 1], MTRS: ['length', 1], METER: ['length', 1],
  METRE: ['length', 1], RM: ['length', 1], KM: ['length', 1000],
  KG: ['mass', 1], KGS: ['mass', 1], TON: ['mass', 1000], MT: ['mass', 1000],
  PKT: ['pack', 1], PACKET: ['pack', 1], SET: ['set', 1],
};

const FAMILY_CANON: Record<string, 'EA' | 'M' | 'KG' | 'PKT' | 'SET'> = {
  count: 'EA',
  length: 'M',
  mass: 'KG',
  pack: 'PKT',
  set: 'SET',
};

const DN_TO_IN: Record<number, number> = {
  15: 0.5, 20: 0.75, 25: 1, 50: 2, 80: 3, 100: 4, 150: 6, 200: 8, 250: 10, 300: 12,
};

const ABBREV_RULES: [RegExp, string][] = [
  [/\bS\s?\.\s?S\.?\s*/gi, 'SS '],
  [/\bSTAINLESS\s+STEEL\b/gi, 'SS'],
  [/\bCARBON\s+STEEL\b/gi, 'CS'],
  [/\bHEXAGONAL\b|\bHEXAGON\b/gi, 'HEX'],
  [/\bHD\b/gi, 'HEAD'],
  [/\bBRG\b/gi, 'BEARING'],
  [/\bMTR\b/gi, 'MOTOR'],
  [/\bIND\b/gi, 'INDUCTION'],
  [/\bGV\b/gi, 'GATE VALVE'],
  [/\bSMLS\b/gi, 'SEAMLESS'],
  [/\bGSKT\b/gi, 'GASKET'],
  [/\bSPW\b/gi, 'SPIRAL WOUND'],
  [/\bSW(?=\s+GASKET)/gi, 'SPIRAL WOUND'],
  [/\bFLGD\b/gi, 'FLANGED'],
  [/\bFLG\b/gi, 'FLANGE'],
  [/\bARMD\b/gi, 'ARMOURED'],
  [/\bW\s*\/\s*N\b|\bWELD\s*NECK\b|\bWELDNECK\b/gi, 'WN'],
  [/\bS\s*\/\s*O\b|\bSLIP\s*ON\b|\bSLIPON\b/gi, 'SO'],
  [/\bWNRF\b/gi, 'WN RF'],
  [/\bSORF\b/gi, 'SO RF'],
  [/\bGRAFOIL\b/gi, 'GRAPHITE'],
  [/\bCOPPER\b/gi, 'CU'],
  [/\bALUMINIUM\b|\bALUMINUM\b|\bALU\b/gi, 'AL'],
];

export class NormalizationService {
  static normalizeText(text: string): string {
    if (!text) return '';
    let t = String(text).toUpperCase().replace(/\u00D7/g, 'X').replace(/\u00D8/g, 'DIA ');

    t = t.replace(/[\u2010-\u2015\u2212]/g, '-');

    for (const [re, rep] of ABBREV_RULES) {
      t = t.replace(re, rep);
    }

    t = t.replace(/(\d)\s*[-]?\s*("|''|INCH(?:ES)?\b)/g, '$1 IN ');
    t = t.replace(/[,;:()\[\]{}_|\/]/g, ' ');

    t = t.replace(/(\d)\.(\d)/g, '$1\u00A7$2').replace(/\./g, ' ').replace(/\u00A7/g, '.');

    t = t.replace(/\bSS\s*(304|316)L?\b/g, 'SS$1');
    t = t.replace(/(\d)\s*C(?:ORE)?\s*[X*]\s*(\d)/g, '$1C X $2');
    t = t.replace(/(\d)\s*[X*]\s*(\d)/g, '$1 X $2');

    t = t.replace(/\b(?:DN|NB)\s*(\d{2,3})\b|\b(\d{2,3})\s*(?:NB|DN)\b/g, (m, a, b) => {
      const d = DN_TO_IN[parseInt(a || b, 10)];
      return d ? `${d} IN` : m;
    });

    t = t.replace(/(\d)(MM2|MM|KV|KW|HP|VOLTS?|V|IN|NB|RPM|LB|SQMM|KG)\b/g, '$1 $2');
    t = t.replace(/\bVOLTS?\b/g, 'V');
    t = t.replace(/\s+/g, ' ').trim();
    return t;
  }

  static normalizeUnit(unitStr: string | null | undefined): CanonicalUnit | null {
    if (!unitStr) return null;
    const k = String(unitStr).trim().toUpperCase().replace(/\./g, '');
    const entry = UNIT_TABLE[k];
    if (!entry) return null;
    return {
      raw: k,
      family: entry[0],
      factor: entry[1],
      canon: FAMILY_CANON[entry[0]],
    };
  }

  static tokenSort(text: string): string {
    return this.normalizeText(text)
      .split(/\s+/)
      .filter(Boolean)
      .sort()
      .join(' ');
  }
}
