import { AsyncLocalStorage } from 'node:async_hooks';
import type { LlmUsage } from './llm-provider.interface';
import { readLlmUsage } from './llm-usage';

type LlmUsageObserver = (usage: LlmUsage) => void;

const usageObserver = new AsyncLocalStorage<LlmUsageObserver>();

/** 让底层 LangChain ChatModel 也能回传当前请求的真实 usage。 */
export function runWithLlmUsageObserver<T>(
  observer: LlmUsageObserver,
  callback: () => Promise<T>,
): Promise<T> {
  return usageObserver.run(observer, callback);
}

export function hasLlmUsageObserver(): boolean {
  return Boolean(usageObserver.getStore());
}

export function reportLlmUsage(usage: LlmUsage): void {
  usageObserver.getStore()?.(usage);
}

/**
 * ChatOpenAI 的 `withStructuredOutput()` 会在解析前丢弃 AIMessage 的 metadata。
 * 通过模型完成回调读取原始 LLMResult，避免结构化和流式链路退化为估算 token。
 */
export function createLlmUsageCallback(onUsage?: (usage: LlmUsage) => void) {
  return {
    handleLLMEnd(output: unknown) {
      const usage = readLlmUsage(output);
      if (!usage) return;
      reportLlmUsage(usage);
      onUsage?.(usage);
    },
  };
}
