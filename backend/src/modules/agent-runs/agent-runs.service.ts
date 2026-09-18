import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { AgentRunEntity } from '../../providers/db/entities/agent-run.entity';
import { AgentActionEntity } from '../../providers/db/entities/agent-action.entity';
import { AgentRuntimeEventsService } from '../agent-runtime-events/agent-runtime-events.service';
import { AgentGoalService } from './agent-goal.service';
import { AgentRuntimeService } from '../agent-runtime/agent-runtime.service';
import { RedisProvider } from '../../providers/redis/redis.provider';

@Injectable()
export class AgentRunsService {
  constructor(
    @InjectRepository(AgentRunEntity)
    private readonly runRepo: Repository<AgentRunEntity>,
    @InjectRepository(AgentActionEntity)
    private readonly actionRepo: Repository<AgentActionEntity>,
    private readonly events: AgentRuntimeEventsService,
    private readonly goals: AgentGoalService,
    private readonly runtime: AgentRuntimeService,
    private readonly redis: RedisProvider,
  ) {}

  async start(input: {
    threadId: string;
    userId?: string;
    mode: AgentRunEntity['mode'];
    maxSteps?: number;
    maxToolCalls?: number;
    maxDelegations?: number;
  }) {
    const run = await this.runRepo.save(
      this.runRepo.create({
        id: randomUUID(),
        threadId: input.threadId,
        userId: input.userId ?? null,
        mode: input.mode,
        maxSteps: input.maxSteps ?? 18,
        maxToolCalls: input.maxToolCalls ?? 24,
        maxDelegations: input.maxDelegations ?? 6,
        status: 'running',
        actionCount: 0,
        toolCallCount: 0,
        delegationCount: 0,
        retryCount: 0,
        costUsd: 0,
        requiresApproval: false,
      }),
    );
    await this.events.emit({
      threadId: run.threadId,
      runId: run.id,
      eventType: 'run.started',
      actor: run.mode,
      payload: { mode: run.mode, maxSteps: run.maxSteps },
    });
    return run;
  }

  async finish(
    id: string,
    input: {
      route?: string;
      status?: AgentRunEntity['status'];
      resultSummary?: string;
      queryLogId?: string;
      retryCount?: number;
      costUsd?: number;
      requiresApproval?: boolean;
      errorMessage?: string;
    },
  ) {
    const run = await this.runRepo.findOne({ where: { id } });
    if (!run) throw new NotFoundException(`agent run ${id} not found`);
    Object.assign(run, input);
    run.finishedAt =
      input.status && input.status !== 'running' ? new Date() : run.finishedAt;
    const saved = await this.runRepo.save(run);
    await this.events.emit({
      threadId: saved.threadId,
      runId: saved.id,
      eventType: `run.${saved.status === 'completed' ? 'completed' : saved.status === 'failed' ? 'failed' : 'updated'}`,
      actor: saved.mode,
      payload: {
        status: saved.status,
        route: saved.route,
        costUsd: saved.costUsd,
      },
    });
    return saved;
  }

  async cancel(id: string, reason = '用户取消运行') {
    const run = await this.runRepo.findOne({ where: { id } });
    if (!run) throw new NotFoundException(`agent run ${id} not found`);
    if (['completed', 'failed', 'cancelled'].includes(run.status)) {
      return this.get(id);
    }

    const now = new Date();
    run.status = 'cancelled';
    run.cancelledAt = now;
    run.cancelReason = reason.trim().slice(0, 500) || '用户取消运行';
    run.errorMessage = run.cancelReason;
    run.finishedAt = now;
    const saved = await this.runRepo.save(run);
    await this.redis.set(
      `agent-loop:cancel:${saved.threadId}:${saved.id}`,
      'cancelled',
      24 * 60 * 60,
    );
    await this.events.emit({
      threadId: saved.threadId,
      runId: saved.id,
      eventType: 'run.cancelled',
      actor: saved.mode,
      payload: { reason: saved.cancelReason },
    });
    return this.get(id);
  }

  async recordRuntimeEvent(
    runId: string,
    input: {
      eventType: string;
      actor?: string;
      target?: string;
      payload?: unknown;
      taskId?: string;
    },
  ) {
    const run = await this.runRepo.findOne({ where: { id: runId } });
    if (!run) throw new NotFoundException(`agent run ${runId} not found`);
    const event = await this.events.emit({
      threadId: run.threadId,
      runId,
      taskId: input.taskId,
      eventType: input.eventType,
      actor: input.actor ?? run.mode,
      target: input.target,
      payload: input.payload,
    });
    if (input.eventType === 'agent.loop.checkpoint.saved') {
      await this.runRepo.update({ id: runId }, { lastCheckpointAt: new Date() });
    }
    return event;
  }

  async updateCurrentNode(
    runId: string,
    currentNode: string,
    payload?: unknown,
  ) {
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

  async recordAction(
    runId: string,
    input: {
      name: string;
      actionType?: string;
      status?: AgentActionEntity['status'];
      riskLevel?: AgentActionEntity['riskLevel'];
      requiresApproval?: boolean;
      durationMs?: number;
      input?: unknown;
      output?: unknown;
    },
  ) {
    const runBeforeAction = await this.runRepo.findOne({
      where: { id: runId },
    });
    if (!runBeforeAction)
      throw new NotFoundException(`agent run ${runId} not found`);
    if (runBeforeAction.toolCallCount >= runBeforeAction.maxToolCalls) {
      await this.events.emit({
        threadId: runBeforeAction.threadId,
        runId,
        eventType: 'budget.exceeded',
        actor: runBeforeAction.mode,
        target: input.name,
        payload: {
          budget: 'tool_calls',
          maxToolCalls: runBeforeAction.maxToolCalls,
        },
      });
      throw new BadRequestException(
        `agent run ${runId} exceeded max tool calls`,
      );
    }
    const action = await this.actionRepo.save(
      this.actionRepo.create({
        id: randomUUID(),
        runId,
        name: input.name,
        actionType: input.actionType ?? 'tool',
        status: input.status ?? 'success',
        riskLevel: input.riskLevel ?? 'low',
        requiresApproval: input.requiresApproval ?? false,
        durationMs: input.durationMs ?? 0,
        input: this.stringify(input.input),
        output: this.stringify(input.output),
      }),
    );
    await this.runRepo.increment({ id: runId }, 'actionCount', 1);
    await this.runRepo.increment({ id: runId }, 'toolCallCount', 1);
    const run = await this.runRepo.findOne({ where: { id: runId } });
    if (run)
      await this.events.emit({
        threadId: run.threadId,
        runId,
        eventType: input.status === 'failed' ? 'tool.failed' : 'tool.called',
        actor: run.mode,
        target: input.name,
        payload: {
          actionType: input.actionType ?? 'tool',
          riskLevel: input.riskLevel ?? 'low',
          durationMs: input.durationMs ?? 0,
        },
      });
    return action;
  }

  async reserveDelegation(runId: string) {
    const run = await this.runRepo.findOne({ where: { id: runId } });
    if (!run) throw new NotFoundException(`agent run ${runId} not found`);
    if (run.delegationCount >= run.maxDelegations) {
      await this.events.emit({
        threadId: run.threadId,
        runId,
        eventType: 'budget.exceeded',
        actor: run.mode,
        payload: { budget: 'delegations', maxDelegations: run.maxDelegations },
      });
      throw new BadRequestException(
        `agent run ${runId} exceeded max delegations`,
      );
    }
    await this.runRepo.increment({ id: runId }, 'delegationCount', 1);
    return {
      allowed: true,
      remaining: run.maxDelegations - run.delegationCount - 1,
    };
  }

  async list(limit = 50) {
    const runs = await this.runRepo.find({
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 200),
    });
    return Promise.all(
      runs.map(async (run) => ({ ...run, goal: await this.goals.get(run.id) })),
    );
  }

  async summary(limit = 500) {
    const runs = await this.runRepo.find({
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 2000),
    });
    const completed = runs.filter((run) => run.status === 'completed').length;
    const failed = runs.filter((run) => run.status === 'failed').length;
    const cancelled = runs.filter((run) => run.status === 'cancelled').length;
    const waitingApproval = runs.filter(
      (run) => run.status === 'waiting_approval',
    ).length;
    const terminal = completed + failed + cancelled;
    const runtimeMetrics = await Promise.all(
      runs.map((run) => this.events.metrics(run.threadId, run.id)),
    );
    const taskCompleted = runtimeMetrics.reduce(
      (sum, item) => sum + item.tasksCompleted,
      0,
    );
    const taskFailed = runtimeMetrics.reduce(
      (sum, item) => sum + item.tasksFailed,
      0,
    );
    const toolResults = runtimeMetrics.reduce(
      (sum, item) => sum + item.toolResults,
      0,
    );
    const recoveredToolCalls = runtimeMetrics.reduce(
      (sum, item) => sum + item.recoveredToolCalls,
      0,
    );
    const toolCalls = runtimeMetrics.reduce(
      (sum, item) => sum + item.toolCalls,
      0,
    );
    const toolFailures = runtimeMetrics.reduce(
      (sum, item) => sum + item.toolFailures,
      0,
    );
    const deliveryReady = runs.filter(
      (run) => run.status === 'completed' && Boolean(run.resultSummary?.trim()),
    ).length;
    return {
      available: true,
      scanned: runs.length,
      statusCounts: {
        running: runs.filter((run) => run.status === 'running').length,
        waitingApproval,
        completed,
        failed,
        cancelled,
      },
      successRate: terminal ? completed / terminal : 0,
      failureRate: terminal ? failed / terminal : 0,
      totalCostUsd: runs.reduce(
        (sum, run) => sum + Number(run.costUsd || 0),
        0,
      ),
      totalToolCalls: runs.reduce((sum, run) => sum + run.toolCallCount, 0),
      totalRetries: runs.reduce((sum, run) => sum + run.retryCount, 0),
      budgetExceededRuns: runs.filter((run) => run.requiresApproval).length,
      stepAccuracy:
        taskCompleted + taskFailed
          ? taskCompleted / (taskCompleted + taskFailed)
          : 0,
      recoveryRate: toolResults ? recoveredToolCalls / toolResults : 0,
      runtime: { taskCompleted, taskFailed, toolResults, recoveredToolCalls },
      qualityLayers: {
        runSuccessRate: terminal ? completed / terminal : 0,
        toolSuccessRate: toolCalls ? (toolCalls - toolFailures) / toolCalls : 0,
        taskAccuracy:
          taskCompleted + taskFailed
            ? taskCompleted / (taskCompleted + taskFailed)
            : 0,
        deliveryReadyRate: terminal ? deliveryReady / terminal : 0,
      },
    };
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
    const actions = await this.actionRepo.find({
      where: { runId: id },
      order: { createdAt: 'ASC' },
    });
    const events = await this.events.list(run.threadId, id);
    return {
      ...run,
      actions,
      events,
      metrics: await this.events.metrics(run.threadId, id),
      goal: await this.goals.get(id),
      failureOnset: this.runtime.analyzeFailureOnset(
        events.map((event) => ({
          sequence: event.sequence,
          eventType: event.eventType,
          actor: event.actor ?? undefined,
          target: event.target ?? undefined,
          payload: event.payload,
        })),
      ),
    };
  }

  async retry(id: string) {
    const run = await this.get(id);
    if (!['failed', 'cancelled'].includes(run.status)) {
      throw new BadRequestException(
        `agent run ${id} is not retryable from ${run.status}`,
      );
    }
    await this.redis.del(`agent-loop:cancel:${run.threadId}:${run.id}`);
    await this.runRepo.update(
      { id },
      {
        status: 'running',
        retryCount: run.retryCount + 1,
        errorMessage: null,
        cancelReason: null,
        cancelledAt: null,
        finishedAt: null,
      },
    );
    await this.events.emit({
      threadId: run.threadId,
      runId: id,
      eventType: 'run.retry',
      actor: run.mode,
      payload: { retryCount: run.retryCount + 1 },
    });
    return this.get(id);
  }

  private stringify(value: unknown): string | null {
    if (value == null) return null;
    return typeof value === 'string'
      ? value.slice(0, 20000)
      : JSON.stringify(value).slice(0, 20000);
  }
}
