import { authRequest } from '@/services/rag-admin/api';

export interface ImageSearchMeta {
  sourceDocumentId?: string;
  sourceDocId?: string;
  filename?: string;
  description?: string;
  placement?: string;
  pageNumber?: number;
  slideNumber?: number;
  assetIndex?: number;
  assetKey?: string;
  [key: string]: unknown;
}

export interface ImageSearchResult {
  docId: string;
  url: string;
  score: number;
  meta?: ImageSearchMeta;
}

export interface ImageSearchResponse {
  query: string;
  limit: number;
  reason: string | null;
  results: ImageSearchResult[];
}

export function searchImageAssets(query: string, limit = 20) {
  return authRequest<ImageSearchResponse>('/api/admin/images/search', {
    params: { q: query, limit },
  });
}

export function searchImageAssetsByImage(file: File, limit = 20) {
  const data = new FormData();
  data.append('file', file);
  data.append('limit', String(limit));
  return authRequest<ImageSearchResponse>('/api/admin/images/search', {
    method: 'POST',
    data,
  });
}

export async function loadImageAssetPreview(assetUrl: string) {
  if (!assetUrl.startsWith('/api/admin/images/asset?')) {
    throw new Error('图片预览地址无效');
  }
  const token = localStorage.getItem('access_token');
  const response = await fetch(assetUrl, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) throw new Error(`图片读取失败（HTTP ${response.status}）`);
  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) throw new Error('服务端未返回图片资源');
  return URL.createObjectURL(blob);
}
