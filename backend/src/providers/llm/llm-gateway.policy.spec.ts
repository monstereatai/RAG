import { LlmGatewayPolicy } from './llm-gateway.policy';

describe('LlmGatewayPolicy', () => {
  it('routes structured work with a configured fallback and budgets', () => {
    const config = {
      get: jest.fn((key: string) => {
        const values: Record<string, unknown> = {
          'llm.provider': 'qwen',
          'llm.gateway.fallbackEnabled': true,
          'llm.gateway.fallbackProvider': 'deepseek',
          LLM_REASONING_TIMEOUT_MS: 45000,
          LLM_REASONING_MAX_TOKENS: 3000,
          LLM_REASONING_MAX_COST_USD: 0.03,
        };
        return values[key];
      }),
    };

    expect(new LlmGatewayPolicy(config as never).resolve('structured')).toEqual(
      {
        task: 'structured',
        primary: 'qwen',
        fallback: 'deepseek',
        timeoutMs: 45000,
        maxTokens: 3000,
        maxCostUsd: 0.03,
      },
    );
  });

  it('disables fallback explicitly', () => {
    const config = {
      get: jest.fn((key: string) =>
        key === 'llm.gateway.fallbackEnabled' ? false : 'qwen',
      ),
    };
    expect(
      new LlmGatewayPolicy(config as never).resolve('fast').fallback,
    ).toBeNull();
  });
});
