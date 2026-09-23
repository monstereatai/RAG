import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, LessThan, Repository } from 'typeorm';
import { AgentRuntimeEventEntity } from '../../providers/db/entities/agent-runtime-event.entity';

@Injectable()
export class AgentRuntimeEventsService {
  private readonly threadQueues = new Map<string, Promise<unknown>>();

  constructor(
    @InjectRepository(AgentRuntimeEventEntity)
    private readonly events: Repository<AgentRuntimeEventEntity>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async emit(input: {
    tenantId?: string;
    threadId: string;
    runId?: string;
    taskId?: string;
    eventType: string;
    actor: string;
    target?: string;
    payload?: unknown;
  }) {
    const previous = this.threadQueues.get(input.threadId) ?? Promise.resolve();
    const write = previous
      .catch(() => undefined)
      .then(() => this.persist(input));
    this.threadQueues.set(input.threadId, write);
    // finally 会创建新的 Promise；不能让它把 write 已被调用方处理的拒绝
    // 再次变成进程级 unhandled rejection。
    void write
      .finally(() => {
        if (this.threadQueues.get(input.threadId) === write) {
          this.threadQueues.delete(input.threadId);
        }
      })
      .catch(() => undefined);
    return write;
  }

  private async persist(input: {
    tenantId?: string;
    threadId: string;
    runId?: string;
    taskId?: string;
    eventType: string;
    actor: string;
    target?: string;
    payload?: unknown;
  }) {
    const tenantId = input.tenantId ?? 'legacy';
    const sequence = await this.nextSequence(tenantId, input.threadId);
    return this.events.save(
      this.events.create({
        id: randomUUID(),
        tenantId,
        threadId: input.threadId,
        runId: input.runId ?? null,
        taskId: input.taskId ?? null,
        eventType: input.eventType,
        actor: input.actor,
        target: input.target ?? null,
        sequence,
        payload: JSON.stringify(input.payload ?? {}),
      }),
    );
  }

  private async nextSequence(
    tenantId: string,
    threadId: string,
  ): Promise<number> {
    if (this.dataSource.options.type === 'postgres') {
      const rawRows: unknown = await this.dataSource.query(
        `INSERT INTO "agent_runtime_event_sequences" ("id", "tenantId", "threadId", "nextSequence") VALUES ($1, $2, $3, 1)
         ON CONFLICT ("tenantId", "threadId") DO UPDATE SET "nextSequence" = "agent_runtime_event_sequences"."nextSequence" + 1, "updatedAt" = CURRENT_TIMESTAMP
         RETURNING "nextSequence"`,
        [randomUUID(), tenantId, threadId],
      );
      const rows = rawRows as Array<{ nextSequence?: number | string }>;
      return Number(rows[0]?.nextSequence ?? 1);
    }

    // MySQL LAST_INSERT_ID(expr) is connection-local, so allocate and read
    // the sequence through one runner to avoid cross-instance read races.
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      await runner.query(
        `INSERT INTO agent_runtime_event_sequences (id, tenantId, threadId, nextSequence) VALUES (?, ?, ?, LAST_INSERT_ID(1))
         ON DUPLICATE KEY UPDATE nextSequence = LAST_INSERT_ID(nextSequence + 1), updatedAt = CURRENT_TIMESTAMP`,
        [randomUUID(), tenantId, threadId],
      );
      const rows = (await runner.query(
        'SELECT LAST_INSERT_ID() AS nextSequence',
      )) as Array<{ nextSequence?: number | string }>;
      return Number(rows[0]?.nextSequence ?? 1);
    } finally {
      await runner.release();
    }
  }

  async list(
    threadId?: string,
    runId?: string,
    tenantId = 'legacy',
    beforeSequence?: number,
    requestedLimit = 200,
  ) {
    const limit = Math.min(Math.max(Math.trunc(requestedLimit) || 200, 1), 500);
    const rows = await this.events.find({
      where: {
        tenantId,
        ...(threadId ? { threadId } : {}),
        ...(runId ? { runId } : {}),
        ...(Number.isFinite(beforeSequence) && beforeSequence! > 0
          ? { sequence: LessThan(beforeSequence!) }
          : {}),
      },
      order: { sequence: 'DESC' },
      take: limit,
    });
    return rows
      .reverse()
      .map((row) => ({ ...row, payload: this.parse(row.payload) }));
  }

  async metrics(threadId?: string, runId?: string, tenantId = 'legacy') {
    const query = this.events
      .createQueryBuilder('event')
      .where('event.tenantId = :tenantId', { tenantId });
    if (threadId) query.andWhere('event.threadId = :threadId', { threadId });
    if (runId) query.andWhere('event.runId = :runId', { runId });
    const groups = await query
      .clone()
      .select('event.eventType', 'eventType')
      .addSelect('COUNT(*)', 'count')
      .groupBy('event.eventType')
      .getRawMany<{ eventType: string; count: string }>();
    const counts = new Map(
      groups.map((row) => [row.eventType, Number(row.count)]),
    );
    const count = (type: string) => counts.get(type) ?? 0;
    const recoveredToolCalls = Number(
      await query
        .clone()
        .andWhere('event.eventType = :eventType', { eventType: 'tool.result' })
        .andWhere('event.payload LIKE :recovered', {
          recovered: '%"recovered":true%',
        })
        .getCount(),
    );
    return {
      total: groups.reduce((total, row) => total + Number(row.count), 0),
      tasksCreated: count('task.created'),
      tasksCompleted: count('task.completed'),
      tasksFailed: count('task.failed'),
      toolCalls: count('tool.called'),
      toolFailures: count('tool.failed'),
      delegations: count('task.delegated'),
      approvals: count('approval.required'),
      routes: count('route.selected'),
      retrievals: count('retrieval.completed'),
      nodeStarts: count('node.started'),
      compactions: count('memory.compaction.completed'),
      policyDenied: count('policy.denied'),
      goalsCompleted: count('goal.completed'),
      goalsBlocked: count('goal.blocked'),
      requestSnapshots: count('request.snapshot'),
      toolResults: count('tool.result'),
      toolBlocked: count('tool.blocked'),
      approvalAsked: count('approval.asked'),
      approvalDecided: count('approval.decided'),
      recoveredToolCalls,
      loopStarts: count('agent.loop.started'),
      loopRounds: count('agent.loop.round.completed'),
      loopCompletions: count('agent.loop.completed'),
      loopFailures: count('agent.loop.failed'),
      loopBlocked: count('agent.loop.blocked'),
      loopBudgetExceeded: count('agent.loop.budget_exceeded'),
    };
  }

  private parse(value: string): unknown {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed;
    } catch {
      return {};
    }
  }
}
