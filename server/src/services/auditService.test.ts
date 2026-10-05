import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AuditService } from './auditService';
import { AuthService } from './authService';
import { createApp } from '../app';
import { Server } from 'http';

describe('AuditService & AI Governance Compliance Logging', () => {
  it('logs immutable audit entries with timestamps and metadata', async () => {
    const entry = await AuditService.log({
      action: 'NMC_APPROVED',
      target: 'NMC-00000099',
      actor: 'R. Iyer',
      role: 'Material expert',
      detail: 'Approved canonical HEXAGON HEAD BOLT M20 X 60 MM SS316',
      extra: { category: 'HEX_BOLT', standard: 'ISO 4014' },
    });

    assert.ok(entry.id.startsWith('AUD-'));
    assert.equal(entry.action, 'NMC_APPROVED');
    assert.equal(entry.target, 'NMC-00000099');
    assert.equal(entry.actor, 'R. Iyer');
    assert.ok(entry.createdAt);
  });

  it('filters audit logs by action, free text, and role', async () => {
    // 1. Filter by action
    const byAction = await AuditService.getLogs({ action: 'FIRST_LEVEL_APPROVAL' });
    assert.ok(byAction.data.length >= 1);
    assert.ok(byAction.data.every(a => a.action === 'FIRST_LEVEL_APPROVAL'));

    // 2. Free-text search
    const byQuery = await AuditService.getLogs({ q: 'PETRO' });
    assert.ok(byQuery.data.length >= 1);
    assert.ok(
      byQuery.data.some(
        a => a.target.includes('PETRO') || a.actor.includes('PETRO') || a.detail.includes('PETRO')
      )
    );

    // 3. Filter by role
    const byRole = await AuditService.getLogs({ role: 'Super administrator' });
    assert.ok(byRole.data.length >= 1);
    assert.ok(byRole.data.every(a => a.role === 'Super administrator'));
  });

  it('generates compliant RFC-4180 CSV export', async () => {
    const { content, contentType, filename } = await AuditService.exportLogs({}, 'csv');

    assert.equal(contentType, 'text/csv');
    assert.ok(filename.startsWith('nummf-audit-export-'));
    assert.ok(filename.endsWith('.csv'));

    const lines = content.split('\n');
    assert.ok(lines.length >= 2);
    assert.equal(lines[0], 'Event ID,Timestamp,Actor,Role,Action,Target,Detail');
    assert.ok(content.includes('System Bootstrap'));
  });

  it('generates compliant JSON export document', async () => {
    const { content, contentType, filename } = await AuditService.exportLogs({}, 'json');

    assert.equal(contentType, 'application/json');
    assert.ok(filename.endsWith('.json'));

    const parsed = JSON.parse(content);
    assert.ok(Array.isArray(parsed));
    assert.ok(parsed.length >= 5);
    assert.ok(parsed[0].id);
    assert.ok(parsed[0].action);
  });

  it('computes compliance metrics including Rule R-01 prevented unsafe merges', async () => {
    const stats = await AuditService.getStats();

    assert.ok(stats.totalEvents >= 6);
    assert.ok(stats.uniqueActors >= 3);
    assert.ok(stats.preventedMerges >= 1, 'Must track unsafe merges prevented by Rule R-01');
    assert.ok(stats.geminiStats.totalAiActions >= 1);
    assert.ok(stats.geminiStats.estimatedTokens > 0);
  });

  it('handles HTTP audit endpoints with RBAC authorization', async () => {
    const app = createApp();
    const server: Server = app.listen(0);
    const port = (server.address() as any).port;

    try {
      const { accessToken: auditorToken } = AuthService.loginAsRole('AUDITOR');
      const { accessToken: viewerToken } = AuthService.loginAsRole('VIEWER');

      // 1. Authorized Auditor can access /audit/logs
      const logsRes = await fetch(`http://127.0.0.1:${port}/api/v1/audit/logs?page=1&limit=5`, {
        headers: { Authorization: `Bearer ${auditorToken}` },
      });
      assert.equal(logsRes.status, 200);
      const logsData = await logsRes.json();
      assert.equal(logsData.status, 'success');
      assert.ok(logsData.data.length > 0);

      // 2. Unauthorized Viewer is blocked with 403 Forbidden
      const forbiddenRes = await fetch(`http://127.0.0.1:${port}/api/v1/audit/logs`, {
        headers: { Authorization: `Bearer ${viewerToken}` },
      });
      assert.equal(forbiddenRes.status, 403);

      // 3. Authorized Auditor can fetch compliance stats
      const statsRes = await fetch(`http://127.0.0.1:${port}/api/v1/audit/stats`, {
        headers: { Authorization: `Bearer ${auditorToken}` },
      });
      assert.equal(statsRes.status, 200);
      const statsData = await statsRes.json();
      assert.equal(statsData.status, 'success');
      assert.ok(statsData.data.preventedMerges >= 1);

      // 4. Authorized Auditor can export CSV
      const exportRes = await fetch(`http://127.0.0.1:${port}/api/v1/audit/export?format=csv`, {
        headers: { Authorization: `Bearer ${auditorToken}` },
      });
      assert.equal(exportRes.status, 200);
      assert.ok(exportRes.headers.get('content-type')?.includes('text/csv'));
      const csvText = await exportRes.text();
      assert.ok(csvText.includes('Event ID'));

      // 5. Authorized user can record a custom audit entry
      const createRes = await fetch(`http://127.0.0.1:${port}/api/v1/audit/logs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${auditorToken}`,
        },
        body: JSON.stringify({
          action: 'POLICY_VERIFIED',
          target: 'NUMMF-R01-GUARD',
          detail: 'Auditor inspection confirmed zero tolerance for metallurgy conflicts.',
        }),
      });
      assert.equal(createRes.status, 201);
      const createData = await createRes.json();
      assert.equal(createData.status, 'success');
      assert.equal(createData.data.action, 'POLICY_VERIFIED');
    } finally {
      server.close();
    }
  });
});
