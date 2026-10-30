import { RagClientOperationsBase } from './rag-client-operations';
import type { RagArtifactCreateInput } from './rag-client.types';

export abstract class RagClientArtifactsBase extends RagClientOperationsBase {
  createArtifact(body: RagArtifactCreateInput) {
    return this.postJson<Record<string, unknown>>("/rag/admin/artifacts", {
      ...body,
      ownerUserId: this.mapAdminUserId(body.ownerUserId),
    });
  }

  listArtifacts(ownerUserId: string, threadId?: string) {
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/artifacts${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId), threadId })}`
    );
  }

  getArtifact(id: string, ownerUserId: string) {
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/artifacts/${encodeURIComponent(id)}${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`
    );
  }

  downloadArtifact(id: string, ownerUserId: string) {
    return this.requestRaw(
      `/rag/admin/artifacts/${encodeURIComponent(id)}/download${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`,
      true
    );
  }

  createArtifactShare(id: string, ownerUserId: string, body: unknown) {
    return this.postJson<Record<string, unknown>>(
      `/rag/admin/artifacts/${encodeURIComponent(id)}/shares${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`,
      this.mapAdminActorField(body, "createdBy")
    );
  }

  listArtifactShares(id: string, ownerUserId: string) {
    return this.getJson<Record<string, unknown>>(
      `/rag/admin/artifacts/${encodeURIComponent(id)}/shares${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`
    );
  }

  revokeArtifactShare(id: string, shareId: string, ownerUserId: string) {
    return this.postJson<Record<string, unknown>>(
      `/rag/admin/artifacts/${encodeURIComponent(id)}/shares/${encodeURIComponent(shareId)}/revoke${this.toQueryString({ ownerUserId: this.mapAdminUserId(ownerUserId) })}`,
      {}
    );
  }

  getInternalArtifactShare(token: string, actorUserId: string) {
    return this.request<Record<string, unknown>>(
      `/rag/admin/artifacts/shared/${encodeURIComponent(token)}/internal`,
      { method: "GET", headers: { "x-actor-user-id": this.mapAdminUserId(actorUserId) ?? actorUserId } }
    );
  }

  downloadInternalArtifactShare(token: string, actorUserId: string) {
    return this.requestRaw(
      `/rag/admin/artifacts/shared/${encodeURIComponent(token)}/internal/download`,
      true,
      { "x-actor-user-id": this.mapAdminUserId(actorUserId) ?? actorUserId }
    );
  }

  getExternalArtifactShare(token: string) {
    return this.request<Record<string, unknown>>(
      `/artifacts/shared/${encodeURIComponent(token)}`,
      { method: "GET" },
      false
    );
  }

  downloadExternalArtifactShare(token: string) {
    return this.requestRaw(
      `/artifacts/shared/${encodeURIComponent(token)}/download`,
      false
    );
  }

  previewExternalArtifactShare(token: string) {
    return this.requestRaw(
      `/artifacts/shared/${encodeURIComponent(token)}/preview`,
      false
    );
  }
}
