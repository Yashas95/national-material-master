import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DecisionService } from './decisionService';
import { AuthService } from './authService';
import { MatchableRecord } from './matchingService';
import { createApp } from '../app';
import { Server } from 'http';

describe('DecisionService & Explainability Workflow', () => {
  beforeEach(() => {
    DecisionService.clearStore();
  });

  const recordA: MatchableRecord = {
    id: 'rec_a1',
    cpseId: 'A',
    code: 'BOLT-101',
    rawDesc: 'BOLT HEX M16 X 50 MM SS304 DIN 931',
    normDesc: 'BOLT HEX M16 X 50 MM SS304 DIN 931',
    category: 'HEX_BOLT',
    attrs: { diameter: 16, length: 50, grade: 'SS304', standard: 'DIN 931' },
    unitInfo: { raw: 'EA', canon: 'EA', family: 'count', factor: 1 },
    history: [{ price: 28.5, qty: 1000, supplier: 'Standard Fasteners' }],
  };

  const recordB_Equiv: MatchableRecord = {
    id: 'rec_b1',
    cpseId: 'B',
    code: 'B-7781',
    rawDesc: 'HEXAGON HEAD BOLT M16X50 SS304 ISO 4014',
    normDesc: 'HEXAGON HEAD BOLT M16X50 SS304 ISO 4014',
    category: 'HEX_BOLT',
    attrs: { diameter: 16, length: 50, grade: 'SS304', standard: 'ISO 4014' },
    unitInfo: { raw: 'NOS', canon: 'EA', family: 'count', factor: 1 },
    history: [{ price: 30.0, qty: 800, supplier: 'Standard Fasteners' }],
  };

  const recordC_Conflict: MatchableRecord = {
    id: 'rec_c1',
    cpseId: 'C',
    code: 'STL-900',
    rawDesc: 'HEX BOLT M16 X 50 SS316 ISO 4014',
    normDesc: 'HEX BOLT M16 X 50 SS316 ISO 4014',
    category: 'HEX_BOLT',
    attrs: { diameter: 16, length: 50, grade: 'SS316', standard: 'ISO 4014' },
    unitInfo: { raw: 'EA', canon: 'EA', family: 'count', factor: 1 },
  };

  const recordD_Incomplete: MatchableRecord = {
    id: 'rec_d1',
    cpseId: 'D',
    code: 'MNE-303',
    rawDesc: 'HEX BOLT M16 SS304',
    normDesc: 'HEX BOLT M16 SS304',
    category: 'HEX_BOLT',
    attrs: { diameter: 16, grade: 'SS304' },
    unitInfo: { raw: 'EA', canon: 'EA', family: 'count', factor: 1 },
  };

  it('generates auditor-grade explanation for equivalent material records', async () => {
    const explanation = await DecisionService.explainComparison(recordA, recordB_Equiv);

    assert.ok(explanation.score >= 0.85);
    assert.equal(explanation.auditorVerdict, 'APPROVED_FOR_MERGE');
    assert.equal(explanation.blocked.length, 0);

    // Verifies Rule R-07 ISO vs DIN standard equivalence
    const hasStdEquiv = explanation.reasons.some(r => r.includes('DIN 931 ≡ ISO 4014'));
    assert.ok(hasStdEquiv, 'Must document international standard equivalence DIN 931 ≡ ISO 4014');

    // Verifies narrative
    assert.ok(explanation.narrative.length > 30);
    assert.ok(explanation.narrative.includes('HEXAGON HEAD BOLT M16 X 50 MM SS304'));
  });

  it('blocks merge and documents Rule R-01 conflict in explanation (SS304 vs SS316)', async () => {
    const explanation = await DecisionService.explainComparison(recordA, recordC_Conflict);

    assert.equal(explanation.auditorVerdict, 'MERGE_PROHIBITED');
    assert.ok(explanation.blocked.some(b => b.includes('SS304 vs SS316')));
    assert.ok(
      explanation.narrative.toLowerCase().includes('rule r-01') || explanation.narrative.toLowerCase().includes('incompatible') || explanation.technicalRationale.includes('Rule R-01'),
      'Must document Rule R-01 conflict veto'
    );
  });

  it('routes incomplete record comparison to expert review under Rule R-10', async () => {
    const explanation = await DecisionService.explainComparison(recordA, recordD_Incomplete);

    assert.equal(explanation.auditorVerdict, 'REQUIRES_EXPERT_REVIEW');
    assert.ok(explanation.differences.some(d => d.includes('length missing')));
    assert.ok(
      explanation.narrative.includes('Rule R-10') || explanation.narrative.includes('expert'),
      'Must explain incomplete attribute review requirement'
    );
  });

  it('approves direct recommendation and updates version state', async () => {
    const { user } = AuthService.loginAsRole('MATERIAL_EXPERT');
    const result = await DecisionService.approve('cluster-1', 'CLUSTER', user, 'Approved based on PO and drawing.');

    assert.equal(result.success, true);
    assert.equal(result.status, 'APPROVED');
    assert.equal(result.version, 1);

    const stored = DecisionService.getCluster('cluster-1');
    assert.equal(stored.status, 'APPROVED');
    assert.equal(stored.approvedBy, user.name);
  });

  it('enforces two-level approval (L1 -> L2) with separation of duties', async () => {
    const { user: reviewerL1 } = AuthService.loginAsRole('MATERIAL_EXPERT');
    const { user: reviewerL2 } = AuthService.loginAsRole('SUPER_ADMIN');

    // Step 1: L1 Reviewer submits first approval
    const step1 = await DecisionService.approve('cluster-l2', 'CLUSTER', reviewerL1, 'L1 recommendation ok', {
      forceL2: true,
    });
    assert.equal(step1.status, 'AWAITING_L2');

    // Step 2: Attempting second approval with non-L2 role must fail
    await assert.rejects(
      async () => {
        await DecisionService.approve('cluster-l2', 'CLUSTER', reviewerL1, 'L2 approval try');
      },
      /Second-level approval requires Super Administrator privileges/
    );

    // Step 3: Separation of duties violation (same person cannot do both)
    const samePersonAdmin = { ...reviewerL2, name: reviewerL1.name };
    await assert.rejects(
      async () => {
        await DecisionService.approve('cluster-l2', 'CLUSTER', samePersonAdmin, 'Second approval');
      },
      /Separation of duties violation/
    );

    // Step 4: Legitimate distinct Super Admin gives second approval
    const step2 = await DecisionService.approve('cluster-l2', 'CLUSTER', reviewerL2, 'Final approval granted');
    assert.equal(step2.status, 'APPROVED');

    const stored = DecisionService.getCluster('cluster-l2');
    assert.equal(stored.status, 'APPROVED');
    assert.equal(stored.approvedBy, reviewerL2.name);
  });

  it('modifies standard description and tracks version history', async () => {
    const { user } = AuthService.loginAsRole('MATERIAL_EXPERT');

    // Initial approval
    await DecisionService.approve('cluster-mod', 'CLUSTER', user);

    // Modify
    const updated = await DecisionService.modify(
      'cluster-mod',
      'HEXAGON HEAD BOLT M16 X 50 MM SS304 GRADE 2',
      'Harmonized to include grade revision number',
      user
    );

    assert.equal(updated.version, 2);
    assert.equal(updated.status, 'APPROVED');

    const stored = DecisionService.getCluster('cluster-mod');
    assert.equal(stored.stdDesc, 'HEXAGON HEAD BOLT M16 X 50 MM SS304 GRADE 2');
    assert.equal(stored.versions.length, 2);
    assert.equal(stored.versions[1].version, 2);
  });

  it('rejects recommendation and retires the national code permanently', async () => {
    const { user } = AuthService.loginAsRole('MATERIAL_EXPERT');

    const cluster = DecisionService.getCluster('cluster-rej');
    const nmcCode = cluster.nmcCode!;

    const result = await DecisionService.reject(
      'cluster-rej',
      'CLUSTER',
      'Obsolete non-standard item, duplicate of existing plant stock',
      user
    );

    assert.equal(result.status, 'REJECTED');
    assert.ok(DecisionService.isCodeRetired(nmcCode), 'NMC code must be permanently retired');
  });

  it('escalates and reopens decisions', async () => {
    const { user } = AuthService.loginAsRole('MATERIAL_EXPERT');

    const esc = await DecisionService.escalate('cluster-esc', 'CLUSTER', 'Requires metallurgy committee review', user);
    assert.equal(esc.status, 'ESCALATED');

    const reop = await DecisionService.reopen('cluster-esc', 'CLUSTER', user);
    assert.equal(reop.status, 'PENDING');
  });

  it('handles HTTP explain and decision endpoints with JWT authentication', async () => {
    const app = createApp();
    const server: Server = app.listen(0);
    const port = (server.address() as any).port;

    try {
      const { accessToken: expertToken } = AuthService.loginAsRole('MATERIAL_EXPERT');

      // Test 1: POST /api/v1/decisions/explain
      const explainRes = await fetch(`http://127.0.0.1:${port}/api/v1/decisions/explain`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${expertToken}`,
        },
        body: JSON.stringify({
          recordA,
          recordB: recordB_Equiv,
        }),
      });

      assert.equal(explainRes.status, 200);
      const explainData = await explainRes.json();
      assert.equal(explainData.status, 'success');
      assert.equal(explainData.data.auditorVerdict, 'APPROVED_FOR_MERGE');

      // Test 2: POST /api/v1/decisions/approve
      const approveRes = await fetch(`http://127.0.0.1:${port}/api/v1/decisions/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${expertToken}`,
        },
        body: JSON.stringify({
          targetId: 'http-cluster-1',
          type: 'CLUSTER',
          note: 'HTTP test approval',
        }),
      });

      assert.equal(approveRes.status, 200);
      const approveData = await approveRes.json();
      assert.equal(approveData.status, 'success');
      assert.equal(approveData.data.status, 'APPROVED');

      // Test 3: Unauthorized VIEWER blocked from approving
      const { accessToken: viewerToken } = AuthService.loginAsRole('VIEWER');
      const forbiddenRes = await fetch(`http://127.0.0.1:${port}/api/v1/decisions/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${viewerToken}`,
        },
        body: JSON.stringify({
          targetId: 'http-cluster-2',
          type: 'CLUSTER',
        }),
      });

      assert.equal(forbiddenRes.status, 403);
    } finally {
      server.close();
    }
  });
});
