import { BaseMessageLike } from '@langchain/core/messages';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';

/**
 * LLM Provider 抽象接口
 * 可插拔：qwen / deepseek / zhipu
 */
export type LlmModelProvider = 'qwen' | 'deepseek' | 'zhipu';

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens?: number;
}

export interface LlmInvokeOptions {
  signal?: AbortSignal;
  /** 供应商返回真实 usage 时回调；未返回时调用方继续使用估算值。 */
  onUsage?: (usage: LlmUsage) => void;
}

export interface ILLMProvider {
  /**
   * 调用 LLM 生成回复
   * @param messages 消息列表（string 或 BaseMessageLike）
   * @returns LLM 生成的文本
   */
  invoke(
    messages: string | BaseMessageLike[],
    options?: LlmInvokeOptions,
  ): Promise<string>;

  /**
   * 获取底层 ChatModel 实例（用于 withStructuredOutput / stream 等高级能力）
   */
  getModel(): BaseChatModel;
}
