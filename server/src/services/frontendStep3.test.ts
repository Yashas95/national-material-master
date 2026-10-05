import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs';
import { createApp } from '../app';
import { Server } from 'http';

// Load js/api.js dynamically as used by browser
const apiPath = path.resolve(__dirname, '../../../js/api.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const API = require(apiPath);

describe('Step 3 Verification: Real Match Review & AI Explanations Integration', () => {
  let server: Server;
  let baseUrl: string;

  const recordA = {
    id: 'step3-rec-1',
    cpseId: 'A',
    code: 'BLT-001',
    rawDesc: 'HEX BOLT M16 X 50 MM SS304 ISO 4014',
    normDesc: 'HEX BOLT M16X50 SS304 ISO 4014',
    category: 'HEX_BOLT',
    attrs: { diameter: 16, length: 50, grade: 'SS304', standard: 'ISO 4014' },
    unitInfo: { raw: 'EA', canon: 'EA', family: 'count', factor: 1 },
    history: [{ price: 28.5, qty: 1000, supplier: 'Standard Fasteners' }],
  };

  const recordB_Equiv = {
    id: 'step3-rec-2',
    cpseId: 'B',
    code: 'MAT-771',
    rawDesc: 'HEXAGON HEAD BOLT M16X50 DIN 931 GRADE 304',
    normDesc: 'HEXAGON HEAD BOLT M16X50 SS304 DIN 931',
    category: 'HEX_BOLT',
    attrs: { diameter: 16, length: 50, grade: 'SS304', standard: 'DIN 931' },
    unitInfo: { raw: 'NOS', canon: 'EA', family: 'count', factor: 1 },
    history: [{ price: 30.0, qty: 800, supplier: 'Standard Fasteners' }],
  };

  const recordC_Conflict = {
    id: 'step3-rec-3',
    cpseId: 'C',
    code: 'B-SS-16-50-316',
    rawDesc: 'HEX BOLT M16X50 MM GRADE 316',
    normDesc: 'HEX BOLT M16X50 SS316',
    category: 'HEX_BOLT',
    attrs: { diameter: 16, length: 50, grade: 'SS316', standard: 'ISO 4014' },
    unitInfo: { raw: 'EA', canon: 'EA', family: 'count', factor: 1 },
  };

  before(async () => {
    const app = createApp();
    server = app.listen(0);
    const address = server.address() as any;
    baseUrl = `http://127.0.0.1:${address.port}/api/v1`;

    API.configure({
      baseUrl,
      timeoutMs: 12000,
    });
  });

  after(() => {
    if (server) server.close();
  });

  /* ---------------- 1. AI Explanation Synthesis ---------------- */
  describe('1. AI Explanation Synthesis (API.getAiExplanation)', () => {
    it('synthesizes auditor-grade explanation for equivalent records citing standard equivalence', async () => {
      const resp = await API.getAiExplanation(recordA, recordB_Equiv);
      assert.ok(resp);
      const data = resp.data || resp;
      assert.ok(data.score >= 0.75);
      assert.equal(data.auditorVerdict, 'APPROVED_FOR_MERGE');
      assert.equal(data.blocked.length, 0);

      // Verifies narrative
      assert.ok(data.narrative && data.narrative.length > 20);
      assert.ok(
        data.technicalRationale.includes('VERIFIED EQUIVALENT') ||
        data.reasons.some((r: string) => r.includes('DIN 931 ≡ ISO 4014') || r.includes('Standard'))
      );
    });

    it('blocks deceptive conflict pair with Rule R-01 veto and MERGE_PROHIBITED verdict', async () => {
      const resp = await API.getAiExplanation(recordA, recordC_Conflict);
      assert.ok(resp);
      const data = resp.data || resp;
      assert.equal(data.auditorVerdict, 'MERGE_PROHIBITED');
      assert.ok(data.blocked.length > 0);
      assert.ok(data.blocked.some((b: string) => b.includes('SS304 vs SS316') || b.includes('grade')));
      assert.ok(data.technicalRationale.includes('BLOCKED by Rule R-01'));
    });
  });

  /* ---------------- 2. Approval Lifecycle & Separation of Duties ---------------- */
  describe('2. Approval Lifecycle & Two-Eye Principle (API.approveDecision)', () => {
    it('executes two-level approval workflow enforcing Separation of Duties', async () => {
      // Step 2.1: Material Expert performs Level 1 approval with forceL2
      await API.switchPersona('MATERIAL_EXPERT', 'A');
      const clusterId = 'step3-cluster-001';

      const l1Result = await API.approveDecision(clusterId, 'CLUSTER', 'First-level review confirmed against plant drawings', true);
      assert.ok(l1Result);
      assert.ok(l1Result.data);
      assert.equal(l1Result.data.success, true);
      assert.equal(l1Result.data.status, 'AWAITING_L2');

      // Same persona cannot approve Level 2
      let blocked = false;
      try {
        await API.approveDecision(clusterId, 'CLUSTER', 'Attempted duplicate approval');
      } catch (err: any) {
        blocked = true;
        assert.ok(err.message.includes('Forbidden') || err.message.includes('Separation of duties'));
      }
      assert.ok(blocked, 'Same user must be blocked from second approval');

      // Step 2.2: Switch to Super Admin and complete approval
      await API.switchPersona('SUPER_ADMIN');
      const l2Result = await API.approveDecision(clusterId, 'CLUSTER', 'Second-level governance sign-off completed');
      assert.ok(l2Result.data.success);
      assert.equal(l2Result.data.status, 'APPROVED');
    });
  });

  /* ---------------- 3. Description Modification & Version Increment ---------------- */
  describe('3. Material Modification & Version Increment (API.modifyDecision)', () => {
    it('modifies standard description, increments version and logs audit rationale', async () => {
      await API.switchPersona('SUPER_ADMIN');
      const clusterId = 'step3-cluster-mod';

      // Approve initial baseline
      await API.approveDecision(clusterId, 'CLUSTER', 'Initial approval');

      // Modify description
      const updatedDesc = 'HEXAGON HEAD BOLT M16 X 50 MM GRADE 304 STAINLESS STEEL';
      const modResult = await API.modifyDecision(
        clusterId,
        'CLUSTER',
        updatedDesc,
        'Updated to include full expanded nomenclature per technical committee mandate'
      );

      assert.ok(modResult);
      assert.ok(modResult.data);
      assert.equal(modResult.data.success, true);
      assert.equal(modResult.data.standardDescription, updatedDesc);
      assert.ok(modResult.data.version >= 2, 'Version must increment to v2 or higher');
    });
  });

  /* ---------------- 4. Rejection & Code Retirement ---------------- */
  describe('4. Recommendation Rejection & Retirement (API.rejectDecision)', () => {
    it('rejects invalid recommendation and permanently retires material code', async () => {
      await API.switchPersona('SUPER_ADMIN');
      const clusterId = 'step3-cluster-reject';

      const rejectResult = await API.rejectDecision(
        clusterId,
        'CLUSTER',
        'Duplicate candidate created in error; non-standard legacy vendor prefix'
      );

      assert.ok(rejectResult);
      assert.ok(rejectResult.data);
      assert.equal(rejectResult.data.success, true);
      assert.equal(rejectResult.data.status, 'REJECTED');
      assert.ok(rejectResult.data.retired);
    });
  });

  /* ---------------- 5. Escalation & Reopening ---------------- */
  describe('5. Escalation and Reopening Workflows', () => {
    it('escalates recommendation for domain expert investigation via API.escalateDecision', async () => {
      await API.switchPersona('CPSE_ADMIN', 'A');
      const clusterId = 'step3-cluster-escalate';

      const escResult = await API.escalateDecision(
        clusterId,
        'CLUSTER',
        'Drawing missing flange face finish specification, requires metallurgical lab test'
      );

      assert.ok(escResult);
      assert.ok(escResult.data);
      assert.equal(escResult.data.success, true);
      assert.equal(escResult.data.status, 'ESCALATED');
    });

    it('reopens existing decision via API.reopenDecision returning status to PENDING', async () => {
      await API.switchPersona('SUPER_ADMIN');
      const clusterId = 'step3-cluster-escalate';

      const reopenResult = await API.reopenDecision(clusterId, 'CLUSTER', 'Reopening with fresh drawing from plant');
      assert.ok(reopenResult);
      assert.ok(reopenResult.data);
      assert.equal(reopenResult.data.success, true);
      assert.equal(reopenResult.data.status, 'PENDING');
    });
  });

  /* ---------------- 6. Frontend Codebase File Invariants ---------------- */
  describe('6. Frontend Codebase File Invariants', () => {
    it('js/api.js exposes all six decision and explanation endpoints', () => {
      const apiJsPath = path.resolve(__dirname, '../../../js/api.js');
      const apiJs = fs.readFileSync(apiJsPath, 'utf8');

      assert.ok(apiJs.includes('getAiExplanation('), 'api.js must provide getAiExplanation()');
      assert.ok(apiJs.includes('approveDecision('), 'api.js must provide approveDecision()');
      assert.ok(apiJs.includes('modifyDecision('), 'api.js must provide modifyDecision()');
      assert.ok(apiJs.includes('rejectDecision('), 'api.js must provide rejectDecision()');
      assert.ok(apiJs.includes('escalateDecision('), 'api.js must provide escalateDecision()');
      assert.ok(apiJs.includes('reopenDecision('), 'api.js must provide reopenDecision()');
    });

    it('js/app.js implements fetchGeminiExplanation and connects to compare panel', () => {
      const appJsPath = path.resolve(__dirname, '../../../js/app.js');
      const appJs = fs.readFileSync(appJsPath, 'utf8');

      assert.ok(appJs.includes('function fetchGeminiExplanation('), 'app.js must define fetchGeminiExplanation()');
      assert.ok(appJs.includes('data-act="fetch-gemini-explain"'), 'app.js comparePanel must have fetch-gemini-explain button');
      assert.ok(appJs.includes('case \'fetch-gemini-explain\':'), 'app.js click listener must handle fetch-gemini-explain');
    });

    it('js/app.js syncs all decisions to backend and displays live decision engine pill', () => {
      const appJsPath = path.resolve(__dirname, '../../../js/app.js');
      const appJs = fs.readFileSync(appJsPath, 'utf8');

      assert.ok(appJs.includes('function syncDecisionToBackend('), 'app.js must define syncDecisionToBackend()');
      assert.ok(appJs.includes('Live AI Decision Engine'), 'app.js pageReview must display Live AI Decision Engine indicator');
      assert.ok(appJs.includes('api.approveDecision'), 'syncDecisionToBackend must invoke api.approveDecision');
      assert.ok(appJs.includes('api.rejectDecision'), 'syncDecisionToBackend must invoke api.rejectDecision');
      assert.ok(appJs.includes('api.modifyDecision'), 'syncDecisionToBackend must invoke api.modifyDecision');
      assert.ok(appJs.includes('api.escalateDecision'), 'syncDecisionToBackend must invoke api.escalateDecision');
      assert.ok(appJs.includes('api.reopenDecision'), 'syncDecisionToBackend must invoke api.reopenDecision');
    });
  });
});
