/**
 * Durable workflow dispatch contract, stored in the existing PostgreSQL domain_event_outbox.
 * The outbox dispatcher may deliver more than once: BullMQ's stable job ID and workflow
 * state checks MUST continue to protect side effects at the worker boundary.
 */
import type { ProductionWorkflowJob } from './production-workflow-queue.service';

export const WORKFLOW_DISPATCH_REQUESTED_EVENT = 'workflow.dispatch.requested';

export function parseWorkflowDispatch(
  raw: string,
  aggregateThreadId: string,
  aggregateTenantId: string | null,
): ProductionWorkflowJob {
  const payload: unknown = JSON.parse(raw);
  if (!isObject(payload) || !isObject(payload.job)) {
    throw new Error('workflow dispatch has no job payload');
  }
  const job = payload.job;
  if (
    typeof job.id !== 'string' ||
    !/^production-workflow-(start|resume|revise|retry_task)-[a-f0-9]{32}$/.test(job.id) ||
    typeof job.threadId !== 'string' ||
    job.threadId !== aggregateThreadId ||
    typeof job.userId !== 'string' ||
    job.userId.trim().length === 0 ||
    (job.tenantId ?? 'legacy') !== (aggregateTenantId ?? 'legacy')
  ) {
    throw new Error('workflow dispatch identity or tenant mismatch');
  }
  if (
    !['start', 'resume', 'revise', 'retry_task'].includes(String(job.operation)) ||
    !job.id.startsWith(`production-workflow-${job.operation}-`)
  ) {
    throw new Error('unknown workflow dispatch operation');
  }
  if (job.operation === 'retry_task') {
    if (typeof job.taskId !== 'string' || !job.taskId.trim() ||
        typeof job.role !== 'string' || !job.role.trim()) {
      throw new Error('retry_task dispatch missing task identity');
    }
  } else if (!isObject(job.dto)) {
    throw new Error('workflow dispatch missing DTO');
  }
  return job as unknown as ProductionWorkflowJob;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Reject unsupported deployment configurations before starting a Worker. */
export function workerSettings(env: NodeJS.ProcessEnv = process.env) {
  const raw = env.WORKFLOW_QUEUE_CONCURRENCY ?? '1';
  const concurrency = Number(raw);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) {
    throw new Error('WORKFLOW_QUEUE_CONCURRENCY must be an integer from 1 to 16');
  }
  const flag = env.WORKFLOW_PROCESSOR_ENABLED ?? 'true';
  if (flag !== 'true' && flag !== 'false') {
    throw new Error('WORKFLOW_PROCESSOR_ENABLED must be true or false');
  }
  return { enabled: flag === 'true', concurrency };
}
