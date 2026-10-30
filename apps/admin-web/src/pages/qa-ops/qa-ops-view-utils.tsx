import React from 'react';
import { AssistantMarkdown } from '@/components/AssistantMarkdown';
import type { EventTraceItem } from './qa-ops-types';
import type { ReferenceChunk } from './service';

export function getStreamingStatusText(phase?: string): string {
  switch (phase) {
    case 'routing':
      return '正在分析问题...';
    case 'retrieval':
      return '正在检索知识库...';
    case 'evidence':
      return '正在校验证据...';
    case 'generation':
      return '正在生成答案...';
    case 'citation':
      return '正在校验引用...';
    default:
      return '正在检索知识库并校验引用，最终答案确认后显示...';
  }
}

export type TypewriterAnswerProps = {
  content: string;
  animate: boolean;
  status?: 'streaming' | 'done';
};

export function TypewriterAnswer({
  content,
  animate,
  status,
}: TypewriterAnswerProps) {
  const [visibleContent, setVisibleContent] = React.useState(
    animate ? '' : content,
  );
  const [typing, setTyping] = React.useState(false);
  const visibleRef = React.useRef(visibleContent);
  const contentRef = React.useRef(content);

  React.useEffect(() => {
    contentRef.current = content;
    if (animate === false) {
      visibleRef.current = content;
      setVisibleContent(content);
      setTyping(false);
      return;
    }
    if (content.length === 0) {
      visibleRef.current = '';
      setVisibleContent('');
      setTyping(false);
      return;
    }
    if (content.length <= visibleRef.current.length) {
      if (content === visibleRef.current) {
        setTyping(false);
        return;
      }
      visibleRef.current = content;
      setVisibleContent(content);
      setTyping(false);
      return;
    }

    setTyping(true);
    let cursor = visibleRef.current.length;
    const charsPerTick = Math.max(1, Math.ceil(content.length / 220));
    const timer = window.setInterval(() => {
      const target = contentRef.current;
      if (cursor >= target.length) {
        window.clearInterval(timer);
        setTyping(false);
        return;
      }
      cursor = Math.min(target.length, cursor + charsPerTick);
      const next = target.slice(0, cursor);
      visibleRef.current = next;
      setVisibleContent(next);
    }, 16);

    return () => window.clearInterval(timer);
  }, [animate, content]);

  return (
    <>
      <AssistantMarkdown
        className="answer-markdown"
        content={visibleContent}
        status={typing ? 'streaming' : status}
      />
      {typing && <span className="answer-typing-caret" />}
    </>
  );
}

export const formatEventTrace = (events: EventTraceItem[]) =>
  events
    .map((event) =>
      event.count > 1 ? `${event.type} × ${event.count}` : event.type,
    )
    .join(' → ');

export const isExternalReference = (item: ReferenceChunk) =>
  item.retrievalSource === 'web' || item.id.startsWith('web:');

export const isConversationAttachmentReference = (item: ReferenceChunk) =>
  item.retrievalSource === 'attachment';

export const referenceLabel = (item: ReferenceChunk) => {
  if (!/^https?:\/\//i.test(item.docId)) return item.docId || item.id;
  try {
    return new URL(item.docId).hostname.replace(/^www\./, '');
  } catch {
    return item.docId || item.id;
  }
};

export const routeLabel: Record<string, string> = {
  simple: '快速路径',
  agentic: '深度路径',
};

export const insufficientEvidenceMessage = (route?: string) =>
  route === 'agentic'
    ? '已完成深度分析，但当前资料仍不足以支持可靠结论。'
    : '当前资料未覆盖这个问题，暂时无法给出可靠结论。';
