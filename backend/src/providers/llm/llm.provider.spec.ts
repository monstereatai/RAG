import { LlmProvider } from './llm.provider';

describe('LlmProvider request model selection', () => {
  const qwen = {
    invoke: jest.fn(),
    getModel: jest.fn(),
  };
  const deepseek = {
    invoke: jest.fn(),
    getModel: jest.fn(),
  };
  const zhipu = {
    invoke: jest.fn(),
    getModel: jest.fn(),
  };

  const config = {
    get: jest.fn((key: string) =>
      key === 'llm.provider' ? 'qwen' : undefined,
    ),
  };
  const service = new LlmProvider(
    config as never,
    qwen as never,
    deepseek as never,
    zhipu as never,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    config.get.mockImplementation((key: string) =>
      key === 'llm.provider' ? 'qwen' : undefined,
    );
    qwen.invoke.mockResolvedValue('qwen answer');
    deepseek.invoke.mockResolvedValue('deepseek answer');
    zhipu.invoke.mockResolvedValue('zhipu answer');
    service.onModuleInit();
  });

  it('routes one request to Zhipu without changing the next request default', async () => {
    await expect(
      service.runWithModel('zhipu', () => service.invoke('测试问题')),
    ).resolves.toBe('zhipu answer');
    await expect(service.invoke('默认问题')).resolves.toBe('qwen answer');

    expect(zhipu.invoke).toHaveBeenCalledWith('测试问题');
    expect(qwen.invoke).toHaveBeenCalledWith('默认问题');
    expect(deepseek.invoke).not.toHaveBeenCalled();
  });

  it('exposes the requested model only inside the request scope', async () => {
    expect(service.getActiveProviderName()).toBe('qwen');

    await service.runWithModel('deepseek', async () => {
      await Promise.resolve();
      expect(service.getActiveProviderName()).toBe('deepseek');
    });

    expect(service.getActiveProviderName()).toBe('qwen');
  });
});
