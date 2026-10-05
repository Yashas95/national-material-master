import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { ProcurementService } from './procurementService';
import { createApp } from '../app';
import { AuthService } from './authService';

describe('Step 16: Procurement Aggregation & Gemini Sourcing Insights Service', () => {
  before(() => {
    ProcurementService.init();
  });

  it('aggregates cross-CPSE procurement opportunities with valid spend and demand', async () => {
    const result = await ProcurementService.getOpportunities({ limit: 10 });

    assert.ok(result.total > 0, 'Must have aggregated opportunities');
    assert.ok(result.data.length > 0);

    const first = result.data[0];
    assert.ok(first.clusterKey);
    assert.ok(first.nationalMaterialCode.startsWith('NMC-'));
    assert.ok(first.standardDescription);
    assert.ok(first.cpseCount >= 2, 'Must involve at least 2 CPSEs');
    assert.ok(first.demand > 0);
    assert.ok(first.spend > 0);
    assert.ok(first.priceMin > 0);
    assert.ok(first.priceMax >= first.priceMin);
    assert.ok(first.spread >= 0);
    assert.ok(first.rows.length >= 2);
  });

  it('filters opportunities by category, minCpses, and minimum spend', async () => {
    const bearings = await ProcurementService.getOpportunities({ category: 'BALL_BEARING' });
    assert.ok(bearings.total > 0);
    assert.ok(bearings.data.every(item => item.category === 'BALL_BEARING'));

    const min3 = await ProcurementService.getOpportunities({ minCpses: 3 });
    assert.ok(min3.data.every(item => item.cpseCount >= 3));

    const highSpend = await ProcurementService.getOpportunities({ minSpend: 1000000 });
    assert.ok(highSpend.data.every(item => item.spend >= 1000000));
  });

  it('supports keyword search across description, code, and suppliers', async () => {
    const searchRes = await ProcurementService.getOpportunities({ q: 'BEARING' });
    assert.ok(searchRes.total > 0);
    assert.ok(
      searchRes.data.some(
        item =>
          item.standardDescription.includes('BEARING') ||
          item.category.includes('BEARING')
      )
    );
  });

  it('retrieves detailed opportunity dossier by clusterKey or NMC code', async () => {
    const list = await ProcurementService.getOpportunities({ limit: 1 });
    const target = list.data[0];

    const byKey = await ProcurementService.getOpportunity(target.clusterKey);
    assert.ok(byKey);
    assert.equal(byKey.clusterKey, target.clusterKey);
    assert.ok(byKey.rows.length >= 2);
    assert.ok(byKey.executiveBriefing, 'Must generate executive briefing');
    assert.ok(byKey.executiveBriefing.summary.length > 20);

    const byCode = await ProcurementService.getOpportunity(target.nationalMaterialCode);
    assert.ok(byCode);
    assert.equal(byCode.clusterKey, target.clusterKey);
  });

  it('enforces multi-tenant scoping for CPSE administrators', async () => {
    const { user: cpseAUser } = AuthService.loginAsRole('CPSE_ADMIN', 'A');
    const resultA = await ProcurementService.getOpportunities({}, cpseAUser);

    assert.ok(resultA.data.every(item => item.rows.some(r => r.cpse === 'A')));

    // If CPSE B has an opportunity where CPSE A doesn't participate, CPSE A cannot access it
    const all = await ProcurementService.getOpportunities({ limit: 100 });
    const nonA = all.data.find(item => !item.rows.some(r => r.cpse === 'A'));

    if (nonA) {
      const forbidden = await ProcurementService.getOpportunity(nonA.clusterKey, cpseAUser);
      assert.equal(forbidden, null, 'CPSE A must not access opportunities without CPSE A participation');
    }
  });

  it('synthesizes auditor-grade Gemini executive briefing without speculative savings', async () => {
    const list = await ProcurementService.getOpportunities({ limit: 1 });
    const opp = list.data[0];

    const briefing = await ProcurementService.generateExecutiveBriefing(opp, true);

    assert.ok(briefing.summary.length > 20);
    assert.ok(briefing.volumeConsolidationAdvice.length > 10);
    assert.ok(briefing.supplierRationalizationAdvice.length > 10);
    assert.ok(briefing.priceVarianceExplanation.length > 10);
    assert.ok(briefing.contractNegotiationLeverage.length > 10);
    assert.ok(briefing.riskDisclaimer.length > 20);
    assert.ok(
      briefing.riskDisclaimer.toLowerCase().includes('no savings') ||
      briefing.riskDisclaimer.toLowerCase().includes('disclaimer') ||
      briefing.riskDisclaimer.toLowerCase().includes('contract')
    );
    assert.ok(briefing.generatedBy === 'GEMINI_AI' || briefing.generatedBy === 'DETERMINISTIC_ENGINE');
  });

  it('calculates macro procurement KPI statistics', async () => {
    const stats = await ProcurementService.getProcurementStats();

    assert.ok(stats.totalOpportunities > 0);
    assert.ok(stats.totalCrossCpseSpend > 0);
    assert.ok(stats.averagePriceSpread >= 0);
    assert.ok(stats.topSharedSuppliers.length > 0);
    assert.ok(stats.topCategories.length > 0);
  });
});

describe('Step 16: HTTP Procurement Routes & Permission Enforcement', () => {
  const app = createApp();

  it('GET /api/v1/procurement/opportunities returns ranked cross-CPSE list', async () => {
    const { accessToken } = AuthService.loginAsRole('PROCUREMENT_OFFICER');

    const server = app.listen(0);
    const address = server.address() as any;
    const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;

    try {
      const res = await fetch(`${baseUrl}/procurement/opportunities?limit=5`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.status, 'success');
      assert.ok(Array.isArray(json.data));
      assert.ok(json.total > 0);
      assert.equal(json.data.length, 5);
    } finally {
      server.close();
    }
  });

  it('GET /api/v1/procurement/opportunities/:key returns dossier with executive briefing', async () => {
    const { accessToken } = AuthService.loginAsRole('PROCUREMENT_OFFICER');

    const list = await ProcurementService.getOpportunities({ limit: 1 });
    const sample = list.data[0];

    const server = app.listen(0);
    const address = server.address() as any;
    const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;

    try {
      const res = await fetch(
        `${baseUrl}/procurement/opportunities/${encodeURIComponent(sample.clusterKey)}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.status, 'success');
      assert.equal(json.data.clusterKey, sample.clusterKey);
      assert.ok(json.data.executiveBriefing);
      assert.ok(json.data.executiveBriefing.summary);
    } finally {
      server.close();
    }
  });

  it('POST /api/v1/procurement/insights generates or refreshes Gemini briefing', async () => {
    const { accessToken } = AuthService.loginAsRole('SUPER_ADMIN');

    const list = await ProcurementService.getOpportunities({ limit: 1 });
    const sample = list.data[0];

    const server = app.listen(0);
    const address = server.address() as any;
    const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;

    try {
      const res = await fetch(`${baseUrl}/procurement/insights`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          clusterKey: sample.clusterKey,
          forceRefresh: true,
        }),
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.status, 'success');
      assert.equal(json.data.clusterKey, sample.clusterKey);
      assert.ok(json.data.briefing);
      assert.ok(json.data.briefing.volumeConsolidationAdvice);
    } finally {
      server.close();
    }
  });

  it('GET /api/v1/procurement/stats returns macro KPI analytics', async () => {
    const { accessToken } = AuthService.loginAsRole('AUDITOR');

    const server = app.listen(0);
    const address = server.address() as any;
    const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;

    try {
      const res = await fetch(`${baseUrl}/procurement/stats`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.status, 'success');
      assert.ok(json.data.totalOpportunities > 0);
      assert.ok(json.data.totalCrossCpseSpend > 0);
    } finally {
      server.close();
    }
  });

  it('blocks unprivileged roles lacking procurement_view permission', async () => {
    const { accessToken } = AuthService.loginAsRole('VIEWER');

    const server = app.listen(0);
    const address = server.address() as any;
    const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;

    try {
      const res = await fetch(`${baseUrl}/procurement/opportunities`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      assert.equal(res.status, 403);
      const json = await res.json();
      assert.equal(json.status, 'error');
      assert.ok(json.message.includes('Forbidden') || json.message.includes('permissions'));
    } finally {
      server.close();
    }
  });
});
