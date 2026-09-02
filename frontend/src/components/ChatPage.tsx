import { useState, useRef, useEffect } from 'react';
import { aguiStream, chat, getRolePresets, synthesizeSpeechStream } from '../api';
import type {
  AguiEvent,
  ChatMode,
  ChatResponse,
  ReferenceChunk,
  RolePreset,
} from '../types';
import ReferenceList from './ReferenceList';

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      [index: number]: { transcript: string };
    };
  };
}

interface SpeechRecognitionErrorEventLike {
  error: string;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

interface Message {
  role: 'user' | 'assistant';
  content: string;
  sourceQuery?: string;
  references?: ReferenceChunk[];
  route?: string;
  confidence?: number;
  retryCount?: number;
  retrievalSufficient?: boolean;
  retrievalReason?: string;
  status?: 'streaming' | 'done' | 'error';
  events?: string[]; // SSE 事件追踪
}

const modeOptions: Array<{
  value: ChatMode;
  label: string;
  title: string;
}> = [
  { value: 'simple', label: '极速', title: '单次检索并快速回答' },
  { value: 'auto', label: '自动', title: '根据证据和复杂度自动选择处理方式' },
  { value: 'agentic', label: '深度', title: '执行子问题规划、补充检索和反思' },
];

function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<ChatMode>('auto');
  const [roles, setRoles] = useState<RolePreset[]>([]);
  const [rolePresetId, setRolePresetId] = useState(
    () => localStorage.getItem('rolePresetId') ?? 'business-owner',
  );
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const voiceBaseInputRef = useRef('');

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    void getRolePresets()
      .then((catalog) => {
        setRoles(catalog.roles);
        const selectedExists = catalog.roles.some(
          (role) => role.id === rolePresetId,
        );
        if (!selectedExists) {
          setRolePresetId(catalog.defaultRolePresetId);
          localStorage.setItem('rolePresetId', catalog.defaultRolePresetId);
        }
      })
      .catch(() => setRoles([]));
  }, [rolePresetId]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  const activeRole =
    roles.find((role) => role.id === rolePresetId) ?? roles[0];

  const handleRoleChange = (nextRoleId: string) => {
    setRolePresetId(nextRoleId);
    localStorage.setItem('rolePresetId', nextRoleId);
  };

  const handleSuggestedQuestion = (question: string) => {
    setInput(question);
  };

  const prepareClarification = (query: string) => {
    setInput(`${query}\n\n补充信息：`);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const retryWithMode = async (query: string, nextMode: ChatMode) => {
    if (!query.trim() || loading) return;
    setMode(nextMode);
    setMessages((prev) => [...prev, { role: 'user', content: query }]);
    setLoading(true);
    if (nextMode === 'simple') {
      await sendNonStream(query, nextMode);
    } else {
      await sendStream(query, nextMode);
    }
    setLoading(false);
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    const query = input.trim();
    setInput('');

    setMessages((prev) => [...prev, { role: 'user', content: query }]);
    setLoading(true);

    // simple 模式用非流式 POST，agentic/auto 用 SSE 流式
    if (mode === 'simple') {
      await sendNonStream(query, mode);
    } else {
      await sendStream(query, mode);
    }

    setLoading(false);
  };

  // 非流式（simple 模式）
  const sendNonStream = async (query: string, m: ChatMode) => {
    try {
      const res = await chat(query, m, rolePresetId);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: res.answer,
          sourceQuery: query,
          references: res.references,
          route: res.route,
          confidence: res.confidence,
          retryCount: res.retryCount,
          retrievalSufficient: res.retrievalSufficient,
          retrievalReason: res.retrievalReason,
          status: 'done',
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `错误: ${(err as Error).message}`, status: 'error' },
      ]);
    }
  };

  // SSE 流式（agentic/auto 模式）
  const sendStream = (query: string, m: ChatMode) => {
    return new Promise<void>((resolve) => {
      // 先插入一条空的 assistant 消息，逐步更新
      let msgIndex = -1;
      setMessages((prev) => {
        msgIndex = prev.length;
        return [
          ...prev,
          {
            role: 'assistant',
            content: '',
            sourceQuery: query,
            status: 'streaming',
            events: [],
          },
        ];
      });

      const updateMsg = (updater: (msg: Message) => Message) => {
        setMessages((prev) => {
          if (msgIndex < 0 || msgIndex >= prev.length) return prev;
          const next = [...prev];
          next[msgIndex] = updater(next[msgIndex]);
          return next;
        });
      };

      aguiStream(
        query,
        m,
        rolePresetId,
        (event) => {
          const { type } = event;
          updateMsg((msg) => ({
            ...msg,
            events: [...(msg.events ?? []), type],
          }));

          switch (type) {
            case 'RUN_STARTED': {
              const input = event.data?.input as { mode?: ChatMode } | undefined;
              updateMsg((msg) => ({
                ...msg,
                route: input?.mode,
              }));
              break;
            }
            case 'TEXT_MESSAGE_CONTENT': {
              const delta =
                typeof event.data?.delta === 'string' ? event.data.delta : '';
              updateMsg((msg) => ({
                ...msg,
                content: msg.content + delta,
              }));
              break;
            }
            case 'STATE_DELTA': {
              applyAguiStateDelta(event, updateMsg);
              break;
            }
            case 'CUSTOM': {
              applyAguiCustomEvent(event, updateMsg);
              break;
            }
            case 'RUN_FINISHED': {
              const output = event.data?.output as ChatResponse | undefined;
              updateMsg((msg) => ({
                ...msg,
                content: output?.answer ?? msg.content,
                references: output?.references ?? msg.references,
                route: output?.route ?? msg.route,
                confidence: output?.confidence ?? msg.confidence,
                retryCount: output?.retryCount ?? msg.retryCount,
                retrievalSufficient:
                  output?.retrievalSufficient ?? msg.retrievalSufficient,
                retrievalReason:
                  output?.retrievalReason ?? msg.retrievalReason,
                status: 'done',
              }));
              resolve();
              break;
            }
            case 'RUN_ERROR': {
              const message =
                typeof event.data?.message === 'string'
                  ? event.data.message
                  : '未知错误';
              updateMsg((msg) => ({
                ...msg,
                content: `错误: ${message}`,
                status: 'error',
              }));
              resolve();
              break;
            }
          }
        },
        (err) => {
          updateMsg((msg) => ({
            ...msg,
            content: msg.content || `错误: ${err.message}`,
            status: 'error',
          }));
          resolve();
        },
        () => {
          updateMsg((msg) => ({
            ...msg,
            status: msg.status === 'streaming' ? 'done' : msg.status,
          }));
          resolve();
        },
      );
    });
  };

  const applyAguiStateDelta = (
    event: AguiEvent,
    updateMsg: (updater: (msg: Message) => Message) => void,
  ) => {
    const delta = event.data?.delta;
    if (!Array.isArray(delta)) return;

    for (const patch of delta) {
      if (!isRecord(patch)) continue;
      const value = patch.value;
      if (patch.path === '/routing' && isRecord(value)) {
        updateMsg((msg) => ({
          ...msg,
          route:
            typeof value.route === 'string'
              ? value.route
              : msg.route,
        }));
      }
      if (patch.path === '/sufficiency' && isRecord(value)) {
        updateMsg((msg) => ({
          ...msg,
          retrievalSufficient:
            typeof value.sufficient === 'boolean'
              ? value.sufficient
              : msg.retrievalSufficient,
          retrievalReason:
            typeof value.reason === 'string'
              ? value.reason
              : msg.retrievalReason,
        }));
      }
    }
  };

  const applyAguiCustomEvent = (
    event: AguiEvent,
    updateMsg: (updater: (msg: Message) => Message) => void,
  ) => {
    const name = event.data?.name;
    const value = event.data?.value;

    if (name === 'rag.citation') {
      const refs = Array.isArray(value)
        ? (value as ReferenceChunk[])
        : isRecord(value) && Array.isArray(value.references)
          ? (value.references as ReferenceChunk[])
          : [];
      updateMsg((msg) => ({ ...msg, references: refs }));
      return;
    }

    if (name === 'rag.reflection' && isRecord(value)) {
      updateMsg((msg) => ({
        ...msg,
        confidence:
          typeof value.confidence === 'number'
            ? value.confidence
            : msg.confidence,
        retryCount:
          typeof value.retryCount === 'number'
            ? value.retryCount
            : msg.retryCount,
      }));
    }
  };

  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const getSpeechRecognition = (): SpeechRecognitionConstructor | undefined => {
    const speechWindow = window as Window & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
  };

  const handleVoiceInput = () => {
    if (loading) return;
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }

    const SpeechRecognition = getSpeechRecognition();
    if (!SpeechRecognition) {
      setVoiceError('当前浏览器不支持语音输入，请使用 Chrome 或 Edge。');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognitionRef.current = recognition;
    voiceBaseInputRef.current = input.trim();
    setVoiceError('');
    setListening(true);

    recognition.onresult = (event) => {
      let transcript = '';
      for (let i = 0; i < event.results.length; i += 1) {
        transcript += event.results[i][0]?.transcript ?? '';
      }
      setInput([voiceBaseInputRef.current, transcript.trim()]
        .filter(Boolean)
        .join(' '));
    };

    recognition.onerror = (event) => {
      setVoiceError(`语音识别失败：${event.error}`);
      setListening(false);
      recognitionRef.current = null;
    };

    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };

    recognition.start();
  };

  const playTTS = async (text: string, messageIndex: number) => {
    if (speakingIndex !== null) return;

    const cleanText = text
      .replace(/\[片段\s*\d+\]/g, '')
      .replace(/[*#`_-]/g, '')
      .trim();
    if (!cleanText) return;

    setSpeakingIndex(messageIndex);
    let objectUrl: string | null = null;
    try {
      const audioBlob = await synthesizeSpeechStream(cleanText);
      objectUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(objectUrl);
      audio.addEventListener('ended', () => {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }, {
        once: true,
      });
      audio.addEventListener('error', () => {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }, {
        once: true,
      });
      await audio.play();
    } catch (err) {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
      console.error('TTS playback failed:', err);
    } finally {
      setSpeakingIndex(null);
    }
  };

  return (
    <div className="chat-page">
      <div className="chat-toolbar">
        <div className="role-selector">
          <label htmlFor="role-preset">我的岗位</label>
          <select
            id="role-preset"
            value={rolePresetId}
            onChange={(event) => handleRoleChange(event.target.value)}
            disabled={loading || roles.length === 0}
          >
            {roles.length === 0 && (
              <option value="business-owner">业务负责人</option>
            )}
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
          {activeRole && <span className="role-summary">{activeRole.summary}</span>}
        </div>
        <div className="mode-switcher" aria-label="问答模式">
          {modeOptions.map((option) => (
            <button
              key={option.value}
              className={mode === option.value ? 'active' : ''}
              onClick={() => setMode(option.value)}
              title={option.title}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="messages">
        {messages.length === 0 && (
          <div className="empty-chat">
            <div className="role-intro">
              <span className="role-mark">{activeRole?.shortName ?? '负责人'}</span>
              <div>
                <h2>{activeRole?.name ?? '业务负责人'}工作台</h2>
                <p>{activeRole?.summary ?? '从全链路视角协助推进业务。'}</p>
              </div>
            </div>

            {activeRole && (
              <>
                <section className="role-section" aria-labelledby="role-responsibilities">
                  <h3 id="role-responsibilities">我会重点关注</h3>
                  <div className="responsibility-list">
                    {activeRole.responsibilities.map((item) => (
                      <span key={item}>{item}</span>
                    ))}
                  </div>
                </section>

                <section className="role-section" aria-labelledby="role-starters">
                  <h3 id="role-starters">常用任务</h3>
                  <div className="starter-task-list">
                    {activeRole.starterTasks.map((task, index) => (
                      <button
                        key={task}
                        onClick={() => handleSuggestedQuestion(activeRole.suggestedQuestions[index] ?? task)}
                      >
                        {task}
                      </button>
                    ))}
                  </div>
                </section>

                <section className="role-section" aria-labelledby="role-questions">
                  <h3 id="role-questions">可以直接这样问</h3>
                  <div className="suggested-question-list">
                    {activeRole.suggestedQuestions.map((question) => (
                      <button key={question} onClick={() => handleSuggestedQuestion(question)}>
                        <span>{question}</span>
                        <span aria-hidden="true">→</span>
                      </button>
                    ))}
                  </div>
                </section>
              </>
            )}
          </div>
        )}
        {messages.map((msg, idx) => (
          <div key={idx} className={`message ${msg.role} ${msg.status ?? ''}`}>
            <div className="message-role">{msg.role === 'user' ? '我' : 'AI'}</div>
            <div className="message-content">
              <div className="message-text">
                {msg.content || (msg.status === 'streaming' ? '思考中...' : '')}
              </div>
              {msg.role === 'assistant' && msg.content && (
                <button
                  className={`tts-button ${speakingIndex === idx ? 'active' : ''}`}
                  onClick={() => playTTS(msg.content, idx)}
                  disabled={speakingIndex !== null}
                  title="朗读"
                >
                  {speakingIndex === idx ? '合成中' : '朗读'}
                </button>
              )}
              {msg.events && msg.events.length > 0 && msg.status === 'streaming' && (
                <div className="message-events">
                  流程: {msg.events.join(' → ')}
                </div>
              )}
              {msg.route && (
                <div className="message-meta">
                  路由: {msg.route}
                  {msg.retrievalSufficient !== undefined &&
                    ` | 检索: ${msg.retrievalSufficient ? '充分' : '不足'}`}
                  {msg.confidence !== undefined && ` | 置信度: ${msg.confidence.toFixed(2)}`}
                  {msg.retryCount !== undefined && ` | 重试: ${msg.retryCount}`}
                </div>
              )}
              {msg.retrievalReason && (
                <details className="retrieval-details">
                  <summary>查看检索详情</summary>
                  <div>{msg.retrievalReason}</div>
                </details>
              )}
              {msg.role === 'assistant' &&
                msg.status === 'done' &&
                msg.retrievalSufficient === false &&
                msg.sourceQuery && (
                  <div className="fallback-actions">
                    <span>资料还不够明确，可以补充条件或继续深度查找。</span>
                    <div>
                      <button onClick={() => prepareClarification(msg.sourceQuery!)}>
                        补充问题信息
                      </button>
                      {msg.route !== 'agentic' && (
                        <button
                          className="primary"
                          onClick={() => void retryWithMode(msg.sourceQuery!, 'agentic')}
                          disabled={loading}
                        >
                          使用深度检索
                        </button>
                      )}
                    </div>
                  </div>
              )}
              {msg.references && msg.references.length > 0 && (
                <ReferenceList references={msg.references} />
              )}
            </div>
          </div>
        ))}
        {loading && !messages.some((m) => m.status === 'streaming') && (
          <div className="message assistant loading">AI 思考中...</div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="input-area">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入问题（Enter 发送，Shift+Enter 换行）"
          rows={2}
          disabled={loading}
        />
        <button
          className={`voice-button ${listening ? 'active' : ''}`}
          onClick={handleVoiceInput}
          disabled={loading}
          title={listening ? '停止语音输入' : '开始语音输入'}
        >
          {listening ? '停止' : '语音'}
        </button>
        <button onClick={handleSend} disabled={!input.trim() || loading}>
          发送
        </button>
      </div>
      {voiceError && <div className="voice-error">{voiceError}</div>}
    </div>
  );
}

export default ChatPage;
