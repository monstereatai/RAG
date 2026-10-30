import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { DocumentService } from '../document/document.service';
import { DocumentPermissionService } from '../document/document-permission.service';
import { GraphService } from '../graph/graph.service';
import { ConversationService } from '../chat/conversation.service';
import {
  RAG_ADMIN_CAPABILITY,
  type RagAdminCapability,
} from '../../rag/contracts/rag-capabilities';
import { ElasticsearchProvider } from '../../providers/elasticsearch/elasticsearch.provider';
import { VectorStoreProvider } from '../../providers/vector-store/vector-store.provider';
import { QueryLogService } from './query-log.service';
import { QueryLogEntity } from '../../providers/db/entities/query-log.entity';
import { DocumentChunkEntity } from '../../providers/db/entities/document-chunk.entity';
import { DocumentMetaEntity } from '../../providers/db/entities/document-meta.entity';
import { DocumentReviewEntity } from '../../providers/db/entities/document-review.entity';
import { DocumentPermissionEntity } from '../../providers/db/entities/document-permission.entity';
import { RagDocumentQueryDto, RagEvaluationRunDto } from './dto/rag-admin.dto';
import { ObsidianKnowledgeService } from '../obsidian/obsidian-knowledge.service';
import { ObsidianIngestService } from '../document/obsidian-ingest.service';
import {
  DocumentChangeType,
  DocumentLifecycleStatus,
  GameDocumentType,
} from '../document/document-profile.util';
import { DomainEventsService } from '../domain-events/domain-events.service';
import { ImageIndexService } from '../image-index/image-index.service';
import { detectDocumentKind } from '../document/document-parser.util';
import { DocumentQueueService } from '../document/document-queue.service';
import { DocumentImageIngestionService } from '../document/document-image-ingestion.service';
import { IndexRepairQueueService } from './index-repair-queue.service';
import { ObjectStorageProvider } from '../../providers/object-storage/object-storage.provider';
import { TencentSpeechProvider } from '../../providers/speech/tencent-speech.provider';
import { VisionProvider } from '../../providers/vision/vision.provider';
import { EmbeddingProvider } from '../../providers/embedding/embedding.provider';
import { DocumentRetrievalDescriptionService } from '../document/document-retrieval-description.service';
import type {
  CapabilitiesResponse,
  VectorIndexResponse,
  EvaluationSummary,
  ConversationSummary,
  DocumentSearchFilters,
  DocumentIndexAuditResult,
} from './rag-admin.service.types';
export type {
  CapabilitiesResponse,
  VectorIndexResponse,
  EvaluationSummary,
  ConversationSummary,
  DocumentSearchFilters,
  DocumentIndexAuditResult,
  DocumentAdminItem,
} from './rag-admin.service.types';
import { RagAdminIngestionWorkflow } from './rag-admin.service.ingestion';
import { RagAdminOverviewWorkflow } from './rag-admin.service.overview';
import { RagAdminDocumentsWorkflow } from './rag-admin.service.documents';
import { RagAdminSearchWorkflow } from './rag-admin.service.search';
import { RagAdminIndexingWorkflow } from './rag-admin.service.indexing';
import { RagAdminAnalyticsWorkflow } from './rag-admin.service.analytics';
import type { RagAdminServiceContext } from './rag-admin.service.context';
import { RagAdminAuditWorkflow } from './rag-admin.service.audit';

/** 文档全文检索的高级筛选（全部可选；不传时行为与原先一致） */

@Injectable()
export class RagAdminService implements OnModuleInit {
  private readonly logger = new Logger(RagAdminService.name);
  private readonly serviceContext: RagAdminServiceContext;
  private readonly ingestionWorkflow: RagAdminIngestionWorkflow;
  private readonly overviewWorkflow: RagAdminOverviewWorkflow;
  private readonly documentsWorkflow: RagAdminDocumentsWorkflow;
  private readonly searchWorkflow: RagAdminSearchWorkflow;
  private readonly indexingWorkflow: RagAdminIndexingWorkflow;
  private readonly analyticsWorkflow: RagAdminAnalyticsWorkflow;
  private readonly auditWorkflow: RagAdminAuditWorkflow;

  constructor(
    private readonly configService: ConfigService,
    private readonly documentService: DocumentService,
    private readonly documentPermissionService: DocumentPermissionService,
    private readonly documentQueue: DocumentQueueService,
    private readonly obsidianIngest: ObsidianIngestService,
    private readonly graphService: GraphService,
    private readonly conversationService: ConversationService,
    @Inject(RAG_ADMIN_CAPABILITY)
    private readonly ragService: RagAdminCapability,
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
    @Optional() private readonly speechProvider?: TencentSpeechProvider,
    @Optional() private readonly visionProvider?: VisionProvider,
  ) {
    this.serviceContext = {
      configService: this.configService,
      documentService: this.documentService,
      documentPermissionService: this.documentPermissionService,
      documentQueue: this.documentQueue,
      obsidianIngest: this.obsidianIngest,
      graphService: this.graphService,
      conversationService: this.conversationService,
      ragService: this.ragService,
      elasticsearchProvider: this.elasticsearchProvider,
      vectorStoreProvider: this.vectorStoreProvider,
      queryLogService: this.queryLogService,
      obsidianKnowledge: this.obsidianKnowledge,
      chunkRepo: this.chunkRepo,
      docMetaRepo: this.docMetaRepo,
      documentReviewRepo: this.documentReviewRepo,
      permissionRepo: this.permissionRepo,
      domainEvents: this.domainEvents,
      embeddingProvider: this.embeddingProvider,
      retrievalDescriptionService: this.retrievalDescriptionService,
      documentImageIngestionService: this.documentImageIngestionService,
      imageIndexService: this.imageIndexService,
      queryLogRepo: this.queryLogRepo,
      indexRepairQueue: this.indexRepairQueue,
      objectStorageProvider: this.objectStorageProvider,
      speechProvider: this.speechProvider,
      visionProvider: this.visionProvider,
      logger: this.logger,
      sanitizeObjectKeyPart: (...args) => this.sanitizeObjectKeyPart(...args),
      reindexDocument: (...args) => this.reindexDocument(...args),
      auditDocumentIndexes: (...args) => this.auditDocumentIndexes(...args),
      promoteDocumentVersion: (...args) => this.promoteDocumentVersion(...args),
      listDocumentVersions: (...args) => this.listDocumentVersions(...args),
    };
    this.ingestionWorkflow = new RagAdminIngestionWorkflow(this.serviceContext);
    this.overviewWorkflow = new RagAdminOverviewWorkflow(this.serviceContext);
    this.documentsWorkflow = new RagAdminDocumentsWorkflow(this.serviceContext);
    this.searchWorkflow = new RagAdminSearchWorkflow(this.serviceContext);
    this.indexingWorkflow = new RagAdminIndexingWorkflow(this.serviceContext);
    this.analyticsWorkflow = new RagAdminAnalyticsWorkflow(this.serviceContext);
    this.auditWorkflow = new RagAdminAuditWorkflow({
      logger: this.logger,
      docMetaRepo: this.docMetaRepo,
      chunkRepo: this.chunkRepo,
      graphService: this.graphService,
      ragService: this.ragService,
      elasticsearchProvider: this.elasticsearchProvider,
      vectorStoreProvider: this.vectorStoreProvider,
      documentImageIngestionService: this.documentImageIngestionService,
      imageIndexService: this.imageIndexService,
      retrievalDescriptionService: this.retrievalDescriptionService,
    });
  }

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
    return this.ingestionWorkflow.uploadDocument(
      file,
      userId,
      fields,
      trustedAdminPrincipal,
    );
  }

  private async extractUploadContent(
    file: Express.Multer.File,
    kind: ReturnType<typeof detectDocumentKind>,
    userId: string,
  ): Promise<string> {
    return this.ingestionWorkflow.extractUploadContent(file, kind, userId);
  }

  async uploadDocumentAsync(
    file: Express.Multer.File,
    userId: string,
    fields: Record<string, unknown> = {},
    trustedAdminPrincipal = false,
  ) {
    return this.ingestionWorkflow.uploadDocumentAsync(
      file,
      userId,
      fields,
      trustedAdminPrincipal,
    );
  }

  private async validateUploadTenant(
    userId: string,
    fields: Record<string, unknown>,
    trustedAdminPrincipal = false,
  ): Promise<string | undefined> {
    return this.ingestionWorkflow.validateUploadTenant(
      userId,
      fields,
      trustedAdminPrincipal,
    );
  }

  private sanitizeObjectKeyPart(value: string): string {
    return value.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown';
  }

  getDocumentTask(taskId: string, userId: string) {
    return this.ingestionWorkflow.getDocumentTask(taskId, userId);
  }

  // ─── Capabilities ───────────────────────────────────────────

  getCapabilities(): CapabilitiesResponse {
    return this.overviewWorkflow.getCapabilities();
  }

  getIndexCompensationStatus() {
    return this.overviewWorkflow.getIndexCompensationStatus();
  }

  getDocumentQueueStatus() {
    return this.overviewWorkflow.getDocumentQueueStatus();
  }

  // ─── Documents ───────────────────────────────────────────────

  async getDocumentStats() {
    return this.overviewWorkflow.getDocumentStats();
  }

  async getQualitySummary(limit = 500) {
    return this.overviewWorkflow.getQualitySummary(limit);
  }

  async getIntentRoutingSummary(limit = 200) {
    return this.overviewWorkflow.getIntentRoutingSummary(limit);
  }

  async listDocuments(query: RagDocumentQueryDto) {
    return this.documentsWorkflow.listDocuments(query);
  }

  /** 按权限主体类型（public/department）查询可见 docId 集合，用于列表 scope 过滤 */
  private async listReadableDocIdsByScope(
    scope: 'public' | 'department',
    departmentId?: string,
  ): Promise<Set<string>> {
    return this.documentsWorkflow.listReadableDocIdsByScope(
      scope,
      departmentId,
    );
  }

  async getDocument(docId: string) {
    return this.documentsWorkflow.getDocument(docId);
  }

  async inspectRetrieval(
    query: string,
    userId: string,
    tenantId: string,
    limit = 50,
  ) {
    return this.searchWorkflow.inspectRetrieval(query, userId, tenantId, limit);
  }

  async searchDocuments(
    query: string,
    limit = 20,
    filters: DocumentSearchFilters = {},
  ) {
    return this.searchWorkflow.searchDocuments(query, limit, filters);
  }

  /** 文档搜索筛选面板 facets（documentTypes / roles），ES 未启用时返回空数组 */
  getDocumentSearchFacets() {
    return this.searchWorkflow.getDocumentSearchFacets();
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
    return this.searchWorkflow.searchImages(
      query,
      limit,
      userId,
      tenantId,
      role,
      trustedAdminPrincipal,
    );
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
    return this.searchWorkflow.searchImagesByImage(
      base64,
      mimeType,
      limit,
      userId,
      tenantId,
      role,
      trustedAdminPrincipal,
    );
  }

  async getImageAsset(params: {
    userId: string;
    tenantId?: string;
    role?: string;
    trustedAdminPrincipal?: boolean;
    docId: string;
    key: string;
  }): Promise<{ buffer: Buffer; contentType: string }> {
    return this.searchWorkflow.getImageAsset(params);
  }

  private async getActiveAllowedImageDocIds(
    userId: string,
    tenantId?: string,
    role?: string,
    trustedAdminPrincipal = false,
  ): Promise<Set<string>> {
    return this.searchWorkflow.getActiveAllowedImageDocIds(
      userId,
      tenantId,
      role,
      trustedAdminPrincipal,
    );
  }

  private async getActiveAllowedImageDocuments(
    userId: string,
    tenantId?: string,
    role?: string,
    trustedAdminPrincipal = false,
  ): Promise<Map<string, DocumentMetaEntity>> {
    return this.searchWorkflow.getActiveAllowedImageDocuments(
      userId,
      tenantId,
      role,
      trustedAdminPrincipal,
    );
  }

  private isCurrentEffectiveDocument(
    document: DocumentMetaEntity,
    now: number,
  ): boolean {
    return this.searchWorkflow.isCurrentEffectiveDocument(document, now);
  }

  async reindexDocumentSearch(limit = 1000) {
    return this.indexingWorkflow.reindexDocumentSearch(limit);
  }

  async listDocumentVersions(docId: string) {
    return this.documentsWorkflow.listDocumentVersions(docId);
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
    return this.documentsWorkflow.createDocumentVersion(docId, body);
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
    return this.documentsWorkflow.incrementalUpdateDocument(docId, body);
  }

  async updateDocumentLifecycle(
    docId: string,
    lifecycleStatus: DocumentLifecycleStatus,
  ) {
    return this.documentsWorkflow.updateDocumentLifecycle(
      docId,
      lifecycleStatus,
    );
  }

  /** 归档文档：仅 effective/confirmed 可归档，归档后从所有检索口径隐藏 */
  async archiveDocument(docId: string) {
    return this.documentsWorkflow.archiveDocument(docId);
  }

  /** 恢复归档：仅 archived 状态且审批通过（approved）可恢复为 effective */
  async unarchiveDocument(docId: string) {
    return this.documentsWorkflow.unarchiveDocument(docId);
  }

  async promoteDocumentVersion(docId: string) {
    return this.documentsWorkflow.promoteDocumentVersion(docId);
  }

  async rollbackDocumentVersion(docId: string) {
    return this.documentsWorkflow.rollbackDocumentVersion(docId);
  }

  async submitDocumentReview(
    docId: string,
    operatorId?: string,
    comment?: string,
  ) {
    return this.documentsWorkflow.submitDocumentReview(
      docId,
      operatorId,
      comment,
    );
  }

  async approveDocumentReview(
    docId: string,
    operatorId?: string,
    comment?: string,
  ) {
    return this.documentsWorkflow.approveDocumentReview(
      docId,
      operatorId,
      comment,
    );
  }

  async rejectDocumentReview(
    docId: string,
    operatorId?: string,
    comment?: string,
  ) {
    return this.documentsWorkflow.rejectDocumentReview(
      docId,
      operatorId,
      comment,
    );
  }

  async listDocumentReviews(docId: string) {
    return this.documentsWorkflow.listDocumentReviews(docId);
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
  ): Promise<DocumentIndexAuditResult> {
    return this.auditWorkflow.auditDocumentIndexes(limit, cursor);
  }

  async repairDocumentIndexes(input: { docIds?: string[]; limit?: number }) {
    return this.indexingWorkflow.repairDocumentIndexes(input);
  }

  private isDescriptionOnlyRepairReason(reason?: string): boolean {
    return this.indexingWorkflow.isDescriptionOnlyRepairReason(reason);
  }

  private async repairRetrievalDescriptions(docId: string) {
    return this.indexingWorkflow.repairRetrievalDescriptions(docId);
  }

  getIndexRepairQueueStatus() {
    return this.indexingWorkflow.getIndexRepairQueueStatus();
  }

  getFailedIndexRepairs(limit = 50) {
    return this.indexingWorkflow.getFailedIndexRepairs(limit);
  }

  retryIndexRepair(jobId: string) {
    return this.indexingWorkflow.retryIndexRepair(jobId);
  }

  async listSecurityAudit(limit = 100) {
    return this.indexingWorkflow.listSecurityAudit(limit);
  }

  retryFailedDocumentTask(taskId: string) {
    return this.indexingWorkflow.retryFailedDocumentTask(taskId);
  }

  cancelQueuedDocumentTask(taskId: string) {
    return this.indexingWorkflow.cancelQueuedDocumentTask(taskId);
  }

  private async updateDocumentReview(
    docId: string,
    reviewStatus: DocumentMetaEntity['reviewStatus'],
    action: DocumentReviewEntity['action'],
    operatorId?: string,
    comment?: string,
  ) {
    return this.documentsWorkflow.updateDocumentReview(
      docId,
      reviewStatus,
      action,
      operatorId,
      comment,
    );
  }

  private toDocumentVersionItem(doc: DocumentMetaEntity) {
    return this.documentsWorkflow.toDocumentVersionItem(doc);
  }

  async getDocumentChunks(docId: string) {
    return this.documentsWorkflow.getDocumentChunks(docId);
  }

  async reindexDocument(docId: string) {
    return this.indexingWorkflow.reindexDocument(docId);
  }

  private async rebuildAndAuditRetrievalDescriptions(
    document: Pick<DocumentMetaEntity, 'tenantId' | 'docId'>,
  ) {
    return this.indexingWorkflow.rebuildAndAuditRetrievalDescriptions(document);
  }

  async updateDocumentPermissions(
    docId: string,
    subjects: Array<{
      type: 'user' | 'role' | 'department' | 'public';
      id: string;
    }>,
  ) {
    return this.documentsWorkflow.updateDocumentPermissions(docId, subjects);
  }

  async batchDocumentOperation(body: {
    action?: 'reindex' | 'delete' | 'status';
    docIds?: string[];
    userId?: string;
  }) {
    return this.documentsWorkflow.batchDocumentOperation(body);
  }

  // ─── Vector Index ────────────────────────────────────────────

  async getVectorIndex(): Promise<VectorIndexResponse> {
    return this.analyticsWorkflow.getVectorIndex();
  }

  // ─── Evaluations ─────────────────────────────────────────────

  getEvaluations(): EvaluationSummary[] {
    return this.analyticsWorkflow.getEvaluations();
  }

  runEvaluation(dto: RagEvaluationRunDto) {
    return this.analyticsWorkflow.runEvaluation(dto);
  }

  // ─── Conversations ────────────────────────────────────────────

  async listConversations(
    userId: string,
    tenantId: string,
  ): Promise<ConversationSummary[]> {
    return this.analyticsWorkflow.listConversations(userId, tenantId);
  }

  async getConversation(threadId: string, userId: string, tenantId: string) {
    return this.analyticsWorkflow.getConversation(threadId, userId, tenantId);
  }

  async deleteConversation(
    threadId: string,
    userId: string,
    tenantId: string,
  ): Promise<boolean> {
    return this.analyticsWorkflow.deleteConversation(
      threadId,
      userId,
      tenantId,
    );
  }

  // ─── Search Operations ───────────────────────────────────────

  async getQueryDailyTrend(days = 14) {
    return this.analyticsWorkflow.getQueryDailyTrend(days);
  }

  async getSearchPopularQueries() {
    return this.analyticsWorkflow.getSearchPopularQueries();
  }

  async getSearchNoResultQueries() {
    return this.analyticsWorkflow.getSearchNoResultQueries();
  }

  async getSearchRecallIssues() {
    return this.analyticsWorkflow.getSearchRecallIssues();
  }

  // ─── QA Operations ────────────────────────────────────────────

  async getQaNegativeFeedback() {
    return this.analyticsWorkflow.getQaNegativeFeedback();
  }

  async getQaCitationFailures() {
    return this.analyticsWorkflow.getQaCitationFailures();
  }

  async getQaCostSummary() {
    return this.analyticsWorkflow.getQaCostSummary();
  }
}
