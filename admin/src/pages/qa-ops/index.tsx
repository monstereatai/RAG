import {
  DeleteOutlined,
  DownloadOutlined,
  EllipsisOutlined,
  FileAddOutlined,
  FileWordOutlined,
  FolderOpenOutlined,
  FlagOutlined,
  MenuOutlined,
  PaperClipOutlined,
  PlusOutlined,
  SendOutlined,
  ShareAltOutlined,
  SoundOutlined,
} from '@ant-design/icons';
import { AssistantMarkdown } from '@/components/AssistantMarkdown';
import { ModulePage, qaNav } from '@/components/AdminShell';
import { history } from '@umijs/max';
import {
  Avatar,
  Button,
  Drawer,
  Dropdown,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Tag,
  message as antdMessage,
} from 'antd';
import React from 'react';
import {
  type AguiEvent,
  type ChatMode,
  type ChatModel,
  type ConversationSummary,
  type ArtifactKind,
  type GeneratedArtifact,
  type ReferenceChunk,
  type RolePreset,
  createTtsWebSocket,
  createArtifact,
  createArtifactShare,
  deleteConversation,
  downloadArtifact,
  getEnabledQaModelOptions,
  getQaModelConfig,
  getConversation,
  getConversations,
  getArtifacts,
  getRolePresets,
  getQaPlugins,
  streamAguiAnswer,
  submitConversationBadCase,
} from './service';

const ROLE_PRESET_STORAGE_KEY = 'qa_ops_role_preset';

interface ArtifactFormValues {
  title: string;
  kind: ArtifactKind;
  sourceText: string;
  prompt?: string;
}

interface ShareFormValues {
  visibility: 'internal' | 'external';
  expiresInHours?: number;
  maxDownloads?: number;
}

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
  artifacts?: GeneratedArtifact[];
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
        id: typeof record.id === 'string' ? record.id : `image-${index}-${url}`,
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

const toAnswerArtifacts = (value: unknown): GeneratedArtifact[] => {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return items.filter((item): item is GeneratedArtifact => {
    if (!item || typeof item !== 'object') return false;
    const record = item as Record<string, unknown>;
    return (
      typeof record.id === 'string' &&
      typeof record.title === 'string' &&
      typeof record.filename === 'string' &&
      ['markdown', 'word', 'excel', 'architecture', 'image'].includes(
        String(record.kind),
      ) &&
      ['queued', 'generating', 'ready', 'failed'].includes(
        String(record.status),
      )
    );
  });
};

const mergeArtifacts = (
  current: GeneratedArtifact[] | undefined,
  next: GeneratedArtifact[],
) => {
  const byId = new Map((current ?? []).map((item) => [item.id, item]));
  next.forEach((item) => {
    byId.set(item.id, item);
  });
  return [...byId.values()];
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

const routeLabel: Record<string, string> = {
  simple: '极速回答',
  agentic: '深度分析',
};

const insufficientEvidenceMessage = (route?: string) =>
  route === 'agentic'
    ? '已完成深度分析，但当前资料仍不足以支持可靠结论。'
    : '当前资料未覆盖这个问题，暂时无法给出可靠结论。';

const QaOps: React.FC = () => {
  const [input, setInput] = React.useState('');
  const [mode, setMode] = React.useState<ChatMode>('auto');
  const [qaPlugins, setQaPlugins] = React.useState<
    Array<{
      key: string;
      displayName?: string;
      status: string;
      modes?: string[];
    }>
  >([]);
  const [pluginKeys, setPluginKeys] = React.useState<string[]>([]);
  const availableQaPlugins = React.useMemo(
    () =>
      qaPlugins.filter(
        (plugin) =>
          plugin.status === 'enabled' && (plugin.modes ?? []).includes(mode),
      ),
    [mode, qaPlugins],
  );
  const modelConfig = React.useMemo(() => getQaModelConfig(), []);
  const modelOptions = React.useMemo(
    () => getEnabledQaModelOptions(modelConfig),
    [modelConfig],
  );
  const [model, setModel] = React.useState<ChatModel>(modelConfig.defaultModel);
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [rolePresets, setRolePresets] = React.useState<RolePreset[]>([]);
  const [rolePresetId, setRolePresetId] = React.useState(() =>
    typeof window === 'undefined'
      ? 'business-owner'
      : window.localStorage.getItem(ROLE_PRESET_STORAGE_KEY) ||
        'business-owner',
  );
  const [rolePresetsLoading, setRolePresetsLoading] = React.useState(true);
  const [activeTitle, setActiveTitle] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [threadId, setThreadId] = React.useState<string | undefined>(undefined);
  const threadIdRef = React.useRef<string | undefined>(undefined);
  const [conversations, setConversations] = React.useState<
    ConversationSummary[]
  >([]);
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
  const [artifactForm] = Form.useForm<ArtifactFormValues>();
  const [shareForm] = Form.useForm<ShareFormValues>();
  const [artifactDrawerOpen, setArtifactDrawerOpen] = React.useState(false);
  const [artifactModalOpen, setArtifactModalOpen] = React.useState(false);
  const [shareModalOpen, setShareModalOpen] = React.useState(false);
  const [artifacts, setArtifacts] = React.useState<GeneratedArtifact[]>([]);
  const [artifactLoading, setArtifactLoading] = React.useState(false);
  const [artifactSubmitting, setArtifactSubmitting] = React.useState(false);
  const [selectedArtifact, setSelectedArtifact] =
    React.useState<GeneratedArtifact | null>(null);
  const [badCaseMessage, setBadCaseMessage] =
    React.useState<ChatMessage | null>(null);
  const [badCaseForm] = Form.useForm();
  const [badCaseSubmitting, setBadCaseSubmitting] = React.useState(false);

  const loadArtifacts = React.useCallback(async () => {
    setArtifactLoading(true);
    try {
      const result = await getArtifacts();
      setArtifacts(result.data ?? []);
    } catch (error) {
      antdMessage.error(
        error instanceof Error ? error.message : '文件列表加载失败',
      );
    } finally {
      setArtifactLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (!artifactDrawerOpen) return;
    void loadArtifacts();
    const timer = window.setInterval(() => void loadArtifacts(), 2500);
    return () => window.clearInterval(timer);
  }, [artifactDrawerOpen, loadArtifacts]);

  const hasPendingMessageArtifact = messages.some((item) =>
    item.artifacts?.some(
      (artifact) =>
        artifact.status === 'queued' || artifact.status === 'generating',
    ),
  );

  React.useEffect(() => {
    if (!hasPendingMessageArtifact) return;
    let disposed = false;
    const refresh = async () => {
      try {
        const result = await getArtifacts(threadIdRef.current);
        if (disposed) return;
        const latest = result.data ?? [];
        const byId = new Map(latest.map((item) => [item.id, item]));
        setArtifacts(latest);
        setMessages((current) =>
          current.map((message) => ({
            ...message,
            artifacts: message.artifacts?.map(
              (artifact) => byId.get(artifact.id) ?? artifact,
            ),
          })),
        );
      } catch {
        // 文件中心仍可手动重试，轮询失败不打断当前回答。
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2500);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [hasPendingMessageArtifact]);

  const openArtifactModal = (kind: ArtifactKind = 'word') => {
    const lastAnswer = [...messages]
      .reverse()
      .find((item) => item.role === 'assistant' && item.content)?.content;
    artifactForm.setFieldsValue({
      title: activeTitle || 'AI 问答产物',
      kind,
      sourceText: lastAnswer || input,
      prompt: kind === 'image' ? input : undefined,
    });
    setArtifactModalOpen(true);
  };

  const handleCreateArtifact = async () => {
    const values = await artifactForm.validateFields();
    setArtifactSubmitting(true);
    try {
      await createArtifact({ ...values, threadId });
      antdMessage.success('已提交生成任务');
      setArtifactModalOpen(false);
      setArtifactDrawerOpen(true);
      await loadArtifacts();
    } finally {
      setArtifactSubmitting(false);
    }
  };

  const handleCreateShare = async () => {
    if (!selectedArtifact) return;
    const values = await shareForm.validateFields();
    setArtifactSubmitting(true);
    try {
      const result = await createArtifactShare(selectedArtifact.id, values);
      const token = result.data?.token;
      if (!token) throw new Error(result.error || '分享链接创建失败');
      const url = `${window.location.origin}/shared/artifacts/${encodeURIComponent(token)}`;
      await navigator.clipboard.writeText(url);
      antdMessage.success('分享链接已复制');
      setShareModalOpen(false);
    } finally {
      setArtifactSubmitting(false);
    }
  };

  const artifactKindLabel: Record<ArtifactKind, string> = {
    markdown: 'Markdown',
    word: 'Word',
    excel: 'Excel',
    architecture: '架构图',
    image: '图片',
  };

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
    } catch (error) {
      antdMessage.error(
        error instanceof Error ? error.message : '会话列表加载失败，请重试',
      );
    } finally {
      setSidebarLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  React.useEffect(() => {
    void getQaPlugins()
      .then((result) => {
        const payload: unknown = result?.data;
        const plugins = Array.isArray(payload)
          ? payload
          : payload &&
              typeof payload === 'object' &&
              'data' in payload &&
              Array.isArray(payload.data)
            ? payload.data
            : [];
        setQaPlugins(plugins);
      })
      .catch(() => setQaPlugins([]));
  }, []);

  React.useEffect(() => {
    const availableKeys = new Set(
      availableQaPlugins.map((plugin) => plugin.key),
    );
    setPluginKeys((current) => current.filter((key) => availableKeys.has(key)));
  }, [availableQaPlugins]);

  React.useEffect(() => {
    let active = true;
    void getRolePresets()
      .then((res) => {
        if (!active) return;
        const catalog = res.data;
        const roles = Array.isArray(catalog?.roles) ? catalog.roles : [];
        setRolePresets(roles);
        setRolePresetId((currentRolePresetId) => {
          if (roles.some((role) => role.id === currentRolePresetId)) {
            return currentRolePresetId;
          }
          const nextRolePresetId =
            catalog?.defaultRolePresetId || 'business-owner';
          window.localStorage.setItem(
            ROLE_PRESET_STORAGE_KEY,
            nextRolePresetId,
          );
          return nextRolePresetId;
        });
      })
      .finally(() => {
        if (active) setRolePresetsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const activeRolePreset = React.useMemo(
    () => rolePresets.find((role) => role.id === rolePresetId),
    [rolePresetId, rolePresets],
  );

  const handleRolePresetChange = (nextRolePresetId: string) => {
    setRolePresetId(nextRolePresetId);
    window.localStorage.setItem(ROLE_PRESET_STORAGE_KEY, nextRolePresetId);
  };

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
      prev.map((message) =>
        message.id === messageId ? updater(message) : message,
      ),
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
      rolePresetId,
      pluginKeys,
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
        typeof event.data?.threadId === 'string'
          ? event.data.threadId
          : undefined;
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
      const delta =
        typeof event.data?.delta === 'string' ? event.data.delta : '';
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
          media: mergeMedia(message.media, [
            ...toAnswerMedia(output.images),
            ...toAnswerMedia(output.media),
            ...toAnswerMedia(output.attachments),
          ]),
          artifacts: mergeArtifacts(
            message.artifacts,
            toAnswerArtifacts(output.artifacts),
          ),
          route:
            typeof output.route === 'string' ? output.route : message.route,
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
                    sorted.sort(
                      (a, b) =>
                        new Date(b.updatedAt).getTime() -
                        new Date(a.updatedAt).getTime(),
                    );
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
                  onKeyDown={(e) =>
                    e.key === 'Enter' && handleSelectConversation(item)
                  }
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
                          setConversations((prev) =>
                            prev.filter((c) => c.threadId !== item.threadId),
                          );
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
            <Space>
              <Button
                icon={<FolderOpenOutlined />}
                onClick={() => setArtifactDrawerOpen(true)}
              >
                文件
              </Button>
              <Button
                icon={<DeleteOutlined />}
                onClick={handleClearConversation}
              >
                清空对话
              </Button>
            </Space>
          </div>
          <div className="qa-role-toolbar">
            <span>服务岗位</span>
            <Select
              aria-label="服务岗位"
              loading={rolePresetsLoading}
              onChange={handleRolePresetChange}
              options={rolePresets.map((role) => ({
                label: role.name,
                value: role.id,
              }))}
              placeholder="选择岗位"
              value={rolePresetId}
            />
            <p>{activeRolePreset?.summary ?? '正在加载岗位能力...'}</p>
          </div>
          <div className="chat-body" ref={chatBodyRef}>
            {messages.map((message, messageIndex) =>
              message.role === 'user' ? (
                <div className="message user" key={message.id}>
                  <div>
                    <p>{message.content}</p>
                    <span>{message.createdAt}</span>
                  </div>
                  <Avatar style={{ background: '#f0f2f5', color: '#8c8c8c' }}>
                    <svg
                      viewBox="0 0 24 24"
                      width="18"
                      height="18"
                      fill="currentColor"
                    >
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
                        <AssistantMarkdown
                          className="answer-markdown"
                          content={message.content}
                          status={
                            message.status === 'streaming'
                              ? 'streaming'
                              : 'done'
                          }
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
                      <Space>
                        <Button
                          className="answer-voice-btn"
                          icon={<SoundOutlined />}
                          loading={
                            ttsStatusByMessageId[message.id] === 'connecting' ||
                            ttsStatusByMessageId[message.id] === 'synthesizing'
                          }
                          onClick={() =>
                            handlePlayTts(message.id, message.content)
                          }
                          size="small"
                          type="text"
                        >
                          {getTtsButtonText(ttsStatusByMessageId[message.id])}
                        </Button>
                        <Button
                          icon={<FlagOutlined />}
                          onClick={() => {
                            setBadCaseMessage(message);
                            badCaseForm.resetFields();
                            badCaseForm.setFieldValue(
                              'correctedAnswer',
                              message.content,
                            );
                          }}
                          size="small"
                          type="text"
                        >
                          提交 Bad Case
                        </Button>
                      </Space>
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
                    {message.artifacts && message.artifacts.length > 0 && (
                      <div className="answer-artifacts">
                        {message.artifacts.map((artifact) => (
                          <article key={artifact.id}>
                            <FileAddOutlined />
                            <div>
                              <strong>{artifact.title}</strong>
                              <span>{artifact.filename}</span>
                            </div>
                            <Tag
                              color={
                                artifact.status === 'ready'
                                  ? 'success'
                                  : artifact.status === 'failed'
                                    ? 'error'
                                    : 'processing'
                              }
                            >
                              {
                                {
                                  queued: '排队中',
                                  generating: '生成中',
                                  ready: '可下载',
                                  failed: '失败',
                                }[artifact.status]
                              }
                            </Tag>
                            <Button
                              disabled={artifact.status !== 'ready'}
                              icon={<DownloadOutlined />}
                              onClick={() =>
                                void downloadArtifact(
                                  artifact.id,
                                  artifact.filename,
                                ).catch((error) =>
                                  antdMessage.error(error.message),
                                )
                              }
                              size="small"
                              title="下载"
                            />
                            <Button
                              disabled={artifact.status !== 'ready'}
                              icon={<ShareAltOutlined />}
                              onClick={() => {
                                setSelectedArtifact(artifact);
                                shareForm.setFieldsValue({
                                  visibility: 'external',
                                  expiresInHours: 72,
                                });
                                setShareModalOpen(true);
                              }}
                              size="small"
                              title="分享"
                            />
                          </article>
                        ))}
                      </div>
                    )}
                    {message.route && (
                      <div className="answer-meta">
                        <span>
                          处理方式：{routeLabel[message.route] ?? message.route}
                        </span>
                        {message.retrievalSufficient !== undefined && (
                          <span>
                            证据：
                            {message.retrievalSufficient
                              ? '已确认'
                              : '资料不足'}
                          </span>
                        )}
                        {message.retrievalSufficient !== false &&
                          message.confidence !== undefined && (
                            <span>
                              回答评分：{message.confidence.toFixed(2)}
                            </span>
                          )}
                        {message.retryCount !== undefined &&
                          message.retryCount > 0 && (
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
                    {message.status === 'done' &&
                      message.retrievalSufficient === false && (
                        <div className="answer-insufficient">
                          <strong>
                            {insufficientEvidenceMessage(message.route)}
                          </strong>
                          <span>
                            可补充版本、项目、时间范围或具体业务场景后重新提问。
                          </span>
                          <Button
                            onClick={() => {
                              const sourceQuery = messages
                                .slice(0, messageIndex)
                                .reverse()
                                .find((item) => item.role === 'user')?.content;
                              setInput(`${sourceQuery ?? ''}\n\n补充信息：`);
                            }}
                            size="small"
                          >
                            补充问题信息
                          </Button>
                        </div>
                      )}
                    {(message.retrievalReason ||
                      (message.events && message.events.length > 0)) && (
                      <details className="answer-debug-details">
                        <summary>查看检索与运行详情</summary>
                        {message.retrievalReason && (
                          <p className="retrieval-reason">
                            {message.retrievalReason}
                          </p>
                        )}
                        {message.events && message.events.length > 0 && (
                          <p className="event-trace">
                            {formatEventTrace(message.events)}
                          </p>
                        )}
                      </details>
                    )}
                    {message.references && message.references.length > 0 && (
                      <div className="reference-box">
                        <strong>引用文档（{message.references.length}）</strong>
                        <div>
                          {message.references.map((item) => (
                            <article key={item.id}>
                              <FileWordOutlined className="file-icon word" />
                              <div>
                                <a
                                  href={
                                    item.retrievalSource === 'web'
                                      ? item.docId
                                      : undefined
                                  }
                                  target={
                                    item.retrievalSource === 'web'
                                      ? '_blank'
                                      : undefined
                                  }
                                  rel={
                                    item.retrievalSource === 'web'
                                      ? 'noreferrer'
                                      : undefined
                                  }
                                  onClick={(event) => {
                                    if (item.retrievalSource !== 'web') {
                                      event.preventDefault();
                                      history.push(
                                        `/documents/${encodeURIComponent(item.docId)}`,
                                      );
                                    }
                                  }}
                                >
                                  {item.docId || item.id}
                                </a>
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
            <div className="qa-role-workspace">
              <div className="qa-role-intro">
                <span className="qa-role-mark">
                  {activeRolePreset?.shortName ?? '岗位'}
                </span>
                <div>
                  <strong>{activeRolePreset?.name ?? '岗位能力加载中'}</strong>
                  <p>{activeRolePreset?.summary}</p>
                </div>
              </div>
              <div className="qa-role-responsibilities">
                {activeRolePreset?.responsibilities.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
              <div className="qa-role-actions">
                <strong>常用任务</strong>
                <div>
                  {activeRolePreset?.starterTasks.map((item) => (
                    <Button key={item} onClick={() => setInput(item)}>
                      {item}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="qa-role-questions">
                <strong>直接开始</strong>
                <div>
                  {activeRolePreset?.suggestedQuestions.map((item) => (
                    <button
                      key={item}
                      onClick={() => setInput(item)}
                      type="button"
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>
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
                <option value="auto">auto</option>
                <option value="simple">simple</option>
                <option value="agentic">agentic</option>
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
              <span className="chat-plugin-label">插件</span>
              <Select
                aria-label="插件能力包"
                className="chat-plugin-control"
                mode="multiple"
                allowClear
                maxTagCount="responsive"
                placeholder={
                  availableQaPlugins.length
                    ? '选择插件能力包（可多选）'
                    : '当前链路暂无可用插件'
                }
                value={pluginKeys}
                disabled={!availableQaPlugins.length}
                options={availableQaPlugins.map((plugin) => ({
                  label: plugin.displayName ?? plugin.key,
                  value: plugin.key,
                  title: plugin.key,
                }))}
                onChange={(values) => setPluginKeys(values)}
              />
              <span>{input.length} / 2000</span>
              <Button disabled={loading} icon={<PaperClipOutlined />} />
              <Button
                disabled={loading || (!input.trim() && !messages.length)}
                icon={<FileAddOutlined />}
                onClick={() => openArtifactModal()}
              >
                生成文件
              </Button>
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
      <Modal
        open={Boolean(badCaseMessage)}
        title="提交 Bad Case"
        okText="提交审核"
        confirmLoading={badCaseSubmitting}
        onCancel={() => setBadCaseMessage(null)}
        onOk={async () => {
          if (!threadId || !badCaseMessage) return;
          const values = await badCaseForm.validateFields();
          setBadCaseSubmitting(true);
          try {
            await submitConversationBadCase(threadId, values);
            antdMessage.success('Bad Case 已提交，等待审核');
            setBadCaseMessage(null);
          } catch (error) {
            antdMessage.error(
              error instanceof Error ? error.message : '提交失败',
            );
          } finally {
            setBadCaseSubmitting(false);
          }
        }}
      >
        <Form form={badCaseForm} layout="vertical">
          <Form.Item
            label="错误类型"
            name="errorType"
            rules={[{ required: true }]}
          >
            <Select
              options={[
                { value: 'retrieval_miss', label: '召回遗漏' },
                { value: 'ranking_error', label: '排序错误' },
                { value: 'citation_error', label: '引用错误' },
                { value: 'hallucination', label: '幻觉／编造' },
                { value: 'outdated_content', label: '内容过期' },
                { value: 'incomplete_answer', label: '回答不完整' },
                { value: 'other', label: '其他' },
              ]}
            />
          </Form.Item>
          <Form.Item label="问题描述" name="comment">
            <Input.TextArea rows={3} placeholder="说明回答哪里不对" />
          </Form.Item>
          <Form.Item
            label="纠正答案"
            name="correctedAnswer"
            rules={[{ required: true, whitespace: true }]}
          >
            <Input.TextArea rows={6} />
          </Form.Item>
          <Form.Item
            label="允许进入回归集"
            name="includeInRegression"
            initialValue={false}
            valuePropName="checked"
          >
            <Switch checkedChildren="是" unCheckedChildren="否" />
          </Form.Item>
        </Form>
      </Modal>
      <Drawer
        open={artifactDrawerOpen}
        onClose={() => setArtifactDrawerOpen(false)}
        size="large"
        title="生成文件"
        extra={
          <Button
            icon={<FileAddOutlined />}
            type="primary"
            onClick={() => openArtifactModal()}
          >
            新建
          </Button>
        }
      >
        <div className="artifact-list" aria-busy={artifactLoading}>
          {!artifacts.length && !artifactLoading ? (
            <p className="artifact-empty">暂无生成文件</p>
          ) : (
            artifacts.map((artifact) => (
              <article className="artifact-item" key={artifact.id}>
                <div className="artifact-item-main">
                  <strong>{artifact.title}</strong>
                  <span>{artifact.filename}</span>
                  {artifact.errorMessage && <p>{artifact.errorMessage}</p>}
                </div>
                <div className="artifact-item-actions">
                  <Tag>{artifactKindLabel[artifact.kind]}</Tag>
                  <Tag
                    color={
                      artifact.status === 'ready'
                        ? 'success'
                        : artifact.status === 'failed'
                          ? 'error'
                          : 'processing'
                    }
                  >
                    {
                      {
                        queued: '排队中',
                        generating: '生成中',
                        ready: '可下载',
                        failed: '失败',
                      }[artifact.status]
                    }
                  </Tag>
                  <Button
                    disabled={artifact.status !== 'ready'}
                    icon={<DownloadOutlined />}
                    onClick={() =>
                      void downloadArtifact(
                        artifact.id,
                        artifact.filename,
                      ).catch((error) => antdMessage.error(error.message))
                    }
                    title="下载"
                  />
                  <Button
                    disabled={artifact.status !== 'ready'}
                    icon={<ShareAltOutlined />}
                    onClick={() => {
                      setSelectedArtifact(artifact);
                      shareForm.setFieldsValue({
                        visibility: 'external',
                        expiresInHours: 72,
                      });
                      setShareModalOpen(true);
                    }}
                    title="分享"
                  />
                </div>
              </article>
            ))
          )}
        </div>
      </Drawer>
      <Modal
        open={artifactModalOpen}
        title="生成可传播文件"
        okText="开始生成"
        cancelText="取消"
        confirmLoading={artifactSubmitting}
        onCancel={() => setArtifactModalOpen(false)}
        onOk={() => void handleCreateArtifact()}
      >
        <Form form={artifactForm} layout="vertical" preserve={false}>
          <Form.Item
            name="title"
            label="文件标题"
            rules={[{ required: true, message: '请输入文件标题' }]}
          >
            <Input maxLength={80} />
          </Form.Item>
          <Form.Item name="kind" label="文件类型" rules={[{ required: true }]}>
            <Select
              options={Object.entries(artifactKindLabel).map(
                ([value, label]) => ({ value, label }),
              )}
            />
          </Form.Item>
          <Form.Item
            name="sourceText"
            label="文件内容"
            rules={[{ required: true, message: '请输入或保留问答内容' }]}
          >
            <Input.TextArea
              autoSize={{ minRows: 8, maxRows: 16 }}
              maxLength={200000}
            />
          </Form.Item>
          <Form.Item name="prompt" label="图片补充描述">
            <Input.TextArea
              autoSize={{ minRows: 2, maxRows: 4 }}
              maxLength={4000}
            />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        open={shareModalOpen}
        title={`分享：${selectedArtifact?.title ?? ''}`}
        okText="创建并复制链接"
        cancelText="取消"
        confirmLoading={artifactSubmitting}
        onCancel={() => setShareModalOpen(false)}
        onOk={() => void handleCreateShare()}
      >
        <Form form={shareForm} layout="vertical" preserve={false}>
          <Form.Item
            name="visibility"
            label="分享范围"
            rules={[{ required: true }]}
          >
            <Select
              options={[
                { value: 'external', label: '外部分享，无需登录' },
                { value: 'internal', label: '内部分享，需要登录' },
              ]}
            />
          </Form.Item>
          <Form.Item name="expiresInHours" label="有效时长（小时）">
            <InputNumber min={1} max={8760} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="maxDownloads" label="最多下载次数">
            <InputNumber
              min={1}
              max={100000}
              placeholder="不填则不限次数"
              style={{ width: '100%' }}
            />
          </Form.Item>
        </Form>
      </Modal>
    </ModulePage>
  );
};

export default QaOps;
