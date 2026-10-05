import { Request, Response, NextFunction } from 'express';

interface QuotaBucket {
  tokensUsedToday: number;
  requestsThisMinute: number;
  lastResetMinute: number;
  lastResetDay: number;
}

export class QuotaGuardService {
  private static buckets = new Map<string, QuotaBucket>();
  public static readonly DEFAULT_RPM_LIMIT = 60;
  public static readonly DAILY_TOKEN_BUDGET = 200_000;

  private static getBucket(key: string): QuotaBucket {
    const now = Date.now();
    const currentMinute = Math.floor(now / 60000);
    const currentDay = Math.floor(now / 86400000);

    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = {
        tokensUsedToday: 0,
        requestsThisMinute: 0,
        lastResetMinute: currentMinute,
        lastResetDay: currentDay,
      };
      this.buckets.set(key, bucket);
      return bucket;
    }

    if (bucket.lastResetMinute !== currentMinute) {
      bucket.requestsThisMinute = 0;
      bucket.lastResetMinute = currentMinute;
    }

    if (bucket.lastResetDay !== currentDay) {
      bucket.tokensUsedToday = 0;
      bucket.lastResetDay = currentDay;
    }

    return bucket;
  }

  static checkQuota(key: string, limitRpm = this.DEFAULT_RPM_LIMIT): { allowed: boolean; remainingRequests: number; tokensUsedToday: number } {
    const bucket = this.getBucket(key);
    if (bucket.requestsThisMinute >= limitRpm) {
      return {
        allowed: false,
        remainingRequests: 0,
        tokensUsedToday: bucket.tokensUsedToday,
      };
    }

    bucket.requestsThisMinute++;
    return {
      allowed: true,
      remainingRequests: limitRpm - bucket.requestsThisMinute,
      tokensUsedToday: bucket.tokensUsedToday,
    };
  }

  static recordTokenUsage(key: string, tokens: number): void {
    const bucket = this.getBucket(key);
    bucket.tokensUsedToday += tokens;
  }

  static reset(): void {
    this.buckets.clear();
  }
}

export function quotaGuard(rpmLimit = QuotaGuardService.DEFAULT_RPM_LIMIT) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const quotaKey = req.user?.tenantId || req.user?.id || req.ip || 'anonymous';
    const status = QuotaGuardService.checkQuota(quotaKey, rpmLimit);

    res.setHeader('X-RateLimit-Limit', rpmLimit);
    res.setHeader('X-RateLimit-Remaining', status.remainingRequests);

    if (!status.allowed) {
      res.status(429).json({
        status: 'error',
        message: 'Too Many Requests: Gemini API quota / rate limit exceeded for this tenant. Please retry in a moment.',
        tokensUsedToday: status.tokensUsedToday,
      });
      return;
    }

    next();
  };
}
