import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IMultimodalEmbeddingProvider,
  MultimodalImageInput,
} from './multimodal-embedding-provider.interface';
import type { MultimodalEmbeddingFetch } from './multimodal-embedding-provider.interface';

/**
 * DashScope 多模态嵌入 Provider
 *
 * 文本与图片走同一个 multimodal-embedding 模型，输出同一向量空间，
 * 用于「以图搜图 / 文搜图」。未配置 API Key 时 isEnabled()=false，
 * 所有嵌入方法抛出明确错误，由上层（ImageIndexService / REST）降级。
 *
 * 环境变量（直接读取 process.env，与 RERANK_PROVIDER 的读取惯例一致）：
 * - MULTIMODAL_EMBEDDING_MODEL      模型名，默认 multimodal-embedding-v1
 * - MULTIMODAL_EMBEDDING_DIM        向量维度，默认 1024（v1 固定 1024）
 * - MULTIMODAL_EMBEDDING_API_KEY    独立 Key，未设置时回落 DASHSCOPE_API_KEY
 * - MULTIMODAL_EMBEDDING_BASE_URL   API 基地址，默认 https://dashscope.aliyuncs.com
 */

/** 冒烟/单测注入 fake fetch 的 DI token */
export const MULTIMODAL_EMBEDDING_FETCH_TOKEN = 'MULTIMODAL_EMBEDDING_FETCH';

const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com';
const EMBEDDING_PATH =
  '/api/v1/services/embeddings/multimodal-embedding/multimodal-embedding';
const DEFAULT_MODEL = 'multimodal-embedding-v1';
const DEFAULT_DIMENSION = 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_TEXT_LENGTH = 512; // multimodal-embedding-v1 文本上限 512 token，提前截断兜底

interface DashScopeMultimodalEmbeddingResponse {
  output?: {
    embeddings?: Array<{
      index?: unknown;
      embedding?: unknown;
      type?: unknown;
    }>;
  };
  code?: string;
  message?: string;
  request_id?: string;
}

type EmbedContent = { text: string } | { image: string };

@Injectable()
export class MultimodalEmbeddingProvider implements IMultimodalEmbeddingProvider {
  private readonly logger = new Logger(MultimodalEmbeddingProvider.name);
  private readonly apiKey: string;
  private readonly model: string;
  private readonly dimension: number;
  private readonly dimensionExplicit: boolean;
  private readonly baseUrl: string;
  private readonly fetchImpl: MultimodalEmbeddingFetch;

  constructor(
    private readonly config: ConfigService,
    @Optional()
    @Inject(MULTIMODAL_EMBEDDING_FETCH_TOKEN)
    fetchImpl?: MultimodalEmbeddingFetch,
  ) {
    this.apiKey =
      this.config.get<string>('MULTIMODAL_EMBEDDING_API_KEY') ??
      this.config.get<string>('DASHSCOPE_API_KEY') ??
      '';
    this.model =
      this.config.get<string>('MULTIMODAL_EMBEDDING_MODEL') ?? DEFAULT_MODEL;
    const dimEnv = this.config.get<string | number>('MULTIMODAL_EMBEDDING_DIM');
    this.dimensionExplicit = dimEnv !== undefined && dimEnv !== '';
    this.dimension = this.dimensionExplicit
      ? parseInt(String(dimEnv), 10)
      : DEFAULT_DIMENSION;
    this.baseUrl = (
      this.config.get<string>('MULTIMODAL_EMBEDDING_BASE_URL') ??
      DEFAULT_BASE_URL
    ).replace(/\/+$/, '');
    // HTTP 客户端可注入（冒烟用），默认全局 fetch
    this.fetchImpl = fetchImpl ?? ((url, init) => fetch(url, init));
  }

  isEnabled(): boolean {
    return Boolean(this.apiKey);
  }

  getDimension(): number {
    return this.dimension;
  }

  /** 文本 → 向量 */
  async embedText(text: string): Promise<number[]> {
    const normalized = text.trim();
    if (!normalized) {
      throw new Error('MultimodalEmbeddingProvider.embedText: 文本不能为空');
    }
    return this.embed([{ text: normalized.slice(0, MAX_TEXT_LENGTH) }]);
  }

  /** 图片 → 向量（与文本同一向量空间） */
  async embedImage(input: MultimodalImageInput): Promise<number[]> {
    const image = this.resolveImageContent(input);
    return this.embed([{ image }]);
  }

  private resolveImageContent(input: MultimodalImageInput): string {
    if (input.url && input.url.trim()) {
      return input.url.trim();
    }
    if (input.base64 && input.base64.trim()) {
      const raw = input.base64.trim();
      // 已是 data URI 直接用；纯 base64 补前缀（DashScope 要求 data:image/xxx;base64,xxx）
      if (raw.startsWith('data:')) return raw;
      const mime = input.mimeType?.trim() || 'image/png';
      return `data:${mime};base64,${raw}`;
    }
    throw new Error(
      'MultimodalEmbeddingProvider.embedImage: 需要 url 或 base64 之一',
    );
  }

  private async embed(contents: EmbedContent[]): Promise<number[]> {
    if (!this.isEnabled()) {
      throw new Error(
        '多模态嵌入未启用：请配置 MULTIMODAL_EMBEDDING_API_KEY（或回落使用 DASHSCOPE_API_KEY）',
      );
    }

    // dimension 仅在显式配置时下发（multimodal-embedding-v1 固定 1024，
    // 只有部分模型如 qwen3-vl-embedding 支持自定义维度）
    const parameters: Record<string, unknown> = {};
    if (this.dimensionExplicit) {
      parameters['dimension'] = this.dimension;
    }

    const url = `${this.baseUrl}${EMBEDDING_PATH}`;
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        input: { contents },
        parameters,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `DashScope multimodal embedding failed: ${response.status} ${body.slice(0, 200)}`,
      );
    }

    const payload =
      (await response.json()) as DashScopeMultimodalEmbeddingResponse;
    const embeddingItem = payload.output?.embeddings?.[0];
    const vector = embeddingItem?.embedding;
    const embeddingType =
      typeof embeddingItem?.type === 'string' ? embeddingItem.type : '';

    if (!Array.isArray(vector) || vector.length === 0) {
      throw new Error(
        `DashScope multimodal embedding 返回无效向量：code=${payload.code ?? 'unknown'} message=${payload.message ?? 'empty embeddings'}`,
      );
    }

    if (vector.length !== this.dimension) {
      throw new Error(
        `多模态嵌入维度不匹配：模型返回 ${vector.length} 维，配置 MULTIMODAL_EMBEDDING_DIM=${this.dimension}。` +
          '请调整 MULTIMODAL_EMBEDDING_DIM / MILVUS_IMAGE_DIMENSION 与模型输出保持一致。',
      );
    }

    this.logger.debug(
      `Multimodal embedding ok: model=${this.model} dim=${vector.length} type=${embeddingType}`,
    );
    return vector.map((v) => (typeof v === 'number' ? v : Number(v)));
  }
}
