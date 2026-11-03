import type { ChatEventCallback } from './chat-runtime.types';

/** 透传实时事件，并在最终答案变化时替换已展示的草稿。 */
export function createChatEventRelay(onEvent?: ChatEventCallback) {
  const streamedTokenParts: string[] = [];
  const publish: ChatEventCallback = (event) => {
    if (event.type !== 'token') {
      onEvent?.(event);
      return;
    }
    const token =
      typeof event.data === 'string'
        ? event.data
        : event.data == null
          ? ''
          : (JSON.stringify(event.data) ?? '');
    if (!token) return;
    streamedTokenParts.push(token);
    onEvent?.({ type: 'token', data: token });
  };
  const finish = (finalAnswer?: string) => {
    const streamedAnswer = streamedTokenParts.join('');
    streamedTokenParts.length = 0;
    if (finalAnswer === undefined) return;
    if (!streamedAnswer) {
      onEvent?.({ type: 'token', data: finalAnswer });
    } else if (streamedAnswer !== finalAnswer) {
      onEvent?.({ type: 'answer_replace', data: finalAnswer });
    }
  };
  return { publish, finish };
}
