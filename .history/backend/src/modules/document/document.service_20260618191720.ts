import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { EmbeddingProvider } from '../../providers/embedding/embedding.provider';
import { VectorStoreProvider } from '../../providers/vector-store/vector-store.provider';
import { KarpathyRagService } from '../../rag/karpathy/karpathy-rag.service';
import { ElasticsearchProvider } from '../../providers/elasticsearch/elasticsearch.provider';
import { MarkdownChunker } from './chunking.util';
import { DocumentMetaEntity } from '../../providers/db/entities/document-meta.entity';
import { DocumentMetadataExtractor } from './document-metadata.extractor';

export interface UploadResult {
  docId: string;
  chunkCount: number;
  metadata?: {
    title: string;
    author: string;
    summary: string;
    keywords: string[];
    language: string;
    category: string;
  };
}

export interface DocMeta extends UploadResult {
  filename: string;
  createdAt: string;
}

/**
 * 文档服务：接收已解析文本 → 切分 → Embedding → 写入 Milvus + BM25 + ES
 */
@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);
  private readonly chunker = new MarkdownChunker(500, 50);

  constructor(
    @InjectRepository(DocumentMetaEntity)
    private readonly docMetaRepo: Repository<DocumentMetaEntity>,
    private readonly embeddingProvider: EmbeddingProvider,
    private readonly vectorStoreProvider: VectorStoreProvider,
    private readonly karpathyRagService: KarpathyRagService,
    private readonly elasticsearchProvider: ElasticsearchProvider,
    private readonly metadataExtractor: DocumentMetadataExtractor,
  ) {}

  async upload(
    filename: string,
    content: string,
    userId: string,
  ): Promise<UploadResult> {
    const docId = randomUUID();
    this.logger.log(`Uploading ${filename}, docId=${docId}, userId=${userId}`);

    // 1. 切分
    const chunks = await this.chunker.split(content);
    this.logger.log(`Split into ${chunks.length} chunks`);

    // 2. 批量 Embedding
    const vectors = await this.embeddingProvider.embedDocuments(chunks);

    // 3. 写入 Milvus (包含 userId)
    const records = chunks.map((chunk, idx) => ({
      id: randomUUID(),
      vector: vectors[idx],
      content: chunk,
      docId,
      chunkIndex: idx,
      userId,
    }));
    await this.vectorStoreProvider.insert(records);

    // 4. 同步 BM25 索引（含 JSON 持久化，带有 userId 隔离）
    const chunkDocs = chunks.map((chunk, idx) => ({
      id: records[idx].id,
      content: chunk,
      docId,
      chunkIndex: idx,
      userId,
    }));
    this.karpathyRagService.indexChunks(chunkDocs, userId);

    // 5. 同步 Elasticsearch 索引（ES 未启用时自动跳过）
    await this.elasticsearchProvider.indexChunks(chunkDocs, userId);

    // 6. LLM 抽取文档元数据（异步，不阻塞上传返回）
    const metadataPromise = this.metadataExtractor
      .extract(content)
      .catch((err) => {
        this.logger.warn(
          `Metadata extraction failed: ${(err as Error).message}`,
        );
        return null;
      });

    // 7. 存元数据到数据库（先存基础信息，元数据异步更新）
    const docMeta = this.docMetaRepo.create({
      docId,
      filename,
      chunkCount: chunks.length,
      userId,
    });
    await this.docMetaRepo.save(docMeta);

    // 等待元数据抽取完成后更新
    const metadata = await metadataPromise;
    if (metadata) {
      await this.docMetaRepo.update(
        { docId },
        {
          title: metadata.title || null,
          author: metadata.author || null,
          summary: metadata.summary || null,
          keywords: metadata.keywords.length > 0 ? JSON.stringify(metadata.keywords) : null,
          language: metadata.language || null,
          category: metadata.category || null,
        },
      );
      this.logger.log(
        `Metadata saved: docId=${docId}, title="${metadata.title}", category=${metadata.category}`,
      );
    }

    this.logger.log(
      `Upload done: docId=${docId}, chunks=${chunks.length}, esEnabled=${this.elasticsearchProvider.isEnabled()}`,
    );
    return { docId, chunkCount: chunks.length, metadata: metadata || undefined };
  }

  /**
   * 删除文档：Milvus chunks + BM25 索引 + ES + 数据库元数据
   */
  async delete(docId: string, userId: string): Promise<void> {
    const meta = await this.docMetaRepo.findOne({ where: { docId, userId } });
    if (!meta) {
      throw new NotFoundException(`doc ${docId} not found`);
    }

    this.logger.log(
      `Deleting doc ${docId} (${meta.filename}) for userId=${userId}`,
    );

    // 1. 删除 Milvus 中的 chunks
    try {
      await this.vectorStoreProvider.deleteByDocId(docId);
    } catch (err) {
      this.logger.warn(
        `Milvus delete failed for docId=${docId}: ${(err as Error).message}`,
      );
    }

    // 2. 删除 BM25 内存索引 + JSON 持久化更新
    this.karpathyRagService.removeDocChunks(docId, userId);

    // 3. 删除 Elasticsearch 索引（ES 未启用时自动跳过）
    await this.elasticsearchProvider.deleteByDocId(docId, userId);

    // 4. 删除数据库元数据
    await this.docMetaRepo.delete({ docId, userId });

    this.logger.log(`Doc ${docId} deleted successfully`);
  }

  async getDocMeta(
    docId: string,
    userId: string,
  ): Promise<DocMeta | undefined> {
    const meta = await this.docMetaRepo.findOne({ where: { docId, userId } });
    if (!meta) return undefined;
    return {
      docId: meta.docId,
      filename: meta.filename,
      chunkCount: meta.chunkCount,
      createdAt: meta.createdAt.toISOString(),
    };
  }

  async listDocs(userId: string): Promise<DocMeta[]> {
    const list = await this.docMetaRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    return list.map((meta) => ({
      docId: meta.docId,
      filename: meta.filename,
      chunkCount: meta.chunkCount,
      createdAt: meta.createdAt.toISOString(),
      metadata: meta.title
        ? {
            title: meta.title,
            author: meta.author || '未知',
            summary: meta.summary || '',
            keywords: meta.keywords ? (JSON.parse(meta.keywords) as string[]) : [],
            language: meta.language || '未知',
            category: meta.category || '其他',
          }
        : undefined,
    }));
  }
}
