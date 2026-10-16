import { createHash } from 'node:crypto';
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
    allowedDocIds?: ReadonlySet<string>,
  ): Promise<ImageSearchHit[]>;
  deleteImagesByDocId(docId: string, userId?: string): Promise<void>;
}

export const IMAGE_VECTOR_STORE_PORT = 'IMAGE_VECTOR_STORE_PORT';

export interface ImageIndexInput {
  /** 图片所属文档 ID */
  docId: string;
  /** 归属用户/租户（多租户隔离过滤） */
  userId?: string;
  /** 图片可访问 URL（与 base64 二选一） */
  url?: string;
  /** 图片 base64（与 url 二选一） */
  base64?: string;
  /** 使用受控代理 URL 返回结果时，单独传入原图 base64 供嵌入模型读取。 */
  embeddingBase64?: string;
  /** base64 输入对应 MIME 类型。 */
  mimeType?: string;
  /** 原始图片内容 SHA-256；未提供时由 URL/base64 派生。 */
  assetHash?: string;
  /** 源文档内稳定的图片相对路径，用于保持重复解析后的 asset ID。 */
  assetKey?: string;
  /** 附加信息（文件名 / 描述 / 页码等），JSON 存入 meta 字段 */
  meta?: Record<string, unknown>;
}

export interface ImageSearchOptions {
  topK?: number;
  userId?: string;
  /** 由 DocumentPermissionService 计算出的 ACL 允许文档集合。 */
  allowedDocIds?: ReadonlySet<string>;
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

  /** 单张图片的兼容入口。 */
  async indexImage(input: ImageIndexInput): Promise<ImageIndexResult> {
    const docId = input.docId?.trim();
    if (!docId) {
      throw new Error('indexImage 失败：docId 不能为空');
    }
    if (!input.url && !input.base64 && !input.embeddingBase64) {
      throw new Error(
        `indexImage 失败：doc=${docId} 需要提供 url 或 base64 之一`,
      );
    }

    const [result] = await this.replaceDocumentImages(docId, input.userId, [
      input,
    ]);
    return result;
  }

  /**
   * 替换文档下的完整图片资产集合：所有图片先并发向量化，再一次性批量写入。
   * 先完成嵌入再清理旧记录，避免临时的模型故障清空现有图片索引。
   */
  async replaceDocumentImages(
    docId: string,
    userId: string | undefined,
    inputs: ImageIndexInput[],
  ): Promise<ImageIndexResult[]> {
    const normalizedDocId = docId?.trim();
    if (!normalizedDocId) {
      throw new Error('replaceDocumentImages 失败：docId 不能为空');
    }
    if (
      inputs.some(
        (input) =>
          input.docId.trim() !== normalizedDocId ||
          (!input.url && !input.base64 && !input.embeddingBase64),
      )
    ) {
      throw new Error(
        'replaceDocumentImages 失败：图片必须归属同一文档且包含 url 或 base64',
      );
    }

    const vectors = await mapWithConcurrency(inputs, 3, (input) =>
      this.embedding.embedImage({
        url: input.embeddingBase64 ? undefined : input.url,
        base64: input.embeddingBase64 ?? input.base64,
        mimeType: input.mimeType,
      }),
    );
    const records: ImageVectorRecord[] = inputs.map((input, index) => {
      const assetHash = input.assetHash ?? hashAssetIdentity(input);
      const assetIdentity =
        input.assetKey ?? input.url ?? input.base64 ?? assetHash;
      const id = `img_${createHash('sha256')
        .update(`${normalizedDocId}:${assetHash}:${assetIdentity}`)
        .digest('hex')
        .slice(0, 60)}`;
      const meta = {
        ...(input.meta ?? {}),
        assetHash,
        sourceDocId: normalizedDocId,
      };
      return {
        id,
        vector: vectors[index],
        docId: normalizedDocId,
        userId: input.userId ?? userId,
        url: input.url ?? '',
        meta: JSON.stringify(meta),
      };
    });

    await this.vectorStore.deleteImagesByDocId(normalizedDocId, userId);
    await this.vectorStore.insertImages(records);

    this.logger.log(
      `Replaced image index doc=${normalizedDocId} assets=${records.length}`,
    );
    return records.map((record) => ({
      docId: record.docId,
      id: record.id,
      dimension: record.vector.length,
    }));
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
    if (options.allowedDocIds?.size === 0) return [];

    const vector = await this.embedding.embedText(normalized);
    const hits = await this.vectorStore.searchImages(
      vector,
      topK,
      options.allowedDocIds ? undefined : options.userId,
      options.allowedDocIds,
    );
    return hits
      .filter(
        (hit) => !options.allowedDocIds || options.allowedDocIds.has(hit.docId),
      )
      .slice(0, topK)
      .map((hit) => this.toSearchItem(hit));
  }

  /** 以图搜图：图片嵌入 → rag_images 相似度检索。 */
  async searchImage(
    base64: string,
    mimeType: string,
    options: ImageSearchOptions = {},
  ): Promise<ImageSearchItem[]> {
    if (!base64.trim()) return [];
    const topK = Math.min(Math.max(options.topK ?? 5, 1), 50);
    if (options.allowedDocIds?.size === 0) return [];

    const vector = await this.embedding.embedImage({ base64, mimeType });
    const hits = await this.vectorStore.searchImages(
      vector,
      topK,
      options.allowedDocIds ? undefined : options.userId,
      options.allowedDocIds,
    );
    return hits
      .filter(
        (hit) => !options.allowedDocIds || options.allowedDocIds.has(hit.docId),
      )
      .slice(0, topK)
      .map((hit) => this.toSearchItem(hit));
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

function hashAssetIdentity(input: ImageIndexInput): string {
  return createHash('sha256')
    .update(input.embeddingBase64 ?? input.base64 ?? input.url ?? '')
    .digest('hex');
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let index = 0; index < items.length; index += concurrency) {
    const batch = items.slice(index, index + concurrency);
    results.push(...(await Promise.all(batch.map(mapper))));
  }
  return results;
}
