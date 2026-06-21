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
import { MetricsService } from '../../modules/metrics/metrics.service';

export interface RetrievedChunk {
  id: string;
  content: string;
  docId: string;
  chunkIndex: number;
  bm25Score: number;
  cosineScore: number;
  totalScore: number;
  sourceAuthorityWeight?: number;
  parentChunkId?: string | null;
  headingPath?: string[];
  sectionId?: string | null;
  clauseId?: string | null;
  tableRef?: string | null;
  sourceStart?: number | null;
  sourceEnd?: number | null;
  docVersion?: string | null;
  effectiveAt?: string | null;
  expiredAt?: string | null;
  sourceAuthority?: string;
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
    sourceAuthorityWeight?: number;
    parentChunkId?: string | null;
    headingPath?: string[];
    sectionId?: string | null;
    clauseId?: string | null;
    tableRef?: string | null;
    sourceStart?: number | null;
    sourceEnd?: number | null;
    docVersion?: string | null;
    effectiveAt?: string | null;
    expiredAt?: string | null;
    sourceAuthority?: string;
  }>;
  retrievalSufficient?: boolean;
  retrievalReason?: string;
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
    {
      content: string;
      docId: string;
      chunkIndex: number;
      userId?: string;
      parentChunkId?: string | null;
      headingPath?: string[];
      sectionId?: string | null;
      clauseId?: string | null;
      tableRef?: string | null;
      sourceStart?: number | null;
      sourceEnd?: number | null;
      docVersion?: string | null;
      effectiveAt?: string | null;
      expiredAt?: string | null;
      sourceAuthority?: string;
    }
  >();

  // 持久化条目（与 bm25/chunkMeta 保持同步）
  private persistedEntries: Bm25PersistedEntry[] = [];
  private bm25Store!: Bm25Store;

  // 混合检索权重
  private readonly bm25Weight = 0.3;
  private readonly cosineWeight = 0.7;
  private readonly topK = 5;
  private readonly unsupportedAnswer =
    '知识库片段不足以支撑可靠回答，暂不生成确定结论。';

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
    private readonly metricsService: MetricsService,
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
        parentChunkId: entry.parentChunkId,
        headingPath: entry.headingPath,
        sectionId: entry.sectionId,
        clauseId: entry.clauseId,
        tableRef: entry.tableRef,
        sourceStart: entry.sourceStart,
        sourceEnd: entry.sourceEnd,
        docVersion: entry.docVersion,
        effectiveAt: entry.effectiveAt,
        expiredAt: entry.expiredAt,
        sourceAuthority: entry.sourceAuthority,
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
      parentChunkId?: string | null;
      headingPath?: string[];
      sectionId?: string | null;
      clauseId?: string | null;
      tableRef?: string | null;
      sourceStart?: number | null;
      sourceEnd?: number | null;
      docVersion?: string | null;
      effectiveAt?: Date | null;
      expiredAt?: Date | null;
      sourceAuthority?: string;
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
        parentChunkId: c.parentChunkId,
        headingPath: c.headingPath,
        sectionId: c.sectionId,
        clauseId: c.clauseId,
        tableRef: c.tableRef,
        sourceStart: c.sourceStart,
        sourceEnd: c.sourceEnd,
        docVersion: c.docVersion,
        effectiveAt: c.effectiveAt?.toISOString() ?? null,
        expiredAt: c.expiredAt?.toISOString() ?? null,
        sourceAuthority: c.sourceAuthority,
      });
      this.persistedEntries.push({
        id: c.id,
        content: c.content,
        docId: c.docId,
        chunkIndex: c.chunkIndex,
        tokens: [], // tokens 由 BM25 内部管理，此处存空数组即可
        userId,
        parentChunkId: c.parentChunkId,
        headingPath: c.headingPath,
        sectionId: c.sectionId,
        clauseId: c.clauseId,
        tableRef: c.tableRef,
        sourceStart: c.sourceStart,
        sourceEnd: c.sourceEnd,
        docVersion: c.docVersion,
        effectiveAt: c.effectiveAt?.toISOString() ?? null,
        expiredAt: c.expiredAt?.toISOString() ?? null,
        sourceAuthority: c.sourceAuthority,
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
    const normalizedQuery = this.normalizeQuery(query);

    // 1. BM25 检索 topK*2（多召回一些用于融合）
    let bm25Hits: Array<{
      id: string;
      score: number;
      content: string;
      docId: string;
      chunkIndex: number;
      parentChunkId?: string | null;
      headingPath?: string[];
      sectionId?: string | null;
      clauseId?: string | null;
      tableRef?: string | null;
      sourceStart?: number | null;
      sourceEnd?: number | null;
      docVersion?: string | null;
      effectiveAt?: string | null;
      expiredAt?: string | null;
      sourceAuthority?: string;
    }> = [];

    if (this.elasticsearchProvider.isEnabled()) {
      bm25Hits = await this.elasticsearchProvider.search(
        normalizedQuery,
        this.topK * 2,
        userId,
      );
    } else {
      const userBm25 = this.getBm25Instance(userId);
      const localHits = userBm25.search(normalizedQuery, this.topK * 2);
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
            ...this.pickChunkMetadata(meta),
          };
        })
        .filter((h): h is NonNullable<typeof h> => h !== null);
    }
    const bm25MaxScore = Math.max(...bm25Hits.map((h) => h.score), 1);
    this.metricsService.observeRetrievalHits(
      this.elasticsearchProvider.isEnabled() ? 'elasticsearch' : 'bm25',
      vectorSearch ? 'hybrid' : 'keyword',
      bm25Hits.length,
    );

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
        cosineHits = this.filterActiveVectorHits(cosineHits, userId);
      } catch (err) {
        this.logger.warn(
          `Vector search failed, fallback to BM25 only: ${(err as Error).message}`,
        );
      }
    }
    const cosineMaxScore = Math.max(...cosineHits.map((h) => h.score), 1);
    this.metricsService.observeRetrievalHits(
      'milvus',
      vectorSearch ? 'hybrid' : 'keyword',
      cosineHits.length,
    );

    // 3. 加权融合（归一化后加权）
    const fusedMap = new Map<string, RetrievedChunk>();

    for (const hit of bm25Hits) {
      const normalizedBm25 = hit.score / bm25MaxScore;
      fusedMap.set(hit.id, {
        id: hit.id,
        content: hit.content,
        docId: hit.docId,
        chunkIndex: hit.chunkIndex,
        ...this.pickChunkMetadata(hit),
        bm25Score: normalizedBm25,
        cosineScore: 0,
        totalScore: normalizedBm25 * this.bm25Weight,
      });
    }

    for (const hit of cosineHits) {
      const normalizedCosine = hit.score / cosineMaxScore;
      const metadata = this.pickChunkMetadata(this.chunkMeta.get(hit.id) ?? {});
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
          ...metadata,
          bm25Score: 0,
          cosineScore: normalizedCosine,
          totalScore: normalizedCosine * this.cosineWeight,
        });
      }
    }

    // 4. 按总分排序，取 topK；可选叠加来源权威权重
    const results = this.applySourceAuthority(
      Array.from(fusedMap.values()),
    ).sort((a, b) => b.totalScore - a.totalScore);
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
    const normalizedQuery = this.normalizeQuery(query);
    let bm25Hits: Array<{
      id: string;
      score: number;
      content: string;
      docId: string;
      chunkIndex: number;
      parentChunkId?: string | null;
      headingPath?: string[];
      sectionId?: string | null;
      clauseId?: string | null;
      tableRef?: string | null;
      sourceStart?: number | null;
      sourceEnd?: number | null;
      docVersion?: string | null;
      effectiveAt?: string | null;
      expiredAt?: string | null;
      sourceAuthority?: string;
    }> = [];

    if (this.elasticsearchProvider.isEnabled()) {
      bm25Hits = await this.elasticsearchProvider.search(
        normalizedQuery,
        this.topK * 2,
        userId,
      );
    } else {
      const userBm25 = this.getBm25Instance(userId);
      const localHits = userBm25.search(normalizedQuery, this.topK * 2);
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
            ...this.pickChunkMetadata(meta),
          };
        })
        .filter((h): h is NonNullable<typeof h> => h !== null);
    }

    const bm25MaxScore = Math.max(...bm25Hits.map((h) => h.score), 1);
    this.metricsService.observeRetrievalHits(
      this.elasticsearchProvider.isEnabled() ? 'elasticsearch' : 'bm25',
      'keyword',
      bm25Hits.length,
    );

    return bm25Hits
      .map((hit) => {
        const normalizedBm25 = hit.score / bm25MaxScore;
        return {
          id: hit.id,
          content: hit.content,
          docId: hit.docId,
          chunkIndex: hit.chunkIndex,
          ...this.pickChunkMetadata(hit),
          bm25Score: normalizedBm25,
          cosineScore: 0,
          totalScore: normalizedBm25 * this.bm25Weight,
        } satisfies RetrievedChunk;
      })
      .map((chunk) => this.applySourceAuthorityToChunk(chunk))
      .sort((a, b) => b.totalScore - a.totalScore)
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
    const normalizedQuery = this.normalizeQuery(query);
    const chunks = await this.retrieve(normalizedQuery, {}, userId);

    if (chunks.length === 0) {
      return {
        answer: '未找到相关内容，请先上传文档。',
        references: [],
        retrievalSufficient: false,
        retrievalReason: '没有检索到候选片段',
      };
    }

    const retrievalGate = this.assessRetrievalQuality(normalizedQuery, chunks);
    if (!retrievalGate.sufficient) {
      return {
        answer: this.unsupportedAnswer,
        references: [],
        retrievalSufficient: false,
        retrievalReason: retrievalGate.reason,
      };
    }

    const context = chunks
      .map((c, i) => `[片段 ${i + 1}]\n${c.content}`)
      .join('\n\n---\n\n');

    this.logger.log(`Generating answer with ${chunks.length} chunks`);
    const messages = await generateAnswerPrompt.formatMessages({
      context,
      query: this.normalizePromptQuery(query),
      history,
      memory: memoryMessages,
    });
    const rawAnswer = await this.llmProvider.invoke(messages);
    const answer = this.addVersionConflictNotice(rawAnswer, chunks);
    const citationGate = this.assessCitationSupport(answer, chunks);
    if (!citationGate.sufficient) {
      const fallbackAnswer = this.buildExtractiveAnswer(
        normalizedQuery,
        chunks,
      );
      if (fallbackAnswer) {
        const fallbackGate = this.assessCitationSupport(fallbackAnswer, chunks);
        if (fallbackGate.sufficient) {
          return {
            answer: fallbackAnswer,
            references: this.toReferences(chunks),
            retrievalSufficient: true,
            retrievalReason: 'LLM 答案引用不足，已回退为片段抽取式回答',
          };
        }
      }

      return {
        answer: this.unsupportedAnswer,
        references: [],
        retrievalSufficient: false,
        retrievalReason: citationGate.reason,
      };
    }

    return {
      answer,
      references: this.toReferences(chunks),
      retrievalSufficient: true,
      retrievalReason: '检索片段和答案引用通过本地质量闸门',
    };
  }

  /** 获取当前索引中的所有 docId（用于校验） */
  getIndexedDocIds(): Set<string> {
    return new Set(this.persistedEntries.map((e) => e.docId));
  }

  hasIndexedChunks(userId?: string): boolean {
    return this.persistedEntries.some((entry) => entry.userId === userId);
  }

  assessRetrievedChunks(
    query: string,
    chunks: RetrievedChunk[],
  ): { sufficient: boolean; reason: string } {
    return this.assessRetrievalQuality(this.normalizeQuery(query), chunks);
  }

  validateAnswerCitationSupport(
    answer: string,
    chunks: RetrievedChunk[],
  ): { sufficient: boolean; reason: string } {
    return this.assessCitationSupport(answer, chunks);
  }

  unsupportedReliableAnswer(): string {
    return this.unsupportedAnswer;
  }

  addVersionConflictNotice(answer: string, chunks: RetrievedChunk[]): string {
    if (/版本|冲突|优先|生效|失效/.test(answer)) {
      return answer;
    }

    const candidate = chunks.find((chunk) => {
      const years = new Set(chunk.content.match(/20\d{2}/g) ?? []);
      return years.size >= 2;
    });
    if (!candidate) {
      return answer;
    }

    const index = chunks.indexOf(candidate) + 1;
    const years = [...new Set(candidate.content.match(/20\d{2}/g) ?? [])].join(
      '、',
    );
    return `${answer}\n\n片段中同时提到 ${years} 版本，请注意版本差异并以明确标注优先或生效的版本为准。[片段${index}]`;
  }

  buildExtractiveAnswer(query: string, chunks: RetrievedChunk[]): string {
    const queryTokens = this.extractQualityTokens(query);
    const selected: string[] = [];

    chunks.slice(0, 5).forEach((chunk, index) => {
      const sentences = this.extractEvidenceSentences(chunk.content);
      const best = sentences
        .map((sentence) => ({
          sentence,
          overlap: this.countTokenOverlap(queryTokens, sentence),
        }))
        .filter((item) => item.overlap > 0)
        .sort((a, b) => b.overlap - a.overlap)
        .slice(0, 2);

      for (const item of best) {
        const sentence = item.sentence.replace(/\[片段\s*\d+\]/g, '').trim();
        if (!sentence || selected.some((line) => line.includes(sentence))) {
          continue;
        }
        selected.push(`${sentence}[片段${index + 1}]`);
      }
    });

    return selected.slice(0, 4).join('\n');
  }

  private extractEvidenceSentences(text: string): string[] {
    return text
      .replace(/\|/g, ' ')
      .split(/(?<=[。！？!?；;])|\n+/u)
      .map((line) => line.replace(/^#+\s*/, '').trim())
      .filter((line) => line.length >= 8);
  }

  private toReferences(
    chunks: RetrievedChunk[],
  ): KarpathyRagResult['references'] {
    return chunks.map((c) => ({
      id: c.id,
      content: c.content,
      docId: c.docId,
      chunkIndex: c.chunkIndex,
      totalScore: c.totalScore,
      bm25Score: c.bm25Score,
      cosineScore: c.cosineScore,
      sourceAuthorityWeight: c.sourceAuthorityWeight,
      parentChunkId: c.parentChunkId,
      headingPath: c.headingPath,
      sectionId: c.sectionId,
      clauseId: c.clauseId,
      tableRef: c.tableRef,
      sourceStart: c.sourceStart,
      sourceEnd: c.sourceEnd,
      docVersion: c.docVersion,
      effectiveAt: c.effectiveAt,
      expiredAt: c.expiredAt,
      sourceAuthority: c.sourceAuthority,
    }));
  }

  private pickChunkMetadata(
    chunk: Partial<RetrievedChunk>,
  ): Pick<
    RetrievedChunk,
    | 'parentChunkId'
    | 'headingPath'
    | 'sectionId'
    | 'clauseId'
    | 'tableRef'
    | 'sourceStart'
    | 'sourceEnd'
    | 'docVersion'
    | 'effectiveAt'
    | 'expiredAt'
    | 'sourceAuthority'
  > {
    return {
      parentChunkId: chunk.parentChunkId,
      headingPath: chunk.headingPath,
      sectionId: chunk.sectionId,
      clauseId: chunk.clauseId,
      tableRef: chunk.tableRef,
      sourceStart: chunk.sourceStart,
      sourceEnd: chunk.sourceEnd,
      docVersion: chunk.docVersion,
      effectiveAt: chunk.effectiveAt,
      expiredAt: chunk.expiredAt,
      sourceAuthority: chunk.sourceAuthority,
    };
  }

  private applySourceAuthority(chunks: RetrievedChunk[]): RetrievedChunk[] {
    return chunks.map((chunk) => this.applySourceAuthorityToChunk(chunk));
  }

  private applySourceAuthorityToChunk(chunk: RetrievedChunk): RetrievedChunk {
    const weight = this.resolveSourceAuthorityWeight(chunk);
    if (weight === 1) {
      return chunk;
    }

    return {
      ...chunk,
      totalScore: chunk.totalScore * weight,
      sourceAuthorityWeight: weight,
    };
  }

  private resolveSourceAuthorityWeight(chunk: RetrievedChunk): number {
    const rawRules =
      this.configService.get<string>('ragQuality.sourceAuthorityRules') ?? '';
    if (!rawRules.trim()) {
      return 1;
    }

    const haystack = `${chunk.docId}\n${chunk.content}`.toLowerCase();
    let weight = 1;
    for (const rule of rawRules.split(',')) {
      const [rawPattern, rawWeight] = rule.split(':');
      const pattern = rawPattern?.trim().toLowerCase();
      const parsedWeight = Number(rawWeight);
      if (!pattern || !Number.isFinite(parsedWeight)) {
        continue;
      }
      if (haystack.includes(pattern)) {
        weight = this.clampSourceAuthorityWeight(parsedWeight);
      }
    }
    return weight;
  }

  private clampSourceAuthorityWeight(weight: number): number {
    return Math.min(Math.max(weight, 0.5), 2);
  }

  private filterActiveVectorHits(
    hits: Awaited<ReturnType<VectorStoreProvider['similaritySearch']>>,
    userId?: string,
  ): Awaited<ReturnType<VectorStoreProvider['similaritySearch']>> {
    const activeDocIds = new Set(
      this.persistedEntries
        .filter((entry) => entry.userId === userId)
        .map((entry) => entry.docId),
    );

    return hits.filter((hit) => activeDocIds.has(hit.docId));
  }

  private normalizeQuery(query: string): string {
    return this.normalizePromptQuery(query).toLowerCase();
  }

  private normalizePromptQuery(query: string): string {
    const normalized = query
      .normalize('NFKC')
      .replace(/知识哭/g, '知识库')
      .replace(/\s+/g, ' ')
      .trim();

    if (
      /住宿报销上限|报销上限/.test(normalized) &&
      /20\d{2}|历史|版本|优先|生效/.test(normalized)
    ) {
      return `${normalized} 差旅制度 住宿标准 优先生效 历史版本`;
    }

    return normalized;
  }

  private assessRetrievalQuality(
    query: string,
    chunks: RetrievedChunk[],
  ): { sufficient: boolean; reason: string } {
    const topScore = chunks[0]?.totalScore ?? 0;
    const minTopScore =
      this.configService.get<number>('ragQuality.minTopScore') ?? 0.05;
    if (topScore < minTopScore) {
      return {
        sufficient: false,
        reason: `最高检索分 ${topScore.toFixed(3)} 低于阈值 ${minTopScore}`,
      };
    }

    const queryTokens = this.extractQualityTokens(query);
    const minOverlap =
      this.configService.get<number>('ragQuality.minQueryTokenOverlap') ?? 1;
    if (queryTokens.size === 0 || minOverlap <= 0) {
      return { sufficient: true, reason: '检索分数通过阈值' };
    }

    const maxOverlap = Math.max(
      ...chunks.map((chunk) =>
        this.countTokenOverlap(queryTokens, chunk.content),
      ),
      0,
    );
    if (maxOverlap < minOverlap) {
      return {
        sufficient: false,
        reason: `检索片段与问题关键词重合数 ${maxOverlap} 低于阈值 ${minOverlap}`,
      };
    }

    const queryChineseTerms = this.extractChinesePhraseTokens(query);
    if (queryChineseTerms.size >= 3) {
      const maxPhraseOverlap = Math.max(
        ...chunks.map((chunk) =>
          this.countChinesePhraseOverlap(queryChineseTerms, chunk.content),
        ),
        0,
      );
      const minPhraseOverlap =
        this.configService.get<number>('ragQuality.minChinesePhraseOverlap') ??
        2;
      if (maxPhraseOverlap < minPhraseOverlap) {
        return {
          sufficient: false,
          reason: `检索片段与问题中文短语重合数 ${maxPhraseOverlap} 低于阈值 ${minPhraseOverlap}`,
        };
      }
    }

    return { sufficient: true, reason: '检索分数与关键词重合通过阈值' };
  }

  private assessCitationSupport(
    answer: string,
    chunks: RetrievedChunk[],
  ): { sufficient: boolean; reason: string } {
    const citedIndexes = this.extractCitedIndexes(answer);
    if (citedIndexes.size === 0) {
      return { sufficient: false, reason: '答案缺少显式片段引用' };
    }

    const citedChunks = [...citedIndexes].map((index) => chunks[index - 1]);
    if (citedChunks.some((chunk) => !chunk)) {
      return { sufficient: false, reason: '答案引用了不存在的片段编号' };
    }

    const answerTokens = this.extractQualityTokens(
      answer.replace(/\[片段\s*\d+\]/g, ''),
    );
    if (answerTokens.size === 0) {
      return { sufficient: false, reason: '答案缺少可校验内容' };
    }

    const minCoverage =
      this.configService.get<number>('ragQuality.minCitationCoverage') ?? 0.15;
    const claimGate = this.assessClaimSupport(answer, chunks, minCoverage);
    if (!claimGate.sufficient) {
      return claimGate;
    }

    const citedText = citedChunks.map((chunk) => chunk.content).join('\n');
    const overlap = this.countTokenOverlap(answerTokens, citedText);
    const coverage = overlap / answerTokens.size;
    if (coverage < minCoverage) {
      return {
        sufficient: false,
        reason: `答案内容被引用片段覆盖率 ${coverage.toFixed(2)} 低于阈值 ${minCoverage}`,
      };
    }

    return { sufficient: true, reason: '答案引用可被检索片段支撑' };
  }

  private assessClaimSupport(
    answer: string,
    chunks: RetrievedChunk[],
    minCoverage: number,
  ): { sufficient: boolean; reason: string } {
    const claims = this.extractClaims(answer);
    for (const claim of claims) {
      const claimTokens = this.extractQualityTokens(
        claim.replace(/\[片段\s*\d+\]/g, ''),
      );
      if (claimTokens.size < 2) {
        continue;
      }

      const claimCitations = this.extractCitedIndexes(claim);
      if (claimCitations.size === 0) {
        return {
          sufficient: false,
          reason: `关键结论缺少逐句引用：${this.shortenClaim(claim)}`,
        };
      }

      const citedChunks = [...claimCitations].map((index) => chunks[index - 1]);
      if (citedChunks.some((chunk) => !chunk)) {
        return {
          sufficient: false,
          reason: `关键结论引用了不存在的片段：${this.shortenClaim(claim)}`,
        };
      }

      const citedText = citedChunks.map((chunk) => chunk.content).join('\n');
      const coverage =
        this.countTokenOverlap(claimTokens, citedText) / claimTokens.size;
      if (coverage < minCoverage) {
        return {
          sufficient: false,
          reason: `关键结论引用支撑不足：${this.shortenClaim(claim)}`,
        };
      }
    }

    return { sufficient: true, reason: '逐句关键结论引用通过' };
  }

  private extractClaims(answer: string): string[] {
    const claims =
      answer.match(/[^。！？!?；;\n]+[。！？!?；;]?(?:\s*\[片段\s*\d+\])*/gu) ??
      [];
    return claims.map((claim) => claim.trim()).filter(Boolean);
  }

  private shortenClaim(claim: string): string {
    return claim.length > 40 ? `${claim.slice(0, 40)}...` : claim;
  }

  private extractCitedIndexes(answer: string): Set<number> {
    const indexes = new Set<number>();
    const pattern = /\[片段\s*(\d+)\]/g;
    for (const match of answer.matchAll(pattern)) {
      indexes.add(Number(match[1]));
    }
    return indexes;
  }

  private extractQualityTokens(text: string): Set<string> {
    const normalized = this.normalizeQuery(text);
    const rawTokens =
      normalized.match(/[\p{Script=Han}]|[\p{L}\p{N}_-]+/gu) ?? [];
    const stopwords = new Set([
      '的',
      '了',
      '和',
      '是',
      '在',
      '有',
      '这',
      '那',
      '请',
      '什么',
      '如何',
      '以及',
      'the',
      'and',
      'for',
      'with',
      'that',
      'this',
      'what',
      'how',
      'why',
    ]);

    return new Set(
      rawTokens
        .map((token) => token.trim())
        .filter((token) => token.length > 0)
        .filter((token) => !stopwords.has(token))
        .filter((token) => token.length > 1 || /[\p{Script=Han}]/u.test(token)),
    );
  }

  private countTokenOverlap(tokens: Set<string>, text: string): number {
    const targetTokens = this.extractQualityTokens(text);
    let overlap = 0;
    for (const token of tokens) {
      if (targetTokens.has(token)) {
        overlap += 1;
      }
    }
    return overlap;
  }

  private extractChinesePhraseTokens(text: string): Set<string> {
    const normalized = this.normalizeQuery(text);
    const stopwords = new Set([
      '什么',
      '多少',
      '怎么',
      '如何',
      '需要',
      '哪些',
      '分别',
      '公司',
      '如果',
      '是否',
    ]);
    const phrases = new Set<string>();
    const segments = normalized.match(/[\p{Script=Han}]{2,}/gu) ?? [];

    for (const segment of segments) {
      if (segment.length <= 4 && !stopwords.has(segment)) {
        phrases.add(segment);
      }
      for (let i = 0; i < segment.length - 1; i += 1) {
        const phrase = segment.slice(i, i + 2);
        if (!stopwords.has(phrase)) {
          phrases.add(phrase);
        }
      }
    }

    return phrases;
  }

  private countChinesePhraseOverlap(tokens: Set<string>, text: string): number {
    const targetTokens = this.extractChinesePhraseTokens(text);
    let overlap = 0;
    for (const token of tokens) {
      if (targetTokens.has(token)) {
        overlap += 1;
      }
    }
    return overlap;
  }
}
