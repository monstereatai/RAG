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

  it('forwards provider usage through the request scope', async () => {
    const usage = { inputTokens: 12, outputTokens: 4 };
    await service.runWithUsage(
      (received) => expect(received).toEqual(usage),
      () => service.invoke('带 usage 的问题'),
    );

    expect(qwen.invoke).toHaveBeenCalledWith(
      '带 usage 的问题',
      expect.objectContaining({ onUsage: expect.any(Function) }),
    );
    const options = qwen.invoke.mock.calls[0][1] as {
      onUsage: (value: typeof usage) => void;
    };
    options.onUsage(usage);
  });

  it('propagates the request AbortSignal through direct model and structured Runnable calls', async () => {
    const signal = new AbortController().signal;
    const structuredInvoke = jest.fn().mockResolvedValue({ ok: true });
    const structured = { invoke: structuredInvoke };
    const modelInvoke = jest.fn().mockResolvedValue('answer');
    const model = {
      invoke: modelInvoke,
      withStructuredOutput: jest.fn().mockReturnValue(structured),
    };
    qwen.getModel.mockReturnValue(model);

    const wrapped = service.getModel();
    await service.runWithSignal(signal, () => wrapped.invoke('问题'));
    await service.runWithSignal(signal, () =>
      wrapped.withStructuredOutput({}).invoke('结构化问题'),
    );

    expect(modelInvoke).toHaveBeenCalledWith('问题', { signal });
    expect(structuredInvoke).toHaveBeenCalledWith('结构化问题', { signal });
  });
});
