export type JobStatus = 'waiting' | 'active' | 'completed' | 'failed' | 'delayed';

export type JobType = 'BULK_INTAKE' | 'GEMINI_ENRICHMENT' | 'BATCH_MATCHING';

export interface JobProgress {
  percent: number;
  stage: string;
  processedCount: number;
  totalCount: number;
  currentChunk?: number;
  totalChunks?: number;
  message?: string;
  errors?: string[];
  details?: Record<string, any>;
}

export interface JobOptions {
  attempts?: number;
  backoff?: {
    type: 'exponential' | 'fixed';
    delay: number;
  };
  priority?: number;
  delay?: number;
  removeOnComplete?: boolean | number;
  removeOnFail?: boolean | number;
}

export interface JobResult {
  success: boolean;
  summary: string;
  itemsProcessed: number;
  enrichedCount: number;
  errorsCount: number;
  batchId?: string;
  durationMs: number;
  data?: any;
}

export interface UnifiedJob<T = any> {
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

  updateProgress(progress: Partial<JobProgress>): Promise<void>;
  log(message: string): Promise<void>;
  toJSON(): Record<string, any>;
}

export interface IntakeJobPayload {
  rawText: string;
  filename: string;
  tenantId: string;
  user: {
    id: string;
    email: string;
    role: string;
    cpseId?: string;
  };
  dryRun?: boolean;
  chunkSize?: number;
}
