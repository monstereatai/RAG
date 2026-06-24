import {
  DeleteOutlined,
  FileWordOutlined,
  PaperClipOutlined,
  PlusOutlined,
  SendOutlined,
} from '@ant-design/icons';
import { ModulePage, qaNav } from '@/components/AdminShell';
import { Avatar, Button, Input } from 'antd';
import React from 'react';
import {
  type AguiEvent,
  type ChatMode,
  type ReferenceChunk,
  streamAguiAnswer,
} from './service';

const conversations: { title: string; desc: string; time: string }[] = [];

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  status?: 'streaming' | 'done' | 'error';
  route?: string;
  confidence?: number;
  retryCount?: number;
  retrievalSufficient?: boolean;
  retrievalReason?: string;
  references?: ReferenceChunk[];
  events?: string[];
}

const initialMessages: ChatMessage[] = [];

const QaOps: React.FC = () => {
  const [input, setInput] = React.useState('');
  const [mode, setMode] = React.useState<ChatMode>('agentic');
  const [messages, setMessages] = React.useState<ChatMessage[]>(initialMessages);
  const [activeTitle, setActiveTitle] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const updateMessage = (
    messageId: string,
    updater: (message: ChatMessage) => ChatMessage,
  ) => {
    setMessages((prev) =>
      prev.map((message) => (message.id === messageId ? updater(message) : message)),
    );
  };

  const handleSend = () => {
    const query = input.trim();
    if (!query || loading) return;

    abortRef.current?.abort();
    abortRef.current = null;
    setInput('');
    setActiveTitle(query);
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
      (event) => applyAguiEvent(event, assistantId),
      (error) => {
        updateMessage(assistantId, (message) => ({
          ...message,
          content: message.content || `错误：${error.message}`,
          status: 'error',
        }));
        setLoading(false);
      },
      () => setLoading(false),
    ).then((controller) => {
      abortRef.current = controller;
    });
  };

  const applyAguiEvent = (event: AguiEvent, messageId: string) => {
    updateMessage(messageId, (message) => ({
      ...message,
      events: [...(message.events ?? []), event.type],
    }));

    if (event.type === 'RUN_STARTED') {
      const inputData = event.data?.input;
      if (isRecord(inputData) && typeof inputData.mode === 'string') {
        const route = inputData.mode;
        updateMessage(messageId, (message) => ({
          ...message,
          route,
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
        updateMessage(messageId, (message) => ({
          ...message,
          content:
            typeof output.answer === 'string' ? output.answer : message.content,
          references: Array.isArray(output.references)
            ? (output.references as ReferenceChunk[])
            : message.references,
          route: typeof output.route === 'string' ? output.route : message.route,
          confidence:
            typeof output.confidence === 'number'
              ? output.confidence
              : message.confidence,
          retryCount:
            typeof output.retryCount === 'number'
              ? output.retryCount
              : message.retryCount,
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
  };

  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null;

  return (
    <ModulePage activeKey="new" navItems={qaNav} title="AI问答">
      <div className="qa-workspace">
        <aside className="rag-panel qa-list">
          <div className="panel-head">
            <h3>会话列表</h3>
            <Button type="text">☰</Button>
          </div>
          <Button
            block
            ghost
            icon={<PlusOutlined />}
            onClick={() => {
              abortRef.current?.abort();
              abortRef.current = null;
              setMessages([]);
              setActiveTitle('新建对话');
            }}
            size="large"
            type="primary"
          >
            新建对话
          </Button>
          <div className="conversation-list">
            {conversations.length === 0 ? (
              <div className="empty-conversations">暂无对话</div>
            ) : (
              conversations.map((item, index) => (
                <button
                  className={index === 0 ? 'active' : ''}
                  key={item.title}
                  type="button"
                >
                  <strong>{item.title}</strong>
                  <span>{item.time}</span>
                  <p>{item.desc}</p>
                </button>
              ))
            )}
          </div>
          <Button type="link">查看更多会话⌄</Button>
        </aside>
        <section className="rag-panel qa-chat">
          <div className="chat-head">
            <h2>{activeTitle}</h2>
            <Button
              icon={<DeleteOutlined />}
              onClick={() => {
                abortRef.current?.abort();
                abortRef.current = null;
                setMessages([]);
              }}
            >
              清空对话
            </Button>
          </div>
          <div className="chat-body">
            {messages.map((message) =>
              message.role === 'user' ? (
                <div className="message user" key={message.id}>
                  <div>
                    <p>{message.content}</p>
                    <span>{message.createdAt}</span>
                  </div>
                  <Avatar />
                </div>
              ) : (
                <div className="message assistant" key={message.id}>
                  <Avatar>AI</Avatar>
                  <div className="answer-card">
                    <p>
                      {message.content ||
                        (message.status === 'streaming'
                          ? '正在通过 AG-UI 协议生成回答...'
                          : '')}
                    </p>
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
                      </div>
                    )}
                    {message.retrievalReason && (
                      <p className="retrieval-reason">
                        检索评估：{message.retrievalReason}
                      </p>
                    )}
                    {message.events && message.events.length > 0 && (
                      <p className="event-trace">
                        AG-UI：{message.events.join(' → ')}
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
