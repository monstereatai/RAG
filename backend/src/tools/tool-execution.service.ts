import { Injectable, Optional } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { ArtifactsService } from '../modules/artifacts/artifacts.service';
import { AgentRuntimeEventsService } from '../modules/agent-runtime-events/agent-runtime-events.service';
import { RedisProvider } from '../providers/redis/redis.provider';
import { MetricsService } from '../modules/metrics/metrics.service';
import {
  ToolExecutionPolicyService,
  type ToolExecutionContext,
} from './tool-execution-policy.service';

export type ToolApprovalPolicy = 'auto' | 'required' | 'risk_based';
export type ToolExecutionStatus =
  | 'success'
  | 'failed'
  | 'blocked'
  | 'unknown'
  | 'recovered';

export interface ExecuteRegisteredToolInput<T> extends ToolExecutionContext {
  toolName: string;
  threadId: string;
  runId?: string;
  actor?: string;
  ownerUserId?: string;
  input?: unknown;
  approvalPolicy?: ToolApprovalPolicy;
  approvalGranted?: boolean;
  idempotencyKey?: string;
  sideEffect?: boolean;
  execute: () => Promise<T>;
}

export interface RegisteredToolExecution<T> {
  callId: string;
  status: ToolExecutionStatus;
  output?: T;
  error?: string;
  durationMs: number;
  outputPreview?: string;
  outputArtifactId?: string;
  recovered?: boolean;
}

/**
 * 所有需要审计的工具都使用同一执行外壳：先记录调用，再执行权限、审批、幂等、超时以外的业务逻辑，最后写入不可变结果事件。
 * 不把完整大结果塞进运行事件；超过阈值时仅保留预览和 Artifact 定位。
 */
@Injectable()
export class ToolExecutionService {
  private static readonly OUTPUT_PREVIEW_LIMIT = 6_000;
  private static readonly IDEMPOTENCY_TTL_SECONDS = 60 * 60;

  constructor(
    private readonly policy: ToolExecutionPolicyService,
    private readonly events: AgentRuntimeEventsService,
    private readonly redis: RedisProvider,
    @Optional() private readonly artifacts?: ArtifactsService,
    @Optional() private readonly metricsService?: MetricsService,
  ) {}

  async execute<T>(
    input: ExecuteRegisteredToolInput<T>,
  ): Promise<RegisteredToolExecution<T>> {
    const callId = randomUUID();
    const startedAt = Date.now();
    const actor = input.actor ?? input.role ?? input.mode;
    const decision = this.policy.decide(input.toolName, input);
    await this.events.emit({
      threadId: input.threadId,
      runId: input.runId,
      eventType: 'tool.call',
      actor,
      target: input.toolName,
      payload: {
        callId,
        input: this.summarize(input.input),
        sideEffect: Boolean(input.sideEffect),
        idempotencyKey: input.idempotencyKey ?? null,
      },
    });
    if (!decision.allowed) {
      return this.finish(input, callId, actor, startedAt, {
        status: 'blocked',
        error: decision.reason,
      });
    }

    if (decision.requiresApproval) {
      const approvalId = randomUUID();
      await this.events.emit({
        threadId: input.threadId,
        runId: input.runId,
        eventType: 'approval.asked',
        actor,
        target: input.toolName,
        payload: {
          approvalId,
          callId,
          reason: 'Tool Registry 将该操作标记为需要审批。',
        },
      });
      const approved =
        input.approvalGranted === true || input.approvalPolicy === 'auto';
      await this.events.emit({
        threadId: input.threadId,
        runId: input.runId,
        eventType: 'approval.decided',
        actor,
        target: input.toolName,
        payload: {
          approvalId,
          callId,
          outcome: approved ? 'allowed-once' : 'unavailable',
          policy: input.approvalPolicy ?? 'auto',
        },
      });
      if (!approved) {
        return this.finish(input, callId, actor, startedAt, {
          status: 'blocked',
          error: '该写入型工具等待人工审批，系统按拒绝优先策略未执行。',
        });
      }
    }

    // 写入型工具必须依赖 Redis 的跨实例幂等锁。Redis 不可用时无法区分
    // “尚未执行”和“已执行但结果丢失”，继续执行会把未知副作用放大成重复写入。
    if (input.sideEffect && !this.redis.isEnabled()) {
      return this.finish(input, callId, actor, startedAt, {
        status: 'blocked',
        error: '幂等存储不可用，写入型工具按安全策略暂不执行。',
      });
    }

    const idempotencyKey = input.sideEffect
      ? (input.idempotencyKey ?? this.fingerprint(input))
      : undefined;
    const redisKey = idempotencyKey
      ? `tool-execution:${idempotencyKey}`
      : undefined;
    if (redisKey) {
      const idempotencyLookupStartedAt = process.hrtime.bigint();
      const previous = await this.redis.get(redisKey);
      this.metricsService?.observeCacheOperation(
        'tool_idempotency',
        'get',
        Number(process.hrtime.bigint() - idempotencyLookupStartedAt) / 1e9,
      );
      this.metricsService?.observeCacheRequest(
        'tool_idempotency',
        Boolean(previous?.startsWith('completed:')),
      );
      if (previous?.startsWith('completed:')) {
        let output: T | undefined;
        try {
          output = JSON.parse(previous.slice('completed:'.length)) as T;
        } catch {
          /* 已有旧格式结果只保留恢复审计。 */
        }
        return this.finish(input, callId, actor, startedAt, {
          status: 'recovered',
          output,
          recovered: true,
          outputPreview: '检测到相同幂等键已完成，未重复执行写入操作。',
        });
      }
      const locked = await this.redis.setIfAbsent(
        redisKey,
        'running',
        ToolExecutionService.IDEMPOTENCY_TTL_SECONDS,
      );
      if (!locked && this.redis.isEnabled()) {
        return this.finish(input, callId, actor, startedAt, {
          status: 'blocked',
          error: '相同幂等键的操作正在执行或结果未知，需查询结果后再继续。',
        });
      }
    }

    try {
      const output = await input.execute();
      if (redisKey) {
        const markerWritten = await this.redis.setRequired(
          redisKey,
          `completed:${this.toText(output).slice(0, 20_000)}`,
          ToolExecutionService.IDEMPOTENCY_TTL_SECONDS,
        );
        if (!markerWritten) {
          return this.finish(input, callId, actor, startedAt, {
            status: 'unknown',
            output,
            error:
              '副作用已经执行，但幂等完成标记未确认；结果状态未知，禁止自动重试。',
            outputPreview: this.toText(output).slice(
              0,
              ToolExecutionService.OUTPUT_PREVIEW_LIMIT,
            ),
          });
        }
      }
      const spilled = await this.spillIfNeeded(input, callId, output);
      return this.finish(input, callId, actor, startedAt, {
        status: 'success',
        output,
        outputPreview: spilled.preview,
        outputArtifactId: spilled.artifactId,
      });
    } catch (error) {
      if (redisKey)
        await this.redis.set(
          redisKey,
          'unknown',
          ToolExecutionService.IDEMPOTENCY_TTL_SECONDS,
        );
      return this.finish(input, callId, actor, startedAt, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async finish<T>(
    input: ExecuteRegisteredToolInput<T>,
    callId: string,
    actor: string,
    startedAt: number,
    result: Omit<RegisteredToolExecution<T>, 'callId' | 'durationMs'>,
  ): Promise<RegisteredToolExecution<T>> {
    const finalized = { ...result, callId, durationMs: Date.now() - startedAt };
    await this.events.emit({
      threadId: input.threadId,
      runId: input.runId,
      eventType:
        result.status === 'unknown'
          ? 'tool.unknown'
          : result.status === 'failed'
            ? 'tool.failed'
            : result.status === 'blocked'
              ? 'tool.blocked'
              : 'tool.result',
      actor,
      target: input.toolName,
      payload: {
        callId,
        status: result.status,
        durationMs: finalized.durationMs,
        error: result.error,
        outputPreview: result.outputPreview,
        outputArtifactId: result.outputArtifactId,
        recovered: result.recovered ?? false,
      },
    });
    return finalized;
  }

  private async spillIfNeeded<T>(
    input: ExecuteRegisteredToolInput<T>,
    callId: string,
    output: T,
  ) {
    const text = this.toText(output);
    const preview = text.slice(0, ToolExecutionService.OUTPUT_PREVIEW_LIMIT);
    if (
      text.length <= ToolExecutionService.OUTPUT_PREVIEW_LIMIT ||
      !this.artifacts ||
      !input.ownerUserId
    ) {
      return { preview, artifactId: undefined };
    }
    const artifact = await this.artifacts.create({
      ownerUserId: input.ownerUserId,
      threadId: input.threadId,
      title: `${input.toolName}-${callId.slice(0, 8)}-完整输出`,
      kind: 'markdown',
      sourceText: `# ${input.toolName} 完整输出\n\n\`\`\`json\n${text}\n\`\`\``,
    });
    return {
      preview: `${preview}\n\n……完整输出已外置到 Artifact。`,
      artifactId: String(artifact.id),
    };
  }

  private summarize(value: unknown) {
    const text = this.toText(value);
    return {
      preview: text.slice(0, 2_000),
      hash: createHash('sha256').update(text).digest('hex').slice(0, 16),
      bytes: Buffer.byteLength(text),
    };
  }

  private fingerprint(input: ExecuteRegisteredToolInput<unknown>) {
    return createHash('sha256')
      .update(`${input.threadId}:${input.toolName}:${this.toText(input.input)}`)
      .digest('hex');
  }

  private toText(value: unknown): string {
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value) ?? '';
    } catch {
      return String(value);
    }
  }
}
