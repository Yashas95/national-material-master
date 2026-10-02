/* National Unified Material Master: client-side intelligence pipeline.
   All data generated here is SYNTHETIC. No real CPSE or procurement data. */
(function (root) {
'use strict';

function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

const CPSES = [
  { id: 'A', short: 'PETRO', name: 'Synthetic Petroleum Ltd', sector: 'Oil & Gas', erp: 'SAP ECC export', format: 'CSV', color: '#5B8DEF' },
  { id: 'B', short: 'POWER', name: 'Synthetic Power Corporation', sector: 'Power', erp: 'SAP S/4HANA export', format: 'Excel', color: '#2FB3A3' },
  { id: 'C', short: 'STEEL', name: 'Synthetic Steel Ltd', sector: 'Steel', erp: 'Oracle EBS export', format: 'JSON', color: '#A77BE0' },
  { id: 'D', short: 'MINES', name: 'Synthetic Mining Company', sector: 'Mining', erp: 'In-house ERP', format: 'XML', color: '#86B03C' },
  { id: 'E', short: 'HVENG', name: 'Synthetic Heavy Engineering Ltd', sector: 'Heavy Engineering', erp: 'SAP ECC export', format: 'CSV', color: '#E07798' },
];
const CPSE_BY_ID = Object.fromEntries(CPSES.map(c => [c.id, c]));

const CATEGORIES = {
  HEX_BOLT: { label: 'Hex bolt', group: 'Fasteners', prefix: 'BOLT', short: 'BLT', critical: ['diameter', 'length', 'grade'], block: 'diameter' },
  BALL_BEARING: { label: 'Ball bearing', group: 'Bearings', prefix: 'BRG', short: 'BRG', critical: ['bearing_no', 'seal'], block: 'bearing_no' },
  GATE_VALVE: { label: 'Gate valve', group: 'Valves', prefix: 'VLV', short: 'VLV', critical: ['size_in', 'pressure_class', 'body_material'], block: 'size_in' },
  FLANGE: { label: 'Flange', group: 'Piping', prefix: 'FLG', short: 'FLG', critical: ['size_in', 'pressure_class', 'flange_type', 'grade'], block: 'size_in' },
  INDUCTION_MOTOR: { label: 'Induction motor', group: 'Electrical', prefix: 'MTR', short: 'MTR', critical: ['power_kw', 'voltage', 'poles'], block: null },
  SEAMLESS_PIPE: { label: 'Seamless pipe', group: 'Piping', prefix: 'PIPE', short: 'PIP', critical: ['size_in', 'schedule', 'grade'], block: 'size_in' },
  SPIRAL_WOUND_GASKET: { label: 'Spiral wound gasket', group: 'Piping', prefix: 'GSK', short: 'GSK', critical: ['size_in', 'pressure_class', 'grade'], block: 'size_in' },
  POWER_CABLE: { label: 'Power cable', group: 'Electrical', prefix: 'CBL', short: 'CBL', critical: ['cores', 'area_sqmm', 'conductor', 'voltage_kv'], block: 'cores' },
  WELDING_ELECTRODE: { label: 'Welding electrode', group: 'Consumables', prefix: 'ELD', short: 'ELD', critical: ['aws_class', 'dia_mm'], block: 'aws_class' },
  UNCLASSIFIED: { label: 'Unclassified', group: 'Unclassified', prefix: 'MISC', short: 'MSC', critical: [], block: null },
};
const CAT_ORDER = Object.keys(CATEGORIES);

const ATTR_LABELS = {
  diameter: 'Diameter', length: 'Length', grade: 'Grade', bearing_no: 'Bearing number', seal: 'Seal type',
  size_in: 'Nominal size', pressure_class: 'Pressure class', body_material: 'Body material', flange_type: 'Flange type',
  power_kw: 'Rated power', voltage: 'Voltage', poles: 'Poles', schedule: 'Schedule', cores: 'Cores',
  area_sqmm: 'Conductor area', conductor: 'Conductor', voltage_kv: 'Voltage grade', aws_class: 'AWS class',
  dia_mm: 'Core diameter', standard: 'Standard', manufacturer: 'Manufacturer', material: 'Material',
};

const HP_KW = { 5: 3.7, 7.5: 5.5, 10: 7.5, 15: 11, 20: 15, 25: 18.5, 30: 22, 50: 37 };
const KW_HP = Object.fromEntries(Object.entries(HP_KW).map(([h, k]) => [k, +h]));
const DN_IN = { 15: 0.5, 20: 0.75, 25: 1, 50: 2, 80: 3, 100: 4, 150: 6, 200: 8, 250: 10, 300: 12 };
const IN_DN = Object.fromEntries(Object.entries(DN_IN).map(([d, i]) => [i, +d]));
const RPM_POLES = { 2880: 2, 2900: 2, 2950: 2, 3000: 2, 1440: 4, 1450: 4, 1470: 4, 1500: 4, 960: 6, 1000: 6 };

const UNIT_TABLE = {
  EA: ['count', 1], EACH: ['count', 1], NOS: ['count', 1], NO: ['count', 1], PCS: ['count', 1], PC: ['count', 1], NUMBER: ['count', 1], UNIT: ['count', 1],
  M: ['length', 1], MTR: ['length', 1], MTRS: ['length', 1], METER: ['length', 1], METRE: ['length', 1], RM: ['length', 1], KM: ['length', 1000],
  KG: ['mass', 1], KGS: ['mass', 1], TON: ['mass', 1000], MT: ['mass', 1000],
  PKT: ['pack', 1], PACKET: ['pack', 1], SET: ['set', 1],
};
const FAMILY_CANON = { count: 'EA', length: 'M', mass: 'KG', pack: 'PKT', set: 'SET' };
function canonUnit(u) {
  const k = String(u || '').trim().toUpperCase().replace(/\./g, '');
  const e = UNIT_TABLE[k];
  if (!e) return null;
  return { raw: k, family: e[0], factor: e[1], canon: FAMILY_CANON[e[0]] };
}

/* Domain knowledge: the rules the matching engine applies deterministically. */
const DOMAIN_RULES = [
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
const STANDARD_GROUPS = [['ISO 4014', 'DIN 931', 'IS 1364']];

const ABBREVIATIONS = [
  ['S.S. / STAINLESS STEEL', 'SS'], ['CARBON STEEL', 'CS'], ['HEXAGONAL / HEXAGON', 'HEX'], ['HD', 'HEAD'],
  ['BRG', 'BEARING'], ['MTR', 'MOTOR'], ['IND', 'INDUCTION'], ['GV', 'GATE VALVE'], ['SMLS', 'SEAMLESS'],
  ['GSKT', 'GASKET'], ['SPW / SW', 'SPIRAL WOUND'], ['FLG', 'FLANGE'], ['W/N / WELD NECK', 'WN'], ['S/O / SLIP ON', 'SO'],
  ['GRAFOIL', 'GRAPHITE'], ['COPPER', 'CU'], ['ALUMINIUM', 'AL'], ['DN100 / 100NB', '4 IN'], ['" / INCH', 'IN'],
];

/* ---------------- Normalization ---------------- */
const ABBREV_RULES = [
  [/\bS\s?\.\s?S\.?\s*/g, 'SS '],
  [/\bSTAINLESS\s+STEEL\b/g, 'SS'],
  [/\bCARBON\s+STEEL\b/g, 'CS'],
  [/\bHEXAGONAL\b|\bHEXAGON\b/g, 'HEX'],
  [/\bHD\b/g, 'HEAD'],
  [/\bBRG\b/g, 'BEARING'],
  [/\bMTR\b/g, 'MOTOR'],
  [/\bIND\b/g, 'INDUCTION'],
  [/\bGV\b/g, 'GATE VALVE'],
  [/\bSMLS\b/g, 'SEAMLESS'],
  [/\bGSKT\b/g, 'GASKET'],
  [/\bSPW\b/g, 'SPIRAL WOUND'],
  [/\bSW(?=\s+GASKET)/g, 'SPIRAL WOUND'],
  [/\bFLGD\b/g, 'FLANGED'],
  [/\bFLG\b/g, 'FLANGE'],
  [/\bARMD\b/g, 'ARMOURED'],
  [/\bW\s*\/\s*N\b|\bWELD\s*NECK\b|\bWELDNECK\b/g, 'WN'],
  [/\bS\s*\/\s*O\b|\bSLIP\s*ON\b|\bSLIPON\b/g, 'SO'],
  [/\bWNRF\b/g, 'WN RF'],
  [/\bSORF\b/g, 'SO RF'],
  [/\bGRAFOIL\b/g, 'GRAPHITE'],
  [/\bCOPPER\b/g, 'CU'],
  [/\bALUMINIUM\b|\bALUMINUM\b|\bALU\b/g, 'AL'],
];

function normalize(desc) {
  let t = String(desc || '').toUpperCase().replace(/\u00D7/g, 'X').replace(/\u00D8/g, 'DIA ');
  for (const [re, rep] of ABBREV_RULES) t = t.replace(re, rep);
  t = t.replace(/(\d)\s*("|''|INCH(?:ES)?\b)/g, '$1 IN ');
  t = t.replace(/[,;:()\[\]{}_|\/]/g, ' ').replace(/-/g, ' ');
  t = t.replace(/(\d)\.(\d)/g, '$1\u00A7$2').replace(/\./g, ' ').replace(/\u00A7/g, '.');
  t = t.replace(/\bSS\s*(304|316)L?\b/g, 'SS$1');
  t = t.replace(/(\d)\s*C(?:ORE)?\s*[X*]\s*(\d)/g, '$1C X $2');
  t = t.replace(/(\d)\s*[X*]\s*(\d)/g, '$1 X $2');
  t = t.replace(/\b(?:DN|NB)\s*(\d{2,3})\b|\b(\d{2,3})\s*(?:NB|DN)\b/g, (m, a, b) => { const d = DN_IN[+(a || b)]; return d ? d + ' IN' : m; });
  t = t.replace(/(\d)(MM2|MM|KV|KW|HP|VOLTS?|V|IN|NB|RPM|LB|SQMM|KG)\b/g, '$1 $2');
  t = t.replace(/\bVOLTS?\b/g, 'V');
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

/* ---------------- Extraction ---------------- */
function detectCategory(t) {
  if (/\bGASKET\b/.test(t)) return 'SPIRAL_WOUND_GASKET';
  if (/\bVALVE\b/.test(t) && /\bGATE\b/.test(t)) return 'GATE_VALVE';
  if (/\bFLANGE\b/.test(t)) return 'FLANGE';
  if (/\bBOLT\b/.test(t)) return 'HEX_BOLT';
  if (/\bBEARING\b/.test(t)) return 'BALL_BEARING';
  if (/\bMOTOR\b/.test(t)) return 'INDUCTION_MOTOR';
  if (/\bPIPE\b/.test(t)) return 'SEAMLESS_PIPE';
  if (/\bCABLE\b/.test(t)) return 'POWER_CABLE';
  if (/\bELECTRODE\b/.test(t)) return 'WELDING_ELECTRODE';
  return 'UNCLASSIFIED';
}
const num = s => { const v = parseFloat(s); return Number.isFinite(v) ? +v.toFixed(3) : undefined; };
function sizeIn(t) { const r = /(\d+(?:\.\d+)?)\s*IN\b/.exec(t); return r ? num(r[1]) : undefined; }
function pclass(t) {
  let r = /\b(?:CLASS|CL)\s*(\d{3,4})\b/.exec(t); if (r) return +r[1];
  r = /\b(\d{3,4})\s*(?:#|LB\b)/.exec(t); if (r) return +r[1];
  return undefined;
}

function extract(t) {
  const cat = detectCategory(t);
  const a = {};
  let r;
  switch (cat) {
    case 'HEX_BOLT':
      r = /\bM\s?(\d{1,2})(?:\s*X\s*(\d{2,4}))?\b/.exec(t);
      if (r) { a.diameter = +r[1]; if (r[2]) a.length = +r[2]; }
      if (a.length == null) { r = /\b(\d{2,4})\s*MM\b/.exec(t); if (r) a.length = +r[1]; }
      if (/\bSS304\b/.test(t)) a.grade = 'SS304'; else if (/\bSS316\b/.test(t)) a.grade = 'SS316'; else if (/\b8\.8\b/.test(t)) a.grade = 'GR8.8';
      r = /\b(ISO|IS|DIN)\s*(\d{3,5})\b/.exec(t); if (r) a.standard = r[1] + ' ' + r[2];
      break;
    case 'BALL_BEARING':
      r = /\b(6\d{3})\b/.exec(t); if (r) a.bearing_no = +r[1];
      r = /\b(2RS1|2RSH|2RS|2Z|ZZ)\b/.exec(t); if (r) a.seal = (r[1] === '2Z' || r[1] === 'ZZ') ? 'ZZ' : '2RS';
      r = /\bMAKE\s+([A-Z]{3,})\b/.exec(t); if (r) a.manufacturer = r[1];
      break;
    case 'GATE_VALVE':
      a.size_in = sizeIn(t); a.pressure_class = pclass(t);
      if (/\b(SS316|CF8M)\b/.test(t)) a.body_material = 'SS316'; else if (/\b(CS|WCB|A216)\b/.test(t)) a.body_material = 'CS';
      break;
    case 'FLANGE':
      a.size_in = sizeIn(t); a.pressure_class = pclass(t);
      if (/\bWN\b/.test(t)) a.flange_type = 'WN'; else if (/\bSO\b/.test(t)) a.flange_type = 'SO';
      if (/\bA\s*105\b/.test(t)) a.grade = 'A105';
      break;
    case 'INDUCTION_MOTOR':
      r = /(\d+(?:\.\d+)?)\s*KW\b/.exec(t);
      if (r) a.power_kw = num(r[1]);
      else { r = /(\d+(?:\.\d+)?)\s*HP\b/.exec(t); if (r) { const hp = num(r[1]); a.power_kw = HP_KW[hp] || +(hp * 0.746).toFixed(1); } }
      r = /\b(\d{3})\s*V\b/.exec(t); if (r) a.voltage = +r[1];
      r = /\b(\d)\s*P(?:OLE)?\b/.exec(t);
      if (r) a.poles = +r[1]; else { r = /\b(\d{3,4})\s*RPM\b/.exec(t); if (r && RPM_POLES[+r[1]]) a.poles = RPM_POLES[+r[1]]; }
      break;
    case 'SEAMLESS_PIPE':
      a.size_in = sizeIn(t);
      r = /\b(?:SCH|SCHEDULE)\s*(\d{2,3}|XS|STD)\b/.exec(t) || /\bS\s(40|80|160)\b/.exec(t); if (r) a.schedule = r[1];
      if (/\bA\s*106\s*(?:GR(?:ADE)?\s*)?B\b|\bA106B\b/.test(t)) a.grade = 'A106_GR_B';
      break;
    case 'SPIRAL_WOUND_GASKET':
      a.size_in = sizeIn(t); a.pressure_class = pclass(t);
      if (/\bSS316\b/.test(t)) a.grade = 'SS316'; else if (/\bSS304\b/.test(t)) a.grade = 'SS304';
      break;
    case 'POWER_CABLE':
      r = /(\d+)\s*C(?:ORE)?\s*(?:X\s*)?(\d+(?:\.\d+)?)\s*(?:SQ\s*MM|SQMM|MM2|SQ)\b/.exec(t);
      if (r) { a.cores = +r[1]; a.area_sqmm = num(r[2]); }
      if (/\bCU\b/.test(t)) a.conductor = 'CU'; else if (/\bAL\b/.test(t)) a.conductor = 'AL';
      r = /(\d+(?:\.\d+)?)\s*KV\b/.exec(t);
      if (r) a.voltage_kv = num(r[1]); else { r = /\b(\d{3,5})\s*V\b/.exec(t); if (r) a.voltage_kv = +(+r[1] / 1000).toFixed(2); }
      break;
    case 'WELDING_ELECTRODE':
      r = /\bE\s*(\d{4})\b/.exec(t); if (r) a.aws_class = 'E' + r[1];
      r = /\bDIA\s*(\d+(?:\.\d+)?)/.exec(t) || /(\d+(?:\.\d+)?)\s*MM\b/.exec(t);
      if (r) { let d = num(r[1]); if (d === 3.2) d = 3.15; a.dia_mm = d; }
      r = /\bAWS\s*(A5\.\d)\b/.exec(t); if (r) a.standard = 'AWS ' + r[1];
      break;
  }
  for (const k of Object.keys(a)) if (a[k] === undefined) delete a[k];
  return { category: cat, attrs: a };
}

function materialOf(cat, a) {
  const g = a.grade || a.body_material || a.conductor;
  if (!g) return undefined;
  if (/SS3/.test(g)) return 'STAINLESS_STEEL';
  if (g === 'GR8.8') return 'ALLOY_STEEL';
  if (g === 'A106_GR_B' || g === 'A105' || g === 'CS') return 'CARBON_STEEL';
  if (g === 'CU') return 'COPPER';
  if (g === 'AL') return 'ALUMINIUM';
  return undefined;
}

function fmtAttr(k, v) {
  if (v === undefined || v === null || v === '') return '';
  switch (k) {
    case 'diameter': return 'M' + v;
    case 'length': return v + ' MM';
    case 'size_in': return v + ' IN';
    case 'pressure_class': return 'CLASS ' + v;
    case 'schedule': return 'SCH ' + v;
    case 'power_kw': return v + ' KW' + (KW_HP[v] ? ' (' + KW_HP[v] + ' HP)' : '');
    case 'voltage': return v + ' V';
    case 'poles': return v + ' POLE';
    case 'cores': return v + 'C';
    case 'area_sqmm': return v + ' SQMM';
    case 'voltage_kv': return v + ' KV';
    case 'dia_mm': return v + ' MM';
    case 'grade': return v === 'GR8.8' ? 'GR 8.8' : v === 'A106_GR_B' ? 'ASTM A106 GR B' : v === 'A105' ? 'ASTM A105' : String(v);
    case 'body_material': return v + ' BODY';
    default: return String(v);
  }
}

function fingerprintLines(cat, a, unit) {
  const lines = [['CATEGORY', cat]];
  const mat = materialOf(cat, a); if (mat) lines.push(['MATERIAL', mat]);
  const crit = CATEGORIES[cat].critical;
  for (const k of crit) {
    let v = a[k];
    if (v !== undefined) {
      if (k === 'diameter') v = 'M' + v; else if (k === 'length' || k === 'dia_mm') v = v + 'MM';
      else if (k === 'size_in') v = v + 'IN'; else if (k === 'power_kw') v = v + 'KW'; else if (k === 'voltage') v = v + 'V';
      else if (k === 'voltage_kv') v = v + 'KV'; else if (k === 'area_sqmm') v = v + 'SQMM';
    }
    lines.push([k.toUpperCase(), v === undefined ? '∅ missing' : String(v)]);
  }
  if (cat === 'HEX_BOLT') lines.push(['HEAD_TYPE', 'HEX']);
  if (a.standard) lines.push(['STANDARD', a.standard]);
  if (a.manufacturer) lines.push(['MANUFACTURER', a.manufacturer]);
  lines.push(['UNIT', unit || '∅']);
  return lines;
}

function standardDescription(cat, a) {
  const f = k => (a[k] === undefined ? '?' : fmtAttr(k, a[k]));
  switch (cat) {
    case 'HEX_BOLT': return `HEXAGON HEAD BOLT ${f('diameter')} X ${a.length ?? '?'} MM ${f('grade')}`;
    case 'BALL_BEARING': return `DEEP GROOVE BALL BEARING ${a.bearing_no ?? '?'} ${a.seal ?? '?'}`;
    case 'GATE_VALVE': return `GATE VALVE ${f('size_in')} ${f('pressure_class')} ${f('body_material')} FLANGED`;
    case 'FLANGE': return `FLANGE ${a.flange_type ?? '?'} RF ${f('size_in')} ${f('pressure_class')} ${f('grade')}`;
    case 'INDUCTION_MOTOR': return `INDUCTION MOTOR ${f('power_kw')} ${f('voltage')} ${f('poles')}`;
    case 'SEAMLESS_PIPE': return `SEAMLESS PIPE ${f('size_in')} ${f('schedule')} ${f('grade')}`;
    case 'SPIRAL_WOUND_GASKET': return `SPIRAL WOUND GASKET ${f('size_in')} ${f('pressure_class')} ${f('grade')} GRAPHITE`;
    case 'POWER_CABLE': return `POWER CABLE ${a.cores ?? '?'}C X ${a.area_sqmm ?? '?'} SQMM ${a.conductor ?? '?'} ${f('voltage_kv')}`;
    case 'WELDING_ELECTRODE': return `WELDING ELECTRODE ${a.aws_class ?? '?'} ${f('dia_mm')}`;
    default: return 'UNCLASSIFIED MATERIAL';
  }
}

/* ---------------- Similarity primitives ---------------- */
function jaroWinkler(s1, s2) {
  if (s1 === s2) return 1;
  const l1 = s1.length, l2 = s2.length; if (!l1 || !l2) return 0;
  const md = Math.max(0, Math.floor(Math.max(l1, l2) / 2) - 1);
  const m1 = new Array(l1).fill(false), m2 = new Array(l2).fill(false);
  let m = 0;
  for (let i = 0; i < l1; i++) {
    const lo = Math.max(0, i - md), hi = Math.min(i + md + 1, l2);
    for (let j = lo; j < hi; j++) if (!m2[j] && s1[i] === s2[j]) { m1[i] = m2[j] = true; m++; break; }
  }
  if (!m) return 0;
  let tr = 0, k = 0;
  for (let i = 0; i < l1; i++) if (m1[i]) { while (!m2[k]) k++; if (s1[i] !== s2[k]) tr++; k++; }
  const j = (m / l1 + m / l2 + (m - tr / 2) / m) / 3;
  let p = 0; while (p < 4 && s1[p] === s2[p]) p++;
  return j + p * 0.1 * (1 - j);
}
const tokenSort = t => t.split(' ').filter(Boolean).sort().join(' ');

function buildVectors(records) {
  const docs = records.map(r => {
    const toks = r.norm.split(' ').filter(Boolean);
    const feats = [];
    for (const w of toks) {
      feats.push('w:' + w);
      const p = '#' + w + '#';
      for (let i = 0; i < p.length - 2; i++) feats.push('g:' + p.slice(i, i + 3));
    }
    for (const [k, v] of Object.entries(r.attrs)) feats.push('a:' + k + '=' + v);
    feats.push('c:' + r.category);
    return feats;
  });
  const df = new Map();
  for (const f of docs) for (const x of new Set(f)) df.set(x, (df.get(x) || 0) + 1);
  const N = docs.length;
  docs.forEach((f, i) => {
    const tf = new Map(); for (const x of f) tf.set(x, (tf.get(x) || 0) + 1);
    const v = new Map(); let n2 = 0;
    for (const [x, c] of tf) { const w = (1 + Math.log(c)) * Math.log(1 + N / (df.get(x) || 1)); v.set(x, w); n2 += w * w; }
    records[i]._vec = v; records[i]._vn = Math.sqrt(n2) || 1;
  });
}
function cosine(r1, r2) {
  let a = r1._vec, b = r2._vec; if (a.size > b.size) [a, b] = [b, a];
  let s = 0; for (const [k, w] of a) { const w2 = b.get(k); if (w2) s += w * w2; }
  return s / (r1._vn * r2._vn);
}
function stdRelation(s1, s2) {
  if (!s1 && !s2) return { score: 0.85, rel: 'none' };
  if (!s1 || !s2) return { score: 0.6, rel: 'one-missing' };
  if (s1 === s2) return { score: 1, rel: 'same' };
  if (STANDARD_GROUPS.some(g => g.includes(s1) && g.includes(s2))) return { score: 0.95, rel: 'equivalent' };
  return { score: 0.3, rel: 'different' };
}

const DEFAULT_CONFIG = {
  weights: { semantic: 25, attribute: 25, specification: 20, category: 10, unit: 10, procurement: 10 },
  thresholds: { strong: 0.95, review: 0.80, manual: 0.60 },
};

function avgUnitPrice(r) {
  if (!r.history || !r.history.length || !r.unitInfo) return null;
  let q = 0, s = 0;
  for (const h of r.history) { q += h.qty * r.unitInfo.factor; s += h.qty * h.price; }
  return q ? s / q : null;
}

function compare(r1, r2, cfg) {
  const W = cfg.weights;
  const comp = {};
  const sem = Math.min(1, cosine(r1, r2));
  comp.semantic = sem;
  const crit = CATEGORIES[r1.category].critical;
  const keys = new Set(crit);
  if (r1.attrs.manufacturer || r2.attrs.manufacturer) keys.add('manufacturer');
  const matched = [], conflicts = [], missing = [];
  let as = 0, an = 0;
  for (const k of keys) {
    const v1 = r1.attrs[k], v2 = r2.attrs[k];
    an++;
    if (v1 !== undefined && v2 !== undefined) {
      if (String(v1) === String(v2)) { as += 1; matched.push(k); }
      else if (crit.includes(k)) conflicts.push(k);
      else { as += 0.4; }
    } else if (v1 === undefined && v2 === undefined) { as += 0.5; missing.push({ k, side: 'both' }); }
    else { as += 0.5; missing.push({ k, side: v1 === undefined ? 'A' : 'B' }); }
  }
  comp.attribute = an ? as / an : 0;
  const jw = jaroWinkler(tokenSort(r1.norm), tokenSort(r2.norm));
  const sr = stdRelation(r1.attrs.standard, r2.attrs.standard);
  comp.specification = 0.55 * jw + 0.45 * sr.score;
  comp.category = r1.category === r2.category ? 1 : 0;
  let unitRel = 'invalid';
  if (r1.unitInfo && r2.unitInfo) {
    if (r1.unitInfo.raw === r2.unitInfo.raw) { comp.unit = 1; unitRel = 'same'; }
    else if (r1.unitInfo.family === r2.unitInfo.family && r1.unitInfo.factor === r2.unitInfo.factor) { comp.unit = 1; unitRel = 'equivalent'; }
    else if (r1.unitInfo.family === r2.unitInfo.family) { comp.unit = 0.8; unitRel = 'convertible'; }
    else { comp.unit = 0; unitRel = 'incompatible'; }
  } else comp.unit = 0;
  const s1 = new Set((r1.history || []).map(h => h.supplier)), s2 = new Set((r2.history || []).map(h => h.supplier));
  const inter = [...s1].filter(x => s2.has(x)).length, uni = new Set([...s1, ...s2]).size;
  const supJ = uni ? inter / uni : 0;
  const p1 = avgUnitPrice(r1), p2 = avgUnitPrice(r2);
  const priceProx = (p1 && p2 && r1.unitInfo && r2.unitInfo && r1.unitInfo.family === r2.unitInfo.family) ? Math.min(p1, p2) / Math.max(p1, p2) : 0.5;
  comp.procurement = 0.3 * supJ + 0.7 * priceProx;
  const wsum = Object.values(W).reduce((x, y) => x + y, 0) || 1;
  let score = (comp.semantic * W.semantic + comp.attribute * W.attribute + comp.specification * W.specification +
    comp.category * W.category + comp.unit * W.unit + comp.procurement * W.procurement) / wsum;
  score = Math.max(0, Math.min(1, score));
  let cls;
  const critMissing = missing.filter(m => crit.includes(m.k));
  if (r1.category !== r2.category) cls = 'NON_MATCH';
  else if (conflicts.length === 1) cls = 'VARIANT';
  else if (conflicts.length > 1) cls = 'RELATED';
  else if (critMissing.length) cls = 'REQUIRES_REVIEW';
  else if (unitRel === 'incompatible' || unitRel === 'invalid') cls = 'REQUIRES_REVIEW';
  else if (tokenSort(r1.norm) === tokenSort(r2.norm) && (unitRel === 'same' || unitRel === 'equivalent')) cls = 'EXACT_MATCH';
  else if (score >= cfg.thresholds.strong) cls = 'NEAR_DUPLICATE';
  else cls = 'FUNCTIONALLY_EQUIVALENT';
  return { a: r1.id, b: r2.id, comp, score, cls, matched, conflicts, missing, jw, stdRel: sr.rel, unitRel, supJ, priceProx, sem };
}

function band(score, th) {
  if (score >= th.strong) return 'STRONG';
  if (score >= th.review) return 'REVIEW';
  if (score >= th.manual) return 'INVESTIGATE';
  return 'NO_MATCH';
}

/* Human-readable, evidence-backed explanation (template generator over computed features). */
function explain(p, r1, r2) {
  const crit = CATEGORIES[r1.category].critical;
  const reasons = [], differences = [], blocked = [];
  if (r1.category === r2.category) reasons.push(`Same category: ${CATEGORIES[r1.category].label.toLowerCase()}`);
  for (const k of p.matched) reasons.push(`Same ${ATTR_LABELS[k].toLowerCase()}: ${fmtAttr(k, r1.attrs[k])}`);
  if (p.stdRel === 'equivalent') reasons.push(`Equivalent standard: ${r1.attrs.standard} ≡ ${r2.attrs.standard} (rule R-07)`);
  if (p.stdRel === 'same') reasons.push(`Same standard: ${r1.attrs.standard}`);
  if (p.unitRel === 'same') reasons.push(`Same unit: ${r1.unitInfo.raw}`);
  if (p.unitRel === 'equivalent') reasons.push(`Equivalent unit: ${r1.unitInfo.raw} ≡ ${r2.unitInfo.raw}`);
  if (p.unitRel === 'convertible') differences.push(`Unit conversion needed: ${r1.unitInfo.raw} → ${r2.unitInfo.raw}`);
  if (p.unitRel === 'incompatible') differences.push(`Units cannot be converted: ${r1.unitInfo.raw} vs ${r2.unitInfo.raw} (rule R-08)`);
  if (p.unitRel === 'invalid') differences.push(`Unrecognised unit of measure on ${!r1.unitInfo ? 'Material A' : 'Material B'}`);
  reasons.push(`Semantic similarity: ${Math.round(p.sem * 100)}%`);
  for (const k of p.conflicts) blocked.push(`${ATTR_LABELS[k]} differs: ${fmtAttr(k, r1.attrs[k])} vs ${fmtAttr(k, r2.attrs[k])}`);
  for (const m of p.missing) {
    if (m.side === 'both') continue;
    const lbl = ATTR_LABELS[m.k].toLowerCase();
    differences.push(`${ATTR_LABELS[m.k]} not specified in Material ${m.side}` + (crit.includes(m.k) ? ' (critical: needs a reviewer)' : ''));
    void lbl;
  }
  if (p.stdRel === 'one-missing') differences.push(`Standard stated only on Material ${r1.attrs.standard ? 'A' : 'B'}`);
  if (p.supJ > 0) reasons.push(`Shared suppliers: ${Math.round(p.supJ * 100)}% overlap`);

  const what = r1.category !== 'UNCLASSIFIED' ? standardDescription(r1.category, r1.attrs) : 'an unclassified item';
  let narrative;
  if (blocked.length) {
    narrative = `The two records look alike in wording (${Math.round(p.sem * 100)}% semantic similarity) but they are not the same material. ` +
      `${blocked.join('; ')}. Rule R-01 blocks this merge regardless of text or procurement similarity, so each record keeps its own national identity.`;
  } else if (p.cls === 'REQUIRES_REVIEW') {
    narrative = `Every attribute that both records state agrees, but the evidence is incomplete: ${differences.join('; ').toLowerCase()}. ` +
      `The engine will not merge on missing information (rule R-10); a material expert should confirm before mapping.`;
  } else {
    narrative = `Both records describe the same material: ${what}. All ${crit.length} critical attributes agree after normalization` +
      (p.matched.some(k => ['power_kw', 'size_in', 'seal', 'dia_mm', 'body_material'].includes(k)) ? ', including values that were stated in different conventions and reconciled by domain rules' : '') +
      `. Wording differs only in ${p.jw > 0.9 ? 'minor formatting' : 'abbreviations, ordering and unit notation'}.`;
  }
  return { reasons, differences, blocked, narrative };
}

/* ---------------- Synthetic data generation ---------------- */
const SUPPLIERS = {
  HEX_BOLT: ['Deccan Fasteners (syn)', 'Konkan Industrial Supply (syn)', 'Vindhya Bolts & Nuts (syn)'],
  BALL_BEARING: ['Narmada Bearings (syn)', 'Kaveri Bearing Co (syn)', 'Konkan Industrial Supply (syn)'],
  GATE_VALVE: ['Godavari Valves (syn)', 'Sahyadri Flow Control (syn)', 'Konkan Industrial Supply (syn)'],
  FLANGE: ['Tapi Forgings (syn)', 'Godavari Valves (syn)', 'Vindhya Bolts & Nuts (syn)'],
  INDUCTION_MOTOR: ['Satpura Motors (syn)', 'Nilgiri Electricals (syn)'],
  SEAMLESS_PIPE: ['Tapi Pipes & Tubes (syn)', 'Mahanadi Steel Traders (syn)'],
  SPIRAL_WOUND_GASKET: ['Sahyadri Sealing (syn)', 'Konkan Industrial Supply (syn)'],
  POWER_CABLE: ['Ganga Cables (syn)', 'Nilgiri Electricals (syn)'],
  WELDING_ELECTRODE: ['Mahanadi Welding (syn)', 'Konkan Industrial Supply (syn)'],
  UNCLASSIFIED: ['Local vendor (syn)'],
};
const UNITS_BY_STYLE = { count: ['EA', 'NOS', 'PCS', 'NO', 'EA'], length: ['M', 'MTR', 'M', 'RM', 'KM'], mass: ['KG', 'KG', 'KG', 'PKT', 'KGS'] };
const CAT_FAMILY = { HEX_BOLT: 'count', BALL_BEARING: 'count', GATE_VALVE: 'count', FLANGE: 'count', INDUCTION_MOTOR: 'count', SPIRAL_WOUND_GASKET: 'count', SEAMLESS_PIPE: 'length', POWER_CABLE: 'length', WELDING_ELECTRODE: 'mass' };

const G_TXT = {
  SS304: ['SS304', 'STAINLESS STEEL 304', 'SS304', 'SS 304', 'S.S.304'],
  SS316: ['SS316', 'STAINLESS STEEL 316', 'SS316', 'SS 316', 'S.S.316'],
  'GR8.8': ['GR 8.8', 'HIGH TENSILE GR 8.8', 'HT 8.8', 'GR.8.8', 'CL 8.8'],
};
const BODY_TXT = { CS: ['CS', 'WCB BODY', 'A216 WCB', 'CARBON STEEL', 'CS'], SS316: ['SS316', 'CF8M BODY', 'A351 CF8M', 'STAINLESS STEEL 316', 'SS316'] };
const SIZE_TXT = (s, st) => { const dn = IN_DN[s]; return [`${s}"`, `DN${dn}`, `${dn}NB`, `${s} INCH`, `${s}IN`][st]; };
const CLASS_TXT = (c, st) => [`CL${c}`, `CLASS ${c}`, `${c}#`, `${c} LB`, `CL ${c}`][st];
const FT_TXT = { WN: ['WN RF', 'WELD NECK', 'WNRF', 'WELDNECK', 'W/N'], SO: ['SO RF', 'SLIP ON', 'SORF', 'SLIPON', 'S/O'] };
const SEAL_TXT = { '2RS': ['2RS', '2RS1', '2RS', '2RSH', '2RS'], ZZ: ['ZZ', '2Z', 'ZZ', 'ZZ', '2Z'] };
const SCH_TXT = sc => [`SCH${sc}`, `SCH ${sc}`, `SCH.${sc}`, `SCH ${sc}`, `S-${sc}`];
const COND_TXT = { CU: ['CU', 'COPPER', 'CU', 'COPPER', 'CU'], AL: ['AL', 'ALUMINIUM', 'AL', 'ALUMINIUM', 'AL'] };

function describe(cat, a, st, R) {
  switch (cat) {
    case 'HEX_BOLT': {
      const g = G_TXT[a.grade][st], d = a.diameter, l = a.length;
      return [
        `HEX BOLT M${d}X${l} ${g}`,
        `HEXAGONAL HEAD BOLT M${d} x ${l} ${g}` + (R() < 0.4 ? ' IS 1364' : ''),
        `${g} HEX HEAD BOLT M${d} ${l}MM`,
        `BOLT HEX HEAD M${d}*${l} ${g}` + (R() < 0.35 ? ' DIN 931' : ''),
        `BOLT,HEX,M${d} X ${l}MM,${g},ISO 4014`,
      ][st];
    }
    case 'BALL_BEARING': {
      const n = a.bearing_no, s = SEAL_TXT[a.seal][st];
      return [`BRG ${n} ${s}`, `BALL BEARING ${n}-${s}` + (R() < 0.5 ? ' MAKE KAVERI' : ''), `DEEP GROOVE BALL BEARING ${n} ${s}`, `BEARING NO ${n} ${s}`, `BALL BRG ${n} ${s}`][st];
    }
    case 'GATE_VALVE': {
      const sz = SIZE_TXT(a.size_in, st), c = CLASS_TXT(a.pressure_class, st), b = BODY_TXT[a.body_material][st];
      return [`GATE VALVE ${sz} ${c} ${b} FLGD`, `VALVE GATE ${sz} ${c} ${b}`, `GV ${sz} ${c} ${b}`, `GATE VALVE ${sz} ${c} ${b} FLANGED`, `VALVE,GATE,${sz},${c},${b},RF`][st];
    }
    case 'FLANGE': {
      const s = a.size_in, dn = IN_DN[s], c = a.pressure_class, t = FT_TXT[a.flange_type][st];
      return [`FLANGE ${t} ${s}" CL${c} A105`, `${t} FLANGE DN${dn} CLASS ${c} ASTM A105`, `FLG ${t} ${s}IN ${c}# A105`, `FLANGE,${t},${dn}NB,${c} LB,A105`, `FLANGE ${t} ${s} INCH CL ${c} CS A105`][st];
    }
    case 'INDUCTION_MOTOR': {
      const hp = a._hp, kw = a.power_kw, v = a.voltage, p = a.poles;
      const rpm = (p === 2 ? ['2880RPM', '3000 RPM', '2900 RPM'] : ['1440RPM', '1500 RPM', '1450 RPM'])[Math.floor(R() * 3)];
      const ph = v === 230 ? '1PH' : '3PH';
      return [`MOTOR ${ph} ${hp}HP ${v}V ${rpm}`, `INDUCTION MOTOR ${kw} KW ${v} V ${p} POLE TEFC`, `MTR IND SQ CAGE ${hp} HP ${v}V ${p}P`, `ELECTRIC MOTOR ${kw}KW ${v}VOLT ${rpm}`, `MOTOR,INDUCTION,${hp}HP ${kw}KW,${v}V,${p} POLE`][st];
    }
    case 'SEAMLESS_PIPE': {
      const s = a.size_in, dn = IN_DN[s], sc = SCH_TXT(a.schedule)[st];
      return [`PIPE SMLS ${s}" ${sc} A106 GR B`, `SEAMLESS PIPE NB${dn} ${sc} ASTM A106 GR.B`, `CS SMLS PIPE ${s} IN ${sc} A106B`, `PIPE,SEAMLESS,${dn}NB,${sc},ASTM A 106 GRADE B`, `PIPE CS SEAMLESS ${s}INCH ${sc} A106-B`][st];
    }
    case 'SPIRAL_WOUND_GASKET': {
      const s = a.size_in, dn = IN_DN[s], c = a.pressure_class;
      return [`GASKET SPW ${s}" CL${c} SS316/GRAPHITE`, `SPIRAL WOUND GASKET DN${dn} CLASS ${c} SS 316 GRAFOIL`, `GSKT SPIRAL WOUND ${s}IN ${c}# SS316`, `GASKET,SPIRAL WOUND,${dn}NB,${c} LB,SS316 GRAPHITE`, `SW GASKET ${s} INCH CL ${c} SS316 FILLER GRAPHITE`][st];
    }
    case 'POWER_CABLE': {
      const c = a.cores, ar = a.area_sqmm === 4 && R() < 0.3 ? '4.0' : a.area_sqmm, cd = COND_TXT[a.conductor][st];
      return [`CABLE ${c}C X ${ar} SQMM ${cd} ARMD 1.1KV`, `POWER CABLE ${c} CORE ${ar} SQ.MM ${cd} XLPE 1.1 KV`, `CABLE ${cd} ${c}CX${ar}MM2 1100V`, `ARMOURED CABLE ${c}C*${ar} SQMM ${cd} 1.1KV`, `CABLE,PVC,${c}CORE X ${ar}SQ MM,${cd},1.1 KV`][st];
    }
    case 'WELDING_ELECTRODE': {
      const e = a.aws_class, d = a.dia_mm, d2 = d === 3.15 ? '3.2' : d === 4 ? '4.0' : d;
      return [`ELECTRODE ${e} ${d}MM`, `WELDING ELECTRODE AWS E ${e.slice(1)} DIA ${d2} MM`, `${e} ELECTRODE DIA ${d}`, `ELECTRODE WELDING LOW HYDROGEN E-${e.slice(1)} ${d} MM`, `ELECTRODE,${e},${d2}MM,AWS A5.1`][st];
    }
  }
  return 'UNKNOWN';
}

function describeIncomplete(cat, a, st, R) {
  const lazy = {
    HEX_BOLT: () => [[`HEX BOLT M${a.diameter} ${G_TXT[a.grade][0]}`, ['length']], [`BOLT HEX M${a.diameter}X${a.length}`, ['grade']], [`HEX HD BOLT M${a.diameter} X ${a.length} SS`, ['grade']]],
    BALL_BEARING: () => [[`BEARING ${a.bearing_no}`, ['seal']], [`BALL BRG ${a.bearing_no} SEALED`, ['seal']]],
    GATE_VALVE: () => [[`GATE VALVE ${a.size_in}" ${BODY_TXT[a.body_material][0]}`, ['pressure_class']]],
    FLANGE: () => [[`FLANGE ${a.size_in}" CL${a.pressure_class} A105`, ['flange_type']]],
    INDUCTION_MOTOR: () => [[`MOTOR ${a._hp}HP ${a.voltage}V`, ['poles']]],
    SEAMLESS_PIPE: () => [[`PIPE SMLS ${a.size_in}" A106 GR B`, ['schedule']]],
    SPIRAL_WOUND_GASKET: () => [[`GASKET SPIRAL WOUND ${a.size_in}" SS316`, ['pressure_class']]],
    POWER_CABLE: () => [[`CABLE ${a.cores}C X ${a.area_sqmm} SQMM 1.1KV`, ['conductor']]],
    WELDING_ELECTRODE: () => [[`ELECTRODE ${a.aws_class}`, ['dia_mm']]],
  }[cat];
  const opts = lazy();
  const o = opts[Math.floor(R() * opts.length)];
  return { desc: o[0], omitted: o[1] };
}

function basePrice(cat, a) {
  switch (cat) {
    case 'HEX_BOLT': return (a.diameter * a.diameter * a.length) / 1000 * ({ SS304: 1.6, SS316: 2.4, 'GR8.8': 0.7 }[a.grade]) + 8;
    case 'BALL_BEARING': return ({ 6205: 1250, 6206: 1500, 6305: 1700, 6308: 2600, 6310: 3900 }[a.bearing_no]) * (a.seal === 'ZZ' ? 0.9 : 1);
    case 'GATE_VALVE': return ({ 2: 9000, 4: 24000, 6: 52000 }[a.size_in]) * (a.pressure_class === 300 ? 1.6 : 1) * (a.body_material === 'SS316' ? 2.8 : 1);
    case 'FLANGE': return ({ 2: 900, 4: 2400, 6: 4800 }[a.size_in]) * (a.pressure_class === 300 ? 1.5 : 1) * (a.flange_type === 'SO' ? 0.85 : 1);
    case 'INDUCTION_MOTOR': return a.power_kw * 4200 * (a.poles === 2 ? 1.05 : 1) * (a.voltage === 230 ? 1.1 : 1);
    case 'SEAMLESS_PIPE': return ({ 2: 900, 4: 2100, 6: 3800, 8: 5600 }[a.size_in]) * (a.schedule === '80' ? 1.4 : 1);
    case 'SPIRAL_WOUND_GASKET': return ({ 2: 350, 4: 780, 6: 1400 }[a.size_in]) * (a.pressure_class === 300 ? 1.3 : 1);
    case 'POWER_CABLE': return a.cores * a.area_sqmm * (a.conductor === 'CU' ? 95 : 35) + 40;
    case 'WELDING_ELECTRODE': return a.aws_class === 'E7018' ? 210 : 150;
  }
  return 500;
}
const QTY_RANGE = { HEX_BOLT: [200, 3000], BALL_BEARING: [50, 900], GATE_VALVE: [5, 80], FLANGE: [10, 200], INDUCTION_MOTOR: [2, 30], SEAMLESS_PIPE: [100, 3000], SPIRAL_WOUND_GASKET: [20, 400], POWER_CABLE: [500, 10000], WELDING_ELECTRODE: [100, 2000], UNCLASSIFIED: [1, 50] };

const DEMO_BOLT_KEY = 'HEX_BOLT|diameter=16|length=50|grade=SS304';
const DEMO_BEARING_KEY = 'BALL_BEARING|bearing_no=6205|seal=2RS';

function generate(seed) {
  const R = rng(seed || 2026);
  const ri = (lo, hi) => lo + Math.floor(R() * (hi - lo + 1));
  const items = [];
  const add = (cat, a) => items.push({ id: 'T' + String(items.length + 1).padStart(3, '0'), cat, a });
  for (const d of [10, 12, 16, 20]) for (const l of [40, 50, 75, 100]) for (const g of ['SS304', 'SS316', 'GR8.8']) add('HEX_BOLT', { diameter: d, length: l, grade: g });
  for (const n of [6205, 6206, 6305, 6308, 6310]) for (const s of ['2RS', 'ZZ']) add('BALL_BEARING', { bearing_no: n, seal: s });
  for (const s of [2, 4, 6]) for (const c of [150, 300]) for (const b of ['CS', 'SS316']) add('GATE_VALVE', { size_in: s, pressure_class: c, body_material: b });
  for (const s of [2, 4, 6]) for (const c of [150, 300]) for (const t of ['WN', 'SO']) add('FLANGE', { size_in: s, pressure_class: c, flange_type: t, grade: 'A105' });
  [[5, 415, 4], [5, 230, 4], [10, 415, 4], [10, 230, 4], [10, 415, 2], [20, 415, 4], [50, 415, 4]].forEach(([hp, v, p]) => add('INDUCTION_MOTOR', { power_kw: HP_KW[hp], voltage: v, poles: p, _hp: hp }));
  for (const s of [2, 4, 6, 8]) for (const sc of ['40', '80']) add('SEAMLESS_PIPE', { size_in: s, schedule: sc, grade: 'A106_GR_B' });
  for (const s of [2, 4, 6]) for (const c of [150, 300]) add('SPIRAL_WOUND_GASKET', { size_in: s, pressure_class: c, grade: 'SS316' });
  [[3, 2.5, 'CU'], [3, 4, 'CU'], [3, 16, 'CU'], [4, 2.5, 'CU'], [4, 4, 'CU'], [4, 16, 'CU'], [3, 16, 'AL'], [4, 16, 'AL']].forEach(([c, a, cd]) => add('POWER_CABLE', { cores: c, area_sqmm: a, conductor: cd, voltage_kv: 1.1 }));
  for (const e of ['E7018', 'E6013']) for (const d of [2.5, 3.15, 4]) add('WELDING_ELECTRODE', { aws_class: e, dia_mm: d });

  const used = new Set();
  const counters = { A: {}, B: 10000, C: 400000, D: 20000, E: 1000 };
  const nextCode = (ci, cat) => {
    const c = CPSES[ci].id; let code;
    do {
      if (c === 'A') { const p = CATEGORIES[cat].prefix; counters.A[p] = (counters.A[p] || 10000) + ri(3, 40); code = `${p}-${counters.A[p]}`; }
      else if (c === 'B') { counters.B += ri(7, 400); code = `MAT-${counters.B}`; }
      else if (c === 'C') { counters.C += ri(11, 900); code = String(counters.C); }
      else if (c === 'D') { counters.D += ri(5, 90); code = `FM-${counters.D}`; }
      else { counters.E += ri(3, 60); code = `HE/${CATEGORIES[cat].short}/${String(counters.E).padStart(5, '0')}`; }
    } while (used.has(c + code));
    used.add(c + code); return code;
  };
  const records = [];
  const pushRec = (ci, item, desc, opts) => {
    opts = opts || {};
    const cat = item ? item.cat : 'UNCLASSIFIED';
    const fam = CAT_FAMILY[cat] || 'count';
    const unit = opts.unit !== undefined ? opts.unit : UNITS_BY_STYLE[fam][ci];
    const code = opts.code || nextCode(ci, cat);
    if (opts.code) used.add(CPSES[ci].id + opts.code);
    const sup = SUPPLIERS[cat];
    const pref = sup[(ci + (item ? +item.id.slice(1) : 0)) % sup.length];
    let history = [];
    if (opts.history) history = opts.history;
    else {
      const base = item ? basePrice(cat, item.a) : ri(200, 4000);
      const mult = 0.88 + R() * 0.3;
      const [qlo, qhi] = QTY_RANGE[cat];
      const n = ri(1, 4);
      for (let i = 0; i < n; i++) {
        let qty = ri(qlo, qhi), price = base * mult * (0.96 + R() * 0.08);
        const f = unit === 'KM' ? 1000 : unit === 'PKT' ? 5 : 1;
        if (unit === 'KM') qty = Math.max(1, Math.round(qty / 1000 * 10) / 10);
        if (unit === 'PKT') qty = Math.max(1, Math.round(qty / 5));
        price = price * f;
        history.push({ year: ri(2023, 2026), qty, price: Math.round(price * 100) / 100, supplier: R() < 0.7 ? pref : sup[ri(0, sup.length - 1)] });
      }
      history.sort((x, y) => x.year - y.year);
    }
    const truthAttrs = {};
    if (item) for (const [k, v] of Object.entries(item.a)) if (k[0] !== '_') truthAttrs[k] = v;
    records.push({
      id: 'r' + (records.length + 1), cpse: CPSES[ci].id, code, desc, unit, plant: `${CPSES[ci].short}-PL${ri(1, 3)}`,
      history, truth: item ? item.id : 'N' + records.length, truthCat: cat, truthAttrs, omitted: opts.omitted || [], source: 'Synthetic seed dataset', ingestedAt: '2026-09-02T09:30:00Z',
    });
  };

  for (const item of items) {
    const key = item.cat + '|' + CATEGORIES[item.cat].critical.map(k => k + '=' + item.a[k]).join('|');
    if (key === DEMO_BOLT_KEY) {
      pushRec(0, item, 'HEX BOLT M16X50 SS304', { code: 'BOLT-10021' });
      pushRec(1, item, 'HEXAGONAL HEAD BOLT M16 x 50 STAINLESS STEEL 304', { code: 'MAT-98231' });
      pushRec(2, item, 'SS304 HEX HEAD BOLT M16 50MM', { code: '772819' });
      pushRec(3, item, 'BOLT HEX HEAD M16*50 SS 304', { code: 'FM-22109' });
      pushRec(4, item, 'BOLT,HEX,M16,S.S.304', { code: 'HE/BLT/04412', omitted: ['length'], history: [{ year: 2025, qty: 1200, price: 29.1, supplier: 'Deccan Fasteners (syn)' }, { year: 2026, qty: 900, price: 29.6, supplier: 'Vindhya Bolts & Nuts (syn)' }] });
      continue;
    }
    if (key === DEMO_BEARING_KEY) {
      pushRec(0, item, 'BRG 6205 2RS', { history: [{ year: 2025, qty: 500, price: 1200, supplier: 'Narmada Bearings (syn)' }] });
      pushRec(1, item, 'BALL BEARING 6205-2RS1 MAKE KAVERI', { history: [{ year: 2025, qty: 800, price: 1350, supplier: 'Kaveri Bearing Co (syn)' }] });
      pushRec(2, item, 'DEEP GROOVE BALL BEARING 6205 2RS', { history: [{ year: 2026, qty: 700, price: 1180, supplier: 'Narmada Bearings (syn)' }] });
      continue;
    }
    const roll = R();
    const k = roll < 0.05 ? 1 : roll < 0.13 ? 2 : roll < 0.33 ? 3 : roll < 0.63 ? 4 : 5;
    const deck = [0, 1, 2, 3, 4];
    for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    const order = deck.slice(0, k).sort((x, y) => x - y);
    for (const ci of order) {
      const copies = R() < 0.18 ? 2 : 1;
      for (let c = 0; c < copies; c++) {
        if (R() < 0.065) {
          const inc = describeIncomplete(item.cat, item.a, ci, R);
          pushRec(ci, item, inc.desc, { omitted: inc.omitted });
        } else {
          const st = R() < 0.18 ? ri(0, 4) : ci;
          pushRec(ci, item, describe(item.cat, item.a, st, R));
        }
      }
    }
  }
  // Noise: unclassifiable descriptions
  [[2, 'SPARES FOR PUMP AS PER DRG NO 1123'], [3, 'MISC CONSUMABLES'], [1, 'ITEM AS PER SAMPLE'], [0, 'GREASE EP2 18KG BUCKET'], [4, 'FILTER ELEMENT HYD'], [3, 'SPARE KIT FOR CONVEYOR']]
    .forEach(([ci, d]) => pushRec(ci, null, d));
  // Data-quality defects
  const pickRec = (pred) => records.filter(pred);
  const bolts = pickRec(r => r.truthCat === 'HEX_BOLT' && r.cpse === 'C' && !r.omitted.length && r.code !== '772819');
  if (bolts[3]) bolts[3].unit = 'NUM';
  const valves = pickRec(r => r.truthCat === 'GATE_VALVE' && r.cpse === 'E');
  if (valves[1]) valves[1].unit = '';
  const dRecs = pickRec(r => r.cpse === 'D' && r.code !== 'FM-22109' && r.truthCat !== 'UNCLASSIFIED');
  if (dRecs[5] && dRecs[40]) dRecs[40].code = dRecs[5].code;
  if (dRecs[12] && dRecs[61]) dRecs[61].code = dRecs[12].code;
  const fl = pickRec(r => r.truthCat === 'FLANGE' && r.cpse === 'B');
  if (fl[2]) fl[2].history.forEach(h => { h.price = Math.round(h.price * 8); });
  const mt = pickRec(r => r.truthCat === 'INDUCTION_MOTOR' && r.cpse === 'A');
  if (mt[0]) mt[0].history.forEach(h => { h.price = Math.round(h.price * 6); });
  return { records, items };
}

/* ---------------- CSV / JSON ingestion ---------------- */
function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += ch;
    } else if (ch === '"' && f === '') q = true;
    else if (ch === ',') { row.push(f); f = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += ch;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}
const REQUIRED_COLS = ['cpse', 'code', 'description', 'unit'];
function ingest(text, filename, existing) {
  const report = { file: filename, accepted: [], rejected: [], warnings: [], missingColumns: [], duplicateUpload: false, totalRows: 0 };
  let objs = [];
  const isJSON = /\.json$/i.test(filename) || /^\s*[\[{]/.test(text);
  if (isJSON) {
    let data;
    try { data = JSON.parse(text); } catch (e) { report.rejected.push({ line: 0, raw: '', reason: 'File is not valid JSON: ' + e.message }); return report; }
    if (!Array.isArray(data)) data = data.materials || data.records || [];
    objs = data.map((o, i) => ({ line: i + 1, raw: JSON.stringify(o).slice(0, 140), o: Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toLowerCase().trim(), v])) }));
    const cols = new Set(objs.flatMap(x => Object.keys(x.o)));
    report.missingColumns = REQUIRED_COLS.filter(c => !cols.has(c) && !(c === 'description' && cols.has('desc')));
  } else {
    const rows = parseCSV(text);
    if (!rows.length) { report.rejected.push({ line: 0, raw: '', reason: 'File is empty.' }); return report; }
    const header = rows[0].map(h => h.trim().toLowerCase());
    report.missingColumns = REQUIRED_COLS.filter(c => !header.includes(c) && !(c === 'description' && header.includes('desc')));
    rows.slice(1).forEach((r, i) => {
      if (r.length !== header.length) { report.rejected.push({ line: i + 2, raw: r.join(','), reason: `Expected ${header.length} columns, found ${r.length}.` }); return; }
      objs.push({ line: i + 2, raw: r.join(','), o: Object.fromEntries(header.map((h, j) => [h, r[j]])) });
    });
  }
  if (report.missingColumns.length) { report.rejected.push({ line: 1, raw: '', reason: 'Missing required column(s): ' + report.missingColumns.join(', ') + '. No rows were ingested.' }); report.totalRows = objs.length; return report; }
  report.totalRows = objs.length + report.rejected.length;
  const existingKeys = new Set(existing.map(r => r.cpse + '|' + r.code + '|' + normalize(r.desc)));
  let n = existing.length;
  for (const { line, raw, o } of objs) {
    const desc = String(o.description ?? o.desc ?? '').trim();
    const cpse = String(o.cpse ?? '').trim().toUpperCase();
    const cp = CPSES.find(c => c.id === cpse || c.short === cpse);
    if (!cp) { report.rejected.push({ line, raw, reason: `Unknown CPSE "${cpse}". Use A–E or PETRO, POWER, STEEL, MINES, HVENG.` }); continue; }
    if (!desc) { report.rejected.push({ line, raw, reason: 'Description is empty.' }); continue; }
    const code = String(o.code ?? '').trim();
    if (!code) { report.rejected.push({ line, raw, reason: 'Legacy material code is empty.' }); continue; }
    const key = cp.id + '|' + code + '|' + normalize(desc);
    if (existingKeys.has(key)) { report.warnings.push({ line, raw, reason: 'Already ingested (same CPSE, code and description). Kept the existing record.' }); continue; }
    existingKeys.add(key);
    const price = parseFloat(o.price), qty = parseFloat(o.qty);
    const hist = Number.isFinite(price) && Number.isFinite(qty) ? [{ year: +(o.year || 2026), qty, price, supplier: String(o.supplier || 'Not stated') }] : [];
    if (!hist.length) report.warnings.push({ line, raw, reason: 'No price or quantity: procurement context will be neutral for this record.' });
    n++;
    report.accepted.push({ id: 'u' + n + '_' + (hashStr(key) % 9999), cpse: cp.id, code, desc, unit: String(o.unit ?? '').trim(), plant: String(o.plant || cp.short + '-UPLOAD'), history: hist, truth: 'U' + hashStr(key), truthCat: null, truthAttrs: {}, omitted: [], source: 'Upload: ' + filename, ingestedAt: new Date().toISOString() });
  }
  return report;
}

/* ---------------- Pipeline ---------------- */
function run(rawRecords, config) {
  const cfg = config || DEFAULT_CONFIG;
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const records = rawRecords.map(r => {
    const norm = normalize(r.desc);
    const { category, attrs } = extract(norm);
    const crit = CATEGORIES[category].critical;
    const missing = crit.filter(k => attrs[k] === undefined);
    const unitInfo = canonUnit(r.unit);
    const complete = category !== 'UNCLASSIFIED' && !missing.length;
    const fpKey = complete ? category + '|' + crit.map(k => k + '=' + attrs[k]).join('|') : null;
    return Object.assign({}, r, { norm, category, attrs, missing, unitInfo, complete, fpKey, quality: [], material: materialOf(category, attrs) });
  });
  const byId = new Map(records.map(r => [r.id, r]));
  // quality checks
  const codeCount = new Map();
  for (const r of records) { const k = r.cpse + '|' + r.code; codeCount.set(k, (codeCount.get(k) || 0) + 1); }
  for (const r of records) {
    if (r.category === 'UNCLASSIFIED') r.quality.push({ type: 'UNCLASSIFIED', msg: 'Description does not identify a material category. Marked as insufficient information.' });
    else if (r.missing.length) r.quality.push({ type: 'MISSING_ATTR', msg: 'Missing critical attribute: ' + r.missing.map(k => ATTR_LABELS[k].toLowerCase()).join(', ') });
    if (!r.unitInfo) r.quality.push({ type: 'INVALID_UNIT', msg: r.unit ? `Unit "${r.unit}" is not in the unit dictionary.` : 'Unit of measure is blank.' });
    if (codeCount.get(r.cpse + '|' + r.code) > 1) r.quality.push({ type: 'DUP_CODE', msg: `Legacy code ${r.code} is used by more than one record in this CPSE.` });
  }
  buildVectors(records);
  // blocking + candidate generation
  const pairs = []; const pairIndex = new Map();
  const cats = new Map();
  for (const r of records) { if (r.category === 'UNCLASSIFIED') continue; if (!cats.has(r.category)) cats.set(r.category, []); cats.get(r.category).push(r); }
  const blocks = [];
  const seen = new Set();
  const doPair = (x, y) => {
    if (x.id === y.id) return;
    const [p, q] = x.id < y.id ? [x, y] : [y, x];
    const key = p.id + '|' + q.id; if (seen.has(key)) return; seen.add(key);
    const c = compare(p, q, cfg); pairIndex.set(key, pairs.length); pairs.push(c);
  };
  for (const [cat, list] of cats) {
    const bk = CATEGORIES[cat].block;
    const groups = new Map(); const star = [];
    for (const r of list) { const v = bk ? r.attrs[bk] : 'all'; if (v === undefined) star.push(r); else { if (!groups.has(v)) groups.set(v, []); groups.get(v).push(r); } }
    for (const [v, g] of groups) { blocks.push({ cat, key: bk ? bk + '=' + v : 'all', size: g.length }); for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) doPair(g[i], g[j]); }
    for (const s of star) for (const r of list) doPair(s, r);
  }
  const pairOf = (a, b) => { const k = a < b ? a + '|' + b : b + '|' + a; const i = pairIndex.get(k); return i === undefined ? null : pairs[i]; };
  // clustering: complete records grouped by fingerprint (critical-attribute identity, rule R-01)
  const cmap = new Map();
  for (const r of records) if (r.complete) { if (!cmap.has(r.fpKey)) cmap.set(r.fpKey, []); cmap.get(r.fpKey).push(r); }
  const clusters = [];
  for (const [key, members] of cmap) {
    members.sort((x, y) => x.cpse.localeCompare(y.cpse) || x.code.localeCompare(y.code));
    const cat = members[0].category;
    const crit = CATEGORIES[cat].critical;
    const attrs = {}; const lineage = {};
    for (const k of crit) { attrs[k] = members[0].attrs[k]; lineage[k] = members.map(m => m.id); }
    for (const k of ['standard', 'manufacturer']) {
      const vals = members.filter(m => m.attrs[k]).map(m => m.attrs[k]);
      if (vals.length) {
        const cnt = {}; vals.forEach(v => cnt[v] = (cnt[v] || 0) + 1);
        const best = Object.entries(cnt).sort((x, y) => y[1] - x[1])[0][0];
        attrs[k] = best; lineage[k] = members.filter(m => m.attrs[k] === best).map(m => m.id);
      }
    }
    const scores = []; const clsCount = {};
    for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) {
      const p = pairOf(members[i].id, members[j].id); if (p) { scores.push(p.score); clsCount[p.cls] = (clsCount[p.cls] || 0) + 1; }
    }
    const conf = scores.length ? scores.reduce((x, y) => x + y, 0) / scores.length : null;
    const cpses = [...new Set(members.map(m => m.cpse))];
    const families = new Set(members.map(m => m.unitInfo ? m.unitInfo.family : 'invalid'));
    const intra = members.length - cpses.length;
    clusters.push({
      key, category: cat, attrs, lineage, members: members.map(m => m.id), cpses, conf, minScore: scores.length ? Math.min(...scores) : null,
      band: conf === null ? 'SINGLE' : band(conf, cfg.thresholds), clsCount, stdDesc: standardDescription(cat, attrs), material: materialOf(cat, attrs),
      unitIssue: families.size > 1, intraDup: intra, attachments: [],
    });
  }
  clusters.sort((x, y) => (x.key === DEMO_BOLT_KEY ? -1 : y.key === DEMO_BOLT_KEY ? 1 : 0) || CAT_ORDER.indexOf(x.category) - CAT_ORDER.indexOf(y.category) || x.key.localeCompare(y.key, undefined, { numeric: true }));
  const clusterByKey = new Map(clusters.map(c => [c.key, c]));
  for (const c of clusters) for (const id of c.members) byId.get(id).clusterKey = c.key;
  for (const c of clusters) if (c.intraDup > 0) {
    const seenC = new Set();
    for (const id of c.members) { const r = byId.get(id); if (seenC.has(r.cpse)) r.quality.push({ type: 'INTRA_DUP', msg: 'Another record in the same CPSE describes the same material (internal duplicate).' }); seenC.add(r.cpse); }
  }
  // attach suggestions for incomplete records
  const attachments = [];
  for (const r of records) {
    if (r.complete || r.category === 'UNCLASSIFIED') continue;
    const cand = new Map();
    for (const p of pairs) {
      if (p.a !== r.id && p.b !== r.id) continue;
      if (p.cls !== 'REQUIRES_REVIEW') continue;
      const other = byId.get(p.a === r.id ? p.b : p.a);
      if (!other.complete) continue;
      const prev = cand.get(other.fpKey) || { clusterKey: other.fpKey, sum: 0, n: 0, best: -1, viaId: null };
      prev.sum += p.score; prev.n++;
      if (p.score > prev.best) { prev.best = p.score; prev.viaId = other.id; }
      cand.set(other.fpKey, prev);
    }
    const list = [...cand.values()].map(c => ({ clusterKey: c.clusterKey, score: c.sum / c.n, best: c.best, viaId: c.viaId })).sort((x, y) => y.score - x.score).slice(0, 5);
    if (list.length) {
      const best = list[0];
      const c = clusterByKey.get(best.clusterKey);
      const a = { recordId: r.id, clusterKey: c.key, score: best.score, band: band(best.score, cfg.thresholds), viaId: best.viaId, missing: r.missing, candidates: list, margin: list.length > 1 ? best.score - list[1].score : 1 };
      attachments.push(a); c.attachments.push(r.id); r.suggestedCluster = c.key;
    }
  }
  // price outliers + unit issues at cluster level
  for (const c of clusters) {
    const ps = c.members.map(id => ({ id, p: avgUnitPrice(byId.get(id)) })).filter(x => x.p);
    if (ps.length >= 3) {
      const sorted = ps.map(x => x.p).sort((a, b) => a - b); const med = sorted[Math.floor(sorted.length / 2)];
      for (const x of ps) if (x.p > med * 3) byId.get(x.id).quality.push({ type: 'PRICE_OUTLIER', msg: `Average unit price is ${(x.p / med).toFixed(1)}× the cluster median. Check unit or price entry.` });
    }
    if (c.unitIssue) for (const id of c.members) { const r = byId.get(id); if (r.unitInfo && r.unitInfo.family === 'pack') r.quality.push({ type: 'UNIT_MISMATCH', msg: 'Unit PKT cannot be converted to the cluster unit without a pack size.' }); }
  }
  // blocked merges
  const variants = pairs.filter(p => p.cls === 'VARIANT').sort((x, y) => y.score - x.score);
  // procurement
  const procurement = [];
  for (const c of clusters) {
    if (c.cpses.length < 2) continue;
    const per = {}; let fam = null;
    const famCount = {}; c.members.forEach(id => { const r = byId.get(id); if (r.unitInfo) famCount[r.unitInfo.family] = (famCount[r.unitInfo.family] || 0) + 1; });
    fam = Object.entries(famCount).sort((a, b) => b[1] - a[1])[0]?.[0];
    let excluded = 0;
    for (const id of c.members) {
      const r = byId.get(id);
      if (!r.unitInfo || r.unitInfo.family !== fam || !r.history.length) { excluded++; continue; }
      const o = per[r.cpse] || (per[r.cpse] = { cpse: r.cpse, qty: 0, spend: 0, pos: 0, suppliers: new Set() });
      for (const h of r.history) { o.qty += h.qty * r.unitInfo.factor; o.spend += h.qty * h.price; o.pos++; o.suppliers.add(h.supplier); }
    }
    const rows = Object.values(per).map(o => ({ cpse: o.cpse, qty: o.qty, spend: o.spend, pos: o.pos, price: o.spend / o.qty, suppliers: [...o.suppliers] }));
    if (rows.length < 2) continue;
    const prices = rows.map(r => r.price);
    const supAll = new Map(); rows.forEach(r => r.suppliers.forEach(s => supAll.set(s, (supAll.get(s) || 0) + 1)));
    const shared = [...supAll.values()].filter(v => v > 1).length;
    procurement.push({
      clusterKey: c.key, unit: FAMILY_CANON[fam], rows: rows.sort((a, b) => a.cpse.localeCompare(b.cpse)), cpseCount: rows.length,
      demand: rows.reduce((s, r) => s + r.qty, 0), spend: rows.reduce((s, r) => s + r.spend, 0), pos: rows.reduce((s, r) => s + r.pos, 0),
      priceMin: Math.min(...prices), priceMax: Math.max(...prices), spread: (Math.max(...prices) - Math.min(...prices)) / Math.min(...prices),
      supplierOverlap: supAll.size ? shared / supAll.size : 0, suppliers: [...supAll.keys()], excluded,
    });
  }
  const maxSpend = Math.max(1, ...procurement.map(p => p.spend));
  for (const p of procurement) {
    p.score = 0.35 * Math.log10(1 + p.spend) / Math.log10(1 + maxSpend) + 0.25 * (p.cpseCount / 5) + 0.2 * Math.min(1, p.spread / 0.3) + 0.1 * p.supplierOverlap + 0.1 * Math.min(1, p.pos / 12);
    p.outlier = p.spread > 1.5;
  }
  procurement.sort((a, b) => (b.clusterKey === DEMO_BEARING_KEY) - (a.clusterKey === DEMO_BEARING_KEY) || b.score - a.score);
  // evaluation against synthetic ground truth
  const ev = evaluate(records, clusters, variants, byId);
  const N = records.length;
  const stats = {
    records: N, naivePairs: N * (N - 1) / 2, compared: pairs.length, blocks: blocks.length,
    attributesExtracted: records.reduce((s, r) => s + Object.keys(r.attrs).length, 0),
    clusters: clusters.length, multiClusters: clusters.filter(c => c.members.length > 1).length,
    crossCpseClusters: clusters.filter(c => c.cpses.length > 1).length,
    duplicatesDetected: clusters.reduce((s, c) => s + c.members.length - 1, 0),
    cls: pairs.reduce((o, p) => (o[p.cls] = (o[p.cls] || 0) + 1, o), {}),
    incomplete: records.filter(r => !r.complete && r.category !== 'UNCLASSIFIED').length,
    unclassified: records.filter(r => r.category === 'UNCLASSIFIED').length,
    ms: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0),
  };
  return { records, byId, pairs, pairOf, clusters, clusterByKey, attachments, variants, procurement, stats, eval: ev, config: cfg };
}

function evaluate(records, clusters, variants, byId) {
  const truthGroups = new Map();
  for (const r of records) { if (!truthGroups.has(r.truth)) truthGroups.set(r.truth, 0); truthGroups.set(r.truth, truthGroups.get(r.truth) + 1); }
  let truthPairs = 0; for (const n of truthGroups.values()) truthPairs += n * (n - 1) / 2;
  let pred = 0, tp = 0;
  for (const c of clusters) {
    const m = c.members.map(id => byId.get(id));
    for (let i = 0; i < m.length; i++) for (let j = i + 1; j < m.length; j++) { pred++; if (m[i].truth === m[j].truth) tp++; }
  }
  const N = records.length, totalPairs = N * (N - 1) / 2;
  const fp = pred - tp, fn = truthPairs - tp, neg = totalPairs - truthPairs;
  const precision = pred ? tp / pred : 1, recall = truthPairs ? tp / truthPairs : 1;
  const f1 = precision + recall ? 2 * precision * recall / (precision + recall) : 0;
  let attrTotal = 0, attrOk = 0, catTotal = 0, catOk = 0;
  for (const r of records) {
    if (!r.truthCat) continue;
    catTotal++; if (r.category === r.truthCat) catOk++;
    if (r.truthCat === 'UNCLASSIFIED') continue;
    for (const [k, v] of Object.entries(r.truthAttrs)) {
      if (r.omitted.includes(k)) continue;
      attrTotal++; if (String(r.attrs[k]) === String(v)) attrOk++;
    }
  }
  const prevented = variants.filter(p => byId.get(p.a).truth !== byId.get(p.b).truth).length;
  return { tp, fp, fn, pred, truthPairs, precision, recall, f1, fpr: neg ? fp / neg : 0, fnr: truthPairs ? fn / truthPairs : 0, attrAcc: attrTotal ? attrOk / attrTotal : 1, attrTotal, catAcc: catTotal ? catOk / catTotal : 1, prevented, variantPairs: variants.length };
}

root.NUMMF = {
  rng, hashStr, CPSES, CPSE_BY_ID, CATEGORIES, CAT_ORDER, ATTR_LABELS, DOMAIN_RULES, ABBREVIATIONS, UNIT_TABLE, DEFAULT_CONFIG,
  normalize, extract, detectCategory, fmtAttr, fingerprintLines, standardDescription, compare, explain, band, generate, ingest, run,
  avgUnitPrice, materialOf, KW_HP, DEMO_BOLT_KEY, DEMO_BEARING_KEY,
};
})(typeof window !== 'undefined' ? window : globalThis);
