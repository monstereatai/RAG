import { authRequest } from '@/services/rag-admin/api';

export interface MemoryItem {
  memory: string;
  hash?: string;
  category?: string;
  createdAt?: string;
  score?: number;
}

export interface MemoriesResponse {
  enabled: boolean;
  memories: MemoryItem[];
}

/** 获取当前用户的所有长期记忆 */
export async function getMemories(): Promise<MemoriesResponse> {
  return authRequest<MemoriesResponse>('/api/admin/account/memories', { method: 'GET' });
}

/** 清空当前用户的所有长期记忆 */
export async function clearMemories(): Promise<void> {
  return authRequest('/api/admin/account/memories', { method: 'DELETE' });
}
