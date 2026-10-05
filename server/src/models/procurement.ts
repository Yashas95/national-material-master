export interface CpseProcurementRow {
  cpse: string;
  qty: number;
  spend: number;
  pos: number;
  price: number;
  suppliers: string[];
}

export interface GeminiExecutiveBriefing {
  summary: string;
  volumeConsolidationAdvice: string;
  supplierRationalizationAdvice: string;
  priceVarianceExplanation: string;
  contractNegotiationLeverage: string;
  riskDisclaimer: string;
  generatedBy: 'GEMINI_AI' | 'DETERMINISTIC_ENGINE';
}

export interface ProcurementOpportunity {
  clusterKey: string;
  nationalMaterialCode: string;
  standardDescription: string;
  category: string;
  unit: string;
  rows: CpseProcurementRow[];
  cpseCount: number;
  demand: number;
  spend: number;
  pos: number;
  priceMin: number;
  priceMax: number;
  spread: number;
  supplierOverlap: number;
  suppliers: string[];
  excluded: number;
  outlier: boolean;
  score: number;
  executiveBriefing?: GeminiExecutiveBriefing;
}

export interface ProcurementStats {
  totalOpportunities: number;
  totalCrossCpseSpend: number;
  averagePriceSpread: number;
  topSharedSuppliers: Array<{
    supplier: string;
    cpseCount: number;
    spend: number;
  }>;
  topCategories: Array<{
    category: string;
    opportunitiesCount: number;
    totalSpend: number;
  }>;
}

export interface ProcurementFilterParams {
  category?: string;
  minCpses?: number;
  minSpend?: number;
  outliersOnly?: boolean;
  q?: string;
  page?: number;
  limit?: number;
}
