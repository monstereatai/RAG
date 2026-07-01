import {
  DeleteOutlined,
  EllipsisOutlined,
  FileWordOutlined,
  MenuOutlined,
  PaperClipOutlined,
  PlusOutlined,
  SendOutlined,
  SoundOutlined,
} from '@ant-design/icons';
import { XMarkdown } from '@ant-design/x-markdown';
import '@ant-design/x-markdown/es/XMarkdown/index.css';
import { ModulePage, qaNav } from '@/components/AdminShell';
import { Avatar, Button, Dropdown, Input } from 'antd';
import React from 'react';
import {
  type AguiEvent,
  type ChatMode,
  type ChatModel,
  type ConversationSummary,
  type ReferenceChunk,
  createTtsWebSocket,
  deleteConversation,
  getEnabledQaModelOptions,
  getQaModelConfig,
  getConversation,
  getConversations,
  streamAguiAnswer,
} from './service';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  status?: 'streaming' | 'done' | 'error';
  route?: string;
  confidence?: number;
  retryCount?: number;
  model?: ChatModel;
  retrievalSufficient?: boolean;
  retrievalReason?: string;
  references?: ReferenceChunk[];
  media?: AnswerMedia[];
  events?: EventTraceItem[];
}

interface AnswerMedia {
  id: string;
  type: 'image';
  url: string;
  alt?: string;
  title?: string;
}

interface EventTraceItem {
  type: string;
  count: number;
}

type TtsStatus = 'connecting' | 'synthesizing' | 'playing' | 'error';

const normalizeAssistantMarkdown = (content: string, status?: ChatMessage['status']) => {
  const normalized = content
    .replace(/\r\n/g, '\n')
    .replace(/```([A-Za-z0-9_-]+)\s+(?=\S)/g, '```$1\n');
  const fenceCount = normalized.match(/```/g)?.length ?? 0;
  if (status === 'done' && fenceCount % 2 === 1) {
    return `${normalized}\n\`\`\``;
  }
  return normalized;
};

const toAnswerMedia = (value: unknown): AnswerMedia[] => {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return items
    .map((item, index): AnswerMedia | null => {
      if (typeof item === 'string') {
        return {
          id: `image-${index}-${item}`,
          type: 'image',
          url: item,
        };
      }
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const url =
        typeof record.url === 'string'
          ? record.url
          : typeof record.src === 'string'
            ? record.src
            : '';
      if (!url) return null;
      const type = typeof record.type === 'string' ? record.type : 'image';
      const mimeType =
        typeof record.mimeType === 'string' ? record.mimeType : '';
      if (type !== 'image' && !mimeType.startsWith('image/')) return null;
      return {
        id:
          typeof record.id === 'string'
            ? record.id
            : `image-${index}-${url}`,
        type: 'image',
        url,
        alt: typeof record.alt === 'string' ? record.alt : undefined,
        title: typeof record.title === 'string' ? record.title : undefined,
      };
    })
    .filter((item): item is AnswerMedia => Boolean(item));
};

const mergeMedia = (
  current: AnswerMedia[] | undefined,
  next: AnswerMedia[],
) => {
  const merged = [...(current ?? [])];
  const seen = new Set(merged.map((item) => item.id || item.url));
  for (const item of next) {
    const key = item.id || item.url;
    if (!seen.has(key)) {
      merged.push(item);
      seen.add(key);
    }
  }
  return merged;
};

const appendEventTrace = (
  events: EventTraceItem[] | undefined,
  type: string,
) => {
  const next = [...(events ?? [])];
  const last = next[next.length - 1];
  if (last?.type === type) {
    next[next.length - 1] = { ...last, count: last.count + 1 };
    return next;
  }
  next.push({ type, count: 1 });
  return next;
};

const formatEventTrace = (events: EventTraceItem[]) =>
  events
    .map((event) =>
      event.count > 1 ? `${event.type} × ${event.count}` : event.type,
    )
    .join(' → ');

const QaOps: React.FC = () => {
  const [input, setInput] = React.useState('');
  const [mode, setMode] = React.useState<ChatMode>('agentic');
  const modelConfig = React.useMemo(() => getQaModelConfig(), []);
  const modelOptions = React.useMemo(
    () => getEnabledQaModelOptions(modelConfig),
    [modelConfig],
  );
  const [model, setModel] = React.useState<ChatModel>(
    modelConfig.defaultModel,
  );
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [activeTitle, setActiveTitle] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [threadId, setThreadId] = React.useState<string | undefined>(undefined);
  const threadIdRef = React.useRef<string | undefined>(undefined);
  const [conversations, setConversations] = React.useState<ConversationSummary[]>([]);
  const [sidebarLoading, setSidebarLoading] = React.useState(false);
  const [convPage, setConvPage] = React.useState(1);
  const PAGE_SIZE = 10;
  const abortRef = React.useRef<AbortController | null>(null);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const ttsRef = React.useRef<WebSocket | null>(null);
  const [ttsStatusByMessageId, setTtsStatusByMessageId] = React.useState<
    Record<string, TtsStatus>
  >({});
  const chatBodyRef = React.useRef<HTMLDivElement>(null);

  // 自动滚动到底部
  React.useEffect(() => {
    if (chatBodyRef.current) {
      chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
    }
  }, [messages]);

  // 同步 threadId 到 ref，避免闭包过期
  React.useEffect(() => {
    threadIdRef.current = threadId;
  }, [threadId]);

  // 加载会话列表
  const loadConversations = React.useCallback(async () => {
    setSidebarLoading(true);
    try {
      const res = await getConversations();
      setConversations(res.data ?? []);
      setConvPage(1);
    } catch {
      // 静默失败，保留上次列表
    } finally {
      setSidebarLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  React.useEffect(() => {
    return () => {
      abortRef.current?.abort();
      ttsRef.current?.close();
      if (audioRef.current) {
        URL.revokeObjectURL(audioRef.current.src);
      }
    };
  }, []);

  const updateMessage = (
    messageId: string,
    updater: (message: ChatMessage) => ChatMessage,
  ) => {
    setMessages((prev) =>
      prev.map((message) => (message.id === messageId ? updater(message) : message)),
    );
  };

  const handleNewConversation = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    ttsRef.current?.close();
    setTtsStatusByMessageId({});
    setMessages([]);
    setThreadId(undefined);
    setActiveTitle('');
  };

  const handleClearConversation = async () => {
    abortRef.current?.abort();
    abortRef.current = null;
    ttsRef.current?.close();
    setTtsStatusByMessageId({});
    if (threadId) {
      try {
        await deleteConversation(threadId);
        await loadConversations();
      } catch {
        // 静默失败
      }
    }
    setMessages([]);
    setThreadId(undefined);
    setActiveTitle('');
  };

  const handleSelectConversation = async (item: ConversationSummary) => {
    abortRef.current?.abort();
    abortRef.current = null;
    ttsRef.current?.close();
    setTtsStatusByMessageId({});
    setLoading(true);
    try {
      const res = await getConversation(item.threadId);
      const detail = res.data;
      if (!detail) return;

      setThreadId(detail.threadId);
      setActiveTitle(detail.title);

      // 将后端的消息列表转为前端 ChatMessage 格式
      const chatMessages: ChatMessage[] = detail.messages.map((m, i) => ({
        id: `${m.role}-${i}`,
        role: m.role === 'human' ? 'user' : 'assistant',
        content: m.content,
        createdAt: m.createdAt
          ? new Date(m.createdAt).toLocaleTimeString('zh-CN', {
              hour: '2-digit',
              minute: '2-digit',
            })
          : '',
        status: 'done' as const,
      }));
      setMessages(chatMessages);
    } catch {
      // 加载失败
    } finally {
      setLoading(false);
    }
  };

  const setTtsStatus = (messageId: string, status?: TtsStatus) => {
    setTtsStatusByMessageId((prev) => {
      const next = { ...prev };
      if (status) {
        next[messageId] = status;
      } else {
        delete next[messageId];
      }
      return next;
    });
  };

  const getTtsButtonText = (status?: TtsStatus) => {
    if (status === 'connecting') return '连接中';
    if (status === 'synthesizing') return '合成中';
    if (status === 'playing') return '播放中';
    if (status === 'error') return '重试';
    return '播放';
  };

  const handlePlayTts = (messageId: string, text: string) => {
    const content = text.trim();
    if (!content) return;

    ttsRef.current?.close();
    setTtsStatusByMessageId({});
    setTtsStatus(messageId, 'connecting');
    const chunks: BlobPart[] = [];
    const ws = createTtsWebSocket(content.slice(0, 800));
    ttsRef.current = ws;
    ws.onopen = () => {
      setTtsStatus(messageId, 'synthesizing');
    };
    ws.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'audio' && typeof payload.data === 'string') {
          const binary = atob(payload.data);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i += 1) {
            bytes[i] = binary.charCodeAt(i);
          }
          chunks.push(bytes);
        }
        if (payload.type === 'end') {
          if (chunks.length === 0) {
            setTtsStatus(messageId, 'error');
            return;
          }
          const blob = new Blob(chunks, { type: 'audio/wav' });
          if (audioRef.current) URL.revokeObjectURL(audioRef.current.src);
          const audio = new Audio(URL.createObjectURL(blob));
          audioRef.current = audio;
          audio.onplay = () => setTtsStatus(messageId, 'playing');
          audio.onended = () => setTtsStatus(messageId);
          audio.onerror = () => setTtsStatus(messageId, 'error');
          void audio.play().catch(() => setTtsStatus(messageId, 'error'));
        }
      } catch {
        // Ignore non-json websocket frames.
      }
    };
    ws.onerror = () => {
      setTtsStatus(messageId, 'error');
    };
    ws.onclose = () => {
      if (ttsRef.current === ws) {
        ttsRef.current = null;
      }
    };
  };

  const handleSend = () => {
    const query = input.trim();
    if (!query || loading) return;

    abortRef.current?.abort();
    abortRef.current = null;
    setInput('');
    if (!activeTitle) {
      setActiveTitle(query);
    }
    setLoading(true);

    const now = new Date().toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    });
    const assistantId = `assistant-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      {
        id: `user-${Date.now()}`,
        role: 'user',
        content: query,
        createdAt: now,
      },
      {
        id: assistantId,
        role: 'assistant',
        content: '',
        createdAt: now,
        status: 'streaming',
        events: [],
      },
    ]);

    streamAguiAnswer(
      query,
      mode,
      model,
      (event) => applyAguiEvent(event, assistantId),
      (error) => {
        updateMessage(assistantId, (message) => ({
          ...message,
          content: message.content || `错误：${error.message}`,
          status: 'error',
        }));
        setLoading(false);
      },
      () => {
        setLoading(false);
        // 流结束后刷新会话列表（使用 ref 获取最新 threadId）
        void loadConversations();
      },
      threadId,
    ).then((controller) => {
      abortRef.current = controller;
    });
  };

  const applyAguiEvent = (event: AguiEvent, messageId: string) => {
    updateMessage(messageId, (message) => ({
      ...message,
      events: appendEventTrace(message.events, event.type),
    }));

    if (event.type === 'RUN_STARTED') {
      // 保存后端返回的 threadId
      const eventThreadId =
        typeof event.data?.threadId === 'string' ? event.data.threadId : undefined;
      if (eventThreadId) {
        setThreadId(eventThreadId);
      }

      const inputData = event.data?.input;
      if (isRecord(inputData) && typeof inputData.mode === 'string') {
        const route = inputData.mode;
        updateMessage(messageId, (message) => ({
          ...message,
          route,
        }));
      }
      const inputModel = isRecord(inputData) ? inputData.model : undefined;
      if (isChatModel(inputModel)) {
        updateMessage(messageId, (message) => ({
          ...message,
          model: inputModel,
        }));
      }
      return;
    }

    if (event.type === 'TEXT_MESSAGE_CONTENT') {
      const delta = typeof event.data?.delta === 'string' ? event.data.delta : '';
      updateMessage(messageId, (message) => ({
        ...message,
        content: message.content + delta,
      }));
      return;
    }

    if (event.type === 'STATE_DELTA') {
      applyStateDelta(event, messageId);
      return;
    }

    if (event.type === 'CUSTOM') {
      applyCustomEvent(event, messageId);
      return;
    }

    if (event.type === 'RUN_FINISHED') {
      const output = event.data?.output;
      if (isRecord(output)) {
        const outputAnswer =
          typeof output.answer === 'string' ? output.answer : undefined;
        updateMessage(messageId, (message) => ({
          ...message,
          content: outputAnswer ?? message.content,
          references: Array.isArray(output.references)
            ? (output.references as ReferenceChunk[])
            : message.references,
          media: mergeMedia(
            message.media,
            [
              ...toAnswerMedia(output.images),
              ...toAnswerMedia(output.media),
              ...toAnswerMedia(output.attachments),
            ],
          ),
          route: typeof output.route === 'string' ? output.route : message.route,
          confidence:
            typeof output.confidence === 'number'
              ? output.confidence
              : message.confidence,
          retryCount:
            typeof output.retryCount === 'number'
              ? output.retryCount
              : message.retryCount,
          model: isChatModel(output.model) ? output.model : message.model,
          retrievalSufficient:
            typeof output.retrievalSufficient === 'boolean'
              ? output.retrievalSufficient
              : message.retrievalSufficient,
          retrievalReason:
            typeof output.retrievalReason === 'string'
              ? output.retrievalReason
              : message.retrievalReason,
          status: 'done',
        }));
      }
      return;
    }

    if (event.type === 'RUN_ERROR') {
      updateMessage(messageId, (message) => ({
        ...message,
        content: `错误：${String(event.data?.message ?? '流式问答失败')}`,
        status: 'error',
      }));
    }
  };

  const applyStateDelta = (event: AguiEvent, messageId: string) => {
    const delta = event.data?.delta;
    if (!Array.isArray(delta)) return;

    for (const patch of delta) {
      if (!isRecord(patch)) continue;
      const value = patch.value;
      if (patch.path === '/routing' && isRecord(value)) {
        updateMessage(messageId, (message) => ({
          ...message,
          route: typeof value.route === 'string' ? value.route : message.route,
        }));
      }
      if (patch.path === '/sufficiency' && isRecord(value)) {
        updateMessage(messageId, (message) => ({
          ...message,
          retrievalSufficient:
            typeof value.sufficient === 'boolean'
              ? value.sufficient
              : message.retrievalSufficient,
          retrievalReason:
            typeof value.reason === 'string'
              ? value.reason
              : message.retrievalReason,
        }));
      }
    }
  };

  const applyCustomEvent = (event: AguiEvent, messageId: string) => {
    const name = event.data?.name;
    const value = event.data?.value;
    if (name === 'rag.citation') {
      updateMessage(messageId, (message) => ({
        ...message,
        references: Array.isArray(value)
          ? (value as ReferenceChunk[])
          : message.references,
      }));
    }
    if (name === 'rag.reflection' && isRecord(value)) {
      updateMessage(messageId, (message) => ({
        ...message,
        confidence:
          typeof value.confidence === 'number'
            ? value.confidence
            : message.confidence,
        retryCount:
          typeof value.retryCount === 'number'
            ? value.retryCount
            : message.retryCount,
      }));
    }
    if (name === 'rag.media' || name === 'rag.image' || name === 'rag.images') {
      const media = toAnswerMedia(value);
      if (media.length > 0) {
        updateMessage(messageId, (message) => ({
          ...message,
          media: mergeMedia(message.media, media),
        }));
      }
    }
  };

  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null;

  const isChatModel = (value: unknown): value is ChatModel =>
    value === 'qwen' || value === 'deepseek';

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString('zh-CN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  };

  return (
    <ModulePage activeKey="new" navItems={qaNav} title="AI问答">
      <div className="qa-workspace">
        <aside className="rag-panel qa-list">
          <div className="panel-head">
            <h3>会话列表</h3>
            <Dropdown
              menu={{
                items: [
                  {
                    key: 'sortNewest',
                    label: '按时间排序',
                  },
                  {
                    key: 'sortCount',
                    label: '按消息数排序',
                  },
                ],
                onClick: ({ key }) => {
                  const sorted = [...conversations];
                  if (key === 'sortNewest') {
                    sorted.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
                  } else if (key === 'sortCount') {
                    sorted.sort((a, b) => b.messageCount - a.messageCount);
                  }
                  setConversations(sorted);
                },
              }}
              placement="bottomRight"
            >
              <Button type="text" icon={<MenuOutlined />} />
            </Dropdown>
          </div>
          <Button
            block
            ghost
            icon={<PlusOutlined />}
            onClick={handleNewConversation}
            size="large"
            type="primary"
          >
            新建对话
          </Button>
          <div className="conversation-list">
            {sidebarLoading ? (
              <div className="empty-conversations">加载中...</div>
            ) : conversations.length === 0 ? (
              <div className="empty-conversations">暂无对话</div>
            ) : (
              conversations.slice(0, convPage * PAGE_SIZE).map((item) => (
                <button
                  className={`conv-item${item.threadId === threadId ? ' active' : ''}`}
                  key={item.threadId}
                  onClick={() => handleSelectConversation(item)}
                  type="button"
                  onKeyDown={(e) => e.key === 'Enter' && handleSelectConversation(item)}
                >
                  <strong>{item.title}</strong>
                  <span>{formatTime(item.updatedAt)}</span>
                  <p>{item.messageCount} 条消息</p>
                  <Dropdown
                    menu={{
                      items: [
                        {
                          key: 'delete',
                          label: '删除会话',
                          danger: true,
                          icon: <DeleteOutlined />,
                        },
                      ],
                      onClick: async ({ domEvent }) => {
                        domEvent.stopPropagation();
                        try {
                          await deleteConversation(item.threadId);
                          setConversations((prev) => prev.filter((c) => c.threadId !== item.threadId));
                          if (threadId === item.threadId) {
                            setMessages([]);
                            setThreadId(undefined);
                            setActiveTitle('');
                          }
                        } catch {
                          // 删除失败
                        }
                      },
                    }}
                    placement="bottomRight"
                    trigger={['click']}
                  >
                    <span
                      className="conv-more-btn"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <EllipsisOutlined />
                    </span>
                  </Dropdown>
                </button>
              ))
            )}
            {conversations.length > convPage * PAGE_SIZE && (
              <Button
                block
                type="link"
                onClick={() => setConvPage((p) => p + 1)}
              >
                查看更多会话（{conversations.length - convPage * PAGE_SIZE}）⌄
              </Button>
            )}
          </div>
        </aside>
        <section className="rag-panel qa-chat">
          <div className="chat-head">
            <h2>{activeTitle || 'AI 智能问答'}</h2>
            <Button
              icon={<DeleteOutlined />}
              onClick={handleClearConversation}
            >
              清空对话
            </Button>
          </div>
          <div className="chat-body" ref={chatBodyRef}>
            {messages.map((message) =>
              message.role === 'user' ? (
                <div className="message user" key={message.id}>
                  <div>
                    <p>{message.content}</p>
                    <span>{message.createdAt}</span>
                  </div>
                  <Avatar style={{ background: '#f0f2f5', color: '#8c8c8c' }}>
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                      <title>用户</title>
                      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                    </svg>
                  </Avatar>
                </div>
              ) : (
                <div className="message assistant" key={message.id}>
                  <Avatar>AI</Avatar>
                  <div className="answer-card">
                    {message.content ? (
                      <>
                        <XMarkdown
                          className="answer-markdown"
                          content={normalizeAssistantMarkdown(
                            message.content,
                            message.status,
                          )}
                          escapeRawHtml
                          openLinksInNewTab
                          paragraphTag="div"
                        />
                        {message.status === 'streaming' && (
                          <span className="answer-typing-caret" />
                        )}
                      </>
                    ) : (
                      message.status === 'streaming' && (
                        <p className="answer-loading">
                          正在通过 AG-UI 协议生成回答...
                        </p>
                      )
                    )}
                    {message.status === 'done' && message.content && (
                      <Button
                        className="answer-voice-btn"
                        icon={<SoundOutlined />}
                        loading={
                          ttsStatusByMessageId[message.id] === 'connecting' ||
                          ttsStatusByMessageId[message.id] === 'synthesizing'
                        }
                        onClick={() => handlePlayTts(message.id, message.content)}
                        size="small"
                        type="text"
                      >
                        {getTtsButtonText(ttsStatusByMessageId[message.id])}
                      </Button>
                    )}
                    {message.media && message.media.length > 0 && (
                      <div className="answer-media-grid">
                        {message.media.map((item) => (
                          <figure key={item.id}>
                            <img
                              alt={item.alt ?? item.title ?? '回答图片'}
                              loading="lazy"
                              src={item.url}
                            />
                            {(item.title || item.alt) && (
                              <figcaption>{item.title ?? item.alt}</figcaption>
                            )}
                          </figure>
                        ))}
                      </div>
                    )}
                    {message.route && (
                      <div className="answer-meta">
                        <span>路由：{message.route}</span>
                        {message.retrievalSufficient !== undefined && (
                          <span>
                            检索：
                            {message.retrievalSufficient ? '充分' : '不足'}
                          </span>
                        )}
                        {message.confidence !== undefined && (
                          <span>置信度：{message.confidence.toFixed(2)}</span>
                        )}
                        {message.retryCount !== undefined && (
                          <span>重试：{message.retryCount}</span>
                        )}
                        {message.model && (
                          <span>
                            模型：
                            {message.model === 'qwen' ? '通义千问' : 'DeepSeek'}
                          </span>
                        )}
                      </div>
                    )}
                    {message.retrievalReason && (
                      <p className="retrieval-reason">
                        检索评估：{message.retrievalReason}
                      </p>
                    )}
                    {message.events && message.events.length > 0 && (
                      <p className="event-trace">
                        AG-UI：{formatEventTrace(message.events)}
                      </p>
                    )}
                    {message.references && message.references.length > 0 && (
                      <div className="reference-box">
                        <strong>引用文档（{message.references.length}）</strong>
                        <div>
                          {message.references.map((item) => (
                            <article key={item.id}>
                              <FileWordOutlined className="file-icon word" />
                              <div>
                                <b>{item.docId || item.id}</b>
                                <span>
                                  chunk #{item.chunkIndex} · score{' '}
                                  {(item.totalScore ?? 0).toFixed(2)}
                                </span>
                              </div>
                            </article>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ),
            )}
          </div>
          {messages.length === 0 && (
            <div className="suggestions">
              <strong>你可能还想问</strong>
              {[
                '差旅报销需要哪些票据?',
                '报销申请提交后多久能到账?',
                '差旅报销的审批流程是怎样的?',
                '特殊情况如何申请超标准报销?',
              ].map((item) => (
                <Button key={item} onClick={() => setInput(item)}>
                  {item}
                </Button>
              ))}
              <Button type="link">换一批</Button>
            </div>
          )}
          <div className="chat-input">
            <Input.TextArea
              autoSize={{ minRows: 2, maxRows: 3 }}
              maxLength={2000}
              onChange={(event) => setInput(event.target.value)}
              onPressEnter={(event) => {
                if (!event.shiftKey) {
                  event.preventDefault();
                  handleSend();
                }
              }}
              placeholder="请输入问题，Shift + Enter 换行"
              value={input}
            />
            <div>
              <select
                aria-label="问答模式"
                onChange={(event) => setMode(event.target.value as ChatMode)}
                value={mode}
              >
                <option value="agentic">agentic</option>
                <option value="auto">auto</option>
                <option value="simple">simple</option>
              </select>
              <select
                aria-label="模型"
                onChange={(event) => setModel(event.target.value as ChatModel)}
                value={model}
              >
                {modelOptions.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label}
                  </option>
                ))}
              </select>
              <span>{input.length} / 2000</span>
              <Button disabled={loading} icon={<PaperClipOutlined />} />
              <Button
                disabled={!input.trim() || loading}
                icon={<SendOutlined />}
                loading={loading}
                onClick={handleSend}
                type="primary"
              >
                发送
              </Button>
            </div>
          </div>
        </section>
      </div>
    </ModulePage>
  );
};

export default QaOps;
