import {
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { createHash, randomUUID } from 'node:crypto';
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
import { DocumentTaskService } from './document-task.service';
import { DocumentImageIngestionService } from './document-image-ingestion.service';
import { DocumentIndexCoordinator } from './document-index-coordinator.service';
import { DocumentRetrievalDescriptionService } from './document-retrieval-description.service';
import {
  detectDocumentKind,
  extractDocumentText,
} from './document-parser.util';
import { DingTalkProvider } from '../../providers/notify/dingtalk.provider';
import {
  assessIngestionQuality,
  detectGameDocumentMetadata,
  DocumentLifecycleStatus,
  GameDocumentMetadata,
  DocumentBusinessMetadata,
  DocumentChangeType,
  ResolvedDocumentBusinessMetadata,
  GameDocumentType,
  getChunkStrategy,
  IngestionQualityReport,
} from './document-profile.util';
import { DomainEventsService } from '../domain-events/domain-events.service';
import type { DomainEventInput } from '../domain-events/domain-events.service';

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
  imageIndex?: { indexed: boolean; assetCount: number; reason?: string };
  supersedesDocId?: string | null;
  ingestionQuality?: IngestionQualityReport;
  chunkStrategy?: { chunkSize: number; chunkOverlap: number };
  incremental?: {
    added: number;
    changed: number;
    removed: number;
    unchanged: number;
    embedded: number;
  };
  metadata?: {
    title: string;
    author: string;
    summary: string;
    keywords: string[];
    language: string;
    category: string;
  };
}

type IncrementalChunkDraft = {
  id: string;
  content: string;
  docId: string;
  chunkIndex: number;
  userId: string;
  tenantId: string;
  contentHash: string;
  indexGeneration: string;
  parentChunkId: string | null;
  headingPath: string[];
  sectionId: string | null;
  clauseId: string | null;
  tableRef: string | null;
  sourceStart: number | null;
  sourceEnd: number | null;
  ruleKey: string | null;
  changeType: string;
  supersedesChunkId: string | null;
  docVersion: string | null;
  effectiveAt: Date | null;
  expiredAt: Date | null;
  sourceAuthority: string;
  projectId: string | null;
  activityId: string | null;
  region: string | null;
  locale: string | null;
  channel: string | null;
  roleScope: string[];
  documentType: string;
  lifecycleStatus: string;
  reviewStatus: string;
  supersedesDocId: string | null;
  hypotheticalQuestions: string[];
};

export interface UploadOptions {
  docId?: string;
  taskId?: string;
  /** 修复已有文档时保留当前 ACL 和人工维护的元数据。 */
  preservePermissions?: boolean;
  /** 同一 docId 的 chunk 级增量更新；只重算新增/变化的 chunk。 */
  incrementalUpdate?: boolean;
  preserveExistingMetadata?: boolean;
  awaitImageIndex?: boolean;
  /** Worker／跨服务调用携带的租户上下文；持久化租户列仍需后续迁移补齐。 */
  tenantId?: string;
  /** Internal Admin bridge only; the caller must be authenticated by ServiceTokenGuard. */
  trustedAdminPrincipal?: boolean;
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
 * 文档入库编排服务。
 *
 * 固定顺序为：安全扫描／质量门禁 → 结构化父子切块 → 生成向量 → 多存储并发写入。
 * PostgreSQL 始终先以 draft（草稿）状态落库；只有索引成功且通过后续治理流程，
 * 才会被提升为可检索版本。任一必要写入失败会触发外部索引补偿清理。
 */
@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);
  private readonly pendingGraphIndexes = new Map<string, Promise<void>>();
  private readonly cancelledGraphIndexes = new Set<string>();

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
  ) {}

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
    await this.permissionService.assertTenant(
      userId,
      options.tenantId,
      options.trustedAdminPrincipal,
    );
    const docId = options.docId ?? randomUUID();
    const taskId = options.taskId ?? randomUUID();
    this.logger.log(`Uploading ${filename}, docId=${docId}, userId=${userId}`);
    await this.documentTaskService.upsertTask(taskId, {
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
          tenantId: options.tenantId,
          filename,
          buffer: options.originalBuffer,
          contentType: options.contentType,
        });
      }

      // 安全门禁必须在切块与索引之前：高风险内容只能保留原始证据供人工审核，
      // 不能进入任何可被检索或被模型读取的存储。
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
            tenantId: options.tenantId,
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
      const hypotheticalQuestions = structuredChunks.map((chunk) =>
        this.buildHypotheticalQuestions(chunk.content, chunk.headingPath),
      );
      const chunks = structuredChunks.map((chunk) => chunk.content);
      const ingestionQuality = assessIngestionQuality(
        content,
        structuredChunks,
      );
      const contentSha256 = createHash('sha256').update(content).digest('hex');
      const indexGeneration = createHash('sha256')
        .update(`${docId}:${contentSha256}:${business.docVersion ?? ''}`)
        .digest('hex');
      const existingDocs = await this.docMetaRepo.find({ where: { userId } });
      const duplicate = existingDocs.find((item) => {
        try {
          return (
            JSON.parse(item.ingestionQuality ?? '{}').contentSha256 ===
            contentSha256
          );
        } catch {
          return false;
        }
      });
      if (duplicate && duplicate.docId !== docId) {
        ingestionQuality.warnings.push(
          `检测到与文档 ${duplicate.docId} 内容相同的版本`,
        );
      }
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
        // 自动识别结果提供默认值；调用方传入的业务字段优先，并单独解析版本有效期。
        ...extractedGovernance,
        ...business,
        docVersion: business.docVersion ?? extractedGovernance.docVersion,
        effectiveAt:
          this.parseDateOverride(business.effectiveAt) ??
          extractedGovernance.effectiveAt,
        expiredAt:
          this.parseDateOverride(business.expiredAt) ??
          extractedGovernance.expiredAt,
        changeType: business.changeType ?? 'standalone',
        validityMonths: business.validityMonths,
      };
      if (!ingestionQuality.accepted) {
        throw new Error('document failed ingestion quality gate');
      }
      this.logger.log(`Split into ${chunks.length} chunks`);
      // 入库阶段统一先写 draft；若治理元数据指定了其它状态，主索引完成后再切换。
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
        tenantId: options.tenantId ?? 'legacy',
        contentHash: createHash('sha256').update(chunk).digest('hex'),
        indexGeneration,
      }));
      const chunkDocs = chunks.map((chunk, idx) => ({
        id: records[idx].id,
        content: chunk,
        docId,
        chunkIndex: idx,
        userId,
        tenantId: options.tenantId ?? 'legacy',
        contentHash: createHash('sha256').update(chunk).digest('hex'),
        indexGeneration,
        parentChunkId: structuredChunks[idx]?.parentChunkId ?? null,
        headingPath: structuredChunks[idx]?.headingPath ?? [],
        sectionId: structuredChunks[idx]?.sectionId ?? null,
        clauseId: structuredChunks[idx]?.clauseId ?? null,
        tableRef: structuredChunks[idx]?.tableRef ?? null,
        sourceStart: structuredChunks[idx]?.sourceStart ?? null,
        sourceEnd: structuredChunks[idx]?.sourceEnd ?? null,
        ruleKey: this.resolveRuleKey(structuredChunks[idx], idx),
        changeType: governance.changeType ?? 'standalone',
        supersedesChunkId: null,
        docVersion: indexingGovernance.docVersion,
        effectiveAt: this.resolveChunkValidity(
          chunk,
          governance.effectiveAt,
          governance.expiredAt,
          governance.validityMonths,
        ).effectiveAt,
        expiredAt: this.resolveChunkValidity(
          chunk,
          governance.effectiveAt,
          governance.expiredAt,
          governance.validityMonths,
        ).expiredAt,
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
        hypotheticalQuestions: hypotheticalQuestions[idx],
      }));
      if (options.incrementalUpdate) {
        return this.applyIncrementalChunkUpdate({
          docId,
          userId,
          tenantId: options.tenantId ?? 'legacy',
          filename,
          content,
          contentSha256,
          indexGeneration,
          chunkDocs,
          governance,
          taskId,
          options,
        });
      }

      // 标题、摘要等 LLM 元数据是增强信息；失败记为缺失，不阻断正文索引。
      const metadataPromise = options.preserveExistingMetadata
        ? Promise.resolve(null)
        : this.metadataExtractor.extract(content).catch((err) => {
            this.logger.warn(
              `Metadata extraction failed: ${(err as Error).message}`,
            );
            return null;
          });

      const docMeta = this.docMetaRepo.create({
        docId,
        tenantId: options.tenantId ?? 'legacy',
        filename,
        contentHash: contentSha256,
        indexGeneration,
        changeType: governance.changeType ?? 'standalone',
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
        ingestionQuality: JSON.stringify({
          ...ingestionQuality,
          contentSha256,
        }),
        chunkStrategy: JSON.stringify(strategy),
        graphIndexStatus: this.graphService.isEnabled() ? 'pending' : 'skipped',
      });

      // 嵌入提前到并行入库之前：同一条向量既要写 Milvus，也要随 chunk 写入 ES（dense_vector kNN 通道）。
      // 失败语义与原先一致：嵌入失败 => 清理外部索引并整体入库失败（原先对应 allSettled 首分支拒绝路径）。
      await this.documentTaskService.updateTask(taskId, {
        stage: 'embedding',
        progress: 30,
      });
      let vectors: number[][];
      try {
        vectors = await this.documentIndexCoordinator.embedChunks(chunks);
      } catch (embeddingErr) {
        await this.cleanupFailedExternalIndexes(docId, userId);
        throw embeddingErr;
      }
      await this.documentTaskService.updateTask(taskId, {
        stage: 'vector_index',
        progress: 50,
      });

      // 四个必要落点彼此独立，因此并发降低等待时间；allSettled 用于收集所有结果，
      // 以便后续对已成功的外部索引做一致的补偿清理。
      const indexResults = await Promise.allSettled([
        this.documentIndexCoordinator.writeDocumentIndexes({
          records,
          chunks: chunkDocs,
          userId,
          vectors,
          document: {
            docId,
            filename,
            content,
            userId,
            tenantId: options.tenantId ?? 'legacy',
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
            contentHash: contentSha256,
            indexGeneration,
            effectiveAt: indexingGovernance.effectiveAt,
            expiredAt: indexingGovernance.expiredAt,
          },
        }),
        (async () => {
          await this.docMetaRepo.save(docMeta);
          if (!options.preservePermissions) {
            await this.permissionService.grantOwner(docId, userId);
          }
          await this.saveChunkMetadata(
            docId,
            userId,
            records,
            structuredChunks,
            indexingGovernance,
            hypotheticalQuestions,
            options.tenantId ?? 'legacy',
            indexGeneration,
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
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected',
      );
      if (failedIndex) {
        await this.cleanupFailedExternalIndexes(docId, userId);
        throw failedIndex.reason;
      }

      // 图片检索是可选索引：文档中的本地图片资产与原始图片统一替换为完整集合。
      let imageIndexResult: UploadResult['imageIndex'];
      if (this.documentImageIngestionService.isEnabled()) {
        const imageIndexPromise = this.documentImageIngestionService.indexDocumentImages({
          docId,
          userId,
          filename,
          content,
          originalUrl,
          originalBuffer: options.originalBuffer,
        });
        const handleImageIndexError = (err: Error) =>
          this.logger.warn(
            `Image index failed for docId=${docId}: ${err.message}`,
          );
        if (options.awaitImageIndex) {
          try {
            const assetCount = await imageIndexPromise;
            imageIndexResult = { indexed: true, assetCount };
          } catch (err) {
            const error = err as Error;
            handleImageIndexError(error);
            imageIndexResult = {
              indexed: false,
              assetCount: 0,
              reason: error.message,
            };
          }
        } else {
          void imageIndexPromise.catch(handleImageIndexError);
        }
      }
      const graphIndexStatus: GraphIndexStatus = this.graphService.isEnabled()
        ? 'pending'
        : 'skipped';
      if (graphIndexStatus === 'pending') {
        this.scheduleOptionalGraphIndex({ docId, userId, content });
      }
      await this.documentTaskService.updateTask(taskId, {
        stage: 'metadata',
        progress: 80,
      });

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

      // 描述索引依赖 PostgreSQL 中已保存的摘要和原文块，因此必须在元数据落库后构建。
      // 非 draft 文档由生命周期更新统一重建，避免同一文档重复生成向量。
      if (governance.lifecycleStatus !== 'draft') {
        await this.updateLifecycle(docId, userId, governance.lifecycleStatus);
      } else {
        await this.rebuildRetrievalDescriptions(
          options.tenantId ?? 'legacy',
          docId,
        );
      }

      await this.documentTaskService.updateTask(taskId, {
        status: 'completed',
        stage: 'completed',
        progress: 100,
        chunkCount: chunks.length,
        finishedAt: new Date(),
      });

      this.logger.log(
        `Upload done: docId=${docId}, chunks=${
          chunks.length
        }, esEnabled=${this.documentIndexCoordinator.isElasticsearchEnabled()}`,
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
        ...(imageIndexResult ? { imageIndex: imageIndexResult } : {}),
        supersedesDocId: governance.supersedesDocId,
        ingestionQuality,
        chunkStrategy: strategy,
        metadata: metadata || undefined,
      };
    } catch (err) {
      const message = (err as Error).message;
      await this.documentTaskService.updateTask(taskId, {
        status: 'failed',
        stage: message.startsWith('document quarantined for security review:')
          ? 'security_review'
          : 'failed',
        errorMessage: message,
        finishedAt: new Date(),
      });
      // 钉钉告警（fire-and-forget）
      void this.dingTalk?.notifyAlert(
        `document.failed:${taskId}`,
        `**文档入库任务失败**（taskId：\`${taskId}\`）\n\n错误：${message.slice(0, 300)}`,
      );
      throw err;
    }
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

  private async removeGraphSource(
    docId: string,
    userId: string,
  ): Promise<void> {
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
    tenantId?: string,
  ): Promise<DocumentTaskEntity> {
    return this.documentTaskService.createQueuedTask(filename, userId, tenantId);
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
    if (!this.documentImageIngestionService.isEnabled()) {
      return {
        indexed: false,
        assetCount: 0,
        reason: 'image embedding disabled',
      };
    }
    const document = await this.docMetaRepo.findOne({ where: { docId } });
    if (!document) {
      return { indexed: false, assetCount: 0, reason: 'document not found' };
    }
    const original = await this.resourceRepo.findOne({
      where: { docId, kind: 'original' },
      order: { createdAt: 'DESC' },
    });
    if (!original) {
      return {
        indexed: false,
        assetCount: 0,
        reason: 'original document resource not found',
      };
    }

    const kind = detectDocumentKind(original.filename);
    try {
      const buffer = await this.objectStorageProvider.getObject(
        original.objectKey,
      );
      const content = await extractDocumentText(
        buffer,
        kind,
        undefined,
        kind === 'pdf' || kind === 'pptx'
          ? this.documentImageIngestionService.buildImageExtractionOptions(
              docId,
              document.userId ?? 'system',
            )
          : undefined,
      );
      const assetCount = await this.documentImageIngestionService.indexDocumentImages({
        docId,
        userId: document.userId ?? 'system',
        filename: original.filename,
        content,
        originalUrl: original.url,
        originalBuffer: buffer,
      });
      return { indexed: true, assetCount };
    } catch (error) {
      const reason = (error as Error).message;
      this.logger.warn(
        `Image index rebuild failed for docId=${docId}: ${reason}`,
      );
      return { indexed: false, assetCount: 0, reason };
    }
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
  async restoreDocumentFromOriginal(docId: string): Promise<UploadResult | null> {
    const document = await this.docMetaRepo.findOne({ where: { docId } });
    if (!document) return null;
    const original = await this.resourceRepo.findOne({
      where: { docId, kind: 'original' },
      order: { createdAt: 'DESC' },
    });
    if (!original) throw new Error('original document resource not found');

    const userId = document.userId ?? 'system';
    const buffer = await this.objectStorageProvider.getObject(
      original.objectKey,
    );
    const content = (
      await extractDocumentText(
        buffer,
        detectDocumentKind(original.filename),
        undefined,
        this.documentImageIngestionService.buildImageExtractionOptions(
          docId,
          userId,
        ),
      )
    )
      .replace(/\0/g, '')
      .trim();
    if (!content) throw new Error('original document has no extractable text');

    const roleScope = (() => {
      try {
        const parsed: unknown = JSON.parse(document.roleScope ?? '[]');
        return Array.isArray(parsed)
          ? parsed.filter((item): item is string => typeof item === 'string')
          : [];
      } catch {
        return [];
      }
    })();
    this.documentIndexCoordinator.removeBm25Chunks(docId, userId);

    const result = await this.upload(original.filename, content, userId, {
      docId,
      tenantId: document.tenantId ?? 'legacy',
      contentType: original.contentType ?? undefined,
      preservePermissions: true,
      preserveExistingMetadata: true,
      awaitImageIndex: true,
      businessMetadata: {
        projectId: document.projectId,
        activityId: document.activityId,
        region: document.region,
        locale: document.locale,
        channel: document.channel,
        roleScope,
        documentType: document.documentType as GameDocumentType,
        lifecycleStatus: document.lifecycleStatus as DocumentLifecycleStatus,
        supersedesDocId: document.supersedesDocId,
        docVersion: document.docVersion,
        effectiveAt: document.effectiveAt?.toISOString() ?? null,
        expiredAt: document.expiredAt?.toISOString() ?? null,
      },
    });
    return result;
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
    await this.documentIndexCoordinator.removeVectorIndex(docId);

    // 描述向量清理失败时停止删除原文，避免留下无法追溯的检索入口。
    await this.retrievalDescriptionService.deleteForDocument({
      tenantId: meta.tenantId ?? 'legacy',
      docId,
    });

    // 2. 删除 BM25 内存索引 + JSON 持久化更新；3. 删除 Elasticsearch 索引（ES 未启用时自动跳过）
    await this.documentIndexCoordinator.removeSearchIndexes(docId, userId);

    // 3.5 文搜图：清理图片向量库（未启用/失败不阻塞删除主流程）
    try {
      await this.documentImageIngestionService.deleteByDoc(docId, userId);
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
      const allowedDocIds =
        await this.permissionService.getAllowedDocIds(
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
      const allowedDocIds =
        await this.permissionService.getAllowedDocIds(
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

  private toDocMeta(meta: DocumentMetaEntity, includeMetadata = false): DocMeta {
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
    const text = content.replace(/\s+/g, ' ').trim();
    if (!text) return [];
    const topic =
      headingPath?.filter(Boolean).slice(-1)[0] ?? text.slice(0, 48);
    const questions = [
      `${topic} 的核心内容是什么？`,
      `如何理解或使用 ${topic}？`,
    ];
    return questions.filter(
      (question, index) => index === 0 || text.length > 80,
    );
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
    const existing = await this.docMetaRepo.findOne({
      where: { docId: input.docId, userId: input.userId },
    });
    if (existing === null) {
      throw new Error(
        'incremental update requires an existing document with the same docId',
      );
    }
    const oldChunks = await this.docChunkRepo.find({
      where: { docId: input.docId, userId: input.userId },
      order: { chunkIndex: 'ASC' },
    });
    if (oldChunks.length === 0) {
      throw new Error(
        'incremental update requires existing chunks; use the normal upload path first',
      );
    }
    const now = new Date();
    const requestedChangeType =
      input.options.businessMetadata?.changeType ?? 'amend';
    const effectiveAt = input.governance.effectiveAt ?? now;
    const activeOld = oldChunks.filter((chunk) => {
      if (chunk.expiredAt === null || chunk.expiredAt === undefined) {
        return true;
      }
      return new Date(chunk.expiredAt).getTime() > now.getTime();
    });
    const oldByHash = new Map<string, DocumentChunkEntity[]>();
    for (const chunk of activeOld) {
      if (chunk.contentHash === null || chunk.contentHash === undefined) {
        continue;
      }
      const list = oldByHash.get(chunk.contentHash) ?? [];
      list.push(chunk);
      oldByHash.set(chunk.contentHash, list);
    }
    const oldByRule = new Map<string, DocumentChunkEntity[]>();
    const oldByIndex = new Map<string, DocumentChunkEntity[]>();
    for (const chunk of activeOld) {
      const key = chunk.ruleKey || chunk.sectionId || `chunk-${chunk.chunkIndex}`;
      const list = oldByRule.get(key) ?? [];
      list.push(chunk);
      oldByRule.set(key, list);
      const indexKey = String(chunk.chunkIndex);
      const indexList = oldByIndex.get(indexKey) ?? [];
      indexList.push(chunk);
      oldByIndex.set(indexKey, indexList);
    }
    for (const list of oldByRule.values()) {
      list.sort(
        (left, right) =>
          new Date(right.effectiveAt ?? right.createdAt).getTime() -
          new Date(left.effectiveAt ?? left.createdAt).getTime(),
      );
    }
    for (const list of oldByIndex.values()) {
      list.sort(
        (left, right) =>
          new Date(right.effectiveAt ?? right.createdAt).getTime() -
          new Date(left.effectiveAt ?? left.createdAt).getTime(),
      );
    }
    const consumed = new Set<string>();
    const expireIds = new Set<string>();
    const newDrafts: IncrementalChunkDraft[] = [];
    let unchanged = 0;

    const pickOldByHash = (
      contentHash: string,
    ): DocumentChunkEntity | undefined => {
      const list = oldByHash.get(contentHash) ?? [];
      const candidate = list.find((chunk) => consumed.has(chunk.id) === false);
      if (candidate) consumed.add(candidate.id);
      return candidate;
    };

    const pickOldByRule = (
      ruleKey: string,
      chunkIndex: number,
    ): DocumentChunkEntity | undefined => {
      const list = oldByRule.get(ruleKey) ?? [];
      const candidate =
        list.find((chunk) => consumed.has(chunk.id) === false) ??
        (oldByIndex.get(String(chunkIndex)) ?? []).find(
          (chunk) => consumed.has(chunk.id) === false,
        );
      if (candidate) consumed.add(candidate.id);
      return candidate;
    };

    if (requestedChangeType === 'deprecate') {
      for (const chunk of activeOld) expireIds.add(chunk.id);
    } else if (requestedChangeType === 'supplement') {
      for (const draft of input.chunkDocs) {
        const sameContent = pickOldByHash(draft.contentHash);
        if (sameContent) {
          unchanged += 1;
          continue;
        }
        const old = pickOldByRule(
          draft.ruleKey || draft.sectionId || `chunk-${draft.chunkIndex}`,
          draft.chunkIndex,
        );
        if (old) expireIds.delete(old.id);
        newDrafts.push({
          ...draft,
          changeType: 'supplement',
          supersedesChunkId: old?.id ?? null,
          effectiveAt: draft.effectiveAt ?? effectiveAt,
        });
      }
    } else if (requestedChangeType === 'replace') {
      for (const chunk of activeOld) expireIds.add(chunk.id);
      for (const draft of input.chunkDocs) {
        const old = pickOldByRule(
          draft.ruleKey || draft.sectionId || `chunk-${draft.chunkIndex}`,
          draft.chunkIndex,
        );
        newDrafts.push({
          ...draft,
          changeType: 'replace',
          supersedesChunkId: old?.id ?? null,
          effectiveAt: draft.effectiveAt ?? effectiveAt,
        });
      }
    } else {
      for (const draft of input.chunkDocs) {
        const sameContent = pickOldByHash(draft.contentHash);
        if (sameContent) {
          unchanged += 1;
          continue;
        }
        const old = pickOldByRule(
          draft.ruleKey || draft.sectionId || `chunk-${draft.chunkIndex}`,
          draft.chunkIndex,
        );
        if (old) expireIds.add(old.id);
        newDrafts.push({
          ...draft,
          changeType: requestedChangeType,
          supersedesChunkId: old?.id ?? null,
          effectiveAt: draft.effectiveAt ?? effectiveAt,
        });
      }
      for (const chunk of activeOld) {
        if (consumed.has(chunk.id) === false) expireIds.add(chunk.id);
      }
    }

    const newEntities = newDrafts.map((draft) =>
      this.docChunkRepo.create({
        id: draft.id,
        tenantId: input.tenantId,
        docId: input.docId,
        userId: input.userId,
        parentChunkId: draft.parentChunkId,
        chunkIndex: draft.chunkIndex,
        chunkType: 'leaf',
        content: draft.content,
        contentHash: draft.contentHash,
        indexGeneration: input.indexGeneration,
        ruleKey: draft.ruleKey,
        changeType: draft.changeType,
        supersedesChunkId: draft.supersedesChunkId,
        headingPath:
          draft.headingPath.length > 0
            ? JSON.stringify(draft.headingPath)
            : null,
        sectionId: draft.sectionId,
        clauseId: draft.clauseId,
        tableRef: draft.tableRef,
        sourceStart: draft.sourceStart,
        sourceEnd: draft.sourceEnd,
        docVersion: input.governance.docVersion,
        effectiveAt: draft.effectiveAt,
        expiredAt: draft.expiredAt,
        sourceAuthority: input.governance.sourceAuthority,
        projectId: input.governance.projectId,
        activityId: input.governance.activityId,
        region: input.governance.region,
        locale: input.governance.locale,
        channel: input.governance.channel,
        roleScope:
          input.governance.roleScope.length > 0
            ? JSON.stringify(input.governance.roleScope)
            : null,
        documentType: input.governance.documentType,
        lifecycleStatus: existing.lifecycleStatus,
        supersedesDocId: input.governance.supersedesDocId,
        hypotheticalQuestions:
          draft.hypotheticalQuestions.length > 0
            ? JSON.stringify(draft.hypotheticalQuestions)
            : null,
      }),
    );

    const vectors =
      newDrafts.length > 0
        ? await this.documentIndexCoordinator.embedChunks(
            newDrafts.map((draft) => draft.content),
          )
        : [];
    if (vectors.length !== newDrafts.length) {
      throw new Error('incremental embedding count does not match changed chunks');
    }

    let totalChunkCount = oldChunks.length + newEntities.length;
    await this.docChunkRepo.manager.transaction(async (manager) => {
      if (expireIds.size > 0) {
        await manager.getRepository(DocumentChunkEntity).update(
          { id: In([...expireIds]) },
          { expiredAt: effectiveAt },
        );
      }
      if (newEntities.length > 0) {
        await manager.getRepository(DocumentChunkEntity).save(newEntities);
      }
      totalChunkCount = await manager.getRepository(DocumentChunkEntity).count({
        where: { docId: input.docId, userId: input.userId },
      });
      await manager.getRepository(DocumentMetaEntity).update(
        { docId: input.docId },
        {
          filename: input.filename,
          contentHash: input.contentSha256,
          indexGeneration: input.indexGeneration,
          changeType: requestedChangeType,
          chunkCount: totalChunkCount,
          docVersion: input.governance.docVersion ?? existing.docVersion,
          effectiveAt: input.governance.effectiveAt ?? existing.effectiveAt,
          expiredAt: input.governance.expiredAt ?? existing.expiredAt,
          supersedesDocId:
            input.governance.supersedesDocId ?? existing.supersedesDocId,
        },
      );
    });

    if (expireIds.size > 0) {
      await this.documentIndexCoordinator.updateChunkMetadataByIds(
        [...expireIds],
        { expiredAt: effectiveAt.toISOString() },
      );
    }

    const records = newDrafts.map((draft, index) => ({
      id: draft.id,
      vector: vectors[index],
      content: draft.content,
      docId: input.docId,
      chunkIndex: draft.chunkIndex,
      userId: input.userId,
    }));
    await this.documentIndexCoordinator.writeIncrementalIndexes({
      records,
      chunks: newDrafts,
      userId: input.userId,
      vectors,
      document: {
        docId: input.docId,
        filename: input.filename,
        content: input.content,
        userId: input.userId,
        tenantId: input.tenantId,
        title: existing.title ?? input.filename,
        summary: existing.summary,
        sourceAuthority: input.governance.sourceAuthority,
        projectId: input.governance.projectId,
        activityId: input.governance.activityId,
        region: input.governance.region,
        locale: input.governance.locale,
        channel: input.governance.channel,
        roleScope: input.governance.roleScope,
        documentType: input.governance.documentType,
        lifecycleStatus: existing.lifecycleStatus,
        docVersion: input.governance.docVersion ?? existing.docVersion,
        contentHash: input.contentSha256,
        indexGeneration: input.indexGeneration,
        effectiveAt: input.governance.effectiveAt ?? existing.effectiveAt,
        expiredAt: input.governance.expiredAt ?? existing.expiredAt,
      },
    });
    await this.rebuildRetrievalDescriptions(input.tenantId, input.docId);

    if (this.graphService.isEnabled()) {
      this.scheduleOptionalGraphIndex({
        docId: input.docId,
        userId: input.userId,
        content: input.content,
      });
    }

    await this.documentTaskService.updateTask(input.taskId, {
      status: 'completed',
      stage: 'completed',
      progress: 100,
      chunkCount: totalChunkCount,
      finishedAt: new Date(),
    });

    this.logger.log(
      `Incremental update done: docId=${input.docId}, added=${newDrafts.length}, expired=${expireIds.size}, unchanged=${unchanged}, embedded=${newDrafts.length}`,
    );

    return {
      docId: input.docId,
      taskId: input.taskId,
      chunkCount: totalChunkCount,
      docVersion: input.governance.docVersion,
      effectiveAt: input.governance.effectiveAt?.toISOString() ?? null,
      expiredAt: input.governance.expiredAt?.toISOString() ?? null,
      sourceAuthority: input.governance.sourceAuthority,
      projectId: input.governance.projectId,
      activityId: input.governance.activityId,
      region: input.governance.region,
      locale: input.governance.locale,
      channel: input.governance.channel,
      roleScope: input.governance.roleScope,
      documentType: input.governance.documentType,
      lifecycleStatus: existing.lifecycleStatus as DocumentLifecycleStatus,
      graphIndexStatus: existing.graphIndexStatus,
      supersedesDocId: input.governance.supersedesDocId,
      incremental: (() => {
        const changedCount = newDrafts.filter(
          (draft) => draft.supersedesChunkId !== null,
        ).length;
        return {
          added: newDrafts.length - changedCount,
          changed: changedCount,
          removed: Math.max(0, expireIds.size - changedCount),
          unchanged,
          embedded: newDrafts.length,
        };
      })(),
    };
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
    const entities = records.map((record, index) => {
      const chunk = chunks[index];
      return this.docChunkRepo.create({
        id: record.id,
        tenantId,
        docId,
        userId,
        parentChunkId: chunk?.parentChunkId ?? null,
        chunkIndex: record.chunkIndex,
        chunkType: 'leaf',
        content: record.content,
        contentHash: record.contentHash,
        indexGeneration,
        ruleKey: this.resolveRuleKey(chunk, index),
        changeType: governance.changeType ?? 'standalone',
        supersedesChunkId: null,
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
        effectiveAt: this.resolveChunkValidity(
          record.content,
          governance.effectiveAt,
          governance.expiredAt,
          governance.validityMonths,
        ).effectiveAt,
        expiredAt: this.resolveChunkValidity(
          record.content,
          governance.effectiveAt,
          governance.expiredAt,
          governance.validityMonths,
        ).expiredAt,
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
        hypotheticalQuestions:
          hypotheticalQuestions[index]?.length > 0
            ? JSON.stringify(hypotheticalQuestions[index])
            : null,
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
      this.documentIndexCoordinator.updateElasticsearchDocumentLifecycle(
        docId,
        'deprecated',
        userId,
      ),
    ]);
    this.documentIndexCoordinator.updateBm25DocumentLifecycle(
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

  private resolveRuleKey(
    chunk:
      | { sectionId?: string | null; headingPath?: string[] | null }
      | undefined,
    index: number,
  ): string {
    const sectionId = chunk?.sectionId?.trim();
    if (sectionId) return sectionId.slice(0, 128);
    const heading = (chunk?.headingPath ?? [])
      .map((item) => item.trim())
      .filter(Boolean)
      .join(' > ');
    if (heading) return heading.slice(0, 128);
    return `chunk-${index}`;
  }

  private resolveChunkValidity(
    content: string,
    effectiveAt: Date | null,
    expiredAt: Date | null,
    validityMonths?: number,
  ): { effectiveAt: Date | null; expiredAt: Date | null } {
    const inlineStart = content.match(
      /(?:自|从)\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2})\s*(?:起|开始)/u,
    );
    const parsedStart = inlineStart
      ? this.parseDateOverride(inlineStart[1].replace(/\//g, '-'))
      : null;
    const start = effectiveAt ?? parsedStart;
    if (expiredAt) return { effectiveAt: start, expiredAt };
    const months = validityMonths ?? this.extractValidityMonths(content);
    if (months === null || months === undefined || months <= 0) {
      return { effectiveAt: start, expiredAt };
    }
    const from = start ?? new Date();
    const until = new Date(from);
    until.setMonth(until.getMonth() + months);
    return { effectiveAt: start ?? from, expiredAt: until };
  }

  private extractValidityMonths(content: string): number | null {
    const match = content.match(
      /(?:有效期(?:为)?|valid\s+for)\s*([0-9一二三四五六七八九十两]+)\s*(?:个)?\s*月/iu,
    );
    if (match === null) return null;
    const raw = match[1];
    const numeric = Number(raw);
    if (Number.isFinite(numeric)) return numeric;
    const chinese: Record<string, number> = {
      一: 1,
      二: 2,
      两: 2,
      三: 3,
      四: 4,
      五: 5,
      六: 6,
      七: 7,
      八: 8,
      九: 9,
      十: 10,
      十一: 11,
      十二: 12,
    };
    return chinese[raw] ?? null;
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
      changeType: explicit?.changeType,
      validityMonths: explicit?.validityMonths,
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

interface DocumentGovernanceMetadata extends GameDocumentMetadata {
  docVersion: string | null;
  effectiveAt: Date | null;
  expiredAt: Date | null;
  sourceAuthority: string;
  changeType?: DocumentChangeType;
  validityMonths?: number;
}

interface FactConflictDraft {
  subject: string;
  predicate: string;
  currentValue: string;
  conflictingValue: string;
  conflictingVersion: string | null;
}
