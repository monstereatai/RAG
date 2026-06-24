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

export async function streamAguiAnswer(
  query: string,
  mode: ChatMode,
  onEvent: (event: AguiEvent) => void,
  onError: (error: Error) => void,
  onClose: () => void,
): Promise<AbortController> {
  const controller = new AbortController();
  const token = localStorage.getItem('access_token');
  const url = `/api/admin/qa-ops/agui/stream?query=${encodeURIComponent(query)}&mode=${mode}`;

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
