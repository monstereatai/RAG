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
    let invokedInput: string | undefined;
    let onUsageCallback: ((value: typeof usage) => void) | undefined;
    qwen.invoke.mockImplementation(
      (_input: string, options?: { onUsage?: typeof onUsageCallback }) => {
        invokedInput = _input;
        onUsageCallback = options?.onUsage;
        return Promise.resolve('qwen answer');
      },
    );
    await service.runWithUsage(
      (received) => expect(received).toEqual(usage),
      () => service.invoke('带 usage 的问题'),
    );

    expect(invokedInput).toBe('带 usage 的问题');
    expect(typeof onUsageCallback).toBe('function');
    if (!onUsageCallback) throw new Error('Expected usage callback');
    onUsageCallback(usage);
  });

  it('counts direct vision and embedding calls in the shared request budget', async () => {
    config.get.mockImplementation((key: string) => {
      if (key === 'llm.provider') return 'qwen';
      if (key === 'llm.requestBudget.maxCalls') return 1;
      return undefined;
    });
    const callbackSignals: AbortSignal[] = [];
    const callback = jest.fn((signal: AbortSignal) => {
      callbackSignals.push(signal);
      return Promise.resolve(signal.aborted);
    });

    await service.runWithRequestBudget(async () => {
      await expect(
        service.runWithExternalModelBudget('image prompt', 1024, callback),
      ).resolves.toBe(false);
      await expect(
        service.runWithExternalModelBudget('embedding text', 0, callback),
      ).rejects.toThrow('模型调用次数达到上限');
    });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callbackSignals[0]).toBeInstanceOf(AbortSignal);
  });

  it('propagates the request AbortSignal through direct model and structured Runnable calls', async () => {
    config.get.mockImplementation((key: string) => {
      if (key === 'llm.provider') return 'qwen';
      if (key === 'llm.gateway.fallbackEnabled') return false;
      return undefined;
    });
    const controller = new AbortController();
    const signal = controller.signal;
    let structuredSignal: AbortSignal | undefined;
    const structuredInvoke = jest.fn(
      (_input: string, options?: { signal?: AbortSignal }) => {
        structuredSignal = options?.signal;
        return Promise.resolve({ ok: true });
      },
    );
    const structured = { invoke: structuredInvoke };
    let directSignal: AbortSignal | undefined;
    const modelInvoke = jest.fn(
      (_input: string, options?: { signal?: AbortSignal }) => {
        directSignal = options?.signal;
        return Promise.resolve('answer');
      },
    );
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

    if (!directSignal || !structuredSignal) {
      throw new Error('Expected request signals to reach both model calls.');
    }
    expect(directSignal).toBeInstanceOf(AbortSignal);
    expect(structuredSignal).toBeInstanceOf(AbortSignal);
    expect(directSignal.aborted).toBe(false);
    expect(structuredSignal.aborted).toBe(false);

    controller.abort();
    expect(directSignal.aborted).toBe(true);
    expect(structuredSignal.aborted).toBe(true);
  });

  it('falls back to the configured secondary provider when primary fails', async () => {
    qwen.invoke.mockRejectedValueOnce(new Error('qwen upstream failure'));

    await expect(service.invoke('fallback 问题')).resolves.toBe(
      'deepseek answer',
    );
    expect(qwen.invoke).toHaveBeenCalledTimes(1);
    expect(deepseek.invoke).toHaveBeenCalledTimes(1);
  });

  it('opens the primary circuit after repeated failures and skips it', async () => {
    qwen.invoke.mockRejectedValue(new Error('qwen upstream failure'));

    await expect(service.invoke('失败一')).resolves.toBe('deepseek answer');
    await expect(service.invoke('失败二')).resolves.toBe('deepseek answer');
    qwen.invoke.mockClear();
    deepseek.invoke.mockClear();

    await expect(service.invoke('熔断后')).resolves.toBe('deepseek answer');
    expect(qwen.invoke).not.toHaveBeenCalled();
    expect(deepseek.invoke).toHaveBeenCalledTimes(1);
  });
});
