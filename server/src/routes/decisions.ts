import { Router, Request, Response } from 'express';
import { requirePermission } from '../middleware/authMiddleware';
import { DecisionService } from '../services/decisionService';
import {
  ExplainRequestSchema,
  ApproveDecisionSchema,
  ModifyDecisionSchema,
  RejectDecisionSchema,
  EscalateDecisionSchema,
  ReopenDecisionSchema,
} from '../models/decision';

export const decisionRouter = Router();

decisionRouter.post('/decisions/explain', async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = ExplainRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        status: 'error',
        message: 'Invalid explain request parameters',
        errors: parsed.error.errors,
      });
      return;
    }

    const { recordA, recordB, pairId } = parsed.data;

    if (!recordA || !recordB) {
      res.status(400).json({
        status: 'error',
        message: 'Both recordA and recordB must be provided for explanation analysis.',
      });
      return;
    }

    const explanation = await DecisionService.explainComparison(recordA, recordB, { pairId });

    res.status(200).json({
      status: 'success',
      data: explanation,
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: 'Failed to generate explanation',
      detail: (err as Error).message,
    });
  }
});

decisionRouter.post(
  '/decisions/approve',
  requirePermission('review'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = ApproveDecisionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          status: 'error',
          message: 'Invalid approval request parameters',
          errors: parsed.error.errors,
        });
        return;
      }

      const { targetId, type, note, forceL2 } = parsed.data;
      const result = await DecisionService.approve(targetId, type, req.user!, note, { forceL2 });

      res.status(200).json({
        status: 'success',
        data: result,
      });
    } catch (err) {
      const msg = (err as Error).message;
      const isForbidden = msg.includes('Forbidden') || msg.includes('Separation of duties');
      res.status(isForbidden ? 403 : 500).json({
        status: 'error',
        message: msg,
      });
    }
  }
);

decisionRouter.post(
  '/decisions/modify',
  requirePermission('review'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = ModifyDecisionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          status: 'error',
          message: 'Invalid modify request parameters',
          errors: parsed.error.errors,
        });
        return;
      }

      const { targetId, standardDescription, note, attributes } = parsed.data;
      const result = await DecisionService.modify(
        targetId,
        standardDescription,
        note,
        req.user!,
        attributes
      );

      res.status(200).json({
        status: 'success',
        data: result,
      });
    } catch (err) {
      res.status(400).json({
        status: 'error',
        message: (err as Error).message,
      });
    }
  }
);

decisionRouter.post(
  '/decisions/reject',
  requirePermission('review'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = RejectDecisionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          status: 'error',
          message: 'Invalid reject request parameters',
          errors: parsed.error.errors,
        });
        return;
      }

      const { targetId, type, reason } = parsed.data;
      const result = await DecisionService.reject(targetId, type, reason, req.user!);

      res.status(200).json({
        status: 'success',
        data: result,
      });
    } catch (err) {
      res.status(400).json({
        status: 'error',
        message: (err as Error).message,
      });
    }
  }
);

decisionRouter.post(
  '/decisions/escalate',
  requirePermission('review'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = EscalateDecisionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          status: 'error',
          message: 'Invalid escalate request parameters',
          errors: parsed.error.errors,
        });
        return;
      }

      const { targetId, type, note } = parsed.data;
      const result = await DecisionService.escalate(targetId, type, note, req.user!);

      res.status(200).json({
        status: 'success',
        data: result,
      });
    } catch (err) {
      res.status(400).json({
        status: 'error',
        message: (err as Error).message,
      });
    }
  }
);

decisionRouter.post(
  '/decisions/reopen',
  requirePermission('review'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = ReopenDecisionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          status: 'error',
          message: 'Invalid reopen request parameters',
          errors: parsed.error.errors,
        });
        return;
      }

      const { targetId, type } = parsed.data;
      const result = await DecisionService.reopen(targetId, type, req.user!);

      res.status(200).json({
        status: 'success',
        data: result,
      });
    } catch (err) {
      res.status(400).json({
        status: 'error',
        message: (err as Error).message,
      });
    }
  }
);
