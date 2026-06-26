import { BaseMessageLike } from '@langchain/core/messages';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';

/**
 * LLM Provider 抽象接口
 * 可插拔：qwen / deepseek / openai
 */
export type LlmModelProvider = 'qwen' | 'deepseek';

export interface ILLMProvider {
  /**
   * 调用 LLM 生成回复
   * @param messages 消息列表（string 或 BaseMessageLike）
   * @returns LLM 生成的文本
   */
  invoke(messages: string | BaseMessageLike[]): Promise<string>;

  /**
   * 获取底层 ChatModel 实例（用于 withStructuredOutput / stream 等高级能力）
   */
  getModel(): BaseChatModel;
}
