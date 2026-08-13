import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { AgentRuntimeEventEntity } from '../../providers/db/entities/agent-runtime-event.entity';

@Injectable()
export class AgentRuntimeEventsService {
  private readonly threadQueues = new Map<string, Promise<unknown>>();

  constructor(@InjectRepository(AgentRuntimeEventEntity) private readonly events: Repository<AgentRuntimeEventEntity>) {}

  async emit(input: { threadId: string; runId?: string; taskId?: string; eventType: string; actor: string; target?: string; payload?: unknown }) {
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

  private async persist(input: { threadId: string; runId?: string; taskId?: string; eventType: string; actor: string; target?: string; payload?: unknown }) {
    const latest = await this.events.findOne({ where: { threadId: input.threadId }, order: { sequence: 'DESC' } });
    return this.events.save(this.events.create({
      id: randomUUID(), threadId: input.threadId, runId: input.runId ?? null, taskId: input.taskId ?? null,
      eventType: input.eventType, actor: input.actor, target: input.target ?? null, sequence: (latest?.sequence ?? 0) + 1,
      payload: JSON.stringify(input.payload ?? {}),
    }));
  }

  async list(threadId?: string, runId?: string) {
    const rows = await this.events.find({ where: { ...(threadId ? { threadId } : {}), ...(runId ? { runId } : {}) }, order: { sequence: 'ASC' }, take: 2000 });
    return rows.map((row) => ({ ...row, payload: this.parse(row.payload) }));
  }

  async metrics(threadId?: string, runId?: string) {
    const events = await this.list(threadId, runId);
    const count = (type: string) => events.filter((event) => event.eventType === type).length;
    return {
      total: events.length,
      tasksCreated: count('task.created'), tasksCompleted: count('task.completed'), tasksFailed: count('task.failed'),
      toolCalls: count('tool.called'), toolFailures: count('tool.failed'), delegations: count('task.delegated'), approvals: count('approval.required'),
      routes: count('route.selected'), retrievals: count('retrieval.completed'), nodeStarts: count('node.started'),
      compactions: count('memory.compaction.completed'), policyDenied: count('policy.denied'),
      goalsCompleted: count('goal.completed'), goalsBlocked: count('goal.blocked'),
    };
  }

  private parse(value: string) { try { return JSON.parse(value); } catch { return {}; } }
}
