import { OpenAiVisionProvider } from './openai-vision.provider';

describe('OpenAiVisionProvider budget integration', () => {
  const config = {
    get: jest.fn((key: string) => {
      const values: Record<string, string> = {
        'vision.apiKey': 'vision-test-key',
        'vision.baseUrl': 'https://vision.example.test/v1',
        'vision.model': 'vision-test-model',
      };
      return values[key];
    }),
  };
  const budgetInputs: Array<{ input: unknown; outputTokens: number }> = [];
  const llmProvider = {
    runWithExternalModelBudget: jest.fn(
      async (
        input: unknown,
        outputTokens: number,
        callback: (signal: AbortSignal) => Promise<unknown>,
      ) => {
        budgetInputs.push({ input, outputTokens });
        return callback(new AbortController().signal);
      },
    ),
  };
  const metricsService = { observeLlmCall: jest.fn() };
  let requestUrl: RequestInfo | URL | undefined;
  let requestSignal: AbortSignal | null | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    budgetInputs.length = 0;
    requestUrl = undefined;
    requestSignal = undefined;
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = input;
      requestSignal = init?.signal;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'recognized text' } }],
          }),
          { status: 200 },
        ),
      );
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reserves image input and output tokens before calling the vision API', async () => {
    const provider = new OpenAiVisionProvider(
      config as never,
      llmProvider as never,
      metricsService as never,
    );

    await expect(
      provider.ocr(Buffer.from('image bytes'), 'image/png'),
    ).resolves.toEqual({ text: 'recognized text', confidence: 0.9 });

    expect(budgetInputs[0]?.outputTokens).toBe(1024);
    const budgetInput = budgetInputs[0]?.input;
    if (
      !budgetInput ||
      typeof budgetInput !== 'object' ||
      !('messages' in budgetInput) ||
      !Array.isArray(budgetInput.messages)
    ) {
      throw new Error('Expected multimodal messages in the budget request.');
    }
    const firstMessage: unknown = budgetInput.messages[0];
    if (
      !firstMessage ||
      typeof firstMessage !== 'object' ||
      !('content' in firstMessage) ||
      !Array.isArray(firstMessage.content)
    ) {
      throw new Error('Expected image content in the budget request.');
    }
    const includesImageUrl = firstMessage.content.some(
      (item: unknown) =>
        typeof item === 'object' &&
        item !== null &&
        'type' in item &&
        item.type === 'image_url',
    );
    expect(includesImageUrl).toBe(true);
    expect(requestUrl).toBe('https://vision.example.test/v1/chat/completions');
    expect(requestSignal).toBeInstanceOf(AbortSignal);
    expect(metricsService.observeLlmCall).toHaveBeenCalledWith(
      'openai-compatible',
      'vision-test-model',
      'success',
      expect.any(Number),
      0,
      0,
    );
  });
});
