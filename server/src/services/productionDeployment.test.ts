import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { Server } from 'http';
import { createApp } from '../app';
import { KeyRotationService } from '../config/keyRotation';

describe('Step 20: CI/CD Pipeline, Key Rotation & Production Deployment', () => {
  let server: Server;
  let baseUrl: string;

  before(async () => {
    const app = createApp();
    server = app.listen(0);
    const address = server.address() as any;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(() => {
    if (server) server.close();
  });

  beforeEach(() => {
    KeyRotationService.clearPool();
  });

  /* -------------------------------------------------------------------------- */
  /* 1. Gemini API Key Rotation & Resilience Service                           */
  /* -------------------------------------------------------------------------- */
  describe('1. Gemini API Key Rotation Service', () => {
    it('masks secret API keys to prevent exposure in logs and metrics', () => {
      const masked = KeyRotationService.maskKey('AIzaSyAbCdEf123456789XyZ999');
      assert.equal(masked, 'AIzaSy...Z999');
      assert.ok(!masked.includes('123456789'));

      // Very short key edge case
      assert.equal(KeyRotationService.maskKey('short'), '********');
      assert.equal(KeyRotationService.maskKey(''), '********');
    });

    it('initializes key pool from multiple environment variables and deduplicates', () => {
      process.env.GEMINI_API_KEYS = 'AIzaSyKeyA1111111111, AIzaSyKeyB2222222222';
      process.env.GEMINI_API_KEY_1 = 'AIzaSyKeyC3333333333';
      process.env.GEMINI_API_KEY_2 = 'AIzaSyKeyA1111111111'; // duplicate of first

      KeyRotationService.initializePool();
      const metrics = KeyRotationService.getKeyPoolMetrics();

      assert.ok(metrics.totalKeys >= 3, `Expected at least 3 unique keys, got ${metrics.totalKeys}`);
      assert.equal(metrics.activeKeys, metrics.totalKeys);
      assert.equal(metrics.cooldownKeys, 0);

      // Clean up test env vars
      delete process.env.GEMINI_API_KEYS;
      delete process.env.GEMINI_API_KEY_1;
      delete process.env.GEMINI_API_KEY_2;
    });

    it('automatically rotates to the next active key when HTTP 429 quota exhaustion is reported', () => {
      const key1 = 'AIzaSyTestKeyAlpha12345';
      const key2 = 'AIzaSyTestKeyBeta67890';
      const key3 = 'AIzaSyTestKeyGamma54321';

      KeyRotationService.registerKey(key1, 'Key_Alpha');
      KeyRotationService.registerKey(key2, 'Key_Beta');
      KeyRotationService.registerKey(key3, 'Key_Gamma');

      // Initially all keys are ACTIVE
      let metrics = KeyRotationService.getKeyPoolMetrics();
      assert.equal(metrics.totalKeys, 3);
      assert.equal(metrics.activeKeys, 3);

      // Simulate 429 quota exhaustion on Key 1 with 45s cooldown
      KeyRotationService.reportQuotaExhaustion(key1, 45);

      metrics = KeyRotationService.getKeyPoolMetrics();
      assert.equal(metrics.activeKeys, 2);
      assert.equal(metrics.cooldownKeys, 1);

      const key1Status = metrics.keys.find(k => k.name === 'Key_Alpha');
      assert.ok(key1Status);
      assert.equal(key1Status.status, 'COOLDOWN');
      assert.ok((key1Status.cooldownRemainingSec || 0) > 0);

      // Verify active key acquisition skips key1 and retrieves key2 or key3
      const nextKey = KeyRotationService.getActiveKeyEntry();
      assert.ok(nextKey);
      assert.notEqual(nextKey.key, key1);
      assert.ok(nextKey.key === key2 || nextKey.key === key3);
    });

    it('executes operations with auto-rotation retrying on simulated 429 rate limit', async () => {
      const keyA = 'AIzaSyMockFailKeyA12345';
      const keyB = 'AIzaSyMockSuccessKeyB678';

      KeyRotationService.registerKey(keyA, 'Failing_Key');
      KeyRotationService.registerKey(keyB, 'Working_Key');

      let executionAttempts = 0;
      const keysUsed: string[] = [];

      const result = await KeyRotationService.executeWithAutoRotation(async (_client, keyEntry) => {
        executionAttempts++;
        keysUsed.push(keyEntry.name);

        if (keyEntry.key === keyA) {
          const err: any = new Error('Rate limit exceeded: 429 RESOURCE_EXHAUSTED');
          err.status = 429;
          throw err;
        }

        return { response: 'Success from backup key', used: keyEntry.name };
      });

      assert.equal(result.response, 'Success from backup key');
      assert.equal(executionAttempts, 2, 'Should fail on first key and succeed on rotated second key');
      assert.ok(keysUsed.includes('Failing_Key'));
      assert.ok(keysUsed.includes('Working_Key'));

      const metrics = KeyRotationService.getKeyPoolMetrics();
      assert.equal(metrics.cooldownKeys, 1, 'First key should be placed on cooldown');
    });

    it('dynamically registers new API keys at runtime without server restart', () => {
      const newKey = 'AIzaSyDynamicRuntimeKey999';
      const registered = KeyRotationService.registerKey(newKey, 'Hot_Injected_Key');

      assert.equal(registered.name, 'Hot_Injected_Key');
      assert.equal(registered.status, 'ACTIVE');
      assert.equal(registered.masked, 'AIzaSy...y999');

      const active = KeyRotationService.getActiveKeyEntry();
      assert.ok(active);
      assert.equal(active.key, newKey);
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 2. System Health & Monitoring Endpoints                                   */
  /* -------------------------------------------------------------------------- */
  describe('2. Health & Monitoring Endpoints', () => {
    it('GET /health returns HTTP 200 with database, redis, and gemini status', async () => {
      const res = await fetch(`${baseUrl}/health`);
      assert.equal(res.status, 200);

      const json = await res.json();
      assert.equal(json.status, 'ok');
      assert.ok(json.health === 'HEALTHY' || json.health === 'DEGRADED');
      assert.equal(json.version, '1.0.0');
      assert.ok(typeof json.uptimeSeconds === 'number');
      assert.ok(json.services);
      assert.ok(json.services.database);
      assert.ok(json.services.redisQueue);
      assert.ok(json.services.gemini);
      assert.ok(json.system);
      assert.ok(json.system.nodeVersion);
      assert.ok(json.system.heapUsedMb > 0);
    });

    it('GET /api/v1/health resolves identically under API prefix', async () => {
      const res = await fetch(`${baseUrl}/api/v1/health`);
      assert.equal(res.status, 200);

      const json = await res.json();
      assert.ok(json.status);
      assert.equal(json.service, 'National Unified Material Master Framework (NUMMF)');
    });

    it('GET /api/v1/health/gemini returns detailed sanitized key pool metrics', async () => {
      KeyRotationService.registerKey('AIzaSyTestDiagnosticsKey111', 'Diag_Key_1');
      KeyRotationService.registerKey('AIzaSyTestDiagnosticsKey222', 'Diag_Key_2');

      const res = await fetch(`${baseUrl}/api/v1/health/gemini`);
      assert.equal(res.status, 200);

      const json = await res.json();
      assert.equal(json.status, 'success');
      assert.ok(json.data);
      assert.equal(json.data.totalKeys, 2);
      assert.equal(json.data.activeKeys, 2);
      assert.ok(Array.isArray(json.data.keys));

      // Security check: Raw key strings must never be exposed
      for (const k of json.data.keys) {
        assert.ok(k.masked.includes('...'));
        assert.ok(!k.masked.includes('DiagnosticsKey'));
      }
    });

    it('POST /api/v1/health/gemini/rotate accepts fresh key and rejects invalid inputs', async () => {
      // 1. Rejects missing or short key
      const badRes = await fetch(`${baseUrl}/api/v1/health/gemini/rotate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: 'short' }),
      });
      assert.equal(badRes.status, 400);

      // 2. Accepts valid key and activates into pool
      const validRes = await fetch(`${baseUrl}/api/v1/health/gemini/rotate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: 'AIzaSyNewlyProvisionedProductionKey888',
          name: 'Ops_Emergency_Key',
        }),
      });
      assert.equal(validRes.status, 200);

      const validJson = await validRes.json();
      assert.equal(validJson.status, 'success');
      assert.equal(validJson.data.name, 'Ops_Emergency_Key');
      assert.equal(validJson.data.status, 'ACTIVE');
      assert.equal(validJson.data.masked, 'AIzaSy...y888');
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 3. CI/CD & Production Infrastructure Configuration Validation             */
  /* -------------------------------------------------------------------------- */
  describe('3. CI/CD & Production Infrastructure Validation', () => {
    const rootDir = path.resolve(__dirname, '../../..');

    it('validates .github/workflows/ci.yml structure and mandatory jobs', () => {
      const ciPath = path.join(rootDir, '.github/workflows/ci.yml');
      assert.ok(fs.existsSync(ciPath), 'ci.yml must exist');

      const content = fs.readFileSync(ciPath, 'utf-8');
      assert.ok(content.includes('name: NUMMF Enterprise CI/CD Pipeline'));
      assert.ok(content.includes('test-ground-truth-pipeline:'));
      assert.ok(content.includes('test-and-build-server:'));
      assert.ok(content.includes('docker-validation:'));
      assert.ok(content.includes('npm test'));
      assert.ok(content.includes('npm run benchmark'));
      assert.ok(content.includes('npm run build'));
      assert.ok(content.includes('npm run keys:health'));
    });

    it('validates nginx/nginx.conf reverse proxy directives and security headers', () => {
      const nginxPath = path.join(rootDir, 'nginx/nginx.conf');
      assert.ok(fs.existsSync(nginxPath), 'nginx.conf must exist');

      const content = fs.readFileSync(nginxPath, 'utf-8');
      assert.ok(content.includes('upstream backend_api'));
      assert.ok(content.includes('proxy_pass http://backend_api;'));
      assert.ok(content.includes('location /api/'));
      assert.ok(content.includes('location /health'));
      assert.ok(content.includes('gzip on;'));
      assert.ok(content.includes('X-Frame-Options'));
      assert.ok(content.includes('X-Content-Type-Options'));
      assert.ok(content.includes('try_files $uri $uri/ /index.html;'));
    });

    it('validates docker-compose.prod.yml multi-container architecture and healthchecks', () => {
      const composePath = path.join(rootDir, 'docker-compose.prod.yml');
      assert.ok(fs.existsSync(composePath), 'docker-compose.prod.yml must exist');

      const content = fs.readFileSync(composePath, 'utf-8');
      assert.ok(content.includes('postgres:'));
      assert.ok(content.includes('pgvector/pgvector:pg16'));
      assert.ok(content.includes('redis:'));
      assert.ok(content.includes('redis:7-alpine'));
      assert.ok(content.includes('api:'));
      assert.ok(content.includes('target: production'));
      assert.ok(content.includes('nginx:'));
      assert.ok(content.includes('nginx:alpine'));
      assert.ok(content.includes('healthcheck:'));
      assert.ok(content.includes('nummf_prod_postgres_data'));
      assert.ok(content.includes('nummf_prod_redis_data'));
    });
  });
});
