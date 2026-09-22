import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import { AgentRuntimeEventEntity } from '../../providers/db/entities/agent-runtime-event.entity';
import { AgentRuntimeEventSequenceEntity } from '../../providers/db/entities/agent-runtime-event-sequence.entity';

@Injectable()
export class AgentRuntimeEventsService {
  private readonly threadQueues = new Map<string, Promise<unknown>>();

  constructor(
    @InjectRepository(AgentRuntimeEventEntity)
    private readonly events: Repository<AgentRuntimeEventEntity>,
    @InjectRepository(AgentRuntimeEventSequenceEntity)
    private readonly sequences: Repository<AgentRuntimeEventSequenceEntity>,
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
    void write.finally(() => {
      if (this.threadQueues.get(input.threadId) === write) {
        this.threadQueues.delete(input.threadId);
      }
    });
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

  private async nextSequence(tenantId: string, threadId: string): Promise<number> {
    if (this.dataSource.options.type === 'postgres') {
      const rows = await this.dataSource.query(
        `INSERT INTO "agent_runtime_event_sequences" ("id", "tenantId", "threadId", "nextSequence") VALUES ($1, $2, $3, 1)
         ON CONFLICT ("tenantId", "threadId") DO UPDATE SET "nextSequence" = "agent_runtime_event_sequences"."nextSequence" + 1, "updatedAt" = CURRENT_TIMESTAMP
         RETURNING "nextSequence"`,
        [randomUUID(), tenantId, threadId],
      );
      return Number(rows[0]?.nextSequence ?? 1);
    }

    // MySQL fallback：唯一键保证每个租户/线程只有一条序号行，更新后再读取。
    await this.dataSource.query(
      `INSERT INTO agent_runtime_event_sequences (id, tenantId, threadId, nextSequence) VALUES (?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE nextSequence = nextSequence + 1, updatedAt = CURRENT_TIMESTAMP`,
      [randomUUID(), tenantId, threadId],
    );
    const rows = await this.sequences.findOne({ where: { tenantId, threadId } });
    return rows?.nextSequence ?? 1;
  }

  async list(threadId?: string, runId?: string, tenantId = 'legacy') {
    const rows = await this.events.find({
      where: {
        tenantId,
        ...(threadId ? { threadId } : {}),
        ...(runId ? { runId } : {}),
      },
      order: { sequence: 'ASC' },
      take: 2000,
    });
    return rows.map((row) => ({ ...row, payload: this.parse(row.payload) }));
  }

  async metrics(threadId?: string, runId?: string, tenantId = 'legacy') {
    const events = await this.list(threadId, runId, tenantId);
    const count = (type: string) =>
      events.filter((event) => event.eventType === type).length;
    return {
      total: events.length,
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
      recoveredToolCalls: events.filter(
        (event) =>
          event.eventType === 'tool.result' &&
          Boolean((event.payload as { recovered?: boolean }).recovered),
      ).length,
      loopStarts: count('agent.loop.started'),
      loopRounds: count('agent.loop.round.completed'),
      loopCompletions: count('agent.loop.completed'),
      loopFailures: count('agent.loop.failed'),
      loopBlocked: count('agent.loop.blocked'),
      loopBudgetExceeded: count('agent.loop.budget_exceeded'),
    };
  }

  private parse(value: string) {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
}
