import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config/env';
import { errorHandler } from './middleware/errorHandler';
import { authenticate } from './middleware/authMiddleware';
import { tenantScopeMiddleware } from './middleware/tenantMiddleware';
import { healthRouter } from './routes/health';
import { authRouter } from './routes/auth';
import { intakeRouter } from './routes/intake';
import { decisionRouter } from './routes/decisions';
import { materialRouter } from './routes/materials';
import { auditRouter } from './routes/audit';
import { jobsRouter } from './routes/jobs';
import { procurementRouter } from './routes/procurement';
import { startIntakeWorker } from './queues/workers/intakeWorker';

export function createApp(): Application {
  const app = express();

  startIntakeWorker();

  app.use(helmet());
  app.use(
    cors({
      origin: config.server.allowedOrigins,
      credentials: true,
    })
  );
  app.use(express.json({ limit: `${config.features.maxFileUploadMb}mb` }));
  app.use(express.urlencoded({ extended: true, limit: `${config.features.maxFileUploadMb}mb` }));

  app.use(authenticate);
  app.use(tenantScopeMiddleware);

  app.use('/health', healthRouter);

  app.use(config.server.apiPrefix, healthRouter);
  app.use(config.server.apiPrefix, authRouter);
  app.use(config.server.apiPrefix, intakeRouter);
  app.use(config.server.apiPrefix, decisionRouter);
  app.use(config.server.apiPrefix, materialRouter);
  app.use(config.server.apiPrefix, auditRouter);
  app.use(config.server.apiPrefix, jobsRouter);
  app.use(config.server.apiPrefix, procurementRouter);

  app.use((_req, res) => {
    res.status(404).json({ status: 'error', message: 'Route not found' });
  });

  app.use(errorHandler);

  return app;
}
