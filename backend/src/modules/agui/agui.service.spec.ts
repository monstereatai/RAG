import { firstValueFrom, toArray } from 'rxjs';
import type { SseCallback } from '../../rag/agentic/sse-event';
import { AguiService } from './agui.service';

jest.mock('../../rag/agentic/agentic-rag.service', () => ({
  AgenticRagService: class AgenticRagService {},
}));

describe('AguiService', () => {
  it('maps Agentic RAG stream events to AG-UI lifecycle events', async () => {
    let addMessageCount = 0;
    let receivedMemoryMessages: Array<{ role: string; content: string }> = [];
    let receivedScope: unknown;
    const agenticRagService = {
      run: (
        _query: string,
        _mode: string,
        onEvent: SseCallback,
        _history: unknown,
        _threadId: string,
        _userId: string,
        memoryMessages: Array<{ role: string; content: string }>,
        _enableInterrupt: boolean,
        retrieveOptions: { scope?: unknown },
      ) => {
        receivedMemoryMessages = memoryMessages;
        receivedScope = retrieveOptions.scope;
        onEvent({
          type: 'routing',
          data: { mode: 'agentic', route: 'simple' },
        });
        onEvent({ type: 'token', data: 'hello' });
        onEvent({ type: 'citation', data: [] });
        return Promise.resolve({
          answer: 'hello',
          references: [],
          route: 'simple' as const,
          confidence: 1,
          retryCount: 0,
        });
      },
    };
    const conversationService = {
      create: () => Promise.resolve('thread-1'),
      getRecentHistory: () => Promise.resolve([]),
      addMessage: () => {
        addMessageCount += 1;
        return Promise.resolve(undefined);
      },
    };
    const memoryService = {
      searchMemory: () => Promise.resolve({}),
      classifyAndPersist: () => undefined,
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
      agenticRagService as never,
      conversationService as never,
      memoryService as never,
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
      'STATE_DELTA',
      'TEXT_MESSAGE_CONTENT',
      'CUSTOM',
      'TEXT_MESSAGE_END',
      'RUN_FINISHED',
    ]);
    expect(typeof events[3].data?.messageId).toBe('string');
    expect(events[3].data?.delta).toBe('hello');
    expect(addMessageCount).toBe(2);
    expect(receivedMemoryMessages[0]?.content).toContain(
      '当前服务对象岗位：测试工程师',
    );
    expect(receivedScope).toEqual({ role: 'qa-engineer' });
  });

  it('creates a downloadable artifact for an explicit Word request', async () => {
    let receivedMemoryMessages: Array<{ role: string; content: string }> = [];
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
      {
        run: (
          _query: string,
          _mode: string,
          _onEvent: SseCallback,
          _history: unknown,
          _threadId: string,
          _userId: string,
          memoryMessages: Array<{ role: string; content: string }>,
        ) => {
          receivedMemoryMessages = memoryMessages;
          return Promise.resolve({
            answer: '# 发布说明\n\n完整正文',
            references: [],
            route: 'simple' as const,
            confidence: 1,
            retryCount: 0,
          });
        },
      } as never,
      {
        create: () => Promise.resolve('thread-1'),
        getRecentHistory: () => Promise.resolve([]),
        addMessage: () => Promise.resolve(undefined),
      } as never,
      {
        searchMemory: () => Promise.resolve({}),
        classifyAndPersist: () => undefined,
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

    expect(receivedMemoryMessages[1]?.content).toContain('不得声称无法创建');
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
