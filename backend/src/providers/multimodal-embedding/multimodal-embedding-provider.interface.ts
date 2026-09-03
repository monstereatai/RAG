/**
 * 多模态嵌入 Provider 抽象接口
 *
 * 走 DashScope multimodal-embedding（文本与图片映射到同一向量空间），
 * 支撑「以图搜图 / 文搜图」跨模态检索。
 */

/**
 * 可注入的 HTTP 客户端类型（与全局 fetch 签名兼容），
 * 冒烟/单测可注入 fake 实现而不发起真实网络请求。
 */
export type MultimodalEmbeddingFetch = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

/** 图片嵌入输入：url 与 base64 二选一 */
export interface MultimodalImageInput {
  /** 图片可访问 URL（对象存储公网地址等） */
  url?: string;
  /** 图片 base64 内容（不带 data: 前缀的纯 base64，或完整 data URI） */
  base64?: string;
  /** base64 对应的 MIME 类型（仅 base64 未带 data: 前缀时生效，默认 image/png） */
  mimeType?: string;
}

export interface IMultimodalEmbeddingProvider {
  /** API Key 是否已配置；未启用时所有嵌入方法抛出明确错误 */
  isEnabled(): boolean;

  /** 当前配置的向量维度（用于与 Milvus 图片集合维度对齐） */
  getDimension(): number;

  /** 文本 → 向量 */
  embedText(text: string): Promise<number[]>;

  /** 图片 → 向量（与文本同一向量空间） */
  embedImage(input: MultimodalImageInput): Promise<number[]>;
}
