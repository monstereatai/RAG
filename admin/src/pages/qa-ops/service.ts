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
