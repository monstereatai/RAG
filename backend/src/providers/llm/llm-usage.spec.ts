import { readLlmUsage } from './llm-usage';
import {
  createLlmUsageCallback,
  runWithLlmUsageObserver,
} from './llm-usage-context';

describe('readLlmUsage', () => {
  it('reads LangChain usage_metadata', () => {
    expect(
      readLlmUsage({
        usage_metadata: {
          input_tokens: 12,
          output_tokens: 7,
          total_tokens: 19,
        },
      }),
    ).toEqual({ inputTokens: 12, outputTokens: 7, totalTokens: 19 });
  });

  it('reads OpenAI-compatible response metadata aliases', () => {
    expect(
      readLlmUsage({
        response_metadata: {
          tokenUsage: { promptTokens: 8, completionTokens: 3 },
        },
      }),
    ).toEqual({ inputTokens: 8, outputTokens: 3 });
  });

  it('returns undefined when a provider omits usage', () => {
    expect(readLlmUsage({ content: 'answer' })).toBeUndefined();
  });
});

describe('LLM usage callback', () => {
  it('captures raw LangChain LLMResult usage inside the current request scope', async () => {
    const callback = createLlmUsageCallback();
    const received: unknown[] = [];

    await runWithLlmUsageObserver(
      (usage) => received.push(usage),
      async () => {
        await callback.handleLLMEnd({
          llmOutput: {
            tokenUsage: { prompt_tokens: 11, completion_tokens: 7 },
          },
          generations: [],
        });
      },
    );

    expect(received).toEqual([{ inputTokens: 11, outputTokens: 7 }]);
  });
});
