import type { LlmUsage } from './llm-provider.interface';

type UsageRecord = Record<string, unknown>;

function asRecord(value: unknown): UsageRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as UsageRecord)
    : undefined;
}

function readNumber(record: UsageRecord | undefined, keys: string[]): number {
  if (!record) return 0;
  for (const key of keys) {
    const value = record[key];
    const number = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(number) && number > 0) return Math.round(number);
  }
  return 0;
}

/** 兼容 LangChain AIMessage、OpenAI 兼容响应和不同供应商的 usage 命名。 */
export function readLlmUsage(response: unknown): LlmUsage | undefined {
  const root = asRecord(response);
  const metadata =
    asRecord(root?.usage_metadata) ?? asRecord(root?.usageMetadata);
  const responseMetadata =
    asRecord(root?.response_metadata) ?? asRecord(root?.responseMetadata);
  const llmOutput = asRecord(root?.llmOutput) ?? asRecord(root?.llm_output);
  const nested =
    asRecord(responseMetadata?.tokenUsage) ??
    asRecord(responseMetadata?.token_usage) ??
    asRecord(llmOutput?.tokenUsage) ??
    asRecord(llmOutput?.token_usage) ??
    asRecord(llmOutput?.usage) ??
    asRecord(root?.usage);
  const usage = metadata ?? nested;
  if (!usage) return undefined;

  const inputTokens = readNumber(usage, [
    'input_tokens',
    'inputTokens',
    'prompt_tokens',
    'promptTokens',
  ]);
  const outputTokens = readNumber(usage, [
    'output_tokens',
    'outputTokens',
    'completion_tokens',
    'completionTokens',
  ]);
  const totalTokens = readNumber(usage, ['total_tokens', 'totalTokens']);
  if (inputTokens <= 0 && outputTokens <= 0 && totalTokens <= 0) {
    return undefined;
  }
  return {
    inputTokens,
    outputTokens,
    ...(totalTokens > 0 ? { totalTokens } : {}),
  };
}
