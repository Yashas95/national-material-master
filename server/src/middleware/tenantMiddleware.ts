import { Request, Response, NextFunction } from 'express';
import { config } from '../config/env';

export class TenantService {
  static maskRecord<T extends { cpseId?: string; cpse?: string; code?: string }>(
    record: T,
    viewerRole?: string,
    viewerTenantId?: string
  ): T {
    if (!config.features.tenantIsolation) return record;
    if (viewerRole !== 'CPSE_ADMIN' || !viewerTenantId) return record;

    const recordCpse = record.cpseId || record.cpse;
    if (recordCpse && recordCpse !== viewerTenantId) {
      return {
        ...record,
        code: `[MASKED: CPSE ${recordCpse}]`,
      };
    }

    return record;
  }

  static maskRecords<T extends { cpseId?: string; cpse?: string; code?: string }>(
    records: T[],
    viewerRole?: string,
    viewerTenantId?: string
  ): T[] {
    return records.map(r => this.maskRecord(r, viewerRole, viewerTenantId));
  }
}

export function tenantScopeMiddleware(req: Request, _res: Response, next: NextFunction): void {
  if (config.features.tenantIsolation && req.user?.role === 'CPSE_ADMIN' && req.user.tenantId) {
    req.tenantScope = req.user.tenantId;
  }
  next();
}

