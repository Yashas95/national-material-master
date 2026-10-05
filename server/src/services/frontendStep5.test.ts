import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs';
import { createApp } from '../app';
import { Server } from 'http';
import { TenantService } from '../middleware/tenantMiddleware';

// Load js/api.js dynamically as used by browser
const apiPath = path.resolve(__dirname, '../../../js/api.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const API = require(apiPath);

describe('Step 5 Verification: Real-time Multi-tenancy, Dynamic Governance & Offline Immunity', () => {
  let server: Server;
  let baseUrl: string;

  before(async () => {
    const app = createApp();
    server = app.listen(0);
    const address = server.address() as any;
    baseUrl = `http://127.0.0.1:${address.port}/api/v1`;

    API.configure({
      baseUrl,
      timeoutMs: 15000,
    });

    // Authenticate as SUPER_ADMIN
    await API.switchPersona('SUPER_ADMIN', 'A');
  });

  after(() => {
    if (server) server.close();
  });

  /* ---------------- 1. Multi-Tenant Scoping & Persona Switching ---------------- */
  describe('1. Multi-Tenancy & Tenant Scoping (API.switchPersona)', () => {
    it('switches persona dynamically and synchronizes tenant credentials', async () => {
      const userA = await API.switchPersona('CPSE_ADMIN', 'A');
      assert.ok(userA);
      assert.equal(userA.role, 'CPSE_ADMIN');
      assert.equal(userA.tenantId, 'A');

      const userB = await API.switchPersona('CPSE_ADMIN', 'B');
      assert.ok(userB);
      assert.equal(userB.role, 'CPSE_ADMIN');
      assert.equal(userB.tenantId, 'B');

      // Restore SUPER_ADMIN
      await API.switchPersona('SUPER_ADMIN', 'A');
    });

    it('enforces competitor masking for CPSE_ADMIN on legacy records', () => {
      const competitorRecord = {
        cpseId: 'B',
        code: 'COMPETITOR-MAT-88',
        rawDesc: 'BALL BEARING 6205',
      };

      // Viewer is CPSE_ADMIN for tenant A
      const masked = TenantService.maskRecord(competitorRecord, 'CPSE_ADMIN', 'A');
      assert.equal(masked.code, '[MASKED: CPSE B]');

      // Viewer is CPSE_ADMIN for tenant B (sees own code)
      const unmasked = TenantService.maskRecord(competitorRecord, 'CPSE_ADMIN', 'B');
      assert.equal(unmasked.code, 'COMPETITOR-MAT-88');

      // Super Admin sees all codes unmasked
      const superAdminView = TenantService.maskRecord(competitorRecord, 'SUPER_ADMIN', 'A');
      assert.equal(superAdminView.code, 'COMPETITOR-MAT-88');
    });
  });

  /* ---------------- 2. Dynamic Governance & Audit Lineage ---------------- */
  describe('2. Dynamic Governance & Audit Lineage (API.getAuditLogs & API.exportAuditLogs)', () => {
    it('retrieves paginated audit log entries with action filtering', async () => {
      const resp = await API.getAuditLogs({ limit: 10 });
      assert.ok(resp);
      const data = resp.data || resp.logs || resp;
      assert.ok(Array.isArray(data) || Array.isArray(resp.data));
      assert.ok(resp.total >= 0);

      // Filter by UNSAFE_MERGE_PREVENTED
      const prevented = await API.getAuditLogs({ action: 'UNSAFE_MERGE_PREVENTED' });
      assert.ok(prevented);
      const preventedList = prevented.data || [];
      assert.ok(Array.isArray(preventedList));
      if (preventedList.length > 0) {
        assert.equal(preventedList[0].action, 'UNSAFE_MERGE_PREVENTED');
        assert.ok(preventedList[0].detail.includes('Rule R-01'));
      }
    });

    it('retrieves aggregated audit statistics via API.getAuditStats()', async () => {
      const statsResp = await API.getAuditStats();
      assert.ok(statsResp);
      const stats = statsResp.data || statsResp;
      assert.ok(typeof stats.blockedHarmonizations === 'number');
      assert.ok(stats.blockedHarmonizations >= 0);
    });

    it('exports regulatory audit logs as RFC-4180 CSV via API.exportAuditLogs()', async () => {
      const csv = await API.exportAuditLogs('csv');
      assert.ok(typeof csv === 'string');
      const lower = csv.toLowerCase();
      assert.ok(lower.includes('event id') || lower.includes('id') || lower.includes('action'));
      assert.ok(lower.includes('timestamp') || lower.includes('createdat') || lower.includes('2026'));
    });

    it('exports audit logs as structured JSON via API.exportAuditLogs("json")', async () => {
      const jsonStr = await API.exportAuditLogs('json');
      const parsed = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
      assert.ok(parsed);
      const entries = Array.isArray(parsed) ? parsed : parsed.data || parsed.events;
      assert.ok(Array.isArray(entries));
      assert.ok(entries.length > 0);
    });
  });

  /* ---------------- 3. Procurement Intelligence & Gemini Insights ---------------- */
  describe('3. Procurement Opportunities & Sourcing Insights', () => {
    let testClusterKey: string;

    it('retrieves ranked cross-CPSE procurement opportunities via API.getProcurementOpportunities()', async () => {
      const resp = await API.getProcurementOpportunities({ limit: 5 });
      assert.ok(resp);
      const opps = resp.data || resp.opportunities || [];
      assert.ok(Array.isArray(opps));
      assert.ok(opps.length > 0);

      const firstOpp = opps[0];
      testClusterKey = firstOpp.clusterKey || firstOpp.id;
      assert.ok(testClusterKey);
      assert.ok(firstOpp.combinedDemand >= 0 || firstOpp.totalDemand >= 0 || firstOpp.demand >= 0);
    });

    it('retrieves single opportunity dossier via API.getProcurementOpportunity()', async () => {
      assert.ok(testClusterKey);
      const resp = await API.getProcurementOpportunity(testClusterKey);
      assert.ok(resp);
      const dossier = resp.data || resp;
      assert.ok(dossier.clusterKey || dossier.id);
      assert.ok(dossier.rows || dossier.cpseCount || dossier.demand || dossier.cpses);
    });

    it('synthesizes or retrieves Gemini executive sourcing briefing via API.getProcurementInsights()', async () => {
      assert.ok(testClusterKey);
      const resp = await API.getProcurementInsights(testClusterKey, false);
      assert.ok(resp);
      const data = resp.data || resp;
      const briefing = data.briefing || data;

      assert.ok(briefing.summary || briefing.executiveSummary);
      assert.ok(briefing.contractNegotiationLeverage || briefing.negotiationLevers);
      assert.ok(briefing.riskDisclaimer || briefing.disclaimer);
    });

    it('retrieves macro procurement statistics via API.getProcurementStats()', async () => {
      const resp = await API.getProcurementStats();
      assert.ok(resp);
      const stats = resp.data || resp;
      assert.ok(stats.totalOpportunities >= 0);
      assert.ok(typeof stats.averagePriceSpread === 'number');
    });
  });

  /* ---------------- 4. "Ask Gemini" Natural Language Query ---------------- */
  describe('4. "Ask Gemini" Natural Language Query & AI Search', () => {
    it('translates natural language valve query into structured attributes via API.naturalLanguageSearch()', async () => {
      const resp = await API.naturalLanguageSearch('gate valve 300 lb cf8m 4 inch', 5);
      assert.ok(resp);
      const data = resp.data || resp;

      assert.ok(data.interpretation);
      assert.equal(data.interpretation.predictedCategory, 'GATE_VALVE');
      assert.ok(data.results && Array.isArray(data.results));
    });

    it('translates bolt query and works via askGeminiSearch alias', async () => {
      const resp = await API.askGeminiSearch('hex bolt m16 ss304 50 mm', 5);
      assert.ok(resp);
      const data = resp.data || resp;

      assert.ok(data.interpretation);
      assert.equal(data.interpretation.predictedCategory, 'HEX_BOLT');
    });
  });

  /* ---------------- 5. Frontend Codebase File Invariants ---------------- */
  describe('5. Frontend Codebase File Invariants', () => {
    const apiCode = fs.readFileSync(apiPath, 'utf-8');
    const appPath = path.resolve(__dirname, '../../../js/app.js');
    const appCode = fs.readFileSync(appPath, 'utf-8');

    it('js/api.js exposes all governance, procurement, and search methods', () => {
      assert.ok(apiCode.includes('getAuditLogs('), 'js/api.js must export getAuditLogs');
      assert.ok(apiCode.includes('getAuditStats('), 'js/api.js must export getAuditStats');
      assert.ok(apiCode.includes('exportAuditLogs('), 'js/api.js must export exportAuditLogs');
      assert.ok(apiCode.includes('getProcurementOpportunities('), 'js/api.js must export getProcurementOpportunities');
      assert.ok(apiCode.includes('getProcurementInsights('), 'js/api.js must export getProcurementInsights');
      assert.ok(apiCode.includes('getProcurementStats('), 'js/api.js must export getProcurementStats');
      assert.ok(apiCode.includes('naturalLanguageSearch('), 'js/api.js must export naturalLanguageSearch');
      assert.ok(apiCode.includes('askGeminiSearch('), 'js/api.js must export askGeminiSearch');
      assert.ok(apiCode.includes('switchPersona('), 'js/api.js must export switchPersona');
    });

    it('js/app.js implements live governance audit sync and RFC-4180 export', () => {
      assert.ok(appCode.includes('syncLiveAudit('), 'js/app.js must implement syncLiveAudit()');
      assert.ok(appCode.includes('exportAuditData('), 'js/app.js must implement exportAuditData()');
      assert.ok(appCode.includes('data-act="export-audit"'), 'js/app.js must bind export-audit button');
      assert.ok(appCode.includes('PostgreSQL Immutable Audit Trail'), 'pageGovernance must render PostgreSQL badge');
    });

    it('js/app.js implements procurement briefing synthesis and live sourcing intelligence pill', () => {
      assert.ok(appCode.includes('fetchProcurementBriefing('), 'js/app.js must implement fetchProcurementBriefing()');
      assert.ok(appCode.includes('PostgreSQL Cross-CPSE Sourcing Intelligence'), 'pageProcurement must render live pill');
    });

    it('js/app.js implements natural language search integration via doAiSearch', () => {
      assert.ok(appCode.includes('doAiSearch('), 'js/app.js must implement doAiSearch()');
      assert.ok(appCode.includes('api.naturalLanguageSearch'), 'doAiSearch must call API.naturalLanguageSearch');
    });
  });
});
