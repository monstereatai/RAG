import { BaseMessageLike } from '@langchain/core/messages';

/**
 * LLM Provider 抽象接口
 * 可插拔：qwen / openai
 */
export interface ILLMProvider {
  /**
   * 调用 LLM 生成回复
   * @param messages 消息列表（string 或 BaseMessageLike）
   * @returns LLM 生成的文本
   */
  invoke(messages: string | BaseMessageLike[]): Promise<string>;
}
