import { Injectable, BadRequestException } from '@nestjs/common';
import { KarpathyRagService } from '../../rag/karpathy/karpathy-rag.service';
import { ChatDto } from './chat.dto';
import type { ChatResponse } from './chat.dto';

@Injectable()
export class ChatService {
  constructor(private readonly karpathyRagService: KarpathyRagService) {}

  async chat(req: ChatDto): Promise<ChatResponse> {
    if (!req.query || req.query.trim().length === 0) {
      throw new BadRequestException('query is required');
    }
    // M1 阶段只支持 simple 模式
    const mode = req.mode ?? 'simple';
    if (mode !== 'simple') {
      throw new BadRequestException(
        `M1 only supports mode=simple, got: ${mode as string}`,
      );
    }
    return this.karpathyRagService.answer(req.query);
  }
}
