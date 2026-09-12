import { firstValueFrom, toArray } from 'rxjs';
import { AguiService } from './agui.service';

jest.mock('../../rag/agentic/agentic-rag.service', () => ({
  AgenticRagService: class AgenticRagService {},
}));

describe('AguiService', () => {
  it('maps the unified Chat result to AG-UI lifecycle events', async () => {
    let addMessageCount = 0;
    const conversationService = {
      create: () => Promise.resolve('thread-1'),
      getRecentHistory: () => Promise.resolve([]),
      addMessage: () => {
        addMessageCount += 1;
        return Promise.resolve(undefined);
      },
    };
    const llmProvider = {
      runWithModel: (
        _model: string | undefined,
        callback: () => Promise<unknown>,
      ) => callback(),
    };
    const langfuseProvider = {
      estimateTextTokens: () => 1,
      estimateCostUsd: () => 0,
      traceRagAnswer: () => undefined,
    };
    const artifactsService = {
      create: () => Promise.reject(new Error('should not be called')),
    };
    const service = new AguiService(
      { chat: () => Promise.resolve({ answer: 'hello', references: [], route: 'simple', confidence: 1, retryCount: 0, retrievalSufficient: true }) } as never,
      conversationService as never,
      llmProvider as never,
      langfuseProvider as never,
      artifactsService as never,
    );

    const events = await firstValueFrom(
      service
        .stream({
          query: 'hello',
          mode: 'agentic',
          userId: 'user-1',
          rolePresetId: 'qa-engineer',
        })
        .pipe(toArray()),
    );

    expect(events.map((event) => event.type)).toEqual([
      'RUN_STARTED',
      'TEXT_MESSAGE_START',
      'TEXT_MESSAGE_CONTENT',
      'TEXT_MESSAGE_END',
      'RUN_FINISHED',
    ]);
    const content = events.find((event) => event.type === 'TEXT_MESSAGE_CONTENT');
    expect(typeof content?.data?.messageId).toBe('string');
    expect(content?.data?.delta).toBe('hello');
    expect(addMessageCount).toBe(0);
  });

  it('creates a downloadable artifact for an explicit Word request', async () => {
    const artifactsService = {
      create: jest.fn().mockResolvedValue({
        id: 'artifact-1',
        title: '发布说明',
        kind: 'word',
        status: 'queued',
        filename: '发布说明.docx',
      }),
    };
    const service = new AguiService(
      { chat: () => Promise.resolve({ answer: '# 发布说明\n\n完整正文', references: [], route: 'simple', confidence: 1, retryCount: 0, retrievalSufficient: true }) } as never,
      {
        create: () => Promise.resolve('thread-1'),
        getRecentHistory: () => Promise.resolve([]),
        addMessage: () => Promise.resolve(undefined),
      } as never,
      {
        runWithModel: (
          _model: string | undefined,
          callback: () => Promise<unknown>,
        ) => callback(),
      } as never,
      {
        estimateTextTokens: () => 1,
        estimateCostUsd: () => 0,
        traceRagAnswer: () => undefined,
      } as never,
      artifactsService as never,
    );

    const events = await firstValueFrom(
      service
        .stream({
          query: '请生成 Word 文件：发布说明',
          mode: 'agentic',
          userId: 'user-1',
        })
        .pipe(toArray()),
    );
    const finished = events.find((event) => event.type === 'RUN_FINISHED');
    const output = finished?.data?.output as
      | { artifacts?: Array<{ id: string }> }
      | undefined;

    expect(artifactsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: 'user-1',
        kind: 'word',
        sourceText: '# 发布说明\n\n完整正文',
      }),
    );
    expect(output?.artifacts?.[0]?.id).toBe('artifact-1');
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'TOOL_CALL_START',
        'TOOL_CALL_ARGS',
        'TOOL_CALL_END',
      ]),
    );
  });
});
