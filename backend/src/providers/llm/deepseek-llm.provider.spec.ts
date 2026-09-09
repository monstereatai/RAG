import { ChatOpenAI } from '@langchain/openai';
import { ConfigService } from '@nestjs/config';
import { MetricsService } from '../../modules/metrics/metrics.service';
import { DeepseekLlmProvider } from './deepseek-llm.provider';

jest.mock('@langchain/openai', () => ({
  ChatOpenAI: jest.fn().mockImplementation(() => ({ invoke: jest.fn() })),
}));

describe('DeepseekLlmProvider', () => {
  it('throws a controlled error instead of returning a mock response', async () => {
    const values: Record<string, unknown> = {
      'llm.deepseek.apiKey': 'test-key',
      'llm.deepseek.baseUrl': 'https://example.test/v1',
      'llm.deepseek.model': 'deepseek-chat',
      'llm.deepseek.timeoutMs': 30_000,
    };
    const provider = new DeepseekLlmProvider(
      { get: jest.fn((key: string) => values[key]) } as unknown as ConfigService,
      { observeLlmCall: jest.fn() } as unknown as MetricsService,
    );
    const model = jest.mocked(ChatOpenAI).mock.results.at(-1)?.value as {
      invoke: jest.Mock;
    };
    model.invoke.mockRejectedValue(new Error('upstream unavailable'));

    await expect(provider.invoke('内部提示词不得泄露')).rejects.toMatchObject({
      name: 'LlmInvocationError',
      provider: 'deepseek',
    });
  });
});
