import { authRequest } from '@/services/rag-admin/api';

export interface QaRecord {
  id: string;
  question: string;
  answer: string;
  mode: string;
  confidence: number;
  sourcesCount: number;
  userId: string;
  createdAt: string;
  feedback?: 'positive' | 'negative' | null;
}

export type ChatMode = 'simple' | 'agentic' | 'auto';
export type ChatModel = 'qwen' | 'deepseek';

export interface RolePreset {
  id: string;
  name: string;
  shortName: string;
  summary: string;
  responsibilities: string[];
  starterTasks: string[];
  suggestedQuestions: string[];
}

export interface RolePresetCatalog {
  defaultRolePresetId: string;
  roles: RolePreset[];
}

export type ArtifactKind =
  | 'markdown'
  | 'word'
  | 'excel'
  | 'architecture'
  | 'image';

export interface GeneratedArtifact {
  id: string;
  threadId?: string | null;
  title: string;
  kind: ArtifactKind;
  status: 'queued' | 'generating' | 'ready' | 'failed';
  filename: string;
  contentType?: string | null;
  size: number;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactShare {
  id: string;
  artifactId: string;
  visibility: 'internal' | 'external';
  token?: string;
  expiresAt?: string | null;
  maxDownloads?: number | null;
  downloadCount: number;
  revokedAt?: string | null;
}

const QA_MODEL_CONFIG_KEY = 'qa_ops_model_config';

export interface QaModelOption {
  key: ChatModel;
  label: string;
  provider: string;
  defaultModel: string;
  baseUrl: string;
  apiKeyEnv: string;
  timeoutEnv: string;
  description: string;
}

export interface QaModelConfig {
  defaultModel: ChatModel;
  enabledModels: ChatModel[];
}

export const qaModelOptions: QaModelOption[] = [
  {
    key: 'qwen',
    label: '通义千问',
    provider: 'DashScope OpenAI Compatible',
    defaultModel: 'qwen-plus',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKeyEnv: 'QWEN_API_KEY',
    timeoutEnv: 'QWEN_TIMEOUT_MS',
    description: '默认问答模型，适合中文企业知识库问答。',
  },
  {
    key: 'deepseek',
    label: 'DeepSeek',
    provider: 'DeepSeek OpenAI Compatible',
    defaultModel: 'deepseek-v4-flash',
    baseUrl: 'https://api.deepseek.com',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    timeoutEnv: 'DEEPSEEK_TIMEOUT_MS',
    description: '可选问答模型，适合在后台按需切换对比回答效果。',
  },
];

export const defaultQaModelConfig: QaModelConfig = {
  defaultModel: 'qwen',
  enabledModels: ['qwen', 'deepseek'],
};

export function getQaModelConfig(): QaModelConfig {
  if (typeof window === 'undefined') return defaultQaModelConfig;
  const raw = window.localStorage.getItem(QA_MODEL_CONFIG_KEY);
  if (!raw) return defaultQaModelConfig;

  try {
    const parsed = JSON.parse(raw) as Partial<QaModelConfig>;
    const enabledModels = Array.isArray(parsed.enabledModels)
      ? parsed.enabledModels.filter(isChatModel)
      : defaultQaModelConfig.enabledModels;
    const defaultModel = isChatModel(parsed.defaultModel)
      ? parsed.defaultModel
      : defaultQaModelConfig.defaultModel;
    return {
      defaultModel: enabledModels.includes(defaultModel)
        ? defaultModel
        : enabledModels[0] ?? 'qwen',
      enabledModels: enabledModels.length
        ? enabledModels
        : defaultQaModelConfig.enabledModels,
    };
  } catch {
    return defaultQaModelConfig;
  }
}

export function saveQaModelConfig(config: QaModelConfig): QaModelConfig {
  const enabledModels = config.enabledModels.filter(isChatModel);
  const normalized: QaModelConfig = {
    defaultModel: enabledModels.includes(config.defaultModel)
      ? config.defaultModel
      : enabledModels[0] ?? 'qwen',
    enabledModels: enabledModels.length
      ? enabledModels
      : defaultQaModelConfig.enabledModels,
  };
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(QA_MODEL_CONFIG_KEY, JSON.stringify(normalized));
  }
  return normalized;
}

export function getEnabledQaModelOptions(config = getQaModelConfig()) {
  return qaModelOptions.filter((item) => config.enabledModels.includes(item.key));
}

function isChatModel(value: unknown): value is ChatModel {
  return value === 'qwen' || value === 'deepseek';
}

export interface ReferenceChunk {
  id: string;
  content: string;
  docId: string;
  chunkIndex: number;
  totalScore?: number;
  bm25Score?: number;
  cosineScore?: number;
}

export type AguiEventType =
  | 'RUN_STARTED'
  | 'RUN_FINISHED'
  | 'RUN_ERROR'
  | 'TEXT_MESSAGE_START'
  | 'TEXT_MESSAGE_CONTENT'
  | 'TEXT_MESSAGE_END'
  | 'TOOL_CALL_START'
  | 'TOOL_CALL_ARGS'
  | 'TOOL_CALL_END'
  | 'STATE_DELTA'
  | 'CUSTOM';

export interface AguiEvent {
  type: AguiEventType;
  runId: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

/* ───── 会话管理（聊天记录持久化） ───── */

export interface ConversationSummary {
  threadId: string;
  title: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationMessage {
  role: 'human' | 'ai';
  content: string;
  createdAt: string;
}

export interface ConversationDetail {
  threadId: string;
  title: string;
  messages: ConversationMessage[];
  createdAt: string;
  updatedAt: string;
}

/** 获取会话列表 */
export async function getConversations() {
  return authRequest<{ data: ConversationSummary[] }>(
    '/api/admin/qa-ops/conversations',
  );
}

/** 获取单个会话的消息 */
export async function getConversation(threadId: string) {
  return authRequest<{ data: ConversationDetail }>(
    `/api/admin/qa-ops/conversations/${threadId}`,
  );
}

export async function submitConversationBadCase(
  threadId: string,
  body: {
    errorType: string;
    comment?: string;
    correctedAnswer: string;
    includeInRegression: boolean;
  },
) {
  return authRequest(`/api/admin/qa-ops/conversations/${threadId}/bad-case`, {
    method: 'POST',
    data: body,
  });
}

/** 删除会话 */
export async function deleteConversation(threadId: string) {
  return authRequest<{ success: boolean }>(
    `/api/admin/qa-ops/conversations/${threadId}`,
    { method: 'DELETE' },
  );
}

export async function getRolePresets() {
  return authRequest<{ data: RolePresetCatalog }>(
    '/api/admin/qa-ops/role-presets',
  );
}

export async function createArtifact(input: {
  threadId?: string;
  title: string;
  kind: ArtifactKind;
  sourceText: string;
  prompt?: string;
}) {
  return authRequest<{ data: GeneratedArtifact; available: boolean; error?: string }>(
    '/api/admin/qa-ops/artifacts',
    { method: 'POST', data: input },
  );
}

export async function getArtifacts(threadId?: string) {
  return authRequest<{ data: GeneratedArtifact[]; available: boolean; error?: string }>(
    '/api/admin/qa-ops/artifacts',
    { params: threadId ? { threadId } : undefined },
  );
}

export async function downloadArtifact(id: string, filename: string) {
  const token = localStorage.getItem('access_token');
  const response = await fetch(
    `/api/admin/qa-ops/artifacts/${encodeURIComponent(id)}/download`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  );
  if (!response.ok) throw new Error(`下载失败（HTTP ${response.status}）`);
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function createArtifactShare(
  id: string,
  input: {
    visibility: 'internal' | 'external';
    expiresInHours?: number;
    maxDownloads?: number;
  },
) {
  return authRequest<{ data: ArtifactShare; available: boolean; error?: string }>(
    `/api/admin/qa-ops/artifacts/${encodeURIComponent(id)}/shares`,
    { method: 'POST', data: input },
  );
}

export async function getQaRecords(params?: {
  current?: number;
  pageSize?: number;
  question?: string;
  mode?: string;
  feedback?: string;
}) {
  return authRequest<{ data: QaRecord[]; total: number }>(
    '/api/admin/qa-ops/records',
    { params },
  );
}

export async function getQaStats() {
  return authRequest<{
    data: {
      totalQa: number;
      avgConfidence: number;
      positiveRate: number;
      negativeRate: number;
    };
  }>('/api/admin/qa-ops/stats');
}

export async function updateQaFeedback(id: string, feedback: string) {
  return authRequest(`/api/admin/qa-ops/records/${id}/feedback`, {
    method: 'PATCH',
    data: { feedback },
  });
}

export async function getQaPlugins() {
  return authRequest<{ data: Array<{ key: string; displayName?: string; status: string; modes?: string[] }> }>(
    '/api/admin/qa-ops/plugins',
  );
}

export async function streamAguiAnswer(
  query: string,
  mode: ChatMode,
  model: ChatModel,
  onEvent: (event: AguiEvent) => void,
  onError: (error: Error) => void,
  onClose: () => void,
  threadId?: string,
  rolePresetId?: string,
  pluginKeys?: string[],
): Promise<AbortController> {
  const controller = new AbortController();
  const token = localStorage.getItem('access_token');
  let url = `/api/admin/qa-ops/agui/stream?query=${encodeURIComponent(query)}&mode=${mode}&model=${model}`;
  if (threadId) {
    url += `&threadId=${encodeURIComponent(threadId)}`;
  }
  if (rolePresetId) {
    url += `&rolePresetId=${encodeURIComponent(rolePresetId)}`;
  }
  if (pluginKeys?.length) {
    url += `&pluginKeys=${encodeURIComponent(pluginKeys.join(','))}`;
  }

  (async () => {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const status = response.status;
        let message: string;
        if (status === 401) {
          message = '登录已过期或 token 无效，请重新登录。';
        } else if (status === 403) {
          message = '无权访问此功能，请联系管理员。';
        } else if (status === 502 || status === 503) {
          message = '后台服务暂不可用（502/503），请稍后重试。';
        } else {
          message = `请求失败（HTTP ${status}），请检查 admin-backend 是否正常启动。`;
        }
        onError(new Error(message));
        onClose();
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        onError(new Error('流式响应体不可读'));
        onClose();
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split(/\r?\n\r?\n/);
        buffer = parts.pop() ?? '';

        for (const part of parts) {
          if (handleSseFrame(part, onEvent)) {
            onClose();
            return;
          }
        }
      }

      if (buffer.trim() && handleSseFrame(buffer, onEvent)) {
        onClose();
        return;
      }

      onClose();
    } catch (error) {
      if (controller.signal.aborted) {
        onClose();
        return;
      }
      const errMsg =
        error instanceof TypeError && error.message.includes('fetch')
          ? '网络异常，无法连接到 admin-backend（fetch failed）。'
          : error instanceof Error
            ? error.message
            : '流式问答连接异常';
      onError(new Error(errMsg));
      onClose();
    }
  })();

  return controller;
}

export function createTtsWebSocket(text: string): WebSocket {
  const configured = process.env.REACT_APP_RAG_WS_BASE_URL;
  const fallback =
    typeof window !== 'undefined' && window.location.protocol === 'https:'
      ? `wss://${window.location.hostname}:3000`
      : `ws://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:3000`;
  const baseUrl = (configured || fallback).replace(/\/$/, '');
  const url = new URL(`${baseUrl}/api/v1/speech/tts/ws`);
  url.searchParams.set('text', text);
  return new WebSocket(url.toString());
}

function handleSseFrame(
  frame: string,
  onEvent: (event: AguiEvent) => void,
): boolean {
  const data = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trimStart())
    .join('\n');

  if (!data) return false;

  try {
    const aguiEvent = JSON.parse(data) as AguiEvent;
    onEvent(aguiEvent);
    return aguiEvent.type === 'RUN_FINISHED' || aguiEvent.type === 'RUN_ERROR';
  } catch {
    return false;
  }
}
