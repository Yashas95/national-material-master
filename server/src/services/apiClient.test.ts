import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { createApp } from '../app';
import { Server } from 'http';

// Load js/api.js dynamically
const apiPath = path.resolve(__dirname, '../../../js/api.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const API = require(apiPath);

const SAMPLE_CSV = `cpse,code,description,unit,price,qty,supplier,year,plant
A,VLV-001,4 INCH GATE VALVE CLASS 150 FLANGED WCB BODY,EA,14500,10,L&T Valves,2023,Refinery-1
A,VLV-002,2 INCH GLOBE VALVE CLASS 300 SS304,EA,8200,5,Audco,2024,Platform-A
`;

describe('Step 17: Frontend API Client Layer (js/api.js)', () => {
  let server: Server;
  let baseUrl: string;

  before(async () => {
    const app = createApp();
    server = app.listen(0);
    const address = server.address() as any;
    baseUrl = `http://127.0.0.1:${address.port}/api/v1`;

    API.configure({
      baseUrl,
      timeoutMs: 8000,
    });
  });

  after(() => {
    if (server) server.close();
  });

  it('checks platform health via API.getHealth()', async () => {
    const health = await API.getHealth();
    assert.equal(health.status, 'ok');
    assert.ok(health.uptime >= 0);
  });

  it('switches demo personas and updates authorization context', async () => {
    const user = await API.switchPersona('CPSE_ADMIN', 'A');
    assert.ok(user);
    assert.equal(user.role, 'CPSE_ADMIN');
    assert.equal(user.tenantId, 'A');

    // Switch to Super Admin
    const superAdmin = await API.switchPersona('SUPER_ADMIN');
    assert.equal(superAdmin.role, 'SUPER_ADMIN');
  });

  it('retrieves high-level platform metrics via API.getOverview()', async () => {
    const overview = await API.getOverview();
    assert.ok(typeof overview.nationalMaterialsCount === 'number');
    assert.ok(typeof overview.procurementOpportunities === 'number');
    assert.ok(typeof overview.totalCrossCpseSpend === 'number');
    assert.ok(typeof overview.averagePriceSpread === 'number');
  });

  it('retrieves paginated national materials and single material detail', async () => {
    const materials = await API.getMaterials({ limit: 5 });
    assert.ok(materials.data);
    assert.ok(Array.isArray(materials.data));
    assert.ok(materials.total > 0);

    const first = materials.data[0];
    const detail = await API.getMaterial(first.id);
    assert.ok(detail.data);
    assert.equal(detail.data.id, first.id);
  });

  it('executes "Ask Gemini" natural language search via API.naturalLanguageSearch()', async () => {
    const searchRes = await API.naturalLanguageSearch('4 inch gate valves in stainless steel', 5);
    assert.equal(searchRes.status, 'success');
    assert.ok(searchRes.data.interpretation);
    assert.ok(Array.isArray(searchRes.data.results));
    assert.ok(searchRes.data.interpretation.attributes || searchRes.data.interpretation.category);
  });

  it('synthesizes auditor-grade Gemini explanation via API.getAiExplanation()', async () => {
    const recordA = {
      code: 'V-01',
      cpseId: 'A',
      rawDesc: 'HEX BOLT M16 X 50 SS304 DIN 931',
      category: 'HEX_BOLT',
      attrs: { diameter: 16, length: 50, grade: 'SS304', standard: 'DIN 931' },
      unitInfo: { raw: 'EA', family: 'count', factor: 1, canon: 'EA' },
    };
    const recordB = {
      code: 'V-02',
      cpseId: 'B',
      rawDesc: 'HEXAGON HEAD BOLT M16X50 ISO 4014 GRADE 304',
      category: 'HEX_BOLT',
      attrs: { diameter: 16, length: 50, grade: 'SS304', standard: 'ISO 4014' },
      unitInfo: { raw: 'NOS', family: 'count', factor: 1, canon: 'EA' },
    };

    const explanation = await API.getAiExplanation(recordA, recordB);
    assert.equal(explanation.status, 'success');
    assert.ok(explanation.data.narrative);
    assert.ok(explanation.data.reasons.length > 0);
    assert.ok(explanation.data.auditorVerdict);
  });

  it('submits decision approvals and modifications', async () => {
    await API.switchPersona('MATERIAL_EXPERT');

    const approval = await API.approveDecision('cluster-test-1', 'CLUSTER', 'Approved from drawing inspection');
    assert.equal(approval.status, 'success');
    assert.ok(approval.data.success);
    assert.ok(approval.data.status);

    const modification = await API.modifyDecision(
      'cluster-test-1',
      'CLUSTER',
      'HEXAGON HEAD BOLT M16 X 50 MM SS304 REVISED',
      'Updated to comply with IS 1364-1 standard'
    );
    assert.equal(modification.status, 'success');
    assert.equal(modification.data.version, 2);
  });

  it('uploads dataset synchronously and asynchronously with job status polling', async () => {
    await API.switchPersona('CPSE_ADMIN', 'A');

    // 1. Synchronous dry-run upload
    const syncRes = await API.uploadDataset(SAMPLE_CSV, 'sample_sync.csv', { dryRun: true });
    assert.equal(syncRes.status, 'success');
    assert.ok(syncRes.data.accepted || syncRes.data.acceptedCount > 0);

    // 2. Asynchronous bulk queue upload
    const asyncRes = await API.uploadDatasetAsync(SAMPLE_CSV, 'sample_async.csv', { dryRun: true });
    assert.equal(asyncRes.status, 'success');
    assert.ok(asyncRes.data.jobId);

    // 3. Poll job status
    const jobStatus = await API.getJobStatus(asyncRes.data.jobId);
    assert.equal(jobStatus.status, 'success');
    assert.equal(jobStatus.data.id, asyncRes.data.jobId);
    assert.ok(['waiting', 'active', 'completed'].includes(jobStatus.data.status));
  });

  it('retrieves procurement opportunities and sourcing briefing notes', async () => {
    await API.switchPersona('PROCUREMENT_OFFICER');

    const opps = await API.getProcurementOpportunities({ limit: 5 });
    assert.equal(opps.status, 'success');
    assert.ok(opps.data.length > 0);

    const first = opps.data[0];
    const detail = await API.getProcurementOpportunity(first.clusterKey);
    assert.equal(detail.status, 'success');
    assert.equal(detail.data.clusterKey, first.clusterKey);
    assert.ok(detail.data.executiveBriefing);

    const stats = await API.getProcurementStats();
    assert.equal(stats.status, 'success');
    assert.ok(stats.data.totalOpportunities > 0);
  });

  it('queries audit logs and regulatory stats', async () => {
    await API.switchPersona('AUDITOR');

    const logs = await API.getAuditLogs({ limit: 5 });
    assert.equal(logs.status, 'success');
    assert.ok(Array.isArray(logs.data));

    const stats = await API.getAuditStats();
    assert.equal(stats.status, 'success');
    assert.ok(stats.data.totalEvents >= 0);
  });

  it('handles API errors gracefully with structured ApiError', async () => {
    await assert.rejects(
      async () => {
        await API.getMaterial('non-existent-material-code-99999');
      },
      (err: any) => {
        assert.equal(err.name, 'ApiError');
        assert.equal(err.status, 404);
        assert.ok(err.message.includes('not found'));
        return true;
      }
    );
  });
});
