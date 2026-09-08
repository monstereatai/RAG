import { randomUUID } from 'crypto';
import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { Observable } from 'rxjs';
import { LlmProvider } from '../../providers/llm/llm.provider';
import {
  LangfuseProvider,
  type RagTraceEvent,
} from '../../providers/observability/langfuse.provider';
import { AgenticRagService } from '../../rag/agentic/agentic-rag.service';
import type { SseEvent } from '../../rag/agentic/sse-event';
import { ConversationService } from '../chat/conversation.service';
import { MemoryService } from '../memory/memory.service';
import { ShortTermMemoryService } from '../memory/short-term-memory.service';
import type { AguiEvent, AguiStreamOptions } from './agui.types';
import { resolveRoleContext } from '../chat/role-presets';
import { parseArtifactIntent } from '../artifacts/artifact-intent';
import { ArtifactsService } from '../artifacts/artifacts.service';
import { PluginRuntimeService } from '../plugin-runtime/plugin-runtime.service';

@Injectable()
export class AguiService {
  constructor(
    private readonly agenticRagService: AgenticRagService,
    private readonly conversationService: ConversationService,
    private readonly memoryService: MemoryService,
    private readonly llmProvider: LlmProvider,
    private readonly langfuseProvider: LangfuseProvider,
    private readonly artifactsService: ArtifactsService,
    @Optional() private readonly shortTermMemory?: ShortTermMemoryService,
    @Optional() private readonly plugins?: PluginRuntimeService,
  ) {}

  stream(options: AguiStreamOptions): Observable<AguiEvent> {
    const query = options.query.trim();
    if (!query) {
      throw new BadRequestException('query is required');
    }

    return new Observable<AguiEvent>((subscriber) => {
      void (async () => {
        const runId = randomUUID();
        const messageId = randomUUID();
        const startTime = Date.now();
        const traceEvents: RagTraceEvent[] = [];

        const emit = (
          type: AguiEvent['type'],
          data?: Record<string, unknown>,
        ) => {
          subscriber.next({
            type,
            runId,
            timestamp: new Date().toISOString(),
            data,
          });
        };

        try {
          const selectedModel = options.model ?? 'qwen';
          const roleContext = resolveRoleContext(options.rolePresetId);
          const pluginComposition =
            options.pluginKeys?.length && this.plugins
              ? await this.plugins.resolve(options.pluginKeys, options.mode)
              : undefined;
          const artifactIntent = parseArtifactIntent(query);
          const activeThreadId =
            options.threadId ??
            (await this.conversationService.create(
              query,
              options.mode,
              options.userId,
            ));
          emit('RUN_STARTED', {
            threadId: activeThreadId,
            input: {
              query,
              mode: options.mode,
              model: selectedModel,
              rolePresetId: roleContext.preset.id,
              pluginKeys: pluginComposition?.pluginKeys ?? [],
              pluginTools: pluginComposition?.toolNames ?? [],
            },
          });
          traceEvents.push({
            type: 'run_started',
            data: { mode: options.mode, model: selectedModel },
            timestamp: new Date().toISOString(),
          });
          emit('TEXT_MESSAGE_START', {
            messageId,
            role: 'assistant',
          });

          const [history, shortTermContext, memoryResult] = await Promise.all([
            this.conversationService.getRecentHistory(
              activeThreadId,
              5,
              options.userId,
            ),
            this.shortTermMemory?.getContext(activeThreadId) ??
              Promise.resolve({
                systemMessage: null,
                recentTurns: [],
                truncatedHistory: false,
              }),
            this.withTimeout(
              this.memoryService.searchMemory(
                query,
                options.userId,
                activeThreadId,
              ),
              600,
              { userMemories: [], sessionMemories: [], systemMessage: null },
            ),
          ]);
          const memoryMessages: Array<{ role: string; content: string }> = [];
          memoryMessages.push({
            role: 'system',
            content: roleContext.systemMessage,
          });
          if (artifactIntent) {
            memoryMessages.push({
              role: 'system',
              content: `用户已明确要求生成${this.artifactKindLabel(artifactIntent.kind)}。请输出可直接写入文件的完整内容，不得声称无法创建或发送文件，也不要让用户复制粘贴；系统会在回答完成后自动创建附件。`,
            });
          }
          if (memoryResult.systemMessage) {
            memoryMessages.push({
              role: 'system',
              content: memoryResult.systemMessage.content as string,
            });
          }
          if (shortTermContext.systemMessage) {
            memoryMessages.push({
              role: 'system',
              content: shortTermContext.systemMessage.content as string,
            });
          }

          const boundedHistory =
            shortTermContext.recentTurns.length > 0
              ? shortTermContext.recentTurns.map((turn) => ({
                  role:
                    turn.role === 'assistant'
                      ? ('ai' as const)
                      : ('human' as const),
                  content: turn.content,
                }))
              : history;

          const result = await this.llmProvider.runWithModel(
            selectedModel,
            () =>
              this.agenticRagService.run(
                query,
                options.mode,
                (event) => {
                  traceEvents.push(this.toTraceEvent(event));
                  this.emitAguiEvent(event, emit, messageId);
                },
                boundedHistory,
                activeThreadId,
                options.userId,
                memoryMessages,
                false,
                {
                  scope: { role: roleContext.role },
                  ...(pluginComposition
                    ? {
                        pluginKeys: pluginComposition.pluginKeys,
                        pluginTools: pluginComposition.toolNames,
                      }
                    : {}),
                },
              ),
          );

          await this.conversationService.addMessage(
            activeThreadId,
            'human',
            query,
            options.userId,
          );
          await this.conversationService.addMessage(
            activeThreadId,
            'ai',
            result.answer,
            options.userId,
            {
              mode: options.mode,
              route: result.route,
              model: selectedModel,
              confidence: result.confidence,
              retryCount: result.retryCount,
              retrievalSufficient: result.retrievalSufficient,
              retrievalReason: result.retrievalReason,
              references: result.references ?? [],
              events: traceEvents.map((event) => event.type),
            },
          );
          void this.shortTermMemory?.addTurn(activeThreadId, 'user', query);
          void this.shortTermMemory?.addTurn(
            activeThreadId,
            'assistant',
            result.answer,
          );
          void this.memoryService.classifyAndPersist(
            options.userId,
            activeThreadId,
            query,
            result.answer,
          );

          let generatedArtifacts: unknown[] = [];
          if (artifactIntent) {
            const toolCallId = randomUUID();
            emit('TOOL_CALL_START', {
              toolCallId,
              toolCallName: 'artifact_generate',
            });
            emit('TOOL_CALL_ARGS', {
              toolCallId,
              args: {
                kind: artifactIntent.kind,
                title: artifactIntent.title,
              },
            });
            try {
              const artifact = await this.artifactsService.create({
                ownerUserId: options.userId,
                threadId: activeThreadId,
                title: artifactIntent.title,
                kind: artifactIntent.kind,
                sourceText: result.answer,
                prompt: artifactIntent.kind === 'image' ? query : undefined,
              });
              generatedArtifacts = [artifact];
              emit('TOOL_CALL_END', { toolCallId, result: artifact });
            } catch (error) {
              emit('TOOL_CALL_END', {
                toolCallId,
                error:
                  error instanceof Error
                    ? error.message
                    : '文件生成任务创建失败',
              });
            }
          }

          emit('TEXT_MESSAGE_END', { messageId });
          this.traceAnswer({
            userId: options.userId,
            threadId: activeThreadId,
            query,
            answer: result.answer,
            mode: options.mode,
            route: result.route,
            model: selectedModel,
            startTime,
            references: result.references ?? [],
            refused: result.retrievalSufficient === false,
            events: traceEvents,
          });
          emit('RUN_FINISHED', {
            threadId: activeThreadId,
            output: {
              ...result,
              model: selectedModel,
              artifacts: generatedArtifacts,
            },
          });
          subscriber.complete();
        } catch (error) {
          emit('RUN_ERROR', {
            message: (error as Error).message,
          });
          subscriber.complete();
        }
      })();
    });
  }

  private artifactKindLabel(kind: string): string {
    return (
      {
        markdown: ' Markdown 文件',
        word: ' Word 文件',
        excel: ' Excel 文件',
        architecture: '架构图',
        image: '图片',
      }[kind] ?? '文件'
    );
  }

  private emitAguiEvent(
    event: SseEvent,
    emit: (type: AguiEvent['type'], data?: Record<string, unknown>) => void,
    messageId: string,
  ) {
    if (event.type === 'token') {
      emit('TEXT_MESSAGE_CONTENT', {
        messageId,
        delta: typeof event.data === 'string' ? event.data : String(event.data),
      });
      return;
    }

    if (event.type === 'tool_call') {
      emit('TOOL_CALL_START', {
        toolCallId: this.getToolCallId(event.data),
        toolCallName: this.getToolCallName(event.data),
        rawEvent: event,
      });
      emit('TOOL_CALL_ARGS', {
        toolCallId: this.getToolCallId(event.data),
        args: this.getToolCallArgs(event.data),
      });
      emit('TOOL_CALL_END', {
        toolCallId: this.getToolCallId(event.data),
      });
      return;
    }

    if (event.type === 'routing' || event.type === 'sufficiency') {
      emit('STATE_DELTA', {
        delta: [{ op: 'replace', path: `/${event.type}`, value: event.data }],
        rawEvent: event,
      });
      return;
    }

    if (event.type === 'error') {
      emit('RUN_ERROR', {
        message: this.getErrorMessage(event.data),
        rawEvent: event,
      });
      return;
    }

    emit('CUSTOM', {
      name: `rag.${event.type}`,
      value: event.data,
      rawEvent: event,
    });
  }

  private getToolCallId(data: unknown): string {
    if (this.isRecord(data) && typeof data.id === 'string') {
      return data.id;
    }
    return randomUUID();
  }

  private getToolCallName(data: unknown): string {
    if (this.isRecord(data)) {
      if (typeof data.name === 'string') return data.name;
      if (typeof data.tool === 'string') return data.tool;
    }
    return 'unknown_tool';
  }

  private getToolCallArgs(data: unknown): unknown {
    if (this.isRecord(data) && 'args' in data) {
      return data.args;
    }
    return data;
  }

  private getErrorMessage(data: unknown): string {
    if (this.isRecord(data) && typeof data.message === 'string') {
      return data.message;
    }
    return 'AG-UI stream failed';
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    fallback: T,
  ): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(fallback), ms);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private traceAnswer(params: {
    userId: string;
    threadId: string;
    query: string;
    answer: string;
    mode: string;
    route: string;
    model: string;
    startTime: number;
    references: Array<{
      docId: string;
      chunkIndex: number;
      totalScore?: number;
    }>;
    refused: boolean;
    events: RagTraceEvent[];
  }): void {
    const inputTokens = this.langfuseProvider.estimateTextTokens(params.query);
    const outputTokens = this.langfuseProvider.estimateTextTokens(
      params.answer,
    );
    this.langfuseProvider.traceRagAnswer({
      userId: params.userId,
      threadId: params.threadId,
      query: params.query,
      answer: params.answer,
      mode: params.mode,
      route: params.route,
      model: params.model,
      latencyMs: Date.now() - params.startTime,
      citationCount: params.references.length,
      refused: params.refused,
      references: params.references.map((ref) => ({
        docId: ref.docId,
        chunkIndex: ref.chunkIndex,
        totalScore: ref.totalScore ?? 0,
      })),
      events: params.events,
      inputTokensEstimated: inputTokens,
      outputTokensEstimated: outputTokens,
      costUsdEstimated: this.langfuseProvider.estimateCostUsd(
        inputTokens,
        outputTokens,
      ),
    });
  }

  private toTraceEvent(event: SseEvent): RagTraceEvent {
    return {
      type: event.type,
      data: event.type === 'token' ? undefined : event.data,
      timestamp: new Date().toISOString(),
    };
  }
}
