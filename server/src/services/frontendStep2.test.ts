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

describe('Step 2 Verification: Live National Catalog & Crosswalk Mappings', () => {
  let server: Server;
  let baseUrl: string;

  before(async () => {
    const app = createApp();
    server = app.listen(0);
    const address = server.address() as any;
    baseUrl = `http://127.0.0.1:${address.port}/api/v1`;

    API.configure({
      baseUrl,
      timeoutMs: 10000,
    });
  });

  after(() => {
    if (server) server.close();
  });

  /* ---------------- 1. National Materials Catalog Retrieval & Filters ---------------- */
  describe('1. National Materials Catalog API (API.getMaterials)', () => {
    it('retrieves paginated national materials from catalog service', async () => {
      const res = await API.getMaterials({ page: 1, limit: 5 });
      assert.ok(res);
      assert.ok(typeof res.total === 'number');
      assert.ok(res.total > 0);
      assert.equal(res.page, 1);
      assert.equal(res.limit, 5);
      assert.ok(Array.isArray(res.data));
      assert.ok(res.data.length <= 5);

      const first = res.data[0];
      assert.ok(first.id);
      assert.ok(first.nmcCode);
      assert.ok(first.stdDesc);
      assert.ok(first.category);
    });

    it('filters national materials by category', async () => {
      const res = await API.getMaterials({ category: 'HEX_BOLT', limit: 10 });
      assert.ok(res);
      assert.ok(Array.isArray(res.data));
      for (const item of res.data) {
        assert.equal(item.category, 'HEX_BOLT');
      }
    });

    it('filters national materials by search query', async () => {
      const res = await API.getMaterials({ q: 'BEARING', limit: 10 });
      assert.ok(res);
      assert.ok(Array.isArray(res.data));
      for (const item of res.data) {
        const matches = item.stdDesc.toLowerCase().includes('bearing') || item.nmcCode.toLowerCase().includes('bearing');
        assert.ok(matches, `Item ${item.nmcCode} should match search term 'bearing'`);
      }
    });

    it('filters national materials by status', async () => {
      const res = await API.getMaterials({ status: 'APPROVED', limit: 10 });
      assert.ok(res);
      assert.ok(Array.isArray(res.data));
      for (const item of res.data) {
        assert.equal(item.status, 'APPROVED');
      }
    });
  });

  /* ---------------- 2. Single National Material Detail & Lineage ---------------- */
  describe('2. Single National Material Detail (API.getMaterial)', () => {
    it('retrieves single material detail with version lineage and attributes', async () => {
      const catalog = await API.getMaterials({ limit: 1 });
      const item = catalog.data[0];

      const detail = await API.getMaterial(item.id);
      assert.ok(detail);
      assert.equal(detail.status, 'success');
      assert.ok(detail.data);
      assert.equal(detail.data.nmcCode, item.nmcCode);
      assert.ok(Array.isArray(detail.data.versions));
    });

    it('returns 404 error when querying non-existent material ID', async () => {
      let threw = false;
      try {
        await API.getMaterial('non-existent-nmc-99999');
      } catch (err: any) {
        threw = true;
        assert.ok(err.status === 404 || err.message.includes('not found') || err.message.includes('404'));
      }
      assert.ok(threw, 'Querying non-existent material must trigger 404 error');
    });
  });

  /* ---------------- 3. Catalog RFC-4180 CSV & JSON Export ---------------- */
  describe('3. National Catalog Export (API.exportCatalog)', () => {
    it('exports catalog records as RFC-4180 compliant CSV', async () => {
      const csv = await API.exportCatalog('csv', { limit: 10 });
      assert.ok(typeof csv === 'string');
      assert.ok(csv.includes('National Material Code'));
      assert.ok(csv.includes('Standard Description'));
      assert.ok(csv.includes('Category'));
      assert.ok(csv.includes('Status'));
      assert.ok(csv.includes('Critical Attributes'));

      // Check CSV rows have valid structure
      const lines = csv.trim().split('\n');
      assert.ok(lines.length >= 2, 'CSV must have header line and at least one data line');
    });

    it('exports catalog records in structured JSON format', async () => {
      const jsonRes = await API.exportCatalog('json');
      assert.ok(jsonRes);
      // Either returned as string or parsed object
      const data = typeof jsonRes === 'string' ? JSON.parse(jsonRes) : jsonRes;
      assert.ok(Array.isArray(data));
      assert.ok(data.length > 0);
      assert.ok(data[0].nmcCode);
      assert.ok(data[0].stdDesc);
    });
  });

  /* ---------------- 4. Legacy Crosswalk Mappings ---------------- */
  describe('4. Legacy-to-National Crosswalk Mappings (API.getMappings)', () => {
    it('retrieves crosswalk mappings connecting CPSE legacy records to national codes', async () => {
      const mappingsRes = await API.getMappings({ page: 1, limit: 10 });
      assert.ok(mappingsRes);
      assert.equal(mappingsRes.status, 'success');
      assert.ok(Array.isArray(mappingsRes.data));
      assert.ok(mappingsRes.data.length > 0);

      const mapping = mappingsRes.data[0];
      assert.ok(mapping.id);
      assert.ok(mapping.legacyRecord);
      assert.ok(mapping.legacyRecord.legacyCode);
      assert.ok(mapping.legacyRecord.cpseId);
      assert.ok(mapping.nationalMaterial);
      assert.ok(mapping.nationalMaterial.nmcCode);
    });
  });

  /* ---------------- 5. Frontend Codebase File Invariants ---------------- */
  describe('5. Frontend Codebase File Invariants', () => {
    it('js/api.js provides exportCatalog method', () => {
      const apiJsPath = path.resolve(__dirname, '../../../js/api.js');
      const apiJs = fs.readFileSync(apiJsPath, 'utf8');

      assert.ok(apiJs.includes('exportCatalog('), 'api.js must implement exportCatalog()');
      assert.ok(apiJs.includes('/materials/export'), 'api.js must target /materials/export');
    });

    it('js/app.js implements fetchLiveMaterials and wires into boot and master view', () => {
      const appJsPath = path.resolve(__dirname, '../../../js/app.js');
      const appJs = fs.readFileSync(appJsPath, 'utf8');

      assert.ok(appJs.includes('function fetchLiveMaterials('), 'app.js must define fetchLiveMaterials()');
      assert.ok(appJs.includes('page === \'master\''), 'app.js render() must hook into master page');
      assert.ok(appJs.includes('data-act="export-catalog"'), 'app.js must provide export catalog button');
      assert.ok(appJs.includes('data-act="nm-page"'), 'app.js must provide pagination controls for national materials');
      assert.ok(appJs.includes('data-act="nm-clear"'), 'app.js must provide clear filter action');
      assert.ok(appJs.includes('PostgreSQL Central Registry'), 'app.js must display PostgreSQL status pill when live');
    });

    it('js/app.js pageMappings displays synchronized crosswalk status', () => {
      const appJsPath = path.resolve(__dirname, '../../../js/app.js');
      const appJs = fs.readFileSync(appJsPath, 'utf8');

      assert.ok(appJs.includes('PostgreSQL Crosswalk Mappings'), 'app.js pageMappings must support PostgreSQL crosswalk indicator');
    });
  });
});
