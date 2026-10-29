import type { LlmModelProvider } from './llm-provider.interface';

/** 不携带请求内容的模型调用错误，防止上游 Prompt 进入用户响应或日志字段。 */
export class LlmInvocationError extends Error {
  constructor(
    readonly provider: LlmModelProvider,
    readonly cause?: unknown,
  ) {
    super(`LLM invocation failed for provider: ${provider}`);
    this.name = 'LlmInvocationError';
  }
}
