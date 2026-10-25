import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, LessThan } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { DocumentService } from '../document/document.service';
import { DocumentPermissionService } from '../document/document-permission.service';
import { GraphService } from '../graph/graph.service';
import { ConversationService } from '../chat/conversation.service';
import { KarpathyRagService } from '../../rag/karpathy/karpathy-rag.service';
import { ElasticsearchProvider } from '../../providers/elasticsearch/elasticsearch.provider';
import { VectorStoreProvider } from '../../providers/vector-store/vector-store.provider';
import { QueryLogService } from './query-log.service';
import { QueryLogEntity } from '../../providers/db/entities/query-log.entity';
import { DocumentChunkEntity } from '../../providers/db/entities/document-chunk.entity';
import { DocumentMetaEntity } from '../../providers/db/entities/document-meta.entity';
import { DocumentReviewEntity } from '../../providers/db/entities/document-review.entity';
import { DocumentPermissionEntity } from '../../providers/db/entities/document-permission.entity';
import { randomUUID } from 'node:crypto';
import { RagDocumentQueryDto, RagEvaluationRunDto } from './dto/rag-admin.dto';
import { ObsidianKnowledgeService } from '../obsidian/obsidian-knowledge.service';
import { KarpathyObsidianIngestService } from '../document/karpathy-obsidian-ingest.service';
import {
  DocumentChangeType,
  DocumentLifecycleStatus,
  GameDocumentType,
} from '../document/document-profile.util';
import { DomainEventsService } from '../domain-events/domain-events.service';
import { ImageIndexService } from '../image-index/image-index.service';
import {
  detectDocumentKind,
  extractDocumentText,
} from '../document/document-parser.util';
import { DocumentQueueService } from '../document/document-queue.service';
import { DocumentImageIngestionService } from '../document/document-image-ingestion.service';
import type { DocumentBusinessMetadata } from '../document/document-profile.util';
import { readEvaluationReportSummaries } from '../evaluation-reports/evaluation-report.store';
import { IndexRepairQueueService } from './index-repair-queue.service';
import { ObjectStorageProvider } from '../../providers/object-storage/object-storage.provider';
import { EmbeddingProvider } from '../../providers/embedding/embedding.provider';
import {
  DocumentRetrievalDescriptionService,
  type DocumentRetrievalDescriptionAudit,
} from '../document/document-retrieval-description.service';

export interface CapabilitiesResponse {
  vectorStore: { provider: string; available: boolean };
  bm25: { available: boolean; engine: string };
  elasticsearch: { available: boolean };
  rerank: { available: boolean; provider: string };
  graphRag: { available: boolean };
  mcp: { available: boolean };
  mem0: { available: boolean };
  redis: { available: boolean };
  speech: { available: boolean };
  agui: { available: boolean; endpoint: string };
  langSmith: { available: boolean; tracing: boolean; project: string };
  evaluation: { available: boolean; scripts: string[] };
  webSearch: { available: boolean };
  embedding: { provider: string; available: boolean };
}

export interface VectorIndexResponse {
  provider: string;
  collectionName: string;
  indexType: string;
  metricType: string;
  chunkCount: number;
  status: 'healthy' | 'degraded' | 'unavailable';
  statusReason: string | null;
  circuitState: 'closed' | 'open' | 'half_open';
  consecutiveFailures: number;
  lastFailureAt: string | null;
  circuitOpenUntil: string | null;
  params: Record<string, number | string>;
}

export interface EvaluationSummary {
  datasetName: string;
  mode: string;
  passed: boolean;
  averageScore: number;
  totalSamples: number;
  refusalRate?: number;
  citationRate: number;
  available?: boolean;
  reason?: string;
  outcome?: 'passed' | 'failed' | 'skipped' | 'unavailable';
  failedSamples?: number;
  synthetic?: boolean;
  retrievalMetrics?: { hitRate: number; mrr: number; ndcg: number };
  latencyMs?: { average: number; p95: number };
  estimatedCostByModeAndVariant?: Record<string, unknown>;
  pairedComparison?: Record<string, unknown>;
}

export interface ConversationSummary {
  threadId: string;
  title: string;
  mode: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

type IndexAuditStatus =
  | 'ok'
  | 'mismatch'
  | 'unavailable'
  | 'skipped'
  | 'unverified';

type IndexAuditCheck = {
  status: IndexAuditStatus;
  expected?: number;
  actual?: number;
  documentCount?: number;
  sourcePresent?: boolean;
  expectedContentHash?: string;
  actualContentHashes?: string[];
  expectedIndexGeneration?: string;
  actualIndexGenerations?: string[];
  pgCount?: number;
  milvusCount?: number;
  missingCount?: number;
  staleCount?: number;
  missingPgCount?: number;
  stalePgCount?: number;
  missingMilvusCount?: number;
  staleMilvusCount?: number;
  contentMismatchCount?: number;
  sourceMappingMismatchCount?: number;
  docVersion?: string | null;
  indexGeneration?: string | null;
  lifecycleStatus?: string | null;
  reviewStatus?: string | null;
  effectiveAt?: Date | null;
  expiredAt?: Date | null;
  reason?: string;
};

/** 文档全文检索的高级筛选（全部可选；不传时行为与原先一致） */
export interface DocumentSearchFilters {
  fileType?: string;
  updatedRange?: 'day' | 'week' | 'month';
  documentType?: string;
  role?: string;
}

export interface DocumentAdminItem {
  docId: string;
  filename: string;
  chunkCount: number;
  userId: string;
  category: string;
  sourceAuthority: string;
  docVersion: string;
  effectiveAt: string | null;
  expiredAt: string | null;
  createdAt: string;
  obsidianPath?: string | null;
  obsidianStatus?: 'linked' | 'missing';
}

@Injectable()
export class RagAdminService implements OnModuleInit {
  private readonly logger = new Logger(RagAdminService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly documentService: DocumentService,
    private readonly documentPermissionService: DocumentPermissionService,
    private readonly documentQueue: DocumentQueueService,
    private readonly karpathyObsidianIngest: KarpathyObsidianIngestService,
    private readonly graphService: GraphService,
    private readonly conversationService: ConversationService,
    private readonly karpathyRagService: KarpathyRagService,
    private readonly elasticsearchProvider: ElasticsearchProvider,
    private readonly vectorStoreProvider: VectorStoreProvider,
    private readonly queryLogService: QueryLogService,
    private readonly obsidianKnowledge: ObsidianKnowledgeService,
    @InjectRepository(DocumentChunkEntity)
    private readonly chunkRepo: Repository<DocumentChunkEntity>,
    @InjectRepository(DocumentMetaEntity)
    private readonly docMetaRepo: Repository<DocumentMetaEntity>,
    @InjectRepository(DocumentReviewEntity)
    private readonly documentReviewRepo: Repository<DocumentReviewEntity>,
    @InjectRepository(DocumentPermissionEntity)
    private readonly permissionRepo: Repository<DocumentPermissionEntity>,
    private readonly domainEvents: DomainEventsService,
    private readonly embeddingProvider: EmbeddingProvider,
    private readonly retrievalDescriptionService: DocumentRetrievalDescriptionService,
    private readonly documentImageIngestionService: DocumentImageIngestionService,
    // 图片检索（以图搜图/文搜图）可选依赖：未注册（模块未导入）时保持降级
    @Optional() private readonly imageIndexService?: ImageIndexService,
    @Optional()
    @InjectRepository(QueryLogEntity)
    private readonly queryLogRepo?: Repository<QueryLogEntity>,
    @Optional()
    private readonly indexRepairQueue?: IndexRepairQueueService,
    @Optional() private readonly objectStorageProvider?: ObjectStorageProvider,
  ) {}

  onModuleInit(): void {
    this.indexRepairQueue?.registerProcessor(async (job) => {
      const result = this.isDescriptionOnlyRepairReason(job.reason)
        ? await this.repairRetrievalDescriptions(job.docId)
        : await this.reindexDocument(job.docId);
      if (!result?.reindexed) {
        throw new Error(
          result?.reason ?? `document ${job.docId} reindex failed`,
        );
      }
    });
  }

  async uploadDocument(
    file: Express.Multer.File,
    userId: string,
    fields: Record<string, unknown> = {},
    trustedAdminPrincipal = false,
  ) {
    const tenantId = await this.validateUploadTenant(
      userId,
      fields,
      trustedAdminPrincipal,
    );
    const kind = detectDocumentKind(file.originalname);
    const content = (await extractDocumentText(file.buffer, kind)).trim();
    if (!content) throw new BadRequestException('document content is empty');
    const businessMetadata = { ...fields };
    delete businessMetadata.ownerUserId;
    delete businessMetadata.tenantId;
    return this.documentService.upload(file.originalname, content, userId, {
      originalBuffer: file.buffer,
      contentType: file.mimetype,
      tenantId,
      trustedAdminPrincipal,
      businessMetadata: businessMetadata,
    });
  }

  async uploadDocumentAsync(
    file: Express.Multer.File,
    userId: string,
    fields: Record<string, unknown> = {},
    trustedAdminPrincipal = false,
  ) {
    const tenantId = await this.validateUploadTenant(
      userId,
      fields,
      trustedAdminPrincipal,
    );

    if (!this.documentQueue.enabled) {
      if (this.documentQueue.required) {
        throw new BadRequestException(
          '生产文档处理要求使用 Redis 持久队列，当前队列未初始化，任务未执行。',
        );
      }
      return this.uploadDocument(file, userId, fields, trustedAdminPrincipal);
    }
    const task = await this.documentService.createQueuedTask(
      file.originalname,
      userId,
      tenantId,
    );
    const businessMetadata = { ...fields } as Record<string, unknown>;
    delete businessMetadata.ownerUserId;
    delete businessMetadata.tenantId;
    if (!this.objectStorageProvider) {
      await this.documentService.markTaskFailed(
        task.id,
        'object storage is required for asynchronous document processing',
      );
      throw new BadRequestException(
        'object storage is required for asynchronous document processing',
      );
    }
    const objectKey = `documents/${this.sanitizeObjectKeyPart(userId)}/queue/${task.id}/${this.sanitizeObjectKeyPart(file.originalname)}`;
    const job = {
      taskId: task.id,
      userId,
      tenantId,
      trustedAdminPrincipal,
      filename: file.originalname,
      objectKey,
      contentType: file.mimetype,
      businessMetadata,
    };
    try {
      await this.documentQueue.stageUpload(job);
      await this.objectStorageProvider.putObject({
        key: objectKey,
        body: file.buffer,
        contentType: file.mimetype,
      });
      await this.documentQueue.promoteUpload(task.id);
    } catch (error) {
      await this.documentQueue
        .removeStagedUpload(task.id)
        .catch((cleanupError: unknown) =>
          this.logger.warn(
            `staged document job cleanup failed for ${task.id}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
          ),
        );
      await this.objectStorageProvider.deleteObject(objectKey).catch((cleanupError: unknown) =>
        this.logger.warn(
          `uploaded object cleanup failed for ${task.id}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
        ),
      );
      await this.documentService.markTaskFailed(
        task.id,
        error instanceof Error ? error.message : 'document queue unavailable',
      );
      throw error;
    }
    return {
      taskId: task.id,
      status: task.status,
      stage: task.stage,
      progress: task.progress,
      queueEnabled: true,
    };
  }

  private async validateUploadTenant(
    userId: string,
    fields: Record<string, unknown>,
    trustedAdminPrincipal = false,
  ): Promise<string | undefined> {
    const requestedTenantId =
      typeof fields.tenantId === 'string'
        ? fields.tenantId.trim() || undefined
        : undefined;
    const tenantId = trustedAdminPrincipal
      ? process.env.RAG_ADMIN_TENANT_ID?.trim()
      : requestedTenantId;
    await this.documentPermissionService.assertTenant(
      userId,
      tenantId,
      trustedAdminPrincipal,
    );
    return tenantId;
  }

  private sanitizeObjectKeyPart(value: string): string {
    return value.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown';
  }

  getDocumentTask(taskId: string, userId: string) {
    return this.documentService.getTask(taskId, userId);
  }

  // ─── Capabilities ───────────────────────────────────────────

  getCapabilities(): CapabilitiesResponse {
    const vsProvider =
      this.configService.get<string>('vectorStore.provider') ?? 'milvus';
    const rerankProvider =
      this.configService.get<string>('RERANK_PROVIDER') ?? 'dashscope';
    const embeddingProvider =
      this.configService.get<string>('EMBEDDING_PROVIDER') ?? 'qwen';

    return {
      vectorStore: {
        provider: vsProvider,
        available: this.vectorStoreProvider.getRuntimeStatus().available,
      },
      bm25: {
        available: true,
        engine: this.elasticsearchProvider.isEnabled()
          ? 'elasticsearch'
          : 'memory',
      },
      elasticsearch: {
        available: this.elasticsearchProvider.isEnabled(),
      },
      rerank: {
        available: !!this.configService.get<string>('RERANK_API_KEY'),
        provider: rerankProvider,
      },
      graphRag: {
        available: this.graphService.isEnabled(),
      },
      mcp: {
        available: this.configService.get<string>('MCP_ENABLED') === 'true',
      },
      mem0: {
        available: !!this.configService.get<string>('MEM0_API_KEY'),
      },
      redis: {
        available: !!this.configService.get<string>('redis.url'),
      },
      speech: {
        available:
          !!this.configService.get<string>('TENCENT_SECRET_ID') &&
          !!this.configService.get<string>('TENCENT_SECRET_KEY'),
      },
      agui: {
        available: true,
        endpoint: '/api/v1/agui/stream',
      },
      langSmith: {
        available:
          this.configService.get<boolean>('langsmith.tracing') === true &&
          !!this.configService.get<string>('langsmith.apiKey'),
        tracing: this.configService.get<boolean>('langsmith.tracing') === true,
        project:
          this.configService.get<string>('langsmith.project') ??
          'rag-evaluation',
      },
      evaluation: {
        available: true,
        scripts: [
          'eval:rag',
          'eval:rag:e2e',
          'eval:rag:judge',
          'eval:rag:langsmith',
          'eval:rag:quality',
        ],
      },
      webSearch: {
        available: !!this.configService.get<string>('BOCHA_API_KEY'),
      },
      embedding: {
        provider: embeddingProvider,
        available: true,
      },
    };
  }

  getIndexCompensationStatus() {
    return this.documentService.getIndexCompensationStatus();
  }

  getDocumentQueueStatus() {
    return this.documentQueue.getStatus();
  }

  // ─── Documents ───────────────────────────────────────────────

  async getDocumentStats() {
    const allDocs = await this.docMetaRepo.find({
      order: { createdAt: 'DESC', docId: 'DESC' },
    });

    const dayKey = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
        d.getDate(),
      ).padStart(2, '0')}`;

    const tally = (values: string[]) => {
      const counts = new Map<string, number>();
      for (const value of values) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      return [...counts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);
    };

    // 近 14 日上传趋势（含空日补零）
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - 13);
    const uploadsByDay = new Map<string, number>();
    for (const doc of allDocs) {
      const createdAt = new Date(doc.createdAt);
      if (Number.isNaN(createdAt.getTime()) || createdAt < since) continue;
      const key = dayKey(createdAt);
      uploadsByDay.set(key, (uploadsByDay.get(key) ?? 0) + 1);
    }
    const uploadsTrend: { date: string; count: number }[] = [];
    for (let i = 0; i < 14; i++) {
      const day = new Date(since);
      day.setDate(since.getDate() + i);
      const key = dayKey(day);
      uploadsTrend.push({ date: key, count: uploadsByDay.get(key) ?? 0 });
    }

    const byFileType = tally(
      allDocs.map((doc) => {
        const dot = doc.filename.lastIndexOf('.');
        return dot >= 0 ? doc.filename.slice(dot + 1).toLowerCase() : 'other';
      }),
    );

    return {
      available: true,
      data: {
        total: allDocs.length,
        totalChunks: allDocs.reduce(
          (sum, doc) => sum + (doc.chunkCount ?? 0),
          0,
        ),
        categoryCount: new Set(allDocs.map((doc) => doc.category ?? '其他'))
          .size,
        last7DaysNew: uploadsTrend
          .slice(-7)
          .reduce((sum, item) => sum + item.count, 0),
        byCategory: tally(allDocs.map((doc) => doc.category ?? '其他')),
        byLifecycleStatus: tally(
          allDocs.map((doc) => doc.lifecycleStatus ?? 'unknown'),
        ),
        byReviewStatus: tally(
          allDocs.map((doc) => doc.reviewStatus ?? 'unknown'),
        ),
        byFileType,
        uploadsTrend,
        latest: allDocs.slice(0, 5).map((doc) => ({
          docId: doc.docId,
          filename: doc.filename,
          category: doc.category ?? '其他',
          chunkCount: doc.chunkCount,
          createdAt: doc.createdAt.toISOString(),
        })),
      },
    };
  }

  async getQualitySummary(limit = 500) {
    const logs = this.queryLogRepo
      ? await this.queryLogRepo.find({
          order: { createdAt: 'DESC' },
          take: Math.min(Math.max(limit, 1), 2000),
        })
      : [];
    const answered = logs.filter((log) => log.hasAnswer).length;
    const cited = logs.filter((log) => log.citationCount > 0).length;
    const refused = logs.filter((log) => log.refused).length;
    const latency = logs.length
      ? logs.reduce((sum, log) => sum + log.latencyMs, 0) / logs.length
      : 0;
    const trend = Array.from({ length: 14 }, (_, index) => {
      const day = new Date();
      day.setHours(0, 0, 0, 0);
      day.setDate(day.getDate() - (13 - index));
      const next = new Date(day);
      next.setDate(next.getDate() + 1);
      const dayLogs = logs.filter(
        (log) => log.createdAt >= day && log.createdAt < next,
      );
      return {
        date: day.toISOString().slice(0, 10),
        requests: dayLogs.length,
        answerRate: dayLogs.length
          ? dayLogs.filter((log) => log.hasAnswer).length / dayLogs.length
          : 0,
        citationRate: dayLogs.length
          ? dayLogs.filter((log) => log.citationCount > 0).length /
            dayLogs.length
          : 0,
        averageLatencyMs: dayLogs.length
          ? Math.round(
              dayLogs.reduce((sum, log) => sum + log.latencyMs, 0) /
                dayLogs.length,
            )
          : 0,
      };
    });
    const thresholds = {
      minAnswerRate: 0.8,
      minCitationRate: 0.7,
      maxRefusalRate: 0.2,
    };
    return {
      available: true,
      scanned: logs.length,
      answerRate: logs.length ? answered / logs.length : 0,
      citationRate: logs.length ? cited / logs.length : 0,
      refusalRate: logs.length ? refused / logs.length : 0,
      averageLatencyMs: Math.round(latency),
      byMode: ['simple', 'agentic', 'auto'].map((mode) => {
        const modeLogs = logs.filter((log) => log.mode === mode);
        return {
          mode,
          count: modeLogs.length,
          answerRate: modeLogs.length
            ? modeLogs.filter((log) => log.hasAnswer).length / modeLogs.length
            : 0,
        };
      }),
      trend,
      gate: {
        passed:
          (logs.length ? answered / logs.length : 0) >=
            thresholds.minAnswerRate &&
          (logs.length ? cited / logs.length : 0) >=
            thresholds.minCitationRate &&
          (logs.length ? refused / logs.length : 0) <=
            thresholds.maxRefusalRate,
        thresholds,
        reasons: [
          ...(answered / Math.max(logs.length, 1) < thresholds.minAnswerRate
            ? ['回答率低于门槛']
            : []),
          ...(cited / Math.max(logs.length, 1) < thresholds.minCitationRate
            ? ['引用率低于门槛']
            : []),
          ...(refused / Math.max(logs.length, 1) > thresholds.maxRefusalRate
            ? ['拒答率高于门槛']
            : []),
        ],
      },
    };
  }

  async getIntentRoutingSummary(limit = 200) {
    const logs = this.queryLogRepo
      ? await this.queryLogRepo.find({
          order: { createdAt: 'DESC' },
          take: Math.min(Math.max(limit, 1), 1000),
        })
      : [];
    const recent = logs.slice(0, 50).map((log) => {
      const hasRetrievalEvidence = log.citationCount > 0;
      return {
        id: log.id,
        query: log.query.slice(0, 160),
        action: hasRetrievalEvidence ? 'retrieve' : 'unknown',
        queryType: hasRetrievalEvidence ? 'evidence_backed' : 'not_recorded',
        confidence: hasRetrievalEvidence ? 1 : null,
        createdAt: log.createdAt.toISOString(),
        mode: log.mode,
        answered: log.hasAnswer,
        cited: log.citationCount > 0,
      };
    });
    const retrieveCount = recent.filter(
      (item) => item.action === 'retrieve',
    ).length;
    const unknownCount = recent.length - retrieveCount;
    return {
      available: true,
      scanned: logs.length,
      estimated: false,
      note: '旧问答日志没有保存 QueryPlan；仅把带引用的记录计为已检索，其余标为未记录，不猜测当时的路由。新运行计划保存在 Agent Run 事件中。',
      byAction: {
        retrieve: retrieveCount,
        direct_answer: 0,
        unknown: unknownCount,
      },
      byQueryType: {
        evidence_backed: retrieveCount,
        not_recorded: unknownCount,
      },
      recent,
    };
  }

  async listDocuments(query: RagDocumentQueryDto) {
    const allDocs = await this.docMetaRepo.find({
      // 上传时间倒序，docId 作为稳定的并列排序，确保同一毫秒上传时结果仍可复现。
      order: { createdAt: 'DESC', docId: 'DESC' },
    });

    let filtered = allDocs;

    if (query.q) {
      const q = query.q.toLowerCase();
      filtered = filtered.filter(
        (doc) =>
          doc.filename.toLowerCase().includes(q) ||
          (doc.title && doc.title.toLowerCase().includes(q)),
      );
    }
    if (query.category) {
      filtered = filtered.filter((doc) => doc.category === query.category);
    }
    if (query.userId) {
      filtered = filtered.filter((doc) => doc.userId === query.userId);
    }
    if (query.sourceAuthority) {
      filtered = filtered.filter(
        (doc) => doc.sourceAuthority === query.sourceAuthority,
      );
    }
    if (query.lifecycleStatus) {
      filtered = filtered.filter(
        (doc) => doc.lifecycleStatus === query.lifecycleStatus,
      );
    }

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    // 按权限主体类型过滤（公共/部门文档）
    if (query.scope) {
      const readableDocIds = await this.listReadableDocIdsByScope(
        query.scope,
        query.departmentId,
      );
      // 权限集合为空：直接返回空页，避免无意义的分页查询
      if (readableDocIds.size === 0) {
        return { total: 0, page, pageSize, items: [] };
      }
      filtered = filtered.filter((doc) => readableDocIds.has(doc.docId));
    }

    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const pageDocs = filtered.slice(start, start + pageSize);

    // 当页文档的权限摘要：一次 In() 查询 read 权限行，按 docId 分组（不去重跨类型）
    const permissionRows = pageDocs.length
      ? await this.permissionRepo.find({
          where: {
            docId: In(pageDocs.map((doc) => doc.docId)),
            action: 'read',
          },
        })
      : [];
    const permissionsByDoc = new Map<
      string,
      Array<{
        subjectType: DocumentPermissionEntity['subjectType'];
        subjectId: string;
      }>
    >();
    for (const row of permissionRows) {
      const list = permissionsByDoc.get(row.docId) ?? [];
      list.push({ subjectType: row.subjectType, subjectId: row.subjectId });
      permissionsByDoc.set(row.docId, list);
    }

    const items = await Promise.all(
      pageDocs.map(async (doc) => {
        const obsidianPath = doc.userId
          ? await this.obsidianKnowledge.findNoteByRagDocId(doc.docId, {
              userId: doc.userId,
            })
          : null;
        return {
          docId: doc.docId,
          filename: doc.filename,
          chunkCount: doc.chunkCount,
          userId: doc.userId ?? 'unknown',
          category: doc.category ?? '其他',
          sourceAuthority: doc.sourceAuthority ?? 'normal',
          docVersion: doc.docVersion ?? 'unknown',
          lifecycleStatus: doc.lifecycleStatus,
          reviewStatus: doc.reviewStatus,
          supersedesDocId: doc.supersedesDocId,
          effectiveAt: doc.effectiveAt?.toISOString() ?? null,
          expiredAt: doc.expiredAt?.toISOString() ?? null,
          title: doc.title ?? null,
          createdAt: doc.createdAt.toISOString(),
          obsidianPath,
          obsidianStatus: obsidianPath ? 'linked' : 'missing',
          permissions: permissionsByDoc.get(doc.docId) ?? [],
          indexPipeline: {
            rag: {
              status: doc.chunkCount > 0 ? 'indexed' : 'pending',
              chunkCount: doc.chunkCount,
              durationMs: null,
              completedAt: null,
              error: doc.chunkCount > 0 ? null : '尚未生成可检索 Chunk',
            },
            es: {
              status:
                doc.chunkCount > 0 && this.elasticsearchProvider.isEnabled()
                  ? 'indexed'
                  : this.elasticsearchProvider.isEnabled()
                    ? 'pending'
                    : 'skipped',
              chunkCount: doc.chunkCount,
              durationMs: null,
              completedAt: null,
              error: null,
            },
            graph: {
              status: doc.graphIndexStatus,
              chunkCount: null,
              durationMs: null,
              completedAt: doc.graphIndexedAt?.toISOString() ?? null,
              error: doc.graphIndexError,
            },
          },
        };
      }),
    );

    return { total, page, pageSize, items };
  }

  /** 按权限主体类型（public/department）查询可见 docId 集合，用于列表 scope 过滤 */
  private async listReadableDocIdsByScope(
    scope: 'public' | 'department',
    departmentId?: string,
  ): Promise<Set<string>> {
    const rows = await this.permissionRepo.find({
      where: {
        subjectType: scope,
        action: 'read',
        // scope=department 时可按 subjectId（部门 id）二次过滤
        ...(scope === 'department' && departmentId
          ? { subjectId: departmentId }
          : {}),
      },
    });
    return new Set(rows.map((row) => row.docId));
  }

  async getDocument(docId: string) {
    const doc = await this.docMetaRepo.findOne({ where: { docId } });
    if (!doc || !doc.userId) return null;

    const obsidianPath = await this.obsidianKnowledge.findNoteByRagDocId(
      docId,
      {
        userId: doc.userId,
      },
    );
    return {
      docId: doc.docId,
      filename: doc.filename,
      chunkCount: doc.chunkCount,
      userId: doc.userId ?? 'unknown',
      title: doc.title ?? null,
      author: doc.author ?? null,
      summary: doc.summary ?? null,
      keywords: doc.keywords ? (JSON.parse(doc.keywords) as string[]) : [],
      language: doc.language ?? null,
      category: doc.category ?? '其他',
      sourceAuthority: doc.sourceAuthority ?? 'normal',
      obsidianPath,
      obsidianStatus: obsidianPath ? 'linked' : 'missing',
      docVersion: doc.docVersion ?? 'unknown',
      lifecycleStatus: doc.lifecycleStatus,
      reviewStatus: doc.reviewStatus,
      reviewedBy: doc.reviewedBy,
      reviewedAt: doc.reviewedAt?.toISOString() ?? null,
      reviewComment: doc.reviewComment,
      supersedesDocId: doc.supersedesDocId,
      effectiveAt: doc.effectiveAt?.toISOString() ?? null,
      expiredAt: doc.expiredAt?.toISOString() ?? null,
      createdAt: doc.createdAt.toISOString(),
      indexPipeline: {
        rag: {
          status: doc.chunkCount > 0 ? 'indexed' : 'pending',
          chunkCount: doc.chunkCount,
          durationMs: null,
          completedAt: null,
          error: doc.chunkCount > 0 ? null : '尚未生成可检索 Chunk',
        },
        es: {
          status:
            doc.chunkCount > 0 && this.elasticsearchProvider.isEnabled()
              ? 'indexed'
              : this.elasticsearchProvider.isEnabled()
                ? 'pending'
                : 'skipped',
          chunkCount: doc.chunkCount,
          durationMs: null,
          completedAt: null,
          error: null,
        },
        graph: {
          status: doc.graphIndexStatus,
          chunkCount: null,
          durationMs: null,
          completedAt: doc.graphIndexedAt?.toISOString() ?? null,
          error: doc.graphIndexError,
        },
      },
    };
  }

  async inspectRetrieval(
    query: string,
    userId: string,
    tenantId: string,
    limit = 50,
  ) {
    if (!query?.trim()) throw new BadRequestException('query is required');
    const result = await this.karpathyRagService.retrieveDetailed(
      query.trim(),
      { tenantId, roles: ['admin'], trustedAdminPrincipal: true },
      userId,
    );
    const candidates = result.diagnostics.candidates;
    const cap = Math.min(Math.max(limit, 1), 50);
    return {
      query: query.trim(),
      profile: result.profile,
      vectorSource: result.vectorSource,
      rerankApplied: result.rerankApplied ?? false,
      diagnostics: result.diagnostics,
      candidates: candidates
        ? Object.fromEntries(
            Object.entries(candidates).map(([key, value]) => [
              key,
              value.slice(0, cap),
            ]),
          )
        : {},
    };
  }

  async searchDocuments(
    query: string,
    limit = 20,
    filters: DocumentSearchFilters = {},
  ) {
    const normalized = query.trim();
    if (!normalized) return [];
    // 文档全文检索走 kh_document 独立索引（docId/filename/title/summary 口径，与 admin 前端契约一致）
    const documentResults = await this.elasticsearchProvider.searchDocuments(
      normalized,
      Math.min(Math.max(limit, 1), 50),
      undefined,
      {
        fileType: filters.fileType,
        updatedRange: filters.updatedRange,
        documentType: filters.documentType,
        role: filters.role,
      },
    );
    if (documentResults.length > 0) return documentResults;

    // 存量文档可能只有 rag_chunks 索引（例如全文索引尚未补建），回退到分块 BM25，避免管理后台出现“索引有数据但查不到”。
    const chunkResults = await this.elasticsearchProvider.search(
      normalized,
      Math.min(Math.max(limit, 1), 50),
      undefined,
      {
        fileType: filters.fileType,
        updatedRange: filters.updatedRange,
        documentType: filters.documentType,
        role: filters.role,
      },
    );
    if (chunkResults.length === 0) return [];

    const docIds = [
      ...new Set(chunkResults.map((item) => item.docId).filter(Boolean)),
    ];
    const metas = docIds.length
      ? await this.docMetaRepo.find({ where: { docId: In(docIds) } })
      : [];
    const metaById = new Map(metas.map((meta) => [meta.docId, meta]));
    return chunkResults.map((chunk) => {
      const meta = metaById.get(chunk.docId);
      return {
        docId: chunk.docId,
        filename: meta?.filename ?? chunk.docId,
        title: meta?.title ?? null,
        summary: meta?.summary ?? null,
        score: chunk.score,
        highlightFragments: (
          chunk as typeof chunk & { highlightFragments?: string[] }
        ).highlightFragments ?? [chunk.content.slice(0, 220)],
        docVersion: meta?.docVersion ?? chunk.docVersion ?? null,
        lifecycleStatus: meta?.lifecycleStatus ?? chunk.lifecycleStatus,
        sourceAuthority: meta?.sourceAuthority ?? chunk.sourceAuthority,
      };
    });
  }

  /** 文档搜索筛选面板 facets（documentTypes / roles），ES 未启用时返回空数组 */
  getDocumentSearchFacets() {
    return this.elasticsearchProvider.getDocumentSearchFacets();
  }

  /**
   * 文搜图（rag_images 独立图片集合）。
   * 嵌入 Key 未配置或 Milvus 异常时不抛 500：返回空列表 + reason 降级字段。
   */
  async searchImages(
    query: string,
    limit = 20,
    userId?: string,
    tenantId?: string,
    role?: string,
    trustedAdminPrincipal = false,
  ) {
    const normalized = query.trim();
    const capped = Math.min(Math.max(limit, 1), 50);
    if (!normalized) {
      return {
        query,
        limit: capped,
        userId: userId ?? null,
        tenantId: tenantId ?? null,
        reason: '查询词为空',
        results: [],
      };
    }
    if (!userId) {
      return {
        query,
        limit: capped,
        userId: null,
        tenantId: tenantId ?? null,
        reason: '缺少图片检索用户范围',
        results: [],
      };
    }
    if (!this.imageIndexService?.isEnabled()) {
      return {
        query,
        limit: capped,
        userId: userId ?? null,
        tenantId: tenantId ?? null,
        reason:
          '图片检索未启用：缺少 MULTIMODAL_EMBEDDING_API_KEY（或 DASHSCOPE_API_KEY）',
        results: [],
      };
    }
    try {
      const allowedDocIds = await this.getActiveAllowedImageDocIds(
        userId,
        tenantId,
        role,
        trustedAdminPrincipal,
      );
      const results = await this.imageIndexService.searchText(normalized, {
        topK: capped,
        userId,
        allowedDocIds,
      });
      return {
        query,
        limit: capped,
        userId: userId ?? null,
        tenantId: tenantId ?? null,
        reason: null,
        results,
      };
    } catch (err) {
      this.logger.warn(`Image search degraded: ${(err as Error).message}`);
      return {
        query,
        limit: capped,
        userId: userId ?? null,
        tenantId: tenantId ?? null,
        reason: `图片检索降级：${(err as Error).message}`,
        results: [],
      };
    }
  }

  /** 以图搜图；查询图片仅用于本次嵌入，不写入图片索引。 */
  async searchImagesByImage(
    base64: string,
    mimeType: string,
    limit = 20,
    userId?: string,
    tenantId?: string,
    role?: string,
    trustedAdminPrincipal = false,
  ) {
    const capped = Math.min(Math.max(limit, 1), 50);
    const query = '上传图片';
    if (!base64.trim()) {
      return {
        query,
        limit: capped,
        userId: userId ?? null,
        tenantId: tenantId ?? null,
        reason: '查询图片为空',
        results: [],
      };
    }
    if (!userId) {
      return {
        query,
        limit: capped,
        userId: null,
        tenantId: tenantId ?? null,
        reason: '缺少图片检索用户范围',
        results: [],
      };
    }
    if (!this.imageIndexService?.isEnabled()) {
      return {
        query,
        limit: capped,
        userId,
        tenantId: tenantId ?? null,
        reason:
          '图片检索未启用：缺少 MULTIMODAL_EMBEDDING_API_KEY（或 DASHSCOPE_API_KEY）',
        results: [],
      };
    }
    try {
      const allowedDocIds = await this.getActiveAllowedImageDocIds(
        userId,
        tenantId,
        role,
        trustedAdminPrincipal,
      );
      const results = await this.imageIndexService.searchImage(
        base64,
        mimeType,
        { topK: capped, userId, allowedDocIds },
      );
      return {
        query,
        limit: capped,
        userId,
        tenantId: tenantId ?? null,
        reason: null,
        results,
      };
    } catch (err) {
      this.logger.warn(`Image search degraded: ${(err as Error).message}`);
      return {
        query,
        limit: capped,
        userId,
        tenantId: tenantId ?? null,
        reason: `图片检索降级：${(err as Error).message}`,
        results: [],
      };
    }
  }

  async getImageAsset(params: {
    userId: string;
    tenantId?: string;
    role?: string;
    trustedAdminPrincipal?: boolean;
    docId: string;
    key: string;
  }): Promise<{ buffer: Buffer; contentType: string }> {
    const userId = params.userId?.trim();
    const docId = params.docId?.trim();
    const key = params.key?.replace(/^\/+/, '').trim();
    if (
      !userId ||
      !docId ||
      !key ||
      key.includes('\\') ||
      key.split('/').includes('..')
    ) {
      throw new BadRequestException(
        'userId, docId and a safe image key are required',
      );
    }
    if (!this.objectStorageProvider) {
      throw new ServiceUnavailableException('image storage is unavailable');
    }

    const activeDocuments = await this.getActiveAllowedImageDocuments(
      userId,
      params.tenantId,
      params.role,
      params.trustedAdminPrincipal,
    );
    const document = activeDocuments.get(docId);
    if (!document?.userId) {
      throw new ForbiddenException('image asset is not accessible');
    }
    const ownerPrefix = `documents/${this.sanitizeObjectKeyPart(document.userId)}/${docId}/`;
    if (!key.startsWith(ownerPrefix)) {
      throw new ForbiddenException(
        'image key does not belong to the requested document',
      );
    }

    const contentType = imageAssetContentType(key);
    if (!contentType) {
      throw new BadRequestException('unsupported image asset type');
    }
    return {
      buffer: await this.objectStorageProvider.getObject(key),
      contentType,
    };
  }

  private async getActiveAllowedImageDocIds(
    userId: string,
    tenantId?: string,
    role?: string,
    trustedAdminPrincipal = false,
  ): Promise<Set<string>> {
    return new Set(
      (
        await this.getActiveAllowedImageDocuments(
          userId,
          tenantId,
          role,
          trustedAdminPrincipal,
        )
      ).keys(),
    );
  }

  private async getActiveAllowedImageDocuments(
    userId: string,
    tenantId?: string,
    role?: string,
    trustedAdminPrincipal = false,
  ): Promise<Map<string, DocumentMetaEntity>> {
    const allowedDocIds = await this.documentService.getAllowedDocIdsForUser(
      userId,
      tenantId,
      role?.trim() ? [role.trim()] : [],
      trustedAdminPrincipal,
    );
    const ids = [...allowedDocIds];
    const documents: DocumentMetaEntity[] = [];
    for (let index = 0; index < ids.length; index += 500) {
      documents.push(
        ...(await this.docMetaRepo.find({
          select: [
            'docId',
            'userId',
            'lifecycleStatus',
            'reviewStatus',
            'effectiveAt',
            'expiredAt',
          ],
          where: { docId: In(ids.slice(index, index + 500)) },
        })),
      );
    }
    const now = Date.now();
    return new Map(
      documents
        .filter((document) => this.isCurrentEffectiveDocument(document, now))
        .map((document) => [document.docId, document]),
    );
  }

  private isCurrentEffectiveDocument(
    document: DocumentMetaEntity,
    now: number,
  ): boolean {
    if (
      document.lifecycleStatus !== 'effective' ||
      document.reviewStatus !== 'approved'
    ) {
      return false;
    }
    const effectiveAt = document.effectiveAt?.getTime();
    const expiredAt = document.expiredAt?.getTime();
    return (
      (effectiveAt === undefined || Number.isFinite(effectiveAt)) &&
      (expiredAt === undefined || Number.isFinite(expiredAt)) &&
      (effectiveAt === undefined || effectiveAt <= now) &&
      (expiredAt === undefined || expiredAt > now)
    );
  }

  async reindexDocumentSearch(limit = 1000) {
    const documents = await this.docMetaRepo.find({
      take: Math.min(Math.max(limit, 1), 5000),
    });
    const chunks = await this.chunkRepo.find({ order: { chunkIndex: 'ASC' } });
    const chunksByDoc = new Map<string, DocumentChunkEntity[]>();
    for (const chunk of chunks) {
      const items = chunksByDoc.get(chunk.docId) ?? [];
      items.push(chunk);
      chunksByDoc.set(chunk.docId, items);
    }
    const results = await Promise.allSettled(
      documents.map((doc) => {
        const content = (chunksByDoc.get(doc.docId) ?? [])
          .map((chunk) => chunk.content)
          .join('\n\n');
        let roleScope: string[] = [];
        try {
          roleScope = doc.roleScope
            ? (JSON.parse(doc.roleScope) as string[])
            : [];
        } catch {
          roleScope = [];
        }
        return this.elasticsearchProvider.indexDocument({
          docId: doc.docId,
          filename: doc.filename,
          content,
          userId: doc.userId,
          title: doc.title,
          summary: doc.summary,
          sourceAuthority: doc.sourceAuthority,
          projectId: doc.projectId,
          activityId: doc.activityId,
          region: doc.region,
          locale: doc.locale,
          channel: doc.channel,
          roleScope,
          documentType: doc.documentType,
          lifecycleStatus: doc.lifecycleStatus,
          docVersion: doc.docVersion,
          effectiveAt: doc.effectiveAt,
          expiredAt: doc.expiredAt,
        });
      }),
    );
    return {
      indexed: results.filter((result) => result.status === 'fulfilled').length,
      skipped:
        documents.length -
        results.filter((result) => result.status === 'fulfilled').length,
      total: documents.length,
    };
  }

  async listDocumentVersions(docId: string) {
    const root = await this.docMetaRepo.findOne({ where: { docId } });
    if (!root) return null;
    if (!root.userId) return [];
    const all = await this.docMetaRepo.find({
      where: { userId: root.userId },
      order: { createdAt: 'ASC' },
    });
    const ids = new Set([docId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const doc of all) {
        if (
          doc.supersedesDocId &&
          ids.has(doc.supersedesDocId) &&
          !ids.has(doc.docId)
        ) {
          ids.add(doc.docId);
          changed = true;
        }
        if (
          ids.has(doc.docId) &&
          doc.supersedesDocId &&
          !ids.has(doc.supersedesDocId)
        ) {
          ids.add(doc.supersedesDocId);
          changed = true;
        }
      }
    }
    return all
      .filter((doc) => ids.has(doc.docId))
      .map((doc) => this.toDocumentVersionItem(doc));
  }

  async createDocumentVersion(
    docId: string,
    body: {
      content?: string;
      filename?: string;
      docVersion?: string;
      effectiveAt?: string;
      expiredAt?: string;
      lifecycleStatus?: DocumentLifecycleStatus;
      documentType?: GameDocumentType;
    },
  ) {
    const previous = await this.docMetaRepo.findOne({ where: { docId } });
    if (!previous) return null;
    if (!previous.userId) throw new Error('document owner is missing');
    const content = body.content?.trim();
    if (!content) throw new Error('content is required');
    const roleScope = previous.roleScope
      ? (JSON.parse(previous.roleScope) as string[])
      : [];
    const result = await this.karpathyObsidianIngest.ingestText({
      title: body.filename?.trim() || previous.filename,
      content,
      userId: previous.userId,
      filename: body.filename?.trim() || previous.filename,
      sourceType: 'document',
      contentType: 'text/markdown',
      originalBuffer: Buffer.from(content, 'utf8'),
      businessMetadata: {
        projectId: previous.projectId,
        activityId: previous.activityId,
        region: previous.region,
        locale: previous.locale,
        channel: previous.channel,
        roleScope,
        documentType:
          body.documentType ?? (previous.documentType as GameDocumentType),
        lifecycleStatus: 'draft',
        supersedesDocId: docId,
        docVersion: body.docVersion ?? null,
        effectiveAt: body.effectiveAt ?? null,
        expiredAt: body.expiredAt ?? null,
      },
    });
    return { ...result.rag, obsidian: result.obsidian, previousDocId: docId };
  }

  /**
   * 同一 docId 的规则级增量更新：只 embedding 新增/变化 chunk，
   * unchanged chunk 保留原向量和索引；旧 chunk 通过 expiredAt 保留历史。
   */
  async incrementalUpdateDocument(
    docId: string,
    body: {
      content?: string;
      filename?: string;
      docVersion?: string;
      effectiveAt?: string;
      expiredAt?: string;
      lifecycleStatus?: DocumentLifecycleStatus;
      documentType?: GameDocumentType;
      changeType?: DocumentChangeType;
      validityMonths?: number;
    },
  ) {
    const previous = await this.docMetaRepo.findOne({ where: { docId } });
    if (previous === null) return null;
    if (previous.userId === null || previous.userId === undefined) {
      throw new BadRequestException('document owner is missing');
    }
    const content = body.content?.trim();
    if (content === undefined || content.length === 0) {
      throw new BadRequestException('content is required');
    }
    let roleScope: string[] = [];
    try {
      roleScope = previous.roleScope
        ? (JSON.parse(previous.roleScope) as string[])
        : [];
    } catch {
      roleScope = [];
    }
    const result = await this.karpathyObsidianIngest.ingestText({
      title: body.filename?.trim() || previous.filename,
      content,
      userId: previous.userId,
      tenantId: previous.tenantId ?? 'legacy',
      filename: body.filename?.trim() || previous.filename,
      sourceType: 'document',
      contentType: 'text/markdown',
      originalBuffer: Buffer.from(content, 'utf8'),
      docId,
      incrementalUpdate: true,
      businessMetadata: {
        projectId: previous.projectId,
        activityId: previous.activityId,
        region: previous.region,
        locale: previous.locale,
        channel: previous.channel,
        roleScope,
        documentType:
          body.documentType ??
          (previous.documentType as GameDocumentType | undefined),
        lifecycleStatus:
          body.lifecycleStatus ??
          (previous.lifecycleStatus as DocumentLifecycleStatus),
        supersedesDocId: previous.supersedesDocId,
        docVersion: body.docVersion ?? previous.docVersion,
        effectiveAt: body.effectiveAt ?? null,
        expiredAt:
          body.expiredAt ??
          (previous.expiredAt
            ? previous.expiredAt.toISOString()
            : null),
        changeType: body.changeType ?? 'amend',
        validityMonths: body.validityMonths,
      },
    });
    return {
      ...result.rag,
      obsidian: result.obsidian,
      incrementalUpdate: true,
    };
  }

  async updateDocumentLifecycle(
    docId: string,
    lifecycleStatus: DocumentLifecycleStatus,
  ) {
    const doc = await this.docMetaRepo.findOne({ where: { docId } });
    if (!doc || !doc.userId) return null;
    if (lifecycleStatus === 'effective') {
      return this.promoteDocumentVersion(docId);
    }
    const updated = await this.documentService.updateLifecycle(
      docId,
      doc.userId,
      lifecycleStatus,
      {
        eventType: 'document.lifecycle_changed',
        aggregateType: 'document',
        aggregateId: docId,
        payload: { lifecycleStatus },
      },
    );
    return updated ? { docId, lifecycleStatus } : null;
  }

  /** 归档文档：仅 effective/confirmed 可归档，归档后从所有检索口径隐藏 */
  async archiveDocument(docId: string) {
    const doc = await this.docMetaRepo.findOne({ where: { docId } });
    if (!doc) return null;
    if (
      doc.lifecycleStatus !== 'effective' &&
      doc.lifecycleStatus !== 'confirmed'
    ) {
      throw new BadRequestException(
        `document lifecycle status is ${doc.lifecycleStatus ?? 'unknown'}, only effective/confirmed documents can be archived`,
      );
    }
    const updated = await this.updateDocumentLifecycle(docId, 'archived');
    if (!updated) return null;
    return { docId, archived: true, lifecycleStatus: 'archived' as const };
  }

  /** 恢复归档：仅 archived 状态且审批通过（approved）可恢复为 effective */
  async unarchiveDocument(docId: string) {
    const doc = await this.docMetaRepo.findOne({ where: { docId } });
    if (!doc) return null;
    if (doc.lifecycleStatus !== 'archived') {
      throw new BadRequestException(
        `document lifecycle status is ${doc.lifecycleStatus ?? 'unknown'}, only archived documents can be unarchived`,
      );
    }
    if (doc.reviewStatus !== 'approved') {
      throw new BadRequestException(
        'document must be approved before unarchive',
      );
    }
    const updated = await this.updateDocumentLifecycle(docId, 'effective');
    if (!updated) return null;
    return { docId, unarchived: true, lifecycleStatus: 'effective' as const };
  }

  async promoteDocumentVersion(docId: string) {
    const target = await this.docMetaRepo.findOne({ where: { docId } });
    if (!target || !target.userId) return null;
    if (target.reviewStatus !== 'approved') {
      throw new BadRequestException(
        'document must be approved before promotion',
      );
    }
    const versions = await this.listDocumentVersions(docId);
    if (!versions) return null;
    const updated = await this.documentService.activateVersion(
      docId,
      target.userId,
      versions.map((version) => version.docId),
      {
        eventType: 'document.effective',
        aggregateType: 'document',
        aggregateId: docId,
        payload: { docVersion: target.docVersion ?? null },
      },
    );
    return updated ? { docId, lifecycleStatus: 'effective' } : null;
  }

  async rollbackDocumentVersion(docId: string) {
    const activated = await this.promoteDocumentVersion(docId);
    if (!activated) return null;
    return {
      activeDocId: docId,
      versions: await this.listDocumentVersions(docId),
    };
  }

  async submitDocumentReview(
    docId: string,
    operatorId?: string,
    comment?: string,
  ) {
    return this.updateDocumentReview(
      docId,
      'pending_review',
      'submitted',
      operatorId,
      comment,
    );
  }

  async approveDocumentReview(
    docId: string,
    operatorId?: string,
    comment?: string,
  ) {
    return this.updateDocumentReview(
      docId,
      'approved',
      'approved',
      operatorId,
      comment,
    );
  }

  async rejectDocumentReview(
    docId: string,
    operatorId?: string,
    comment?: string,
  ) {
    return this.updateDocumentReview(
      docId,
      'rejected',
      'rejected',
      operatorId,
      comment,
    );
  }

  async listDocumentReviews(docId: string) {
    return this.documentReviewRepo.find({
      where: { docId },
      order: { createdAt: 'DESC' },
    });
  }

  getFailedDocumentTasks(limit?: number) {
    return this.documentService.getFailedTasks(limit);
  }

  getPendingDocumentTasks(limit?: number) {
    return this.documentService.getPendingTasks(limit);
  }

  async auditDocumentIndexes(
    limit = 200,
    cursor?: { createdAt: string; docId: string },
  ) {
    const pageSize = Math.min(Math.max(limit, 1), 1000);
    const after = cursor ? new Date(cursor.createdAt) : undefined;
    const docs = await this.docMetaRepo.find({
      ...(after && Number.isFinite(after.getTime()) && cursor
        ? {
            where: [
              { createdAt: LessThan(after) },
              { createdAt: after, docId: LessThan(cursor.docId) },
            ],
          }
        : {}),
      order: { createdAt: 'DESC', docId: 'DESC' },
      take: pageSize,
    });
    const chunks = docs.length
      ? await this.chunkRepo.find({
          where: { docId: In(docs.map((doc) => doc.docId)) },
          select: ['docId', 'contentHash', 'indexGeneration'],
        })
      : [];
    const dbChunkCounts = new Map<string, number>();
    const dbChunkHashes = new Map<string, Set<string>>();
    const dbGenerations = new Map<string, Set<string>>();
    for (const chunk of chunks) {
      dbChunkCounts.set(chunk.docId, (dbChunkCounts.get(chunk.docId) ?? 0) + 1);
      if (chunk.contentHash) {
        const hashes = dbChunkHashes.get(chunk.docId) ?? new Set<string>();
        hashes.add(chunk.contentHash);
        dbChunkHashes.set(chunk.docId, hashes);
      }
      if (chunk.indexGeneration) {
        const generations = dbGenerations.get(chunk.docId) ?? new Set<string>();
        generations.add(chunk.indexGeneration);
        dbGenerations.set(chunk.docId, generations);
      }
    }
    const now = Date.now();
    const checks = [];
    for (let offset = 0; offset < docs.length; offset += 10) {
      const batchChecks = await Promise.all(
        docs.slice(offset, offset + 10).map(async (doc) => {
        const expected = dbChunkCounts.get(doc.docId) ?? 0;
        const expectedHashes = [...(dbChunkHashes.get(doc.docId) ?? new Set())];
        const expectedGenerations = [
          ...(dbGenerations.get(doc.docId) ?? new Set()),
        ];
        const bm25 = this.karpathyRagService.getIndexedChunkCount(
          doc.docId,
          doc.userId ?? undefined,
        );
        const es = await this.elasticsearchProvider.getIndexCountsByDocId(
          doc.docId,
          doc.userId ?? undefined,
        );
        const bm25Hashes =
          typeof this.karpathyRagService.getIndexedChunkHashes === 'function'
            ? this.karpathyRagService.getIndexedChunkHashes(
                doc.docId,
                doc.userId ?? undefined,
              )
            : { hashes: [], generations: [], complete: false };
        const bm25HashMismatch =
          expectedHashes.length > 0 &&
          (bm25Hashes.hashes.length !== expectedHashes.length ||
            !expectedHashes.every((hash) => bm25Hashes.hashes.includes(hash)));
        const bm25GenerationMismatch =
          expectedGenerations.length > 0 &&
          (bm25Hashes.generations.length !== expectedGenerations.length ||
            !expectedGenerations.every((generation) =>
              bm25Hashes.generations.includes(generation),
            ));
        const esHashMismatch =
          expectedHashes.length > 0 &&
          (es.contentHashes?.length !== expectedHashes.length ||
            !expectedHashes.every((hash) => es.contentHashes?.includes(hash)));
        const esGenerationMismatch =
          expectedGenerations.length > 0 &&
          (es.indexGenerations?.length !== expectedGenerations.length ||
            !expectedGenerations.every((generation) =>
              es.indexGenerations?.includes(generation),
            ));
        const vectorRuntime = this.vectorStoreProvider.getRuntimeStatus();
        const milvus = await this.readIndexCheck(
          vectorRuntime.available,
          () =>
            this.vectorStoreProvider.countByDocId(
              doc.docId,
              doc.userId ?? undefined,
            ),
          expected,
          'milvus',
        );
        const graph = await this.readGraphIndexCheck(
          doc.graphIndexStatus,
          doc.docId,
          doc.userId ?? 'system',
        );
        let image: IndexAuditCheck = {
          status: 'skipped',
          reason: 'image_index_disabled',
        };
        if (this.imageIndexService?.isEnabled()) {
          const imageUserId = doc.userId ?? 'system';
          try {
            const expectedImageAssets =
              await this.documentImageIngestionService.getExpectedIndexAssetCount(
                doc.docId,
                doc.filename,
                imageUserId,
              );
            image = await this.readIndexCheck(
              true,
              () =>
                this.imageIndexService!.countByDocId(
                  doc.docId,
                  imageUserId,
                ),
              expectedImageAssets,
              'image',
            );
          } catch (err) {
            image = {
              status: 'unavailable',
              reason: `image_index_audit_unavailable:${(err as Error).message}`,
            };
          }
        }
        let descriptionAudit: DocumentRetrievalDescriptionAudit | null = null;
        try {
          descriptionAudit =
            await this.retrievalDescriptionService.auditForDocument({
              tenantId: doc.tenantId ?? 'legacy',
              docId: doc.docId,
            });
        } catch (err) {
          this.logger.warn(
            `Retrieval description audit failed for docId=${doc.docId}: ${(err as Error).message}`,
          );
        }
        const descriptionReasons: string[] = [];
        if (!descriptionAudit) {
          descriptionReasons.push('retrieval_description_audit_unavailable');
        } else {
          if (!descriptionAudit.documentFound) {
            descriptionReasons.push('retrieval_description_document_missing');
          }
          if (descriptionAudit.missingPgCount > 0) {
            descriptionReasons.push('retrieval_description_missing_pg');
          }
          if (descriptionAudit.stalePgCount > 0) {
            descriptionReasons.push('retrieval_description_stale_pg');
          }
          if (descriptionAudit.missingMilvusCount > 0) {
            descriptionReasons.push('retrieval_description_missing_milvus');
          }
          if (descriptionAudit.staleMilvusCount > 0) {
            descriptionReasons.push('retrieval_description_stale_milvus');
          }
          if (descriptionAudit.contentMismatchCount > 0) {
            descriptionReasons.push('retrieval_description_content_mismatch');
          }
          if (descriptionAudit.sourceMappingMismatchCount > 0) {
            descriptionReasons.push(
              'retrieval_description_source_mapping_mismatch',
            );
          }
          if (
            descriptionAudit.missingCount > 0 &&
            descriptionAudit.missingPgCount === 0 &&
            descriptionAudit.missingMilvusCount === 0
          ) {
            descriptionReasons.push('retrieval_description_missing');
          }
          if (
            descriptionAudit.staleCount > 0 &&
            descriptionAudit.stalePgCount === 0 &&
            descriptionAudit.staleMilvusCount === 0
          ) {
            descriptionReasons.push('retrieval_description_stale');
          }
          if (
            descriptionAudit.expectedCount !== descriptionAudit.pgCount ||
            descriptionAudit.expectedCount !== descriptionAudit.milvusCount
          ) {
            descriptionReasons.push('retrieval_description_count_mismatch');
          }
        }
        const descriptionsMismatch = descriptionReasons.length > 0;
        const retrievalDescriptions: IndexAuditCheck = descriptionAudit
          ? {
              status: descriptionsMismatch ? 'mismatch' : 'ok',
              expected: descriptionAudit.expectedCount,
              actual: descriptionAudit.pgCount,
              docVersion: descriptionAudit.docVersion,
              indexGeneration: descriptionAudit.indexGeneration,
              lifecycleStatus: descriptionAudit.lifecycleStatus,
              reviewStatus: descriptionAudit.reviewStatus,
              effectiveAt: descriptionAudit.effectiveAt,
              expiredAt: descriptionAudit.expiredAt,
              pgCount: descriptionAudit.pgCount,
              milvusCount: descriptionAudit.milvusCount,
              missingCount: descriptionAudit.missingCount,
              staleCount: descriptionAudit.staleCount,
              missingPgCount: descriptionAudit.missingPgCount,
              stalePgCount: descriptionAudit.stalePgCount,
              missingMilvusCount: descriptionAudit.missingMilvusCount,
              staleMilvusCount: descriptionAudit.staleMilvusCount,
              contentMismatchCount: descriptionAudit.contentMismatchCount,
              sourceMappingMismatchCount:
                descriptionAudit.sourceMappingMismatchCount,
              ...(descriptionsMismatch
                ? { reason: descriptionReasons[0] }
                : {}),
            }
          : {
              status: 'unavailable',
              reason: 'retrieval_description_audit_unavailable',
            };
        const indexChecks: Record<string, IndexAuditCheck> = {
          postgres: {
            status: doc.chunkCount === expected ? 'ok' : 'mismatch',
            expected,
            actual: doc.chunkCount,
            ...(doc.chunkCount === expected
              ? {}
              : { reason: 'documents_meta_chunk_count_mismatch' }),
            expectedContentHash: doc.contentHash ?? undefined,
            expectedIndexGeneration: doc.indexGeneration ?? undefined,
          },
          bm25: {
            status:
              bm25 === expected && !bm25HashMismatch && !bm25GenerationMismatch
                ? 'ok'
                : 'mismatch',
            expected,
            actual: bm25,
            expectedContentHash: expectedHashes.join(','),
            actualContentHashes: bm25Hashes.hashes,
            expectedIndexGeneration: expectedGenerations.join(','),
            actualIndexGenerations: bm25Hashes.generations,
            ...(bm25 === expected &&
            !bm25HashMismatch &&
            !bm25GenerationMismatch
              ? {}
              : {
                  reason:
                    bm25 !== expected
                      ? 'bm25_chunk_count_mismatch'
                      : bm25HashMismatch
                        ? 'bm25_content_hash_mismatch'
                        : 'bm25_generation_mismatch',
                }),
          },
          elasticsearch: es.available
            ? {
                status:
                  es.chunkCount === expected &&
                  (expected === 0 || es.documentCount === 1) &&
                  !esHashMismatch &&
                  !esGenerationMismatch
                    ? 'ok'
                    : 'mismatch',
                expected,
                actual: es.chunkCount,
                documentCount: es.documentCount,
                expectedContentHash: expectedHashes.join(','),
                actualContentHashes: es.contentHashes,
                expectedIndexGeneration: expectedGenerations.join(','),
                actualIndexGenerations: es.indexGenerations,
                ...(es.chunkCount === expected &&
                (expected === 0 || es.documentCount === 1) &&
                !esHashMismatch &&
                !esGenerationMismatch
                  ? {}
                  : {
                      reason:
                        es.chunkCount !== expected || es.documentCount !== 1
                          ? 'elasticsearch_index_count_mismatch'
                          : esHashMismatch
                            ? 'elasticsearch_content_hash_mismatch'
                            : 'elasticsearch_generation_mismatch',
                    }),
              }
            : {
                status: 'skipped',
                reason: es.reason ?? 'elasticsearch_disabled',
              },
          milvus,
          image,
          graph,
          retrievalDescriptions,
        };
        const reasons: string[] = [];
        if (expected <= 0) reasons.push('missing_chunks');
        if (indexChecks.postgres.status === 'mismatch')
          reasons.push('metadata_chunk_count_mismatch');
        if (indexChecks.bm25.status === 'mismatch')
          reasons.push(indexChecks.bm25.reason ?? 'bm25_chunk_count_mismatch');
        if (indexChecks.elasticsearch.status === 'mismatch')
          reasons.push(
            indexChecks.elasticsearch.reason ??
              'elasticsearch_index_count_mismatch',
          );
        if (indexChecks.milvus.status === 'mismatch')
          reasons.push('milvus_chunk_count_mismatch');
        if (indexChecks.milvus.status === 'unavailable')
          reasons.push('milvus_unavailable');
        if (indexChecks.image.status === 'mismatch')
          reasons.push('image_index_count_mismatch');
        if (indexChecks.image.status === 'unavailable')
          reasons.push('image_index_unavailable');
        if (indexChecks.graph.status === 'mismatch')
          reasons.push('graph_index_missing');
        if (indexChecks.retrievalDescriptions.status === 'mismatch') {
          reasons.push(...descriptionReasons);
        }
        if (indexChecks.retrievalDescriptions.status === 'unavailable') {
          reasons.push('retrieval_description_audit_unavailable');
        }
        if (doc.graphIndexStatus === 'failed')
          reasons.push('graph_index_failed');
        if (doc.graphIndexStatus === 'pending')
          reasons.push('graph_index_pending');
        if (
          doc.lifecycleStatus === 'effective' &&
          doc.reviewStatus !== 'approved'
        )
          reasons.push('effective_without_approval');
        if (
          doc.lifecycleStatus === 'effective' &&
          doc.expiredAt &&
          doc.expiredAt.getTime() <= now
        )
          reasons.push('expired_but_effective');
        return {
          docId: doc.docId,
          filename: doc.filename,
          chunkCount: expected,
          lifecycleStatus: doc.lifecycleStatus,
          reviewStatus: doc.reviewStatus,
          graphIndexStatus: doc.graphIndexStatus,
          checks: indexChecks,
          reasons: [...new Set(reasons)],
        };
        }),
      );
      checks.push(...batchChecks);
    }
    const issues = checks.filter((item) => item.reasons.length > 0);
    const count = (reason: string) =>
      issues.filter((item) => item.reasons.includes(reason)).length;
    return {
      available: true,
      scanned: docs.length,
      nextCursor:
        docs.length === pageSize
          ? {
              createdAt: docs[docs.length - 1].createdAt.toISOString(),
              docId: docs[docs.length - 1].docId,
            }
          : null,
      issueCount: issues.length,
      counts: {
        missingChunks: count('missing_chunks'),
        graphIndexFailed: count('graph_index_failed'),
        graphIndexPending: count('graph_index_pending'),
        effectiveWithoutApproval: count('effective_without_approval'),
        expiredButEffective: count('expired_but_effective'),
        metadataChunkCountMismatch: count('metadata_chunk_count_mismatch'),
        bm25ChunkCountMismatch: count('bm25_chunk_count_mismatch'),
        elasticsearchIndexCountMismatch: count(
          'elasticsearch_index_count_mismatch',
        ),
        milvusChunkCountMismatch: count('milvus_chunk_count_mismatch'),
        bm25ContentHashMismatch: count('bm25_content_hash_mismatch'),
        elasticsearchContentHashMismatch: count(
          'elasticsearch_content_hash_mismatch',
        ),
        bm25GenerationMismatch: count('bm25_generation_mismatch'),
        elasticsearchGenerationMismatch: count(
          'elasticsearch_generation_mismatch',
        ),
        milvusUnavailable: count('milvus_unavailable'),
        imageIndexCountMismatch: count('image_index_count_mismatch'),
        imageIndexUnavailable: count('image_index_unavailable'),
        graphIndexMissing: count('graph_index_missing'),
        retrievalDescriptionMismatch: issues.filter((item) =>
          item.reasons.some((reason) =>
            reason.startsWith('retrieval_description_'),
          ),
        ).length,
      },
      issues,
      checks,
      repairActions: [
        'POST /rag/admin/documents/:docId/reindex',
        'POST /rag/admin/documents/tasks/:taskId/retry',
      ],
    };
  }

  private async readIndexCheck(
    available: boolean,
    read: () => Promise<number>,
    expected: number,
    indexName: string,
  ): Promise<IndexAuditCheck> {
    if (!available) {
      return {
        status: 'unavailable',
        expected,
        reason: `${indexName}_unavailable`,
      };
    }
    try {
      const actual = await read();
      return {
        status: actual === expected ? 'ok' : 'mismatch',
        expected,
        actual,
        ...(actual === expected
          ? {}
          : { reason: `${indexName}_count_mismatch` }),
      };
    } catch (err) {
      return {
        status: 'unavailable',
        expected,
        reason: `${indexName}_unavailable:${(err as Error).message}`,
      };
    }
  }

  private async readGraphIndexCheck(
    graphIndexStatus: DocumentMetaEntity['graphIndexStatus'],
    docId: string,
    userId: string,
  ): Promise<IndexAuditCheck> {
    if (!this.graphService.isEnabled()) {
      return { status: 'skipped', reason: 'graph_disabled' };
    }
    if (graphIndexStatus !== 'indexed') {
      return {
        status: graphIndexStatus === 'failed' ? 'mismatch' : 'skipped',
        sourcePresent: false,
        reason: `graph_status_${graphIndexStatus}`,
      };
    }
    try {
      const result = await this.graphService.getSourceIndexStatus(
        docId,
        userId,
      );
      return {
        status: result.sourcePresent ? 'ok' : 'mismatch',
        actual: result.nodeCount + result.relationshipCount,
        sourcePresent: result.sourcePresent,
        reason: result.sourcePresent ? undefined : 'graph_source_missing',
      };
    } catch (err) {
      return {
        status: 'unavailable',
        reason: `graph_unavailable:${(err as Error).message}`,
      };
    }
  }

  async repairDocumentIndexes(input: { docIds?: string[]; limit?: number }) {
    const audit = await this.auditDocumentIndexes(input.limit ?? 200);
    const requested = input.docIds?.length ? new Set(input.docIds) : null;
    const targets = audit.issues.filter(
      (issue) => !requested || requested.has(issue.docId),
    );
    if (
      this.indexRepairQueue?.isEnabled() ||
      this.indexRepairQueue?.isRequired()
    ) {
      const jobs = [];
      for (const issue of targets) {
        const job = {
          id: IndexRepairQueueService.jobId(
            issue.docId,
            JSON.stringify({ reasons: issue.reasons, checks: issue.checks }),
          ),
          docId: issue.docId,
          requestedBy: 'rag-admin',
          reason: issue.reasons.join(','),
        };
        const queued = await this.indexRepairQueue.enqueue(job);
        jobs.push({ ...job, queued });
      }
      return {
        available: true,
        queued: true,
        requested: targets.length,
        jobs,
        queue: await this.indexRepairQueue.getStatus(),
      };
    }
    const results = await Promise.all(
      targets.map((issue) =>
        this.isDescriptionOnlyRepairReason(issue.reasons.join(','))
          ? this.repairRetrievalDescriptions(issue.docId)
          : this.reindexDocument(issue.docId),
      ),
    );
    return { available: true, requested: targets.length, results };
  }

  private isDescriptionOnlyRepairReason(reason?: string): boolean {
    const reasons = reason
      ?.split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    return Boolean(
      reasons?.length &&
      reasons.every((item) => item.startsWith('retrieval_description_')),
    );
  }

  private async repairRetrievalDescriptions(docId: string) {
    const document = await this.docMetaRepo.findOne({ where: { docId } });
    if (!document) return null;
    try {
      const retrievalDescriptions =
        await this.rebuildAndAuditRetrievalDescriptions(document);
      return {
        docId,
        reindexed: true,
        descriptionOnly: true,
        retrievalDescriptions,
      };
    } catch (err) {
      const reason = (err as Error).message;
      this.logger.error(
        `Retrieval description repair failed for docId=${docId}: ${reason}`,
      );
      return { docId, reindexed: false, reason };
    }
  }

  getIndexRepairQueueStatus() {
    return (
      this.indexRepairQueue?.getStatus() ??
      Promise.resolve({
        enabled: false,
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
      })
    );
  }

  getFailedIndexRepairs(limit = 50) {
    return this.indexRepairQueue?.listFailed(limit) ?? Promise.resolve([]);
  }

  retryIndexRepair(jobId: string) {
    return (
      this.indexRepairQueue?.retryFailed(jobId) ??
      Promise.resolve({ retried: false, reason: 'queue is disabled' })
    );
  }

  async listSecurityAudit(limit = 100) {
    const events = await this.domainEvents.listOutbox(
      Math.min(Math.max(limit, 1), 500),
      'security.query_blocked',
    );
    return {
      available: true,
      events,
    };
  }

  retryFailedDocumentTask(taskId: string) {
    return this.documentService.retryFailedTask(taskId);
  }

  cancelQueuedDocumentTask(taskId: string) {
    return this.documentService.cancelQueuedTask(taskId);
  }

  private async updateDocumentReview(
    docId: string,
    reviewStatus: DocumentMetaEntity['reviewStatus'],
    action: DocumentReviewEntity['action'],
    operatorId?: string,
    comment?: string,
  ) {
    const doc = await this.docMetaRepo.findOne({ where: { docId } });
    if (!doc) return null;
    const now = new Date();
    await this.docMetaRepo.manager.transaction(async (manager) => {
      await manager.getRepository(DocumentMetaEntity).update(docId, {
        reviewStatus,
        reviewedBy: operatorId ?? null,
        reviewedAt: action === 'submitted' ? null : now,
        reviewComment: comment?.trim() || null,
      });
      await manager.getRepository(DocumentReviewEntity).save(
        this.documentReviewRepo.create({
          id: randomUUID(),
          docId,
          action,
          operatorId: operatorId ?? null,
          comment: comment?.trim() || null,
        }),
      );
      if (action === 'approved' || action === 'rejected') {
        await this.domainEvents.emitInTransaction(manager, {
          eventType: `document.review_${action}`,
          aggregateType: 'document',
          aggregateId: docId,
          payload: { reviewStatus, operatorId: operatorId ?? null },
        });
      }
    });
    return { docId, reviewStatus, action };
  }

  private toDocumentVersionItem(doc: DocumentMetaEntity) {
    return {
      docId: doc.docId,
      filename: doc.filename,
      docVersion: doc.docVersion ?? 'unknown',
      lifecycleStatus: doc.lifecycleStatus,
      reviewStatus: doc.reviewStatus,
      supersedesDocId: doc.supersedesDocId,
      effectiveAt: doc.effectiveAt?.toISOString() ?? null,
      expiredAt: doc.expiredAt?.toISOString() ?? null,
      createdAt: doc.createdAt.toISOString(),
      chunkCount: doc.chunkCount,
    };
  }

  async getDocumentChunks(docId: string) {
    const chunks = await this.chunkRepo.find({
      where: { docId },
      order: { chunkIndex: 'ASC' },
    });

    return chunks.map((chunk) => ({
      id: chunk.id,
      docId: chunk.docId,
      chunkIndex: chunk.chunkIndex,
      chunkType: chunk.chunkType,
      content: chunk.content.slice(0, 500),
      contentLength: chunk.content.length,
      headingPath: chunk.headingPath
        ? (JSON.parse(chunk.headingPath) as string[])
        : [],
      sectionId: chunk.sectionId,
      clauseId: chunk.clauseId,
      tableRef: chunk.tableRef,
      sourceStart: chunk.sourceStart,
      sourceEnd: chunk.sourceEnd,
      docVersion: chunk.docVersion,
      effectiveAt: chunk.effectiveAt?.toISOString() ?? null,
      expiredAt: chunk.expiredAt?.toISOString() ?? null,
      sourceAuthority: chunk.sourceAuthority,
    }));
  }

  async reindexDocument(docId: string) {
    const doc = await this.docMetaRepo.findOne({ where: { docId } });
    if (!doc) return null;
    const imageIndexEnabled = this.imageIndexService?.isEnabled() ?? false;

    const chunks = await this.chunkRepo.find({
      where: { docId },
      order: { chunkIndex: 'ASC' },
    });

    if (chunks.length === 0) {
      try {
        const restored =
          await this.documentService.restoreDocumentFromOriginal(docId);
        if (
          restored &&
          imageIndexEnabled &&
          restored.imageIndex?.indexed === false
        ) {
          return {
            docId,
            reindexed: false,
            reason: `Image index rebuild failed: ${restored.imageIndex.reason ?? 'unknown error'}`,
          };
        }
        return restored
          ? { ...restored, reindexed: true, restoredFromOriginal: true }
          : { docId, reindexed: false, reason: 'document not found' };
      } catch (err) {
        const reason = (err as Error).message;
        this.logger.error(
          `Document restore failed for docId=${docId}: ${reason}`,
        );
        return { docId, reindexed: false, reason };
      }
    }

    const userId = doc.userId ?? 'system';
    const content = chunks.map((chunk) => chunk.content).join('\n\n');

    try {
      const vectors = await this.embeddingProvider.embedDocuments(
        chunks.map((chunk) => chunk.content),
      );
      if (vectors.length !== chunks.length) {
        throw new Error('embedding count does not match stored chunks');
      }

      // PostgreSQL remains the source of truth. Rebuild only derived indexes;
      // a failed repair can be retried without deleting the document or its ACL.
      await this.vectorStoreProvider.deleteByDocId(docId);
      await this.vectorStoreProvider.insert(
        chunks.map((chunk, index) => ({
          id: chunk.id,
          vector: vectors[index],
          content: chunk.content,
          docId,
          chunkIndex: chunk.chunkIndex,
          userId,
        })),
      );
      const indexedVectorCount = await this.vectorStoreProvider.countByDocId(
        docId,
        userId,
      );
      if (indexedVectorCount !== chunks.length) {
        throw new Error(
          `Milvus reindex count mismatch: expected ${chunks.length}, received ${indexedVectorCount}`,
        );
      }

      const parseArray = (value: string | null | undefined): string[] => {
        if (!value) return [];
        try {
          const parsed: unknown = JSON.parse(value);
          return Array.isArray(parsed)
            ? parsed.filter((item): item is string => typeof item === 'string')
            : [];
        } catch {
          return [];
        }
      };
      const indexedChunks = chunks.map((chunk) => ({
        ...chunk,
        userId: chunk.userId ?? userId,
        tenantId: chunk.tenantId ?? doc.tenantId ?? 'legacy',
        headingPath: parseArray(chunk.headingPath),
        roleScope: parseArray(chunk.roleScope),
        hypotheticalQuestions: parseArray(chunk.hypotheticalQuestions),
      }));
      this.karpathyRagService.removeDocChunks(docId, userId);
      this.karpathyRagService.indexChunks(indexedChunks, userId);

      if (this.elasticsearchProvider.isEnabled()) {
        await this.elasticsearchProvider.deleteByDocId(docId, userId);
        await this.elasticsearchProvider.indexChunks(
          indexedChunks,
          userId,
          vectors,
        );
        await this.elasticsearchProvider.indexDocument({
          docId,
          filename: doc.filename,
          content,
          userId,
          tenantId: doc.tenantId ?? 'legacy',
          title: doc.title ?? doc.filename,
          summary: doc.summary,
          sourceAuthority: doc.sourceAuthority,
          projectId: doc.projectId,
          activityId: doc.activityId,
          region: doc.region,
          locale: doc.locale,
          channel: doc.channel,
          roleScope: parseArray(doc.roleScope),
          documentType: doc.documentType,
          lifecycleStatus: doc.lifecycleStatus,
          docVersion: doc.docVersion,
          contentHash: doc.contentHash,
          indexGeneration: doc.indexGeneration,
          effectiveAt: doc.effectiveAt,
          expiredAt: doc.expiredAt,
        });
        const es = await this.elasticsearchProvider.getIndexCountsByDocId(
          docId,
          userId,
        );
        const expectedHashes = [
          ...new Set(
            chunks
              .map((chunk) => chunk.contentHash)
              .filter((value): value is string => Boolean(value)),
          ),
        ];
        const expectedGenerations = [
          ...new Set(
            chunks
              .map((chunk) => chunk.indexGeneration)
              .filter((value): value is string => Boolean(value)),
          ),
        ];
        const hasExpectedHashes =
          expectedHashes.length === 0 ||
          (es.contentHashes?.length === expectedHashes.length &&
            expectedHashes.every((hash) => es.contentHashes?.includes(hash)));
        const hasExpectedGenerations =
          expectedGenerations.length === 0 ||
          (es.indexGenerations?.length === expectedGenerations.length &&
            expectedGenerations.every((generation) =>
              es.indexGenerations?.includes(generation),
            ));
        if (
          !es.available ||
          es.chunkCount !== chunks.length ||
          es.documentCount !== 1 ||
          !hasExpectedHashes ||
          !hasExpectedGenerations
        ) {
          throw new Error(
            es.reason ??
              'elasticsearch reindex count, content hash, or generation verification failed',
          );
        }
      }

      if (this.graphService.isEnabled()) {
        const graph = await this.graphService.importText(
          content,
          userId,
          docId,
        );
        await this.docMetaRepo.update(
          { docId },
          {
            graphIndexStatus: 'indexed',
            graphIndexedAt: new Date(),
            graphIndexError: null,
          },
        );
        this.logger.log(
          `Graph index repaired: docId=${docId}, nodes=${graph.nodeCount}, relationships=${graph.relationshipCount}`,
        );
      }

      const retrievalDescriptions =
        await this.rebuildAndAuditRetrievalDescriptions(doc);
      const imageIndex =
        await this.documentService.rebuildImageIndexFromOriginal(docId);
      if (imageIndexEnabled && !imageIndex.indexed) {
        throw new Error(
          `Image index rebuild failed: ${imageIndex.reason ?? 'unknown error'}`,
        );
      }

      return {
        docId,
        reindexed: true,
        chunkCount: chunks.length,
        preserved: { tenantId: doc.tenantId ?? 'legacy', permissions: true },
        retrievalDescriptions,
        imageIndex,
      };
    } catch (err) {
      this.logger.error(
        `Reindex failed for docId=${docId}: ${(err as Error).message}`,
      );
      return {
        docId,
        reindexed: false,
        reason: (err as Error).message,
      };
    }
  }

  private async rebuildAndAuditRetrievalDescriptions(
    document: Pick<DocumentMetaEntity, 'tenantId' | 'docId'>,
  ) {
    const tenantId = document.tenantId ?? 'legacy';
    const rebuild = await this.retrievalDescriptionService.rebuild({
      tenantId,
      docId: document.docId,
    });
    const audit = await this.retrievalDescriptionService.auditForDocument({
      tenantId,
      docId: document.docId,
    });
    if (
      !audit.documentFound ||
      audit.expectedCount !== audit.pgCount ||
      audit.expectedCount !== audit.milvusCount ||
      audit.missingCount > 0 ||
      audit.staleCount > 0 ||
      audit.contentMismatchCount > 0 ||
      audit.sourceMappingMismatchCount > 0
    ) {
      throw new Error(
        `retrieval description verification failed: ${JSON.stringify(audit)}`,
      );
    }
    return { ...rebuild, audit };
  }

  async updateDocumentPermissions(
    docId: string,
    subjects: Array<{
      type: 'user' | 'role' | 'department' | 'public';
      id: string;
    }>,
  ) {
    const doc = await this.docMetaRepo.findOne({ where: { docId } });
    if (!doc) {
      return { docId, updated: false, reason: 'document not found' };
    }
    await this.documentService.setPermissions(docId, subjects);
    return {
      docId,
      updated: true,
      subjectCount: subjects.length,
    };
  }

  async batchDocumentOperation(body: {
    action?: 'reindex' | 'delete' | 'status';
    docIds?: string[];
    userId?: string;
  }) {
    const action = body.action ?? 'status';
    const docIds = body.docIds ?? [];
    const results: Array<Record<string, unknown> | null> = [];

    for (const docId of docIds) {
      if (action === 'reindex') {
        results.push(await this.reindexDocument(docId));
        continue;
      }

      if (action === 'delete') {
        const doc = await this.docMetaRepo.findOne({ where: { docId } });
        if (!doc) {
          results.push({ docId, deleted: false, reason: 'document not found' });
          continue;
        }
        await this.documentService.delete(
          docId,
          body.userId ?? doc.userId ?? 'system',
        );
        results.push({ docId, deleted: true });
        continue;
      }

      const doc = await this.docMetaRepo.findOne({ where: { docId } });
      results.push({
        docId,
        exists: !!doc,
        chunkCount: doc?.chunkCount ?? 0,
      });
    }

    return {
      action,
      processed: results.length,
      results,
    };
  }

  // ─── Vector Index ────────────────────────────────────────────

  async getVectorIndex(): Promise<VectorIndexResponse> {
    const indexInfo = this.vectorStoreProvider.getIndexInfo();
    const runtimeStatus = this.vectorStoreProvider.getRuntimeStatus();
    const bm25Stats = this.karpathyRagService.getStats();
    const dbChunkCount = await this.chunkRepo.count();

    return {
      provider: indexInfo.provider,
      collectionName: indexInfo.collection,
      indexType: indexInfo.indexType,
      metricType: indexInfo.metricType,
      chunkCount: dbChunkCount || bm25Stats.totalChunks || 0,
      status: runtimeStatus.status,
      statusReason: runtimeStatus.lastFailureMessage,
      circuitState: runtimeStatus.circuitState,
      consecutiveFailures: runtimeStatus.consecutiveFailures,
      lastFailureAt: runtimeStatus.lastFailureAt,
      circuitOpenUntil: runtimeStatus.circuitOpenUntil,
      params: indexInfo.params,
    };
  }

  // ─── Evaluations ─────────────────────────────────────────────

  getEvaluations(): EvaluationSummary[] {
    return readEvaluationReportSummaries();
  }

  runEvaluation(dto: RagEvaluationRunDto) {
    const dataset = dto.dataset ?? 'rag-smoke';
    const mode = dto.mode ?? 'offline';
    const command =
      mode === 'live'
        ? 'pnpm --dir backend eval:rag:e2e'
        : mode === 'project'
          ? 'pnpm --dir backend eval:rag:project'
          : 'pnpm --dir backend eval:rag';

    return {
      triggered: false,
      status: 'not_started',
      dataset,
      mode,
      command,
      note: '此接口目前不会启动评测任务；请在仓库中运行 command 字段给出的命令。',
    };
  }

  // ─── Conversations ────────────────────────────────────────────

  async listConversations(
    userId: string,
    tenantId: string,
  ): Promise<ConversationSummary[]> {
    const list = await this.conversationService.listConversations(
      userId,
      tenantId,
    );
    return list.map((item) => ({
      threadId: item.threadId,
      title: item.title,
      mode: item.mode,
      messageCount: item.messageCount,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }));
  }

  async getConversation(threadId: string, userId: string, tenantId: string) {
    const conv = await this.conversationService.get(threadId, userId, tenantId);
    if (!conv) return null;
    return {
      threadId: conv.threadId,
      title: conv.title,
      messages: conv.messages,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
    };
  }

  async deleteConversation(
    threadId: string,
    userId: string,
    tenantId: string,
  ): Promise<boolean> {
    return this.conversationService.delete(threadId, userId, tenantId);
  }

  // ─── Search Operations ───────────────────────────────────────

  async getQueryDailyTrend(days = 14) {
    const items = await this.queryLogService.getDailyTrend(days);
    return { available: true, data: items };
  }

  async getSearchPopularQueries() {
    const queries = await this.queryLogService.getPopularQueries(20);
    return { available: true, data: queries };
  }

  async getSearchNoResultQueries() {
    const queries = await this.queryLogService.getNoResultQueries(20);
    return { available: true, data: queries };
  }

  async getSearchRecallIssues() {
    const issues = await this.queryLogService.getRecallIssues(20);
    return { available: true, data: issues };
  }

  // ─── QA Operations ────────────────────────────────────────────

  async getQaNegativeFeedback() {
    // 用被拒答的查询作为负反馈信号
    const refused = await this.queryLogService.getNoResultQueries(20);
    return {
      available: true,
      data: refused,
      note: 'Negative feedback derived from refused queries. User-facing feedback collection requires frontend integration.',
    };
  }

  async getQaCitationFailures() {
    const issues = await this.queryLogService.getRecallIssues(20);
    return {
      available: true,
      data: issues,
      note: 'Citation failures detected from queries with 0 citations but hasAnswer=true.',
    };
  }

  async getQaCostSummary() {
    const summary = await this.queryLogService.getCostSummary();
    return { available: true, data: summary };
  }
}

function imageAssetContentType(key: string): string | null {
  const extension = key.split('.').at(-1)?.toLowerCase();
  const contentTypes: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
  };
  return extension ? contentTypes[extension] ?? null : null;
}
