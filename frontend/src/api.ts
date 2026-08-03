import axios from 'axios';
import type {
  ApiResponse,
  UploadResponse,
  DocumentItem,
  ChatResponse,
  ChatMode,
  AguiEvent,
  DebugResponse,
  LoginResponse,
  UserInfo,
  RolePresetCatalog,
} from './types';

const api = axios.create({
  baseURL: '/api/v1',
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
export async function getRolePresets(): Promise<RolePresetCatalog> {
  const res = await api.get<ApiResponse<RolePresetCatalog>>('/chat/role-presets');
  return res.data.data;
}

export async function chat(
  query: string,
  mode: ChatMode,
  rolePresetId: string,
): Promise<ChatResponse> {
  const res = await api.post<ApiResponse<ChatResponse>>('/chat', {
    query,
    mode,
    rolePresetId,
  });
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
  rolePresetId: string,
  onEvent: (event: { type: string; data: unknown }) => void,
  onError: (err: Error) => void,
  onClose: () => void,
): void {
  const token = localStorage.getItem('token');
  const tokenParam = token ? `&token=${encodeURIComponent(token)}` : '';
  const roleParam = `&rolePresetId=${encodeURIComponent(rolePresetId)}`;
  const url = `/api/v1/chat/stream?query=${encodeURIComponent(query)}&mode=${mode}${roleParam}${tokenParam}`;
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

// AG-UI 协议流式聊天
export function aguiStream(
  query: string,
  mode: ChatMode,
  rolePresetId: string,
  onEvent: (event: AguiEvent) => void,
  onError: (err: Error) => void,
  onClose: () => void,
): void {
  const token = localStorage.getItem('token');
  const tokenParam = token ? `&token=${encodeURIComponent(token)}` : '';
  const roleParam = `&rolePresetId=${encodeURIComponent(rolePresetId)}`;
  const url = `/api/v1/agui/stream?query=${encodeURIComponent(query)}&mode=${mode}${roleParam}${tokenParam}`;
  const eventSource = new EventSource(url);
  let finished = false;

  eventSource.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data) as AguiEvent;
      onEvent(event);
      if (event.type === 'RUN_FINISHED' || event.type === 'RUN_ERROR') {
        finished = true;
        eventSource.close();
        onClose();
      }
    } catch {
      // 忽略解析失败的事件
    }
  };

  eventSource.onerror = () => {
    if (finished) return;
    onError(new Error('AG-UI SSE connection error'));
    eventSource.close();
  };
}

// TTS SSE：接收 base64 音频块，完成后返回可播放 Blob
export function synthesizeSpeechStream(
  text: string,
  onChunk?: (receivedChunks: number) => void,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const token = localStorage.getItem('token');
    const tokenParam = token ? `&token=${encodeURIComponent(token)}` : '';
    const url = `/api/v1/speech/tts/stream?text=${encodeURIComponent(text)}${tokenParam}`;
    const eventSource = new EventSource(url);
    const chunks: ArrayBuffer[] = [];
    let contentType = 'audio/wav';
    let settled = false;

    const cleanup = () => {
      eventSource.close();
    };

    const settleReject = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const appendBase64Chunk = (base64: string) => {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      chunks.push(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      onChunk?.(chunks.length);
    };

    eventSource.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as {
          type: string;
          data?: {
            contentType?: string;
            chunk?: string;
            message?: string;
          };
        };

        if (event.type === 'meta' && event.data?.contentType) {
          contentType = event.data.contentType;
          return;
        }

        if (event.type === 'chunk' && event.data?.chunk) {
          appendBase64Chunk(event.data.chunk);
          return;
        }

        if (event.type === 'done') {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(new Blob(chunks, { type: contentType }));
          return;
        }

        if (event.type === 'error') {
          settleReject(new Error(event.data?.message ?? 'TTS synthesis failed'));
        }
      } catch (err) {
        settleReject(err instanceof Error ? err : new Error(String(err)));
      }
    };

    eventSource.onerror = () => {
      settleReject(new Error('TTS SSE connection error'));
    };
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
