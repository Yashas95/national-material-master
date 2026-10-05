import { GoogleGenAI, Type } from '@google/genai';
import { prisma } from '../config/db';
import { config } from '../config/env';
import { AuthUser } from '../models/auth';
import {
  QueryInterpretation,
  CatalogSearchResultItem,
  CatalogSearchResponse,
} from '../models/catalog';
import { NormalizationService } from './normalizationService';
import { ExtractionService, CATEGORY_DEFINITIONS } from './extractionService';
import { EmbeddingService } from './embeddingService';
import { DecisionService } from './decisionService';

export interface CatalogItem {
  id: string;
  nmcCode: string;
  category: string;
  stdDesc: string;
  criticalAttrs: Record<string, unknown>;
  status: string;
  version: number;
  approvedBy?: string | null;
  approvedAt?: string | null;
}

export class CatalogService {
  private static geminiClient: GoogleGenAI | null = null;
  private static inMemoryCatalog: CatalogItem[] = [
    {
      id: 'nmc-001',
      nmcCode: 'NMC-00000001',
      category: 'HEX_BOLT',
      stdDesc: 'HEXAGON HEAD BOLT M16 X 50 MM SS304',
      criticalAttrs: { diameter: 16, length: 50, grade: 'SS304' },
      status: 'APPROVED',
      version: 1,
      approvedBy: 'Dr. V. Sharma',
      approvedAt: '2026-08-01T10:00:00Z',
    },
    {
      id: 'nmc-002',
      nmcCode: 'NMC-00000002',
      category: 'HEX_BOLT',
      stdDesc: 'HEXAGON HEAD BOLT M16 X 50 MM SS316',
      criticalAttrs: { diameter: 16, length: 50, grade: 'SS316' },
      status: 'APPROVED',
      version: 1,
      approvedBy: 'Dr. V. Sharma',
      approvedAt: '2026-08-01T10:15:00Z',
    },
    {
      id: 'nmc-003',
      nmcCode: 'NMC-00000003',
      category: 'BALL_BEARING',
      stdDesc: 'DEEP GROOVE BALL BEARING 6205 2RS',
      criticalAttrs: { bearing_no: '6205', seal: '2RS' },
      status: 'APPROVED',
      version: 1,
      approvedBy: 'R. Iyer',
      approvedAt: '2026-08-01T11:00:00Z',
    },
    {
      id: 'nmc-004',
      nmcCode: 'NMC-00000004',
      category: 'GATE_VALVE',
      stdDesc: 'GATE VALVE 4" 300 LB CF8M FLANGED',
      criticalAttrs: { size_in: 4, pressure_class: 300, body_material: 'CF8M' },
      status: 'APPROVED',
      version: 1,
      approvedBy: 'Dr. V. Sharma',
      approvedAt: '2026-08-02T09:00:00Z',
    },
    {
      id: 'nmc-005',
      nmcCode: 'NMC-00000005',
      category: 'GATE_VALVE',
      stdDesc: 'GATE VALVE 2" 150 LB WCB FLANGED',
      criticalAttrs: { size_in: 2, pressure_class: 150, body_material: 'CS' },
      status: 'APPROVED',
      version: 1,
      approvedBy: 'R. Iyer',
      approvedAt: '2026-08-02T10:30:00Z',
    },
    {
      id: 'nmc-006',
      nmcCode: 'NMC-00000006',
      category: 'INDUCTION_MOTOR',
      stdDesc: 'INDUCTION MOTOR 15 KW 415 V 4 POLE',
      criticalAttrs: { power_kw: 15, voltage: 415, poles: 4 },
      status: 'APPROVED',
      version: 1,
      approvedBy: 'Dr. V. Sharma',
      approvedAt: '2026-08-03T14:00:00Z',
    },
    {
      id: 'nmc-007',
      nmcCode: 'NMC-00000007',
      category: 'SEAMLESS_PIPE',
      stdDesc: 'SEAMLESS PIPE 4" SCH 40 A106-B',
      criticalAttrs: { size_in: 4, schedule: 'SCH 40', grade: 'A106-B' },
      status: 'APPROVED',
      version: 1,
      approvedBy: 'R. Iyer',
      approvedAt: '2026-08-03T15:00:00Z',
    },
  ];

  private static getGeminiClient(): GoogleGenAI | null {
    if (!config.gemini.isConfigured) return null;
    if (!this.geminiClient) {
      this.geminiClient = new GoogleGenAI({ apiKey: config.gemini.apiKey });
    }
    return this.geminiClient;
  }

  static async interpretQuery(rawQuery: string): Promise<QueryInterpretation> {
    const norm = NormalizationService.normalizeText(rawQuery);
    const gemini = this.getGeminiClient();

    if (gemini) {
      try {
        const prompt = `You are the Engineering Query Interpreter for the National Unified Material Master Framework (NUMMF).
Translate the user's natural language procurement search query into structured engineering attributes.

USER QUERY: "${rawQuery}"
NORMALIZED TEXT: "${norm}"

Allowed Categories: HEX_BOLT, BALL_BEARING, GATE_VALVE, FLANGE, INDUCTION_MOTOR, SEAMLESS_PIPE, SPIRAL_WOUND_GASKET, POWER_CABLE, WELDING_ELECTRODE, UNCLASSIFIED.

Return JSON adhering to this schema:
{
  "category": "GATE_VALVE",
  "attributes": {
    "size_in": 4,
    "pressure_class": 300,
    "body_material": "CF8M"
  },
  "searchTerms": ["gate", "valve", "4", "inch", "300", "lb", "cf8m"],
  "explanation": "Interpreted as Gate valve with 4-inch nominal size, 300 LB pressure class, and CF8M stainless steel metallurgy.",
  "confidence": 0.98
}`;

        const response = await gemini.models.generateContent({
          model: config.gemini.model,
          contents: prompt,
          config: {
            temperature: 0.1,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                category: { type: Type.STRING },
                attributes: { type: Type.OBJECT },
                searchTerms: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                explanation: { type: Type.STRING },
                confidence: { type: Type.NUMBER },
              },
              required: ['category', 'attributes', 'searchTerms', 'explanation', 'confidence'],
            },
          },
        });

        if (response.text) {
          const parsed = JSON.parse(response.text);
          const cat = parsed.category || 'UNCLASSIFIED';
          return {
            rawQuery,
            normalized: norm,
            category: cat,
            predictedCategory: cat,
            attributes: parsed.attributes || {},
            searchTerms: parsed.searchTerms || norm.split(' ').filter(Boolean),
            explanation: parsed.explanation || `Interpreted query as ${cat}`,
            confidence: parsed.confidence || 0.9,
            usedGemini: true,
          };
        }
      } catch (err) {
        console.warn('⚠️  [CatalogService] Gemini query parsing failed, using deterministic fallback:', (err as Error).message);
      }
    }

    const extraction = await ExtractionService.extract(norm);
    const catDef = CATEGORY_DEFINITIONS[extraction.category] || { label: extraction.category };
    const searchTerms = norm.split(' ').filter(t => t.length > 1);

    const attrSummary = Object.entries(extraction.attrs)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');

    const explanation =
      extraction.category !== 'UNCLASSIFIED'
        ? `Interpreted as ${catDef.label}${attrSummary ? ` with attributes (${attrSummary})` : ''}.`
        : `Interpreted as broad keyword search (${searchTerms.join(', ')}).`;

    return {
      rawQuery,
      normalized: norm,
      category: extraction.category,
      predictedCategory: extraction.category,
      attributes: extraction.attrs,
      searchTerms,
      explanation,
      confidence: extraction.confidence,
      usedGemini: false,
    };
  }

  static async searchCatalog(params: {
    query: string;
    cpse?: string;
    category?: string;
    status?: string;
    page?: number;
    limit?: number;
  }): Promise<CatalogSearchResponse> {
    const { query, cpse, category: filterCat, status: filterStatus } = params;
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));

    const interpretation = await this.interpretQuery(query);

    let candidates: CatalogItem[] = [];
    try {
      const dbRecords = await prisma.nationalMaterial.findMany({
        where: {
          category: filterCat || (interpretation.category !== 'UNCLASSIFIED' ? interpretation.category : undefined),
          status: filterStatus || undefined,
        },
        take: 200,
      });

      if (dbRecords.length > 0) {
        candidates = dbRecords.map((r: any) => ({
          id: r.id,
          nmcCode: r.nmcCode,
          category: r.category,
          stdDesc: r.stdDesc,
          criticalAttrs: (r.criticalAttrs as Record<string, unknown>) || {},
          status: r.status,
          version: r.version,
          approvedBy: r.approvedBy,
          approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
        }));
      }
    } catch {}

    if (candidates.length === 0) {
      candidates = this.inMemoryCatalog.slice();
    }

    const effectiveCategory = filterCat || (interpretation.category !== 'UNCLASSIFIED' ? interpretation.category : null);
    if (effectiveCategory) {
      candidates = candidates.filter(c => c.category === effectiveCategory);
    }

    if (filterStatus) {
      candidates = candidates.filter(c => c.status.toLowerCase() === filterStatus.toLowerCase());
    }

    const searchTokens = interpretation.searchTerms.map(t => t.toLowerCase());
    const queryVector = EmbeddingService.generateDeterministicVector(interpretation.normalized);

    const scored: Array<{ item: CatalogItem; score: number; reasons: string[] }> = [];

    for (const item of candidates) {
      const itemNorm = NormalizationService.normalizeText(item.stdDesc).toLowerCase();
      const reasons: string[] = [];

      let tokenHits = 0;
      for (const token of searchTokens) {
        if (itemNorm.includes(token)) {
          tokenHits++;
        }
      }
      const tokenScore = searchTokens.length > 0 ? tokenHits / searchTokens.length : 0;
      if (tokenScore > 0.5) reasons.push(`${Math.round(tokenScore * 100)}% keyword token overlap`);

      let attrMatches = 0;
      let totalAttrs = 0;
      for (const [k, v] of Object.entries(interpretation.attributes)) {
        if (v !== undefined) {
          totalAttrs++;
          const itemVal = item.criticalAttrs[k];
          if (itemVal !== undefined) {
            if (String(itemVal).toLowerCase() === String(v).toLowerCase()) {
              attrMatches += 1.0;
              reasons.push(`Exact ${k}: ${v}`);
            } else {
              attrMatches -= 0.5;
            }
          }
        }
      }
      const attrScore = totalAttrs > 0 ? Math.max(0, attrMatches / totalAttrs) : 0.5;

      const itemVector = EmbeddingService.generateDeterministicVector(itemNorm);
      const semScore = EmbeddingService.cosineSimilarity(queryVector, itemVector);
      if (semScore > 0.6) reasons.push(`${Math.round(semScore * 100)}% semantic vector similarity`);

      const hybridScore = totalAttrs > 0
        ? 0.45 * attrScore + 0.35 * tokenScore + 0.20 * semScore
        : 0.60 * tokenScore + 0.40 * semScore;

      if (hybridScore > 0.25 || tokenScore > 0.3) {
        scored.push({
          item,
          score: Math.min(1.0, Math.max(0.0, hybridScore)),
          reasons,
        });
      }
    }

    scored.sort((a, b) => b.score - a.score);

    const total = scored.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const offset = (page - 1) * limit;
    const paginated = scored.slice(offset, offset + limit);

    const results: CatalogSearchResultItem[] = paginated.map(({ item, score, reasons }) => ({
      id: item.id,
      nmcCode: item.nmcCode,
      description: item.stdDesc,
      category: item.category,
      attributes: item.criticalAttrs,
      status: item.status,
      score: Number(score.toFixed(4)),
      matchReasons: reasons,
      version: item.version,
    }));

    return {
      query,
      interpretation,
      total,
      page,
      limit,
      totalPages,
      results,
    };
  }

  static async getMaterials(params: {
    q?: string;
    category?: string;
    status?: string;
    page?: number;
    limit?: number;
  }): Promise<{ total: number; page: number; limit: number; totalPages: number; data: CatalogItem[] }> {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));

    try {
      const where: any = {};
      if (params.category) where.category = params.category;
      if (params.status) where.status = params.status;
      if (params.q) where.stdDesc = { contains: params.q, mode: 'insensitive' };

      const [total, records] = await Promise.all([
        prisma.nationalMaterial.count({ where }),
        prisma.nationalMaterial.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { codeNumber: 'asc' },
        }),
      ]);

      if (records.length > 0) {
        return {
          total,
          page,
          limit,
          totalPages: Math.max(1, Math.ceil(total / limit)),
          data: records.map((r: any) => ({
            id: r.id,
            nmcCode: r.nmcCode,
            category: r.category,
            stdDesc: r.stdDesc,
            criticalAttrs: (r.criticalAttrs as Record<string, unknown>) || {},
            status: r.status,
            version: r.version,
            approvedBy: r.approvedBy,
            approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
          })),
        };
      }
    } catch {}

    let list = this.inMemoryCatalog.slice();
    if (params.category) list = list.filter(c => c.category === params.category);
    if (params.status) list = list.filter(c => c.status === params.status);
    if (params.q) {
      const qLower = params.q.toLowerCase();
      list = list.filter(c => c.stdDesc.toLowerCase().includes(qLower) || c.nmcCode.toLowerCase().includes(qLower));
    }

    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const offset = (page - 1) * limit;
    const data = list.slice(offset, offset + limit);

    return { total, page, limit, totalPages, data };
  }

  static async getMaterialById(idOrCode: string): Promise<any> {
    try {
      const item = await prisma.nationalMaterial.findFirst({
        where: {
          OR: [{ id: idOrCode }, { nmcCode: idOrCode }],
        },
        include: {
          mappings: {
            include: { legacyRecord: true },
          },
          versions: {
            orderBy: { version: 'desc' },
          },
          opportunities: true,
        },
      });

      if (item) return item;
    } catch {}

    const fallback = this.inMemoryCatalog.find(c => c.id === idOrCode || c.nmcCode === idOrCode);
    if (!fallback) return null;

    return {
      ...fallback,
      mappings: [],
      versions: [
        {
          id: `v1-${fallback.id}`,
          version: fallback.version,
          stdDesc: fallback.stdDesc,
          changeReason: 'Baseline approved material',
          changedBy: fallback.approvedBy || 'System',
          createdAt: fallback.approvedAt || new Date().toISOString(),
        },
      ],
      opportunities: [],
    };
  }

  static addCatalogItem(item: CatalogItem): void {
    this.inMemoryCatalog.push(item);
  }

  static async exportMaterials(
    filter: { q?: string; category?: string; status?: string },
    format: 'csv' | 'json' = 'csv'
  ): Promise<{ content: string; contentType: string; filename: string }> {
    const { data } = await this.getMaterials({ ...filter, page: 1, limit: 1000 });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

    if (format === 'json') {
      return {
        content: JSON.stringify(data, null, 2),
        contentType: 'application/json',
        filename: `national-catalog-export-${timestamp}.json`,
      };
    }

    const escapeCsv = (str: string) => `"${String(str ?? '').replace(/"/g, '""')}"`;
    const headers = [
      'National Material Code',
      'Standard Description',
      'Category',
      'Status',
      'Version',
      'Approved By',
      'Approved Date',
      'Critical Attributes',
    ];
    const rows = data.map(item => [
      escapeCsv(item.nmcCode),
      escapeCsv(item.stdDesc),
      escapeCsv(item.category),
      escapeCsv(item.status),
      item.version,
      escapeCsv(item.approvedBy || ''),
      escapeCsv(item.approvedAt || ''),
      escapeCsv(JSON.stringify(item.criticalAttrs || {})),
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

    return {
      content: csvContent,
      contentType: 'text/csv',
      filename: `national-catalog-export-${timestamp}.csv`,
    };
  }
}

