// Run with: node test/pipeline.test.js
const assert = require('assert');
require('../js/pipeline.js');
const N = globalThis.NUMMF;

const res = N.run(N.generate(2026).records);
const demo = res.clusterByKey.get(N.DEMO_BOLT_KEY);

// Demo cluster: four CPSE descriptions of the same bolt become one national material
assert.strictEqual(demo.stdDesc, 'HEXAGON HEAD BOLT M16 X 50 MM SS304');
assert.deepStrictEqual(demo.members.map(id => res.byId.get(id).code).sort(), ['772819', 'BOLT-10021', 'FM-22109', 'MAT-98231']);

// Safety: critical-attribute conflicts are never merged
for (const c of res.clusters) {
  const ms = c.members.map(id => res.byId.get(id));
  for (const k of N.CATEGORIES[c.category].critical) assert.ok(ms.every(m => m.attrs[k] === ms[0].attrs[k]), `conflict on ${k} in ${c.key}`);
}
const ss = N.compare(...[N.DEMO_BOLT_KEY, 'HEX_BOLT|diameter=16|length=50|grade=SS316'].map(k => res.byId.get(res.clusterByKey.get(k).members[0])), N.DEFAULT_CONFIG);
assert.strictEqual(ss.cls, 'VARIANT');

// Domain rules
assert.strictEqual(N.extract(N.normalize('MOTOR 3PH 10HP 415V 1440RPM')).attrs.power_kw, 7.5);
assert.strictEqual(N.extract(N.normalize('GATE VALVE DN100 CLASS 150 CF8M BODY')).attrs.size_in, 4);
assert.strictEqual(N.extract(N.normalize('GATE VALVE DN100 CLASS 150 CF8M BODY')).attrs.body_material, 'SS316');
assert.strictEqual(N.extract(N.normalize('BALL BEARING 6205-2RS1')).attrs.seal, '2RS');

// Procurement example
const brg = res.procurement.find(p => p.clusterKey === N.DEMO_BEARING_KEY);
assert.deepStrictEqual(brg.rows.map(r => [r.cpse, r.price, r.qty]), [['A', 1200, 500], ['B', 1350, 800], ['C', 1180, 700]]);

// Evaluation against synthetic ground truth
assert.strictEqual(res.eval.fp, 0);
console.log(`ok  ${res.stats.records} records, ${res.stats.clusters} clusters, precision ${(res.eval.precision * 100).toFixed(1)}%, recall ${(res.eval.recall * 100).toFixed(1)}%, ${res.stats.ms} ms`);
