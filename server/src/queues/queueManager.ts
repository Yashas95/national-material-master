import { config } from '../config/env';
import {
  JobOptions,
  JobProgress,
  JobResult,
  JobStatus,
  UnifiedJob,
} from './types';
import Redis from 'ioredis';
import { Queue as BullQueue, Worker as BullWorker, Job as BullJob } from 'bullmq';

class UnifiedJobImpl<T = any> implements UnifiedJob<T> {
  id: string;
  name: string;
  queueName: string;
  data: T;
  status: JobStatus;
  progress: JobProgress;
  result?: JobResult;
  failedReason?: string;
  attemptsMade: number;
  maxAttempts: number;
  createdAt: Date;
  processedOn?: Date;
  finishedOn?: Date;
  logs: string[];

  private backoffConfig?: { type: 'exponential' | 'fixed'; delay: number };
  private onProgressCallback?: (progress: JobProgress) => void;

  constructor(
    id: string,
    name: string,
    queueName: string,
    data: T,
    options?: JobOptions,
    onProgress?: (progress: JobProgress) => void
  ) {
    this.id = id;
    this.name = name;
    this.queueName = queueName;
    this.data = data;
    this.status = 'waiting';
    this.progress = {
      percent: 0,
      stage: 'QUEUED',
      processedCount: 0,
      totalCount: 0,
      message: 'Job queued for processing',
    };
    this.attemptsMade = 0;
    this.maxAttempts = options?.attempts || 3;
    this.backoffConfig = options?.backoff || { type: 'exponential', delay: 500 };
    this.createdAt = new Date();
    this.logs = [];
    this.onProgressCallback = onProgress;
  }

  async updateProgress(progressUpdate: Partial<JobProgress>): Promise<void> {
    this.progress = {
      ...this.progress,
      ...progressUpdate,
    };
    if (this.onProgressCallback) {
      this.onProgressCallback(this.progress);
    }
  }

  async log(message: string): Promise<void> {
    const timestamp = new Date().toISOString();
    this.logs.push(`[${timestamp}] ${message}`);
  }

  getBackoffDelay(): number {
    const base = this.backoffConfig?.delay || 500;
    if (this.backoffConfig?.type === 'exponential') {
      return base * Math.pow(2, Math.max(0, this.attemptsMade - 1));
    }
    return base;
  }

  toJSON(): Record<string, any> {
    return {
      id: this.id,
      name: this.name,
      queueName: this.queueName,
      status: this.status,
      progress: this.progress,
      result: this.result,
      failedReason: this.failedReason,
      attemptsMade: this.attemptsMade,
      maxAttempts: this.maxAttempts,
      createdAt: this.createdAt,
      processedOn: this.processedOn,
      finishedOn: this.finishedOn,
      logs: this.logs,
      data: this.data,
    };
  }
}

export type JobProcessor<T = any, R = any> = (job: UnifiedJob<T>) => Promise<R>;

export class QueueManager {
  private static instance: QueueManager | null = null;

  private redisClient: Redis | null = null;
  private isRedisAvailable = false;
  private bullQueues: Map<string, BullQueue> = new Map();
  private bullWorkers: Map<string, BullWorker> = new Map();

  private inMemoryJobs: Map<string, UnifiedJobImpl> = new Map();
  private waitingQueues: Map<string, UnifiedJobImpl[]> = new Map();
  private activeCounts: Map<string, number> = new Map();
  private concurrencyLimits: Map<string, number> = new Map();
  private processors: Map<string, JobProcessor> = new Map();

  private constructor() {}

  static getInstance(): QueueManager {
    if (!QueueManager.instance) {
      QueueManager.instance = new QueueManager();
    }
    return QueueManager.instance;
  }

  async init(): Promise<boolean> {
    try {
      const client = new Redis(config.redis.url, {
        connectTimeout: 800,
        maxRetriesPerRequest: 1,
        lazyConnect: true,
        retryStrategy: () => null,
      });

      await Promise.race([
        client.connect(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Redis connection timeout')), 800)),
      ]);

      this.redisClient = client;
      this.isRedisAvailable = true;
      console.log('✅ [QueueManager] Connected to Redis BullMQ backing at', config.redis.url);
      return true;
    } catch {
      this.isRedisAvailable = false;
      this.redisClient = null;
      return false;
    }
  }

  isUsingRedis(): boolean {
    return this.isRedisAvailable;
  }

  registerWorker<T = any, R = any>(
    queueName: string,
    processor: JobProcessor<T, R>,
    options?: { concurrency?: number }
  ): void {
    const concurrency = options?.concurrency || 3;
    this.processors.set(queueName, processor);
    this.concurrencyLimits.set(queueName, concurrency);
    this.activeCounts.set(queueName, 0);

    if (!this.waitingQueues.has(queueName)) {
      this.waitingQueues.set(queueName, []);
    }

    if (this.isRedisAvailable && this.redisClient) {
      try {
        const worker = new BullWorker(
          queueName,
          async (bullJob: BullJob) => {
            const unified = this.wrapBullJob(bullJob, queueName);
            return await processor(unified);
          },
          {
            connection: this.redisClient,
            concurrency,
          }
        );
        this.bullWorkers.set(queueName, worker);
      } catch (err) {
        console.warn(`⚠️  [QueueManager] Could not start BullWorker for ${queueName}, using in-memory:`, (err as Error).message);
      }
    }
  }

  async addJob<T = any>(
    queueName: string,
    jobName: string,
    data: T,
    options?: JobOptions
  ): Promise<UnifiedJob<T>> {
    const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    if (this.isRedisAvailable && this.redisClient) {
      try {
        let queue = this.bullQueues.get(queueName);
        if (!queue) {
          queue = new BullQueue(queueName, { connection: this.redisClient });
          this.bullQueues.set(queueName, queue);
        }

        const bullJob = await queue.add(jobName, data, {
          jobId,
          attempts: options?.attempts || 3,
          backoff: options?.backoff || { type: 'exponential', delay: 500 },
          priority: options?.priority,
          delay: options?.delay,
        });

        const unified = this.wrapBullJob(bullJob, queueName);
        this.inMemoryJobs.set(unified.id, unified as unknown as UnifiedJobImpl);
        return unified;
      } catch (err) {
        console.warn('⚠️  [QueueManager] BullMQ enqueue error, falling back to in-memory queue:', (err as Error).message);
      }
    }

    const job = new UnifiedJobImpl<T>(jobId, jobName, queueName, data, options);
    this.inMemoryJobs.set(job.id, job);

    const queueList = this.waitingQueues.get(queueName) || [];
    queueList.push(job);
    this.waitingQueues.set(queueName, queueList);

    setImmediate(() => this.processNextInMemory(queueName));

    return job;
  }

  private async processNextInMemory(queueName: string): Promise<void> {
    const waiting = this.waitingQueues.get(queueName) || [];
    const concurrency = this.concurrencyLimits.get(queueName) || 3;
    const active = this.activeCounts.get(queueName) || 0;
    const processor = this.processors.get(queueName);

    if (!processor || waiting.length === 0 || active >= concurrency) {
      return;
    }

    const job = waiting.shift();
    if (!job || job.status === 'failed') {
      return;
    }

    this.activeCounts.set(queueName, active + 1);
    job.status = 'active';
    job.processedOn = new Date();
    await job.updateProgress({ percent: 5, stage: 'ACTIVE', message: 'Processing started' });

    try {
      const result = await processor(job);
      job.status = 'completed';
      job.finishedOn = new Date();
      job.result = result;
      await job.updateProgress({ percent: 100, stage: 'COMPLETED', message: 'Processing finished successfully' });
    } catch (err) {
      job.attemptsMade++;
      const errorMsg = (err as Error).message || String(err);
      job.failedReason = errorMsg;
      await job.log(`Attempt ${job.attemptsMade} failed: ${errorMsg}`);

      if (job.attemptsMade < job.maxAttempts) {
        job.status = 'delayed';
        const delayMs = job.getBackoffDelay();
        await job.updateProgress({
          stage: 'RETRYING',
          message: `Attempt ${job.attemptsMade} failed. Retrying in ${delayMs}ms...`,
        });

        setTimeout(() => {
          if (job.status === 'delayed') {
            job.status = 'waiting';
            waiting.push(job);
            this.processNextInMemory(queueName);
          }
        }, delayMs);
      } else {
        job.status = 'failed';
        job.finishedOn = new Date();
        await job.updateProgress({ percent: job.progress.percent, stage: 'FAILED', message: `Job failed after ${job.maxAttempts} attempts: ${errorMsg}` });
      }
    } finally {
      const currentActive = this.activeCounts.get(queueName) || 1;
      this.activeCounts.set(queueName, Math.max(0, currentActive - 1));
      setImmediate(() => this.processNextInMemory(queueName));
    }
  }

  async getJob(jobId: string): Promise<UnifiedJob | null> {
    const job = this.inMemoryJobs.get(jobId);
    if (job) return job;

    if (this.isRedisAvailable) {
      for (const [qName, queue] of this.bullQueues.entries()) {
        try {
          const bullJob = await queue.getJob(jobId);
          if (bullJob) {
            return this.wrapBullJob(bullJob, qName);
          }
        } catch {}
      }
    }

    return null;
  }

  async listJobs(filter?: {
    queueName?: string;
    status?: JobStatus;
    tenantId?: string;
    limit?: number;
  }): Promise<UnifiedJob[]> {
    let list = Array.from(this.inMemoryJobs.values());

    if (filter?.queueName) {
      list = list.filter(j => j.queueName === filter.queueName);
    }

    if (filter?.status) {
      list = list.filter(j => j.status === filter.status);
    }

    if (filter?.tenantId && filter.tenantId !== 'GLOBAL') {
      list = list.filter(j => {
        const payloadTenant = (j.data as any)?.tenantId || (j.data as any)?.user?.cpseId;
        return !payloadTenant || payloadTenant === filter.tenantId;
      });
    }

    list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    if (filter?.limit && filter.limit > 0) {
      list = list.slice(0, filter.limit);
    }

    return list;
  }

  async cancelJob(jobId: string): Promise<boolean> {
    const job = this.inMemoryJobs.get(jobId);
    if (!job) return false;

    if (job.status === 'completed') {
      return false;
    }

    job.status = 'failed';
    job.failedReason = 'Job cancelled by user request';
    job.finishedOn = new Date();
    await job.updateProgress({ stage: 'CANCELLED', message: 'Job cancelled by user request' });

    const waiting = this.waitingQueues.get(job.queueName);
    if (waiting) {
      const idx = waiting.findIndex(j => j.id === jobId);
      if (idx !== -1) waiting.splice(idx, 1);
    }

    return true;
  }

  async clear(): Promise<void> {
    this.inMemoryJobs.clear();
    this.waitingQueues.clear();
    this.activeCounts.clear();
  }

  async close(): Promise<void> {
    for (const worker of this.bullWorkers.values()) {
      try {
        await worker.close();
      } catch {}
    }
    for (const queue of this.bullQueues.values()) {
      try {
        await queue.close();
      } catch {}
    }
    if (this.redisClient) {
      try {
        await this.redisClient.quit();
      } catch {}
    }
    this.bullWorkers.clear();
    this.bullQueues.clear();
    this.redisClient = null;
    this.isRedisAvailable = false;
  }

  private wrapBullJob(bullJob: BullJob, queueName: string): UnifiedJob {
    let status: JobStatus = 'waiting';
    if (bullJob.failedReason) status = 'failed';
    else if (bullJob.returnvalue) status = 'completed';
    else if (bullJob.processedOn) status = 'active';

    const progress: JobProgress = typeof bullJob.progress === 'object'
      ? (bullJob.progress as unknown as JobProgress)
      : {
          percent: Number(bullJob.progress) || 0,
          stage: status.toUpperCase(),
          processedCount: 0,
          totalCount: 0,
        };

    return {
      id: String(bullJob.id),
      name: bullJob.name,
      queueName,
      data: bullJob.data,
      status,
      progress,
      result: bullJob.returnvalue as JobResult,
      failedReason: bullJob.failedReason,
      attemptsMade: bullJob.attemptsMade,
      maxAttempts: bullJob.opts.attempts || 3,
      createdAt: new Date(bullJob.timestamp),
      processedOn: bullJob.processedOn ? new Date(bullJob.processedOn) : undefined,
      finishedOn: bullJob.finishedOn ? new Date(bullJob.finishedOn) : undefined,
      logs: [],
      async updateProgress(p: Partial<JobProgress>) {
        await bullJob.updateProgress(p as any);
      },
      async log(msg: string) {
        await bullJob.log(msg);
      },
      toJSON() {
        return {
          id: String(bullJob.id),
          name: bullJob.name,
          queueName,
          status,
          progress,
          result: bullJob.returnvalue,
          failedReason: bullJob.failedReason,
          attemptsMade: bullJob.attemptsMade,
          createdAt: new Date(bullJob.timestamp),
          processedOn: bullJob.processedOn ? new Date(bullJob.processedOn) : undefined,
          finishedOn: bullJob.finishedOn ? new Date(bullJob.finishedOn) : undefined,
          data: bullJob.data,
        };
      },
    };
  }
}

export const queueManager = QueueManager.getInstance();
