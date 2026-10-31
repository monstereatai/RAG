import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ElasticsearchProvider } from '../../providers/elasticsearch/elasticsearch.provider';
import { EmbeddingProvider } from '../../providers/embedding/embedding.provider';
import { RedisProvider } from '../../providers/redis/redis.provider';
import { VectorStoreProvider } from '../../providers/vector-store/vector-store.provider';
import {
  RAG_INDEX_CAPABILITY,
  type RagChunkMetadataPatch,
  type RagIndexCapability,
  type RagIndexChunkInput,
} from '../../rag/contracts/rag-capabilities';

type IndexedChunk = RagIndexChunkInput;
type IndexedDocument = Parameters<ElasticsearchProvider['indexDocument']>[0];
type ChunkMetadataPatch = RagChunkMetadataPatch;

/** Coordinates the required document search indexes and Milvus delete recovery. */
@Injectable()
export class DocumentIndexCoordinator implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DocumentIndexCoordinator.name);
  private readonly pendingMilvusDeletes = new Map<string, number>();
  private milvusCompensationRestore: Promise<void> | null = null;
  private milvusCompensationLastScanAt = 0;
  private milvusCompensationScanTimer?: ReturnType<typeof setInterval>;
  private readonly milvusDeleteRetryTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private readonly milvusCompensationKeyPrefix =
    'rag:index:milvus:delete:pending:v2:';
  private readonly legacyMilvusCompensationKey =
    'rag:index:milvus:delete:pending:v1';

  constructor(
    private readonly embeddingProvider: EmbeddingProvider,
    private readonly vectorStoreProvider: VectorStoreProvider,
    @Inject(RAG_INDEX_CAPABILITY)
    private readonly ragService: RagIndexCapability,
    private readonly elasticsearchProvider: ElasticsearchProvider,
    @Optional() private readonly redisProvider?: RedisProvider,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureMilvusDeleteCompensationsRestored();
    this.milvusCompensationScanTimer = setInterval(() => {
      void this.ensureMilvusDeleteCompensationsRestored();
    }, 30_000);
    this.milvusCompensationScanTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.milvusCompensationScanTimer) {
      clearInterval(this.milvusCompensationScanTimer);
    }
    for (const timer of this.milvusDeleteRetryTimers.values()) {
      clearTimeout(timer);
    }
  }

  embedChunks(chunks: string[]): Promise<number[][]> {
    return this.embeddingProvider.embedDocuments(chunks);
  }

  /**
   * Writes the independent required index groups concurrently. The caller
   * combines this result with PostgreSQL writes before deciding whether to
   * compensate, matching the original upload failure boundary.
   */
  async writeDocumentIndexes(params: {
    records: Array<{
      id: string;
      content: string;
      docId: string;
      chunkIndex: number;
      userId: string;
      tenantId: string;
      contentHash: string;
      indexGeneration: string;
    }>;
    chunks: IndexedChunk[];
    userId: string;
    vectors: number[][];
    document: IndexedDocument;
  }): Promise<void> {
    // Milvus 与 BM25/Elasticsearch 是独立索引组，因此并发写入。
    // 等两组都返回后再上报失败，让入库流程清理已成功的部分索引。
    const indexResults = await Promise.allSettled([
      (async () => {
        await this.vectorStoreProvider.insert(
          params.records.map((record, index) => ({
            ...record,
            vector: params.vectors[index],
          })),
        );
      })(),
      (async () => {
        this.ragService.indexChunks(params.chunks, params.userId);
        const elasticsearchResults = await Promise.allSettled([
          (async () => {
            await this.elasticsearchProvider.indexChunks(
              params.chunks,
              params.userId,
              params.vectors,
            );
          })(),
          (async () => {
            await this.elasticsearchProvider.indexDocument(params.document);
          })(),
        ]);
        const failedElasticsearchWrite = elasticsearchResults.find(
          (result): result is PromiseRejectedResult =>
            result.status === 'rejected',
        );
        if (failedElasticsearchWrite) throw failedElasticsearchWrite.reason;
      })(),
    ]);
    const failedIndex = indexResults.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (failedIndex) throw failedIndex.reason;
  }

  /** Incremental updates intentionally keep their existing write order/failure behavior. */
  async writeIncrementalIndexes(params: {
    records: Array<Parameters<VectorStoreProvider['insert']>[0][number]>;
    chunks: IndexedChunk[];
    userId: string;
    vectors: Array<number[] | null>;
    document: IndexedDocument;
  }): Promise<void> {
    if (params.records.length > 0) {
      await this.vectorStoreProvider.insert(params.records);
      await Promise.all([
        Promise.resolve(
          this.ragService.indexChunks(params.chunks, params.userId),
        ),
        this.elasticsearchProvider.indexChunks(
          params.chunks,
          params.userId,
          params.vectors,
        ),
      ]);
    }
    await this.elasticsearchProvider.indexDocument(params.document);
  }

  updateChunkMetadataByIds(
    ids: string[],
    patch: ChunkMetadataPatch,
  ): Promise<void> {
    return Promise.all([
      Promise.resolve(this.ragService.updateChunkMetadataByIds(ids, patch)),
      this.elasticsearchProvider.updateChunkMetadataByIds(ids, patch),
    ]).then(() => undefined);
  }

  updateElasticsearchDocumentLifecycle(
    docId: string,
    lifecycleStatus: string,
    userId?: string,
  ): Promise<void> {
    return this.elasticsearchProvider.updateDocumentLifecycle(
      docId,
      lifecycleStatus,
      userId,
    );
  }

  updateBm25DocumentLifecycle(
    docId: string,
    lifecycleStatus: string,
    userId?: string,
  ): void {
    this.ragService.updateDocumentLifecycle(docId, lifecycleStatus, userId);
  }

  async updateDocumentLifecycle(
    docId: string,
    lifecycleStatus: string,
    userId?: string,
  ): Promise<void> {
    await this.updateElasticsearchDocumentLifecycle(
      docId,
      lifecycleStatus,
      userId,
    );
    this.updateBm25DocumentLifecycle(docId, lifecycleStatus, userId);
  }

  isElasticsearchEnabled(): boolean {
    return this.elasticsearchProvider.isEnabled();
  }

  removeBm25Chunks(docId: string, userId?: string): void {
    this.ragService.removeDocChunks(docId, userId);
  }

  async removeVectorIndex(docId: string): Promise<void> {
    try {
      await this.vectorStoreProvider.deleteByDocId(docId);
    } catch (err) {
      this.logger.warn(
        `Milvus delete failed for docId=${docId}: ${(err as Error).message}`,
      );
      const persisted = await this.scheduleMilvusDeleteRetry(docId);
      if (!persisted) {
        throw new ServiceUnavailableException(
          'Milvus 删除失败，补偿任务未能可靠保存；文档保留，请稍后重试。',
        );
      }
    }
  }

  async removeSearchIndexes(docId: string, userId: string): Promise<void> {
    this.ragService.removeDocChunks(docId, userId);
    await this.elasticsearchProvider.deleteByDocId(docId, userId);
  }

  /** Best-effort cleanup after a failed multi-store upload. */
  async cleanupFailedExternalIndexes(
    docId: string,
    userId: string,
  ): Promise<void> {
    const cleanupResults = await Promise.allSettled([
      this.vectorStoreProvider.deleteByDocId(docId),
      this.elasticsearchProvider.deleteByDocId(docId, userId),
      Promise.resolve().then(() =>
        this.ragService.removeDocChunks(docId, userId),
      ),
    ]);
    for (const [index, result] of cleanupResults.entries()) {
      if (result.status === 'rejected') {
        const target = ['Milvus', 'Elasticsearch', 'BM25'][index];
        if (index === 0) {
          const persisted = await this.scheduleMilvusDeleteRetry(docId);
          if (!persisted) {
            this.logger.error(
              `Milvus compensation is not durable for docId=${docId}; manual reconciliation may be required`,
            );
          }
        }
        this.logger.warn(
          `Failed to compensate ${target} index for docId=${docId}: ${String(result.reason)}`,
        );
      }
    }
  }

  async getMilvusDeleteCompensationStatus(): Promise<{
    pendingDurable: boolean;
    pendingMilvusDeletes: Array<{ docId: string; attempts: number }>;
    pendingMilvusDeleteCount: number;
    note: string;
  }> {
    await this.ensureMilvusDeleteCompensationsRestored();
    const pendingMilvusDeletes = [...this.pendingMilvusDeletes.entries()].map(
      ([docId, attempts]) => ({ docId, attempts }),
    );
    const pendingDurable = Boolean(this.redisProvider?.isEnabled());
    return {
      pendingDurable,
      pendingMilvusDeletes,
      pendingMilvusDeleteCount: pendingMilvusDeletes.length,
      note: pendingDurable
        ? 'Milvus 删除补偿已写入 Redis，可跨实例恢复；ES、BM25、图谱全量对账仍需后续 Reconciler。'
        : 'Redis 不可用时 Milvus 补偿仍为进程内状态，需启用 Redis 或后续 outbox/schema 迁移。',
    };
  }

  private async scheduleMilvusDeleteRetry(docId: string): Promise<boolean> {
    if (this.milvusDeleteRetryTimers.has(docId)) {
      return this.persistMilvusDeleteCompensation(docId);
    }

    const attempts = this.pendingMilvusDeletes.get(docId) ?? 0;
    if (attempts >= 5) {
      this.logger.warn(
        `Milvus delete retry exhausted for docId=${docId}; vector hits remain guarded by active docId filtering`,
      );
      return false;
    }

    const nextAttempt = attempts + 1;
    this.pendingMilvusDeletes.set(docId, nextAttempt);
    const persisted = await this.persistMilvusDeleteCompensation(docId);
    this.armMilvusDeleteRetry(docId, nextAttempt);
    return persisted;
  }

  private async retryMilvusDelete(docId: string): Promise<void> {
    try {
      await this.vectorStoreProvider.deleteByDocId(docId);
    } catch (err) {
      this.logger.warn(
        `Milvus delete retry failed for docId=${docId}: ${(err as Error).message}`,
      );
      await this.scheduleMilvusDeleteRetry(docId);
      return;
    }

    this.pendingMilvusDeletes.delete(docId);
    if (!(await this.clearMilvusDeleteCompensation(docId))) {
      this.logger.warn(
        `Milvus delete succeeded but compensation state could not be cleared for docId=${docId}; a later retry is safe`,
      );
    }
    this.logger.log(`Milvus delete retry succeeded for docId=${docId}`);
  }

  private milvusDeleteRetryKey(docId: string): string {
    return `${this.milvusCompensationKeyPrefix}${Buffer.from(docId).toString('base64url')}`;
  }

  private async persistMilvusDeleteCompensation(
    docId: string,
  ): Promise<boolean> {
    if (!this.redisProvider?.isEnabled()) return false;
    const attempts = this.pendingMilvusDeletes.get(docId);
    if (attempts == null) return false;
    const saved = await this.redisProvider.setRequired(
      this.milvusDeleteRetryKey(docId),
      JSON.stringify({ docId, attempts }),
    );
    if (!saved) {
      this.logger.warn(
        `Failed to persist Milvus delete compensation for docId=${docId}`,
      );
    }
    return saved;
  }

  private async clearMilvusDeleteCompensation(docId: string): Promise<boolean> {
    if (!this.redisProvider?.isEnabled()) return false;
    try {
      await this.redisProvider.delRequired(this.milvusDeleteRetryKey(docId));
      return true;
    } catch (error) {
      this.logger.warn(
        `Failed to clear Milvus delete compensation for docId=${docId}: ${(error as Error).message}`,
      );
      return false;
    }
  }

  private armMilvusDeleteRetry(docId: string, attempts: number): void {
    if (this.milvusDeleteRetryTimers.has(docId) || attempts >= 5) return;
    const delayMs = Math.min(5_000 * 2 ** Math.max(0, attempts - 1), 60_000);
    const timer = setTimeout(() => {
      this.milvusDeleteRetryTimers.delete(docId);
      void this.retryMilvusDelete(docId);
    }, delayMs);
    timer.unref?.();
    this.milvusDeleteRetryTimers.set(docId, timer);
  }

  private async ensureMilvusDeleteCompensationsRestored(): Promise<void> {
    if (!this.redisProvider?.isEnabled()) return;
    if (this.milvusCompensationRestore) {
      await this.milvusCompensationRestore;
      return;
    }
    if (Date.now() - this.milvusCompensationLastScanAt < 30_000) return;

    if (!this.milvusCompensationRestore) {
      this.milvusCompensationRestore = this.restoreMilvusDeleteCompensations()
        .then(() => {
          this.milvusCompensationLastScanAt = Date.now();
        })
        .catch((error: unknown) => {
          this.logger.warn(
            `Failed to restore Milvus delete compensations: ${(error as Error).message}`,
          );
        })
        .finally(() => {
          this.milvusCompensationRestore = null;
        });
    }
    await this.milvusCompensationRestore;
  }

  private async restoreMilvusDeleteCompensations(): Promise<void> {
    if (!this.redisProvider?.isEnabled()) return;
    await this.migrateLegacyMilvusDeleteCompensations();
    const keys = await this.redisProvider.scanRequired(
      `${this.milvusCompensationKeyPrefix}*`,
    );
    for (const key of keys) {
      const raw = await this.redisProvider.getRequired(key);
      if (!raw) continue;
      try {
        const entry = JSON.parse(raw) as { docId?: string; attempts?: number };
        if (
          typeof entry.docId !== 'string' ||
          !entry.docId ||
          !Number.isFinite(entry.attempts) ||
          Number(entry.attempts) < 0
        ) {
          this.logger.warn(
            `Ignoring invalid Milvus compensation record: ${key}`,
          );
          continue;
        }
        const attempts = Math.trunc(Number(entry.attempts));
        this.pendingMilvusDeletes.set(entry.docId, attempts);
        this.armMilvusDeleteRetry(entry.docId, attempts);
      } catch (error) {
        this.logger.warn(
          `Ignoring unreadable Milvus compensation record ${key}: ${(error as Error).message}`,
        );
      }
    }
  }

  private async migrateLegacyMilvusDeleteCompensations(): Promise<void> {
    if (!this.redisProvider?.isEnabled()) return;
    const raw = await this.redisProvider.getRequired(
      this.legacyMilvusCompensationKey,
    );
    if (!raw) return;

    const entries = JSON.parse(raw) as unknown;
    if (!Array.isArray(entries)) {
      throw new Error('Legacy Milvus compensation state is invalid');
    }
    for (const entry of entries) {
      if (
        !Array.isArray(entry) ||
        typeof entry[0] !== 'string' ||
        !entry[0] ||
        !Number.isFinite(entry[1]) ||
        Number(entry[1]) < 0
      ) {
        throw new Error('Legacy Milvus compensation entry is invalid');
      }
      await this.redisProvider.setIfAbsentRequired(
        this.milvusDeleteRetryKey(entry[0]),
        JSON.stringify({
          docId: entry[0],
          attempts: Math.trunc(Number(entry[1])),
        }),
      );
    }

    const removed = await this.redisProvider.compareAndDeleteRequired(
      this.legacyMilvusCompensationKey,
      raw,
    );
    if (!removed) {
      this.logger.warn(
        'Legacy Milvus compensation state changed during migration and was retained for the next recovery pass',
      );
    }
  }
}
