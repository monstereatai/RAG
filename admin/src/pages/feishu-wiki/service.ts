import { authRequest } from '@/services/rag-admin/api';

export interface FeishuWikiSyncResult {
  connectorId: string;
  spaceId: string;
  status: string;
  discovered: number;
  imported: number;
  updated: number;
  unchanged: number;
  skippedUnsupported: number;
  deactivated: number;
}

export interface FeishuWikiStatus {
  connectorId: string;
  spaceId: string;
  status: string;
  lastSyncAt: string | null;
  lastError: string | null;
  activeItems: number;
  inactiveItems: number;
  shareWithinTenant: boolean;
}

export async function syncFeishuWiki(spaceId: string, shareWithinTenant?: boolean) {
  return authRequest<FeishuWikiSyncResult>('/api/admin/integrations/feishu/wiki/sync', {
    method: 'POST',
    data: { spaceId, shareWithinTenant },
  });
}

export async function getFeishuWikiStatus(spaceId: string) {
  return authRequest<FeishuWikiStatus>('/api/admin/integrations/feishu/wiki/status', {
    params: { spaceId },
  });
}
