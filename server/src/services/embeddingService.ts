import { GoogleGenAI } from '@google/genai';
import { config } from '../config/env';
import { VectorService } from './vectorService';

export class EmbeddingService {
  private static geminiClient: GoogleGenAI | null = null;

  private static getGeminiClient(): GoogleGenAI | null {
    if (!config.gemini.isConfigured) return null;
    if (!this.geminiClient) {
      this.geminiClient = new GoogleGenAI({ apiKey: config.gemini.apiKey });
    }
    return this.geminiClient;
  }

  static async generateEmbedding(text: string): Promise<number[]> {
    const ai = this.getGeminiClient();

    if (ai) {
      try {
        const response = await ai.models.embedContent({
          model: config.gemini.embeddingModel,
          contents: text,
        });

        const firstEmbedding = response.embeddings?.[0]?.values;
        if (firstEmbedding && firstEmbedding.length > 0) {
          return this.normalizeVector(firstEmbedding);
        }
      } catch (err) {
        console.warn('⚠️  [EmbeddingService] Gemini embedding call failed, falling back to deterministic vector:', err);
      }
    }

    return this.generateDeterministicVector(text, 384);
  }

  static cosineSimilarity(a: number[], b: number[]): number {
    return VectorService.cosineSimilarity(a, b);
  }

  static generateDeterministicVector(text: string, dimensions = 384): number[] {
    const vec = new Float64Array(dimensions);
    const clean = String(text || '').toUpperCase().trim();
    if (!clean) return Array.from(vec);

    const tokens = clean.split(/\s+/).filter(Boolean);

    for (const w of tokens) {
      const h = this.fnv1a(w) % dimensions;
      vec[h] += 1.0;
    }

    const padded = `#${clean}#`;
    for (let i = 0; i < padded.length - 2; i++) {
      const trigram = padded.slice(i, i + 3);
      const h = this.fnv1a(trigram) % dimensions;
      vec[h] += 0.5;
    }

    let sumSq = 0;
    for (let i = 0; i < dimensions; i++) sumSq += vec[i] * vec[i];
    const norm = Math.sqrt(sumSq) || 1;

    const result = new Array<number>(dimensions);
    for (let i = 0; i < dimensions; i++) result[i] = vec[i] / norm;
    return result;
  }

  private static normalizeVector(v: number[]): number[] {
    let sumSq = 0;
    for (let i = 0; i < v.length; i++) sumSq += v[i] * v[i];
    const norm = Math.sqrt(sumSq) || 1;
    return v.map(x => x / norm);
  }

  private static fnv1a(str: string): number {
    let hash = 2166136261;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return Math.abs(hash >>> 0);
  }
}
