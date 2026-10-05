import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { IntakeService } from './intakeService';
import { AuthService } from './authService';
import { createApp } from '../app';
import { Server } from 'http';

describe('IntakeService & Ingestion Pipeline', () => {
  beforeEach(() => {
    IntakeService.clearCache();
  });

  const SAMPLE_CSV = `cpse,code,description,unit,price,qty,supplier,year
E,HE/BLT/09001,"BOLT HEX M16 X 50 MM, SS304, ISO 4014",EA,29.40,1500,Deccan Fasteners,2026
B,MAT-99120,"BALL BEARING 6205 2RSH MAKE KAVERI",NOS,1320,300,Kaveri Bearing Co,2026
D,FM-30411,"GATE VALVE DN100 300 LB CF8M FLANGED",NO,68000,6,Godavari Valves,2026
C,780115,"HEX HEAD BOLT M16 X 50 SS316",PCS,41,800,Vindhya Bolts,2026
A,MISC-10077,"SPARES AS PER OEM LIST",EA,,,,
Z,ZZ-1,"HEX BOLT M12X40 SS304",EA,12,100,Unknown,2026`;

  it('parses CSV with quoted commas and escaped quotes correctly', () => {
    const text =
      'cpse,code,description,unit\n' +
      'A,101,"VALVE, 2"" GATE, 150LB",EA\n' +
      'B,102,"BEARING 6205, 2RS",NOS';
    const rows = IntakeService.parseCSV(text);

    assert.equal(rows.length, 3);
    assert.equal(rows[0][2], 'description');
    assert.equal(rows[1][2], 'VALVE, 2" GATE, 150LB');
    assert.equal(rows[2][2], 'BEARING 6205, 2RS');
  });

  it('validates CSV headers and identifies missing required columns', () => {
    const badCSV = 'cpse,code,price\nA,101,500';
    const res = IntakeService.parseContent(badCSV, 'test.csv');

    assert.ok(res.missingColumns.includes('description'));
    assert.ok(res.missingColumns.includes('unit'));
  });

  it('rejects unknown CPSE and malformed row count', async () => {
    const report = await IntakeService.processIntake(SAMPLE_CSV, 'sample.csv', { dryRun: true });

    assert.equal(report.success, true);
    assert.equal(report.totalRows, 6);
    // Row Z should be rejected
    const cpseRejection = report.rejected.find(r => r.reason.includes('Unknown CPSE "Z"'));
    assert.ok(cpseRejection, 'Unknown CPSE "Z" must be rejected');

    // 5 valid CPSE rows accepted
    assert.equal(report.acceptedCount, 5);
  });

  it('enforces multi-tenant isolation for CPSE_ADMIN', async () => {
    const { user: cpseAdmin } = AuthService.loginAsRole('CPSE_ADMIN', 'A'); // Tenant IOCL / CPSE A
    const report = await IntakeService.processIntake(SAMPLE_CSV, 'sample.csv', {
      dryRun: true,
      user: cpseAdmin,
    });

    // CPSE Admin can only ingest rows belonging to CPSE A
    assert.equal(report.acceptedCount, 1);
    assert.equal(report.accepted[0].cpseId, 'A');

    // Foreign CPSE rows (E, B, D, C) must be rejected with tenant isolation notice
    const foreignRejections = report.rejected.filter(r =>
      r.reason.includes('A CPSE administrator can only upload')
    );
    assert.equal(foreignRejections.length, 4);
  });

  it('permits cross-enterprise ingestion for SUPER_ADMIN', async () => {
    const { user: superAdmin } = AuthService.loginAsRole('SUPER_ADMIN');
    const report = await IntakeService.processIntake(SAMPLE_CSV, 'sample.csv', {
      dryRun: true,
      user: superAdmin,
    });

    // Rows for E, B, D, C, A should all be accepted
    assert.equal(report.acceptedCount, 5);
    const acceptedCpses = new Set(report.accepted.map(r => r.cpseId));
    assert.ok(acceptedCpses.has('A'));
    assert.ok(acceptedCpses.has('B'));
    assert.ok(acceptedCpses.has('C'));
    assert.ok(acceptedCpses.has('D'));
    assert.ok(acceptedCpses.has('E'));
  });

  it('parses JSON format catalogs cleanly', async () => {
    const jsonCatalog = JSON.stringify({
      records: [
        {
          CPSE: 'PETRO',
          Code: 'PIPE-001',
          Description: 'PIPE SEAMLESS 4 INCH SCH 40 ASTM A106 GR B',
          UOM: 'MTR',
          Price: 3500,
          Qty: 50,
        },
        {
          CPSE: 'POWER',
          Code: 'MTR-501',
          Description: 'INDUCTION MOTOR 15 KW 415 V 4 POLE FOOT MOUNTED',
          UOM: 'NOS',
          Price: 65000,
          Qty: 2,
        },
      ],
    });

    const report = await IntakeService.processIntake(jsonCatalog, 'catalog.json', { dryRun: true });

    assert.equal(report.success, true);
    assert.equal(report.acceptedCount, 2);
    assert.equal(report.accepted[0].category, 'SEAMLESS_PIPE');
    assert.ok(String(report.accepted[0].attrs.schedule).includes('40'));
    assert.equal(report.accepted[1].category, 'INDUCTION_MOTOR');
    assert.equal(report.accepted[1].attrs.power_kw, 15);
  });

  it('detects duplicate uploads idempotently', async () => {
    const csvContent = 'cpse,code,description,unit\nA,BOLT-1,HEX BOLT M16 X 50 SS304,EA';
    const report1 = await IntakeService.processIntake(csvContent, 'upload.csv', { dryRun: false });
    assert.equal(report1.duplicateUpload, false);

    const report2 = await IntakeService.processIntake(csvContent, 'upload.csv', { dryRun: false });
    assert.equal(report2.duplicateUpload, true);
    assert.equal(report2.acceptedCount, 0);
  });

  it('flags unclassified descriptions and missing critical attributes', async () => {
    const incompleteCSV = `cpse,code,description,unit
A,INC-1,"HEX BOLT M16 SS304",EA
A,INC-2,"SPARES AS PER DRAWING SPECIFICATIONS",EA`;

    const report = await IntakeService.processIntake(incompleteCSV, 'incomplete.csv', { dryRun: true });

    assert.equal(report.acceptedCount, 2);
    const boltRecord = report.accepted.find(r => r.code === 'INC-1');
    assert.ok(boltRecord);
    assert.equal(boltRecord.outcome.status, 'NEEDS_REVIEW');
    assert.ok(boltRecord.missingCritical.includes('length'));

    const unclassRecord = report.accepted.find(r => r.code === 'INC-2');
    assert.ok(unclassRecord);
    assert.equal(unclassRecord.outcome.status, 'UNCLASSIFIED');
    assert.equal(unclassRecord.category, 'UNCLASSIFIED');
  });

  it('handles HTTP paste endpoint with auth token and dryRun preview', async () => {
    const app = createApp();
    const server: Server = app.listen(0);
    const port = (server.address() as any).port;

    try {
      const { accessToken: token } = AuthService.loginAsRole('SUPER_ADMIN');

      const response = await fetch(`http://127.0.0.1:${port}/api/v1/intake/paste`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          text: 'cpse,code,description,unit,price,qty\nB,MAT-100,"BALL BEARING 6205 2RS",NOS,850,20',
          filename: 'test-paste.csv',
          dryRun: true,
        }),
      });

      assert.equal(response.status, 200);
      const data = await response.json();
      assert.equal(data.status, 'success');
      assert.equal(data.data.acceptedCount, 1);
      assert.equal(data.data.accepted[0].category, 'BALL_BEARING');
      assert.equal(data.data.accepted[0].attrs.bearing_no, '6205');
    } finally {
      server.close();
    }
  });

  it('rejects intake request without proper upload permission (RBAC)', async () => {
    const app = createApp();
    const server: Server = app.listen(0);
    const port = (server.address() as any).port;

    try {
      const { accessToken: token } = AuthService.loginAsRole('VIEWER'); // VIEWER cannot upload

      const response = await fetch(`http://127.0.0.1:${port}/api/v1/intake/paste`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          text: 'cpse,code,description,unit\nA,1,HEX BOLT M16 X 50,EA',
        }),
      });

      assert.equal(response.status, 403);
      const data = await response.json();
      assert.equal(data.status, 'error');
      assert.ok(data.message.includes('Forbidden') || data.message.includes('lacks required permissions'));
    } finally {
      server.close();
    }
  });
});
