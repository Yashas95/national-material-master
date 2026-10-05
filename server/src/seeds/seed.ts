import path from 'path';
import { prisma } from '../config/db';

const pipelinePath = path.resolve(__dirname, '../../../js/pipeline.js');
require(pipelinePath);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const N = (globalThis as any).NUMMF;

export async function seedDatabase() {
  console.log('\n🌱 [Seed] Starting NUMMF Database Seeding...');

  try {
    console.log('   Cleaning existing records...');
    await prisma.procurementOpportunity.deleteMany();
    await prisma.procurementHistory.deleteMany();
    await prisma.materialMapping.deleteMany();
    await prisma.materialVersion.deleteMany();
    await prisma.legacyRecord.deleteMany();
    await prisma.nationalMaterial.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.engineConfig.deleteMany();
    await prisma.cpse.deleteMany();

    console.log(`   Seeding ${N.CPSES.length} CPSE enterprises...`);
    for (const c of N.CPSES) {
      await prisma.cpse.create({
        data: {
          id: c.id,
          short: c.short,
          name: c.name,
          sector: c.sector,
          erp: c.erp,
          format: c.format,
          color: c.color,
        },
      });
    }

    console.log('   Seeding baseline matching engine configuration...');
    await prisma.engineConfig.create({
      data: {
        id: 'active',
        weights: N.DEFAULT_CONFIG.weights,
        thresholds: N.DEFAULT_CONFIG.thresholds,
        rules: N.DOMAIN_RULES,
        updatedBy: 'System Bootstrap',
      },
    });

    console.log('   Generating synthetic legacy records (seed: 2026)...');
    const dataset = N.generate(2026);
    const records = dataset.records;
    console.log(`   Generated ${records.length} records across all CPSEs.`);

    console.log('   Inserting legacy ERP records...');
    const legacyRecordsData = records.map((r: any) => ({
      id: r.id,
      cpseId: r.cpse,
      code: r.code,
      rawDesc: r.raw,
      normDesc: r.norm,
      category: r.category,
      attrs: r.attrs || {},
      unit: r.unit || null,
      unitFamily: r.unitInfo?.family || null,
      unitFactor: r.unitInfo?.factor || null,
      unitCanon: r.unitInfo?.canon || null,
      source: r.source || 'Synthetic baseline 2026',
      status: 'INGESTED',
    }));

    await prisma.legacyRecord.createMany({
      data: legacyRecordsData,
      skipDuplicates: true,
    });

    console.log('   Inserting procurement purchase order histories...');
    const poHistoryData: any[] = [];
    for (const r of records) {
      if (r.history && Array.isArray(r.history)) {
        for (const h of r.history) {
          poHistoryData.push({
            legacyRecordId: r.id,
            poNumber: h.po || null,
            price: Number(h.price) || 0,
            qty: Number(h.qty) || 0,
            unit: r.unit || null,
            supplier: String(h.supplier || 'Standard Vendor'),
            poDate: h.date ? new Date(h.date) : null,
          });
        }
      }
    }

    if (poHistoryData.length > 0) {
      const chunkSize = 500;
      for (let i = 0; i < poHistoryData.length; i += chunkSize) {
        await prisma.procurementHistory.createMany({
          data: poHistoryData.slice(i, i + chunkSize),
        });
      }
      console.log(`   Inserted ${poHistoryData.length} purchase order records.`);
    }

    console.log('   Executing NUMMF matching & clustering engine...');
    const res = N.run(records, N.DEFAULT_CONFIG);
    console.log(`   Generated ${res.clusters.length} National Material clusters.`);

    let nextCode = 1;
    const clusterMap = new Map<string, string>();

    for (const c of res.clusters) {
      const codeNum = nextCode++;
      const nmcCode = `NMC-${String(codeNum).padStart(8, '0')}`;
      const isApproved = c.key === N.DEMO_BOLT_KEY || c.key === N.DEMO_BEARING_KEY || c.band === 'STRONG';

      const nm = await prisma.nationalMaterial.create({
        data: {
          clusterKey: c.key,
          nmcCode,
          codeNumber: codeNum,
          category: c.category,
          stdDesc: c.stdDesc,
          criticalAttrs: c.criticalAttrs || {},
          status: isApproved ? 'APPROVED' : 'PENDING',
          version: 1,
          approvedBy: isApproved ? 'R. Iyer (Material expert)' : null,
          approvedAt: isApproved ? new Date() : null,
          notes: isApproved ? 'Auto-approved high-confidence canonical cluster' : null,
        },
      });

      clusterMap.set(c.key, nm.id);

      for (const recId of c.members) {
        await prisma.materialMapping.create({
          data: {
            nationalMaterialId: nm.id,
            legacyRecordId: recId,
            confidenceScore: c.band === 'STRONG' ? 0.98 : 0.85,
            matchType: 'EXACT_MATCH',
            explanation: {
              reasons: [`All ${N.CATEGORIES[c.category]?.critical?.length || 0} critical attributes match canonical specification.`],
              band: c.band,
            },
            status: isApproved ? 'APPROVED' : 'PENDING',
            reviewedBy: isApproved ? 'R. Iyer' : null,
            reviewedAt: isApproved ? new Date() : null,
          },
        });
      }
    }

    console.log(`   Mapping ${res.attachments.length} incomplete attachment records...`);
    for (const a of res.attachments) {
      const nmId = clusterMap.get(a.clusterKey);
      if (nmId) {
        await prisma.materialMapping.create({
          data: {
            nationalMaterialId: nmId,
            legacyRecordId: a.recordId,
            confidenceScore: a.score || 0.75,
            matchType: 'ATTACHMENT',
            explanation: {
              reasons: [a.reason || 'Missing non-critical attributes mapped with reviewer confirmation.'],
              candidates: a.candidates || [],
            },
            status: 'PENDING',
          },
        });
      }
    }

    console.log(`   Seeding ${res.procurement.length} cross-CPSE procurement opportunities...`);
    for (const p of res.procurement) {
      const nmId = clusterMap.get(p.clusterKey);
      if (nmId) {
        await prisma.procurementOpportunity.create({
          data: {
            nationalMaterialId: nmId,
            combinedDemand: p.demand || 0,
            unit: p.unit || 'EA',
            priceMin: p.priceMin || 0,
            priceMax: p.priceMax || 0,
            priceSpreadPct: p.priceMin && p.priceMax ? ((p.priceMax - p.priceMin) / p.priceMin) * 100 : 0,
            participatingCpses: p.rows ? p.rows.map((r: any) => r.cpse) : [],
            sharedSuppliers: p.suppliers || [],
            score: p.score || 0,
          },
        });
      }
    }

    console.log('   Creating baseline audit trail...');
    const auditLogsData = [
      {
        id: 'AUD-000001',
        action: 'SYSTEM_BOOTSTRAP',
        target: 'NUMMF Platform',
        actor: 'System Admin',
        role: 'Super administrator',
        detail: 'Initial National Unified Material Master platform bootstrap completed.',
      },
      {
        id: 'AUD-000002',
        action: 'DATASET_INGESTED',
        target: 'All CPSEs',
        actor: 'Harmonization Service',
        role: 'System',
        detail: `Ingested ${records.length} legacy records across ${N.CPSES.length} CPSE enterprises.`,
      },
      {
        id: 'AUD-000003',
        action: 'PIPELINE_RUN',
        target: 'Clustering Engine',
        actor: 'Matching Engine',
        role: 'System',
        detail: `Generated ${res.clusters.length} National Material candidates with 100% precision.`,
      },
      {
        id: 'AUD-000004',
        action: 'NMC_APPROVED',
        target: 'NMC-00000001',
        actor: 'R. Iyer',
        role: 'Material expert',
        detail: 'Approved HEXAGON HEAD BOLT M16 X 50 MM SS304 mapping across 4 CPSE legacy records.',
      },
    ];

    for (const a of auditLogsData) {
      await prisma.auditLog.create({
        data: a,
      });
    }

    console.log('\n🎉 [Seed] NUMMF Database successfully seeded!');
    console.log(`   - CPSEs: ${N.CPSES.length}`);
    console.log(`   - Legacy Records: ${records.length}`);
    console.log(`   - Purchase Orders: ${poHistoryData.length}`);
    console.log(`   - National Materials: ${res.clusters.length}`);
    console.log(`   - Procurement Opportunities: ${res.procurement.length}`);
  } catch (error) {
    console.error('❌ [Seed Error] Failed to seed database:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  seedDatabase().catch(() => process.exit(1));
}
