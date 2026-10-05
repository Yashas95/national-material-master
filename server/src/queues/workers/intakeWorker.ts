import { queueManager } from '../queueManager';
import { IntakeJobPayload, JobResult, UnifiedJob } from '../types';
import { IntakeService } from '../../services/intakeService';
import { AuditService } from '../../services/auditService';
import { AuthUser } from '../../models/auth';

export const INTAKE_QUEUE_NAME = 'intake-queue';

export async function processIntakeJob(job: UnifiedJob<IntakeJobPayload>): Promise<JobResult> {
  const startTime = Date.now();
  const { rawText, filename, dryRun, chunkSize = 25, user, tenantId } = job.data;

  await job.log(`Starting intake processing for file "${filename}" (dryRun=${!!dryRun})`);
  await job.updateProgress({
    percent: 10,
    stage: 'PARSING',
    processedCount: 0,
    totalCount: 0,
    message: `Parsing content from "${filename}"...`,
  });

  const parsed = IntakeService.parseContent(rawText, filename);
  if (parsed.rejections.length > 0 && parsed.rawRows.length === 0) {
    throw new Error(`File parsing failed: ${parsed.rejections[0]?.reason || 'Invalid file format'}`);
  }

  const authUser: AuthUser = {
    id: user.id,
    name: user.email.split('@')[0],
    email: user.email,
    role: user.role as any,
    tenantId: user.cpseId || tenantId,
    permissions: [],
  };

  const validation = IntakeService.validateRows(parsed.rawRows, authUser, tenantId);
  const totalValid = validation.validRows.length;
  const totalRejections = validation.rejections.length + parsed.rejections.length;

  await job.log(`Validated ${totalValid} valid rows, ${totalRejections} rejections.`);
  await job.updateProgress({
    percent: 25,
    stage: 'VALIDATING',
    processedCount: 0,
    totalCount: totalValid,
    message: `Validated ${totalValid} rows. Preparing chunked enrichment...`,
  });

  if (totalValid === 0) {
    const durationMs = Date.now() - startTime;
    return {
      success: false,
      summary: `Upload contained 0 valid rows (${totalRejections} rejected).`,
      itemsProcessed: 0,
      enrichedCount: 0,
      errorsCount: totalRejections,
      durationMs,
      data: {
        rejections: [...parsed.rejections, ...validation.rejections],
        warnings: validation.warnings,
      },
    };
  }

  const batchId = `b_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const effectiveChunkSize = Math.max(1, chunkSize);
  const totalChunks = Math.ceil(totalValid / effectiveChunkSize);
  const allEnriched: any[] = [];

  for (let c = 0; c < totalChunks; c++) {
    const start = c * effectiveChunkSize;
    const end = Math.min(start + effectiveChunkSize, totalValid);
    const chunk = validation.validRows.slice(start, end);

    await job.log(`Enriching chunk ${c + 1}/${totalChunks} (rows ${start + 1} to ${end})...`);
    const enrichedChunk = await IntakeService.enrichBatch(chunk, batchId);
    allEnriched.push(...enrichedChunk);

    const processedCount = allEnriched.length;
    const percent = Math.round(25 + (processedCount / totalValid) * 60);

    await job.updateProgress({
      percent,
      stage: 'ENRICHING',
      processedCount,
      totalCount: totalValid,
      currentChunk: c + 1,
      totalChunks,
      message: `Enriched ${processedCount} of ${totalValid} records...`,
    });
  }

  await job.updateProgress({
    percent: 90,
    stage: 'PERSISTING',
    processedCount: totalValid,
    totalCount: totalValid,
    message: 'Persisting batch records and generating quality metrics...',
  });

  const qualityIssues = allEnriched.flatMap(r => r.qualityIssues);
  const qualitySummary = {
    validUnits: allEnriched.filter(r => r.unitInfo !== null).length,
    missingCriticalAttrCount: qualityIssues.filter(i => i.type === 'MISSING_ATTR').length,
    unclassifiedCount: qualityIssues.filter(i => i.type === 'UNCLASSIFIED').length,
    totalRows: allEnriched.length,
  };

  const durationMs = Date.now() - startTime;
  const result: JobResult = {
    success: true,
    summary: `Successfully ingested and enriched ${totalValid} items from "${filename}".`,
    itemsProcessed: totalValid,
    enrichedCount: allEnriched.length,
    errorsCount: totalRejections,
    batchId,
    durationMs,
    data: {
      batchId,
      filename,
      dryRun: !!dryRun,
      totalValid,
      totalRejections,
      qualitySummary,
      rejections: [...parsed.rejections, ...validation.rejections],
    },
  };

  await AuditService.recordAudit({
    action: 'BULK_INTAKE_JOB_COMPLETED',
    target: batchId,
    actor: user.email,
    role: user.role,
    detail: `Bulk intake job ${job.id} completed: ${totalValid} rows ingested in ${durationMs}ms`,
    extra: {
      jobId: job.id,
      filename,
      dryRun: !!dryRun,
      processedCount: totalValid,
      durationMs,
    },
  });

  await job.log(`Bulk intake job completed successfully in ${durationMs}ms`);
  return result;
}

export function startIntakeWorker(concurrency = 3): void {
  queueManager.registerWorker(INTAKE_QUEUE_NAME, processIntakeJob, { concurrency });
}
