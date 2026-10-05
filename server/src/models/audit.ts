import { z } from 'zod';

export interface AuditLogItem {
  id: string;
  action: string;
  target: string;
  actor: string;
  role: string;
  detail: string;
  extra?: Record<string, unknown> | null;
  createdAt: string;
}

export interface AuditStats {
  totalEvents: number;
  uniqueActors: number;
  actionsBreakdown: Record<string, number>;
  preventedMerges: number;
  blockedHarmonizations?: number;
  geminiStats: {
    totalAiActions: number;
    estimatedTokens: number;
    avgConfidence: number;
  };
}

export const AuditQuerySchema = z.object({
  action: z.string().optional(),
  q: z.string().optional(),
  actor: z.string().optional(),
  role: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  page: z.string().optional().transform(v => (v ? parseInt(v, 10) : 1)),
  limit: z.string().optional().transform(v => (v ? parseInt(v, 10) : 50)),
});

export const AuditExportSchema = z.object({
  format: z.enum(['csv', 'json']).default('csv'),
  action: z.string().optional(),
  q: z.string().optional(),
});
