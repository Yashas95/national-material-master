import { z } from 'zod';
import { CanonicalUnit } from '../services/normalizationService';

export const CPSE_MAP: Record<string, string> = {
  A: 'A',
  PETRO: 'A',
  B: 'B',
  POWER: 'B',
  C: 'C',
  STEEL: 'C',
  D: 'D',
  MINES: 'D',
  E: 'E',
  HVENG: 'E',
};

export interface RawIntakeRow {
  cpse?: string;
  code?: string;
  description?: string;
  desc?: string;
  unit?: string;
  uom?: string;
  price?: number | string;
  qty?: number | string;
  supplier?: string;
  year?: number | string;
  plant?: string;
  [key: string]: unknown;
}

export interface ValidatedIntakeRow {
  line: number;
  raw: string;
  cpseId: string;
  code: string;
  rawDesc: string;
  unit: string;
  price?: number;
  qty?: number;
  supplier?: string;
  year?: number;
  plant?: string;
}

export interface QualityIssue {
  type: 'MISSING_ATTR' | 'INVALID_UNIT' | 'DUP_CODE' | 'INTRA_DUP' | 'PRICE_OUTLIER' | 'UNIT_MISMATCH' | 'UNCLASSIFIED' | 'NO_PRICE';
  msg: string;
}

export interface EnrichedIntakeRow {
  id: string;
  line: number;
  cpseId: string;
  code: string;
  rawDesc: string;
  normDesc: string;
  category: string;
  attrs: Record<string, unknown>;
  unit: string;
  unitInfo: CanonicalUnit | null;
  history: Array<{ price: number; qty: number; supplier: string; year: number }>;
  missingCritical: string[];
  qualityIssues: QualityIssue[];
  usedGemini: boolean;
  outcome: {
    status: 'MATCHED' | 'PROPOSED_NEW' | 'NEEDS_REVIEW' | 'UNCLASSIFIED';
    summary: string;
    badgeClass: 'p-ok' | 'p-acc' | 'p-warn' | 'p-mute';
  };
}

export interface IntakeRejection {
  line: number | string;
  raw: string;
  reason: string;
}

export interface IntakeWarning {
  line: number | string;
  raw: string;
  reason: string;
}

export interface IntakeValidationReport {
  success: boolean;
  batchId: string;
  file: string;
  fileHash: string;
  duplicateUpload: boolean;
  totalRows: number;
  acceptedCount: number;
  rejectedCount: number;
  warningCount: number;
  accepted: EnrichedIntakeRow[];
  rejected: IntakeRejection[];
  warnings: IntakeWarning[];
  dryRun: boolean;
  createdAt: string;
}

export const PasteIntakeSchema = z.object({
  text: z.string().min(1, 'Upload content or CSV text cannot be empty'),
  filename: z.string().default('pasted-rows.csv'),
  dryRun: z.boolean().default(false),
  cpseId: z.string().optional(),
});
