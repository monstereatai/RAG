/**
 * VectorStore Provider 抽象接口
 * 可插拔：milvus / pgvector
 */
export interface VectorRecord {
  id: string;
  vector: number[];
  content: string;
  docId: string;
  chunkIndex: number;
  userId?: string;
}

export interface VectorSearchHit {
  id: string;
  content: string;
  docId: string;
  chunkIndex: number;
  score: number;
}

export interface StoredVectorRecord {
  id: string;
  content: string;
  vector: number[];
}

export interface RetrievalDescriptionVectorRecord {
  id: string;
  vector: number[];
  docId: string;
  tenantId: string;
  userId?: string | null;
  content: string;
}

export interface RetrievalDescriptionVectorHit {
  id: string;
  docId: string;
  tenantId: string;
  userId: string;
  content: string;
  score: number;
}

export interface VectorIndexInfo {
  provider: string;
  collection: string;
  dimension: number;
  indexType: string;
  metricType: string;
  params: Record<string, number | string>;
}

export interface VectorStoreRuntimeStatus {
  status: 'healthy' | 'degraded' | 'unavailable';
  available: boolean;
  circuitState: 'closed' | 'open' | 'half_open';
  consecutiveFailures: number;
  lastFailureAt: string | null;
  lastFailureMessage: string | null;
  circuitOpenUntil: string | null;
}

/**
 * 图片向量记录（rag_images 独立集合，文本+图片同一向量空间）
 */
export interface ImageVectorRecord {
  id: string;
  vector: number[];
  docId: string;
  userId?: string;
  /** 图片可访问 URL */
  url: string;
  /** 附加信息 JSON 字符串（文件名 / 描述 / 页码等），可选 */
  meta?: string;
}

/**
 * 图片向量检索命中
 */
export interface ImageSearchHit {
  id: string;
  docId: string;
  userId: string;
  url: string;
  meta?: string;
  score: number;
}

export interface IVectorStoreProvider {
  /**
   * 初始化集合（不存在则创建 + 建索引 + load）
   */
  ensureCollection(): Promise<void>;

  /**
   * 批量写入向量
   */
  insert(records: VectorRecord[]): Promise<void>;

  /**
   * 按向量相似度检索 topK
   */
  similaritySearch(
    queryVector: number[],
    k: number,
    userId?: string,
    allowedDocIds?: ReadonlySet<string>,
  ): Promise<VectorSearchHit[]>;

  /**
   * 按 docId 删除所有 chunks
   */
  deleteByDocId(docId: string): Promise<void>;

  /**
   * 按 chunk id 精确删除向量，用于 chunk 级增量更新。
   */
  deleteByIds(ids: string[]): Promise<void>;

  /**
   * 返回某个文档在向量索引中的分块数量，用于与 PostgreSQL 对账。
   * 底层索引不可用时应抛出受控错误，由上层标记为 unavailable，而不是当成 0。
   */
  countByDocId(docId: string, userId?: string): Promise<number>;

  /** 按 chunk ID 读取已存向量，供索引修复复用，避免重复计算 embedding。 */
  getVectorsByIds(ids: string[]): Promise<StoredVectorRecord[]>;

  /**
   * 返回当前索引配置，用于调试和验收。
   */
  getIndexInfo(): VectorIndexInfo;

  /**
   * 返回运行时状态，用于运营后台展示降级和熔断原因。
   */
  getRuntimeStatus(): VectorStoreRuntimeStatus;

  /**
   * 初始化图片集合（rag_images，不存在则创建 + 建索引 + load）
   */
  ensureImageCollection(): Promise<void>;

  /**
   * 批量写入图片向量
   */
  insertImages(records: ImageVectorRecord[]): Promise<void>;

  /**
   * 按向量相似度检索图片 topK（可按 user_id 或允许文档集合过滤）
   */
  searchImages(
    queryVector: number[],
    k: number,
    userId?: string,
    allowedDocIds?: ReadonlySet<string>,
  ): Promise<ImageSearchHit[]>;

  /**
   * 按 docId 删除图片向量（可叠加 user_id 过滤）
   */
  deleteImagesByDocId(docId: string, userId?: string): Promise<void>;

  /** 返回某个文档在图片向量索引中的资产数量。 */
  countImagesByDocId(docId: string, userId?: string): Promise<number>;

  /** 初始化检索描述专用集合，不改动 rag_chunks。 */
  ensureDescriptionCollection(): Promise<void>;

  /** 按描述 ID upsert 向量记录。 */
  upsertDescriptions(records: RetrievalDescriptionVectorRecord[]): Promise<void>;

  /** 仅按 tenantId 限定候选；文档 ACL 由上层复核。 */
  searchDescriptions(
    queryVector: number[],
    options: { tenantId: string; topK: number },
  ): Promise<RetrievalDescriptionVectorHit[]>;

  /** 返回租户下某文档已存在的描述向量 ID，用于索引对账。 */
  listDescriptionIds(tenantId: string, docId: string): Promise<string[]>;

  /** 删除指定租户下某文档的描述向量。 */
  deleteDescriptionsByDocId(tenantId: string, docId: string): Promise<void>;
}
