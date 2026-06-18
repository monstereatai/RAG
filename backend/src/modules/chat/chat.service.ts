import { Injectable, BadRequestException } from '@nestjs/common';
import { KarpathyRagService } from '../../rag/karpathy/karpathy-rag.service';
import { AgenticRagService } from '../../rag/agentic/agentic-rag.service';
import { ConversationService } from './conversation.service';
import { ChatDto, type ChatMode } from './chat.dto';
import type { ChatResponse } from './chat.dto';

@Injectable()
export class ChatService {
  constructor(
    private readonly karpathyRagService: KarpathyRagService,
    private readonly agenticRagService: AgenticRagService,
    private readonly conversationService: ConversationService,
  ) {}

  async chat(req: ChatDto, userId: string): Promise<ChatResponse> {
    if (!req.query || req.query.trim().length === 0) {
      throw new BadRequestException('query is required');
    }

    const mode: ChatMode = req.mode ?? 'simple';

    // 对话历史管理：threadId 不传则新建
    const threadId =
      req.threadId ??
      (await this.conversationService.create(req.query, 'auto', userId));
    const history =
      req.history ??
      (await this.conversationService.getRecentHistory(threadId, 5, userId));

    if (mode === 'simple') {
      const result = await this.karpathyRagService.answer(
        req.query,
        history,
        userId,
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
}
