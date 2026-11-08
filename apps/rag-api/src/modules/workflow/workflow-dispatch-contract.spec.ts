import {
  parseWorkflowDispatch,
  workerSettings,
} from './workflow-dispatch-contract';

const id = 'production-workflow-start-' + 'a'.repeat(32);
const job = {
  id,
  operation: 'start',
  threadId: 'thread-1',
  tenantId: 'tenant-1',
  userId: 'user-1',
  dto: { projectId: 'project-1', brief: 'example' },
};

describe('Workflow durable dispatch contract', () => {
  it('accepts a persisted job with matching tenant and thread identity', () => {
    expect(
      parseWorkflowDispatch(
        JSON.stringify({ job }),
        'thread-1',
        'tenant-1',
      ),
    ).toEqual(job);
  });
  it('rejects cross-tenant replay before queue delivery', () => {
    expect(() =>
      parseWorkflowDispatch(JSON.stringify({ job }), 'thread-1', 'tenant-2'),
    ).toThrow('identity or tenant');
  });
  it('rejects invalid job identity and missing retry targets', () => {
    expect(() =>
      parseWorkflowDispatch(
        JSON.stringify({ job: { ...job, id: 'forged' } }),
        'thread-1',
        'tenant-1',
      ),
    ).toThrow();
    expect(() =>
      parseWorkflowDispatch(
        JSON.stringify({ job: { ...job, id: 'production-workflow-retry_task-' + 'a'.repeat(32), operation: 'retry_task' } }),
        'thread-1',
        'tenant-1',
      ),
    ).toThrow('missing task identity');
  });
  it('accepts a coding task dispatch with stable task and attempt identity', () => {
    const taskId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const codingTaskJob = {
      id: `production-workflow-coding_task-${taskId.replace(/-/g, '')}-r0`,
      operation: 'coding_task',
      threadId: 'thread-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      taskId,
      taskAttempt: 0,
      resume: false,
    };
    expect(
      parseWorkflowDispatch(
        JSON.stringify({ job: codingTaskJob }),
        'thread-1',
        'tenant-1',
      ),
    ).toEqual(codingTaskJob);
    expect(() =>
      parseWorkflowDispatch(
        JSON.stringify({ job: { ...codingTaskJob, resume: 'yes' } }),
        'thread-1',
        'tenant-1',
      ),
    ).toThrow('coding_task dispatch missing task identity');
    expect(() =>
      parseWorkflowDispatch(
        JSON.stringify({ job: { ...codingTaskJob, id: `${codingTaskJob.id}-forged` } }),
        'thread-1',
        'tenant-1',
      ),
    ).toThrow('identity or tenant mismatch');
  });
  it('validates bounded per-process Worker concurrency', () => {
    expect(workerSettings({ WORKFLOW_PROCESSOR_ENABLED: 'false', WORKFLOW_QUEUE_CONCURRENCY: '4' } as NodeJS.ProcessEnv))
      .toEqual({ enabled: false, concurrency: 4 });
    expect(() => workerSettings({ WORKFLOW_QUEUE_CONCURRENCY: '1000' } as NodeJS.ProcessEnv)).toThrow();
    expect(() => workerSettings({ WORKFLOW_PROCESSOR_ENABLED: 'maybe' } as NodeJS.ProcessEnv)).toThrow();
  });
});
