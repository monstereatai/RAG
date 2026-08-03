import { ChatOpenAI } from '@langchain/openai';
import { ConfigService } from '@nestjs/config';
import { MetricsService } from '../../modules/metrics/metrics.service';
import { QwenLlmProvider } from './qwen-llm.provider';

jest.mock('@langchain/openai', () => ({
  ChatOpenAI: jest.fn().mockImplementation(() => ({
    invoke: jest.fn(),
  })),
}));

describe('QwenLlmProvider', () => {
  it('forwards the stability policy to ChatOpenAI', () => {
    const values: Record<string, unknown> = {
      'llm.qwen.apiKey': 'test-key',
      'llm.qwen.baseUrl': 'https://example.test/v1',
      'llm.qwen.model': 'qwen-plus',
      'llm.qwen.timeoutMs': 60_000,
      'llm.qwen.maxTokens': 4_096,
      'llm.qwen.maxRetries': 2,
      'llm.qwen.temperature': 0.2,
    };
    const config = {
      get: jest.fn((key: string) => values[key]),
    } as unknown as ConfigService;

    new QwenLlmProvider(config, {} as MetricsService);

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
});
