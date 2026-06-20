import { Controller, Get, Query } from '@nestjs/common';
import { KarpathyRagService } from '../../rag/karpathy/karpathy-rag.service';
import { VectorStoreProvider } from '../../providers/vector-store/vector-store.provider';

@Controller('debug')
export class DebugController {
  constructor(
    private readonly karpathyRagService: KarpathyRagService,
    private readonly vectorStoreProvider: VectorStoreProvider,
  ) {}

  @Get('chunks')
  async debugChunks(@Query('query') query: string, @Query('k') k?: string) {
    if (!query) {
      return { error: 'query is required' };
    }
    const topK = k ? parseInt(k, 10) : 5;
    const chunks = await this.karpathyRagService.retrieve(query);
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
