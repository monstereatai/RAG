import { randomUUID } from 'crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { Observable } from 'rxjs';
import { LlmProvider } from '../../providers/llm/llm.provider';
import { AgenticRagService } from '../../rag/agentic/agentic-rag.service';
import type { SseEvent } from '../../rag/agentic/sse-event';
import { ConversationService } from '../chat/conversation.service';
import { MemoryService } from '../memory/memory.service';
import type { AguiEvent, AguiStreamOptions } from './agui.types';

@Injectable()
export class AguiService {
  constructor(
    private readonly agenticRagService: AgenticRagService,
    private readonly conversationService: ConversationService,
    private readonly memoryService: MemoryService,
    private readonly llmProvider: LlmProvider,
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
          const activeThreadId =
            options.threadId ??
            (await this.conversationService.create(
              query,
              options.mode,
              options.userId,
            ));
          const history = await this.conversationService.getRecentHistory(
            activeThreadId,
            5,
            options.userId,
          );
          const memoryResult = await this.memoryService.searchMemory(
            query,
            options.userId,
            activeThreadId,
          );
          const memoryMessages: Array<{ role: string; content: string }> = [];
          if (memoryResult.systemMessage) {
            memoryMessages.push({
              role: 'system',
              content: memoryResult.systemMessage.content as string,
            });
          }

          emit('RUN_STARTED', {
            threadId: activeThreadId,
            input: { query, mode: options.mode, model: selectedModel },
          });
          emit('TEXT_MESSAGE_START', {
            messageId,
            role: 'assistant',
          });

          const result = await this.llmProvider.runWithModel(
            selectedModel,
            () =>
              this.agenticRagService.run(
                query,
                options.mode,
                (event) => this.emitAguiEvent(event, emit, messageId),
                history,
                activeThreadId,
                options.userId,
                memoryMessages,
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
          );
          void this.memoryService.classifyAndPersist(
            options.userId,
            activeThreadId,
            query,
            result.answer,
          );

          emit('TEXT_MESSAGE_END', { messageId });
          emit('RUN_FINISHED', {
            threadId: activeThreadId,
            output: { ...result, model: selectedModel },
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
}
