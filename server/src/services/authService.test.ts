import test from 'node:test';
import assert from 'node:assert';
import { AuthService } from './authService';
import { ROLE_DEFINITIONS } from '../models/auth';
import { TenantService } from '../middleware/tenantMiddleware';
import { QuotaGuardService } from '../middleware/quotaGuard';
import { createApp } from '../app';
import { Server } from 'http';

test('AuthService - JWT Signing and Verification', () => {
  const login = AuthService.loginAsRole('SUPER_ADMIN');
  assert.ok(login.accessToken, 'Access token should be generated');
  assert.ok(login.refreshToken, 'Refresh token should be generated');
  assert.strictEqual(login.user.role, 'SUPER_ADMIN');

  const decoded = AuthService.verifyAccessToken(login.accessToken);
  assert.strictEqual(decoded.sub, login.user.id);
  assert.strictEqual(decoded.role, 'SUPER_ADMIN');
  assert.ok(decoded.permissions.includes('settings'));
  assert.ok(decoded.permissions.includes('review'));
});

test('AuthService - Role Persona and Permissions Mapping', () => {
  const cpseAdmin = AuthService.loginAsRole('CPSE_ADMIN', 'B');
  assert.strictEqual(cpseAdmin.user.tenantId, 'B');
  assert.deepStrictEqual(cpseAdmin.user.permissions, ROLE_DEFINITIONS.CPSE_ADMIN.permissions);

  const expert = AuthService.loginAsRole('MATERIAL_EXPERT');
  assert.deepStrictEqual(expert.user.permissions, ['review', 'procurement_view']);

  const viewer = AuthService.loginAsRole('VIEWER');
  assert.strictEqual(viewer.user.permissions.length, 0);
});

test('TenantService - Competitor Code Masking for CPSE_ADMIN', () => {
  const ownRecord = { cpseId: 'A', code: 'BOLT-10021', rawDesc: 'HEX BOLT M16X50' };
  const competitorRecord = { cpseId: 'B', code: 'MAT-98231', rawDesc: 'HEX BOLT M16X50' };

  // Viewer is CPSE_ADMIN for Tenant A
  const maskedOwn = TenantService.maskRecord(ownRecord, 'CPSE_ADMIN', 'A');
  const maskedCompetitor = TenantService.maskRecord(competitorRecord, 'CPSE_ADMIN', 'A');

  // Own code must remain in clear text
  assert.strictEqual(maskedOwn.code, 'BOLT-10021');

  // Competitor code must be masked!
  assert.strictEqual(maskedCompetitor.code, '[MASKED: CPSE B]');

  // Super Admin sees all competitor codes in clear text
  const superAdminView = TenantService.maskRecord(competitorRecord, 'SUPER_ADMIN', undefined);
  assert.strictEqual(superAdminView.code, 'MAT-98231');
});

test('QuotaGuardService - Rate Limiting & Token Tracking', () => {
  QuotaGuardService.reset();
  const testKey = 'test_tenant_a';

  // Allow up to 3 requests with limit = 3
  const r1 = QuotaGuardService.checkQuota(testKey, 3);
  const r2 = QuotaGuardService.checkQuota(testKey, 3);
  const r3 = QuotaGuardService.checkQuota(testKey, 3);
  const r4 = QuotaGuardService.checkQuota(testKey, 3);

  assert.strictEqual(r1.allowed, true);
  assert.strictEqual(r2.allowed, true);
  assert.strictEqual(r3.allowed, true);
  assert.strictEqual(r4.allowed, false, '4th request should exceed quota');

  // Record token usage
  QuotaGuardService.recordTokenUsage(testKey, 1500);
  const r5 = QuotaGuardService.checkQuota(testKey, 10);
  assert.strictEqual(r5.tokensUsedToday, 1500);
});

test('HTTP Auth Endpoints - Login and Me Verification', async () => {
  const app = createApp();
  let server: Server;
  const port = 4999;

  await new Promise<void>((resolve) => {
    server = app.listen(port, () => resolve());
  });

  try {
    // 1. Test POST /api/v1/auth/login
    const loginRes = await fetch(`http://localhost:${port}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'MATERIAL_EXPERT' }),
    });

    assert.strictEqual(loginRes.status, 200);
    const loginData = (await loginRes.json()) as any;
    assert.strictEqual(loginData.status, 'success');
    assert.strictEqual(loginData.data.user.role, 'MATERIAL_EXPERT');
    const token = loginData.data.accessToken;

    // 2. Test GET /api/v1/auth/me with Bearer token
    const meRes = await fetch(`http://localhost:${port}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    assert.strictEqual(meRes.status, 200);
    const meData = (await meRes.json()) as any;
    assert.strictEqual(meData.data.user.role, 'MATERIAL_EXPERT');
    assert.ok(meData.data.user.permissions.includes('review'));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
