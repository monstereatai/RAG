import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { KarpathyRagService } from '../../rag/karpathy/karpathy-rag.service';
import { AgenticRagService } from '../../rag/agentic/agentic-rag.service';
import { ConversationService } from './conversation.service';
import { ConversationEmbeddingService } from './conversation-embedding.service';
import { MemoryService } from '../memory/memory.service';
import { ShortTermMemoryService } from '../memory/short-term-memory.service';
import { QueryLogEntity } from '../../providers/db/entities/query-log.entity';
import { ChatDto, type ChatMode } from './chat.dto';
import type { ChatResponse } from './chat.dto';
import {
  LangfuseProvider,
  type RagTraceEvent,
} from '../../providers/observability/langfuse.provider';
import type { SseEvent } from '../../rag/agentic/sse-event';
import { resolveRoleContext } from './role-presets';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly karpathyRagService: KarpathyRagService,
    private readonly agenticRagService: AgenticRagService,
    private readonly conversationService: ConversationService,
    private readonly conversationEmbeddingService: ConversationEmbeddingService,
    private readonly memoryService: MemoryService,
    private readonly shortTermMemory: ShortTermMemoryService,
    private readonly langfuseProvider: LangfuseProvider,
    @InjectRepository(QueryLogEntity)
    private readonly queryLogRepo: Repository<QueryLogEntity>,
  ) {}

  async chat(req: ChatDto, userId: string): Promise<ChatResponse> {
    if (!req.query || req.query.trim().length === 0) {
      throw new BadRequestException('query is required');
    }

    const mode: ChatMode = req.mode ?? 'simple';
    const startTime = Date.now();

    // 对话历史管理：threadId 不传则新建
    const threadId =
      req.threadId ??
      (await this.conversationService.create(req.query, 'auto', userId));
    const history =
      req.history ??
      (await this.conversationService.getRecentHistory(threadId, 5, userId));

    // Mem0 长期记忆搜索：chat 前注入记忆上下文
    const memoryResult = await this.memoryService.searchMemory(
      req.query,
      userId,
      threadId,
    );
    const memoryMessages: Array<{ role: string; content: string }> = [];
    const roleContext = resolveRoleContext(req.rolePresetId, req.scope?.role);
    memoryMessages.push({
      role: 'system',
      content: roleContext.systemMessage,
    });
    const retrievalScope = {
      ...req.scope,
      role: roleContext.role,
    };
    if (memoryResult.systemMessage) {
      memoryMessages.push({
        role: 'system',
        content: memoryResult.systemMessage.content as string,
      });
      this.logger.debug(
        `Memory injected: user=${memoryResult.userMemories.length}, session=${memoryResult.sessionMemories.length}`,
      );
    }

    // Redis 短期记忆注入：最近 N 轮对话 + 历史摘要
    if (threadId) {
      const stmContext = await this.shortTermMemory.getContext(threadId);
      if (stmContext.systemMessage) {
        memoryMessages.push({
          role: 'system',
          content: stmContext.systemMessage.content as string,
        });
        this.logger.debug(
          `Short-term memory injected: ${stmContext.recentTurns.length} recent turns, truncated=${stmContext.truncatedHistory}`,
        );
      }
    }

    // 对话历史向量化搜索：检索相关的历史对话作为上下文
    const shouldSearchHistory = Boolean(req.threadId);
    const historySearch = shouldSearchHistory
      ? await this.conversationEmbeddingService.searchHistory(
          req.query,
          2,
          userId,
        )
      : [];
    if (historySearch.length > 0) {
      const historyContext =
        this.conversationEmbeddingService.formatHistoryContext(historySearch);
      // 将历史对话上下文作为额外的 system 消息注入
      memoryMessages.push({
        role: 'system',
        content: historyContext,
      });
      this.logger.debug(
        `History context injected: ${historySearch.length} relevant conversations`,
      );
    }

    if (mode === 'simple') {
      const result = await this.karpathyRagService.answer(
        req.query,
        history,
        userId,
        memoryMessages,
        undefined,
        { scope: retrievalScope },
      );

      // 持久化本轮对话
      await this.conversationService.addMessage(
        threadId,
        'human',
        req.query,
        userId,
      );
      await this.conversationService.addMessage(
        threadId,
        'ai',
        result.answer,
        userId,
      );

      // Redis 短期记忆写入：异步记录本轮对话
      void this.shortTermMemory.addTurn(threadId, 'user', req.query);
      void this.shortTermMemory.addTurn(threadId, 'assistant', result.answer);

      // Mem0 分类写入：chat 后异步持久化有价值的记忆
      void this.memoryService.classifyAndPersist(
        userId,
        threadId,
        req.query,
        result.answer,
      );

      // 对话历史向量化：异步将本轮 QA 对存入 Milvus
      void this.conversationEmbeddingService.indexConversation(
        threadId,
        req.query,
        result.answer,
        userId,
      );

      const queryLogId = await this.logQuery({
        userId,
        query: req.query,
        mode,
        threadId,
        startTime,
        refused:
          result.answer === this.karpathyRagService.unsupportedReliableAnswer(),
        citationCount: result.references.length,
        hasAnswer: result.answer.length > 0,
        answer: result.answer,
        references: result.references,
      });
      this.traceAnswer({
        userId,
        query: req.query,
        mode,
        route: 'simple',
        threadId,
        startTime,
        answer: result.answer,
        references: result.references,
        refused:
          result.answer === this.karpathyRagService.unsupportedReliableAnswer(),
        events: [
          {
            type: 'citation',
            data: result.references,
            timestamp: new Date().toISOString(),
          },
          {
            type: 'final',
            data: { route: 'simple', referenceCount: result.references.length },
            timestamp: new Date().toISOString(),
          },
        ],
      });

      return {
        ...result,
        mode: 'simple',
        route: 'simple',
        threadId,
        queryLogId,
      };
    }

    // agentic / auto 模式走 AgenticRagService
    const traceEvents: RagTraceEvent[] = [];
    const result = await this.agenticRagService.run(
      req.query,
      mode,
      (event) => traceEvents.push(this.toTraceEvent(event)),
      history,
      threadId,
      userId,
      memoryMessages,
      false,
      { scope: retrievalScope },
    );

    // 持久化本轮对话
    await this.conversationService.addMessage(
      threadId,
      'human',
      req.query,
      userId,
    );
    await this.conversationService.addMessage(
      threadId,
      'ai',
      result.answer,
      userId,
    );

    // Redis 短期记忆写入：异步记录本轮对话
    void this.shortTermMemory.addTurn(threadId, 'user', req.query);
    void this.shortTermMemory.addTurn(threadId, 'assistant', result.answer);

    // Mem0 分类写入
    void this.memoryService.classifyAndPersist(
      userId,
      threadId,
      req.query,
      result.answer,
    );

    // 对话历史向量化：异步将本轮 QA 对存入 Milvus
    void this.conversationEmbeddingService.indexConversation(
      threadId,
      req.query,
      result.answer,
      userId,
    );

    const queryLogId = await this.logQuery({
      userId,
      query: req.query,
      mode,
      threadId,
      startTime,
      refused:
        result.answer === this.karpathyRagService.unsupportedReliableAnswer(),
      citationCount: result.references?.length ?? 0,
      hasAnswer: result.answer.length > 0,
      answer: result.answer,
      references: result.references ?? [],
    });
    this.traceAnswer({
      userId,
      query: req.query,
      mode,
      route: result.route,
      threadId,
      startTime,
      answer: result.answer,
      references: result.references ?? [],
      refused:
        result.answer === this.karpathyRagService.unsupportedReliableAnswer(),
      events: traceEvents,
    });

    return {
      answer: result.answer,
      references: result.references,
      mode,
      route: result.route,
      confidence: result.confidence,
      retryCount: result.retryCount,
      retrievalSufficient: result.retrievalSufficient,
      retrievalReason: result.retrievalReason,
      threadId,
      queryLogId,
    };
  }

  async logQuery(params: {
    userId: string;
    query: string;
    mode: string;
    threadId: string;
    startTime: number;
    refused: boolean;
    citationCount: number;
    hasAnswer: boolean;
    answer: string;
    references: unknown[];
  }): Promise<string | undefined> {
    const id = randomUUID();
    try {
      await this.queryLogRepo.save(
        this.queryLogRepo.create({
          id,
          userId: params.userId ?? null,
          query: params.query.slice(0, 2000),
          mode: params.mode as 'simple' | 'agentic' | 'auto',
          threadId: params.threadId ?? null,
          refused: params.refused,
          citationCount: params.citationCount,
          latencyMs: Date.now() - params.startTime,
          hasAnswer: params.hasAnswer,
          answer: params.answer.slice(0, 20_000),
          retrievalSnapshot: JSON.stringify(params.references).slice(
            0,
            100_000,
          ),
        }),
      );
      return id;
    } catch (err) {
      this.logger.warn(`Failed to log query: ${(err as Error).message}`);
      return undefined;
    }
  }

  private traceAnswer(params: {
    userId: string;
    query: string;
    mode: string;
    route: string;
    threadId: string;
    startTime: number;
    answer: string;
    references: Array<{
      docId: string;
      chunkIndex: number;
      totalScore: number;
    }>;
    refused: boolean;
    events?: RagTraceEvent[];
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
      latencyMs: Date.now() - params.startTime,
      citationCount: params.references.length,
      refused: params.refused,
      references: params.references.map((ref) => ({
        docId: ref.docId,
        chunkIndex: ref.chunkIndex,
        totalScore: ref.totalScore,
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
