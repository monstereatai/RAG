import { ChatOpenAI } from '@langchain/openai';
import { ConfigService } from '@nestjs/config';
import { MetricsService } from '../../modules/metrics/metrics.service';
import { LlmInvocationError } from './llm-invocation.error';
import { QwenLlmProvider } from './qwen-llm.provider';

jest.mock('@langchain/openai', () => ({
  ChatOpenAI: jest.fn().mockImplementation(() => ({
    invoke: jest.fn(),
  })),
}));

describe('QwenLlmProvider', () => {
  const values: Record<string, unknown> = {
    'llm.qwen.apiKey': 'test-key',
    'llm.qwen.baseUrl': 'https://example.test/v1',
    'llm.qwen.model': 'qwen-plus',
    'llm.qwen.timeoutMs': 60_000,
    'llm.qwen.maxTokens': 4_096,
    'llm.qwen.maxRetries': 2,
    'llm.qwen.temperature': 0.2,
  };

  function createProvider() {
    const config = {
      get: jest.fn((key: string) => values[key]),
    } as unknown as ConfigService;
    return new QwenLlmProvider(
      config,
      { observeLlmCall: jest.fn() } as unknown as MetricsService,
    );
  }

  it('forwards the stability policy to ChatOpenAI', () => {
    createProvider();

    expect(ChatOpenAI).toHaveBeenCalledWith({
      temperature: 0.2,
      model: 'qwen-plus',
      apiKey: 'test-key',
      timeout: 60_000,
      maxTokens: 4_096,
      maxRetries: 2,
      configuration: { baseURL: 'https://example.test/v1' },
    });
  });

  it('throws a controlled error instead of returning the request prompt on failure', async () => {
    const provider = createProvider();
    const model = jest.mocked(ChatOpenAI).mock.results.at(-1)?.value as {
      invoke: jest.Mock;
    };
    model.invoke.mockRejectedValue(new Error('upstream unavailable'));

    await expect(provider.invoke('内部提示词不得泄露')).rejects.toEqual(
      expect.objectContaining({
        name: 'LlmInvocationError',
        provider: 'qwen',
      } satisfies Partial<LlmInvocationError>),
    );
  });
});
