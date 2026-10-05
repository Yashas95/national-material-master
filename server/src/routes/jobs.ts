import { Router, Request, Response } from 'express';
import { queueManager } from '../queues/queueManager';
import { INTAKE_QUEUE_NAME } from '../queues/workers/intakeWorker';
import { requirePermission } from '../middleware/authMiddleware';
import { JobStatus } from '../queues/types';
import { z } from 'zod';

export const jobsRouter = Router();

const QueueIntakeSchema = z.object({
  rawText: z.string().min(1, 'Raw text content is required'),
  filename: z.string().default('upload.csv'),
  dryRun: z.boolean().optional().default(false),
  chunkSize: z.number().int().positive().optional().default(25),
  cpseId: z.string().optional(),
});

jobsRouter.get('/jobs/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const job = await queueManager.getJob(id);

    if (!job) {
      res.status(404).json({
        status: 'error',
        message: `Job "${id}" not found`,
      });
      return;
    }

    if (req.user && req.user.role === 'CPSE_ADMIN' && req.user.tenantId) {
      const payloadTenant = (job.data as any)?.tenantId || (job.data as any)?.user?.cpseId;
      if (payloadTenant && payloadTenant !== req.user.tenantId) {
        res.status(403).json({
          status: 'error',
          message: 'Access denied: Cannot view jobs originating from other CPSEs',
        });
        return;
      }
    }

    res.status(200).json({
      status: 'success',
      data: job.toJSON(),
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: 'Failed to retrieve job details',
      detail: (err as Error).message,
    });
  }
});

jobsRouter.get('/jobs', async (req: Request, res: Response): Promise<void> => {
  try {
    const queueName = req.query.queueName as string | undefined;
    const status = req.query.status as JobStatus | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const tenantId = req.user?.tenantId;

    const jobs = await queueManager.listJobs({
      queueName,
      status,
      tenantId,
      limit,
    });

    res.status(200).json({
      status: 'success',
      data: {
        total: jobs.length,
        jobs: jobs.map(j => j.toJSON()),
      },
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: 'Failed to list jobs',
      detail: (err as Error).message,
    });
  }
});

jobsRouter.post(
  '/jobs/intake',
  requirePermission('upload'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = QueueIntakeSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          status: 'error',
          message: 'Invalid intake job payload',
          errors: parsed.error.errors,
        });
        return;
      }

      const { rawText, filename, dryRun, chunkSize, cpseId } = parsed.data;
      const targetTenant = cpseId || req.user?.tenantId || 'GLOBAL';

      const job = await queueManager.addJob(
        INTAKE_QUEUE_NAME,
        `intake_${filename}`,
        {
          rawText,
          filename,
          dryRun,
          chunkSize,
          tenantId: targetTenant,
          user: {
            id: req.user?.id || 'system',
            email: req.user?.email || 'system@gemini.local',
            role: req.user?.role || 'CPSE_ADMIN',
            cpseId: targetTenant,
          },
        },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
        }
      );

      res.status(202).json({
        status: 'success',
        message: 'Bulk intake job enqueued successfully for background processing',
        data: {
          jobId: job.id,
          queueName: INTAKE_QUEUE_NAME,
          status: job.status,
          statusUrl: `/api/v1/jobs/${job.id}`,
        },
      });
    } catch (err) {
      res.status(500).json({
        status: 'error',
        message: 'Failed to enqueue intake job',
        detail: (err as Error).message,
      });
    }
  }
);

jobsRouter.post('/jobs/:id/cancel', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const cancelled = await queueManager.cancelJob(id);

    if (!cancelled) {
      res.status(400).json({
        status: 'error',
        message: `Unable to cancel job "${id}" (job may not exist or has already completed)`,
      });
      return;
    }

    res.status(200).json({
      status: 'success',
      message: `Job "${id}" cancelled successfully`,
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: 'Failed to cancel job',
      detail: (err as Error).message,
    });
  }
});
