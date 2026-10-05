import { Router, Request, Response } from 'express';
import { requirePermission } from '../middleware/authMiddleware';
import { ProcurementService } from '../services/procurementService';
import { z } from 'zod';

export const procurementRouter = Router();

const GenerateInsightSchema = z.object({
  clusterKey: z.string().min(1, 'clusterKey is required'),
  forceRefresh: z.boolean().optional().default(false),
});

procurementRouter.get(
  '/procurement/opportunities',
  requirePermission('procurement_view'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const category = req.query.category as string | undefined;
      const minCpses = req.query.minCpses ? parseInt(req.query.minCpses as string, 10) : undefined;
      const minSpend = req.query.minSpend ? parseFloat(req.query.minSpend as string) : undefined;
      const outliersOnly = req.query.outliersOnly === 'true';
      const q = req.query.q as string | undefined;
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

      const result = await ProcurementService.getOpportunities(
        { category, minCpses, minSpend, outliersOnly, q, page, limit },
        req.user
      );

      res.status(200).json({
        status: 'success',
        ...result,
      });
    } catch (err) {
      res.status(500).json({
        status: 'error',
        message: 'Failed to retrieve procurement opportunities',
        detail: (err as Error).message,
      });
    }
  }
);

procurementRouter.get(
  '/procurement/opportunities/:keyOrCode',
  requirePermission('procurement_view'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const keyOrCode = decodeURIComponent(req.params.keyOrCode);
      const opportunity = await ProcurementService.getOpportunity(keyOrCode, req.user);

      if (!opportunity) {
        res.status(404).json({
          status: 'error',
          message: `Procurement opportunity "${keyOrCode}" not found`,
        });
        return;
      }

      res.status(200).json({
        status: 'success',
        data: opportunity,
      });
    } catch (err) {
      res.status(500).json({
        status: 'error',
        message: 'Failed to retrieve procurement opportunity details',
        detail: (err as Error).message,
      });
    }
  }
);

procurementRouter.post(
  '/procurement/insights',
  requirePermission('procurement_view'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = GenerateInsightSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          status: 'error',
          message: 'Invalid request payload',
          errors: parsed.error.errors,
        });
        return;
      }

      const { clusterKey, forceRefresh } = parsed.data;
      const opp = await ProcurementService.getOpportunity(clusterKey, req.user);

      if (!opp) {
        res.status(404).json({
          status: 'error',
          message: `Procurement opportunity for cluster "${clusterKey}" not found`,
        });
        return;
      }

      const briefing = await ProcurementService.generateExecutiveBriefing(opp, forceRefresh);

      res.status(200).json({
        status: 'success',
        data: {
          clusterKey: opp.clusterKey,
          nationalMaterialCode: opp.nationalMaterialCode,
          standardDescription: opp.standardDescription,
          briefing,
        },
      });
    } catch (err) {
      res.status(500).json({
        status: 'error',
        message: 'Failed to generate procurement insights',
        detail: (err as Error).message,
      });
    }
  }
);

procurementRouter.get(
  '/procurement/stats',
  requirePermission('procurement_view'),
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const stats = await ProcurementService.getProcurementStats();

      res.status(200).json({
        status: 'success',
        data: stats,
      });
    } catch (err) {
      res.status(500).json({
        status: 'error',
        message: 'Failed to retrieve procurement statistics',
        detail: (err as Error).message,
      });
    }
  }
);
