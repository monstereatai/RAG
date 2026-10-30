import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
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
import { GraphService } from '../graph/graph.service';
import {
  DocumentQueueService,
  type DocumentGraphIndexJob,
} from './document-queue.service';
import { DocumentTaskService } from './document-task.service';
import { DocumentImageIngestionService } from './document-image-ingestion.service';
import { DocumentIndexCoordinator } from './document-index-coordinator.service';
import { DocumentRetrievalDescriptionService } from './document-retrieval-description.service';
import type { DocumentVideoExtractionOptions } from './document-parser.util';
import { DingTalkProvider } from '../../providers/notify/dingtalk.provider';
import { TencentSpeechProvider } from '../../providers/speech/tencent-speech.provider';
import { VisionProvider } from '../../providers/vision/vision.provider';
import {
  DocumentLifecycleStatus,
  GameDocumentMetadata,
  DocumentBusinessMetadata,
  ResolvedDocumentBusinessMetadata,
  GameDocumentType,
  getChunkStrategy,
  IngestionQualityReport,
} from './document-profile.util';
import { DomainEventsService } from '../domain-events/domain-events.service';
import type {
  DocMeta,
  DocumentGovernanceMetadata,
  FactConflictDraft,
  IncrementalChunkDraft,
  UploadOptions,
  UploadResult,
} from './document.service.types';
export type {
  DocMeta,
  UploadOptions,
  UploadResult,
} from './document.service.types';
import { DocumentChunkWorkflow } from './document.service.chunk-workflow';
import { DocumentUploadWorkflow } from './document.service.upload-workflow';
import { DocumentRecoveryWorkflow } from './document.service.recovery-workflow';
import type { DomainEventInput } from '../domain-events/domain-events.service';

/**
 * 文档入库编排服务。
 *
 * 固定顺序为：安全扫描／质量门禁 → 结构化父子切块 → 生成向量 → 多存储并发写入。
 * PostgreSQL 始终先以 draft（草稿）状态落库；只有索引成功且通过后续治理流程，
 * 才会被提升为可检索版本。任一必要写入失败会触发外部索引补偿清理。
 */
@Injectable()
export class DocumentService implements OnModuleInit, OnModuleDestroy {
  private readonly chunkWorkflow: DocumentChunkWorkflow;
  private readonly uploadWorkflow: DocumentUploadWorkflow;
  private recoveryWorkflow?: DocumentRecoveryWorkflow;
  private readonly logger = new Logger(DocumentService.name);
  private readonly pendingGraphIndexes = new Map<string, Promise<void>>();
  private readonly cancelledGraphIndexes = new Set<string>();
  private graphIndexRecoveryTimer?: ReturnType<typeof setInterval>;

  constructor(
    @InjectRepository(DocumentMetaEntity)
    private readonly docMetaRepo: Repository<DocumentMetaEntity>,
    @InjectRepository(DocumentChunkEntity)
    private readonly docChunkRepo: Repository<DocumentChunkEntity>,
    @InjectRepository(FactConflictEntity)
    private readonly factConflictRepo: Repository<FactConflictEntity>,
    @InjectRepository(DocumentResourceEntity)
    private readonly resourceRepo: Repository<DocumentResourceEntity>,
    private readonly metadataExtractor: DocumentMetadataExtractor,
    private readonly objectStorageProvider: ObjectStorageProvider,
    private readonly permissionService: DocumentPermissionService,
    private readonly graphService: GraphService,
    private readonly documentQueueService: DocumentQueueService,
    private readonly documentTaskService: DocumentTaskService,
    private readonly documentIndexCoordinator: DocumentIndexCoordinator,
    private readonly domainEvents: DomainEventsService,
    private readonly retrievalDescriptionService: DocumentRetrievalDescriptionService,
    @InjectRepository(KnowledgeBaseProfileEntity)
    private readonly knowledgeBaseProfileRepo: Repository<KnowledgeBaseProfileEntity>,
    private readonly documentImageIngestionService: DocumentImageIngestionService,
    @Optional() private readonly dingTalk?: DingTalkProvider,
    @Optional() private readonly speechProvider?: TencentSpeechProvider,
    @Optional() private readonly visionProvider?: VisionProvider,
  ) {
    this.chunkWorkflow = new DocumentChunkWorkflow({
      docChunkRepo: this.docChunkRepo,
      docMetaRepo: this.docMetaRepo,
      documentIndexCoordinator: this.documentIndexCoordinator,
      documentTaskService: this.documentTaskService,
      factConflictRepo: this.factConflictRepo,
      graphService: this.graphService,
      logger: this.logger,
      rebuildRetrievalDescriptions: (tenantId, docId) =>
        this.rebuildRetrievalDescriptions(tenantId, docId),
      scheduleOptionalGraphIndex: (params) =>
        this.scheduleOptionalGraphIndex(params),
    });
    this.uploadWorkflow = new DocumentUploadWorkflow({
      permissionService: this.permissionService,
      logger: this.logger,
      documentTaskService: this.documentTaskService,
      docMetaRepo: this.docMetaRepo,
      metadataExtractor: this.metadataExtractor,
      graphService: this.graphService,
      documentIndexCoordinator: this.documentIndexCoordinator,
      documentImageIngestionService: this.documentImageIngestionService,
      dingTalk: this.dingTalk,
      chunkWorkflow: this.chunkWorkflow,
      saveOriginalResource: (...args) => this.saveOriginalResource(...args),
      resolveChunkStrategy: (...args) => this.resolveChunkStrategy(...args),
      cleanupFailedExternalIndexes: (...args) =>
        this.cleanupFailedExternalIndexes(...args),
      scheduleOptionalGraphIndex: (params) =>
        this.scheduleOptionalGraphIndex(params),
      updateLifecycle: (...args) => this.updateLifecycle(...args),
      rebuildRetrievalDescriptions: (tenantId, docId) =>
        this.rebuildRetrievalDescriptions(tenantId, docId),
    });
    this.recoveryWorkflow = this.createRecoveryWorkflow();
    this.documentQueueService.registerGraphIndexProcessor((job) =>
      this.processGraphIndex(job),
    );
    this.documentQueueService.registerGraphIndexFailureHandler((job, error) =>
      this.markGraphIndexFailed(job, error),
    );
  }

  private createRecoveryWorkflow(): DocumentRecoveryWorkflow {
    return new DocumentRecoveryWorkflow({
      documentImageIngestionService: this.documentImageIngestionService,
      docMetaRepo: this.docMetaRepo,
      resourceRepo: this.resourceRepo,
      objectStorageProvider: this.objectStorageProvider,
      visionProvider: this.visionProvider,
      logger: this.logger,
      speechProvider: this.speechProvider,
      documentIndexCoordinator: this.documentIndexCoordinator,
      retrievalDescriptionService: this.retrievalDescriptionService,
      factConflictRepo: this.factConflictRepo,
      docChunkRepo: this.docChunkRepo,
      buildVideoExtractionOptions: (...args) =>
        this.buildVideoExtractionOptions(...args),
      imageMimeType: (...args) => this.imageMimeType(...args),
      upload: (...args) => this.upload(...args),
      removeGraphSource: (...args) => this.removeGraphSource(...args),
    });
  }

  private getRecoveryWorkflow(): DocumentRecoveryWorkflow {
    this.recoveryWorkflow ??= this.createRecoveryWorkflow();
    return this.recoveryWorkflow;
  }

  onModuleInit(): void {
    if (!this.graphService.isEnabled() || !this.documentQueueService.enabled) {
      return;
    }
    void this.requeuePendingGraphIndexes();
    this.graphIndexRecoveryTimer = setInterval(
      () => {
        void this.requeuePendingGraphIndexes();
      },
      5 * 60 * 1000,
    );
    this.graphIndexRecoveryTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.graphIndexRecoveryTimer)
      clearInterval(this.graphIndexRecoveryTimer);
  }

  /**
   * 接收解析后的正文并创建可审计的异步入库任务。
   * `options.originalBuffer` 仅用于保留原始证据；它不会绕过提示注入和质量门禁。
   */
  async upload(
    filename: string,
    content: string,
    userId: string,
    options: UploadOptions = {},
  ): Promise<UploadResult> {
    return this.uploadWorkflow.upload(filename, content, userId, options);
  }

  /** 并发入库失败时移除可能已写入的外部检索索引，保留 PostgreSQL 草稿供排障。 */
  private async cleanupFailedExternalIndexes(
    docId: string,
    userId: string,
  ): Promise<void> {
    await this.documentIndexCoordinator.cleanupFailedExternalIndexes(
      docId,
      userId,
    );
  }

  /** 图谱用持久队列异步建立；主文档入库不等待图谱，也不因可选图谱失败回滚。 */
  private scheduleOptionalGraphIndex(params: {
    docId: string;
    userId: string;
    indexGeneration: string;
  }): void {
    if (this.documentQueueService.enabled) {
      void this.documentQueueService
        .enqueueGraphIndex(params)
        .catch((error: unknown) =>
          this.markGraphIndexFailed(
            params,
            error instanceof Error ? error : new Error(String(error)),
          ),
        );
      return;
    }

    if (this.documentQueueService.required) {
      void this.markGraphIndexFailed(
        params,
        new Error('Redis/BullMQ is required for durable graph indexing.'),
      );
      return;
    }

    // 本地开发允许没有 Redis；生产环境不会走这个进程内兜底。
    const job = new Promise<void>((resolve) => {
      const timer = setImmediate(() => {
        void this.documentQueueService
          .withGraphIndexLock(params.docId, () =>
            this.processGraphIndex(params),
          )
          .catch((error: unknown) =>
            this.markGraphIndexFailed(
              params,
              error instanceof Error ? error : new Error(String(error)),
            ),
          )
          .finally(() => {
            this.pendingGraphIndexes.delete(params.docId);
            resolve();
          });
      });
      timer.unref?.();
    });
    this.pendingGraphIndexes.set(params.docId, job);
  }

  private async processGraphIndex(job: DocumentGraphIndexJob): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (this.cancelledGraphIndexes.has(job.docId)) return;
      const document = await this.docMetaRepo.findOne({
        where: { docId: job.docId, userId: job.userId },
      });
      if (!document) {
        await this.graphService.removeSource(job.docId, job.userId);
        return;
      }

      const chunks = await this.docChunkRepo.find({
        where: {
          docId: job.docId,
          userId: job.userId,
          indexGeneration: document.indexGeneration ?? undefined,
          chunkType: 'leaf',
        },
        order: { chunkIndex: 'ASC' },
        select: ['content'],
      });
      if (chunks.length === 0) {
        throw new Error('graph indexing found no current document chunks');
      }

      const result = await this.graphService.importText(
        chunks.map((chunk) => chunk.content).join('\n\n'),
        job.userId,
        job.docId,
      );
      if (this.cancelledGraphIndexes.has(job.docId)) {
        await this.graphService.removeSource(job.docId, job.userId);
        return;
      }

      const current = await this.docMetaRepo.findOne({
        where: { docId: job.docId, userId: job.userId },
        select: ['indexGeneration'],
      });
      if (!current) {
        await this.graphService.removeSource(job.docId, job.userId);
        return;
      }
      if (current.indexGeneration !== document.indexGeneration) continue;

      await this.docMetaRepo.update(
        { docId: job.docId, userId: job.userId },
        {
          graphIndexStatus: 'indexed',
          graphIndexedAt: new Date(),
          graphIndexError: null,
        },
      );
      this.logger.log(
        `Graph index completed: docId=${job.docId}, nodes=${result.nodeCount}, relationships=${result.relationshipCount}`,
      );
      return;
    }

    throw new Error('document changed repeatedly during graph indexing');
  }

  private async markGraphIndexFailed(
    job: DocumentGraphIndexJob,
    error: Error,
  ): Promise<void> {
    const current = await this.docMetaRepo.findOne({
      where: { docId: job.docId, userId: job.userId },
      select: ['indexGeneration'],
    });
    if (!current || current.indexGeneration !== job.indexGeneration) return;

    await this.docMetaRepo.update(
      { docId: job.docId, userId: job.userId },
      { graphIndexStatus: 'failed', graphIndexError: error.message },
    );
    this.logger.warn(
      `Graph index failed without blocking document ingestion: docId=${job.docId}, error=${error.message}`,
    );
  }

  private async requeuePendingGraphIndexes(): Promise<void> {
    try {
      const pending = await this.docMetaRepo.find({
        where: { graphIndexStatus: 'pending' },
        order: { createdAt: 'ASC' },
        take: 1000,
        select: ['docId', 'userId', 'indexGeneration'],
      });
      for (const document of pending) {
        if (!document.userId || !document.indexGeneration) continue;
        await this.documentQueueService.enqueueGraphIndex({
          docId: document.docId,
          userId: document.userId,
          indexGeneration: document.indexGeneration,
        });
      }
    } catch (error) {
      this.logger.warn(
        `Pending graph index recovery scan failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async removeGraphSource(
    docId: string,
    userId: string,
  ): Promise<void> {
    this.cancelledGraphIndexes.add(docId);
    try {
      if (typeof this.documentQueueService.cancelGraphIndexes === 'function') {
        await this.documentQueueService.cancelGraphIndexes(docId);
      }
      await this.pendingGraphIndexes.get(docId);
      await this.graphService.removeSource(docId, userId);
    } catch (err) {
      this.logger.warn(
        `Graph source cleanup failed for docId=${docId}: ${(err as Error).message}`,
      );
      throw err;
    } finally {
      this.cancelledGraphIndexes.delete(docId);
    }
  }

  createQueuedTask(
    filename: string,
    userId: string,
    tenantId?: string,
  ): Promise<DocumentTaskEntity> {
    return this.documentTaskService.createQueuedTask(
      filename,
      userId,
      tenantId,
    );
  }

  getTask(taskId: string, userId: string): Promise<DocumentTaskEntity | null> {
    return this.documentTaskService.getTask(taskId, userId);
  }

  getPendingTasks(limit = 50) {
    return this.documentTaskService.getPendingTasks(limit);
  }

  cancelQueuedTask(taskId: string) {
    return this.documentTaskService.cancelQueuedTask(taskId);
  }

  getFailedTasks(limit = 50): Promise<DocumentTaskEntity[]> {
    return this.documentTaskService.getFailedTasks(limit);
  }

  /** 暴露已恢复到当前进程的补偿记录和本地索引任务状态。 */
  async getIndexCompensationStatus() {
    const status =
      await this.documentIndexCoordinator.getMilvusDeleteCompensationStatus();
    return {
      pendingDurable: status.pendingDurable,
      pendingMilvusDeletes: status.pendingMilvusDeletes,
      pendingMilvusDeleteCount: status.pendingMilvusDeleteCount,
      pendingGraphIndexCount: this.pendingGraphIndexes.size,
      note: status.note,
    };
  }

  async retryFailedTask(taskId: string) {
    return this.documentTaskService.retryFailedTask(taskId);
  }

  async hasDoc(docId: string, userId: string): Promise<boolean> {
    const count = await this.docMetaRepo.count({ where: { docId, userId } });
    return count > 0;
  }

  getAllowedDocIdsForUser(
    userId: string,
    tenantId?: string,
    roles: string[] = [],
    trustedAdminPrincipal = false,
  ): Promise<Set<string>> {
    return this.permissionService.getAllowedDocIds(
      userId,
      roles,
      [],
      tenantId,
      trustedAdminPrincipal,
    );
  }

  /** Rebuild the optional image index from the saved source without changing document chunks or ACL. */
  async rebuildImageIndexFromOriginal(docId: string): Promise<{
    indexed: boolean;
    assetCount: number;
    reason?: string;
  }> {
    return this.getRecoveryWorkflow().rebuildImageIndexFromOriginal(docId);
  }

  async markTaskFailed(taskId: string, errorMessage: string): Promise<void> {
    return this.documentTaskService.markTaskFailed(taskId, errorMessage);
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

  /** PostgreSQL 分块缺失时，从已保存的原件走正常入库链路恢复。 */
  async restoreDocumentFromOriginal(
    docId: string,
  ): Promise<UploadResult | null> {
    return this.getRecoveryWorkflow().restoreDocumentFromOriginal(docId);
  }

  /**
   * 删除文档：Milvus chunks + BM25 索引 + ES + 数据库元数据
   */
  async delete(docId: string, userId: string): Promise<void> {
    return this.getRecoveryWorkflow().delete(docId, userId);
  }

  private imageMimeType(filename: string): string {
    const extension = filename.split('.').pop()?.toLowerCase();
    if (extension === 'png') return 'image/png';
    if (extension === 'gif') return 'image/gif';
    if (extension === 'webp') return 'image/webp';
    if (extension === 'bmp') return 'image/bmp';
    return 'image/jpeg';
  }

  private buildVideoExtractionOptions(
    filename: string,
    docId: string,
    userId: string,
  ): DocumentVideoExtractionOptions {
    const capabilities = this.visionProvider?.getCapabilities();
    return {
      storage: this.objectStorageProvider,
      asr: this.speechProvider?.isEnabled() ? this.speechProvider : undefined,
      vision: capabilities?.imageUnderstanding
        ? this.visionProvider
        : undefined,
      docId,
      ownerUserId: userId,
      filename,
      urlResolver: (stored) =>
        `/api/v1/documents/assets/image?key=${encodeURIComponent(stored.key)}`,
    };
  }

  private async saveOriginalResource(params: {
    docId: string;
    taskId: string;
    userId: string;
    tenantId?: string;
    filename: string;
    buffer: Buffer;
    contentType?: string;
  }): Promise<string> {
    const key = [
      'documents',
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
        tenantId: params.tenantId ?? 'legacy',
        docId: params.docId,
        taskId: params.taskId,
        userId: params.userId,
        kind: 'original',
        filename: params.filename,
        objectKey: stored.key,
        url: this.proxyResourceUrlIfImage(
          stored.key,
          stored.url,
          params.contentType,
        ),
        contentType: params.contentType ?? null,
        size: params.buffer.length,
      }),
    );
    return this.proxyResourceUrlIfImage(
      stored.key,
      stored.url,
      params.contentType,
    );
  }

  private proxyResourceUrlIfImage(
    key: string,
    fallbackUrl: string,
    contentType?: string,
  ): string {
    if (!contentType?.startsWith('image/')) return fallbackUrl;
    return `/api/v1/documents/assets/image?key=${encodeURIComponent(key)}`;
  }

  private async resolveChunkStrategy(
    business: GameDocumentMetadata,
  ): Promise<{ chunkSize: number; chunkOverlap: number }> {
    const keys = [business.projectId, business.documentType].filter(
      Boolean,
    ) as string[];
    for (const key of keys) {
      const profile = await this.knowledgeBaseProfileRepo.findOne({
        where: { key, status: 'enabled', workspaceId: 'default' },
      });
      if (profile)
        return {
          chunkSize: profile.chunkSize,
          chunkOverlap: profile.chunkOverlap,
        };
    }
    return getChunkStrategy(business.documentType);
  }

  async getDocMeta(
    docId: string,
    userId: string,
    tenantId?: string,
  ): Promise<DocMeta | undefined> {
    if (tenantId?.trim()) {
      const allowedDocIds = await this.permissionService.getAllowedDocIds(
        userId,
        [],
        [],
        tenantId,
      );
      if (allowedDocIds.has(docId) === false) return undefined;
    }
    const meta = tenantId?.trim()
      ? await this.docMetaRepo.findOne({ where: { docId } })
      : await this.docMetaRepo.findOne({ where: { docId, userId } });
    if (meta == null) return undefined;
    return this.toDocMeta(meta);
  }

  async listDocs(userId: string, tenantId?: string): Promise<DocMeta[]> {
    let list: DocumentMetaEntity[];
    if (tenantId?.trim()) {
      const allowedDocIds = await this.permissionService.getAllowedDocIds(
        userId,
        [],
        [],
        tenantId,
      );
      if (allowedDocIds.size === 0) return [];
      list = await this.docMetaRepo.find({
        where: { docId: In([...allowedDocIds]) },
        order: { createdAt: 'DESC' },
      });
    } else {
      list = await this.docMetaRepo.find({
        where: { userId },
        order: { createdAt: 'DESC' },
      });
    }
    return list.map((meta) => this.toDocMeta(meta, true));
  }

  private toDocMeta(
    meta: DocumentMetaEntity,
    includeMetadata = false,
  ): DocMeta {
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
        ? (JSON.parse(meta.chunkStrategy) as {
            chunkSize: number;
            chunkOverlap: number;
          })
        : undefined,
      metadata:
        includeMetadata && meta.title
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
    };
  }

  private buildHypotheticalQuestions(
    content: string,
    headingPath?: string[],
  ): string[] {
    return this.chunkWorkflow.buildHypotheticalQuestions(content, headingPath);
  }

  private async applyIncrementalChunkUpdate(input: {
    docId: string;
    userId: string;
    tenantId: string;
    filename: string;
    content: string;
    contentSha256: string;
    indexGeneration: string;
    chunkDocs: IncrementalChunkDraft[];
    governance: DocumentGovernanceMetadata;
    taskId: string;
    options: UploadOptions;
  }): Promise<UploadResult> {
    return this.chunkWorkflow.applyIncrementalChunkUpdate(input);
  }

  private async saveChunkMetadata(
    docId: string,
    userId: string,
    records: Array<{
      id: string;
      content: string;
      chunkIndex: number;
      tenantId: string;
      contentHash: string;
      indexGeneration: string;
    }>,
    chunks: Awaited<ReturnType<MarkdownChunker['splitStructured']>>,
    governance: DocumentGovernanceMetadata,
    hypotheticalQuestions: string[][],
    tenantId: string,
    indexGeneration: string,
  ): Promise<void> {
    return this.chunkWorkflow.saveChunkMetadata(
      docId,
      userId,
      records,
      chunks,
      governance,
      hypotheticalQuestions,
      tenantId,
      indexGeneration,
    );
  }

  private async deprecateSupersededDocument(
    docId: string,
    userId: string,
  ): Promise<void> {
    return this.chunkWorkflow.deprecateSupersededDocument(docId, userId);
  }

  private async detectAndSaveFactConflicts(
    docId: string,
    userId: string,
    records: Array<{ id: string; content: string }>,
    governance: DocumentGovernanceMetadata,
  ): Promise<void> {
    return this.chunkWorkflow.detectAndSaveFactConflicts(
      docId,
      userId,
      records,
      governance,
    );
  }

  private detectChunkConflicts(content: string): FactConflictDraft[] {
    return this.chunkWorkflow.detectChunkConflicts(content);
  }

  private extractConflictSubject(content: string): string {
    return this.chunkWorkflow.extractConflictSubject(content);
  }

  private extractGovernanceMetadata(
    filename: string,
    content: string,
  ): Omit<DocumentGovernanceMetadata, keyof GameDocumentMetadata> {
    return this.chunkWorkflow.extractGovernanceMetadata(filename, content);
  }

  private extractDocVersion(filename: string, content: string): string | null {
    return this.chunkWorkflow.extractDocVersion(filename, content);
  }

  private extractDate(text: string, pattern: RegExp): Date | null {
    return this.chunkWorkflow.extractDate(text, pattern);
  }

  private resolveRuleKey(
    chunk:
      | { sectionId?: string | null; headingPath?: string[] | null }
      | undefined,
    index: number,
  ): string {
    return this.chunkWorkflow.resolveRuleKey(chunk, index);
  }

  private resolveChunkValidity(
    content: string,
    effectiveAt: Date | null,
    expiredAt: Date | null,
    validityMonths?: number,
  ): { effectiveAt: Date | null; expiredAt: Date | null } {
    return this.chunkWorkflow.resolveChunkValidity(
      content,
      effectiveAt,
      expiredAt,
      validityMonths,
    );
  }

  private extractValidityMonths(content: string): number | null {
    return this.chunkWorkflow.extractValidityMonths(content);
  }

  private parseDateOverride(value?: string | null): Date | null {
    return this.chunkWorkflow.parseDateOverride(value);
  }

  private extractSourceAuthority(filename: string, content: string): string {
    return this.chunkWorkflow.extractSourceAuthority(filename, content);
  }

  private mergeBusinessMetadata(
    detected: GameDocumentMetadata,
    explicit?: DocumentBusinessMetadata,
  ): ResolvedDocumentBusinessMetadata {
    return this.chunkWorkflow.mergeBusinessMetadata(detected, explicit);
  }

  /**
   * 审批门禁开关（DOCUMENT_REQUIRE_APPROVAL=true）：新文档一律先落 draft。
   * draft 不进入任何检索口径（ES 分块/文档检索、本地 BM25、Milvus 向量通道均已过滤），
   * 由管理后台审核提升为 effective 后自动可见；显式指定 lifecycleStatus 同样被拦下，避免绕过审批。
   */
  private applyApprovalGate(
    lifecycleStatus: DocumentLifecycleStatus,
  ): DocumentLifecycleStatus {
    return this.chunkWorkflow.applyApprovalGate(lifecycleStatus);
  }

  async updateLifecycle(
    docId: string,
    userId: string,
    lifecycleStatus: DocumentLifecycleStatus,
    event?: DomainEventInput,
  ): Promise<boolean> {
    const document = await this.docMetaRepo.findOne({
      where: { docId, userId },
    });
    if (!document) return false;
    await this.docMetaRepo.manager.transaction(async (manager) => {
      await Promise.all([
        manager
          .getRepository(DocumentMetaEntity)
          .update({ docId, userId }, { lifecycleStatus }),
        manager
          .getRepository(DocumentChunkEntity)
          .update({ docId, userId }, { lifecycleStatus }),
      ]);
      if (event) await this.domainEvents.emitInTransaction(manager, event);
    });
    await this.documentIndexCoordinator.updateDocumentLifecycle(
      docId,
      lifecycleStatus,
      userId,
    );
    await this.rebuildRetrievalDescriptions(
      document.tenantId ?? 'legacy',
      docId,
    );
    return true;
  }

  async activateVersion(
    docId: string,
    userId: string,
    versionDocIds: string[],
    event?: DomainEventInput,
  ): Promise<boolean> {
    const docIds = [...new Set(versionDocIds)];
    if (!docIds.includes(docId)) return false;

    const documents = await this.docMetaRepo.find({
      where: { docId: In(docIds), userId },
    });
    const target = documents.find((document) => document.docId === docId);
    if (
      !target ||
      target.chunkCount < 1 ||
      documents.length !== docIds.length
    ) {
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
        docMetaRepo.update({ docId, userId }, { lifecycleStatus: 'effective' }),
        docChunkRepo.update(
          { docId, userId },
          { lifecycleStatus: 'effective' },
        ),
      ]);
      if (event) await this.domainEvents.emitInTransaction(manager, event);
    });

    for (const id of deprecatedDocIds) {
      await this.documentIndexCoordinator.updateElasticsearchDocumentLifecycle(
        id,
        'deprecated',
        userId,
      );
      this.documentIndexCoordinator.updateBm25DocumentLifecycle(
        id,
        'deprecated',
        userId,
      );
    }
    await this.documentIndexCoordinator.updateElasticsearchDocumentLifecycle(
      docId,
      'effective',
      userId,
    );
    this.documentIndexCoordinator.updateBm25DocumentLifecycle(
      docId,
      'effective',
      userId,
    );
    for (const document of documents) {
      await this.rebuildRetrievalDescriptions(
        document.tenantId ?? 'legacy',
        document.docId,
      );
    }
    return true;
  }

  private async rebuildRetrievalDescriptions(
    tenantId: string,
    docId: string,
  ): Promise<void> {
    try {
      await this.retrievalDescriptionService.rebuild({ tenantId, docId });
    } catch (err) {
      this.logger.warn(
        `Retrieval description rebuild failed for docId=${docId}: ${(err as Error).message}`,
      );
    }
  }
}
