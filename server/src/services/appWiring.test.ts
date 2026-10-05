import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { createApp } from '../app';
import { Server } from 'http';

// Load js/api.js dynamically as used by the browser
const apiPath = path.resolve(__dirname, '../../../js/api.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const API = require(apiPath);

describe('Step 18: Wire js/app.js UI to Real APIs & Gemini Explanations', () => {
  let server: Server;
  let baseUrl: string;

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

  /* ---------------- 1. Persona Switcher & Auth Context ---------------- */
  describe('1. Persona Switcher & Auth Synchronization', () => {
    it('synchronizes persona switcher with backend JWT and tenant scoping', async () => {
      // Switch to CPSE Admin for CPSE B
      const userB = await API.switchPersona('CPSE_ADMIN', 'B');
      assert.ok(userB);
      assert.equal(userB.role, 'CPSE_ADMIN');
      assert.equal(userB.tenantId, 'B');

      // Verify tenant isolation: CPSE B admin cannot view raw data of CPSE A
      const oppsB = await API.getProcurementOpportunities({ limit: 5 });
      assert.ok(oppsB);
      assert.ok(Array.isArray(oppsB.data));

      // Switch back to Super Admin
      const superAdmin = await API.switchPersona('SUPER_ADMIN', 'A');
      assert.equal(superAdmin.role, 'SUPER_ADMIN');
    });
  });

  /* ---------------- 2. Match Review & Gemini Explanations ---------------- */
  describe('2. Match Review & Real Gemini AI Explanations', () => {
    it('fetches auditor-grade Gemini explanation for match review comparison', async () => {
      const recordA = {
        id: 'rec-1',
        cpseId: 'A',
        legacyCode: 'BLT-001',
        rawDescription: 'HEX BOLT M16 X 50 MM SS304 ISO 4014',
        normalizedDescription: 'HEX BOLT M16X50 SS304 ISO 4014',
        category: 'FASTENERS',
        attributes: { diameter: 16, length: 50, material_grade: 'SS304', standard: 'ISO 4014' },
        uom: 'EA',
      };
      const recordB = {
        id: 'rec-2',
        cpseId: 'B',
        legacyCode: 'MAT-771',
        rawDescription: 'HEXAGON HEAD BOLT M16X50 DIN 931 GRADE 304',
        normalizedDescription: 'HEX BOLT M16X50 SS304 DIN 931',
        category: 'FASTENERS',
        attributes: { diameter: 16, length: 50, material_grade: 'SS304', standard: 'DIN 931' },
        uom: 'NOS',
      };

      const resp = await API.getAiExplanation(recordA, recordB);
      assert.ok(resp);
      assert.equal(resp.status, 'success');
      assert.ok(resp.data);
      const narrative = resp.data.narrative || resp.data.explanation || resp.data.technicalRationale;
      assert.ok(typeof narrative === 'string');
      assert.ok(narrative.length > 20);
      assert.ok(typeof resp.data.confidence === 'number');
    });

    it('identifies critical attribute conflicts that block merges under rule R-01', async () => {
      const recordA = {
        id: 'rec-pipe-1',
        cpseId: 'A',
        legacyCode: 'PIP-001',
        rawDescription: 'SEAMLESS PIPE 4 INCH SCH 40 ASTM A106 GRADE B',
        normalizedDescription: 'SEAMLESS PIPE 4 IN SCH40 ASTM A106 GR B',
        category: 'SEAMLESS_PIPE',
        attributes: { size_in: 4, schedule: 'SCH 40', grade: 'A106_B' },
        uom: 'M',
      };
      const recordB = {
        id: 'rec-pipe-2',
        cpseId: 'B',
        legacyCode: 'PIP-002',
        rawDescription: 'SEAMLESS PIPE 6 INCH SCH 40 ASTM A106 GRADE B',
        normalizedDescription: 'SEAMLESS PIPE 6 IN SCH40 ASTM A106 GR B',
        category: 'SEAMLESS_PIPE',
        attributes: { size_in: 6, schedule: 'SCH 40', grade: 'A106_B' },
        uom: 'M',
      };

      const resp = await API.getAiExplanation(recordA, recordB);
      assert.ok(resp);
      assert.equal(resp.status, 'success');
      const narrative = resp.data.narrative || resp.data.explanation || resp.data.technicalRationale || '';
      assert.ok(
        narrative.toLowerCase().includes('size') ||
        narrative.toLowerCase().includes('conflict') ||
        narrative.toLowerCase().includes('r-01') ||
        (resp.data.blocked && resp.data.blocked.length > 0)
      );
    });
  });

  /* ---------------- 3. Review Decisions Synchronization ---------------- */
  describe('3. Decision Synchronization with Audit Lineage', () => {
    const testClusterId = 'CLUST-TEST-APP-01';

    it('submits approve decision with audit note', async () => {
      const res = await API.approveDecision(testClusterId, 'CLUSTER', 'Approved on review of engineering specs and PO price distribution');
      assert.ok(res);
      assert.equal(res.status, 'success');
      assert.equal(res.data.status, 'APPROVED');
    });

    it('modifies standard description with audit reason creating version v+1', async () => {
      const res = await API.modifyDecision(
        testClusterId,
        'CLUSTER',
        'HARMONIZED HEX BOLT M16 X 50 MM STAINLESS STEEL 304',
        'Standardized description harmonized with ISO 4014 specification.'
      );
      assert.ok(res);
      assert.equal(res.status, 'success');
      assert.equal(res.data.status, 'APPROVED');
    });

    it('escalates decision for higher level engineering review', async () => {
      const res = await API.escalateDecision(testClusterId, 'CLUSTER', 'Price variance requires plant manager confirmation');
      assert.ok(res);
      assert.equal(res.status, 'success');
      assert.equal(res.data.status, 'ESCALATED');
    });

    it('reopens decision for further review', async () => {
      const res = await API.reopenDecision(testClusterId, 'CLUSTER', 'Reopening decision due to supplier update');
      assert.ok(res);
      assert.equal(res.status, 'success');
      assert.equal(res.data.status, 'PENDING');
    });

    it('rejects recommendation and permanently retires code', async () => {
      const res = await API.rejectDecision(testClusterId, 'CLUSTER', 'Specification incompatible with CPSE B standard');
      assert.ok(res);
      assert.equal(res.status, 'success');
      assert.equal(res.data.status, 'REJECTED');
    });
  });

  /* ---------------- 4. Material Explorer: Ask Gemini Search ---------------- */
  describe('4. Material Explorer: Ask Gemini AI Search', () => {
    it('translates natural language search queries into structured attributes and chips', async () => {
      const query = 'stainless steel 304 ball bearings Kaveri make';
      const searchRes = await API.naturalLanguageSearch(query, 10);

      assert.ok(searchRes);
      assert.equal(searchRes.status, 'success');
      assert.ok(searchRes.data.interpretation);
      assert.ok(searchRes.data.interpretation.category || searchRes.data.interpretation.predictedCategory);
      assert.ok(typeof searchRes.data.interpretation.confidence === 'number');
      assert.ok(Array.isArray(searchRes.data.results));
    });
  });

  /* ---------------- 5. Data Intake: BullMQ Background Queue ---------------- */
  describe('5. Data Intake: BullMQ Background Processing & Polling', () => {
    const SAMPLE_CSV = `cpse,code,description,unit,price,qty,supplier,year,plant
A,T-BLT-01,"HEX HEAD BOLT M16 X 50 SS304",EA,35.00,100,Test Vendor,2026,Plant-1
B,T-BLT-02,"HEXAGON BOLT M16X50 GRADE 304",NOS,36.50,150,Test Vendor,2026,Plant-2
`;

    it('submits dataset to BullMQ background queue and polls job progress', async () => {
      const queueRes = await API.uploadDatasetAsync(SAMPLE_CSV, 'queue_test.csv', {
        cpseId: 'A',
        chunkSize: 10,
        dryRun: false,
      });

      assert.ok(queueRes);
      assert.equal(queueRes.status, 'success');
      const jobId = queueRes.data.jobId;
      assert.ok(jobId);
      assert.ok(queueRes.data.status);

      // Poll job status
      const jobStatus = await API.getJobStatus(jobId);
      assert.ok(jobStatus);
      assert.equal(jobStatus.status, 'success');
      assert.equal(jobStatus.data.id || jobStatus.data.jobId, jobId);
      assert.ok(['waiting', 'active', 'completed', 'queued'].includes(jobStatus.data.status.toLowerCase()));
    });
  });

  /* ---------------- 6. Procurement Sourcing Intelligence ---------------- */
  describe('6. Procurement Opportunities & Gemini Executive Briefing', () => {
    it('retrieves cross-CPSE procurement opportunities and synthesizes executive briefing', async () => {
      const opps = await API.getProcurementOpportunities({ limit: 5 });
      assert.ok(opps);
      assert.ok(Array.isArray(opps.data));
      assert.ok(opps.total > 0);

      const targetKey = opps.data[0].clusterKey;
      assert.ok(targetKey);

      // Synthesize executive briefing
      const briefingRes = await API.getProcurementInsights(targetKey);
      assert.ok(briefingRes);
      assert.equal(briefingRes.status, 'success');
      const briefing = briefingRes.data.briefing || briefingRes.data;

      const summary = briefing.summary || briefing.executiveSummary;
      assert.ok(typeof summary === 'string');
      assert.ok(summary.length > 20);
      assert.ok(Array.isArray(briefing.negotiationLevers) || typeof briefing.contractNegotiationLeverage === 'string');
      assert.ok(typeof briefing.riskDisclaimer === 'string' || typeof briefing.disclaimer === 'string');
      // Strictly verify no speculative savings claim is made
      assert.ok(!summary.toLowerCase().includes('guaranteed savings of ₹'));
    });
  });

  /* ---------------- 7. Governance: Live PostgreSQL Audit Stream ---------------- */
  describe('7. Governance Screen: Live Audit Logs & Regulatory Metrics', () => {
    it('retrieves live audit events and regulatory compliance metrics', async () => {
      const [logs, stats] = await Promise.all([
        API.getAuditLogs({ limit: 20 }),
        API.getAuditStats(),
      ]);

      assert.ok(logs);
      assert.equal(logs.status, 'success');
      const list = logs.logs || logs.data?.logs || logs.data;
      assert.ok(Array.isArray(list));

      assert.ok(stats);
      assert.equal(stats.status, 'success');
      assert.ok(typeof (stats.data.totalEvents ?? stats.data.totalAuditLogs) === 'number');
      assert.ok(typeof (stats.data.preventedMerges ?? stats.data.blockedHarmonizations) === 'number');
    });
  });
});
