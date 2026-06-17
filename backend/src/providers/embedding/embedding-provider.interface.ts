/**
 * Embedding Provider 抽象接口
 * 可插拔：qwen / openai
 */
export interface IEmbeddingProvider {
  /**
   * 对单条文本生成向量
   * @param text 输入文本
   * @returns 向量（number[]）
   */
  embedQuery(text: string): Promise<number[]>;

  /**
   * 批量生成向量
   * @param texts 输入文本列表
   * @returns 向量列表（number[][]）
   */
  embedDocuments(texts: string[]): Promise<number[][]>;
}
