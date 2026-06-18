import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'node:path';
import { BM25, BM25Doc } from './bm25.util';
import { Bm25Store, Bm25PersistedEntry } from './bm25-store';
import { EmbeddingProvider } from '../../providers/embedding/embedding.provider';
import { VectorStoreProvider } from '../../providers/vector-store/vector-store.provider';
import { LlmProvider } from '../../providers/llm/llm.provider';
import { generateAnswerPrompt } from '../prompts/rag.prompts';
import { ElasticsearchProvider } from '../../providers/elasticsearch/elasticsearch.provider';

export interface RetrievedChunk {
  id: string;
  content: string;
  docId: string;
  chunkIndex: number;
  bm25Score: number;
  cosineScore: number;
  totalScore: number;
}

export interface KarpathyRagResult {
  answer: string;
  references: Array<{
    id: string;
    content: string;
    docId: string;
    chunkIndex: number;
    totalScore: number;
    bm25Score: number;
    cosineScore: number;
  }>;
}

export interface RetrieveOptions {
  vectorSearch?: boolean;
}

/**
 * Karpathy-Style RAG：BM25 + Cosine 混合检索 + LLM 生成
 * BM25 索引持久化到 workspace/bm25-index.json，重启自动恢复。
 */
@Injectable()
export class KarpathyRagService implements OnModuleInit {
  private readonly logger = new Logger(KarpathyRagService.name);
  // 按用户隔离的 BM25 索引实例 Map: userId -> BM25
  private readonly bm25Instances = new Map<string, BM25>();
  // chunkId → { content, docId, chunkIndex, userId }，用于 BM25 命中后补全元数据
  private readonly chunkMeta = new Map<
    string,
    { content: string; docId: string; chunkIndex: number; userId?: string }
  >();

  // 持久化条目（与 bm25/chunkMeta 保持同步）
  private persistedEntries: Bm25PersistedEntry[] = [];
  private bm25Store!: Bm25Store;

  // 混合检索权重
  private readonly bm25Weight = 0.3;
  private readonly cosineWeight = 0.7;
  private readonly topK = 5;

  private getBm25Instance(userId?: string): BM25 {
    const key = userId || 'default';
    let instance = this.bm25Instances.get(key);
    if (!instance) {
      instance = new BM25();
      this.bm25Instances.set(key, instance);
    }
    return instance;
  }

  constructor(
    private readonly embeddingProvider: EmbeddingProvider,
    private readonly vectorStoreProvider: VectorStoreProvider,
    private readonly llmProvider: LlmProvider,
    private readonly configService: ConfigService,
    private readonly elasticsearchProvider: ElasticsearchProvider,
  ) {}

  /**
   * 模块初始化时从磁盘恢复 BM25 索引
   */
  onModuleInit(): void {
    const uploadDir =
      this.configService.get<string>('workspace.uploadDir') ??
      path.resolve(process.cwd(), '../workspace/uploads');
    const workspaceDir = path.dirname(uploadDir);
    this.bm25Store = new Bm25Store(workspaceDir);

    const stored = this.bm25Store.load();
    if (stored && stored.entries.length > 0) {
      this.logger.log(
        `Restoring BM25 index from disk: ${stored.entries.length} chunks (${stored.updatedAt})`,
      );
      this._loadEntries(stored.entries);
    } else {
      this.logger.log('No BM25 snapshot found, starting empty index');
    }
  }

  /**
   * 内部：将持久化条目加载到内存索引
   */
  private _loadEntries(entries: Bm25PersistedEntry[]): void {
    for (const entry of entries) {
      const doc: BM25Doc = { id: entry.id, content: entry.content };
      this.getBm25Instance(entry.userId).addDocs([doc]);
      this.chunkMeta.set(entry.id, {
        content: entry.content,
        docId: entry.docId,
        chunkIndex: entry.chunkIndex,
        userId: entry.userId,
      });
      this.persistedEntries.push(entry);
    }
  }

  /**
   * 文档上传后调用：把 chunks 加入 BM25 索引并持久化
   */
  indexChunks(
    chunks: Array<{
      id: string;
      content: string;
      docId: string;
      chunkIndex: number;
    }>,
    userId?: string,
  ): void {
    const docs: BM25Doc[] = chunks.map((c) => ({
      id: c.id,
      content: c.content,
    }));
    this.getBm25Instance(userId).addDocs(docs);
    for (const c of chunks) {
      this.chunkMeta.set(c.id, {
        content: c.content,
        docId: c.docId,
        chunkIndex: c.chunkIndex,
        userId,
      });
      this.persistedEntries.push({
        id: c.id,
        content: c.content,
        docId: c.docId,
        chunkIndex: c.chunkIndex,
        tokens: [], // tokens 由 BM25 内部管理，此处存空数组即可
        userId,
      });
    }

    // 持久化到磁盘
    try {
      this.bm25Store.save(this.persistedEntries);
      this.logger.log(
        `BM25 index saved: ${this.persistedEntries.length} total chunks`,
      );
    } catch (err) {
      this.logger.warn(`BM25 save failed: ${(err as Error).message}`);
    }

    this.logger.log(
      `Indexed ${chunks.length} chunks into BM25 (total: ${this.chunkMeta.size})`,
    );
  }

  /**
   * 删除指定 docId 的所有 chunks（BM25 内存 + 持久化）
   */
  removeDocChunks(docId: string, userId?: string): void {
    // 过滤内存数据
    this.persistedEntries = this.persistedEntries.filter(
      (e) => e.docId !== docId,
    );
    // 删除 chunkMeta 中属于该 doc 的条目
    for (const [id, meta] of this.chunkMeta.entries()) {
      if (meta.docId === docId) {
        this.chunkMeta.delete(id);
      }
    }
    // 重建该用户的 BM25（BM25 不支持增量删除，需针对该用户全量重建）
    const bm25 = this.getBm25Instance(userId);
    bm25.clear();
    const docs: BM25Doc[] = this.persistedEntries
      .filter((e) => e.userId === userId)
      .map((e) => ({
        id: e.id,
        content: e.content,
      }));
    if (docs.length > 0) {
      bm25.addDocs(docs);
    }

    // 持久化
    try {
      this.bm25Store.save(this.persistedEntries);
      this.logger.log(
        `BM25 index updated after doc delete: docId=${docId}, remaining=${this.persistedEntries.length} chunks`,
      );
    } catch (err) {
      this.logger.warn(`BM25 save failed: ${(err as Error).message}`);
    }
  }

  /**
   * 混合检索：BM25 + Cosine 加权融合
   */
  async retrieve(
    query: string,
    options: RetrieveOptions = {},
    userId?: string,
  ): Promise<RetrievedChunk[]> {
    const vectorSearch = options.vectorSearch ?? true;

    // 1. BM25 检索 topK*2（多召回一些用于融合）
    let bm25Hits: Array<{
      id: string;
      score: number;
      content: string;
      docId: string;
      chunkIndex: number;
    }> = [];

    if (this.elasticsearchProvider.isEnabled()) {
      bm25Hits = await this.elasticsearchProvider.search(
        query,
        this.topK * 2,
        userId,
      );
    } else {
      const userBm25 = this.getBm25Instance(userId);
      const localHits = userBm25.search(query, this.topK * 2);
      bm25Hits = localHits
        .map((h) => {
          const meta = this.chunkMeta.get(h.id);
          if (!meta || meta.userId !== userId) return null; // 确保用户隔离
          return {
            id: h.id,
            score: h.score,
            content: meta.content,
            docId: meta.docId,
            chunkIndex: meta.chunkIndex,
          };
        })
        .filter((h): h is NonNullable<typeof h> => h !== null);
    }
    const bm25MaxScore = Math.max(...bm25Hits.map((h) => h.score), 1);

    // 2. Cosine 检索 topK*2（通过 Milvus）
    let cosineHits: Awaited<
      ReturnType<VectorStoreProvider['similaritySearch']>
    > = [];
    if (vectorSearch) {
      try {
        const queryVector = await this.embeddingProvider.embedQuery(query);
        cosineHits = await this.vectorStoreProvider.similaritySearch(
          queryVector,
          this.topK * 2,
          userId,
        );
      } catch (err) {
        this.logger.warn(
          `Vector search failed, fallback to BM25 only: ${(err as Error).message}`,
        );
      }
    }
    const cosineMaxScore = Math.max(...cosineHits.map((h) => h.score), 1);

    // 3. 加权融合（归一化后加权）
    const fusedMap = new Map<string, RetrievedChunk>();

    for (const hit of bm25Hits) {
      const normalizedBm25 = hit.score / bm25MaxScore;
      fusedMap.set(hit.id, {
        id: hit.id,
        content: hit.content,
        docId: hit.docId,
        chunkIndex: hit.chunkIndex,
        bm25Score: normalizedBm25,
        cosineScore: 0,
        totalScore: normalizedBm25 * this.bm25Weight,
      });
    }

    for (const hit of cosineHits) {
      const normalizedCosine = hit.score / cosineMaxScore;
      const existing = fusedMap.get(hit.id);
      if (existing) {
        existing.cosineScore = normalizedCosine;
        existing.totalScore =
          existing.bm25Score * this.bm25Weight +
          normalizedCosine * this.cosineWeight;
      } else {
        fusedMap.set(hit.id, {
          id: hit.id,
          content: hit.content,
          docId: hit.docId,
          chunkIndex: hit.chunkIndex,
          bm25Score: 0,
          cosineScore: normalizedCosine,
          totalScore: normalizedCosine * this.cosineWeight,
        });
      }
    }

    // 4. 按总分排序，取 topK
    const results = Array.from(fusedMap.values()).sort(
      (a, b) => b.totalScore - a.totalScore,
    );
    return results.slice(0, this.topK);
  }

  /**
   * 仅使用 BM25 检索。
   * Agentic 多查询扩展使用该方法，避免对 Milvus 连续 search 导致阻塞。
   */
  async retrieveBm25Only(
    query: string,
    userId?: string,
  ): Promise<RetrievedChunk[]> {
    let bm25Hits: Array<{
      id: string;
      score: number;
      content: string;
      docId: string;
      chunkIndex: number;
    }> = [];

    if (this.elasticsearchProvider.isEnabled()) {
      bm25Hits = await this.elasticsearchProvider.search(
        query,
        this.topK * 2,
        userId,
      );
    } else {
      const userBm25 = this.getBm25Instance(userId);
      const localHits = userBm25.search(query, this.topK * 2);
      bm25Hits = localHits
        .map((h) => {
          const meta = this.chunkMeta.get(h.id);
          if (!meta || meta.userId !== userId) return null; // 确保用户隔离
          return {
            id: h.id,
            score: h.score,
            content: meta.content,
            docId: meta.docId,
            chunkIndex: meta.chunkIndex,
          };
        })
        .filter((h): h is NonNullable<typeof h> => h !== null);
    }

    const bm25MaxScore = Math.max(...bm25Hits.map((h) => h.score), 1);

    return bm25Hits
      .map((hit) => {
        const normalizedBm25 = hit.score / bm25MaxScore;
        return {
          id: hit.id,
          content: hit.content,
          docId: hit.docId,
          chunkIndex: hit.chunkIndex,
          bm25Score: normalizedBm25,
          cosineScore: 0,
          totalScore: normalizedBm25 * this.bm25Weight,
        } satisfies RetrievedChunk;
      })
      .slice(0, this.topK);
  }

  /**
   * 完整 RAG：检索 + 生成
   * @param history 多轮对话历史（可选，按时间顺序）
   */
  async answer(
    query: string,
    history: Array<{ role: 'human' | 'ai'; content: string }> = [],
    userId?: string,
    memoryMessages: Array<{ role: string; content: string }> = [],
  ): Promise<KarpathyRagResult> {
    const chunks = await this.retrieve(query, {}, userId);

    if (chunks.length === 0) {
      return {
        answer: '未找到相关内容，请先上传文档。',
        references: [],
      };
    }

    const context = chunks
      .map((c, i) => `[片段 ${i + 1}]\n${c.content}`)
      .join('\n\n---\n\n');

    this.logger.log(`Generating answer with ${chunks.length} chunks`);
    const messages = await generateAnswerPrompt.formatMessages({
      context,
      query,
      history,
      memory: memoryMessages,
    });
    const answer = await this.llmProvider.invoke(messages);

    return {
      answer,
      references: chunks.map((c) => ({
        id: c.id,
        content: c.content,
        docId: c.docId,
        chunkIndex: c.chunkIndex,
        totalScore: c.totalScore,
        bm25Score: c.bm25Score,
        cosineScore: c.cosineScore,
      })),
    };
  }

  /** 获取当前索引中的所有 docId（用于校验） */
  getIndexedDocIds(): Set<string> {
    return new Set(this.persistedEntries.map((e) => e.docId));
  }
}
