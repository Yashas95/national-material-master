import { z } from 'zod';
import { MatchableRecord } from '../services/matchingService';

export type DecisionType = 'CLUSTER' | 'MAPPING';

export type DecisionStatus =
  | 'PENDING'
  | 'AWAITING_L2'
  | 'APPROVED'
  | 'REJECTED'
  | 'ESCALATED'
  | 'MODIFIED';

export interface DecisionExplanation {
  pairId?: string;
  score: number;
  classification: string;
  reasons: string[];
  differences: string[];
  blocked: string[];
  rulesApplied: string[];
  narrative: string;
  auditorVerdict: 'APPROVED_FOR_MERGE' | 'REQUIRES_EXPERT_REVIEW' | 'MERGE_PROHIBITED';
  technicalRationale: string;
  procurementNote?: string;
  usedGemini: boolean;
  confidence: number;
}

export const ExplainRequestSchema = z.object({
  pairId: z.string().optional(),
  recordA: z.custom<MatchableRecord>().optional(),
  recordB: z.custom<MatchableRecord>().optional(),
  nationalMaterialId: z.string().optional(),
  legacyRecordId: z.string().optional(),
});

export const ApproveDecisionSchema = z.object({
  targetId: z.string().min(1, 'Target ID is required'),
  type: z.enum(['CLUSTER', 'MAPPING']).default('CLUSTER'),
  note: z.string().optional(),
  forceL2: z.boolean().optional(),
});

export const ModifyDecisionSchema = z.object({
  targetId: z.string().min(1, 'Target ID is required'),
  standardDescription: z.string().min(3, 'Standard description must be at least 3 characters'),
  note: z.string().min(3, 'A reason is required for every modification to a national material'),
  attributes: z.record(z.unknown()).optional(),
});

export const RejectDecisionSchema = z.object({
  targetId: z.string().min(1, 'Target ID is required'),
  type: z.enum(['CLUSTER', 'MAPPING']).default('CLUSTER'),
  reason: z.string().min(3, 'A justification note is required to reject a recommendation'),
});

export const EscalateDecisionSchema = z.object({
  targetId: z.string().min(1, 'Target ID is required'),
  type: z.enum(['CLUSTER', 'MAPPING']).default('CLUSTER'),
  note: z.string().optional(),
});

export const ReopenDecisionSchema = z.object({
  targetId: z.string().min(1, 'Target ID is required'),
  type: z.enum(['CLUSTER', 'MAPPING']).default('CLUSTER'),
  note: z.string().optional(),
});
