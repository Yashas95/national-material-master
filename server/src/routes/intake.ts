import { Router, Request, Response } from 'express';
import multer from 'multer';
import { config } from '../config/env';
import { prisma } from '../config/db';
import { requirePermission } from '../middleware/authMiddleware';
import { IntakeService } from '../services/intakeService';
import { PasteIntakeSchema } from '../models/intake';
import { queueManager } from '../queues/queueManager';
import { INTAKE_QUEUE_NAME } from '../queues/workers/intakeWorker';

export const intakeRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.features.maxFileUploadMb * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    const isAllowed =
      /\.(csv|json|txt)$/i.test(file.originalname) ||
      file.mimetype === 'text/csv' ||
      file.mimetype === 'application/json' ||
      file.mimetype === 'text/plain';

    if (isAllowed) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file format. Only CSV and JSON files are accepted.'));
    }
  },
});

intakeRouter.post(
  '/intake/upload',
  requirePermission('upload'),
  upload.single('file'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      if (!req.file) {
        res.status(400).json({
          status: 'error',
          message: 'No file uploaded. Please provide a CSV or JSON file in the "file" field.',
        });
        return;
      }

      const text = req.file.buffer.toString('utf-8');
      const filename = req.file.originalname;
      const dryRun =
        req.query.dryRun === 'true' ||
        req.body.dryRun === 'true' ||
        req.body.dryRun === true;
      const isAsync =
        req.query.async === 'true' ||
        req.body.async === 'true' ||
        req.body.async === true;

      if (isAsync) {
        const job = await queueManager.addJob(
          INTAKE_QUEUE_NAME,
          `upload_${filename}`,
          {
            rawText: text,
            filename,
            dryRun,
            tenantId: req.body.cpseId || req.user?.tenantId || 'GLOBAL',
            user: {
              id: req.user?.id || 'system',
              email: req.user?.email || 'system@gemini.local',
              role: req.user?.role || 'CPSE_ADMIN',
              cpseId: req.body.cpseId || req.user?.tenantId,
            },
          },
          { attempts: 3, backoff: { type: 'exponential', delay: 1000 } }
        );

        res.status(202).json({
          status: 'success',
          message: 'Bulk file upload queued for background processing',
          data: {
            jobId: job.id,
            queueName: INTAKE_QUEUE_NAME,
            status: job.status,
            statusUrl: `/api/v1/jobs/${job.id}`,
          },
        });
        return;
      }

      const report = await IntakeService.processIntake(text, filename, {
        dryRun,
        user: req.user,
        targetCpse: req.body.cpseId,
      });

      res.status(report.success ? 200 : 400).json({
        status: report.success ? 'success' : 'error',
        data: report,
      });
    } catch (err) {
      res.status(500).json({
        status: 'error',
        message: 'Failed to process file upload',
        detail: (err as Error).message,
      });
    }
  }
);

intakeRouter.post(
  '/intake/paste',
  requirePermission('upload'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      let text: string;
      let filename = 'pasted-rows.csv';
      let dryRun = false;
      let cpseId: string | undefined;

      if (typeof req.body === 'string') {
        text = req.body;
      } else if (req.body && Array.isArray(req.body.rows)) {
        text = JSON.stringify(req.body.rows);
        filename = req.body.filename || 'pasted-rows.json';
        dryRun = req.body.dryRun === true || req.body.dryRun === 'true';
        cpseId = req.body.cpseId;
      } else {
        const parsed = PasteIntakeSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({
            status: 'error',
            message: 'Invalid paste intake payload',
            errors: parsed.error.errors,
          });
          return;
        }
        text = parsed.data.text;
        filename = parsed.data.filename;
        dryRun = parsed.data.dryRun;
        cpseId = parsed.data.cpseId;
      }

      const isAsync =
        req.query.async === 'true' ||
        (typeof req.body === 'object' && (req.body.async === 'true' || req.body.async === true));

      if (isAsync) {
        const job = await queueManager.addJob(
          INTAKE_QUEUE_NAME,
          `paste_${filename}`,
          {
            rawText: text,
            filename,
            dryRun,
            tenantId: cpseId || req.user?.tenantId || 'GLOBAL',
            user: {
              id: req.user?.id || 'system',
              email: req.user?.email || 'system@gemini.local',
              role: req.user?.role || 'CPSE_ADMIN',
              cpseId: cpseId || req.user?.tenantId,
            },
          },
          { attempts: 3, backoff: { type: 'exponential', delay: 1000 } }
        );

        res.status(202).json({
          status: 'success',
          message: 'Pasted rows queued for background processing',
          data: {
            jobId: job.id,
            queueName: INTAKE_QUEUE_NAME,
            status: job.status,
            statusUrl: `/api/v1/jobs/${job.id}`,
          },
        });
        return;
      }

      const report = await IntakeService.processIntake(text, filename, {
        dryRun,
        user: req.user,
        targetCpse: cpseId,
      });

      res.status(report.success ? 200 : 400).json({
        status: report.success ? 'success' : 'error',
        data: report,
      });
    } catch (err) {
      res.status(500).json({
        status: 'error',
        message: 'Failed to process pasted rows',
        detail: (err as Error).message,
      });
    }
  }
);

intakeRouter.get(
  '/intake/batches',
  requirePermission('audit_view'),
  async (_req: Request, res: Response): Promise<void> => {
    let batches: any[] = [];
    try {
      batches = await prisma.auditLog.findMany({
        where: { action: 'DATASET_UPLOADED' },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });
    } catch (err) {
      batches = [];
    }

    if (batches.length === 0) {
      batches = IntakeService.getRecentBatches();
    }

    res.status(200).json({
      status: 'success',
      data: batches,
    });
  }
);

intakeRouter.get(
  '/intake/batches/:batchId',
  requirePermission('audit_view'),
  async (req: Request, res: Response): Promise<void> => {
    const { batchId } = req.params;
    let records: any[] = [];
    try {
      records = await prisma.legacyRecord.findMany({
        where: { batchId },
        include: { procurementHistory: true },
        take: 100,
      });
    } catch (err) {
      records = [];
    }

    if (records.length === 0) {
      records = IntakeService.getBatchRecords(batchId);
    }

    res.status(200).json({
      status: 'success',
      batchId,
      count: records.length,
      data: records,
    });
  }
);
