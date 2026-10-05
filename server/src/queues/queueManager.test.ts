import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { queueManager } from './queueManager';
import { INTAKE_QUEUE_NAME, startIntakeWorker } from './workers/intakeWorker';
import { createApp } from '../app';
import { AuthService } from '../services/authService';

const CSV_SAMPLE = `cpse,code,description,unit,price,qty,supplier,year,plant
A,VLV-001,4 INCH GATE VALVE CLASS 150 FLANGED WCB BODY,EA,14500,10,L&T Valves,2023,Refinery-1
A,VLV-002,2 INCH GLOBE VALVE CLASS 300 SS304,EA,8200,5,Audco,2024,Platform-A
A,PMP-001,CENTRIFUGAL PUMP 50 HP 1450 RPM EN8 SHAFT,EA,75000,2,Kirloskar,2023,Unit-3
`;

async function waitForCompletion(jobId: string, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const job = await queueManager.getJob(jobId);
    if (job && (job.status === 'completed' || job.status === 'failed')) {
      return job;
    }
    await new Promise(r => setTimeout(r, 50));
  }
  return await queueManager.getJob(jobId);
}

describe('Step 15: Background Job Queue for Gemini Tasks (BullMQ + In-Memory Fallback)', () => {
  beforeEach(async () => {
    await queueManager.clear();
    startIntakeWorker(3);
  });

  it('enqueues a job, transitions from waiting to active to completed, and returns result', async () => {
    let workerExecuted = false;

    queueManager.registerWorker('test-basic-queue', async (job) => {
      workerExecuted = true;
      assert.equal(job.data.task, 'hello');
      await job.updateProgress({ percent: 50, stage: 'WORKING', message: 'In progress' });
      return { success: true, processed: 1 };
    });

    const job = await queueManager.addJob('test-basic-queue', 'test-job', { task: 'hello' });

    assert.ok(job.id);
    assert.equal(job.name, 'test-job');

    // Wait briefly for in-memory queue tick
    await new Promise(r => setTimeout(r, 80));

    const retrieved = await queueManager.getJob(job.id);
    assert.ok(retrieved);
    assert.equal(retrieved.status, 'completed');
    assert.equal(retrieved.progress.percent, 100);
    assert.equal(retrieved.result?.success, true);
    assert.equal(workerExecuted, true);
  });

  it('tracks incremental progress stages and logs', async () => {
    const progressStages: string[] = [];

    queueManager.registerWorker('test-progress-queue', async (job) => {
      await job.log('Starting step 1');
      await job.updateProgress({ percent: 25, stage: 'STEP_1', processedCount: 25, totalCount: 100 });
      progressStages.push('STEP_1');

      await job.log('Starting step 2');
      await job.updateProgress({ percent: 75, stage: 'STEP_2', processedCount: 75, totalCount: 100 });
      progressStages.push('STEP_2');

      return { done: true };
    });

    const job = await queueManager.addJob('test-progress-queue', 'progress-job', { foo: 'bar' });

    await new Promise(r => setTimeout(r, 80));

    const finished = await queueManager.getJob(job.id);
    assert.ok(finished);
    assert.equal(finished.status, 'completed');
    assert.deepEqual(progressStages, ['STEP_1', 'STEP_2']);
    assert.ok(finished.logs.length >= 2);
    assert.ok(finished.logs.some(l => l.includes('Starting step 1')));
  });

  it('respects concurrency limits across parallel jobs', async () => {
    let runningCount = 0;
    let maxObservedRunning = 0;

    queueManager.registerWorker(
      'test-concurrency-queue',
      async (job) => {
        runningCount++;
        maxObservedRunning = Math.max(maxObservedRunning, runningCount);
        // Simulate workload
        await new Promise(r => setTimeout(r, 60));
        runningCount--;
        return { jobId: job.id };
      },
      { concurrency: 2 }
    );

    // Launch 4 jobs concurrently
    const p1 = queueManager.addJob('test-concurrency-queue', 'job-1', {});
    const p2 = queueManager.addJob('test-concurrency-queue', 'job-2', {});
    const p3 = queueManager.addJob('test-concurrency-queue', 'job-3', {});
    const p4 = queueManager.addJob('test-concurrency-queue', 'job-4', {});

    await Promise.all([p1, p2, p3, p4]);

    // Give time for all 4 jobs to complete
    await new Promise(r => setTimeout(r, 260));

    assert.ok(maxObservedRunning <= 2, `Max concurrency exceeded: observed ${maxObservedRunning} > 2`);

    const jobs = await queueManager.listJobs({ queueName: 'test-concurrency-queue' });
    assert.equal(jobs.length, 4);
    assert.ok(jobs.every(j => j.status === 'completed'));
  });

  it('handles retries with exponential backoff on transient failure and recovers', async () => {
    let attempts = 0;

    queueManager.registerWorker('test-retry-queue', async (_job) => {
      attempts++;
      if (attempts < 2) {
        throw new Error('Simulated Gemini 503 Service Unavailable / Rate Limit');
      }
      return { recovered: true, attempts };
    });

    const job = await queueManager.addJob(
      'test-retry-queue',
      'retry-job',
      {},
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 40 },
      }
    );

    // Wait enough time for backoff retry (40ms) and execution
    await new Promise(r => setTimeout(r, 160));

    const finished = await queueManager.getJob(job.id);
    assert.ok(finished);
    assert.equal(finished.status, 'completed');
    assert.equal(finished.attemptsMade, 1); // 1 failed attempt before recovery
    assert.equal(finished.result?.recovered, true);
  });

  it('marks job as failed when maximum retry attempts are exhausted', async () => {
    queueManager.registerWorker('test-fail-queue', async () => {
      throw new Error('Fatal database corruption or unrecoverable schema mismatch');
    });

    const job = await queueManager.addJob(
      'test-fail-queue',
      'fail-job',
      {},
      {
        attempts: 2,
        backoff: { type: 'fixed', delay: 20 },
      }
    );

    await new Promise(r => setTimeout(r, 120));

    const finished = await queueManager.getJob(job.id);
    assert.ok(finished);
    assert.equal(finished.status, 'failed');
    assert.ok(finished.failedReason?.includes('Fatal database corruption'));
  });

  it('cancels a pending or active job on demand', async () => {
    queueManager.registerWorker('test-cancel-queue', async (_job) => {
      await new Promise(r => setTimeout(r, 200));
      return { done: true };
    });

    const job = await queueManager.addJob('test-cancel-queue', 'cancellable-job', {});

    const cancelled = await queueManager.cancelJob(job.id);
    assert.equal(cancelled, true);

    const check = await queueManager.getJob(job.id);
    assert.ok(check);
    assert.equal(check.status, 'failed');
    assert.ok(check.failedReason?.includes('cancelled'));
  });

  it('processes bulk intake in chunks with progress updates and quality summary', async () => {
    const job = await queueManager.addJob(
      INTAKE_QUEUE_NAME,
      'test_bulk_intake.csv',
      {
        rawText: CSV_SAMPLE,
        filename: 'test_bulk_intake.csv',
        dryRun: true,
        chunkSize: 1, // force 3 individual chunks
        tenantId: 'A',
        user: {
          id: 'user_test',
          email: 'cpse_admin@a.gov.in',
          role: 'CPSE_ADMIN',
          cpseId: 'A',
        },
      }
    );

    // Wait for chunked execution to finish
    const finished = await waitForCompletion(job.id);
    assert.ok(finished);
    assert.equal(finished.status, 'completed');
    assert.equal(finished.progress.percent, 100);
    assert.equal(finished.result?.success, true);
    assert.equal(finished.result?.itemsProcessed, 3);
    assert.equal(finished.result?.enrichedCount, 3);
    assert.ok(finished.result?.batchId);
    assert.equal(finished.result?.data?.qualitySummary?.totalRows, 3);
  });
});

describe('Step 15: HTTP Job Queue Endpoints & Async Intake Wiring', () => {
  const app = createApp();

  it('POST /api/v1/jobs/intake queues a background job and returns HTTP 202 Accepted', async () => {
    const { accessToken } = AuthService.loginAsRole('CPSE_ADMIN', 'A');

    const server = app.listen(0);
    const address = server.address() as any;
    const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;

    try {
      const res = await fetch(`${baseUrl}/jobs/intake`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          rawText: CSV_SAMPLE,
          filename: 'async_batch.csv',
          dryRun: true,
          cpseId: 'A',
        }),
      });

      assert.equal(res.status, 202);
      const json = await res.json();
      assert.equal(json.status, 'success');
      assert.ok(json.data.jobId);
      assert.equal(json.data.queueName, INTAKE_QUEUE_NAME);
      assert.ok(json.data.statusUrl.includes(json.data.jobId));
    } finally {
      server.close();
    }
  });

  it('GET /api/v1/jobs/:id retrieves status, progress, and completed result', async () => {
    const { accessToken } = AuthService.loginAsRole('CPSE_ADMIN', 'A');

    const job = await queueManager.addJob(
      INTAKE_QUEUE_NAME,
      'status_check.csv',
      {
        rawText: CSV_SAMPLE,
        filename: 'status_check.csv',
        dryRun: true,
        tenantId: 'A',
        user: {
          id: 'user_a',
          email: 'admin@a.gov.in',
          role: 'CPSE_ADMIN',
          cpseId: 'A',
        },
      }
    );

    // Wait for execution
    await waitForCompletion(job.id);

    const server = app.listen(0);
    const address = server.address() as any;
    const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;

    try {
      const res = await fetch(`${baseUrl}/jobs/${job.id}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.status, 'success');
      assert.equal(json.data.id, job.id);
      assert.equal(json.data.status, 'completed');
      assert.equal(json.data.progress.percent, 100);
      assert.equal(json.data.result.itemsProcessed, 3);
    } finally {
      server.close();
    }
  });

  it('POST /api/v1/intake/paste with async=true enqueues background job', async () => {
    const { accessToken } = AuthService.loginAsRole('CPSE_ADMIN', 'A');

    const server = app.listen(0);
    const address = server.address() as any;
    const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;

    try {
      const res = await fetch(`${baseUrl}/intake/paste?async=true`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          text: CSV_SAMPLE,
          filename: 'async_pasted.csv',
          dryRun: true,
          cpseId: 'A',
        }),
      });

      assert.equal(res.status, 202);
      const json = await res.json();
      assert.equal(json.status, 'success');
      assert.ok(json.data.jobId);
      assert.ok(json.message.includes('queued'));
    } finally {
      server.close();
    }
  });

  it('POST /api/v1/jobs/:id/cancel cancels an active or queued job', async () => {
    const { accessToken } = AuthService.loginAsRole('CPSE_ADMIN', 'A');

    const job = await queueManager.addJob(
      'cancellation-test-queue',
      'long_job',
      { tenantId: 'A' }
    );

    const server = app.listen(0);
    const address = server.address() as any;
    const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;

    try {
      const res = await fetch(`${baseUrl}/jobs/${job.id}/cancel`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.status, 'success');
      assert.ok(json.message.includes('cancelled'));
    } finally {
      server.close();
    }
  });

  it('GET /api/v1/jobs lists background jobs scoped by tenant', async () => {
    const { accessToken } = AuthService.loginAsRole('CPSE_ADMIN', 'A');

    const server = app.listen(0);
    const address = server.address() as any;
    const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;

    try {
      const res = await fetch(`${baseUrl}/jobs`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.status, 'success');
      assert.ok(Array.isArray(json.data.jobs));
      assert.ok(typeof json.data.total === 'number');
    } finally {
      server.close();
    }
  });
});
