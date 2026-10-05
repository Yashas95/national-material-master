import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs';
import { createApp } from '../app';
import { Server } from 'http';
import { IntakeService } from './intakeService';

// Load js/api.js dynamically as used by browser
const apiPath = path.resolve(__dirname, '../../../js/api.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const API = require(apiPath);

describe('Step 4 Verification: Real Document Intake & Batch Harmonization Progress', () => {
  let server: Server;
  let baseUrl: string;

  const validSampleCsv = `cpse,code,description,unit,price,qty,supplier,year
A,BLT-S4-101,"BOLT HEX M16 X 50 MM SS304 ISO 4014",EA,29.40,1500,Deccan Fasteners,2026
A,BRG-S4-102,"DEEP GROOVE BALL BEARING 6205 2RS SKF",NOS,1320,300,Kaveri Bearing Co,2026
A,VLV-S4-103,"GATE VALVE DN100 300 LB CF8M FLANGED",NO,68000,6,Godavari Valves,2026`;

  const invalidSampleCsv = `cpse,code,description,unit,price,qty
A,MAL-01,"INCOMPLETE DESC",EA,10,50
Z,INV-02,"HEX BOLT M12X40 SS304",EA,12,100`;

  before(async () => {
    IntakeService.clearCache();
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
    IntakeService.clearCache();
    if (server) server.close();
  });

  /* ---------------- 1. Raw Text & Structured Paste Intake ---------------- */
  describe('1. Raw Text & Structured Paste Intake (API.pasteIntakeRows)', () => {
    it('successfully processes and enriches valid legacy catalog rows', async () => {
      const resp = await API.pasteIntakeRows(validSampleCsv, 'A', false);
      assert.ok(resp);
      const data = resp.data || resp;

      assert.equal(data.success, true);
      assert.ok(data.batchId && data.batchId.startsWith('batch_'));
      assert.equal(data.totalRows, 3);
      assert.equal(data.accepted.length, 3);
      assert.equal(data.rejected.length, 0);

      // Verify Tier 1 / Tier 2 enrichment outputs
      const boltRow = data.accepted.find((r: any) => r.code === 'BLT-S4-101');
      assert.ok(boltRow);
      assert.equal(boltRow.category, 'HEX_BOLT');
      assert.equal(boltRow.attrs.diameter, 16);
      assert.equal(boltRow.attrs.length, 50);
      assert.ok(boltRow.outcome);
      assert.ok(['MATCHED', 'PROPOSED_NEW'].includes(boltRow.outcome.status));
    });

    it('supports dry-run preview mode without committing records to storage', async () => {
      const dryRunCsv = `cpse,code,description,unit,price,qty,supplier,year
A,DRY-901,"PIPE SEAMLESS ASTM A106 GRADE B 2 INCH SCH 40",MTR,850,200,Steel Corp,2026`;

      const resp = await API.pasteIntakeRows(dryRunCsv, 'A', true);
      assert.ok(resp);
      const data = resp.data || resp;

      assert.equal(data.success, true);
      assert.equal(data.dryRun, true);
      assert.equal(data.accepted.length, 1);
      assert.equal(data.accepted[0].category, 'SEAMLESS_PIPE');
    });

    it('rejects duplicate file content with duplicateUpload indicator', async () => {
      const dupCsv = `cpse,code,description,unit,price,qty,supplier,year
A,DUP-001,"HEX BOLT M20 X 80 MM GRADE 8.8",EA,45,500,Apex,2026`;

      // First upload
      const first = await API.pasteIntakeRows(dupCsv, 'A', false);
      const data1 = first.data || first;
      assert.equal(data1.success, true);
      assert.equal(data1.duplicateUpload, false);

      // Duplicate upload
      const second = await API.pasteIntakeRows(dupCsv, 'A', false);
      const data2 = second.data || second;
      assert.equal(data2.duplicateUpload, true);
      assert.equal(data2.accepted.length, 0);
    });

    it('accepts structured row array payload directly', async () => {
      const structuredRows = [
        {
          cpse: 'A',
          code: 'JSON-101',
          description: 'HEX BOLT M16 X 65 MM GRADE 8.8 DIN 931',
          unit: 'EA',
          price: 32,
          qty: 400,
        },
      ];

      const resp = await API.pasteIntakeRows(structuredRows, 'A', false);
      assert.ok(resp);
      const data = resp.data || resp;
      assert.equal(data.success, true);
      assert.equal(data.accepted.length, 1);
      assert.equal(data.accepted[0].category, 'HEX_BOLT');
      assert.equal(data.accepted[0].attrs.diameter, 16);
      assert.equal(data.accepted[0].attrs.length, 65);
      assert.equal(data.accepted[0].attrs.grade, '8.8');
    });
  });

  /* ---------------- 2. Multi-Tenant Scoping Enforcement ---------------- */
  describe('2. Multi-Tenant Bounds Enforcement', () => {
    it('restricts CPSE administrator from ingesting rows belonging to a different CPSE', async () => {
      // Switch persona to CPSE_ADMIN for CPSE B
      await API.switchPersona('CPSE_ADMIN', 'B');

      const mixedCsv = `cpse,code,description,unit
A,CROSS-01,"HEX BOLT M16 X 50 MM SS304",EA
B,VALID-02,"HEX BOLT M16 X 50 MM SS304",EA`;

      const resp = await API.pasteIntakeRows(mixedCsv, 'B', false);
      const data = resp.data || resp;

      assert.equal(data.accepted.length, 1);
      assert.equal(data.accepted[0].code, 'VALID-02');
      assert.equal(data.rejected.length, 1);
      assert.ok(data.rejected[0].reason.includes('A CPSE administrator can only upload'));

      // Restore SUPER_ADMIN persona
      await API.switchPersona('SUPER_ADMIN', 'A');
    });
  });

  /* ---------------- 3. Batch Inspection & History Endpoints ---------------- */
  describe('3. Batch Progress & Inspection Endpoints (API.getBatches & API.getIntakeBatch)', () => {
    let createdBatchId: string;

    before(async () => {
      const batchCsv = `cpse,code,description,unit,price,qty
A,BATCH-INSPECT-1,"WELDING ELECTRODE E7018 3.15 MM",KG,220,100
A,BATCH-INSPECT-2,"BALL BEARING 6308 C3",NOS,2400,50`;

      const res = await API.pasteIntakeRows(batchCsv, 'A', false);
      const data = res.data || res;
      createdBatchId = data.batchId;
    });

    it('retrieves recent ingestion batches via API.getBatches()', async () => {
      const resp = await API.getBatches();
      assert.ok(resp);
      const batches = resp.data || resp;
      assert.ok(Array.isArray(batches));
      assert.ok(batches.length > 0);
      assert.ok(batches.some((b: any) => b.extra?.batchId === createdBatchId || b.id));
    });

    it('retrieves legacy records for a specific batch via API.getIntakeBatch()', async () => {
      assert.ok(createdBatchId);
      const resp = await API.getIntakeBatch(createdBatchId);
      assert.ok(resp);
      const data = resp.data || resp;
      assert.equal(resp.batchId, createdBatchId);
      assert.ok(Array.isArray(data));
      assert.equal(data.length, 2);
      assert.ok(data.some((r: any) => r.code === 'BATCH-INSPECT-1'));
    });
  });

  /* ---------------- 4. Frontend Codebase File Invariants ---------------- */
  describe('4. Frontend Codebase File Invariants', () => {
    const apiCode = fs.readFileSync(apiPath, 'utf-8');
    const appPath = path.resolve(__dirname, '../../../js/app.js');
    const appCode = fs.readFileSync(appPath, 'utf-8');

    it('js/api.js exposes all required intake methods (upload, paste, getBatches, getIntakeBatch)', () => {
      assert.ok(apiCode.includes('uploadIntakeFile('), 'js/api.js must export uploadIntakeFile');
      assert.ok(apiCode.includes('pasteIntakeRows('), 'js/api.js must export pasteIntakeRows');
      assert.ok(apiCode.includes('getBatches('), 'js/api.js must export getBatches');
      assert.ok(apiCode.includes('getIntakeBatch('), 'js/api.js must export getIntakeBatch');
    });

    it('js/app.js implements doIngest with live backend integration and offline fallback', () => {
      assert.ok(appCode.includes('async function doIngest('), 'doIngest must be an async function');
      assert.ok(appCode.includes('api.pasteIntakeRows'), 'doIngest must call api.pasteIntakeRows');
      assert.ok(appCode.includes('api.uploadIntakeFile'), 'doIngest must call api.uploadIntakeFile');
      assert.ok(appCode.includes('N.ingest('), 'doIngest must preserve offline client-side engine fallback');
    });

    it('js/app.js implements dry-run preview, batch refresh, and live intake badge', () => {
      assert.ok(appCode.includes('data-act="ingest-dryrun"'), 'Intake page must provide Dry-Run Preview button');
      assert.ok(appCode.includes('data-act="refresh-batches"'), 'Intake page must provide Refresh Batches button');
      assert.ok(appCode.includes('Live Intake Pipeline (PostgreSQL & Gemini Sync)'), 'Intake page must render live sync badge');
      assert.ok(appCode.includes('async function fetchLiveBatches('), 'js/app.js must implement fetchLiveBatches()');
    });
  });
});
