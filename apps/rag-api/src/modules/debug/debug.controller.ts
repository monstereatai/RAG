import { Controller, Get, Inject, Query } from '@nestjs/common';
import {
  RAG_RETRIEVAL_CAPABILITY,
  type RagRetrievalCapability,
} from '../../rag/contracts/rag-capabilities';
import { VectorStoreProvider } from '../../providers/vector-store/vector-store.provider';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DevOnlyGuard } from '../../common/guards/dev-only.guard';
import { UseGuards } from '@nestjs/common';
import type { JwtPayload } from '../../common/interfaces/api-response.interface';

@UseGuards(DevOnlyGuard)
@Controller('debug')
export class DebugController {
  constructor(
    @Inject(RAG_RETRIEVAL_CAPABILITY)
    private readonly ragService: RagRetrievalCapability,
    private readonly vectorStoreProvider: VectorStoreProvider,
  ) {}

  @Get('chunks')
  async debugChunks(
    @Query('query') query: string,
    @CurrentUser() user: JwtPayload,
    @Query('k') k?: string,
  ) {
    if (!query) {
      return { error: 'query is required' };
    }
    const topK = k ? parseInt(k, 10) : 5;
    const chunks = await this.ragService.retrieve(query, {}, user.userId);
    return {
      query,
      topK,
      chunks: chunks.slice(0, topK).map((c) => ({
        id: c.id,
        content: c.content,
        docId: c.docId,
        chunkIndex: c.chunkIndex,
        bm25Score: c.bm25Score,
        cosineScore: c.cosineScore,
        totalScore: c.totalScore,
      })),
    };
  }

  @Get('vector-index')
  vectorIndex() {
    return this.vectorStoreProvider.getIndexInfo();
  }
}
