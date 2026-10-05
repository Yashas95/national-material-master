import { Router, Request, Response } from 'express';
import { prisma } from '../config/db';
import { config } from '../config/env';
import { KeyRotationService } from '../config/keyRotation';
import { QueueManager } from '../queues/queueManager';

export const healthRouter = Router();

async function checkSystemHealth(_req: Request, res: Response) {
  const startTime = Date.now();

  let dbStatus: 'UP' | 'DOWN' | 'OFFLINE' = 'OFFLINE';
  let dbLatencyMs = 0;
  try {
    const dbStart = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    dbLatencyMs = Date.now() - dbStart;
    dbStatus = 'UP';
  } catch {
    dbStatus = 'DOWN';
  }

  const queueManager = QueueManager.getInstance();
  const redisUsing = queueManager.isUsingRedis();
  const redisStatus: 'UP' | 'IN_MEMORY_FALLBACK' = redisUsing ? 'UP' : 'IN_MEMORY_FALLBACK';

  const geminiMetrics = KeyRotationService.getKeyPoolMetrics();
  let geminiStatus: 'OPERATIONAL' | 'RATE_LIMITED' | 'OFFLINE' = 'OPERATIONAL';
  if (geminiMetrics.totalKeys === 0) {
    geminiStatus = 'OFFLINE';
  } else if (geminiMetrics.activeKeys === 0) {
    geminiStatus = 'RATE_LIMITED';
  }

  const isHealthy = dbStatus === 'UP' && geminiStatus === 'OPERATIONAL' && redisUsing;
  const overallStatus = isHealthy ? 'HEALTHY' : 'DEGRADED';

  const totalLatencyMs = Date.now() - startTime;
  const memoryUsage = process.memoryUsage();

  res.status(200).json({
    status: 'ok',
    health: overallStatus,
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    service: 'National Unified Material Master Framework (NUMMF)',
    environment: config.server.env,
    uptime: process.uptime(),
    uptimeSeconds: Math.round(process.uptime()),
    latencyMs: totalLatencyMs,
    services: {
      database: {
        status: dbStatus,
        latencyMs: dbLatencyMs,
      },
      redisQueue: {
        status: redisStatus,
        mode: redisUsing ? 'BULLMQ_REDIS' : 'RESILIENT_IN_MEMORY',
      },
      gemini: {
        status: geminiStatus,
        model: config.gemini.model,
        embeddingModel: config.gemini.embeddingModel,
        activeKeys: geminiMetrics.activeKeys,
        cooldownKeys: geminiMetrics.cooldownKeys,
        totalKeys: geminiMetrics.totalKeys,
      },
    },
    system: {
      nodeVersion: process.version,
      heapUsedMb: Math.round(memoryUsage.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(memoryUsage.heapTotal / 1024 / 1024),
      rssMb: Math.round(memoryUsage.rss / 1024 / 1024),
    },
  });
}

healthRouter.get('/health', checkSystemHealth);
healthRouter.get('/', checkSystemHealth);

healthRouter.get('/health/gemini', (_req: Request, res: Response) => {
  const metrics = KeyRotationService.getKeyPoolMetrics();
  res.status(200).json({
    status: 'success',
    timestamp: new Date().toISOString(),
    data: metrics,
  });
});

healthRouter.post('/health/gemini/rotate', (req: Request, res: Response) => {
  const { apiKey, name } = req.body;

  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length < 8) {
    res.status(400).json({
      status: 'error',
      message: 'Valid apiKey string (min 8 characters) is required to register into key pool.',
    });
    return;
  }

  const registered = KeyRotationService.registerKey(apiKey.trim(), name);

  res.status(200).json({
    status: 'success',
    message: `API key ${registered.name} registered and activated into rotation pool.`,
    data: {
      id: registered.id,
      name: registered.name,
      masked: registered.masked,
      status: registered.status,
    },
  });
});
