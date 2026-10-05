import path from 'path';
import { GoogleGenAI } from '@google/genai';
import { config } from '../config/env';
import { prisma } from '../config/db';
import { AuthUser } from '../models/auth';
import {
  CpseProcurementRow,
  GeminiExecutiveBriefing,
  ProcurementFilterParams,
  ProcurementOpportunity,
  ProcurementStats,
} from '../models/procurement';

try {
  const pipelinePath = path.resolve(__dirname, '../../../js/pipeline.js');
  require(pipelinePath);
} catch {}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const N = (globalThis as any).NUMMF;

export class ProcurementService {
  private static geminiClient: GoogleGenAI | null = null;
  private static opportunitiesCache: ProcurementOpportunity[] = [];
  private static briefingsCache: Map<string, GeminiExecutiveBriefing> = new Map();
  private static initialized = false;

  private static getGeminiClient(): GoogleGenAI | null {
    if (!this.geminiClient && config.gemini.isConfigured) {
      this.geminiClient = new GoogleGenAI({ apiKey: config.gemini.apiKey });
    }
    return this.geminiClient;
  }

  static init(): void {
    if (this.initialized && this.opportunitiesCache.length > 0) return;

    if (!N) {
      console.warn('⚠️  [ProcurementService] NUMMF engine not found on globalThis');
      return;
    }

    try {
      const dataset = N.generate(2026);
      const res = N.run(dataset.records, N.DEFAULT_CONFIG);

      const items: ProcurementOpportunity[] = [];
      let codeCounter = 1;

      for (const p of res.procurement) {
        const cluster = res.clusterByKey.get(p.clusterKey);
        const nmcCode = `NMC-${String(codeCounter++).padStart(8, '0')}`;
        const stdDesc = cluster ? cluster.stdDesc : p.clusterKey.replace(/\|/g, ' ');
        const category = cluster ? cluster.category : 'GENERAL';

        const rows: CpseProcurementRow[] = (p.rows || []).map((r: any) => ({
          cpse: r.cpse,
          qty: r.qty,
          spend: r.spend,
          pos: r.pos,
          price: r.price,
          suppliers: r.suppliers || [],
        }));

        items.push({
          clusterKey: p.clusterKey,
          nationalMaterialCode: nmcCode,
          standardDescription: stdDesc,
          category,
          unit: p.unit || 'EA',
          rows,
          cpseCount: p.cpseCount || rows.length,
          demand: p.demand,
          spend: p.spend,
          pos: p.pos,
          priceMin: p.priceMin,
          priceMax: p.priceMax,
          spread: p.spread,
          supplierOverlap: p.supplierOverlap || 0,
          suppliers: p.suppliers || [],
          excluded: p.excluded || 0,
          outlier: !!p.outlier,
          score: p.score || 0,
        });
      }

      this.opportunitiesCache = items;
      this.initialized = true;
    } catch (err) {
      console.error('❌ [ProcurementService] Error initializing procurement cache:', err);
    }
  }

  static async getOpportunities(
    params: ProcurementFilterParams = {},
    user?: AuthUser | null
  ): Promise<{
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    data: ProcurementOpportunity[];
  }> {
    this.init();

    let list = [...this.opportunitiesCache];

    if (user && user.role === 'CPSE_ADMIN' && user.tenantId) {
      list = list.filter(item => item.rows.some(r => r.cpse === user.tenantId));
    }

    if (params.category) {
      list = list.filter(item => item.category.toLowerCase() === params.category!.toLowerCase());
    }

    if (params.minCpses && params.minCpses > 1) {
      list = list.filter(item => item.cpseCount >= params.minCpses!);
    }

    if (params.minSpend && params.minSpend > 0) {
      list = list.filter(item => item.spend >= params.minSpend!);
    }

    if (params.outliersOnly) {
      list = list.filter(item => item.outlier);
    }

    if (params.q) {
      const query = params.q.toLowerCase().trim();
      list = list.filter(
        item =>
          item.standardDescription.toLowerCase().includes(query) ||
          item.nationalMaterialCode.toLowerCase().includes(query) ||
          item.category.toLowerCase().includes(query) ||
          item.suppliers.some(s => s.toLowerCase().includes(query))
      );
    }

    const total = list.length;
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const totalPages = Math.ceil(total / limit) || 1;
    const offset = (page - 1) * limit;

    const pagedItems = list.slice(offset, offset + limit);

    return {
      total,
      page,
      limit,
      totalPages,
      data: pagedItems,
    };
  }

  static async getOpportunity(
    keyOrCode: string,
    user?: AuthUser | null
  ): Promise<ProcurementOpportunity | null> {
    this.init();

    const opp = this.opportunitiesCache.find(
      item => item.clusterKey === keyOrCode || item.nationalMaterialCode === keyOrCode
    );

    if (!opp) return null;

    if (user && user.role === 'CPSE_ADMIN' && user.tenantId) {
      const hasCpse = opp.rows.some(r => r.cpse === user.tenantId);
      if (!hasCpse) return null;
    }

    if (!opp.executiveBriefing) {
      opp.executiveBriefing = await this.generateExecutiveBriefing(opp);
    }

    return opp;
  }

  static async generateExecutiveBriefing(
    opp: ProcurementOpportunity,
    forceRefresh = false
  ): Promise<GeminiExecutiveBriefing> {
    if (!forceRefresh && this.briefingsCache.has(opp.clusterKey)) {
      return this.briefingsCache.get(opp.clusterKey)!;
    }

    const gemini = this.getGeminiClient();

    if (gemini) {
      try {
        const prompt = `You are the Principal Sourcing & Procurement Advisor to the Ministry of Heavy Industries and Standing Conference of Public Enterprises (SCOPE), Government of India.
Synthesize an executive briefing note for National Material Code ${opp.nationalMaterialCode}:

MATERIAL SPECIFICATION:
- Description: "${opp.standardDescription}"
- Category: ${opp.category}
- Canonical Unit of Measure: ${opp.unit}

CROSS-CPSE PROCUREMENT FACTS:
- Participating CPSEs (${opp.cpseCount}): ${opp.rows.map(r => `CPSE ${r.cpse} (Spend: ₹${r.spend.toLocaleString('en-IN')}, Demand: ${r.qty} ${opp.unit}, Avg Unit Price: ₹${r.price.toFixed(2)}, Suppliers: ${r.suppliers.join(', ')})`).join('; ')}
- Total Aggregated Demand: ${opp.demand.toLocaleString('en-IN')} ${opp.unit}
- Total Historical Spend: ₹${opp.spend.toLocaleString('en-IN')}
- Unit Price Range: ₹${opp.priceMin.toFixed(2)} to ₹${opp.priceMax.toFixed(2)} (${Math.round(opp.spread * 100)}% price spread)
- Total Purchase Orders: ${opp.pos}
- Shared Supplier Overlap: ${Math.round(opp.supplierOverlap * 100)}% (${opp.suppliers.join(', ')})
${opp.outlier ? '- Note: Significant price variance detected (>150% spread); review contract terms, delivery locations, and pack sizes.' : ''}

REGULATORY MANDATES:
1. Advise on strategic sourcing: volume consolidation, rate contract harmonization (GeM), and supplier rationalization.
2. STRICT GOVERNANCE MANDATE: DO NOT make unsubstantiated or speculative savings claims (e.g., "Will save ₹50 Lakhs"). Prices vary legitimately by delivery terms, freight, plant delivery locations, order volume, and order year. Emphasize negotiation leverage and process efficiency instead of guaranteed rupee savings.

Return ONLY a valid JSON object matching this schema:
{
  "summary": "2-3 sentence executive briefing note",
  "volumeConsolidationAdvice": "Strategic recommendation on joint rate contracts or GeM collective buying",
  "supplierRationalizationAdvice": "Observation on shared vs disjoint suppliers across CPSEs",
  "priceVarianceExplanation": "Contextual reason for the price difference between CPSEs",
  "contractNegotiationLeverage": "Specific leverage points buyers can use in upcoming tenders",
  "riskDisclaimer": "Standard audit notice regarding plant-specific freight, quantities, and contract terms."
}`;

        const response = await gemini.models.generateContent({
          model: config.gemini.model,
          contents: prompt,
          config: {
            temperature: 0.1,
            maxOutputTokens: 600,
          },
        });

        const text = response.text || '';
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          const briefing: GeminiExecutiveBriefing = {
            summary: parsed.summary || 'Cross-CPSE procurement opportunity identified.',
            volumeConsolidationAdvice: parsed.volumeConsolidationAdvice || 'Evaluate joint tender consolidation across participating CPSEs.',
            supplierRationalizationAdvice: parsed.supplierRationalizationAdvice || 'Cross-qualify verified suppliers to increase bidding competition.',
            priceVarianceExplanation: parsed.priceVarianceExplanation || 'Price spread is influenced by differing freight terms and delivery order lots.',
            contractNegotiationLeverage: parsed.contractNegotiationLeverage || 'Use the lowest observed unit price as a benchmark for multi-year tenders.',
            riskDisclaimer: parsed.riskDisclaimer || 'Potential opportunity for aggregation and supplier rationalisation. No savings figure is guaranteed: prices differ legitimately by plant location, delivery period, order quantity, and commercial terms.',
            generatedBy: 'GEMINI_AI',
          };

          this.briefingsCache.set(opp.clusterKey, briefing);
          return briefing;
        }
      } catch (err) {
        console.warn('⚠️  [ProcurementService] Gemini briefing call failed, falling back to deterministic synthesis:', (err as Error).message);
      }
    }

    const fallbackBriefing = this.generateDeterministicBriefing(opp);
    this.briefingsCache.set(opp.clusterKey, fallbackBriefing);
    return fallbackBriefing;
  }

  private static generateDeterministicBriefing(opp: ProcurementOpportunity): GeminiExecutiveBriefing {
    const spreadPct = Math.round(opp.spread * 100);
    const cpsesList = opp.rows.map(r => `CPSE ${r.cpse}`).join(', ');

    return {
      summary: `${opp.cpseCount} CPSEs (${cpsesList}) currently procure "${opp.standardDescription}" independently with a combined historical spend of ₹${(opp.spend / 1e5).toFixed(2)} Lakhs across ${opp.pos} purchase orders. Unit prices vary from ₹${opp.priceMin.toFixed(2)} to ₹${opp.priceMax.toFixed(2)} (${spreadPct}% spread).`,
      volumeConsolidationAdvice: `Harmonizing specifications under ${opp.nationalMaterialCode} enables unified demand aggregation of ${opp.demand.toLocaleString('en-IN')} ${opp.unit}. The central procurement cell should evaluate establishing a joint rate contract or common GeM catalogue entry.`,
      supplierRationalizationAdvice:
        opp.supplierOverlap > 0.3
          ? `High supplier commonality (${Math.round(opp.supplierOverlap * 100)}% shared vendors including ${opp.suppliers.slice(0, 3).join(', ')}). CPSEs can coordinate vendor performance ratings and benchmark terms.`
          : `Disjoint vendor bases across CPSEs (${opp.suppliers.length} distinct suppliers). Cross-qualifying established suppliers across all plants will increase competitive bidding density.`,
      priceVarianceExplanation: `The ${spreadPct}% price variance between ₹${opp.priceMin.toFixed(2)} and ₹${opp.priceMax.toFixed(2)} reflects differing plant delivery locations, shipment volumes, lot inspection requirements, and batch delivery schedules.`,
      contractNegotiationLeverage: `Buyers can benchmark against the lowest observed baseline of ₹${opp.priceMin.toFixed(2)}/${opp.unit} when negotiating multi-year supply agreements for ${opp.demand.toLocaleString('en-IN')} ${opp.unit}.`,
      riskDisclaimer: `Potential opportunity for aggregation and supplier rationalisation. No savings figure is guaranteed: prices differ legitimately by plant location, delivery period, order quantity, and commercial terms.`,
      generatedBy: 'DETERMINISTIC_ENGINE',
    };
  }

  static async getProcurementStats(): Promise<ProcurementStats> {
    this.init();

    const list = this.opportunitiesCache;
    const totalOpportunities = list.length;
    const totalCrossCpseSpend = list.reduce((sum, item) => sum + item.spend, 0);
    const averagePriceSpread =
      totalOpportunities > 0
        ? Math.round(list.reduce((sum, item) => sum + item.spread, 0) / totalOpportunities * 100) / 100
        : 0;

    const supplierMap = new Map<string, { cpseSet: Set<string>; spend: number }>();
    for (const item of list) {
      for (const row of item.rows) {
        for (const sup of row.suppliers) {
          const entry = supplierMap.get(sup) || { cpseSet: new Set(), spend: 0 };
          entry.cpseSet.add(row.cpse);
          entry.spend += row.spend / Math.max(1, row.suppliers.length);
          supplierMap.set(sup, entry);
        }
      }
    }

    const topSharedSuppliers = Array.from(supplierMap.entries())
      .map(([supplier, val]) => ({
        supplier,
        cpseCount: val.cpseSet.size,
        spend: Math.round(val.spend),
      }))
      .sort((a, b) => b.cpseCount - a.cpseCount || b.spend - a.spend)
      .slice(0, 10);

    const categoryMap = new Map<string, { count: number; spend: number }>();
    for (const item of list) {
      const entry = categoryMap.get(item.category) || { count: 0, spend: 0 };
      entry.count += 1;
      entry.spend += item.spend;
      categoryMap.set(item.category, entry);
    }

    const topCategories = Array.from(categoryMap.entries())
      .map(([category, val]) => ({
        category,
        opportunitiesCount: val.count,
        totalSpend: val.spend,
      }))
      .sort((a, b) => b.totalSpend - a.totalSpend)
      .slice(0, 8);

    return {
      totalOpportunities,
      totalCrossCpseSpend,
      averagePriceSpread,
      topSharedSuppliers,
      topCategories,
    };
  }
}
