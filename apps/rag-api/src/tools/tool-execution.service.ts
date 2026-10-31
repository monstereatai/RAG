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
import { toolRegistry, type ToolRegistryEntry } from './tool-registry';

type ToolIdempotencyInfo = {
  legacyKey: string;
  legacyRedisKey: string;
  redisKey: string;
  leaseKey: string;
  resultKey: string;
  keyRef: string;
  scopeFingerprint: string;
  fingerprint: string;
  runningMarker: string;
  unknownMarker: string;
  completedPrefix: string;
  completedWritePrefix: string;
};

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
  /** Required alongside approvalGranted for non-automatic approval decisions. */
  approvalGrantedBy?: string;
  idempotencyKey?: string;
  sideEffect?: boolean;
  createOutputArtifact?: boolean;
  execute: (signal?: AbortSignal) => Promise<T>;
  signal?: AbortSignal;
}

export interface RegisteredToolExecution<T> {
  callId: string;
  status: ToolExecutionStatus;
  output?: T;
  /** 默认供 Agent 状态/模型上下文消费的有界结果；程序需要完整结构时读 output。 */
  contextOutput?: T | TruncatedToolContextOutput;
  error?: string;
  durationMs: number;
  outputPreview?: string;
  outputArtifactId?: string;
  recovered?: boolean;
}

export interface TruncatedToolContextOutput {
  truncated: true;
  preview: string;
  outputArtifactId?: string;
  continuation: string;
}

export function getRegisteredToolTimeoutMs(toolName: string): number {
  const entry = toolRegistry.find((item) => item.name === toolName);
  if (!entry) throw new Error(`工具 ${toolName} 未在 Tool Registry 注册`);
  return entry.timeoutMs;
}

export async function executeWithToolTimeout<T>(
  toolName: string,
  timeoutMs: number,
  execute: (signal: AbortSignal) => Promise<T>,
  parentSignal?: AbortSignal,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`${toolName} 的 timeoutMs 配置无效`);
  }
  if (parentSignal?.aborted) throw new Error(`${toolName} 执行已取消`);

  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  let onParentAbort: (() => void) | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`${toolName} 执行超时（${timeoutMs}ms）`);
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  const cancelled = new Promise<never>((_, reject) => {
    onParentAbort = () => {
      const error = new Error(`${toolName} 执行已取消`);
      controller.abort(parentSignal?.reason ?? error);
      reject(error);
    };
    parentSignal?.addEventListener('abort', onParentAbort, { once: true });
    if (parentSignal?.aborted) onParentAbort();
  });

  try {
    return await Promise.race([
      Promise.resolve().then(() => execute(controller.signal)),
      timeout,
      cancelled,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (onParentAbort) {
      parentSignal?.removeEventListener('abort', onParentAbort);
    }
  }
}

/**
 * 所有需要审计的工具都使用同一执行外壳：先记录调用，再执行权限、审批、幂等和超时控制，最后写入不可变结果事件。
 * 不把完整大结果塞进运行事件；超过阈值时仅保留预览和 Artifact 定位。
 */
@Injectable()
export class ToolExecutionService {
  private static readonly OUTPUT_PREVIEW_LIMIT = 6_000;
  private static readonly CONTEXT_OUTPUT_LIMIT = 2_000;
  private static readonly CONTEXT_OUTPUT_PREVIEW_LIMIT = 1_800;
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
    const tenantId = input.tenantId?.trim() || 'legacy';
    const decision = this.policy.decide(input.toolName, input);
    const idempotency = this.idempotencyInfo(
      input,
      callId,
      decision.entry?.permission,
    );
    const hasSideEffect = Boolean(idempotency);
    let legacyMarkerCheck: 'clear' | 'present' | 'unavailable' | 'not_checked' =
      'not_checked';
    if (
      decision.allowed &&
      decision.entry?.permission === 'write' &&
      idempotency
    ) {
      try {
        legacyMarkerCheck =
          (await this.redis.getRequired(idempotency.legacyRedisKey)) === null
            ? 'clear'
            : 'present';
      } catch {
        legacyMarkerCheck = 'unavailable';
      }
    }
    const finish = (
      result: Omit<RegisteredToolExecution<T>, 'callId' | 'durationMs'>,
    ) => this.finish(input, callId, actor, startedAt, result, idempotency);
    await this.events.emit({
      tenantId,
      threadId: input.threadId,
      runId: input.runId,
      eventType: 'tool.call',
      actor,
      target: input.toolName,
      payload: {
        callId,
        input: this.summarize(input.input),
        sideEffect: hasSideEffect,
        permission: decision.entry?.permission ?? null,
        legacyMarkerCheck,
        idempotencyKeyRef: idempotency?.keyRef,
        idempotencyScopeFingerprint: idempotency?.scopeFingerprint,
        idempotencyFingerprint: idempotency?.fingerprint,
      },
    });
    if (!decision.allowed) {
      return finish({
        status: 'blocked',
        error: decision.reason,
      });
    }
    if (input.sideEffect && decision.entry?.permission !== 'write') {
      return finish({
        status: 'blocked',
        error:
          '工具调用声明了写入副作用，但注册权限不是 write，按默认拒绝策略阻断。',
      });
    }

    if (decision.requiresApproval) {
      const autoApproval =
        input.approvalPolicy === 'auto'
          ? decision.entry?.autoApproval
          : undefined;
      if (input.approvalPolicy === 'auto' && !autoApproval) {
        return finish({
          status: 'blocked',
          error: '该工具未加入自动批准白名单，必须经过明确审批。',
        });
      }

      if (autoApproval) {
        await this.events.emit({
          tenantId,
          threadId: input.threadId,
          runId: input.runId,
          eventType: 'approval.auto_granted',
          actor: 'tool-policy',
          target: input.toolName,
          payload: {
            callId,
            policy: autoApproval,
            reason:
              autoApproval === 'internal_artifact'
                ? '只创建当前用户可见的内部 Artifact。'
                : '命令限定在当前用户所属的隔离工作区内执行。',
          },
        });
      } else {
        const approved =
          input.approvalGranted === true &&
          Boolean(input.approvalGrantedBy?.trim());
        const approvalId = randomUUID();
        await this.events.emit({
          tenantId,
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
        await this.events.emit({
          tenantId,
          threadId: input.threadId,
          runId: input.runId,
          eventType: 'approval.decided',
          actor: approved ? input.approvalGrantedBy!.trim() : actor,
          target: input.toolName,
          payload: {
            approvalId,
            callId,
            outcome: approved ? 'allowed-once' : 'unavailable',
            policy: input.approvalPolicy ?? 'required',
          },
        });
        if (!approved) {
          return finish({
            status: 'blocked',
            error: '该写入型工具没有可验证的审批人，系统按拒绝优先策略未执行。',
          });
        }
      }
    }

    // 写入型工具必须依赖 Redis 的跨实例幂等锁。Redis 不可用时无法区分
    // “尚未执行”和“已执行但结果丢失”，继续执行会把未知副作用放大成重复写入。
    if (hasSideEffect && !this.redis.isEnabled()) {
      return finish({
        status: 'blocked',
        error: '幂等存储不可用，写入型工具按安全策略暂不执行。',
      });
    }

    if (idempotency && legacyMarkerCheck !== 'clear') {
      return finish({
        status: 'blocked',
        error:
          legacyMarkerCheck === 'present'
            ? '检测到旧版未分 scope 的幂等锁；为避免跨租户复用结果，本次调用已阻断。'
            : '旧版幂等锁状态无法确认，本次写入按安全策略阻断。',
      });
    }

    const redisKey = idempotency?.redisKey;
    if (redisKey) {
      const idempotencyLookupStartedAt = process.hrtime.bigint();
      let previous: string | null;
      let legacyMarker: string | null;
      let activeLease: string | null;
      try {
        legacyMarker = await this.redis.getRequired(idempotency.legacyRedisKey);
        previous = await this.redis.getRequired(redisKey);
        activeLease = await this.redis.getRequired(idempotency.leaseKey);
      } catch {
        return finish({
          status: 'blocked',
          error: '幂等状态无法确认，本次写入按安全策略阻断。',
        });
      }
      this.metricsService?.observeCacheOperation(
        'tool_idempotency',
        'get',
        Number(process.hrtime.bigint() - idempotencyLookupStartedAt) / 1e9,
      );
      this.metricsService?.observeCacheRequest(
        'tool_idempotency',
        Boolean(
          previous?.startsWith(idempotency.completedPrefix) &&
          activeLease === null,
        ),
      );
      if (legacyMarker !== null) {
        return finish({
          status: 'blocked',
          error:
            '检测到旧版未分 scope 的幂等锁；为避免跨租户复用结果，本次调用已阻断。',
        });
      }
      if (
        previous?.startsWith(idempotency.completedPrefix) &&
        activeLease === null
      ) {
        let output: T | undefined;
        const metadata = previous.slice(idempotency.completedPrefix.length);
        const callFingerprint = metadata.slice(0, 64);
        if (/^[0-9a-f]{64}$/i.test(callFingerprint) && metadata[64] === ':') {
          const resultState = metadata.slice(65);
          if (resultState === 'unavailable') {
            return finish({
              status: 'recovered',
              recovered: true,
              error:
                '该幂等键的写入已完成，但结果超过持久化上限或无法序列化；为避免重复副作用，不会重跑工具。',
              outputPreview: '检测到相同幂等键已完成，结果无法恢复。',
            });
          }
          if (resultState !== 'stored') {
            return finish({
              status: 'blocked',
              error: '完成标记的结果状态无效，按安全策略阻断。',
            });
          }
          let serializedOutput: string | null;
          try {
            serializedOutput = await this.redis.getRequired(
              idempotency.resultKey,
            );
          } catch {
            return finish({
              status: 'blocked',
              error:
                '该幂等键的写入已完成，但结果读取失败；为避免重复副作用，不会重跑工具。',
              outputPreview: '检测到相同幂等键已完成，结果无法恢复。',
            });
          }
          if (serializedOutput === null) {
            return finish({
              status: 'recovered',
              recovered: true,
              error:
                '该幂等键的写入已完成，但临时结果已过期；为避免重复副作用，不会重跑工具。',
              outputPreview: '检测到相同幂等键已完成，结果已过期。',
            });
          }
          try {
            output = JSON.parse(serializedOutput) as T;
          } catch {
            return finish({
              status: 'blocked',
              error:
                '该幂等键的写入已完成，但持久化结果无法解析；为避免重复副作用，不会重跑工具。',
              outputPreview: '检测到相同幂等键已完成，结果无法恢复。',
            });
          }
        } else {
          return finish({
            status: 'blocked',
            error: '完成标记缺少匹配的调用指纹，按安全策略阻断。',
          });
        }
        return finish({
          status: 'recovered',
          output,
          contextOutput:
            output === undefined
              ? undefined
              : this.toContextOutput(output, this.toText(output)),
          recovered: true,
          outputPreview: '检测到相同幂等键已完成，未重复执行写入操作。',
        });
      }
      if (previous !== null || activeLease !== null) {
        return finish({
          status: 'blocked',
          error: '相同幂等键的操作正在执行或结果未知，需查询结果后再继续。',
        });
      }
      let locked: boolean;
      try {
        locked = await this.redis.acquireDurableExecutionRequired(
          idempotency.legacyRedisKey,
          redisKey,
          idempotency.leaseKey,
          idempotency.runningMarker,
          ToolExecutionService.IDEMPOTENCY_TTL_SECONDS,
        );
      } catch {
        return finish({
          status: 'blocked',
          error: '幂等锁无法确认，本次写入按安全策略阻断。',
        });
      }
      if (!locked) {
        return finish({
          status: 'blocked',
          error: '相同幂等键的操作正在执行或结果未知，需人工核验后再继续。',
        });
      }
    }

    try {
      const output = await executeWithToolTimeout(
        input.toolName,
        decision.entry!.timeoutMs,
        input.execute,
        input.signal,
      );
      if (redisKey) {
        let markerWritten = false;
        try {
          const serializedOutput = this.serializeIdempotentOutput(output);
          markerWritten =
            await this.redis.compareAndTransitionWithLeaseAndResultRequired(
              redisKey,
              idempotency.leaseKey,
              idempotency.resultKey,
              idempotency.runningMarker,
              idempotency.runningMarker,
              `${idempotency.completedWritePrefix}${serializedOutput === undefined ? 'unavailable' : 'stored'}`,
              serializedOutput ?? 'unavailable',
              ToolExecutionService.IDEMPOTENCY_TTL_SECONDS,
            );
        } catch {
          markerWritten = false;
        }
        if (!markerWritten) {
          let unknownMarkerWritten = false;
          try {
            unknownMarkerWritten =
              await this.redis.compareAndTransitionWithLeaseRequired(
                redisKey,
                idempotency.leaseKey,
                idempotency.runningMarker,
                idempotency.runningMarker,
                idempotency.unknownMarker,
              );
          } catch {
            unknownMarkerWritten = false;
          }
          return finish({
            status: 'unknown',
            output,
            contextOutput: this.toContextOutput(output, this.toText(output)),
            error: unknownMarkerWritten
              ? '副作用已经执行，但幂等完成标记未确认；结果状态未知，禁止自动重试。'
              : '副作用已经执行，但幂等完成标记和 unknown 锁都未确认；先核验副作用结果，当前运行锁或其他状态未被覆盖。',
            outputPreview: this.toText(output).slice(
              0,
              ToolExecutionService.OUTPUT_PREVIEW_LIMIT,
            ),
          });
        }
      }
      const spilled = await this.spillIfNeeded(
        input,
        callId,
        output,
        input.createOutputArtifact !== false,
      );
      return finish({
        status: 'success',
        output,
        contextOutput: spilled.contextOutput,
        outputPreview: spilled.preview,
        outputArtifactId: spilled.artifactId,
      });
    } catch (error) {
      if (redisKey && idempotency) {
        let unknownMarkerWritten = false;
        try {
          unknownMarkerWritten =
            await this.redis.compareAndTransitionWithLeaseRequired(
              redisKey,
              idempotency.leaseKey,
              idempotency.runningMarker,
              idempotency.runningMarker,
              idempotency.unknownMarker,
            );
        } catch {
          unknownMarkerWritten = false;
        }
        const reason = error instanceof Error ? error.message : String(error);
        return finish({
          status: 'unknown',
          error: unknownMarkerWritten
            ? `写入型工具调用失败，副作用状态未知；已禁止自动重试。${reason}`
            : `写入型工具调用失败，持久 running 状态未被覆盖；lease 过期后需人工核验。${reason}`,
        });
      }
      return finish({
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
    idempotency?: ToolIdempotencyInfo,
  ): Promise<RegisteredToolExecution<T>> {
    const finalized = { ...result, callId, durationMs: Date.now() - startedAt };
    await this.events.emit({
      tenantId: input.tenantId?.trim() || 'legacy',
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
        idempotencyKeyRef: idempotency?.keyRef,
        idempotencyScopeFingerprint: idempotency?.scopeFingerprint,
        idempotencyFingerprint: idempotency?.fingerprint,
      },
    });
    return finalized;
  }

  private async spillIfNeeded<T>(
    input: ExecuteRegisteredToolInput<T>,
    callId: string,
    output: T,
    createArtifact: boolean,
  ) {
    const text = this.toText(output);
    const preview = text.slice(0, ToolExecutionService.OUTPUT_PREVIEW_LIMIT);
    let artifactId: string | undefined;
    if (
      text.length > ToolExecutionService.CONTEXT_OUTPUT_LIMIT &&
      createArtifact &&
      this.artifacts &&
      input.ownerUserId
    ) {
      try {
        const artifact = await this.artifacts.create({
          ownerUserId: input.ownerUserId,
          threadId: input.threadId,
          title: `${input.toolName}-${callId.slice(0, 8)}-完整输出`,
          kind: 'markdown',
          sourceText: `# ${input.toolName} 完整输出\n\n\`\`\`json\n${text}\n\`\`\``,
        });
        artifactId = String(artifact.id);
      } catch {
        // Artifact 创建失败不应把已经成功的工具调用改判为失败；上下文仍只拿有界预览。
      }
    }
    const truncated = text.length > ToolExecutionService.CONTEXT_OUTPUT_LIMIT;
    return {
      preview: truncated
        ? `${preview}\n\n${artifactId ? `完整输出已保存到 Artifact ${artifactId}。` : '完整输出未能外置；请缩小查询范围或分页继续读取。'}`
        : preview,
      artifactId,
      contextOutput: this.toContextOutput(output, text, artifactId),
    };
  }

  private toContextOutput<T>(
    output: T,
    text: string,
    artifactId?: string,
  ): T | TruncatedToolContextOutput {
    if (text.length <= ToolExecutionService.CONTEXT_OUTPUT_LIMIT) return output;
    return {
      truncated: true,
      preview: text.slice(0, ToolExecutionService.CONTEXT_OUTPUT_PREVIEW_LIMIT),
      outputArtifactId: artifactId,
      continuation: artifactId
        ? `完整结果已保存到 Artifact ${artifactId}，可从会话附件列表继续查看。`
        : '完整结果没有可用的 Artifact；请缩小查询条件或使用分页继续读取。',
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

  private idempotencyInfo(
    input: ExecuteRegisteredToolInput<unknown>,
    callId: string,
    effectivePermission?: ToolRegistryEntry['permission'],
  ): ToolIdempotencyInfo | undefined {
    const entry = toolRegistry.find((item) => item.name === input.toolName);
    if (
      !input.sideEffect &&
      (effectivePermission ?? entry?.permission) !== 'write'
    ) {
      return undefined;
    }
    const legacyKey = input.idempotencyKey ?? this.fingerprint(input);
    const keyRef = createHash('sha256').update(legacyKey).digest('hex');
    const tenantId = input.tenantId?.trim() || 'legacy';
    const scopeFingerprint = createHash('sha256')
      .update(`${tenantId}\0${input.threadId}\0${input.toolName}\0${keyRef}`)
      .digest('hex');
    const fingerprint = createHash('sha256')
      .update(
        `${tenantId}\0${input.threadId}\0${input.runId ?? ''}\0${callId}\0${input.toolName}\0${keyRef}`,
      )
      .digest('hex');
    const completedPrefix = `completed:${scopeFingerprint}:`;
    return {
      legacyKey,
      legacyRedisKey: `tool-execution:${legacyKey}`,
      redisKey: `tool-execution:scope:{${scopeFingerprint}}:state`,
      leaseKey: `tool-execution:scope:{${scopeFingerprint}}:lease`,
      resultKey: `tool-execution:scope:{${scopeFingerprint}}:result`,
      keyRef,
      scopeFingerprint,
      fingerprint,
      runningMarker: `running:${scopeFingerprint}:${fingerprint}:${callId}`,
      unknownMarker: `unknown:${scopeFingerprint}:${fingerprint}:${callId}`,
      completedPrefix,
      completedWritePrefix: `${completedPrefix}${fingerprint}:`,
    };
  }

  private toText(value: unknown): string {
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value) ?? '';
    } catch {
      return String(value);
    }
  }

  private serializeIdempotentOutput(value: unknown): string | undefined {
    try {
      const serialized = JSON.stringify(value);
      return serialized && serialized.length <= 20_000 ? serialized : undefined;
    } catch {
      return undefined;
    }
  }
}
