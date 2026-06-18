import { Injectable, BadRequestException } from '@nestjs/common';
import { KarpathyRagService } from '../../rag/karpathy/karpathy-rag.service';
import { AgenticRagService } from '../../rag/agentic/agentic-rag.service';
import { ChatDto, type ChatMode } from './chat.dto';
import type { ChatResponse } from './chat.dto';

@Injectable()
export class ChatService {
  constructor(
    private readonly karpathyRagService: KarpathyRagService,
    private readonly agenticRagService: AgenticRagService,
  ) {}

  async chat(req: ChatDto): Promise<ChatResponse> {
    if (!req.query || req.query.trim().length === 0) {
      throw new BadRequestException('query is required');
    }

    const mode: ChatMode = req.mode ?? 'simple';

    if (mode === 'simple') {
      const result = await this.karpathyRagService.answer(
        req.query,
        req.history ?? [],
      );
      return {
        ...result,
        mode: 'simple',
        route: 'simple',
      };
    }

    // agentic / auto 模式走 AgenticRagService
    const result = await this.agenticRagService.run(req.query, mode);
    return {
      answer: result.answer,
      references: result.references,
      mode,
      route: result.route,
      confidence: result.confidence,
      retryCount: result.retryCount,
    };
  }
}
