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

export function streamAguiAnswer(
  query: string,
  mode: ChatMode,
  onEvent: (event: AguiEvent) => void,
  onError: (error: Error) => void,
  onClose: () => void,
) {
  const token = localStorage.getItem('access_token');
  const tokenParam = token ? `&token=${encodeURIComponent(token)}` : '';
  const url = `/api/admin/qa-ops/agui/stream?query=${encodeURIComponent(query)}&mode=${mode}${tokenParam}`;
  const eventSource = new EventSource(url);
  let closedByProtocol = false;

  eventSource.onmessage = (event) => {
    try {
      const aguiEvent = JSON.parse(event.data) as AguiEvent;
      onEvent(aguiEvent);
      if (
        aguiEvent.type === 'RUN_FINISHED' ||
        aguiEvent.type === 'RUN_ERROR'
      ) {
        closedByProtocol = true;
        eventSource.close();
        onClose();
      }
    } catch {
      // Ignore malformed SSE frames.
    }
  };

  eventSource.onerror = () => {
    if (closedByProtocol) return;
    eventSource.close();
    onError(
      new Error(
        'AG-UI 流式连接失败，请确认 admin-backend 已启动并可通过 /api/admin/qa-ops/agui/stream 访问。',
      ),
    );
  };

  return eventSource;
}
