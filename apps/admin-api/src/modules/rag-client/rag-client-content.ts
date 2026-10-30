import { RagClientCoreBase } from './rag-client-core';

export abstract class RagClientContentBase extends RagClientCoreBase {
  listApiTokens() {
    return this.getJson<Record<string, unknown>>("/auth/api-tokens");
  }

  createApiToken(body: unknown) {
    return this.postJson<Record<string, unknown>>("/auth/api-tokens", body);
  }

  revokeApiToken(id: string) {
    return this.deleteJson<Record<string, unknown>>(
      `/auth/api-tokens/${encodeURIComponent(id)}`
    );
  }

  issueSpeechTicket(ownerUserId: string, ownerRole: 'admin' | 'user') {
    return this.postJson<Record<string, unknown>>('/auth/internal/speech-ticket', {
      ownerUserId: this.mapAdminUserId(ownerUserId),
      ownerRole,
    });
  }

  getCapabilities() {
    return this.getJson<Record<string, unknown>>("/rag/admin/capabilities");
  }

  searchImages(userId: string, tenantId: string | undefined, role: string | undefined, query: string, limit = 20) {
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/images/search${this.toQueryString({ userId: this.mapAdminUserId(userId), tenantId, role, q: query, limit })}`,
    );
  }

  searchImagesByImage(
    userId: string,
    tenantId: string | undefined,
    role: string | undefined,
    file: Express.Multer.File,
    limit = 20,
  ) {
    const formData = new FormData();
    const imageBytes = new Uint8Array(file.buffer.byteLength);
    imageBytes.set(file.buffer);
    formData.append(
      'file',
      new Blob([imageBytes.buffer], { type: file.mimetype }),
      file.originalname,
    );
    formData.append('userId', this.mapAdminUserId(userId) ?? userId);
    if (tenantId) formData.append('tenantId', tenantId);
    if (role) formData.append('role', role);
    formData.append('limit', String(limit));
    return this.request<Record<string, unknown>>(
      '/rag/admin/images/search',
      { method: 'POST', body: formData },
      true,
      60_000,
    );
  }

  getImageAsset(
    userId: string,
    tenantId: string | undefined,
    role: string | undefined,
    docId: string,
    key: string,
  ) {
    return this.requestRaw(
      `/rag/admin/images/asset${this.toQueryString({ userId: this.mapAdminUserId(userId), tenantId, role, docId, key })}`,
      true,
    );
  }

  listTeamWikiPages(ownerUserId: string, query?: string, limit = 100) {
    return this.getJson<Record<string, unknown>[]>(
      `/rag/admin/team-wiki/pages${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId), q: query, limit })}`,
    );
  }

  getTeamWikiPage(ownerUserId: string, pageId: string) {
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/team-wiki/pages/${encodeURIComponent(pageId)}${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`,
    );
  }

  createTeamWikiPage(ownerUserId: string, body: unknown) {
    return this.postJson<Record<string, unknown>>(
      `/rag/admin/team-wiki/pages${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`,
      body,
    );
  }

  updateTeamWikiPage(ownerUserId: string, pageId: string, body: unknown) {
    return this.patchJson<Record<string, unknown>>(
      `/rag/admin/team-wiki/pages/${encodeURIComponent(pageId)}${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`,
      body,
    );
  }

  deleteTeamWikiPage(ownerUserId: string, pageId: string) {
    return this.deleteJson<Record<string, unknown>>(
      `/rag/admin/team-wiki/pages/${encodeURIComponent(pageId)}${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`,
    );
  }

  getTeamWikiRevisions(ownerUserId: string, pageId: string) {
    return this.getJson<Record<string, unknown>[]>(
      `/rag/admin/team-wiki/pages/${encodeURIComponent(pageId)}/revisions${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`,
    );
  }

  compareTeamWikiRevisions(
    ownerUserId: string,
    pageId: string,
    fromRevisionId: string,
    toRevisionId: string,
  ) {
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/team-wiki/pages/${encodeURIComponent(pageId)}/compare${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId), from: fromRevisionId, to: toRevisionId })}`,
    );
  }

  rollbackTeamWikiPage(ownerUserId: string, pageId: string, body: unknown) {
    return this.postJson<Record<string, unknown>>(
      `/rag/admin/team-wiki/pages/${encodeURIComponent(pageId)}/rollback${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`,
      body,
    );
  }

  publishTeamWikiPage(ownerUserId: string, pageId: string) {
    return this.postJson<Record<string, unknown>>(
      `/rag/admin/team-wiki/pages/${encodeURIComponent(pageId)}/publish${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`,
      {},
    );
  }

  syncFeishuWiki(ownerUserId: string, spaceId: string, shareWithinTenant?: boolean) {
    return this.postJson<Record<string, unknown>>(
      `/rag/admin/integrations/feishu/wiki/sync${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`,
      { spaceId, shareWithinTenant },
    );
  }

  getFeishuWikiStatus(ownerUserId: string, spaceId: string) {
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/integrations/feishu/wiki/status${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId), spaceId })}`,
    );
  }

  getRolePresets() {
    return this.getJson<Record<string, unknown>>("/rag/admin/role-presets");
  }

  /** 以服务身份查询指定已登录用户的长期记忆；ownerUserId 由网关从 JWT 解析，不信任浏览器传值。 */
  getUserMemories(ownerUserId: string) {
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/memories${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`,
    );
  }

  /** 清空操作与读取走同一服务边界，避免 Admin JWT 与 RAG JWT 密钥不一致导致 401。 */
  clearUserMemories(ownerUserId: string) {
    return this.deleteJson<Record<string, unknown>>(
      `/rag/admin/memories${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`,
    );
  }
}
