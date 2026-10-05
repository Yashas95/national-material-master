import { prisma } from '../config/db';
import { AuditLogItem, AuditStats } from '../models/audit';

export class AuditService {
  private static inMemoryLogs: AuditLogItem[] = [
    {
      id: 'AUD-000001',
      action: 'PLATFORM_INITIALIZED',
      target: 'NUMMF-CORE',
      actor: 'System Bootstrap',
      role: 'SYSTEM',
      detail: 'National Unified Material Master Framework core services initialized.',
      extra: { version: '1.0.0', guardrails: ['R-01', 'R-02', 'R-03', 'R-04', 'R-05', 'R-06', 'R-07', 'R-08', 'R-09', 'R-10'] },
      createdAt: '2026-08-01T08:00:00.000Z',
    },
    {
      id: 'AUD-000002',
      action: 'DATASET_INGESTED',
      target: 'CPSE A (PETRO)',
      actor: 'PETRO Data Steward',
      role: 'CPSE administrator',
      detail: '124 records ingested from SAP ECC export. Content hash verified.',
      extra: { cpseId: 'A', total: 124, accepted: 124, rejected: 0 },
      createdAt: '2026-08-01T08:30:00.000Z',
    },
    {
      id: 'AUD-000003',
      action: 'FIRST_LEVEL_APPROVAL',
      target: 'NMC-00000001',
      actor: 'R. Iyer',
      role: 'Material expert',
      detail: 'First-level approval of HEXAGON HEAD BOLT M16 X 50 MM SS304. Waiting for super administrator.',
      extra: { clusterKey: 'HEX_BOLT|16|50|SS304', confidence: 0.985 },
      createdAt: '2026-08-01T09:15:00.000Z',
    },
    {
      id: 'AUD-000004',
      action: 'SECOND_LEVEL_APPROVAL',
      target: 'NMC-00000001',
      actor: 'Dr. V. Sharma',
      role: 'Super administrator',
      detail: 'Approved HEXAGON HEAD BOLT M16 X 50 MM SS304 and mapped 5 legacy codes across CPSE A, B, C, E.',
      extra: { clusterKey: 'HEX_BOLT|16|50|SS304', mappedCodes: 5 },
      createdAt: '2026-08-01T09:45:00.000Z',
    },
    {
      id: 'AUD-000005',
      action: 'UNSAFE_MERGE_PREVENTED',
      target: 'CPSE A:BOLT-101 vs CPSE C:STL-900',
      actor: 'RuleEngine (R-01 Guard)',
      role: 'SYSTEM',
      detail: 'Rule R-01 blocked merge due to critical metallurgy conflict: SS304 vs SS316. 98% semantic similarity rejected.',
      extra: { rule: 'R-01', conflict: 'grade: SS304 vs SS316', semanticScore: 0.98 },
      createdAt: '2026-08-01T10:00:00.000Z',
    },
    {
      id: 'AUD-000006',
      action: 'GEMINI_EXPLAIN_GENERATED',
      target: 'NMC-00000004',
      actor: 'Gemini 3.8 Flash',
      role: 'AI Model',
      detail: 'Auditor-grade explanation synthesized for 4" Gate Valve CF8M 300 LB across CPSE D and CPSE B.',
      extra: { model: 'gemini-3.8-flash', tokens: 184, confidence: 0.98, promptTokens: 320 },
      createdAt: '2026-08-02T11:20:00.000Z',
    },
  ];

  static async log(entry: {
    action: string;
    target: string;
    actor: string;
    role: string;
    detail: string;
    extra?: Record<string, unknown> | null;
  }): Promise<AuditLogItem> {
    const id = `AUD-${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 100)}`;
    const createdAt = new Date().toISOString();

    const auditItem: AuditLogItem = {
      id,
      action: entry.action,
      target: entry.target,
      actor: entry.actor,
      role: entry.role,
      detail: entry.detail,
      extra: entry.extra || null,
      createdAt,
    };

    this.inMemoryLogs.unshift(auditItem);
    if (this.inMemoryLogs.length > 1000) {
      this.inMemoryLogs.pop();
    }

    try {
      await prisma.auditLog.create({
        data: {
          id,
          action: entry.action,
          target: entry.target,
          actor: entry.actor,
          role: entry.role,
          detail: entry.detail,
          extra: (entry.extra as any) || undefined,
          createdAt: new Date(createdAt),
        },
      });
    } catch {}

    return auditItem;
  }

  static async recordAudit(entry: {
    action: string;
    target: string;
    actor: string;
    role: string;
    detail: string;
    extra?: Record<string, unknown> | null;
  }): Promise<AuditLogItem> {
    return this.log(entry);
  }

  static async getLogs(params: {
    action?: string;
    q?: string;
    actor?: string;
    role?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
  }): Promise<{ total: number; page: number; limit: number; totalPages: number; data: AuditLogItem[] }> {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(200, Math.max(1, params.limit || 50));

    try {
      const where: any = {};
      if (params.action) where.action = params.action;
      if (params.actor) where.actor = { contains: params.actor, mode: 'insensitive' };
      if (params.role) where.role = params.role;

      if (params.startDate || params.endDate) {
        where.createdAt = {};
        if (params.startDate) where.createdAt.gte = new Date(params.startDate);
        if (params.endDate) where.createdAt.lte = new Date(params.endDate);
      }

      if (params.q) {
        where.OR = [
          { target: { contains: params.q, mode: 'insensitive' } },
          { detail: { contains: params.q, mode: 'insensitive' } },
          { actor: { contains: params.q, mode: 'insensitive' } },
        ];
      }

      const [total, records] = await Promise.all([
        prisma.auditLog.count({ where }),
        prisma.auditLog.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { createdAt: 'desc' },
        }),
      ]);

      if (records.length > 0) {
        return {
          total,
          page,
          limit,
          totalPages: Math.max(1, Math.ceil(total / limit)),
          data: records.map(r => ({
            id: r.id,
            action: r.action,
            target: r.target,
            actor: r.actor,
            role: r.role,
            detail: r.detail,
            extra: (r.extra as Record<string, unknown>) || null,
            createdAt: r.createdAt.toISOString(),
          })),
        };
      }
    } catch {}

    let list = this.inMemoryLogs.slice();

    if (params.action) {
      list = list.filter(l => l.action.toLowerCase() === params.action!.toLowerCase());
    }

    if (params.role) {
      list = list.filter(l => l.role.toLowerCase() === params.role!.toLowerCase());
    }

    if (params.actor) {
      list = list.filter(l => l.actor.toLowerCase().includes(params.actor!.toLowerCase()));
    }

    if (params.startDate) {
      const startMs = new Date(params.startDate).getTime();
      list = list.filter(l => new Date(l.createdAt).getTime() >= startMs);
    }

    if (params.endDate) {
      const endMs = new Date(params.endDate).getTime();
      list = list.filter(l => new Date(l.createdAt).getTime() <= endMs);
    }

    if (params.q) {
      const qLower = params.q.toLowerCase();
      list = list.filter(
        l =>
          l.target.toLowerCase().includes(qLower) ||
          l.detail.toLowerCase().includes(qLower) ||
          l.actor.toLowerCase().includes(qLower) ||
          l.action.toLowerCase().includes(qLower)
      );
    }

    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const offset = (page - 1) * limit;
    const data = list.slice(offset, offset + limit);

    return { total, page, limit, totalPages, data };
  }

  static async exportLogs(
    filter: { action?: string; q?: string },
    format: 'csv' | 'json'
  ): Promise<{ content: string; contentType: string; filename: string }> {
    const { data } = await this.getLogs({ ...filter, page: 1, limit: 1000 });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

    if (format === 'json') {
      return {
        content: JSON.stringify(data, null, 2),
        contentType: 'application/json',
        filename: `nummf-audit-export-${timestamp}.json`,
      };
    }

    const escapeCsv = (str: string) => `"${str.replace(/"/g, '""')}"`;
    const headers = ['Event ID', 'Timestamp', 'Actor', 'Role', 'Action', 'Target', 'Detail'];
    const rows = data.map(item => [
      item.id,
      item.createdAt,
      escapeCsv(item.actor),
      escapeCsv(item.role),
      escapeCsv(item.action),
      escapeCsv(item.target),
      escapeCsv(item.detail),
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

    return {
      content: csvContent,
      contentType: 'text/csv',
      filename: `nummf-audit-export-${timestamp}.csv`,
    };
  }

  static async getStats(): Promise<AuditStats> {
    const { data: allLogs } = await this.getLogs({ page: 1, limit: 1000 });

    const actionsBreakdown: Record<string, number> = {};
    const actorsSet = new Set<string>();
    let preventedMerges = 0;
    let totalAiActions = 0;
    let estimatedTokens = 0;
    let totalConfidence = 0;
    let confidenceCount = 0;

    for (const log of allLogs) {
      actionsBreakdown[log.action] = (actionsBreakdown[log.action] || 0) + 1;
      actorsSet.add(log.actor);

      if (
        log.action === 'UNSAFE_MERGE_PREVENTED' ||
        log.detail.includes('Rule R-01') ||
        log.detail.includes('conflict') ||
        log.action === 'RECOMMENDATION_REJECTED'
      ) {
        preventedMerges++;
      }

      if (
        log.action.includes('GEMINI') ||
        log.actor.toLowerCase().includes('gemini') ||
        log.extra?.usedGemini ||
        log.extra?.tokens
      ) {
        totalAiActions++;
        if (typeof log.extra?.tokens === 'number') {
          estimatedTokens += log.extra.tokens;
        } else {
          estimatedTokens += 150;
        }

        if (typeof log.extra?.confidence === 'number') {
          totalConfidence += log.extra.confidence;
          confidenceCount++;
        }
      }
    }

    const avgConfidence = confidenceCount > 0 ? Number((totalConfidence / confidenceCount).toFixed(3)) : 0.95;

    return {
      totalEvents: allLogs.length,
      uniqueActors: actorsSet.size,
      actionsBreakdown,
      preventedMerges,
      blockedHarmonizations: preventedMerges,
      geminiStats: {
        totalAiActions,
        estimatedTokens,
        avgConfidence,
      },
    };
  }

  static clearInMemory(): void {
    this.inMemoryLogs = [];
  }
}
