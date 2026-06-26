import { firstValueFrom, toArray } from 'rxjs';
import type { SseCallback } from '../../rag/agentic/sse-event';
import { AguiService } from './agui.service';

jest.mock('../../rag/agentic/agentic-rag.service', () => ({
  AgenticRagService: class AgenticRagService {},
}));

describe('AguiService', () => {
  it('maps Agentic RAG stream events to AG-UI lifecycle events', async () => {
    let addMessageCount = 0;
    const agenticRagService = {
      run: (_query: string, _mode: string, onEvent: SseCallback) => {
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
    const service = new AguiService(
      agenticRagService as never,
      conversationService as never,
      memoryService as never,
      llmProvider as never,
    );

    const events = await firstValueFrom(
      service
        .stream({ query: 'hello', mode: 'agentic', userId: 'user-1' })
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
  });
});
