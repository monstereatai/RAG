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
import { DocumentChunkEntity } from '../../providers/db/entities/document-chunk.entity';
import { FactConflictEntity } from '../../providers/db/entities/fact-conflict.entity';
import { DocumentMetadataExtractor } from './document-metadata.extractor';
import { DocumentTaskEntity } from '../../providers/db/entities/document-task.entity';
import { DocumentResourceEntity } from '../../providers/db/entities/document-resource.entity';
import { ObjectStorageProvider } from '../../providers/object-storage/object-storage.provider';
import { DocumentPermissionService } from './document-permission.service';
import { PermissionSubject } from './document-permission.service';

export interface UploadResult {
  docId: string;
  chunkCount: number;
  taskId?: string;
  docVersion?: string | null;
  effectiveAt?: string | null;
  expiredAt?: string | null;
  sourceAuthority?: string;
  metadata?: {
    title: string;
    author: string;
    summary: string;
    keywords: string[];
    language: string;
    category: string;
  };
}

export interface UploadOptions {
  taskId?: string;
  originalBuffer?: Buffer;
  contentType?: string;
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
  private readonly pendingMilvusDeletes = new Map<string, number>();

  constructor(
    @InjectRepository(DocumentMetaEntity)
    private readonly docMetaRepo: Repository<DocumentMetaEntity>,
    @InjectRepository(DocumentChunkEntity)
    private readonly docChunkRepo: Repository<DocumentChunkEntity>,
    @InjectRepository(FactConflictEntity)
    private readonly factConflictRepo: Repository<FactConflictEntity>,
    @InjectRepository(DocumentTaskEntity)
    private readonly taskRepo: Repository<DocumentTaskEntity>,
    @InjectRepository(DocumentResourceEntity)
    private readonly resourceRepo: Repository<DocumentResourceEntity>,
    private readonly embeddingProvider: EmbeddingProvider,
    private readonly vectorStoreProvider: VectorStoreProvider,
    private readonly karpathyRagService: KarpathyRagService,
    private readonly elasticsearchProvider: ElasticsearchProvider,
    private readonly metadataExtractor: DocumentMetadataExtractor,
    private readonly objectStorageProvider: ObjectStorageProvider,
    private readonly permissionService: DocumentPermissionService,
  ) {}

  async upload(
    filename: string,
    content: string,
    userId: string,
    options: UploadOptions = {},
  ): Promise<UploadResult> {
    const docId = randomUUID();
    const taskId = options.taskId ?? randomUUID();
    this.logger.log(`Uploading ${filename}, docId=${docId}, userId=${userId}`);
    await this.upsertTask(taskId, {
      docId,
      userId,
      filename,
      status: 'processing',
      stage: 'parsing',
      progress: 10,
      startedAt: new Date(),
    });

    try {
      if (options.originalBuffer) {
        await this.saveOriginalResource({
          docId,
          taskId,
          userId,
          filename,
          buffer: options.originalBuffer,
          contentType: options.contentType,
        });
      }

      const structuredChunks = await this.chunker.splitStructured(content);
      const chunks = structuredChunks.map((chunk) => chunk.content);
      const governance = this.extractGovernanceMetadata(filename, content);
      this.logger.log(`Split into ${chunks.length} chunks`);
      await this.updateTask(taskId, { stage: 'embedding', progress: 30 });

      const vectors = await this.embeddingProvider.embedDocuments(chunks);
      await this.updateTask(taskId, { stage: 'vector_index', progress: 50 });

      const records = chunks.map((chunk, idx) => ({
        id: randomUUID(),
        vector: vectors[idx],
        content: chunk,
        docId,
        chunkIndex: idx,
        userId,
      }));
      await this.vectorStoreProvider.insert(records);

      const chunkDocs = chunks.map((chunk, idx) => ({
        id: records[idx].id,
        content: chunk,
        docId,
        chunkIndex: idx,
        userId,
        parentChunkId: structuredChunks[idx]?.parentChunkId ?? null,
        headingPath: structuredChunks[idx]?.headingPath ?? [],
        sectionId: structuredChunks[idx]?.sectionId ?? null,
        clauseId: structuredChunks[idx]?.clauseId ?? null,
        tableRef: structuredChunks[idx]?.tableRef ?? null,
        sourceStart: structuredChunks[idx]?.sourceStart ?? null,
        sourceEnd: structuredChunks[idx]?.sourceEnd ?? null,
        docVersion: governance.docVersion,
        effectiveAt: governance.effectiveAt,
        expiredAt: governance.expiredAt,
        sourceAuthority: governance.sourceAuthority,
      }));
      this.karpathyRagService.indexChunks(chunkDocs, userId);
      await this.elasticsearchProvider.indexChunks(chunkDocs, userId);
      await this.updateTask(taskId, { stage: 'metadata', progress: 80 });

      const metadataPromise = this.metadataExtractor
        .extract(content)
        .catch((err) => {
          this.logger.warn(
            `Metadata extraction failed: ${(err as Error).message}`,
          );
          return null;
        });

      const docMeta = this.docMetaRepo.create({
        docId,
        filename,
        chunkCount: chunks.length,
        userId,
        docVersion: governance.docVersion,
        effectiveAt: governance.effectiveAt,
        expiredAt: governance.expiredAt,
        sourceAuthority: governance.sourceAuthority,
      });
      await this.docMetaRepo.save(docMeta);
      await this.permissionService.grantOwner(docId, userId);
      await this.saveChunkMetadata(
        docId,
        userId,
        records,
        structuredChunks,
        governance,
      );
      await this.detectAndSaveFactConflicts(docId, userId, records, governance);

      const metadata = await metadataPromise;
      if (metadata) {
        await this.docMetaRepo.update(
          { docId },
          {
            title: metadata.title || null,
            author: metadata.author || null,
            summary: metadata.summary || null,
            keywords:
              metadata.keywords.length > 0
                ? JSON.stringify(metadata.keywords)
                : null,
            language: metadata.language || null,
            category: metadata.category || null,
          },
        );
        this.logger.log(
          `Metadata saved: docId=${docId}, title="${metadata.title}", category=${metadata.category}`,
        );
      }

      await this.updateTask(taskId, {
        status: 'completed',
        stage: 'completed',
        progress: 100,
        chunkCount: chunks.length,
        finishedAt: new Date(),
      });

      this.logger.log(
        `Upload done: docId=${docId}, chunks=${
          chunks.length
        }, esEnabled=${this.elasticsearchProvider.isEnabled()}`,
      );
      return {
        docId,
        taskId,
        chunkCount: chunks.length,
        docVersion: governance.docVersion,
        effectiveAt: governance.effectiveAt?.toISOString() ?? null,
        expiredAt: governance.expiredAt?.toISOString() ?? null,
        sourceAuthority: governance.sourceAuthority,
        metadata: metadata || undefined,
      };
    } catch (err) {
      await this.updateTask(taskId, {
        status: 'failed',
        stage: 'failed',
        errorMessage: (err as Error).message,
        finishedAt: new Date(),
      });
      throw err;
    }
  }

  createQueuedTask(
    filename: string,
    userId: string,
  ): Promise<DocumentTaskEntity> {
    const task = this.taskRepo.create({
      id: randomUUID(),
      filename,
      userId,
      status: 'queued',
      stage: 'queued',
      progress: 0,
    });
    return this.taskRepo.save(task);
  }

  getTask(taskId: string, userId: string): Promise<DocumentTaskEntity | null> {
    return this.taskRepo.findOne({ where: { id: taskId, userId } });
  }

  async markTaskFailed(taskId: string, errorMessage: string): Promise<void> {
    await this.updateTask(taskId, {
      status: 'failed',
      stage: 'failed',
      progress: 100,
      errorMessage,
      finishedAt: new Date(),
    });
  }

  setPermissions(docId: string, subjects: PermissionSubject[]): Promise<void> {
    return this.permissionService.setPermissions(docId, subjects);
  }

  listResources(docId: string): Promise<DocumentResourceEntity[]> {
    return this.resourceRepo.find({
      where: { docId },
      order: { createdAt: 'DESC' },
    });
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
      this.scheduleMilvusDeleteRetry(docId);
    }

    // 2. 删除 BM25 内存索引 + JSON 持久化更新
    this.karpathyRagService.removeDocChunks(docId, userId);

    // 3. 删除 Elasticsearch 索引（ES 未启用时自动跳过）
    await this.elasticsearchProvider.deleteByDocId(docId, userId);

    // 4. 删除数据库元数据与结构化事实索引
    await this.factConflictRepo.delete({ docId, userId });
    await this.docChunkRepo.delete({ docId, userId });
    await this.resourceRepo.update({ docId, userId }, { docId: null });
    await this.docMetaRepo.delete({ docId, userId });

    this.logger.log(`Doc ${docId} deleted successfully`);
  }

  private async saveOriginalResource(params: {
    docId: string;
    taskId: string;
    userId: string;
    filename: string;
    buffer: Buffer;
    contentType?: string;
  }): Promise<void> {
    const key = [
      params.userId,
      params.docId,
      'original',
      `${Date.now()}-${params.filename}`.replace(/[^\w.-]+/g, '_'),
    ].join('/');
    const stored = await this.objectStorageProvider.putObject({
      key,
      body: params.buffer,
      contentType: params.contentType,
    });
    await this.resourceRepo.save(
      this.resourceRepo.create({
        id: randomUUID(),
        docId: params.docId,
        taskId: params.taskId,
        userId: params.userId,
        kind: 'original',
        filename: params.filename,
        objectKey: stored.key,
        url: stored.url,
        contentType: params.contentType ?? null,
        size: params.buffer.length,
      }),
    );
  }

  private async upsertTask(
    taskId: string,
    patch: Partial<DocumentTaskEntity>,
  ): Promise<void> {
    const existing = await this.taskRepo.findOne({ where: { id: taskId } });
    if (existing) {
      await this.taskRepo.update({ id: taskId }, patch);
      return;
    }
    await this.taskRepo.save(
      this.taskRepo.create({
        id: taskId,
        filename: patch.filename ?? 'unknown',
        userId: patch.userId ?? null,
        docId: patch.docId ?? null,
        status: patch.status ?? 'queued',
        stage: patch.stage ?? 'queued',
        progress: patch.progress ?? 0,
        startedAt: patch.startedAt ?? null,
      }),
    );
  }

  private async updateTask(
    taskId: string,
    patch: Partial<DocumentTaskEntity>,
  ): Promise<void> {
    await this.taskRepo.update({ id: taskId }, patch);
  }

  private scheduleMilvusDeleteRetry(docId: string): void {
    const attempts = this.pendingMilvusDeletes.get(docId) ?? 0;
    if (attempts >= 5) {
      this.logger.warn(
        `Milvus delete retry exhausted for docId=${docId}; vector hits remain guarded by active docId filtering`,
      );
      return;
    }

    const nextAttempt = attempts + 1;
    this.pendingMilvusDeletes.set(docId, nextAttempt);
    const delayMs = Math.min(5_000 * 2 ** attempts, 60_000);

    const timer = setTimeout(() => {
      void this.retryMilvusDelete(docId);
    }, delayMs);
    timer.unref?.();
  }

  private async retryMilvusDelete(docId: string): Promise<void> {
    try {
      await this.vectorStoreProvider.deleteByDocId(docId);
      this.pendingMilvusDeletes.delete(docId);
      this.logger.log(`Milvus delete retry succeeded for docId=${docId}`);
    } catch (err) {
      this.logger.warn(
        `Milvus delete retry failed for docId=${docId}: ${
          (err as Error).message
        }`,
      );
      this.scheduleMilvusDeleteRetry(docId);
    }
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
      docVersion: meta.docVersion,
      effectiveAt: meta.effectiveAt?.toISOString() ?? null,
      expiredAt: meta.expiredAt?.toISOString() ?? null,
      sourceAuthority: meta.sourceAuthority,
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
      docVersion: meta.docVersion,
      effectiveAt: meta.effectiveAt?.toISOString() ?? null,
      expiredAt: meta.expiredAt?.toISOString() ?? null,
      sourceAuthority: meta.sourceAuthority,
      metadata: meta.title
        ? {
            title: meta.title,
            author: meta.author || '未知',
            summary: meta.summary || '',
            keywords: meta.keywords
              ? (JSON.parse(meta.keywords) as string[])
              : [],
            language: meta.language || '未知',
            category: meta.category || '其他',
          }
        : undefined,
    }));
  }

  private async saveChunkMetadata(
    docId: string,
    userId: string,
    records: Array<{ id: string; content: string; chunkIndex: number }>,
    chunks: Awaited<ReturnType<MarkdownChunker['splitStructured']>>,
    governance: DocumentGovernanceMetadata,
  ): Promise<void> {
    const entities = records.map((record, index) => {
      const chunk = chunks[index];
      return this.docChunkRepo.create({
        id: record.id,
        docId,
        userId,
        parentChunkId: chunk?.parentChunkId ?? null,
        chunkIndex: record.chunkIndex,
        chunkType: 'leaf',
        content: record.content,
        headingPath:
          chunk && chunk.headingPath.length > 0
            ? JSON.stringify(chunk.headingPath)
            : null,
        sectionId: chunk?.sectionId ?? null,
        clauseId: chunk?.clauseId ?? null,
        tableRef: chunk?.tableRef ?? null,
        sourceStart: chunk?.sourceStart ?? null,
        sourceEnd: chunk?.sourceEnd ?? null,
        docVersion: governance.docVersion,
        effectiveAt: governance.effectiveAt,
        expiredAt: governance.expiredAt,
        sourceAuthority: governance.sourceAuthority,
      });
    });
    await this.docChunkRepo.save(entities);
  }

  private async detectAndSaveFactConflicts(
    docId: string,
    userId: string,
    records: Array<{ id: string; content: string }>,
    governance: DocumentGovernanceMetadata,
  ): Promise<void> {
    const conflicts = records.flatMap((record) =>
      this.detectChunkConflicts(record.content).map((conflict) =>
        this.factConflictRepo.create({
          id: randomUUID(),
          userId,
          docId,
          chunkId: record.id,
          subject: conflict.subject,
          predicate: conflict.predicate,
          currentValue: conflict.currentValue,
          conflictingValue: conflict.conflictingValue,
          currentVersion: governance.docVersion,
          conflictingVersion: conflict.conflictingVersion,
          status: 'detected',
          sourceAuthority: governance.sourceAuthority,
        }),
      ),
    );

    if (conflicts.length > 0) {
      await this.factConflictRepo.save(conflicts);
    }
  }

  private detectChunkConflicts(content: string): FactConflictDraft[] {
    const years = [...new Set(content.match(/20\d{2}/g) ?? [])];
    if (years.length < 2) {
      return [];
    }

    const amounts = [...new Set(content.match(/\d+(?:\.\d+)?\s*元/g) ?? [])];
    if (amounts.length < 2) {
      return [];
    }

    return [
      {
        subject: this.extractConflictSubject(content),
        predicate: 'versioned_numeric_policy',
        currentValue: amounts[amounts.length - 1],
        conflictingValue: amounts[0],
        conflictingVersion: years[0],
      },
    ];
  }

  private extractConflictSubject(content: string): string {
    const match = /(住宿报销上限|报销上限|绩效奖金|基本工资|审批规则)/.exec(
      content,
    );
    return match?.[1] ?? 'versioned_policy';
  }

  private extractGovernanceMetadata(
    filename: string,
    content: string,
  ): DocumentGovernanceMetadata {
    return {
      docVersion: this.extractDocVersion(filename, content),
      effectiveAt: this.extractDate(
        content,
        /(?:生效日期|生效时间|effectiveAt)[:：]?\s*(\d{4}-\d{2}-\d{2})/i,
      ),
      expiredAt: this.extractDate(
        content,
        /(?:失效日期|失效时间|expiredAt)[:：]?\s*(\d{4}-\d{2}-\d{2})/i,
      ),
      sourceAuthority: this.extractSourceAuthority(filename, content),
    };
  }

  private extractDocVersion(filename: string, content: string): string | null {
    const haystack = `${filename}\n${content}`;
    const explicit =
      /(?:版本|版次|docVersion|version)[:：]?\s*([A-Za-z0-9._-]+|20\d{2}\s*版)/i.exec(
        haystack,
      );
    if (explicit?.[1]) {
      return explicit[1].replace(/\s+/g, '');
    }
    return haystack.match(/20\d{2}\s*版/)?.[0]?.replace(/\s+/g, '') ?? null;
  }

  private extractDate(text: string, pattern: RegExp): Date | null {
    const value = pattern.exec(text)?.[1];
    if (!value) {
      return null;
    }
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private extractSourceAuthority(filename: string, content: string): string {
    const haystack = `${filename}\n${content}`.toLowerCase();
    if (/废止|失效|deprecated/.test(haystack)) return 'deprecated';
    if (/草稿|draft/.test(haystack)) return 'draft';
    if (/正式|官方|制度|policy|official/.test(haystack)) return 'official';
    return 'normal';
  }
}

interface DocumentGovernanceMetadata {
  docVersion: string | null;
  effectiveAt: Date | null;
  expiredAt: Date | null;
  sourceAuthority: string;
}

interface FactConflictDraft {
  subject: string;
  predicate: string;
  currentValue: string;
  conflictingValue: string;
  conflictingVersion: string | null;
}
