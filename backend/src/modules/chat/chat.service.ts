import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { KarpathyRagService } from '../../rag/karpathy/karpathy-rag.service';
import { AgenticRagService } from '../../rag/agentic/agentic-rag.service';
import { ConversationService } from './conversation.service';
import { ConversationEmbeddingService } from './conversation-embedding.service';
import { MemoryService } from '../memory/memory.service';
import { QueryLogEntity } from '../../providers/db/entities/query-log.entity';
import { ChatDto, type ChatMode } from './chat.dto';
import type { ChatResponse } from './chat.dto';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly karpathyRagService: KarpathyRagService,
    private readonly agenticRagService: AgenticRagService,
    private readonly conversationService: ConversationService,
    private readonly conversationEmbeddingService: ConversationEmbeddingService,
    private readonly memoryService: MemoryService,
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
    if (memoryResult.systemMessage) {
      memoryMessages.push({
        role: 'system',
        content: memoryResult.systemMessage.content as string,
      });
      this.logger.debug(
        `Memory injected: user=${memoryResult.userMemories.length}, session=${memoryResult.sessionMemories.length}`,
      );
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

      // 查询日志（异步，不阻塞返回）
      void this.logQuery({
        userId,
        query: req.query,
        mode,
        threadId,
        startTime,
        refused:
          result.answer === this.karpathyRagService.unsupportedReliableAnswer(),
        citationCount: result.references.length,
        hasAnswer: result.answer.length > 0,
      });

      return {
        ...result,
        mode: 'simple',
        route: 'simple',
        threadId,
      };
    }

    // agentic / auto 模式走 AgenticRagService
    const result = await this.agenticRagService.run(
      req.query,
      mode,
      undefined,
      history,
      threadId,
      userId,
      memoryMessages,
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

    // 查询日志（异步，不阻塞返回）
    void this.logQuery({
      userId,
      query: req.query,
      mode,
      threadId,
      startTime,
      refused:
        result.answer === this.karpathyRagService.unsupportedReliableAnswer(),
      citationCount: result.references?.length ?? 0,
      hasAnswer: result.answer.length > 0,
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
    };
  }

  private async logQuery(params: {
    userId: string;
    query: string;
    mode: string;
    threadId: string;
    startTime: number;
    refused: boolean;
    citationCount: number;
    hasAnswer: boolean;
  }): Promise<void> {
    try {
      await this.queryLogRepo.save(
        this.queryLogRepo.create({
          id: randomUUID(),
          userId: params.userId ?? null,
          query: params.query.slice(0, 2000),
          mode: params.mode as 'simple' | 'agentic' | 'auto',
          threadId: params.threadId ?? null,
          refused: params.refused,
          citationCount: params.citationCount,
          latencyMs: Date.now() - params.startTime,
          hasAnswer: params.hasAnswer,
        }),
      );
    } catch (err) {
      this.logger.warn(`Failed to log query: ${(err as Error).message}`);
    }
  }
}
