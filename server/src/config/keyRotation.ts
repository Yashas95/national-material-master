import { GoogleGenAI } from '@google/genai';
import { config } from './env';

export interface KeyEntry {
  id: string;
  name: string;
  key: string;
  masked: string;
  status: 'ACTIVE' | 'COOLDOWN' | 'EXHAUSTED' | 'INVALID';
  cooldownUntil?: number;
  totalRequests: number;
  successfulRequests: number;
  failureCount: number;
  lastUsedAt?: string;
  lastError?: string;
}

export interface KeyPoolMetrics {
  totalKeys: number;
  activeKeys: number;
  cooldownKeys: number;
  exhaustedKeys: number;
  currentActiveKeyId?: string;
  model: string;
  keys: Array<{
    id: string;
    name: string;
    masked: string;
    status: 'ACTIVE' | 'COOLDOWN' | 'EXHAUSTED' | 'INVALID';
    totalRequests: number;
    successfulRequests: number;
    failureCount: number;
    cooldownRemainingSec?: number;
    lastUsedAt?: string;
    lastError?: string;
  }>;
}

export class KeyRotationService {
  private static keyPool: KeyEntry[] = [];
  private static currentIndex = 0;
  private static clientCache = new Map<string, GoogleGenAI>();

  static initializePool(): void {
    this.keyPool = [];
    this.clientCache.clear();
    this.currentIndex = 0;

    const rawKeys: Array<{ key: string; name: string }> = [];

    if (process.env.GEMINI_API_KEYS) {
      const splitKeys = process.env.GEMINI_API_KEYS.split(',')
        .map(k => k.trim())
        .filter(k => k.length > 0);
      splitKeys.forEach((k, idx) => {
        rawKeys.push({ key: k, name: `EnvPoolKey_${idx + 1}` });
      });
    }

    for (let i = 1; i <= 10; i++) {
      const envKey = process.env[`GEMINI_API_KEY_${i}`];
      if (envKey && envKey.trim().length > 0) {
        rawKeys.push({ key: envKey.trim(), name: `NumberedKey_${i}` });
      }
    }

    const primary = config.gemini.apiKey || process.env.GEMINI_API_KEY;
    if (primary && primary.trim().length > 0) {
      if (!rawKeys.some(r => r.key === primary.trim())) {
        rawKeys.unshift({ key: primary.trim(), name: 'Primary_Gemini_Key' });
      }
    }

    const seen = new Set<string>();
    for (const item of rawKeys) {
      if (!seen.has(item.key)) {
        seen.add(item.key);
        this.registerKey(item.key, item.name);
      }
    }
  }

  static registerKey(apiKey: string, name?: string): KeyEntry {
    const trimmed = apiKey.trim();
    const id = `KEY-${this.keyPool.length + 1}`;
    const keyName = name || `Key_${this.keyPool.length + 1}`;
    const masked = this.maskKey(trimmed);

    const existing = this.keyPool.find(k => k.key === trimmed);
    if (existing) {
      existing.status = 'ACTIVE';
      existing.cooldownUntil = undefined;
      return existing;
    }

    const entry: KeyEntry = {
      id,
      name: keyName,
      key: trimmed,
      masked,
      status: 'ACTIVE',
      totalRequests: 0,
      successfulRequests: 0,
      failureCount: 0,
    };

    this.keyPool.push(entry);
    return entry;
  }

  static maskKey(key: string): string {
    if (!key || key.length < 8) return '********';
    const prefix = key.slice(0, 6);
    const suffix = key.slice(-4);
    return `${prefix}...${suffix}`;
  }

  static getGenAIClient(): GoogleGenAI | null {
    if (this.keyPool.length === 0) {
      this.initializePool();
    }

    if (this.keyPool.length === 0) {
      return null;
    }

    const entry = this.getActiveKeyEntry();
    if (!entry) {
      return null;
    }

    let client = this.clientCache.get(entry.key);
    if (!client) {
      client = new GoogleGenAI({ apiKey: entry.key });
      this.clientCache.set(entry.key, client);
    }

    return client;
  }

  static getActiveKeyEntry(): KeyEntry | null {
    const now = Date.now();

    for (const entry of this.keyPool) {
      if (entry.status === 'COOLDOWN' && entry.cooldownUntil && now >= entry.cooldownUntil) {
        entry.status = 'ACTIVE';
        entry.cooldownUntil = undefined;
      }
    }

    const activeEntries = this.keyPool.filter(k => k.status === 'ACTIVE');
    if (activeEntries.length === 0) {
      return null;
    }

    const selected = activeEntries[this.currentIndex % activeEntries.length];
    this.currentIndex++;
    selected.lastUsedAt = new Date().toISOString();
    selected.totalRequests++;
    return selected;
  }

  static reportQuotaExhaustion(apiKey: string, retryDelaySeconds?: number): void {
    const entry = this.keyPool.find(k => k.key === apiKey);
    if (!entry) return;

    const delaySec = Math.max(15, Math.min(3600, retryDelaySeconds || 60));
    entry.status = 'COOLDOWN';
    entry.cooldownUntil = Date.now() + delaySec * 1000;
    entry.failureCount++;
    entry.lastError = `Quota exceeded / 429 rate limit. Placed on cooldown for ${delaySec}s.`;

    console.warn(`🔄 [KeyRotationService] Key ${entry.name} (${entry.masked}) rate-limited (429). Rotating to next available key in pool.`);
  }

  static reportSuccess(apiKey: string): void {
    const entry = this.keyPool.find(k => k.key === apiKey);
    if (entry) {
      entry.successfulRequests++;
      if (entry.status === 'COOLDOWN') {
        entry.status = 'ACTIVE';
        entry.cooldownUntil = undefined;
      }
    }
  }

  static async executeWithAutoRotation<T>(
    operation: (client: GoogleGenAI, keyEntry: KeyEntry) => Promise<T>,
    options: { maxRetries?: number } = {}
  ): Promise<T> {
    const maxRetries = Math.min(this.keyPool.length || 1, options.maxRetries || 3);
    let lastError: unknown;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const keyEntry = this.getActiveKeyEntry();
      if (!keyEntry) {
        throw new Error('All Gemini API keys in rotation pool are currently in cooldown or exhausted.');
      }

      let client = this.clientCache.get(keyEntry.key);
      if (!client) {
        client = new GoogleGenAI({ apiKey: keyEntry.key });
        this.clientCache.set(keyEntry.key, client);
      }

      try {
        const result = await operation(client, keyEntry);
        this.reportSuccess(keyEntry.key);
        return result;
      } catch (err: any) {
        lastError = err;
        const errMessage = String(err?.message || '');
        const isRateLimit = err?.status === 429 || errMessage.includes('429') || errMessage.includes('RESOURCE_EXHAUSTED');

        if (isRateLimit) {
          let delaySeconds = 60;
          if (err?.error?.details) {
            const retryDetail = err.error.details.find((d: any) => d['@type']?.includes('RetryInfo'));
            if (retryDetail && retryDetail.retryDelay) {
              const secondsMatch = retryDetail.retryDelay.match(/(\d+)s/);
              if (secondsMatch) delaySeconds = parseInt(secondsMatch[1], 10);
            }
          }
          this.reportQuotaExhaustion(keyEntry.key, delaySeconds);
        } else {
          keyEntry.failureCount++;
          keyEntry.lastError = errMessage.slice(0, 150);
        }
      }
    }

    throw lastError || new Error('Operation failed across all available Gemini API keys.');
  }

  static getKeyPoolMetrics(): KeyPoolMetrics {
    const now = Date.now();
    let activeCount = 0;
    let cooldownCount = 0;
    let exhaustedCount = 0;

    const sanitizedKeys = this.keyPool.map(k => {
      let status = k.status;
      let cooldownRemainingSec: number | undefined;

      if (k.status === 'COOLDOWN' && k.cooldownUntil) {
        if (now >= k.cooldownUntil) {
          status = 'ACTIVE';
        } else {
          cooldownRemainingSec = Math.ceil((k.cooldownUntil - now) / 1000);
        }
      }

      if (status === 'ACTIVE') activeCount++;
      else if (status === 'COOLDOWN') cooldownCount++;
      else if (status === 'EXHAUSTED') exhaustedCount++;

      return {
        id: k.id,
        name: k.name,
        masked: k.masked,
        status,
        totalRequests: k.totalRequests,
        successfulRequests: k.successfulRequests,
        failureCount: k.failureCount,
        cooldownRemainingSec,
        lastUsedAt: k.lastUsedAt,
        lastError: k.lastError,
      };
    });

    return {
      totalKeys: this.keyPool.length,
      activeKeys: activeCount,
      cooldownKeys: cooldownCount,
      exhaustedKeys: exhaustedCount,
      currentActiveKeyId: this.keyPool[this.currentIndex % (this.keyPool.length || 1)]?.id,
      model: config.gemini.model,
      keys: sanitizedKeys,
    };
  }

  static clearPool(): void {
    this.keyPool = [];
    this.clientCache.clear();
    this.currentIndex = 0;
  }
}
