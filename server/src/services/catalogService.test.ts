import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CatalogService } from './catalogService';
import { createApp } from '../app';
import { Server } from 'http';

describe('CatalogService & "Ask Gemini" Query Engine', () => {
  it('interprets natural language query into structured attribute filters', async () => {
    const interpretation = await CatalogService.interpretQuery('4-inch gate valve 300 lb cf8m flanged');

    assert.equal(interpretation.category, 'GATE_VALVE');
    assert.equal(interpretation.attributes.size_in, 4);
    assert.equal(interpretation.attributes.pressure_class, 300);
    assert.ok(
      interpretation.attributes.body_material === 'CF8M' ||
        interpretation.attributes.body_material === 'SS316'
    );
    assert.ok(interpretation.explanation.length > 10);
    assert.ok(interpretation.searchTerms.length > 0);
  });

  it('interprets hex bolt queries with metric dimensions', async () => {
    const interpretation = await CatalogService.interpretQuery('hex bolt m16 x 50 stainless steel 304');

    assert.equal(interpretation.category, 'HEX_BOLT');
    assert.equal(interpretation.attributes.diameter, 16);
    assert.equal(interpretation.attributes.length, 50);
    assert.equal(interpretation.attributes.grade, 'SS304');
  });

  it('ranks exact attribute match higher than partial/conflicting attributes', async () => {
    const res = await CatalogService.searchCatalog({
      query: 'hex bolt m16 x 50 mm ss304',
    });

    assert.ok(res.results.length >= 2);
    // Top result must be SS304
    assert.equal(res.results[0].nmcCode, 'NMC-00000001');
    assert.equal(res.results[0].attributes.grade, 'SS304');
    assert.ok(res.results[0].score > res.results[1].score);

    // Second result should be SS316 with lower score
    assert.equal(res.results[1].nmcCode, 'NMC-00000002');
  });

  it('finds valve by nominal size and pressure rating', async () => {
    const res = await CatalogService.searchCatalog({
      query: 'gate valve 4 inch 300 lb',
    });

    assert.ok(res.results.length > 0);
    assert.equal(res.results[0].nmcCode, 'NMC-00000004');
    assert.ok(res.results[0].description.includes('4" 300 LB'));
  });

  it('filters catalog items by category and status', async () => {
    const res = await CatalogService.getMaterials({
      category: 'INDUCTION_MOTOR',
      status: 'APPROVED',
    });

    assert.ok(res.total >= 1);
    assert.ok(res.data.every(item => item.category === 'INDUCTION_MOTOR'));
    assert.ok(res.data.every(item => item.status === 'APPROVED'));
  });

  it('retrieves single material by ID with version lineage', async () => {
    const item = await CatalogService.getMaterialById('NMC-00000003');

    assert.ok(item);
    assert.equal(item.nmcCode, 'NMC-00000003');
    assert.equal(item.category, 'BALL_BEARING');
    assert.ok(item.versions && item.versions.length >= 1);

    const nonExistent = await CatalogService.getMaterialById('NMC-99999999');
    assert.equal(nonExistent, null);
  });

  it('handles HTTP AI search endpoint with structured response', async () => {
    const app = createApp();
    const server: Server = app.listen(0);
    const port = (server.address() as any).port;

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/materials/ai-search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: 'seamless pipe 4 inch sch 40',
        }),
      });

      assert.equal(response.status, 200);
      const data = await response.json();
      assert.equal(data.status, 'success');
      assert.equal(data.data.interpretation.category, 'SEAMLESS_PIPE');
      assert.ok(data.data.results.length > 0);
      assert.equal(data.data.results[0].nmcCode, 'NMC-00000007');
    } finally {
      server.close();
    }
  });

  it('handles HTTP catalog listing and single material retrieval', async () => {
    const app = createApp();
    const server: Server = app.listen(0);
    const port = (server.address() as any).port;

    try {
      // Test 1: GET /api/v1/materials
      const listRes = await fetch(`http://127.0.0.1:${port}/api/v1/materials?page=1&limit=5`);
      assert.equal(listRes.status, 200);
      const listData = await listRes.json();
      assert.equal(listData.status, 'success');
      assert.ok(listData.total > 0);
      assert.ok(listData.data.length <= 5);

      // Test 2: GET /api/v1/materials/:id
      const detailRes = await fetch(`http://127.0.0.1:${port}/api/v1/materials/NMC-00000001`);
      assert.equal(detailRes.status, 200);
      const detailData = await detailRes.json();
      assert.equal(detailData.status, 'success');
      assert.equal(detailData.data.nmcCode, 'NMC-00000001');

      // Test 3: GET non-existent
      const notFoundRes = await fetch(`http://127.0.0.1:${port}/api/v1/materials/NMC-NONEXISTENT`);
      assert.equal(notFoundRes.status, 404);

      // Test 4: GET /api/v1/mappings
      const mapRes = await fetch(`http://127.0.0.1:${port}/api/v1/mappings`);
      assert.equal(mapRes.status, 200);
      const mapData = await mapRes.json();
      assert.equal(mapData.status, 'success');
    } finally {
      server.close();
    }
  });
});
