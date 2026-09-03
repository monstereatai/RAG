import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ImageSearchHit,
  ImageVectorRecord,
} from '../../providers/vector-store/vector-store-provider.interface';
import { MultimodalEmbeddingProvider } from '../../providers/multimodal-embedding/multimodal-embedding.provider';

/**
 * 图片向量库端口：ImageIndexService 只依赖该最小接口，
 * 便于单测/冒烟注入内存版实现（生产绑定 VectorStoreProvider）。
 */
export interface ImageVectorStorePort {
  insertImages(records: ImageVectorRecord[]): Promise<void>;
  searchImages(
    queryVector: number[],
    k: number,
    userId?: string,
  ): Promise<ImageSearchHit[]>;
  deleteImagesByDocId(docId: string, userId?: string): Promise<void>;
}

export const IMAGE_VECTOR_STORE_PORT = 'IMAGE_VECTOR_STORE_PORT';

export interface ImageIndexInput {
  /** 图片所属文档 ID（幂等键：同 docId 重复索引先删后写） */
  docId: string;
  /** 归属用户/租户（多租户隔离过滤） */
  userId?: string;
  /** 图片可访问 URL（与 base64 二选一） */
  url?: string;
  /** 图片 base64（与 url 二选一） */
  base64?: string;
  /** 附加信息（文件名 / 描述 / 页码等），JSON 存入 meta 字段 */
  meta?: Record<string, unknown>;
}

export interface ImageSearchOptions {
  topK?: number;
  userId?: string;
}

export interface ImageSearchItem {
  docId: string;
  url: string;
  score: number;
  meta?: Record<string, unknown>;
}

export interface ImageIndexResult {
  docId: string;
  id: string;
  dimension: number;
}

/**
 * 图片索引/检索服务：以图搜图 / 文搜图
 *
 * 链路：DashScope multimodal-embedding（文本+图片同一向量空间）
 *      → Milvus rag_images 独立集合 → searchText 返回 [{docId,url,score}]。
 *
 * 依赖全部走构造注入，可整体 stub：
 * - embedding：MultimodalEmbeddingProvider（未配置 key 时 isEnabled()=false）
 * - vectorStore：ImageVectorStorePort（生产绑定 Milvus VectorStoreProvider）
 */
@Injectable()
export class ImageIndexService {
  private readonly logger = new Logger(ImageIndexService.name);

  constructor(
    private readonly embedding: MultimodalEmbeddingProvider,
    @Inject(IMAGE_VECTOR_STORE_PORT)
    private readonly vectorStore: ImageVectorStorePort,
  ) {}

  /** 嵌入 Key 是否已配置（Milvus 不可用时由检索方法抛错、上层降级） */
  isEnabled(): boolean {
    return this.embedding.isEnabled();
  }

  /**
   * 索引一张图片：嵌入 + 写入 Milvus rag_images。
   * 幂等：同 docId 重复索引先删后写，集合中每个 docId 只保留最新一条。
   */
  async indexImage(input: ImageIndexInput): Promise<ImageIndexResult> {
    const docId = input.docId?.trim();
    if (!docId) {
      throw new Error('indexImage 失败：docId 不能为空');
    }
    if (!input.url && !input.base64) {
      throw new Error(
        `indexImage 失败：doc=${docId} 需要提供 url 或 base64 之一`,
      );
    }

    const vector = await this.embedding.embedImage({
      url: input.url,
      base64: input.base64,
    });
    const id = `img_${docId}`;

    // 幂等：先删后写
    await this.vectorStore.deleteImagesByDocId(docId, input.userId);
    const record: ImageVectorRecord = {
      id,
      vector,
      docId,
      userId: input.userId,
      url: input.url ?? '',
      meta: input.meta ? JSON.stringify(input.meta) : undefined,
    };
    await this.vectorStore.insertImages([record]);

    this.logger.log(
      `Indexed image doc=${docId} id=${id} dim=${vector.length} source=${input.url ? 'url' : 'base64'}`,
    );
    return { docId, id, dimension: vector.length };
  }

  /**
   * 文搜图：文本嵌入 → rag_images 相似度检索 → [{docId,url,score}]
   */
  async searchText(
    query: string,
    options: ImageSearchOptions = {},
  ): Promise<ImageSearchItem[]> {
    const normalized = query.trim();
    if (!normalized) return [];
    const topK = Math.min(Math.max(options.topK ?? 5, 1), 50);

    const vector = await this.embedding.embedText(normalized);
    const hits = await this.vectorStore.searchImages(
      vector,
      topK,
      options.userId,
    );
    return hits.map((hit) => this.toSearchItem(hit));
  }

  /**
   * 删除某文档的图片向量（文档删除/重建时调用）
   */
  async deleteByDoc(docId: string, userId?: string): Promise<void> {
    await this.vectorStore.deleteImagesByDocId(docId, userId);
    this.logger.log(`Deleted image index for doc=${docId}`);
  }

  private toSearchItem(hit: ImageSearchHit): ImageSearchItem {
    let meta: Record<string, unknown> | undefined;
    if (hit.meta) {
      try {
        const parsed: unknown = JSON.parse(hit.meta);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          meta = parsed as Record<string, unknown>;
        }
      } catch {
        meta = undefined;
      }
    }
    return {
      docId: hit.docId,
      url: hit.url,
      score: hit.score,
      ...(meta ? { meta } : {}),
    };
  }
}
