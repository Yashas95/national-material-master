import { Router, Request, Response } from 'express';
import { requirePermission } from '../middleware/authMiddleware';
import { AuditService } from '../services/auditService';
import { AuditQuerySchema, AuditExportSchema } from '../models/audit';

export const auditRouter = Router();

auditRouter.get(
  '/audit/logs',
  requirePermission('audit_view'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = AuditQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({
          status: 'error',
          message: 'Invalid audit query parameters',
          errors: parsed.error.errors,
        });
        return;
      }

      const result = await AuditService.getLogs(parsed.data);

      res.status(200).json({
        status: 'success',
        ...result,
      });
    } catch (err) {
      res.status(500).json({
        status: 'error',
        message: 'Failed to retrieve audit logs',
        detail: (err as Error).message,
      });
    }
  }
);

auditRouter.get(
  '/audit/stats',
  requirePermission('audit_view'),
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const stats = await AuditService.getStats();

      res.status(200).json({
        status: 'success',
        data: stats,
      });
    } catch (err) {
      res.status(500).json({
        status: 'error',
        message: 'Failed to retrieve audit statistics',
        detail: (err as Error).message,
      });
    }
  }
);

auditRouter.get(
  '/audit/export',
  requirePermission('audit_view'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = AuditExportSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({
          status: 'error',
          message: 'Invalid export parameters',
          errors: parsed.error.errors,
        });
        return;
      }

      const { format, action, q } = parsed.data;
      const { content, contentType, filename } = await AuditService.exportLogs(
        { action, q },
        format
      );

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.status(200).send(content);
    } catch (err) {
      res.status(500).json({
        status: 'error',
        message: 'Failed to export audit logs',
        detail: (err as Error).message,
      });
    }
  }
);

auditRouter.post(
  '/audit/logs',
  requirePermission('audit_view'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { action, target, detail, extra } = req.body;
      if (!action || !target || !detail) {
        res.status(400).json({
          status: 'error',
          message: 'Missing required fields: action, target, and detail are mandatory.',
        });
        return;
      }

      const actor = req.user?.name || req.user?.id || 'Unknown';
      const role = req.user?.role || 'SYSTEM';

      const entry = await AuditService.log({
        action,
        target,
        actor,
        role,
        detail,
        extra,
      });

      res.status(201).json({
        status: 'success',
        data: entry,
      });
    } catch (err) {
      res.status(500).json({
        status: 'error',
        message: 'Failed to record audit entry',
        detail: (err as Error).message,
      });
    }
  }
);
