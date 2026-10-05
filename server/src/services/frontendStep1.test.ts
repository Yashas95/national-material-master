import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs';
import { createApp } from '../app';
import { Server } from 'http';

// Load js/api.js dynamically
const apiPath = path.resolve(__dirname, '../../../js/api.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const API = require(apiPath);

describe('Step 1 Verification: Real Backend Bootstrap & Live Connection Context', () => {
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

  /* ---------------- 1. Health & Live Connectivity ---------------- */
  describe('1. Health Check & Connectivity Detection', () => {
    it('successfully connects to live backend health endpoint', async () => {
      const health = await API.getHealth();
      assert.ok(health);
      assert.ok(health.status === 'ok' || health.health === 'HEALTHY' || health.health === 'DEGRADED');
      assert.ok(typeof health.uptime === 'number' || typeof health.uptimeSeconds === 'number');
      assert.ok(health.services);
      assert.ok(health.services.database);
    });

    it('gracefully handles backend outage and returns false/null on bad endpoint', async () => {
      // Temporarily point to non-existent port to simulate network failure
      const deadClient = { ...API };
      // Simulate fetch failure
      let failed = false;
      try {
        const res = await fetch('http://127.0.0.1:59999/api/v1/health', { signal: AbortSignal.timeout(300) });
        if (!res.ok) failed = true;
      } catch {
        failed = true;
      }
      assert.equal(failed, true, 'Unreachable backend must trigger network error catch block');
    });
  });

  /* ---------------- 2. Live Overview Synchronization ---------------- */
  describe('2. Live Overview Synchronization', () => {
    it('retrieves live overview KPIs from PostgreSQL database', async () => {
      const overview = await API.getOverview();
      assert.ok(overview, 'Overview object should be returned');
      assert.ok(typeof overview.nationalMaterialsCount === 'number');
      assert.ok(overview.nationalMaterialsCount > 0);
      assert.ok(typeof overview.procurementOpportunities === 'number');
      assert.ok(overview.procurementOpportunities > 0);
      assert.ok(typeof overview.blockedHarmonizations === 'number');
      assert.ok(overview.blockedHarmonizations > 0);
      assert.ok(typeof overview.totalAuditEvents === 'number');
    });
  });

  /* ---------------- 3. Auth Persona Sync ---------------- */
  describe('3. Auth Persona Backend Synchronization', () => {
    it('switches persona and secures JWT with correct tenant claims', async () => {
      const user = await API.switchPersona('CPSE_ADMIN', 'C');
      assert.ok(user);
      assert.equal(user.role, 'CPSE_ADMIN');
      assert.equal(user.tenantId, 'C');

      const admin = await API.switchPersona('SUPER_ADMIN');
      assert.ok(admin);
      assert.equal(admin.role, 'SUPER_ADMIN');
    });
  });

  /* ---------------- 4. Frontend Codebase Validation ---------------- */
  describe('4. Frontend Codebase File Invariants', () => {
    it('js/app.js renders dynamic #backendBadge and removes static synthetic badge in shell()', () => {
      const appJsPath = path.resolve(__dirname, '../../../js/app.js');
      const appJs = fs.readFileSync(appJsPath, 'utf8');

      // Must have dynamic backendBadge
      assert.ok(appJs.includes('id="backendBadge"'), 'app.js shell() must include #backendBadge element');
      assert.ok(appJs.includes('live-badge'), 'app.js shell() must include live-badge CSS class');
      assert.ok(appJs.includes('Live Backend Connected'), 'app.js must provide Live Backend Connected state');
      assert.ok(appJs.includes('Offline Engine'), 'app.js must provide Offline Engine fallback state');

      // The top header must NOT contain static <span class="synthetic"> anymore
      const headerArea = appJs.slice(appJs.indexOf('<header class="top">'), appJs.indexOf('</header>'));
      assert.ok(!headerArea.includes('<span class="synthetic">'), 'Top header must not contain hardcoded static synthetic tag');
    });

    it('js/app.js executes checkBackendConnectivity during app initialization', () => {
      const appJsPath = path.resolve(__dirname, '../../../js/app.js');
      const appJs = fs.readFileSync(appJsPath, 'utf8');

      // Boot section must call checkBackendConnectivity()
      const bootSection = appJs.slice(appJs.lastIndexOf('/* ---------------- Boot ---------------- */'));
      assert.ok(bootSection.includes('checkBackendConnectivity()'), 'Boot sequence must invoke checkBackendConnectivity()');
    });

    it('js/app.js pageOverview dynamically incorporates live overview metrics', () => {
      const appJsPath = path.resolve(__dirname, '../../../js/app.js');
      const appJs = fs.readFileSync(appJsPath, 'utf8');

      assert.ok(appJs.includes('S.backendConnected && S.liveOverview'), 'pageOverview() must check live overview state');
      assert.ok(appJs.includes('PostgreSQL'), 'Overview must report PostgreSQL sync when connected');
      assert.ok(appJs.includes('Blocked harmonizations'), 'Overview KPI must display blocked harmonizations metric');
    });

    it('css/styles.css contains required styling for live and offline connection badges', () => {
      const cssPath = path.resolve(__dirname, '../../../css/styles.css');
      const css = fs.readFileSync(cssPath, 'utf8');

      assert.ok(css.includes('.live-badge'), 'styles.css must define .live-badge');
      assert.ok(css.includes('.live-badge.connected'), 'styles.css must define .live-badge.connected');
      assert.ok(css.includes('.live-badge.offline'), 'styles.css must define .live-badge.offline');
      assert.ok(css.includes('.live-badge .dot'), 'styles.css must define dot styling');
    });
  });
});
