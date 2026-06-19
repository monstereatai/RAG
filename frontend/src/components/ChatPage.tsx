import { useState, useRef, useEffect } from 'react';
import { chat, chatStream, synthesizeSpeechStream } from '../api';
import type { ChatMode, ReferenceChunk } from '../types';
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
  references?: ReferenceChunk[];
  route?: string;
  confidence?: number;
  retryCount?: number;
  retrievalSufficient?: boolean;
  retrievalReason?: string;
  status?: 'streaming' | 'done' | 'error';
  events?: string[]; // SSE 事件追踪
}

function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<ChatMode>('simple');
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const voiceBaseInputRef = useRef('');

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

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
      const res = await chat(query, m);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: res.answer,
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

      chatStream(
        query,
        m,
        (event) => {
          const { type, data } = event;
          updateMsg((msg) => ({
            ...msg,
            events: [...(msg.events ?? []), type],
          }));

          switch (type) {
            case 'routing': {
              const route = (data as { route?: string }).route;
              updateMsg((msg) => ({ ...msg, route }));
              break;
            }
            case 'token': {
              const token =
                typeof data === 'string'
                  ? data
                  : ((data as { token?: string }).token ?? '');
              updateMsg((msg) => ({ ...msg, content: msg.content + token }));
              break;
            }
            case 'citation': {
              const refs = Array.isArray(data)
                ? (data as ReferenceChunk[])
                : ((data as { references?: ReferenceChunk[] }).references ?? []);
              updateMsg((msg) => ({ ...msg, references: refs }));
              break;
            }
            case 'reflection': {
              const r = data as { confidence?: number; retryCount?: number };
              updateMsg((msg) => ({
                ...msg,
                confidence: r.confidence,
                retryCount: r.retryCount,
              }));
              break;
            }
            case 'sufficiency': {
              const s = data as { sufficient?: boolean; reason?: string };
              updateMsg((msg) => ({
                ...msg,
                retrievalSufficient: s.sufficient,
                retrievalReason: s.reason,
              }));
              break;
            }
            case 'final': {
              const f = data as {
                answer?: string;
                references?: ReferenceChunk[];
                retrievalSufficient?: boolean;
                retrievalReason?: string;
              };
              updateMsg((msg) => ({
                ...msg,
                content: f.answer ?? msg.content,
                references: f.references ?? msg.references,
                retrievalSufficient:
                  f.retrievalSufficient ?? msg.retrievalSufficient,
                retrievalReason: f.retrievalReason ?? msg.retrievalReason,
                status: 'done',
              }));
              resolve();
              break;
            }
            case 'error': {
              const e = data as { message?: string };
              updateMsg((msg) => ({
                ...msg,
                content: `错误: ${e.message ?? '未知错误'}`,
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
      .replace(/[*#`_\-]/g, '')
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
      <div className="mode-switcher">
        <label>模式：</label>
        {(['simple', 'agentic', 'auto'] as ChatMode[]).map((m) => (
          <button
            key={m}
            className={mode === m ? 'active' : ''}
            onClick={() => setMode(m)}
          >
            {m}
          </button>
        ))}
        <span className="mode-hint">
          {mode === 'simple' && '直接检索 + 生成（最快）'}
          {mode === 'agentic' && '多轮检索 + 反思（SSE 流式，最慢）'}
          {mode === 'auto' && '自动选择 simple/agentic（SSE 流式）'}
        </span>
      </div>

      <div className="messages">
        {messages.length === 0 && (
          <div className="empty-chat">
            <p>输入问题开始对话</p>
            <p className="hint">提示：先在"文档管理"上传 Markdown 文件</p>
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
                <div className="message-meta">检索评估: {msg.retrievalReason}</div>
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
