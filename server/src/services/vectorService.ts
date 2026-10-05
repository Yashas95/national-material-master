import { prisma } from '../config/db';

export interface VectorSearchResult<T> {
  item: T;
  similarity: number;
}

export interface LegacyRecordVectorResult {
  id: string;
  cpse_id: string;
  code: string;
  raw_desc: string;
  norm_desc: string;
  category: string;
  attrs: Record<string, unknown>;
  similarity: number;
}

export interface NationalMaterialVectorResult {
  id: string;
  cluster_key: string;
  nmc_code: string;
  std_desc: string;
  category: string;
  critical_attrs: Record<string, unknown>;
  similarity: number;
}

export class VectorService {
  static toVectorString(embedding: number[]): string {
    return `[${embedding.join(',')}]`;
  }

  static parseVectorString(vectorStr: string): number[] {
    if (!vectorStr) return [];
    return vectorStr
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map(Number);
  }

  static cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom ? dot / denom : 0;
  }

  static async ensureVectorIndexes(): Promise<void> {
    try {
      await prisma.$executeRawUnsafe(`
        CREATE EXTENSION IF NOT EXISTS vector;
      `);

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS legacy_records_embedding_hnsw_idx 
        ON legacy_records USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64);
      `);

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS national_materials_embedding_hnsw_idx 
        ON national_materials USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64);
      `);

      console.log('✅ [pgvector] HNSW cosine similarity vector indexes verified.');
    } catch (error) {
      console.warn('⚠️  [pgvector] Could not ensure HNSW vector indexes (database service offline or starting up).');
    }
  }

  static async findSimilarLegacyRecords(
    embedding: number[],
    options: { category?: string; limit?: number; minSimilarity?: number } = {}
  ): Promise<LegacyRecordVectorResult[]> {
    const { category, limit = 10, minSimilarity = 0.6 } = options;
    const vectorStr = this.toVectorString(embedding);

    try {
      const results = await prisma.$queryRawUnsafe<LegacyRecordVectorResult[]>(
        `
        SELECT 
          id, 
          cpse_id, 
          code, 
          raw_desc, 
          norm_desc, 
          category, 
          attrs,
          (1 - (embedding <=> $1::vector))::float AS similarity
        FROM legacy_records
        WHERE embedding IS NOT NULL
          AND ($2::text IS NULL OR category = $2)
          AND (1 - (embedding <=> $1::vector)) >= $3
        ORDER BY embedding <=> $1::vector ASC
        LIMIT $4;
        `,
        vectorStr,
        category ?? null,
        minSimilarity,
        limit
      );

      return results;
    } catch (error) {
      console.error('[VectorService] findSimilarLegacyRecords error:', error);
      return [];
    }
  }

  static async findSimilarNationalMaterials(
    embedding: number[],
    options: { category?: string; limit?: number; minSimilarity?: number } = {}
  ): Promise<NationalMaterialVectorResult[]> {
    const { category, limit = 10, minSimilarity = 0.6 } = options;
    const vectorStr = this.toVectorString(embedding);

    try {
      const results = await prisma.$queryRawUnsafe<NationalMaterialVectorResult[]>(
        `
        SELECT 
          id, 
          cluster_key, 
          nmc_code, 
          std_desc, 
          category, 
          critical_attrs,
          (1 - (embedding <=> $1::vector))::float AS similarity
        FROM national_materials
        WHERE embedding IS NOT NULL
          AND ($2::text IS NULL OR category = $2)
          AND (1 - (embedding <=> $1::vector)) >= $3
        ORDER BY embedding <=> $1::vector ASC
        LIMIT $4;
        `,
        vectorStr,
        category ?? null,
        minSimilarity,
        limit
      );

      return results;
    } catch (error) {
      console.error('[VectorService] findSimilarNationalMaterials error:', error);
      return [];
    }
  }
}
