import axios from 'axios';
import type {
  ApiResponse,
  UploadResponse,
  DocumentItem,
  ChatResponse,
  ChatMode,
  DebugResponse,
  LoginResponse,
  UserInfo,
} from './types';

const api = axios.create({
  baseURL: '/api',
  timeout: 120000, // agentic 模式可能较慢
});

// Add request interceptor to attach JWT token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
}, (error) => {
  return Promise.reject(error);
});

// 文档上传
export async function uploadDocument(file: File): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await api.post<ApiResponse<UploadResponse>>('/documents/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data.data;
}

// 文档列表
export async function listDocuments(): Promise<DocumentItem[]> {
  const res = await api.get<ApiResponse<DocumentItem[]>>('/documents');
  return res.data.data;
}

// 删除文档
export async function deleteDocument(docId: string): Promise<void> {
  await api.delete(`/documents/${docId}`);
}

// 聊天（非流式）
export async function chat(query: string, mode: ChatMode): Promise<ChatResponse> {
  const res = await api.post<ApiResponse<ChatResponse>>('/chat', { query, mode });
  return res.data.data;
}

// Debug chunks
export async function debugChunks(query: string): Promise<DebugResponse> {
  const res = await api.get<ApiResponse<DebugResponse>>('/debug/chunks', {
    params: { query },
  });
  return res.data.data;
}

// SSE 流式聊天
export function chatStream(
  query: string,
  mode: ChatMode,
  onEvent: (event: { type: string; data: unknown }) => void,
  onError: (err: Error) => void,
  onClose: () => void,
): void {
  const token = localStorage.getItem('token');
  const tokenParam = token ? `&token=${encodeURIComponent(token)}` : '';
  const url = `/api/chat/stream?query=${encodeURIComponent(query)}&mode=${mode}${tokenParam}`;
  const eventSource = new EventSource(url);

  eventSource.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data);
      onEvent(event);
    } catch {
      // 忽略解析失败的事件
    }
  };

  eventSource.onerror = () => {
    onError(new Error('SSE connection error'));
    eventSource.close();
  };

  eventSource.addEventListener('close', () => {
    eventSource.close();
    onClose();
  });
}

// 认证：登录
export async function login(username: string, password: string): Promise<LoginResponse> {
  const res = await api.post<ApiResponse<LoginResponse>>('/auth/login', { username, password });
  return res.data.data;
}

// 认证：获取当前用户信息
export async function getProfile(): Promise<UserInfo> {
  const res = await api.get<ApiResponse<UserInfo>>('/auth/profile');
  return res.data.data;
}
