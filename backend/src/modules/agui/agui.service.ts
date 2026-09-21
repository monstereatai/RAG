import { randomUUID } from 'crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { Observable } from 'rxjs';
import { LlmProvider } from '../../providers/llm/llm.provider';
import type { SseEvent } from '../../rag/agentic/sse-event';
import { ConversationService } from '../chat/conversation.service';
import { ChatService } from '../chat/chat.service';
import type { AguiEvent, AguiRunState, AguiStreamOptions } from './agui.types';
import { resolveRoleContext } from '../chat/role-presets';
import { parseArtifactIntent } from '../artifacts/artifact-intent';
import { ArtifactsService } from '../artifacts/artifacts.service';

@Injectable()
export class AguiService {
  constructor(
    private readonly chatService: ChatService,
    private readonly conversationService: ConversationService,
    private readonly llmProvider: LlmProvider,
    private readonly artifactsService: ArtifactsService,
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
        const runState: AguiRunState = { phase: 'routing' };
        let streamedContent = false;

        const emit = (
          type: AguiEvent['type'],
          data?: Record<string, unknown>,
        ) => {
          if (type === 'RUN_ERROR') runState.phase = 'error';
          if (type === 'RUN_INTERRUPTED') runState.phase = 'approval';
          if (type === 'RUN_FINISHED') runState.phase = 'completed';
          subscriber.next({
            type,
            runId,
            timestamp: new Date().toISOString(),
            data,
          });
        };

        try {
          const selectedModel = options.model ?? 'qwen';
          runState.mode = options.mode;
          runState.model = selectedModel;
          const roleContext = resolveRoleContext(options.rolePresetId);
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
              pluginKeys: options.pluginKeys ?? [],
            },
            runState: { ...runState },
          });
          emit('TEXT_MESSAGE_START', {
            messageId,
            role: 'assistant',
          });

          const result = await this.llmProvider.runWithModel(
            selectedModel,
            () =>
              this.chatService.chat(
                {
                  query,
                  mode: options.mode,
                  threadId: activeThreadId,
                  rolePresetId: options.rolePresetId,
                  pluginKeys: options.pluginKeys,
                  approvalRequired: options.approvalRequired,
                },
                options.userId,
                (event) => {
                  this.updateRunState(runState, event);
                  if (
                    event.type === 'token' &&
                    typeof event.data === 'string' &&
                    event.data.trim().length > 0
                  ) {
                    streamedContent = true;
                  }
                  this.emitAguiEvent(event, emit, messageId);
                },
                { model: selectedModel },
              ),
          );
          const answer =
            result.answer.trim() || '模型未返回有效内容，请切换模型后重试。';
          runState.route = result.route;
          runState.phase =
            result.retrievalSufficient === false ? 'degraded' : 'citation';
          runState.citation = { count: result.references?.length ?? 0 };
          // ChatService 的 token 事件已经实时透传；这里不再重复发送完整正文。
          if (!streamedContent) {
            emit('TEXT_MESSAGE_CONTENT', { messageId, delta: answer });
          }

          if (result.executionState?.paused) {
            emit('TEXT_MESSAGE_END', { messageId });
            emit('RUN_INTERRUPTED', {
              threadId: activeThreadId,
              output: {
                ...result,
                model: selectedModel,
                runState: { ...runState, phase: 'approval' },
              },
            });
            subscriber.complete();
            return;
          }

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
                sourceText: answer,
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
          emit('RUN_FINISHED', {
            threadId: activeThreadId,
            output: {
              ...result,
              answer,
              model: selectedModel,
              artifacts: generatedArtifacts,
              runState: { ...runState },
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

  private updateRunState(state: AguiRunState, event: SseEvent): void {
    const data = this.isRecord(event.data) ? event.data : undefined;
    if (event.type === 'routing') {
      state.phase = 'routing';
      if (typeof data?.route === 'string') state.route = data.route;
    } else if (event.type === 'retrieval' || event.type === 'meta') {
      state.phase = 'retrieval';
      state.retrieval = { status: 'completed' };
    } else if (event.type === 'sufficiency') {
      state.phase = data?.sufficient === false ? 'degraded' : 'evidence';
      state.evidence = {
        sufficient:
          typeof data?.sufficient === 'boolean' ? data.sufficient : undefined,
        reason: typeof data?.reason === 'string' ? data.reason : undefined,
      };
    } else if (event.type === 'interrupt') {
      state.phase = 'approval';
      if (data?.sufficient === false && typeof data.reason === 'string') {
        state.degradationReason = 'evidence_insufficient';
      }
    } else if (event.type === 'token') {
      state.phase = 'generation';
    } else if (event.type === 'citation') {
      state.phase = 'citation';
      state.citation = {
        count: Array.isArray(event.data) ? event.data.length : undefined,
      };
    } else if (event.type === 'error') {
      state.phase = 'error';
      state.degradationReason = 'runtime_error';
    }
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
}
