import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { AgentRunEntity } from '../../providers/db/entities/agent-run.entity';
import { AgentActionEntity } from '../../providers/db/entities/agent-action.entity';
import { AgentRuntimeEventsService } from '../agent-runtime-events/agent-runtime-events.service';
import { AgentGoalService } from './agent-goal.service';
import { AgentRuntimeService } from '../agent-runtime/agent-runtime.service';

@Injectable()
export class AgentRunsService {
  constructor(
    @InjectRepository(AgentRunEntity) private readonly runRepo: Repository<AgentRunEntity>,
    @InjectRepository(AgentActionEntity) private readonly actionRepo: Repository<AgentActionEntity>,
    private readonly events: AgentRuntimeEventsService,
    private readonly goals: AgentGoalService,
    private readonly runtime: AgentRuntimeService,
  ) {}

  async start(input: { threadId: string; userId?: string; mode: AgentRunEntity['mode']; maxSteps?: number; maxToolCalls?: number; maxDelegations?: number }) {
    const run = await this.runRepo.save(this.runRepo.create({ id: randomUUID(), threadId: input.threadId, userId: input.userId ?? null, mode: input.mode, maxSteps: input.maxSteps ?? 18, maxToolCalls: input.maxToolCalls ?? 24, maxDelegations: input.maxDelegations ?? 6, status: 'running', actionCount: 0, toolCallCount: 0, delegationCount: 0, retryCount: 0, costUsd: 0, requiresApproval: false }));
    await this.events.emit({ threadId: run.threadId, runId: run.id, eventType: 'run.started', actor: run.mode, payload: { mode: run.mode, maxSteps: run.maxSteps } });
    return run;
  }

  async finish(id: string, input: { route?: string; status?: AgentRunEntity['status']; resultSummary?: string; queryLogId?: string; retryCount?: number; costUsd?: number; requiresApproval?: boolean; errorMessage?: string }) {
    const run = await this.runRepo.findOne({ where: { id } });
    if (!run) throw new NotFoundException(`agent run ${id} not found`);
    Object.assign(run, input);
    run.finishedAt = input.status && input.status !== 'running' ? new Date() : run.finishedAt;
    const saved = await this.runRepo.save(run);
    await this.events.emit({ threadId: saved.threadId, runId: saved.id, eventType: `run.${saved.status === 'completed' ? 'completed' : saved.status === 'failed' ? 'failed' : 'updated'}`, actor: saved.mode, payload: { status: saved.status, route: saved.route, costUsd: saved.costUsd } });
    return saved;
  }

  async recordRuntimeEvent(runId: string, input: { eventType: string; actor?: string; target?: string; payload?: unknown; taskId?: string }) {
    const run = await this.runRepo.findOne({ where: { id: runId } });
    if (!run) throw new NotFoundException(`agent run ${runId} not found`);
    return this.events.emit({
      threadId: run.threadId,
      runId,
      taskId: input.taskId,
      eventType: input.eventType,
      actor: input.actor ?? run.mode,
      target: input.target,
      payload: input.payload,
    });
  }

  async updateCurrentNode(runId: string, currentNode: string, payload?: unknown) {
    const run = await this.runRepo.findOne({ where: { id: runId } });
    if (!run) throw new NotFoundException(`agent run ${runId} not found`);
    run.currentNode = currentNode;
    await this.runRepo.save(run);
    return this.events.emit({
      threadId: run.threadId,
      runId,
      eventType: 'node.started',
      actor: run.mode,
      target: currentNode,
      payload,
    });
  }

  async recordAction(runId: string, input: { name: string; actionType?: string; status?: AgentActionEntity['status']; riskLevel?: AgentActionEntity['riskLevel']; requiresApproval?: boolean; durationMs?: number; input?: unknown; output?: unknown }) {
    const runBeforeAction = await this.runRepo.findOne({ where: { id: runId } });
    if (!runBeforeAction) throw new NotFoundException(`agent run ${runId} not found`);
    if (runBeforeAction.toolCallCount >= runBeforeAction.maxToolCalls) {
      await this.events.emit({ threadId: runBeforeAction.threadId, runId, eventType: 'budget.exceeded', actor: runBeforeAction.mode, target: input.name, payload: { budget: 'tool_calls', maxToolCalls: runBeforeAction.maxToolCalls } });
      throw new BadRequestException(`agent run ${runId} exceeded max tool calls`);
    }
    const action = await this.actionRepo.save(this.actionRepo.create({ id: randomUUID(), runId, name: input.name, actionType: input.actionType ?? 'tool', status: input.status ?? 'success', riskLevel: input.riskLevel ?? 'low', requiresApproval: input.requiresApproval ?? false, durationMs: input.durationMs ?? 0, input: this.stringify(input.input), output: this.stringify(input.output) }));
    await this.runRepo.increment({ id: runId }, 'actionCount', 1);
    await this.runRepo.increment({ id: runId }, 'toolCallCount', 1);
    const run = await this.runRepo.findOne({ where: { id: runId } });
    if (run) await this.events.emit({ threadId: run.threadId, runId, eventType: input.status === 'failed' ? 'tool.failed' : 'tool.called', actor: run.mode, target: input.name, payload: { actionType: input.actionType ?? 'tool', riskLevel: input.riskLevel ?? 'low', durationMs: input.durationMs ?? 0 } });
    return action;
  }

  async reserveDelegation(runId: string) {
    const run = await this.runRepo.findOne({ where: { id: runId } });
    if (!run) throw new NotFoundException(`agent run ${runId} not found`);
    if (run.delegationCount >= run.maxDelegations) {
      await this.events.emit({ threadId: run.threadId, runId, eventType: 'budget.exceeded', actor: run.mode, payload: { budget: 'delegations', maxDelegations: run.maxDelegations } });
      throw new BadRequestException(`agent run ${runId} exceeded max delegations`);
    }
    await this.runRepo.increment({ id: runId }, 'delegationCount', 1);
    return { allowed: true, remaining: run.maxDelegations - run.delegationCount - 1 };
  }

  async list(limit = 50) {
    const runs = await this.runRepo.find({ order: { createdAt: 'DESC' }, take: Math.min(Math.max(limit, 1), 200) });
    return Promise.all(runs.map(async (run) => ({ ...run, goal: await this.goals.get(run.id) })));
  }

  async findLatestByThread(threadId: string) {
    return this.runRepo.findOne({
      where: { threadId },
      order: { createdAt: 'DESC' },
    });
  }

  async get(id: string) {
    const run = await this.runRepo.findOne({ where: { id } });
    if (!run) throw new NotFoundException(`agent run ${id} not found`);
    const actions = await this.actionRepo.find({ where: { runId: id }, order: { createdAt: 'ASC' } });
    const events = await this.events.list(run.threadId, id);
    return {
      ...run,
      actions,
      events,
      metrics: await this.events.metrics(run.threadId, id),
      goal: await this.goals.get(id),
      failureOnset: this.runtime.analyzeFailureOnset(events.map((event) => ({
        sequence: event.sequence,
        eventType: event.eventType,
        actor: event.actor ?? undefined,
        target: event.target ?? undefined,
        payload: event.payload,
      }))),
    };
  }

  async retry(id: string) {
    const run = await this.get(id);
    await this.runRepo.update({ id }, { status: 'running', retryCount: run.retryCount + 1, errorMessage: null, finishedAt: null });
    await this.events.emit({ threadId: run.threadId, runId: id, eventType: 'run.retry', actor: run.mode, payload: { retryCount: run.retryCount + 1 } });
    return this.get(id);
  }

  private stringify(value: unknown): string | null {
    if (value == null) return null;
    return typeof value === 'string' ? value.slice(0, 20000) : JSON.stringify(value).slice(0, 20000);
  }
}
