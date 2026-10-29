import { authRequest } from '@/services/rag-admin/api';

export interface ApiTokenView {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  expiresAt?: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

export async function listApiTokens() {
  return authRequest('/api/admin/config/api-tokens');
}

export async function createApiToken(data: { name: string; scopes?: string[]; expiresAt?: string }) {
  return authRequest('/api/admin/config/api-tokens', {
    method: 'POST',
    data,
  });
}

export async function revokeApiToken(id: string) {
  return authRequest(`/api/admin/config/api-tokens/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
