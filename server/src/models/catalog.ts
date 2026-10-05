import { z } from 'zod';

export interface QueryInterpretation {
  rawQuery: string;
  normalized: string;
  category: string;
  predictedCategory?: string;
  attributes: Record<string, unknown>;
  searchTerms: string[];
  explanation: string;
  confidence: number;
  usedGemini: boolean;
}

export interface CatalogSearchResultItem {
  id: string;
  nmcCode?: string;
  legacyCode?: string;
  cpseId?: string;
  description: string;
  category: string;
  attributes: Record<string, unknown>;
  status: string;
  score: number;
  matchReasons: string[];
  version?: number;
}

export interface CatalogSearchResponse {
  query: string;
  interpretation: QueryInterpretation;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  results: CatalogSearchResultItem[];
}

export const AiSearchSchema = z.object({
  query: z.string().min(1, 'Search query cannot be empty'),
  cpse: z.string().optional(),
  category: z.string().optional(),
  status: z.string().optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
});

export const CatalogQuerySchema = z.object({
  q: z.string().optional(),
  cpse: z.string().optional(),
  category: z.string().optional(),
  status: z.string().optional(),
  page: z.string().optional().transform(v => (v ? parseInt(v, 10) : 1)),
  limit: z.string().optional().transform(v => (v ? parseInt(v, 10) : 20)),
});

export const CatalogExportSchema = z.object({
  q: z.string().optional(),
  category: z.string().optional(),
  status: z.string().optional(),
  format: z.enum(['csv', 'json']).default('csv'),
});

