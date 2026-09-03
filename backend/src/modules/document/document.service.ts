import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
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
import { KnowledgeBaseProfileEntity } from '../../providers/db/entities/knowledge-base-profile.entity';
import { detectPromptInjection } from '../../rag/prompts/prompt-injection.guard';
import { GraphService } from '../graph/graph.service';
import { DocumentQueueService } from './document-queue.service';
import { detectDocumentKind } from './document-parser.util';
import { ImageIndexService } from '../image-index/image-index.service';
import {
  assessIngestionQuality,
  detectGameDocumentMetadata,
  DocumentLifecycleStatus,
  GameDocumentMetadata,
  DocumentBusinessMetadata,
  ResolvedDocumentBusinessMetadata,
  GameDocumentType,
  getChunkStrategy,
  IngestionQualityReport,
} from './document-profile.util';

export interface UploadResult {
  docId: string;
  chunkCount: number;
  taskId?: string;
  docVersion?: string | null;
  effectiveAt?: string | null;
  expiredAt?: string | null;
  sourceAuthority?: string;
  projectId?: string | null;
  activityId?: string | null;
  region?: string | null;
  locale?: string | null;
  channel?: string | null;
  roleScope?: string[];
  documentType?: GameDocumentType;
  lifecycleStatus?: DocumentLifecycleStatus;
  graphIndexStatus?: GraphIndexStatus;
  graphIndexedAt?: string | null;
  graphIndexError?: string | null;
  supersedesDocId?: string | null;
  ingestionQuality?: IngestionQualityReport;
  chunkStrategy?: { chunkSize: number; chunkOverlap: number };
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
  businessMetadata?: DocumentBusinessMetadata;
  onQualityAccepted?: (docId: string) => Promise<void>;
}

export interface DocMeta extends UploadResult {
  filename: string;
  createdAt: string;
  reviewStatus?: 'draft' | 'pending_review' | 'approved' | 'rejected';
  reviewedAt?: string | null;
  reviewComment?: string | null;
}

type GraphIndexStatus = 'pending' | 'indexed' | 'failed' | 'skipped';

/**
 * 文档服务：接收已解析文本 → 切分 → Embedding → 写入 Milvus + BM25 + ES
 */
@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);
  private readonly pendingMilvusDeletes = new Map<string, number>();
  private readonly pendingGraphIndexes = new Map<string, Promise<void>>();
  private readonly cancelledGraphIndexes = new Set<string>();

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
    private readonly graphService: GraphService,
    private readonly documentQueueService: DocumentQueueService,
    @InjectRepository(KnowledgeBaseProfileEntity)
    private readonly knowledgeBaseProfileRepo: Repository<KnowledgeBaseProfileEntity>,
    private readonly imageIndexService: ImageIndexService,
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

    let originalUrl: string | null = null;
    try {
      if (options.originalBuffer) {
        originalUrl = await this.saveOriginalResource({
          docId,
          taskId,
          userId,
          filename,
          buffer: options.originalBuffer,
          contentType: options.contentType,
        });
      }

      const promptInjectionFindings = detectPromptInjection(content);
      const highRiskPromptInjection = promptInjectionFindings.filter(
        (finding) => finding.severity === 'high',
      );
      if (highRiskPromptInjection.length > 0) {
        // 隔离时仍保留原始资料，供人工复核；不进入切片和任何检索索引。
        if (!options.originalBuffer) {
          await this.saveOriginalResource({
            docId,
            taskId,
            userId,
            filename,
            buffer: Buffer.from(content, 'utf8'),
            contentType: options.contentType ?? 'text/plain',
          });
        }
        const patterns = highRiskPromptInjection
          .map((finding) => finding.pattern)
          .join(', ');
        this.logger.warn(
          `Document quarantined for prompt injection review: docId=${docId}, patterns=${patterns}`,
        );
        throw new Error(
          `document quarantined for security review: ${patterns}`,
        );
      }

      const detectedBusiness = detectGameDocumentMetadata(filename, content);
      const business = this.mergeBusinessMetadata(
        detectedBusiness,
        options.businessMetadata,
      );
      const strategy = await this.resolveChunkStrategy(business);
      const structuredChunks = await new MarkdownChunker(
        strategy.chunkSize,
        strategy.chunkOverlap,
      ).splitStructured(content);
      const chunks = structuredChunks.map((chunk) => chunk.content);
      const ingestionQuality = assessIngestionQuality(
        content,
        structuredChunks,
      );
      const mediumRiskPromptInjection = promptInjectionFindings.filter(
        (finding) => finding.severity === 'medium',
      );
      if (mediumRiskPromptInjection.length > 0) {
        ingestionQuality.warnings.push(
          `检测到需留意的提示注入文本：${mediumRiskPromptInjection
            .map((finding) => finding.pattern)
            .join('、')}`,
        );
      }
      const extractedGovernance = this.extractGovernanceMetadata(
        filename,
        content,
      );
      const governance: DocumentGovernanceMetadata = {
        ...extractedGovernance,
        ...business,
        docVersion: business.docVersion ?? extractedGovernance.docVersion,
        effectiveAt:
          this.parseDateOverride(business.effectiveAt) ??
          extractedGovernance.effectiveAt,
        expiredAt:
          this.parseDateOverride(business.expiredAt) ??
          extractedGovernance.expiredAt,
      };
      if (!ingestionQuality.accepted) {
        throw new Error('document failed ingestion quality gate');
      }
      this.logger.log(`Split into ${chunks.length} chunks`);
      const indexingGovernance: DocumentGovernanceMetadata = {
        ...governance,
        lifecycleStatus: 'draft',
      };
      const records = chunks.map((chunk, idx) => ({
        id: randomUUID(),
        content: chunk,
        docId,
        chunkIndex: idx,
        userId,
      }));
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
        docVersion: indexingGovernance.docVersion,
        effectiveAt: indexingGovernance.effectiveAt,
        expiredAt: indexingGovernance.expiredAt,
        sourceAuthority: indexingGovernance.sourceAuthority,
        projectId: indexingGovernance.projectId,
        activityId: indexingGovernance.activityId,
        region: indexingGovernance.region,
        locale: indexingGovernance.locale,
        channel: indexingGovernance.channel,
        roleScope: indexingGovernance.roleScope,
        documentType: indexingGovernance.documentType,
        lifecycleStatus: indexingGovernance.lifecycleStatus,
        reviewStatus:
          indexingGovernance.lifecycleStatus === 'draft' ? 'draft' : 'approved',
        supersedesDocId: indexingGovernance.supersedesDocId,
      }));
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
        docVersion: indexingGovernance.docVersion,
        effectiveAt: indexingGovernance.effectiveAt,
        expiredAt: indexingGovernance.expiredAt,
        sourceAuthority: indexingGovernance.sourceAuthority,
        projectId: indexingGovernance.projectId,
        activityId: indexingGovernance.activityId,
        region: indexingGovernance.region,
        locale: indexingGovernance.locale,
        channel: indexingGovernance.channel,
        roleScope:
          indexingGovernance.roleScope.length > 0
            ? JSON.stringify(indexingGovernance.roleScope)
            : null,
        documentType: indexingGovernance.documentType,
        lifecycleStatus: indexingGovernance.lifecycleStatus,
        supersedesDocId: indexingGovernance.supersedesDocId,
        ingestionQuality: JSON.stringify(ingestionQuality),
        chunkStrategy: JSON.stringify(strategy),
        graphIndexStatus: this.graphService.isEnabled() ? 'pending' : 'skipped',
      });

      const indexResults = await Promise.allSettled([
        (async () => {
          await this.updateTask(taskId, { stage: 'embedding', progress: 30 });
          const vectors = await this.embeddingProvider.embedDocuments(chunks);
          await this.updateTask(taskId, {
            stage: 'vector_index',
            progress: 50,
          });
          await this.vectorStoreProvider.insert(
            records.map((record, index) => ({
              ...record,
              vector: vectors[index],
            })),
          );
        })(),
        (async () => {
          this.karpathyRagService.indexChunks(chunkDocs, userId);
          await Promise.all([
            this.elasticsearchProvider.indexChunks(chunkDocs, userId),
            this.elasticsearchProvider.indexDocument({
              docId,
              filename,
              content,
              userId,
              title: filename,
              sourceAuthority: indexingGovernance.sourceAuthority,
              projectId: indexingGovernance.projectId,
              activityId: indexingGovernance.activityId,
              region: indexingGovernance.region,
              locale: indexingGovernance.locale,
              channel: indexingGovernance.channel,
              roleScope: indexingGovernance.roleScope,
              documentType: indexingGovernance.documentType,
              lifecycleStatus: indexingGovernance.lifecycleStatus,
              docVersion: indexingGovernance.docVersion,
              effectiveAt: indexingGovernance.effectiveAt,
              expiredAt: indexingGovernance.expiredAt,
            }),
          ]);
        })(),
        (async () => {
          await this.docMetaRepo.save(docMeta);
          await this.permissionService.grantOwner(docId, userId);
          await this.saveChunkMetadata(
            docId,
            userId,
            records,
            structuredChunks,
            indexingGovernance,
          );
          await this.detectAndSaveFactConflicts(
            docId,
            userId,
            records,
            indexingGovernance,
          );
        })(),
        options.onQualityAccepted?.(docId) ?? Promise.resolve(),
      ]);
      const failedIndex = indexResults.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      if (failedIndex) {
        await this.cleanupFailedExternalIndexes(docId, userId);
        throw failedIndex.reason;
      }

      if (governance.lifecycleStatus !== 'draft') {
        await this.updateLifecycle(docId, userId, governance.lifecycleStatus);
      }
      // 文搜图：图片文档入库成功后把原图写入图片向量库；失败仅告警，不阻塞入库
      if (
        originalUrl &&
        detectDocumentKind(filename) === 'image' &&
        this.imageIndexService.isEnabled()
      ) {
        this.imageIndexService
          .indexImage({ docId, userId, url: originalUrl, meta: { filename } })
          .catch((err: Error) =>
            this.logger.warn(
              `Image index failed for docId=${docId}: ${err.message}`,
            ),
          );
      }
      const graphIndexStatus: GraphIndexStatus = this.graphService.isEnabled()
        ? 'pending'
        : 'skipped';
      if (graphIndexStatus === 'pending') {
        this.scheduleOptionalGraphIndex({ docId, userId, content });
      }
      await this.updateTask(taskId, { stage: 'metadata', progress: 80 });

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
        projectId: governance.projectId,
        activityId: governance.activityId,
        region: governance.region,
        locale: governance.locale,
        channel: governance.channel,
        roleScope: governance.roleScope,
        documentType: governance.documentType,
        lifecycleStatus: governance.lifecycleStatus,
        graphIndexStatus,
        supersedesDocId: governance.supersedesDocId,
        ingestionQuality,
        chunkStrategy: strategy,
        metadata: metadata || undefined,
      };
    } catch (err) {
      const message = (err as Error).message;
      await this.updateTask(taskId, {
        status: 'failed',
        stage: message.startsWith('document quarantined for security review:')
          ? 'security_review'
          : 'failed',
        errorMessage: message,
        finishedAt: new Date(),
      });
      throw err;
    }
  }

  /** 并发入库失败时移除可能已写入的外部检索索引，保留 PostgreSQL 草稿供排障。 */
  private async cleanupFailedExternalIndexes(
    docId: string,
    userId: string,
  ): Promise<void> {
    const cleanupResults = await Promise.allSettled([
      this.vectorStoreProvider.deleteByDocId(docId),
      this.elasticsearchProvider.deleteByDocId(docId, userId),
      Promise.resolve().then(() =>
        this.karpathyRagService.removeDocChunks(docId, userId),
      ),
    ]);
    cleanupResults.forEach((result, index) => {
      if (result.status === 'rejected') {
        const target = ['Milvus', 'Elasticsearch', 'Karpathy/BM25'][index];
        this.logger.warn(
          `Failed to compensate ${target} index for docId=${docId}: ${String(result.reason)}`,
        );
      }
    });
  }

  /** 图谱是非阻塞补充索引：失败不回滚主入库，也不影响版本切换。 */
  private scheduleOptionalGraphIndex(params: {
    docId: string;
    userId: string;
    content: string;
  }): void {
    const job = new Promise<void>((resolve) => {
      const timer = setImmediate(() => {
        void (async () => {
          try {
            if (this.cancelledGraphIndexes.has(params.docId)) return;
            const result = await this.graphService.importText(
              params.content,
              params.userId,
              params.docId,
            );
            if (this.cancelledGraphIndexes.has(params.docId)) {
              await this.graphService.removeSource(params.docId, params.userId);
              return;
            }
            await this.docMetaRepo.update(
              { docId: params.docId, userId: params.userId },
              {
                graphIndexStatus: 'indexed',
                graphIndexedAt: new Date(),
                graphIndexError: null,
              },
            );
            this.logger.log(
              `Graph index completed: docId=${params.docId}, nodes=${result.nodeCount}, relationships=${result.relationshipCount}`,
            );
          } catch (err) {
            const message = (err as Error).message;
            await this.docMetaRepo.update(
              { docId: params.docId, userId: params.userId },
              { graphIndexStatus: 'failed', graphIndexError: message },
            );
            this.logger.warn(
              `Graph index failed without blocking document ingestion: docId=${params.docId}, error=${message}`,
            );
          } finally {
            this.pendingGraphIndexes.delete(params.docId);
            resolve();
          }
        })();
      });
      timer.unref?.();
    });
    this.pendingGraphIndexes.set(params.docId, job);
  }

  private async removeGraphSource(docId: string, userId: string): Promise<void> {
    this.cancelledGraphIndexes.add(docId);
    try {
      await this.pendingGraphIndexes.get(docId);
      await this.graphService.removeSource(docId, userId);
    } catch (err) {
      this.logger.warn(
        `Graph source cleanup failed for docId=${docId}: ${(err as Error).message}`,
      );
    } finally {
      this.cancelledGraphIndexes.delete(docId);
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

  async getFailedTasks(limit = 50): Promise<DocumentTaskEntity[]> {
    return this.taskRepo.find({
      where: { status: 'failed' },
      order: { updatedAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 100),
    });
  }

  async retryFailedTask(taskId: string) {
    const task = await this.taskRepo.findOne({ where: { id: taskId } });
    if (!task || task.status !== 'failed') return { taskId, retried: false, reason: 'failed task not found' };
    const result = await this.documentQueueService.retryFailed(taskId);
    if (result.retried) {
      await this.updateTask(taskId, {
        status: 'queued', stage: 'retry_queued', progress: 0, errorMessage: null, finishedAt: null,
      });
    }
    return result;
  }

  async hasDoc(docId: string, userId: string): Promise<boolean> {
    const count = await this.docMetaRepo.count({ where: { docId, userId } });
    return count > 0;
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

    // 3.5 文搜图：清理图片向量库（未启用/失败不阻塞删除主流程）
    try {
      await this.imageIndexService.deleteByDoc(docId, userId);
    } catch (err) {
      this.logger.warn(
        `Image index delete failed for docId=${docId}: ${(err as Error).message}`,
      );
    }

    // 4. 删除可选图谱来源；共享实体和关系保留其余文档来源。
    await this.removeGraphSource(docId, userId);

    // 5. 删除数据库元数据与结构化事实索引
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
  }): Promise<string> {
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
    return stored.url;
  }

  private async resolveChunkStrategy(
    business: GameDocumentMetadata,
  ): Promise<{ chunkSize: number; chunkOverlap: number }> {
    const keys = [business.projectId, business.documentType].filter(Boolean) as string[];
    for (const key of keys) {
      const profile = await this.knowledgeBaseProfileRepo.findOne({
        where: { key, status: 'enabled', workspaceId: 'default' },
      });
      if (profile) return { chunkSize: profile.chunkSize, chunkOverlap: profile.chunkOverlap };
    }
    return getChunkStrategy(business.documentType);
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
      projectId: meta.projectId,
      activityId: meta.activityId,
      region: meta.region,
      locale: meta.locale,
      channel: meta.channel,
      roleScope: meta.roleScope ? (JSON.parse(meta.roleScope) as string[]) : [],
      documentType: meta.documentType as GameDocumentType,
      lifecycleStatus: meta.lifecycleStatus as DocumentLifecycleStatus,
      reviewStatus: meta.reviewStatus,
      reviewedAt: meta.reviewedAt?.toISOString() ?? null,
      reviewComment: meta.reviewComment,
      graphIndexStatus: meta.graphIndexStatus,
      graphIndexedAt: meta.graphIndexedAt?.toISOString() ?? null,
      graphIndexError: meta.graphIndexError,
      supersedesDocId: meta.supersedesDocId,
      ingestionQuality: meta.ingestionQuality
        ? (JSON.parse(meta.ingestionQuality) as IngestionQualityReport)
        : undefined,
      chunkStrategy: meta.chunkStrategy
        ? (JSON.parse(meta.chunkStrategy) as { chunkSize: number; chunkOverlap: number })
        : undefined,
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
      projectId: meta.projectId,
      activityId: meta.activityId,
      region: meta.region,
      locale: meta.locale,
      channel: meta.channel,
      roleScope: meta.roleScope ? (JSON.parse(meta.roleScope) as string[]) : [],
      documentType: meta.documentType as GameDocumentType,
      lifecycleStatus: meta.lifecycleStatus as DocumentLifecycleStatus,
      reviewStatus: meta.reviewStatus,
      reviewedAt: meta.reviewedAt?.toISOString() ?? null,
      reviewComment: meta.reviewComment,
      graphIndexStatus: meta.graphIndexStatus,
      graphIndexedAt: meta.graphIndexedAt?.toISOString() ?? null,
      graphIndexError: meta.graphIndexError,
      supersedesDocId: meta.supersedesDocId,
      ingestionQuality: meta.ingestionQuality
        ? (JSON.parse(meta.ingestionQuality) as IngestionQualityReport)
        : undefined,
      chunkStrategy: meta.chunkStrategy
        ? (JSON.parse(meta.chunkStrategy) as { chunkSize: number; chunkOverlap: number })
        : undefined,
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
        projectId: governance.projectId,
        activityId: governance.activityId,
        region: governance.region,
        locale: governance.locale,
        channel: governance.channel,
        roleScope:
          governance.roleScope.length > 0
            ? JSON.stringify(governance.roleScope)
            : null,
        documentType: governance.documentType,
        lifecycleStatus: governance.lifecycleStatus,
        supersedesDocId: governance.supersedesDocId,
      });
    });
    await this.docChunkRepo.save(entities);
  }

  private async deprecateSupersededDocument(
    docId: string,
    userId: string,
  ): Promise<void> {
    const exists = await this.docMetaRepo.exist({ where: { docId, userId } });
    if (!exists) {
      this.logger.warn(`Superseded document not found: docId=${docId}`);
      return;
    }
    await Promise.all([
      this.docMetaRepo.update(
        { docId, userId },
        { lifecycleStatus: 'deprecated' },
      ),
      this.docChunkRepo.update(
        { docId, userId },
        { lifecycleStatus: 'deprecated' },
      ),
      this.elasticsearchProvider.updateDocumentLifecycle(
        docId,
        'deprecated',
        userId,
      ),
    ]);
    this.karpathyRagService.updateDocumentLifecycle(
      docId,
      'deprecated',
      userId,
    );
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
  ): Omit<DocumentGovernanceMetadata, keyof GameDocumentMetadata> {
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

  private parseDateOverride(value?: string | null): Date | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private extractSourceAuthority(filename: string, content: string): string {
    const haystack = `${filename}\n${content}`.toLowerCase();
    if (/废止|失效|deprecated/.test(haystack)) return 'deprecated';
    if (/草稿|draft/.test(haystack)) return 'draft';
    if (/正式|官方|制度|policy|official/.test(haystack)) return 'official';
    return 'normal';
  }

  private mergeBusinessMetadata(
    detected: GameDocumentMetadata,
    explicit?: DocumentBusinessMetadata,
  ): ResolvedDocumentBusinessMetadata {
    return {
      projectId: explicit?.projectId?.trim() || detected.projectId,
      activityId: explicit?.activityId?.trim() || detected.activityId,
      region: explicit?.region?.trim() || detected.region,
      locale: explicit?.locale?.trim() || detected.locale,
      channel: explicit?.channel?.trim() || detected.channel,
      roleScope:
        explicit?.roleScope && explicit.roleScope.length > 0
          ? [
              ...new Set(
                explicit.roleScope.map((item) => item.trim()).filter(Boolean),
              ),
            ]
          : detected.roleScope,
      documentType: explicit?.documentType ?? detected.documentType,
      lifecycleStatus: this.applyApprovalGate(
        explicit?.lifecycleStatus ?? detected.lifecycleStatus,
      ),
      supersedesDocId:
        explicit?.supersedesDocId?.trim() || detected.supersedesDocId,
      docVersion: explicit?.docVersion?.trim() || null,
      effectiveAt: explicit?.effectiveAt?.trim() || null,
      expiredAt: explicit?.expiredAt?.trim() || null,
    };
  }

  /**
   * 审批门禁开关（DOCUMENT_REQUIRE_APPROVAL=true）：新文档一律先落 draft。
   * draft 不进入任何检索口径（ES 分块/文档检索、本地 BM25、Milvus 向量通道均已过滤），
   * 由管理后台审核提升为 effective 后自动可见；显式指定 lifecycleStatus 同样被拦下，避免绕过审批。
   */
  private applyApprovalGate(
    lifecycleStatus: DocumentLifecycleStatus,
  ): DocumentLifecycleStatus {
    const raw = (process.env.DOCUMENT_REQUIRE_APPROVAL ?? '')
      .trim()
      .toLowerCase();
    if (!['1', 'true', 'yes', 'on'].includes(raw)) return lifecycleStatus;
    return 'draft';
  }

  async updateLifecycle(
    docId: string,
    userId: string,
    lifecycleStatus: DocumentLifecycleStatus,
  ): Promise<boolean> {
    const exists = await this.docMetaRepo.exist({ where: { docId, userId } });
    if (!exists) return false;
    await Promise.all([
      this.docMetaRepo.update({ docId, userId }, { lifecycleStatus }),
      this.docChunkRepo.update({ docId, userId }, { lifecycleStatus }),
      this.elasticsearchProvider.updateDocumentLifecycle(
        docId,
        lifecycleStatus,
        userId,
      ),
    ]);
    this.karpathyRagService.updateDocumentLifecycle(
      docId,
      lifecycleStatus,
      userId,
    );
    return true;
  }

  async activateVersion(
    docId: string,
    userId: string,
    versionDocIds: string[],
  ): Promise<boolean> {
    const docIds = [...new Set(versionDocIds)];
    if (!docIds.includes(docId)) return false;

    const documents = await this.docMetaRepo.find({
      where: { docId: In(docIds), userId },
    });
    const target = documents.find((document) => document.docId === docId);
    if (!target || target.chunkCount < 1 || documents.length !== docIds.length) {
      return false;
    }

    const deprecatedDocIds = docIds.filter((id) => id !== docId);
    await this.docMetaRepo.manager.transaction(async (manager) => {
      const docMetaRepo = manager.getRepository(DocumentMetaEntity);
      const docChunkRepo = manager.getRepository(DocumentChunkEntity);
      if (deprecatedDocIds.length > 0) {
        await Promise.all([
          docMetaRepo.update(
            { docId: In(deprecatedDocIds), userId },
            { lifecycleStatus: 'deprecated' },
          ),
          docChunkRepo.update(
            { docId: In(deprecatedDocIds), userId },
            { lifecycleStatus: 'deprecated' },
          ),
        ]);
      }
      await Promise.all([
        docMetaRepo.update(
          { docId, userId },
          { lifecycleStatus: 'effective' },
        ),
        docChunkRepo.update(
          { docId, userId },
          { lifecycleStatus: 'effective' },
        ),
      ]);
    });

    for (const id of deprecatedDocIds) {
      await this.elasticsearchProvider.updateDocumentLifecycle(
        id,
        'deprecated',
        userId,
      );
      this.karpathyRagService.updateDocumentLifecycle(id, 'deprecated', userId);
    }
    await this.elasticsearchProvider.updateDocumentLifecycle(
      docId,
      'effective',
      userId,
    );
    this.karpathyRagService.updateDocumentLifecycle(docId, 'effective', userId);
    return true;
  }
}

interface DocumentGovernanceMetadata extends GameDocumentMetadata {
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
