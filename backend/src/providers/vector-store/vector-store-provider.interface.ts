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

export interface VectorIndexInfo {
  provider: string;
  collection: string;
  dimension: number;
  indexType: string;
  metricType: string;
  params: Record<string, number | string>;
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
  ): Promise<VectorSearchHit[]>;

  /**
   * 按 docId 删除所有 chunks
   */
  deleteByDocId(docId: string): Promise<void>;

  /**
   * 返回当前索引配置，用于调试和验收。
   */
  getIndexInfo(): VectorIndexInfo;
}
