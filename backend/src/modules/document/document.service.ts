import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EmbeddingProvider } from '../../providers/embedding/embedding.provider';
import { VectorStoreProvider } from '../../providers/vector-store/vector-store.provider';
import { KarpathyRagService } from '../../rag/karpathy/karpathy-rag.service';
import { MarkdownChunker } from './chunking.util';

export interface UploadResult {
  docId: string;
  chunkCount: number;
}

/**
 * 文档服务：接收已解析文本 → 切分 → Embedding → 写入 Milvus
 * M1 阶段：文档元数据存内存 Map（M2 再落库）
 */
@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);
  private readonly chunker = new MarkdownChunker(500, 50);
  // docId → { filename, chunkCount, createdAt }
  private readonly docMeta = new Map<
    string,
    UploadResult & { filename: string; createdAt: string }
  >();

  constructor(
    private readonly embeddingProvider: EmbeddingProvider,
    private readonly vectorStoreProvider: VectorStoreProvider,
    private readonly karpathyRagService: KarpathyRagService,
  ) {}

  async upload(filename: string, content: string): Promise<UploadResult> {
    const docId = randomUUID();
    this.logger.log(`Uploading ${filename}, docId=${docId}`);

    // 1. 切分
    const chunks = await this.chunker.split(content);
    this.logger.log(`Split into ${chunks.length} chunks`);

    // 2. 批量 Embedding
    const vectors = await this.embeddingProvider.embedDocuments(chunks);

    // 3. 写入 Milvus
    const records = chunks.map((chunk, idx) => ({
      id: randomUUID(),
      vector: vectors[idx],
      content: chunk,
      docId,
      chunkIndex: idx,
    }));
    await this.vectorStoreProvider.insert(records);

    // 4. 同步 BM25 索引（内存）
    this.karpathyRagService.indexChunks(
      chunks.map((chunk, idx) => ({
        id: records[idx].id,
        content: chunk,
        docId,
        chunkIndex: idx,
      })),
    );

    // 5. 存元数据
    this.docMeta.set(docId, {
      docId,
      filename,
      chunkCount: chunks.length,
      createdAt: new Date().toISOString(),
    });

    return { docId, chunkCount: chunks.length };
  }

  getDocMeta(
    docId: string,
  ): (UploadResult & { filename: string; createdAt: string }) | undefined {
    return this.docMeta.get(docId);
  }

  listDocs(): Array<UploadResult & { filename: string; createdAt: string }> {
    return Array.from(this.docMeta.values());
  }
}
