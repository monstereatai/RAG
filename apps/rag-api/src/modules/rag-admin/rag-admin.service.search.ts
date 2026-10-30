import type { RagAdminServiceContext } from './rag-admin.service.context';
import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { In } from 'typeorm';
import { DocumentMetaEntity } from '../../providers/db/entities/document-meta.entity';
import type { DocumentSearchFilters } from './rag-admin.service.types';
import { imageAssetContentType } from './rag-admin.service.shared';

export class RagAdminSearchWorkflow {
  constructor(private readonly context: RagAdminServiceContext) {}

  async inspectRetrieval(
    query: string,
    userId: string,
    tenantId: string,
    limit = 50,
  ) {
    if (!query?.trim()) throw new BadRequestException('query is required');
    const result = await this.context.ragService.retrieveDetailed(
      query.trim(),
      { tenantId, roles: ['admin'], trustedAdminPrincipal: true },
      userId,
    );
    const candidates = result.diagnostics.candidates;
    const cap = Math.min(Math.max(limit, 1), 50);
    return {
      query: query.trim(),
      profile: result.profile,
      vectorSource: result.vectorSource,
      rerankApplied: result.rerankApplied ?? false,
      diagnostics: result.diagnostics,
      candidates: candidates
        ? Object.fromEntries(
            Object.entries(candidates).map(([key, value]) => [
              key,
              value.slice(0, cap),
            ]),
          )
        : {},
    };
  }

  async searchDocuments(
    query: string,
    limit = 20,
    filters: DocumentSearchFilters = {},
  ) {
    const normalized = query.trim();
    if (!normalized) return [];
    // 文档全文检索走 kh_document 独立索引（docId/filename/title/summary 口径，与 admin 前端契约一致）
    const documentResults =
      await this.context.elasticsearchProvider.searchDocuments(
        normalized,
        Math.min(Math.max(limit, 1), 50),
        undefined,
        {
          fileType: filters.fileType,
          updatedRange: filters.updatedRange,
          documentType: filters.documentType,
          role: filters.role,
        },
      );
    if (documentResults.length > 0) return documentResults;

    // 存量文档可能只有 rag_chunks 索引（例如全文索引尚未补建），回退到分块 BM25，避免管理后台出现“索引有数据但查不到”。
    const chunkResults = await this.context.elasticsearchProvider.search(
      normalized,
      Math.min(Math.max(limit, 1), 50),
      undefined,
      {
        fileType: filters.fileType,
        updatedRange: filters.updatedRange,
        documentType: filters.documentType,
        role: filters.role,
      },
    );
    if (chunkResults.length === 0) return [];

    const docIds = [
      ...new Set(chunkResults.map((item) => item.docId).filter(Boolean)),
    ];
    const metas = docIds.length
      ? await this.context.docMetaRepo.find({ where: { docId: In(docIds) } })
      : [];
    const metaById = new Map(metas.map((meta) => [meta.docId, meta]));
    return chunkResults.map((chunk) => {
      const meta = metaById.get(chunk.docId);
      return {
        docId: chunk.docId,
        filename: meta?.filename ?? chunk.docId,
        title: meta?.title ?? null,
        summary: meta?.summary ?? null,
        score: chunk.score,
        highlightFragments: (
          chunk as typeof chunk & { highlightFragments?: string[] }
        ).highlightFragments ?? [chunk.content.slice(0, 220)],
        docVersion: meta?.docVersion ?? chunk.docVersion ?? null,
        lifecycleStatus: meta?.lifecycleStatus ?? chunk.lifecycleStatus,
        sourceAuthority: meta?.sourceAuthority ?? chunk.sourceAuthority,
      };
    });
  }

  getDocumentSearchFacets() {
    return this.context.elasticsearchProvider.getDocumentSearchFacets();
  }

  async searchImages(
    query: string,
    limit = 20,
    userId?: string,
    tenantId?: string,
    role?: string,
    trustedAdminPrincipal = false,
  ) {
    const normalized = query.trim();
    const capped = Math.min(Math.max(limit, 1), 50);
    if (!normalized) {
      return {
        query,
        limit: capped,
        userId: userId ?? null,
        tenantId: tenantId ?? null,
        reason: '查询词为空',
        results: [],
      };
    }
    if (!userId) {
      return {
        query,
        limit: capped,
        userId: null,
        tenantId: tenantId ?? null,
        reason: '缺少图片检索用户范围',
        results: [],
      };
    }
    if (!this.context.imageIndexService?.isEnabled()) {
      return {
        query,
        limit: capped,
        userId: userId ?? null,
        tenantId: tenantId ?? null,
        reason:
          '图片检索未启用：缺少 MULTIMODAL_EMBEDDING_API_KEY（或 DASHSCOPE_API_KEY）',
        results: [],
      };
    }
    try {
      const allowedDocIds = await this.getActiveAllowedImageDocIds(
        userId,
        tenantId,
        role,
        trustedAdminPrincipal,
      );
      const results = await this.context.imageIndexService.searchText(
        normalized,
        {
          topK: capped,
          userId,
          allowedDocIds,
        },
      );
      return {
        query,
        limit: capped,
        userId: userId ?? null,
        tenantId: tenantId ?? null,
        reason: null,
        results,
      };
    } catch (err) {
      this.context.logger.warn(
        `Image search degraded: ${(err as Error).message}`,
      );
      return {
        query,
        limit: capped,
        userId: userId ?? null,
        tenantId: tenantId ?? null,
        reason: `图片检索降级：${(err as Error).message}`,
        results: [],
      };
    }
  }

  async searchImagesByImage(
    base64: string,
    mimeType: string,
    limit = 20,
    userId?: string,
    tenantId?: string,
    role?: string,
    trustedAdminPrincipal = false,
  ) {
    const capped = Math.min(Math.max(limit, 1), 50);
    const query = '上传图片';
    if (!base64.trim()) {
      return {
        query,
        limit: capped,
        userId: userId ?? null,
        tenantId: tenantId ?? null,
        reason: '查询图片为空',
        results: [],
      };
    }
    if (!userId) {
      return {
        query,
        limit: capped,
        userId: null,
        tenantId: tenantId ?? null,
        reason: '缺少图片检索用户范围',
        results: [],
      };
    }
    if (!this.context.imageIndexService?.isEnabled()) {
      return {
        query,
        limit: capped,
        userId,
        tenantId: tenantId ?? null,
        reason:
          '图片检索未启用：缺少 MULTIMODAL_EMBEDDING_API_KEY（或 DASHSCOPE_API_KEY）',
        results: [],
      };
    }
    try {
      const allowedDocIds = await this.getActiveAllowedImageDocIds(
        userId,
        tenantId,
        role,
        trustedAdminPrincipal,
      );
      const results = await this.context.imageIndexService.searchImage(
        base64,
        mimeType,
        { topK: capped, userId, allowedDocIds },
      );
      return {
        query,
        limit: capped,
        userId,
        tenantId: tenantId ?? null,
        reason: null,
        results,
      };
    } catch (err) {
      this.context.logger.warn(
        `Image search degraded: ${(err as Error).message}`,
      );
      return {
        query,
        limit: capped,
        userId,
        tenantId: tenantId ?? null,
        reason: `图片检索降级：${(err as Error).message}`,
        results: [],
      };
    }
  }

  async getImageAsset(params: {
    userId: string;
    tenantId?: string;
    role?: string;
    trustedAdminPrincipal?: boolean;
    docId: string;
    key: string;
  }): Promise<{ buffer: Buffer; contentType: string }> {
    const userId = params.userId?.trim();
    const docId = params.docId?.trim();
    const key = params.key?.replace(/^\/+/, '').trim();
    if (
      !userId ||
      !docId ||
      !key ||
      key.includes('\\') ||
      key.split('/').includes('..')
    ) {
      throw new BadRequestException(
        'userId, docId and a safe image key are required',
      );
    }
    if (!this.context.objectStorageProvider) {
      throw new ServiceUnavailableException('image storage is unavailable');
    }

    const activeDocuments = await this.getActiveAllowedImageDocuments(
      userId,
      params.tenantId,
      params.role,
      params.trustedAdminPrincipal,
    );
    const document = activeDocuments.get(docId);
    if (!document?.userId) {
      throw new ForbiddenException('image asset is not accessible');
    }
    const ownerPrefix = `documents/${this.context.sanitizeObjectKeyPart(document.userId)}/${docId}/`;
    if (!key.startsWith(ownerPrefix)) {
      throw new ForbiddenException(
        'image key does not belong to the requested document',
      );
    }

    const contentType = imageAssetContentType(key);
    if (!contentType) {
      throw new BadRequestException('unsupported image asset type');
    }
    return {
      buffer: await this.context.objectStorageProvider.getObject(key),
      contentType,
    };
  }

  public async getActiveAllowedImageDocIds(
    userId: string,
    tenantId?: string,
    role?: string,
    trustedAdminPrincipal = false,
  ): Promise<Set<string>> {
    return new Set(
      (
        await this.getActiveAllowedImageDocuments(
          userId,
          tenantId,
          role,
          trustedAdminPrincipal,
        )
      ).keys(),
    );
  }

  public async getActiveAllowedImageDocuments(
    userId: string,
    tenantId?: string,
    role?: string,
    trustedAdminPrincipal = false,
  ): Promise<Map<string, DocumentMetaEntity>> {
    const allowedDocIds =
      await this.context.documentService.getAllowedDocIdsForUser(
        userId,
        tenantId,
        role?.trim() ? [role.trim()] : [],
        trustedAdminPrincipal,
      );
    const ids = [...allowedDocIds];
    const documents: DocumentMetaEntity[] = [];
    for (let index = 0; index < ids.length; index += 500) {
      documents.push(
        ...(await this.context.docMetaRepo.find({
          select: [
            'docId',
            'userId',
            'lifecycleStatus',
            'reviewStatus',
            'effectiveAt',
            'expiredAt',
          ],
          where: { docId: In(ids.slice(index, index + 500)) },
        })),
      );
    }
    const now = Date.now();
    return new Map(
      documents
        .filter((document) => this.isCurrentEffectiveDocument(document, now))
        .map((document) => [document.docId, document]),
    );
  }

  public isCurrentEffectiveDocument(
    document: DocumentMetaEntity,
    now: number,
  ): boolean {
    if (
      document.lifecycleStatus !== 'effective' ||
      document.reviewStatus !== 'approved'
    ) {
      return false;
    }
    const effectiveAt = document.effectiveAt?.getTime();
    const expiredAt = document.expiredAt?.getTime();
    return (
      (effectiveAt === undefined || Number.isFinite(effectiveAt)) &&
      (expiredAt === undefined || Number.isFinite(expiredAt)) &&
      (effectiveAt === undefined || effectiveAt <= now) &&
      (expiredAt === undefined || expiredAt > now)
    );
  }
}
