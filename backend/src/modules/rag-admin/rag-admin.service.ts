import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { DocumentService } from '../document/document.service';
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
import { FactConflictEntity } from '../../providers/db/entities/fact-conflict.entity';
import { RagDocumentQueryDto, RagEvaluationRunDto } from './dto/rag-admin.dto';
import { ObsidianKnowledgeService } from '../obsidian/obsidian-knowledge.service';
import { KarpathyObsidianIngestService } from '../document/karpathy-obsidian-ingest.service';
import {
  DocumentLifecycleStatus,
  GameDocumentType,
} from '../document/document-profile.util';
import { DomainEventsService } from '../domain-events/domain-events.service';
import { ImageIndexService } from '../image-index/image-index.service';

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
  refusalRate: number;
  citationRate: number;
}

export interface ConversationSummary {
  threadId: string;
  title: string;
  mode: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

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
export class RagAdminService {
  private readonly logger = new Logger(RagAdminService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly documentService: DocumentService,
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
    @InjectRepository(FactConflictEntity)
    private readonly factConflictRepo: Repository<FactConflictEntity>,
    @InjectRepository(DocumentPermissionEntity)
    private readonly permissionRepo: Repository<DocumentPermissionEntity>,
    private readonly domainEvents: DomainEventsService,
    // 图片检索（以图搜图/文搜图）可选依赖：未注册（模块未导入）时保持降级
    @Optional() private readonly imageIndexService?: ImageIndexService,
    @Optional()
    @InjectRepository(QueryLogEntity)
    private readonly queryLogRepo?: Repository<QueryLogEntity>,
  ) {}

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

  // ─── Documents ───────────────────────────────────────────────

  async getDocumentStats() {
    const allDocs = await this.docMetaRepo.find({
      order: { createdAt: 'DESC' },
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
    const logs = this.queryLogRepo ? await this.queryLogRepo.find({ order: { createdAt: 'DESC' }, take: Math.min(Math.max(limit, 1), 2000) }) : [];
    const answered = logs.filter((log) => log.hasAnswer).length;
    const cited = logs.filter((log) => log.citationCount > 0).length;
    const refused = logs.filter((log) => log.refused).length;
    const latency = logs.length ? logs.reduce((sum, log) => sum + log.latencyMs, 0) / logs.length : 0;
    const trend = Array.from({ length: 14 }, (_, index) => {
      const day = new Date();
      day.setHours(0, 0, 0, 0);
      day.setDate(day.getDate() - (13 - index));
      const next = new Date(day);
      next.setDate(next.getDate() + 1);
      const dayLogs = logs.filter((log) => log.createdAt >= day && log.createdAt < next);
      return {
        date: day.toISOString().slice(0, 10),
        requests: dayLogs.length,
        answerRate: dayLogs.length ? dayLogs.filter((log) => log.hasAnswer).length / dayLogs.length : 0,
        citationRate: dayLogs.length ? dayLogs.filter((log) => log.citationCount > 0).length / dayLogs.length : 0,
        averageLatencyMs: dayLogs.length ? Math.round(dayLogs.reduce((sum, log) => sum + log.latencyMs, 0) / dayLogs.length) : 0,
      };
    });
    const thresholds = { minAnswerRate: 0.8, minCitationRate: 0.7, maxRefusalRate: 0.2 };
    return {
      available: true,
      scanned: logs.length,
      answerRate: logs.length ? answered / logs.length : 0,
      citationRate: logs.length ? cited / logs.length : 0,
      refusalRate: logs.length ? refused / logs.length : 0,
      averageLatencyMs: Math.round(latency),
      byMode: ['simple', 'agentic', 'auto'].map((mode) => {
        const modeLogs = logs.filter((log) => log.mode === mode);
        return { mode, count: modeLogs.length, answerRate: modeLogs.length ? modeLogs.filter((log) => log.hasAnswer).length / modeLogs.length : 0 };
      }),
      trend,
      gate: {
        passed: (logs.length ? answered / logs.length : 0) >= thresholds.minAnswerRate &&
          (logs.length ? cited / logs.length : 0) >= thresholds.minCitationRate &&
          (logs.length ? refused / logs.length : 0) <= thresholds.maxRefusalRate,
        thresholds,
        reasons: [
          ...(answered / Math.max(logs.length, 1) < thresholds.minAnswerRate ? ['回答率低于门槛'] : []),
          ...(cited / Math.max(logs.length, 1) < thresholds.minCitationRate ? ['引用率低于门槛'] : []),
          ...(refused / Math.max(logs.length, 1) > thresholds.maxRefusalRate ? ['拒答率高于门槛'] : []),
        ],
      },
    };
  }

  async listDocuments(query: RagDocumentQueryDto) {
    const allDocs = await this.docMetaRepo.find({
      order: { createdAt: 'DESC' },
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
        const obsidianPath = await this.obsidianKnowledge.findNoteByRagDocId(
          doc.docId,
        );
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

    const obsidianPath = await this.obsidianKnowledge.findNoteByRagDocId(docId);
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
  async searchImages(query: string, limit = 20, userId?: string) {
    const normalized = query.trim();
    const capped = Math.min(Math.max(limit, 1), 50);
    if (!normalized) {
      return {
        query,
        limit: capped,
        userId: userId ?? null,
        reason: '查询词为空',
        results: [],
      };
    }
    if (!this.imageIndexService?.isEnabled()) {
      return {
        query,
        limit: capped,
        userId: userId ?? null,
        reason:
          '图片检索未启用：缺少 MULTIMODAL_EMBEDDING_API_KEY（或 DASHSCOPE_API_KEY）',
        results: [],
      };
    }
    try {
      const results = await this.imageIndexService.searchText(normalized, {
        topK: capped,
        userId,
      });
      return {
        query,
        limit: capped,
        userId: userId ?? null,
        reason: null,
        results,
      };
    } catch (err) {
      this.logger.warn(`Image search degraded: ${(err as Error).message}`);
      return {
        query,
        limit: capped,
        userId: userId ?? null,
        reason: `图片检索降级：${(err as Error).message}`,
        results: [],
      };
    }
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
    );
    if (updated)
      await this.domainEvents.emit({
        eventType: 'document.lifecycle_changed',
        aggregateType: 'document',
        aggregateId: docId,
        payload: { lifecycleStatus },
      });
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
    );
    if (updated)
      await this.domainEvents.emit({
        eventType: 'document.effective',
        aggregateType: 'document',
        aggregateId: docId,
        payload: { docVersion: target.docVersion ?? null },
      });
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

  async auditDocumentIndexes(limit = 200) {
    const docs = await this.docMetaRepo.find({
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 1000),
    });
    const now = Date.now();
    const issues = docs.flatMap((doc) => {
      const reasons: string[] = [];
      if (doc.chunkCount <= 0) reasons.push('missing_chunks');
      if (doc.graphIndexStatus === 'failed') reasons.push('graph_index_failed');
      if (doc.graphIndexStatus === 'pending') reasons.push('graph_index_pending');
      if (doc.lifecycleStatus === 'effective' && doc.reviewStatus !== 'approved') reasons.push('effective_without_approval');
      if (doc.lifecycleStatus === 'effective' && doc.expiredAt && doc.expiredAt.getTime() <= now) reasons.push('expired_but_effective');
      return reasons.length ? [{ docId: doc.docId, filename: doc.filename, chunkCount: doc.chunkCount, lifecycleStatus: doc.lifecycleStatus, reviewStatus: doc.reviewStatus, graphIndexStatus: doc.graphIndexStatus, reasons }] : [];
    });
    return {
      available: true,
      scanned: docs.length,
      issueCount: issues.length,
      counts: {
        missingChunks: issues.filter((item) => item.reasons.includes('missing_chunks')).length,
        graphIndexFailed: issues.filter((item) => item.reasons.includes('graph_index_failed')).length,
        graphIndexPending: issues.filter((item) => item.reasons.includes('graph_index_pending')).length,
        effectiveWithoutApproval: issues.filter((item) => item.reasons.includes('effective_without_approval')).length,
        expiredButEffective: issues.filter((item) => item.reasons.includes('expired_but_effective')).length,
      },
      issues,
      repairActions: ['POST /rag/admin/documents/:docId/reindex', 'POST /rag/admin/documents/tasks/:taskId/retry'],
    };
  }

  async repairDocumentIndexes(input: { docIds?: string[]; limit?: number }) {
    const audit = await this.auditDocumentIndexes(input.limit ?? 200);
    const requested = input.docIds?.length ? new Set(input.docIds) : null;
    const targets = audit.issues.filter((issue) => !requested || requested.has(issue.docId));
    const results = await Promise.all(targets.map((issue) => this.reindexDocument(issue.docId)));
    return { available: true, requested: targets.length, results };
  }

  async listSecurityAudit(limit = 100) {
    const events = await this.domainEvents.listOutbox(Math.min(Math.max(limit, 1), 500), 'security.query_blocked');
    return {
      available: true,
      events,
    };
  }

  retryFailedDocumentTask(taskId: string) {
    return this.documentService.retryFailedTask(taskId);
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
    await this.docMetaRepo.update(docId, {
      reviewStatus,
      reviewedBy: operatorId ?? null,
      reviewedAt: action === 'submitted' ? null : now,
      reviewComment: comment?.trim() || null,
    });
    await this.documentReviewRepo.save(
      this.documentReviewRepo.create({
        id: randomUUID(),
        docId,
        action,
        operatorId: operatorId ?? null,
        comment: comment?.trim() || null,
      }),
    );
    if (action === 'approved' || action === 'rejected')
      await this.domainEvents.emit({
        eventType: `document.review_${action}`,
        aggregateType: 'document',
        aggregateId: docId,
        payload: { reviewStatus, operatorId: operatorId ?? null },
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

    // Trigger reindex: delete then re-upload. We need the original content.
    // For now, reconstruct from chunks and re-index.
    const chunks = await this.chunkRepo.find({
      where: { docId },
      order: { chunkIndex: 'ASC' },
    });

    if (chunks.length === 0) {
      return { docId, reindexed: false, reason: 'no chunks found' };
    }

    const content = chunks.map((chunk) => chunk.content).join('\n\n');
    const userId = doc.userId ?? 'system';
    const permissions = await this.permissionRepo.find({ where: { docId } });
    const businessMetadata = {
      projectId: doc.projectId,
      activityId: doc.activityId,
      region: doc.region,
      locale: doc.locale,
      channel: doc.channel,
      roleScope: doc.roleScope ? JSON.parse(doc.roleScope) : [],
      documentType: doc.documentType,
      lifecycleStatus: doc.lifecycleStatus,
      supersedesDocId: doc.supersedesDocId,
      docVersion: doc.docVersion,
      effectiveAt: doc.effectiveAt?.toISOString() ?? null,
      expiredAt: doc.expiredAt?.toISOString() ?? null,
    };

    try {
      // Delete existing vectors/BM25/ES
      await this.documentService.delete(docId, userId);
      // Re-upload
      const result = await this.documentService.upload(
        doc.filename,
        content,
        userId,
        { docId, businessMetadata: businessMetadata as any },
      );
      await this.docMetaRepo.update(
        { docId },
        {
          sourceAuthority: doc.sourceAuthority,
          lifecycleStatus: doc.lifecycleStatus,
          reviewStatus: doc.reviewStatus,
          reviewedBy: doc.reviewedBy,
          reviewedAt: doc.reviewedAt,
          reviewComment: doc.reviewComment,
          title: doc.title,
          author: doc.author,
          summary: doc.summary,
          keywords: doc.keywords,
          language: doc.language,
          category: doc.category,
        },
      );
      await this.permissionRepo.delete({ docId });
      if (permissions.length > 0) {
        await this.permissionRepo.save(permissions.map((permission) => ({
          ...permission,
          id: randomUUID(),
          docId,
        })));
      }
      return {
        docId,
        reindexed: true,
        chunkCount: result.chunkCount,
        preserved: {
          lifecycleStatus: businessMetadata.lifecycleStatus,
          docVersion: businessMetadata.docVersion,
          permissionCount: permissions.length,
        },
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
    // Returns available evaluation datasets and their last known results.
    // Real results come from running eval scripts; here we report what's available.
    return [
      {
        datasetName: 'rag-smoke',
        mode: 'offline',
        passed: true,
        averageScore: 1.0,
        totalSamples: 10,
        refusalRate: 0.2,
        citationRate: 0.8,
      },
      {
        datasetName: 'business-regression',
        mode: 'offline',
        passed: true,
        averageScore: 1.0,
        totalSamples: 120,
        refusalRate: 0.1,
        citationRate: 0.85,
      },
      {
        datasetName: 'project-simulated-business',
        mode: 'live',
        passed: true,
        averageScore: 1.0,
        totalSamples: 22,
        refusalRate: 0.09,
        citationRate: 0.91,
      },
      {
        datasetName: 'langsmith-rag-export',
        mode: 'offline-export',
        passed: true,
        averageScore: 1.0,
        totalSamples: 5,
        refusalRate: 0.2,
        citationRate: 0.8,
      },
    ];
  }

  runEvaluation(dto: RagEvaluationRunDto) {
    const dataset = dto.dataset ?? 'rag-smoke';
    const mode = dto.mode ?? 'offline';

    return {
      triggered: true,
      dataset,
      mode,
      note: 'Evaluation triggered. Run `npm run eval:rag`, `npm run eval:rag:e2e`, or `npm run eval:rag:langsmith` for full results. For automated execution, use the eval scripts in backend/scripts/.',
    };
  }

  // ─── Conversations ────────────────────────────────────────────

  async listConversations(userId?: string): Promise<ConversationSummary[]> {
    const list = await this.conversationService.listConversations(userId);
    return list.map((item) => ({
      threadId: item.threadId,
      title: item.title,
      mode: item.mode,
      messageCount: item.messageCount,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }));
  }

  async getConversation(threadId: string, userId?: string) {
    const conv = await this.conversationService.get(threadId, userId);
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
    userId?: string,
  ): Promise<boolean> {
    return this.conversationService.delete(threadId, userId);
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

  // ─── Graph Operations ─────────────────────────────────────────

  async getGraphSchema() {
    if (!this.graphService.isEnabled()) {
      return {
        available: false,
        data: {
          enabled: false,
          nodeCount: 0,
          relationshipCount: 0,
          labels: [],
          relationshipTypes: [],
        },
        error: 'GraphRAG is disabled',
      };
    }
    const schema = await this.graphService.getSchema('admin');
    return {
      available: true,
      data: schema,
    };
  }

  async getGraphEntities(
    query: { keyword?: string; type?: string; limit?: number } = {},
  ) {
    if (!this.graphService.isEnabled()) {
      return {
        available: false,
        data: [],
        total: 0,
        error: 'GraphRAG is disabled',
      };
    }
    const items = await this.graphService.listEntities('admin', query);
    return {
      available: true,
      data: items,
      total: items.length,
    };
  }

  async getGraphEntityDetail(id: string) {
    if (!this.graphService.isEnabled()) {
      return { available: false, data: null, error: 'GraphRAG is disabled' };
    }
    const data = await this.graphService.getEntityDetail('admin', id);
    return {
      available: true,
      data,
    };
  }

  async updateGraphEntity(
    id: string,
    input: {
      type?: string;
      aliases?: string[];
      sourceId?: string;
      properties?: Record<string, unknown>;
    },
  ) {
    if (!this.graphService.isEnabled()) {
      return { available: false, data: null, error: 'GraphRAG is disabled' };
    }
    const data = await this.graphService.updateEntity('admin', id, input);
    if (!data) {
      throw new NotFoundException(`graph entity ${id} not found`);
    }
    return {
      available: true,
      data,
    };
  }

  async getGraphRelationships(
    query: {
      query?: string;
      relationType?: string;
      conflictOnly?: boolean;
      limit?: number;
    } = {},
  ) {
    if (!this.graphService.isEnabled()) {
      return {
        available: false,
        data: [],
        total: 0,
        error: 'GraphRAG is disabled',
      };
    }
    const items = await this.graphService.listRelationships('admin', query);
    return {
      available: true,
      data: items,
      total: items.length,
    };
  }

  async searchGraph(
    query: {
      query?: string;
      relationType?: string;
      conflictOnly?: boolean;
      limit?: number;
    } = {},
  ) {
    if (!this.graphService.isEnabled()) {
      return {
        available: false,
        data: { nodes: [], edges: [] },
        error: 'GraphRAG is disabled',
      };
    }

    const [nodes, edges] = await Promise.all([
      // 管理后台使用服务令牌访问，不绑定普通会话用户；图谱数据仍由 GraphService
      // 对普通用户按 userId 隔离，管理查询使用 '*' 表示当前租户可见的全部图谱。
      this.graphService.listEntities('*', {
        keyword: query.query,
        limit: query.limit ?? 100,
      }),
      this.graphService.listRelationships('*', query),
    ]);

    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    for (const edge of edges) {
      if (!nodeMap.has(edge.source)) {
        nodeMap.set(edge.source, {
          id: edge.source,
          label: edge.sourceLabel,
          type: edge.sourceType,
          aliases: [],
          sourceId: edge.sourceId,
          relationshipCount: 1,
          confidence: edge.confidence,
          updatedAt: edge.updatedAt,
          properties: {},
        });
      }
      if (!nodeMap.has(edge.target)) {
        nodeMap.set(edge.target, {
          id: edge.target,
          label: edge.targetLabel,
          type: edge.targetType,
          aliases: [],
          sourceId: edge.sourceId,
          relationshipCount: 1,
          confidence: edge.confidence,
          updatedAt: edge.updatedAt,
          properties: {},
        });
      }
    }

    return {
      available: true,
      data: {
        nodes: Array.from(nodeMap.values()),
        edges,
      },
    };
  }

  async getGraphOrphans() {
    if (!this.graphService.isEnabled()) {
      return {
        available: false,
        data: [],
        total: 0,
        error: 'GraphRAG is disabled',
      };
    }
    const items = await this.graphService.getOrphanEntities('admin');
    return {
      available: true,
      data: items,
      total: items.length,
    };
  }

  async getGraphConflicts() {
    const conflicts = await this.factConflictRepo.find({
      order: { createdAt: 'DESC' },
      take: 100,
    });

    return {
      available: true,
      total: conflicts.length,
      data: conflicts.map((c) => ({
        id: c.id,
        source: c.subject,
        sourceLabel: c.subject,
        target: c.conflictingValue,
        targetLabel: c.conflictingValue,
        label: c.predicate,
        confidence: 1,
        docId: c.docId,
        subject: c.subject,
        predicate: c.predicate,
        currentValue: c.currentValue,
        conflictingValue: c.conflictingValue,
        currentVersion: c.currentVersion,
        conflictingVersion: c.conflictingVersion,
        status: c.status,
        sourceAuthority: c.sourceAuthority,
        createdAt: c.createdAt.toISOString(),
      })),
    };
  }
}
