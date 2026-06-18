import { Injectable, Logger } from '@nestjs/common';
import { BM25, BM25Doc, BM25Hit } from './bm25.util';
import { EmbeddingProvider } from '../../providers/embedding/embedding.provider';
import { VectorStoreProvider } from '../../providers/vector-store/vector-store.provider';
import { LlmProvider } from '../../providers/llm/llm.provider';
import { generateAnswerPrompt } from '../prompts/rag.prompts';

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
 * M1 阶段：BM25 索引存内存（重启丢失，M2 落库后从 DB 重建）
 */
@Injectable()
export class KarpathyRagService {
  private readonly logger = new Logger(KarpathyRagService.name);
  private readonly bm25 = new BM25();
  // chunkId → { content, docId, chunkIndex }，用于 BM25 命中后补全元数据
  private readonly chunkMeta = new Map<
    string,
    { content: string; docId: string; chunkIndex: number }
  >();

  // 混合检索权重
  private readonly bm25Weight = 0.3;
  private readonly cosineWeight = 0.7;
  private readonly topK = 5;

  constructor(
    private readonly embeddingProvider: EmbeddingProvider,
    private readonly vectorStoreProvider: VectorStoreProvider,
    private readonly llmProvider: LlmProvider,
  ) {}

  /**
   * 文档上传后调用：把 chunks 加入 BM25 索引
   */
  indexChunks(
    chunks: Array<{
      id: string;
      content: string;
      docId: string;
      chunkIndex: number;
    }>,
  ): void {
    const docs: BM25Doc[] = chunks.map((c) => ({
      id: c.id,
      content: c.content,
    }));
    this.bm25.addDocs(docs);
    for (const c of chunks) {
      this.chunkMeta.set(c.id, {
        content: c.content,
        docId: c.docId,
        chunkIndex: c.chunkIndex,
      });
    }
    this.logger.log(
      `Indexed ${chunks.length} chunks into BM25 (total: ${this.chunkMeta.size})`,
    );
  }

  /**
   * 混合检索：BM25 + Cosine 加权融合
   */
  async retrieve(
    query: string,
    options: RetrieveOptions = {},
  ): Promise<RetrievedChunk[]> {
    const vectorSearch = options.vectorSearch ?? true;

    // 1. BM25 检索 topK*2（多召回一些用于融合）
    const bm25Hits: BM25Hit[] = this.bm25.search(query, this.topK * 2);
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
      const meta = this.chunkMeta.get(hit.id);
      if (!meta) continue;
      const normalizedBm25 = hit.score / bm25MaxScore;
      fusedMap.set(hit.id, {
        id: hit.id,
        content: meta.content,
        docId: meta.docId,
        chunkIndex: meta.chunkIndex,
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
  retrieveBm25Only(query: string): RetrievedChunk[] {
    const bm25Hits: BM25Hit[] = this.bm25.search(query, this.topK * 2);
    const bm25MaxScore = Math.max(...bm25Hits.map((h) => h.score), 1);

    return bm25Hits
      .map((hit) => {
        const meta = this.chunkMeta.get(hit.id);
        if (!meta) return null;
        const normalizedBm25 = hit.score / bm25MaxScore;
        return {
          id: hit.id,
          content: meta.content,
          docId: meta.docId,
          chunkIndex: meta.chunkIndex,
          bm25Score: normalizedBm25,
          cosineScore: 0,
          totalScore: normalizedBm25 * this.bm25Weight,
        } satisfies RetrievedChunk;
      })
      .filter((chunk): chunk is RetrievedChunk => chunk !== null)
      .slice(0, this.topK);
  }

  /**
   * 完整 RAG：检索 + 生成
   * @param history 多轮对话历史（可选，按时间顺序）
   */
  async answer(
    query: string,
    history: Array<{ role: 'human' | 'ai'; content: string }> = [],
  ): Promise<KarpathyRagResult> {
    const chunks = await this.retrieve(query);

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
}
