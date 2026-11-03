import { createChatEventRelay } from './chat-event-relay';
import type { SseEvent } from '../../rag/agentic/sse-event';

describe('createChatEventRelay', () => {
  it('replaces a streamed draft when the final answer differs', () => {
    const events: SseEvent[] = [];
    const relay = createChatEventRelay((event) => events.push(event));

    relay.publish({ type: 'token', data: '草稿' });
    relay.publish({ type: 'citation', data: [] });
    relay.finish('审核后的答案');

    expect(events).toEqual([
      { type: 'token', data: '草稿' },
      { type: 'citation', data: [] },
      { type: 'answer_replace', data: '审核后的答案' },
    ]);
  });

  it('emits the final answer when no token was streamed', () => {
    const events: SseEvent[] = [];
    const relay = createChatEventRelay((event) => events.push(event));

    relay.publish({ type: 'token', data: null });
    relay.finish('最终答案');

    expect(events).toEqual([{ type: 'token', data: '最终答案' }]);
  });
});
