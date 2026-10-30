import { message as antdMessage, Form } from 'antd';
import React from 'react';
import {
  appendEventTrace,
  mergeArtifacts,
  mergeMedia,
  ROLE_PRESET_STORAGE_KEY,
  toAnswerArtifacts,
  toAnswerMedia,
} from './qa-ops-controller-utils';
import type {
  ArtifactFormValues,
  ChatMessage,
  EventTraceItem,
  RunStateView,
  ShareFormValues,
  TtsStatus,
} from './qa-ops-types';
import {
  type AguiEvent,
  type ArtifactKind,
  type ChatMode,
  type ChatModel,
  type ConversationAttachment,
  type ConversationSummary,
  createArtifact,
  createArtifactShare,
  createTtsWebSocket,
  deleteConversation,
  deleteConversationAttachment,
  deleteConversationAttachments,
  type GeneratedArtifact,
  getArtifacts,
  getConversation,
  getConversationAttachments,
  getConversations,
  getEnabledQaModelOptions,
  getQaModelConfig,
  getQaPlugins,
  getRolePresets,
  type ReferenceChunk,
  type RolePreset,
  streamAguiAnswer,
  uploadConversationAttachment,
} from './service';

export function useQaOpsController() {
  const [input, setInput] = React.useState('');
  // 单一问答链路：后台固定传 auto，由服务端按意图和证据自动路由。
  const mode: ChatMode = 'auto';
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
    [qaPlugins],
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
  const [attachments, setAttachments] = React.useState<
    ConversationAttachment[]
  >([]);
  const [attachmentUploading, setAttachmentUploading] = React.useState(false);
  const attachmentInputRef = React.useRef<HTMLInputElement>(null);
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
    const recentConversation = messages
      .slice(-10)
      .map(
        (item) => `${item.role === 'user' ? '用户' : '助手'}：${item.content}`,
      )
      .filter((item) => item.trim())
      .join('\n\n');
    const attachmentSource = attachments
      .filter((item) => item.status === 'ready')
      .map((item) => `[附件：${item.filename}]\n${item.content}`)
      .join('\n\n');
    artifactForm.setFieldsValue({
      title: activeTitle || 'AI 问答产物',
      kind,
      sourceText: [recentConversation, attachmentSource, lastAnswer || input]
        .filter(Boolean)
        .join('\n\n'),
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
    if (attachmentUploading) return;
    abortRef.current?.abort();
    abortRef.current = null;
    ttsRef.current?.close();
    setTtsStatusByMessageId({});
    setMessages([]);
    setThreadId(undefined);
    threadIdRef.current = undefined;
    setAttachments([]);
    setActiveTitle('');
  };

  const handleClearConversation = async () => {
    if (attachmentUploading) return;
    abortRef.current?.abort();
    abortRef.current = null;
    ttsRef.current?.close();
    setTtsStatusByMessageId({});
    if (threadId) {
      try {
        await deleteConversationAttachments(threadId);
        await deleteConversation(threadId);
        await loadConversations();
      } catch {
        // 静默失败
      }
    }
    setMessages([]);
    setThreadId(undefined);
    threadIdRef.current = undefined;
    setAttachments([]);
    setActiveTitle('');
  };

  const handleSelectConversation = async (item: ConversationSummary) => {
    if (attachmentUploading) return;
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
      threadIdRef.current = detail.threadId;
      setActiveTitle(detail.title);
      try {
        const attachmentResult = await getConversationAttachments(
          detail.threadId,
        );
        setAttachments(
          (attachmentResult.data ?? []).map((attachment) => ({
            ...attachment,
            status: 'ready',
          })),
        );
      } catch {
        setAttachments([]);
      }

      // 将后端的消息列表转为前端 ChatMessage 格式
      const chatMessages: ChatMessage[] = detail.messages.map((m, i) => {
        const metadata = isRecord(m.metadata) ? m.metadata : {};
        const storedEvents = Array.isArray(metadata.events)
          ? metadata.events.filter(
              (event): event is string => typeof event === 'string',
            )
          : [];
        const events = storedEvents.reduce<EventTraceItem[]>(
          (items, event) => appendEventTrace(items, event),
          [],
        );
        return {
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
          route:
            typeof metadata.route === 'string' ? metadata.route : undefined,
          model: isChatModel(metadata.model) ? metadata.model : undefined,
          confidence:
            typeof metadata.confidence === 'number'
              ? metadata.confidence
              : undefined,
          retryCount:
            typeof metadata.retryCount === 'number'
              ? metadata.retryCount
              : undefined,
          retrievalSufficient:
            typeof metadata.retrievalSufficient === 'boolean'
              ? metadata.retrievalSufficient
              : undefined,
          retrievalReason:
            typeof metadata.retrievalReason === 'string'
              ? metadata.retrievalReason
              : undefined,
          references: Array.isArray(metadata.references)
            ? (metadata.references as ReferenceChunk[])
            : undefined,
          runState: isRecord(metadata.runState)
            ? (metadata.runState as RunStateView)
            : undefined,
          events,
        };
      });
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

  const handlePlayTts = async (messageId: string, text: string) => {
    const content = text.trim();
    if (!content) return;

    ttsRef.current?.close();
    setTtsStatusByMessageId({});
    setTtsStatus(messageId, 'connecting');
    const chunks: BlobPart[] = [];
    let ws: WebSocket;
    try {
      ws = await createTtsWebSocket(content.slice(0, 800));
    } catch {
      setTtsStatus(messageId, 'error');
      return;
    }
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
    const hasReadyAttachment = attachments.some(
      (item) => item.status === 'ready',
    );
    const query =
      input.trim() || (hasReadyAttachment ? '请基于当前会话附件回答。' : '');
    if (!query || loading || attachmentUploading) return;

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
        animate: true,
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
      attachments
        .filter((item) => item.status === 'ready')
        .map((item) => item.id),
    ).then((controller) => {
      abortRef.current = controller;
    });
  };

  const handleAttachmentSelection = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!files.length) return;
    if (attachments.length + files.length > 5) {
      antdMessage.error('一个会话最多上传 5 个附件');
      return;
    }

    let activeThreadId = threadIdRef.current;
    if (!activeThreadId) {
      activeThreadId = window.crypto.randomUUID();
      threadIdRef.current = activeThreadId;
      setThreadId(activeThreadId);
    }

    setAttachmentUploading(true);
    for (const file of files) {
      const localId = `uploading-${window.crypto.randomUUID()}`;
      setAttachments((current) => [
        ...current,
        {
          id: localId,
          filename: file.name,
          mimeType: file.type,
          size: file.size,
          content: '',
          truncated: false,
          createdAt: new Date().toISOString(),
          status: 'uploading',
        },
      ]);
      try {
        const result = await uploadConversationAttachment(file, activeThreadId);
        setAttachments((current) =>
          current.map((item) =>
            item.id === localId ? { ...result.data, status: 'ready' } : item,
          ),
        );
        if (result.data.truncated) {
          antdMessage.warning(`${file.name} 内容较长，超出部分未加入会话`);
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : `${file.name} 解析失败`;
        setAttachments((current) =>
          current.map((item) =>
            item.id === localId
              ? { ...item, status: 'error', errorMessage }
              : item,
          ),
        );
        antdMessage.error(`${file.name}：${errorMessage}`);
      }
    }
    setAttachmentUploading(false);
  };

  const handleRemoveAttachment = async (attachment: ConversationAttachment) => {
    if (attachment.status === 'uploading') return;
    if (attachment.status === 'ready' && threadIdRef.current) {
      try {
        await deleteConversationAttachment(attachment.id, threadIdRef.current);
      } catch (error) {
        antdMessage.error(
          error instanceof Error ? error.message : '移除附件失败',
        );
        return;
      }
    }
    setAttachments((current) =>
      current.filter((item) => item.id !== attachment.id),
    );
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
      if (isRecord(event.data?.runState)) {
        updateMessage(messageId, (message) => ({
          ...message,
          runState: event.data?.runState as RunStateView,
        }));
      }
      return;
    }

    if (event.type === 'TEXT_MESSAGE_CONTENT') {
      const delta =
        typeof event.data?.delta === 'string' ? event.data.delta : '';
      if (delta.length === 0) return;
      // 关键：流式 token 是未通过最终引用门禁的草稿，只累计在隐藏字段。
      // 页面在 RUN_FINISHED 之前不展示它，避免用户先看到草稿再被替换。
      updateMessage(messageId, (message) => ({
        ...message,
        streamingDraft: (message.streamingDraft ?? '') + delta,
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
        // 结束事件可能只携带元数据或空 answer；不能覆盖已经通过
        // TEXT_MESSAGE_CONTENT 流式拼接出来的正文。
        const outputAnswer =
          typeof output.answer === 'string' && output.answer.trim()
            ? output.answer
            : undefined;
        updateMessage(messageId, (message) => ({
          ...message,
          content: outputAnswer ?? message.streamingDraft ?? message.content,
          streamingDraft: undefined,
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
          runState: isRecord(output.runState)
            ? (output.runState as RunStateView)
            : message.runState,
          status: 'done',
        }));
      } else {
        updateMessage(messageId, (message) => ({
          ...message,
          content: message.streamingDraft ?? message.content,
          streamingDraft: undefined,
          status: 'done',
        }));
      }
      return;
    }

    if (event.type === 'RUN_ERROR') {
      updateMessage(messageId, (message) => ({
        ...message,
        content: `错误：${String(event.data?.message ?? '流式问答失败')}`,
        streamingDraft: undefined,
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
    if (name === 'rag.answer_replace' && typeof value === 'string') {
      updateMessage(messageId, (message) => ({
        ...message,
        streamingDraft: value,
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
    value === 'qwen' || value === 'deepseek' || value === 'zhipu';

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

  return {
    PAGE_SIZE,
    activeRolePreset,
    activeTitle,
    artifactDrawerOpen,
    artifactForm,
    artifactKindLabel,
    artifactLoading,
    artifactModalOpen,
    artifactSubmitting,
    artifacts,
    attachmentInputRef,
    attachmentUploading,
    attachments,
    availableQaPlugins,
    badCaseForm,
    badCaseMessage,
    badCaseSubmitting,
    chatBodyRef,
    convPage,
    conversations,
    formatTime,
    getTtsButtonText,
    handleAttachmentSelection,
    handleClearConversation,
    handleCreateArtifact,
    handleCreateShare,
    handleNewConversation,
    handlePlayTts,
    handleRemoveAttachment,
    handleRolePresetChange,
    handleSelectConversation,
    handleSend,
    input,
    loading,
    messages,
    mode,
    model,
    modelOptions,
    openArtifactModal,
    pluginKeys,
    rolePresetId,
    rolePresets,
    rolePresetsLoading,
    selectedArtifact,
    setActiveTitle,
    setArtifactDrawerOpen,
    setArtifactModalOpen,
    setAttachments,
    setBadCaseMessage,
    setBadCaseSubmitting,
    setConvPage,
    setConversations,
    setInput,
    setMessages,
    setModel,
    setPluginKeys,
    setSelectedArtifact,
    setShareModalOpen,
    setThreadId,
    shareForm,
    shareModalOpen,
    sidebarLoading,
    threadId,
    threadIdRef,
    ttsStatusByMessageId,
  };
}

export type QaOpsController = ReturnType<typeof useQaOpsController>;
